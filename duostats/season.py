"""Season-best champion grades, for the S Rank Challenge.

Grades come from three places, best first:
  1. the League client's mastery data, for whoever is logged in on this Mac (exact, complete)
  2. the post-game chat, which announces S grades as they're earned (exact, any player in the game)
  3. Riot's web API, which only rarely shows an S (it's cleared when a mastery milestone completes)

season_grades.json, per player (lowercase Riot ID):
  grades     champion id -> season best, read from the client     (+ "updated": when)
  apiGrades  champion id -> [grade, when seen], from the chat or Riot's API
"""

from __future__ import annotations

from .errors import DuoStatsError
from .grades import best_grade, better, grade_rank, is_s_rank, now_ms, season_start_ms
from .league_client import LeagueClient
from .riot_api import RiotApi
from .storage import Storage


class SeasonGrades:
    def __init__(self, storage: Storage, client: LeagueClient, riot: RiotApi):
        self.storage, self.client, self.riot = storage, client, riot

    def capture_from_client(self) -> bool:
        """Save the logged-in player's season-best grades. True if anything changed."""
        rid = self.client.current_riot_id()
        if not rid:
            return False
        grades = {cid: g for cid, e in self.client.mastery_entries().items() if (g := best_grade(e))}
        if not grades:
            return False

        def change(data):
            entry = data.setdefault(rid.lower(), {})
            changed = entry.get("grades") != grades
            entry.update(riotId=rid, updated=now_ms(), grades=grades)
            return changed
        changed = self.storage.update_season(change)
        if changed:
            print(f"Saved this season's best grades for {rid} ({len(grades)} champions) from the League client.")
        return changed

    def record(self, riot_id: str, champion_id, grade: str) -> bool:
        """Remember a grade seen in the post-game chat or Riot's API. True if it's an improvement."""
        def change(data):
            entry = data.setdefault(riot_id.lower(), {"riotId": riot_id})
            seen = entry.setdefault("apiGrades", {})
            cur = (seen.get(str(champion_id)) or [""])[0]
            if grade_rank(grade) < grade_rank(cur):
                seen[str(champion_id)] = [grade, now_ms()]
                return True
            return False
        return self.storage.update_season(change)

    def board(self, players, region: str) -> dict:
        """Each player's S-or-better champions this season, for the S Rank page."""
        try:
            self.capture_from_client()
        except DuoStatsError:
            pass   # League closed: use what was saved earlier
        start = season_start_ms()
        out = []
        for player in players:
            best = {}
            if self.riot.available:
                try:
                    acct = self.riot.account(player.riot_id, region)
                    for e in self.riot.mastery(acct["puuid"], region):
                        g = best_grade(e)
                        if is_s_rank(g):
                            cid = str(e.get("championId"))
                            best[cid] = g
                            self.record(player.riot_id, cid, g)
                except DuoStatsError:
                    pass
            for cid, g in self.saved_best(player).items():
                best[cid] = better(g, best.get(cid, "")) if best.get(cid) else g
            saved = self.storage.season().get(player.key) or {}
            client_fresh = (saved.get("updated") or 0) >= start
            out.append({"riotId": player.riot_id, "champs": {c: g for c, g in best.items() if is_s_rank(g)},
                        "clientUpdated": saved.get("updated") if client_fresh else None})
        return {"players": out}

    def saved_best(self, player) -> dict:
        """{champion id: best grade this season}, from what's saved on this Mac (the client's grades, and those seen in
        the post-game chat or Riot's API). Asks nothing over the network."""
        start = season_start_ms()
        saved = self.storage.season().get(player.key) or {}
        best = {}
        for cid, v in (saved.get("apiGrades") or {}).items():
            if len(v) >= 2 and v[1] >= start:   # this season only
                best[cid] = better(v[0], best.get(cid, "")) if best.get(cid) else v[0]
        if (saved.get("updated") or 0) >= start:
            for cid, g in (saved.get("grades") or {}).items():
                best[cid] = better(g, best.get(cid, "")) if best.get(cid) else g
        return best
