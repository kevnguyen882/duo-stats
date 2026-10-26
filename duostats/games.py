"""Turning saved games into the rows the page shows.

Games come in two shapes, one from the League client and one from Riot's web API. Both are
first converted to the same simple form (a Game with a list of Participants), and rows are
built from that, so the rest of the app never cares where a game came from.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from .league_client import ChampionCatalog
from .storage import game_id_of


@dataclass
class Participant:
    puuid: str
    riot_id: str             # "name#tag", lowercase ("" if the game didn't record it)
    team: tuple              # (team id, sub-team id) — sub-teams are Arena duos
    champion: str            # alias, e.g. "MonkeyKing"
    win: bool
    stats: dict              # kills, deaths, assists, cs, damage, gold, vision, multikills
    items: list = field(default_factory=list)
    augments: list = field(default_factory=list)
    name: str = ""           # their name as shown in game, e.g. "damn son"


@dataclass
class Game:
    game_id: str
    source: str              # "client" or "api"
    queue_id: int
    start: int               # ms since 1970
    duration: int            # seconds
    participants: list
    early_surrender: bool = False

    @property
    def remake(self) -> bool:
        return self.early_surrender or self.duration < 300


# ---- reading each source ----
def _num(d: dict, key: str) -> int:
    return d.get(key, 0) or 0


def _stats(d: dict) -> dict:
    return {
        "kills": _num(d, "kills"), "deaths": _num(d, "deaths"), "assists": _num(d, "assists"),
        "cs": _num(d, "totalMinionsKilled") + _num(d, "neutralMinionsKilled"),
        "damage": _num(d, "totalDamageDealtToChampions"), "gold": _num(d, "goldEarned"),
        "vision": _num(d, "visionScore"), "triples": _num(d, "tripleKills"),
        "quadras": _num(d, "quadraKills"), "pentas": _num(d, "pentaKills"),
        # for badges
        "heal": _num(d, "totalHeal"), "mitigated": _num(d, "damageSelfMitigated"),
        "crit": _num(d, "largestCriticalStrike"), "spree": _num(d, "largestKillingSpree"),
    }


def from_client(raw: dict, champions: ChampionCatalog) -> Game:
    ids = {pi.get("participantId"): pi.get("player") or {} for pi in raw.get("participantIdentities", [])}
    parts = []
    for x in raw.get("participants", []):
        player, st = ids.get(x.get("participantId"), {}), x.get("stats") or {}
        name = player.get("gameName") or ""
        parts.append(Participant(
            puuid=player.get("puuid") or "",
            riot_id=f"{name}#{player.get('tagLine', '')}".lower() if name else "",
            team=(x.get("teamId"), st.get("playerSubteamId", 0) or 0),
            champion=champions.alias_of(x.get("championId")),
            win=bool(st.get("win")),
            stats=_stats(st),
            items=[i for i in (st.get(f"item{n}", 0) for n in range(6)) if i],
            augments=[a for a in ((st.get(f"playerAugment{n}") or x.get(f"playerAugment{n}") or 0)
                                  for n in range(1, 7)) if a],
            name=name,
        ))
    return Game(game_id=game_id_of(raw.get("gameId")), source="client", queue_id=raw.get("queueId"),
                start=raw.get("gameCreation") or 0, duration=raw.get("gameDuration", 0) or 0, participants=parts)


def from_api(raw: dict) -> Game:
    info = raw.get("info") or {}
    parts = []
    for x in info.get("participants", []):
        name = x.get("riotIdGameName") or ""
        parts.append(Participant(
            puuid=x.get("puuid") or "",
            riot_id=f"{name}#{x.get('riotIdTagline', '')}".lower() if name else "",
            team=(x.get("teamId"), x.get("playerSubteamId", 0) or 0),
            champion=x.get("championName") or "?",
            win=bool(x.get("win")),
            stats=_stats(x),
            items=[i for i in (x.get(f"item{n}", 0) for n in range(6)) if i],
            augments=[a for a in (x.get(f"playerAugment{n}", 0) for n in range(1, 7)) if a],
            name=name,
        ))
    duration = info.get("gameDuration", 0) or 0
    if duration > 100000:   # very old matches report milliseconds
        duration //= 1000
    return Game(game_id=game_id_of((raw.get("metadata") or {}).get("matchId") or info.get("gameId")), source="api",
                queue_id=info.get("queueId"), start=info.get("gameStartTimestamp") or info.get("gameCreation") or 0,
                duration=duration, participants=parts,
                early_surrender=any(x.get("gameEndedInEarlySurrender") for x in info.get("participants", [])))


def parse(source: str, raw: dict, champions: ChampionCatalog) -> Game:
    return from_client(raw, champions) if source == "client" else from_api(raw)


# ---- who is who ----
def clean_riot_id(riot_id: str) -> str:
    """"damn son #NA12" -> "damn son#NA12": spaces around the # aren't part of a Riot ID, but are easy to type."""
    name, sep, tag = (riot_id or "").strip().rpartition("#")
    return f"{name.strip()}#{tag.strip()}" if sep else tag


@dataclass
class Player:
    """One of the people being compared. A game may know them by the League client's ID, by Riot's
    web-API ID (which differs per API key), or just by their Riot ID, so all three are checked."""
    riot_id: str
    ids: set = field(default_factory=set)
    client_puuid: str = ""   # the League client's ID for them
    api_puuid: str = ""      # Riot's web-API ID for them (with the current key)

    def __post_init__(self):
        self.riot_id = clean_riot_id(self.riot_id)

    @property
    def key(self) -> str:
        return self.riot_id.lower()

    def find_in(self, game: Game):
        for p in game.participants:
            if (p.puuid and p.puuid in self.ids) or (p.riot_id and p.riot_id == self.key):
                return p
        return None


def row(game: Game, me: Participant, together: bool, against: bool) -> dict:
    """One player's view of one game, flattened to the fields the page uses."""
    mates = [p for p in game.participants if p.team == me.team]
    team_kills = sum(p.stats["kills"] for p in mates)
    team_damage = sum(p.stats["damage"] for p in mates)
    s = me.stats
    return {
        "matchId": game.game_id, "source": game.source, "queueId": game.queue_id, "start": game.start,
        "duration": game.duration, "remake": game.remake, "win": me.win, "champion": me.champion,
        **s,
        "kp": (s["kills"] + s["assists"]) / team_kills if team_kills else None,
        "dmgShare": s["damage"] / team_damage if team_damage else None,
        "items": me.items, "augments": me.augments,
        "withDuo": together, "vsDuo": against,
    }


def rows_for(players: list, game: Game) -> dict:
    """{player key: row} for each tracked player in this game."""
    found = {pl.key: pl.find_in(game) for pl in players}
    out = {}
    for pl in players:
        me = found[pl.key]
        if not me:
            continue
        others = [found[o.key] for o in players if o.key != pl.key and found[o.key]]
        out[pl.key] = row(game, me, together=any(o.team == me.team for o in others),
                          against=any(o.team != me.team for o in others))
    return out


def match_detail(game: Game, players: list, grades: dict) -> dict:
    """Everyone in one game, team by team (the tracked players' team first), for the match details window."""
    tracked = {}
    for i, pl in enumerate(players):
        me = pl.find_in(game)
        if me:
            tracked[id(me)] = (i, pl)
    teams = {}
    for p in game.participants:
        r = row(game, p, together=False, against=False)
        for k in ("withDuo", "vsDuo", "matchId", "source", "queueId", "start", "duration", "remake", "items"):
            r.pop(k)
        i, pl = tracked.get(id(p), (None, None))
        r.update(name=p.name, items=p.items, player=i, riotId=pl.riot_id if pl else "",
                 grade=grades.get(pl.key) if pl else None)
        teams.setdefault(p.team, []).append(r)
    order = sorted(teams, key=lambda t: (all(r["player"] is None for r in teams[t]), t))
    return {"matchId": game.game_id, "queueId": game.queue_id, "start": game.start, "duration": game.duration,
            "remake": game.remake, "teams": [{"win": teams[t][0]["win"], "players": teams[t]} for t in order]}
