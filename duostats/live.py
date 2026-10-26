"""What's happening right now: the game phase, which champion each of you is on (or hovering, in champion select),
and the ARAM bench of champions anyone on your team can swap for."""

from __future__ import annotations

from . import config
from .errors import DuoStatsError
from .league_client import LeagueClient, LiveGame


class LiveView:
    def __init__(self, client: LeagueClient, live_game: LiveGame | None = None):
        self.client = client
        self.live_game = live_game or LiveGame()

    def status(self, riot_ids) -> dict:
        try:
            phase = self.client.phase()
        except DuoStatsError as e:
            return {"phase": "NoClient", "message": str(e), "players": []}
        champs = self.client.ensure_champions()
        me_id = self.client.current_riot_id()
        wanted = {r.lower(): r for r in riot_ids if r}
        if me_id:
            wanted.setdefault(me_id.lower(), me_id)
        game = {}
        try:
            game = self.client.session().get("gameData") or {}
        except DuoStatsError:
            pass
        found, hovering, bench = {}, set(), []   # found: riot id (lowercase) -> champion alias
        if phase in config.PHASES_PICKING:
            found, hovering, bench = self._from_champ_select(wanted, champs)
        elif phase in config.PHASES_IN_GAME:
            found = self._from_live_game(wanted, champs) or self._from_session(game, wanted, champs)
        ids = {a: cid for cid, a in champs.alias.items()}
        players = [{"riotId": wanted[low], "alias": alias, "name": champs.display.get(alias, alias), "id": ids.get(alias),
                    "isMe": bool(me_id) and low == me_id.lower(), "hover": low in hovering}
                   for low, alias in found.items() if alias]
        players.sort(key=lambda p: not p["isMe"])
        return {"phase": phase, "queueId": (game.get("queue") or {}).get("id"), "gameId": game.get("gameId"),
                "players": players,
                "bench": [{"alias": a, "name": champs.display.get(a, a), "id": ids.get(a)} for a in bench]}

    def _puuid(self, riot_id):
        try:
            return self.client.puuid_for(riot_id)
        except DuoStatsError:
            return None

    def _from_champ_select(self, wanted, champs):
        """(champion per player, the players who are only hovering it so far, the champions on the ARAM bench)."""
        try:
            session = self.client.champ_select()
        except DuoStatsError:
            return {}, set(), []
        found, hovering = {}, set()
        team = {m.get("puuid"): m for m in session.get("myTeam", []) if m.get("puuid")}
        for low, rid in wanted.items():
            m = team.get(self._puuid(rid))
            if not m:
                continue
            if m.get("championId"):
                found[low] = champs.alias_of(m["championId"])
            elif m.get("championPickIntent"):   # hovered in draft, not locked in yet
                found[low] = champs.alias_of(m["championPickIntent"])
                hovering.add(low)
        bench = [champs.alias_of(b.get("championId")) for b in session.get("benchChampions") or []
                 if isinstance(b, dict) and b.get("championId")]
        return found, hovering, bench

    def _from_live_game(self, wanted, champs) -> dict:
        try:
            listing = self.live_game.players()
        except Exception:
            return {}   # still loading
        found = {}
        for x in listing:
            rid = x.get("riotId") or f'{x.get("riotIdGameName")}#{x.get("riotIdTagLine")}'
            if rid.lower() in wanted:
                raw = str(x.get("rawChampionName", ""))
                alias = raw.rsplit("_", 1)[-1] if raw.startswith("game_character_displayname_") else None
                found[rid.lower()] = alias or champs.by_name.get(str(x.get("championName", "")).lower())
        return found

    def _from_session(self, game, wanted, champs) -> dict:
        """The picks the client recorded for this game (used while the game is still loading)."""
        found = {}
        for team in (game.get("teamOne") or [], game.get("teamTwo") or []):
            for x in team:
                for low, rid in wanted.items():
                    if x.get("championId") and x.get("puuid") == self._puuid(rid):
                        found[low] = champs.alias_of(x["championId"])
        return found
