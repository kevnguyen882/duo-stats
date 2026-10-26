"""Build recommendations for the Live tab, from every player (both teams) in the games saved on this Mac.

For a champion in a game mode:
  augments   the ones with the best win rate (pulled toward 50% when picked only a few times)
  items      what winners on the champion ended up with (the page keeps the finished items)
  skills     the usual skill order, from Riot's match timelines: fetched once per game with the Riot API key,
             in the background, and kept in data/timelines/ (just the skill order of each champion in the game).
             Riot's API doesn't include some modes (ARAM Mayhem): those get no skill order rather than retries.
             For those, the Duo Stats browser extension records your own skill level-ups as you play and sends
             them here (record_skills); they're kept in data/skillorders.json.
"""

from __future__ import annotations

import re
import threading
import time
from collections import Counter, deque

from . import config
from . import games as gamesmod
from .errors import DuoStatsError, RiotApiError
from .league_client import LeagueClient
from .riot_api import RiotApi
from .storage import Storage, game_id_of

SKILLS = "QWER"
NOT_IN_RIOT_API = {2400: "ARAM Mayhem"}   # modes Riot's match API doesn't share (checked October 2026)


def max_order(seq: str) -> str:
    """The order the basic abilities were maxed in, e.g. "QEW" (by when each got its 5th point)."""
    points, done = {"Q": 0, "W": 0, "E": 0}, []
    for s in seq:
        if s in points:
            points[s] += 1
            if points[s] == 5:
                done.append(s)
    return "".join(done + sorted((k for k in "QWE" if k not in done), key=lambda k: -points[k]))


def skill_summary(seqs: list) -> dict | None:
    """The most common max order, and level by level the usual pick among the games that maxed that way."""
    seqs = [s for s in seqs if len(s) >= 6]
    if not seqs:
        return None
    orders = Counter(max_order(s) for s in seqs)
    top, n = orders.most_common(1)[0]
    same = [s for s in seqs if max_order(s) == top]
    longest = min(18, max(len(s) for s in same))
    sequence = "".join(Counter(s[i] for s in same if len(s) > i).most_common(1)[0][0] for i in range(longest))
    return {"games": len(seqs), "maxOrder": top, "maxGames": n, "sequence": sequence}


class BuildAdvisor:
    TIMELINES_PER_CHAMPION = 30   # skill orders come from this champion's most recent games in the mode

    def __init__(self, storage: Storage, client: LeagueClient, riot: RiotApi):
        self.storage, self.client, self.riot = storage, client, riot
        self.dir = storage.path("timelines")
        self._index_key, self._index = None, {}
        self._lock = threading.Lock()
        self._todo, self._queued = deque(), set()
        self._worker = None
        self.key_problem = ""   # why skill orders can't be fetched right now, if they can't
        self.modes = {}         # queue id -> the game mode name the in-game data uses for it (2400 -> "KIWI")
        self.recorded_file = storage.path("skillorders.json")

    # ---- every player in every saved game, by champion and game mode ----
    def _games_index(self) -> dict:
        ids = self.storage.saved_game_ids()
        with self._lock:
            if self._index_key == len(ids):
                return self._index
        try:
            champs = self.client.ensure_champions()
        except DuoStatsError:
            champs = self.client.champions
        index = {}
        for source, raw in self.storage.saved_games():
            game = gamesmod.parse(source, raw, champs)
            if game.remake:
                continue
            match_id = ((raw.get("metadata") or {}).get("matchId") if source == "api"
                        else f'{raw.get("platformId") or ""}_{raw.get("gameId")}')
            for p in game.participants:
                index.setdefault((p.champion.lower(), game.queue_id), []).append((game, p, match_id))
            mode = raw.get("gameMode") or (raw.get("info") or {}).get("gameMode")
            if mode and game.queue_id is not None:
                self.modes.setdefault(game.queue_id, str(mode).upper())
        for entries in index.values():
            entries.sort(key=lambda e: e[0].start, reverse=True)
        with self._lock:
            self._index_key, self._index = len(ids), index
        return index

    def build(self, champion: str, queue_id) -> dict:
        try:
            queue_id = int(queue_id)
        except (TypeError, ValueError):
            queue_id = None
        entries = self._games_index().get((str(champion).lower(), queue_id), [])
        wins = [p for _, p, _ in entries if p.win]

        picks = Counter(), Counter()
        for _, p, _ in entries:
            for a in set(p.augments):
                picks[0][a] += 1
                if p.win:
                    picks[1][a] += 1
        augments = [{"id": a, "picks": n, "wins": picks[1][a], "score": (picks[1][a] + 2) / (n + 4)}
                    for a, n in picks[0].items()]
        augments.sort(key=lambda a: (a["score"], a["picks"]), reverse=True)

        items = Counter(i for p in wins for i in set(p.items))

        # skill orders: what's kept already, and fetch the rest in the background
        seqs, missing = [], []
        for game, p, match_id in ([] if queue_id in NOT_IN_RIOT_API else entries[:self.TIMELINES_PER_CHAMPION]):
            kept = self.storage.read_json(self.dir / f"{game.game_id}.json")
            if isinstance(kept, dict):
                seq = (kept.get("skills") or {}).get(p.champion.lower())
                if seq:
                    seqs.append(seq)
            elif match_id and "_" in match_id and not match_id.startswith("_"):
                missing.append(match_id)
        self._fetch_later(missing)
        recorded = self._recorded(champion, self.modes.get(queue_id))
        seqs += recorded

        return {"champion": champion, "queueId": queue_id, "games": len(entries), "wins": len(wins),
                "augments": augments[:10], "items": [{"id": i, "games": n} for i, n in items.most_common(20)],
                "skills": skill_summary(seqs), "skillsPending": len(missing), "skillsRecorded": len(recorded),
                "skillsProblem": (f"Riot's API doesn't include {NOT_IN_RIOT_API[queue_id]} games, so skill orders for this mode "
                                  "come from the Duo Stats browser extension as you play. None recorded on this champion yet."
                                  if queue_id in NOT_IN_RIOT_API
                                  else self.key_problem if missing else "")}

    # ---- skill orders recorded live by the browser extension ----
    def record_skills(self, body: dict, players: list) -> dict:
        """One player's skill order in one game, as far as it's got: {riotId, champion, mode, start, sequence}.
        Sent again as the game goes on; the longest version for that game is kept."""
        rid = str(body.get("riotId", "")).strip()
        if rid.lower() not in {p.key for p in players}:
            raise ValueError("That player isn't one of the two being tracked.")
        champs = self.client.champions
        champ = str(body.get("champion", "")).strip()
        alias = next((a for a in champs.alias.values() if a.lower() == champ.lower()), None) or champs.by_name.get(champ.lower())
        seq = str(body.get("sequence", ""))
        mode = str(body.get("mode", "")).upper()
        try:
            start = int(body.get("start"))
        except (TypeError, ValueError):
            start = 0
        if not alias or not re.fullmatch(r"[QWER]{1,18}", seq) or not re.fullmatch(r"[A-Z0-9_]{1,24}", mode) or start <= 0:
            raise ValueError("That doesn't look like a skill order.")
        key = f"{rid.lower()}|{alias.lower()}|{start // 300000}"   # the same game, give or take a few minutes
        with self._lock:
            data = self.storage.read_json(self.recorded_file, {}) or {}
            cur = data.get(key) or {}
            if len(seq) >= len(cur.get("sequence", "")):
                data[key] = {"riotId": rid, "champion": alias, "mode": mode, "start": start, "sequence": seq,
                             "updated": int(time.time() * 1000)}
                self.storage.write_json(self.recorded_file, data)
        return {"ok": True, "champion": alias, "levels": len(data[key]["sequence"])}

    def _recorded(self, champion: str, mode) -> list:
        if not mode:
            return []
        data = self.storage.read_json(self.recorded_file, {}) or {}
        return [v["sequence"] for v in data.values() if isinstance(v, dict)
                and v.get("champion", "").lower() == str(champion).lower() and v.get("mode") == mode]

    # ---- skill orders from Riot's match timelines ----
    def _fetch_later(self, match_ids: list):
        if not match_ids:
            return
        if not self.riot.available:
            self.key_problem = "Add a Riot API key in Options (on the Mac running Duo Stats) to get skill orders."
            return
        with self._lock:
            for m in match_ids:
                if m not in self._queued:
                    self._queued.add(m)
                    self._todo.append(m)
            if not (self._worker and self._worker.is_alive()):
                self._worker = threading.Thread(target=self._work, name="timelines", daemon=True)
                self._worker.start()

    def _work(self):
        while True:
            with self._lock:
                if not self._todo:
                    return
                match_id = self._todo.popleft()
            try:
                self._fetch(match_id)
                self.key_problem = ""
            except RiotApiError as e:
                if ("API key" in str(e) or "401" in str(e) or "403" in str(e)) and not self._key_works():
                    self.key_problem = str(e)
                    with self._lock:   # the key won't work for the rest either; try again on the next request
                        self._todo.clear()
                        self._queued.clear()
                    return
            except Exception:
                pass
            finally:
                with self._lock:
                    self._queued.discard(match_id)

    def _key_works(self) -> bool:
        """Riot also answers "forbidden" for a single game it won't share; that's only a key problem if the key fails here."""
        try:
            self.riot.get("https://na1.api.riotgames.com/lol/status/v4/platform-data")
            return True
        except RiotApiError:
            return False

    def _fetch(self, match_id: str):
        platform = match_id.split("_", 1)[0].lower()
        regional = next((r for p, r in config.REGIONS.values() if p == platform), "americas")
        base = f"https://{regional}.api.riotgames.com/lol/match/v5/matches/{match_id}"
        champs = self.client.champions
        # which champion each participant number was, from Riot's own record of the game
        match = self.storage.api_match(match_id)
        try:
            if not isinstance(match, dict):
                match = self.riot.get(base)
                self.storage.save_api_match(match)
            timeline = self.riot.get(base + "/timeline")
        except RiotApiError as e:
            if ("403" in str(e) or "API key" in str(e) or "Not found" in str(e)) and self._key_works():
                self.storage.write_json(self.dir / f"{game_id_of(match_id)}.json", {"skills": {}, "unavailable": True})
                return
            raise
        who = {p.get("participantId"): champs.alias_of(p.get("championId")).lower()
               for p in (match.get("info") or {}).get("participants", [])}
        skills = {}
        for frame in (timeline.get("info") or {}).get("frames", []):
            for e in frame.get("events", []):
                if e.get("type") == "SKILL_LEVEL_UP" and e.get("levelUpType", "NORMAL") == "NORMAL" \
                        and 1 <= (e.get("skillSlot") or 0) <= 4 and e.get("participantId") in who:
                    champ = who[e["participantId"]]
                    skills[champ] = skills.get(champ, "") + SKILLS[e["skillSlot"] - 1]
        self.storage.write_json(self.dir / f"{game_id_of(match_id)}.json", {"skills": skills})
