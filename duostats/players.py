"""Working out who the players are: their Riot IDs and the IDs games use for them.

The League client and Riot's web API use different IDs for the same person, and the web API's
IDs even differ per API key. Every ID found is remembered in settings.json, so games can be
matched later even when League is closed.
"""

from __future__ import annotations

from .errors import DuoStatsError
from .games import Player
from .league_client import LeagueClient
from .riot_api import RiotApi
from .storage import Storage


class PlayerDirectory:
    def __init__(self, storage: Storage, client: LeagueClient, riot: RiotApi):
        self.storage, self.client, self.riot = storage, client, riot

    def resolve(self, riot_ids, region: str, warnings: list | None = None) -> list:
        warnings = warnings if warnings is not None else []
        known = self.storage.settings().get("ids") or {}
        players = []
        for rid in riot_ids:
            rid = (rid or "").strip()
            if not rid:
                continue
            if "#" not in rid:
                raise DuoStatsError(f'"{rid}" needs its tag too, like Name#NA1.')
            player = Player(rid)
            player.ids.update(known.get(player.key, []))
            try:
                player.client_puuid = self.client.puuid_for(rid)
                player.ids.add(player.client_puuid)
            except DuoStatsError:
                pass   # League closed: the remembered IDs (and the Riot ID itself) still match games
            if self.riot.available:
                try:
                    acct = self.riot.account(rid, region)
                    player.api_puuid = acct["puuid"]
                    player.ids.add(acct["puuid"])
                    player.riot_id = f'{acct.get("gameName")}#{acct.get("tagLine")}'   # Riot's capitalisation
                except DuoStatsError as e:
                    warnings.append(f"{rid}: {e}")
            players.append(player)
        if not players:
            raise DuoStatsError("Enter at least one Riot ID in Options.")
        self._remember(players)
        return players

    def _remember(self, players: list):
        known = self.storage.settings().get("ids") or {}
        changed = False
        for p in players:
            ids = sorted(set(known.get(p.key, [])) | p.ids)
            if ids != known.get(p.key):
                known[p.key], changed = ids, True
        if changed:
            self.storage.update_settings(ids=known)
