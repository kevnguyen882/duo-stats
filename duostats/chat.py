"""Reading S grades from the post-game lobby chat (the chat beside the scoreboard after a game).

The client posts system messages there about players who earned an S grade: "<name> earned an S
on Xerath" for others, and "You earned an S+ on Sona" for whoever is logged in on this Mac. Players' own
messages are never read or kept; system messages are logged to postgame_messages.jsonl so
the wording can be checked if a grade is ever missed.
"""

from __future__ import annotations

import re
import threading

from .errors import DuoStatsError
from .games import clean_riot_id
from .grades import grade_rank, now_ms
from .league_client import LeagueClient
from .season import SeasonGrades
from .storage import Storage

GRADE = re.compile(r"(?<![A-Za-z0-9])S[+\-]?(?![A-Za-z0-9+\-])")
PLAYER_MESSAGE_TYPES = ("chat", "groupchat")
YOU = re.compile(r"^\W*you\b")   # "You earned ...": about the logged-in player


def is_post_game(conversation: dict) -> bool:
    kind = str(conversation.get("type", "")).lower()
    return kind in ("postgame", "post-game") or "post-game" in str(conversation.get("id", "")).lower()


class PostGameChatReader:
    def __init__(self, storage: Storage, client: LeagueClient, season: SeasonGrades):
        self.storage, self.client, self.season = storage, client, season
        self._seen = set()
        self._lock = threading.Lock()

    def read(self, players) -> list:
        """Check the post-game chat; returns [(riot id, champion id, grade)] for new S grades."""
        with self._lock:
            try:
                conversations = [c for c in self.client.conversations() if isinstance(c, dict) and is_post_game(c)]
            except DuoStatsError:
                return []
            found = []
            for conv in conversations:
                try:
                    messages = self.client.messages(conv.get("id"))
                except DuoStatsError:
                    continue
                for m in messages if isinstance(messages, list) else []:
                    found += self._handle(m, players)
            if found:
                self._save(found)
            return found

    def _handle(self, message: dict, players) -> list:
        mid = str(message.get("id") or (message.get("timestamp"), message.get("body")))
        if mid in self._seen:
            return []
        self._seen.add(mid)
        kind = str(message.get("type", "")).lower()
        if kind in PLAYER_MESSAGE_TYPES:
            return []
        body = str(message.get("body", ""))
        self.storage.log_postgame_message({"t": now_ms(), "type": kind, "body": body})
        grades = GRADE.findall(body)
        if not grades:
            return []
        low = body.lower()
        out = []
        for player in self._about(low, players):
            cid = self._champion_for(player) or self._champion_named(low, players)
            if cid:
                out.append((player.riot_id, cid, min(grades, key=grade_rank)))
        return out

    def _about(self, low: str, players) -> list:
        """The tracked players a message is about: named in it, or the logged-in player for "You ..."."""
        if YOU.match(low):
            try:
                me = clean_riot_id(self.client.current_riot_id()).lower()
            except DuoStatsError:
                return []
            return [p for p in players if p.key == me]
        return [p for p in players if (name := p.riot_id.rpartition("#")[0].strip().lower()) and name in low]

    def _champion_for(self, player):
        """The champion this player played in the game that just ended, from the client's game session."""
        try:
            puuid = self.client.puuid_for(player.riot_id)
            data = self.client.session().get("gameData") or {}
        except DuoStatsError:
            return None
        for team in (data.get("teamOne") or [], data.get("teamTwo") or []):
            for x in team:
                if x.get("puuid") == puuid and x.get("championId"):
                    return str(x["championId"])
        return None

    def _champion_named(self, low: str, players):
        """Fallback: a champion's name mentioned in the message (longest match, so "Vi" never beats "Viktor")."""
        champs = self.client.champions
        for p in players:
            low = low.replace(p.riot_id.rpartition("#")[0].strip().lower(), " ")
        hits = []
        for cid, alias in champs.alias.items():
            for name in {alias.lower(), str(champs.display.get(alias, "")).lower()}:
                if name and re.search(r"(?<![a-z0-9'])" + re.escape(name) + r"(?![a-z0-9])", low):
                    hits.append((len(name), str(cid)))
        return max(hits)[1] if hits else None

    def _ended_game_id(self):
        for read in (lambda: (self.client.session().get("gameData") or {}).get("gameId"),
                     lambda: self.client.end_of_game_stats().get("gameId")):
            try:
                gid = read()
                if gid:
                    return str(gid)
            except (DuoStatsError, AttributeError):
                continue
        return None

    def _save(self, found: list):
        game_id = self._ended_game_id()
        if game_id:   # kept with the game, so the game's row shows its grade
            self.storage.save_game_grades(game_id, {rid.lower(): g for rid, _, g in found})
        for rid, cid, g in found:
            if self.season.record(rid, cid, g):
                alias = self.client.champions.alias_of(cid)
                print(f"Post-game chat: {rid} earned {g} on {self.client.champions.display.get(alias, alias)}.")
