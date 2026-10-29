"""Building the stats the page shows, from every game saved on this Mac."""

from __future__ import annotations

from . import badges as badgesmod
from . import games as gamesmod
from .errors import DuoStatsError
from .league_client import LeagueClient
from .players import PlayerDirectory
from .riot_api import RiotApi
from .storage import Storage, game_id_of
from .tracker import GameTracker


class StatsService:
    RECENT_FROM_CLIENT = 100   # how far back to check the client's history on each load (startup checks further)

    def __init__(self, storage: Storage, client: LeagueClient, riot: RiotApi,
                 directory: PlayerDirectory, tracker: GameTracker):
        self.storage, self.client, self.riot, self.directory, self.tracker = storage, client, riot, directory, tracker
        self._best = {}   # queue -> {player key: best damage}, from the last rows built (for Personal Best in match details)

    def build(self, riot_ids, region: str = "NA", queue=None, count: int = 40) -> dict:
        warnings = []
        players = self.directory.resolve(riot_ids, region, warnings)
        client_open = self.client.is_running()
        if not client_open and not self.riot.available and not self.storage.saved_game_ids():
            raise DuoStatsError("Open League (or add a Riot API key in Options) so the app can find your games.")

        # 1. the League client: save anything that isn't saved yet (quick, it's on this Mac)
        if client_open:
            try:
                self.tracker.save_history(self.RECENT_FROM_CLIENT)
            except DuoStatsError as e:
                warnings.append(str(e))
        # 2. Riot's web API, if there's a key: only for games the client didn't have
        if self.riot.available:
            try:
                self._fetch_from_riot(players[0], region, count, queue)
            except DuoStatsError as e:
                warnings.append(f"Riot's API: {e}")

        rows = self._rows(players, queue)
        return {"players": [{"riotId": p.riot_id, "ranks": self._ranks(p, region), "games": rows[p.key]}
                            for p in players],
                "region": region, "warnings": warnings, "clientOpen": client_open, "badges": badgesmod.catalog()}

    def match(self, game_id) -> dict:
        """Everyone's stats in one saved game, for the match details window."""
        saved = self.storage.saved_game(game_id)
        if not saved:
            raise DuoStatsError("That game isn't saved on this Mac.")
        try:
            champions = self.client.ensure_champions()
        except DuoStatsError:
            champions = self.client.champions
        game = gamesmod.parse(*saved, champions)
        players = self.tracker.players()
        detail = gamesmod.match_detail(game, players, self.storage.game_grades(game.game_id))
        queue = self.storage.settings().get("queue") or None   # Personal Best: against the games the page has loaded
        if str(queue) not in self._best:
            self._rows(players, queue)
        badgesmod.attach_match(detail, self._best.get(str(queue), {}))
        return detail

    def together(self, players) -> dict:
        """{player key: rows} for every saved game the players played together, newest first, from what's on this Mac."""
        return self._rows(players, None)

    def _fetch_from_riot(self, player, region: str, count: int, queue):
        if not player.api_puuid:
            return
        saved = self.storage.saved_game_ids()
        missing = [m for m in self.riot.match_ids(player.api_puuid, region, count, queue)
                   if game_id_of(m) not in saved]
        if len(missing) > 60:
            print(f"  {len(missing)} games aren't saved yet; Riot's rate limit means this takes about "
                  f"{max(1, len(missing) * 2 // 100)} min the first time")
        for i, match_id in enumerate(missing, 1):
            self.storage.save_api_match(self.riot.match(match_id, region))
            if i % 25 == 0:
                print(f"  {i}/{len(missing)} games from Riot's API")
        if missing:
            print(f"Saved {len(missing)} game{'s' if len(missing) != 1 else ''} from Riot's API.")

    def _rows(self, players, queue) -> dict:
        try:
            champions = self.client.ensure_champions()
        except DuoStatsError:
            champions = self.client.champions
        out = {p.key: [] for p in players}
        duo = len(players) > 1
        for source, raw in self.storage.saved_games():
            game = gamesmod.parse(source, raw, champions)
            if queue and game.queue_id != int(queue):
                continue
            rows = gamesmod.rows_for(players, game)
            if duo and not (len(rows) == len(players) and all(r["withDuo"] for r in rows.values())):
                continue   # this app compares the two of you, so only games you played together count
            grades = self.storage.game_grades(game.game_id)
            for key, r in rows.items():
                if grades.get(key):
                    r["grade"] = grades[key]
                out[key].append(r)
        for key in out:
            out[key].sort(key=lambda r: r.get("start") or 0, reverse=True)
        badgesmod.attach(out, {p.key: p.riot_id.split("#")[0] for p in players})
        self._best[str(queue)] = badgesmod.best_damage(out)
        return out

    def _ranks(self, player, region: str) -> dict:
        if player.client_puuid:
            try:
                ranks = self.client.ranks(player.client_puuid)
                if ranks:
                    return ranks
            except DuoStatsError:
                pass
        if self.riot.available and player.api_puuid:
            try:
                return self.riot.ranks(player.api_puuid, region)
            except DuoStatsError:
                pass
        return {}
