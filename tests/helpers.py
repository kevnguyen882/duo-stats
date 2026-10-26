"""Shared pieces for the tests: small made-up games in both saved shapes, and a fake League client.

Nothing here touches the network, the real League client, the Keychain or the data/ folder.
"""

from __future__ import annotations

import shutil
import tempfile
import unittest
from pathlib import Path

from duostats.errors import DuoStatsError
from duostats.league_client import ChampionCatalog
from duostats.storage import Storage

# champion id -> (alias, display name)
CHAMPIONS = {1: ("Annie", "Annie"), 62: ("MonkeyKing", "Wukong"), 254: ("Vi", "Vi"), 112: ("Viktor", "Viktor"),
             37: ("Sona", "Sona"), 101: ("Xerath", "Xerath"), 147: ("Seraphine", "Seraphine")}


def catalog() -> ChampionCatalog:
    c = ChampionCatalog()
    c.load([{"id": cid, "alias": alias, "name": name} for cid, (alias, name) in CHAMPIONS.items()]
           + [{"id": 60062, "alias": "Mode_Wukong", "name": "Wukong"}])   # a game mode's copy of a champion
    return c


def stats(**over) -> dict:
    """One player's end-of-game stats, in the field names both sources use."""
    s = {"kills": 5, "deaths": 2, "assists": 10, "totalMinionsKilled": 150, "neutralMinionsKilled": 10,
         "totalDamageDealtToChampions": 20000, "goldEarned": 12000, "visionScore": 20,
         "tripleKills": 0, "quadraKills": 0, "pentaKills": 0, "totalHeal": 5000, "damageSelfMitigated": 15000,
         "largestCriticalStrike": 0, "largestKillingSpree": 3, "win": True}
    s.update(over)
    return s


def client_game(game_id=5000000001, players=None, duration=1500, queue=450, created=1_790_000_000_000):
    """A game as saved from the League client. players: [(name, tag, puuid, champion id, team, stats)]."""
    players = players or default_players()
    return {
        "gameId": game_id, "queueId": queue, "gameCreation": created, "gameDuration": duration,
        "participantIdentities": [{"participantId": i + 1, "player": {"gameName": n, "tagLine": t, "puuid": pu}}
                                  for i, (n, t, pu, _, _, _) in enumerate(players)],
        "participants": [{"participantId": i + 1, "championId": cid, "teamId": team, "stats": st}
                         for i, (_, _, _, cid, team, st) in enumerate(players)],
    }


def api_match(match_id="NA1_5000000002", players=None, duration=1500, queue=450, start=1_790_000_000_000, **info):
    """A game as saved from Riot's web API, in its own shape."""
    players = players or default_players()
    parts = []
    for n, t, pu, cid, team, st in players:
        p = {"riotIdGameName": n, "riotIdTagline": t, "puuid": pu, "championName": CHAMPIONS[cid][0], "teamId": team}
        p.update(st)
        parts.append(p)
    return {"metadata": {"matchId": match_id},
            "info": {"queueId": queue, "gameStartTimestamp": start, "gameDuration": duration, "participants": parts, **info}}


def default_players():
    """The two of us on team 100 with two others, against two players on team 200."""
    return [
        ("Duo One", "NA1", "puuid-one", 1, 100, stats(kills=10, assists=5, totalDamageDealtToChampions=40000)),
        ("Duo Two", "NA2", "puuid-two", 62, 100, stats(kills=6, assists=12, totalDamageDealtToChampions=30000)),
        ("Mate", "NA1", "puuid-mate", 37, 100, stats(kills=4, assists=8, totalDamageDealtToChampions=30000)),
        ("Enemy A", "EUW", "puuid-ea", 101, 200, stats(kills=7, win=False)),
        ("Enemy B", "EUW", "puuid-eb", 147, 200, stats(kills=3, win=False)),
    ]


class FakeClient:
    """Stands in for LeagueClient. Set the attributes a test needs; closed=True makes every call fail like a closed client."""

    def __init__(self):
        self.champions = catalog()
        self.closed = False
        self.riot_id = "Duo One#NA1"
        self.puuids = {"duo one#na1": "puuid-one", "duo two#na2": "puuid-two"}
        self.session_data = {}
        self.eog = {}
        self.convs = []
        self.msgs = {}
        self.mastery = {}

    def _check(self):
        if self.closed:
            raise DuoStatsError("League isn't open.")

    def is_running(self):
        return not self.closed

    def current_riot_id(self):
        self._check()
        return self.riot_id

    def puuid_for(self, riot_id):
        self._check()
        return self.puuids.get(riot_id.replace(" #", "#").lower(), "")

    def session(self):
        self._check()
        return self.session_data

    def end_of_game_stats(self):
        self._check()
        return self.eog

    def conversations(self):
        self._check()
        return self.convs

    def messages(self, conversation_id):
        self._check()
        return self.msgs.get(conversation_id, [])

    def mastery_entries(self):
        self._check()
        return self.mastery

    def ensure_champions(self):
        return self.champions


class FakeRiot:
    """Stands in for RiotApi with no key: every web API feature is off."""
    key = ""
    available = False


class TempStorageCase(unittest.TestCase):
    """A test case with its own empty data folder, removed afterwards."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="duostats-test-"))
        self.storage = Storage(self.tmp)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)
