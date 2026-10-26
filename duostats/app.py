"""Putting the pieces together, and starting the app."""

from __future__ import annotations

import argparse
import os
import sys
import threading
import webbrowser

from . import config
from .augments import AugmentCatalog
from .chat import PostGameChatReader
from .errors import DuoStatsError
from .games import clean_riot_id
from .grades import now_ms
from .keychain import Keychain
from .league_client import LeagueClient
from .live import LiveView
from .players import PlayerDirectory
from .riot_api import RiotApi, clean_key, KEY_FORMAT
from .season import SeasonGrades
from .stats import StatsService
from .storage import Storage
from .tracker import GameTracker
from .ugg import UggOpener


class App:
    def __init__(self, storage: Storage | None = None, client: LeagueClient | None = None,
                 riot: RiotApi | None = None, keychain: Keychain | None = None):
        self.storage = storage or Storage()
        self.client = client or LeagueClient(champion_cache=self.storage.path("champions.json"))
        self.riot = riot or RiotApi(os.environ.get("RIOT_API_KEY", "").strip())
        self.keychain = keychain or Keychain()
        self.key_saved = False
        self.directory = PlayerDirectory(self.storage, self.client, self.riot)
        self.season = SeasonGrades(self.storage, self.client, self.riot)
        self.chat = PostGameChatReader(self.storage, self.client, self.season)
        self.live = LiveView(self.client)
        self.ugg = UggOpener()
        self.tracker = GameTracker(self.storage, self.client, self.season, self.chat, self.live)
        self.stats = StatsService(self.storage, self.client, self.riot, self.directory, self.tracker)
        self.augments = AugmentCatalog(self.storage, self.client)

    # ---- the Riot API key ----
    def load_saved_key(self):
        if not self.riot.key:
            self.riot.key = self.keychain.get()
            self.key_saved = bool(self.riot.key)
            if self.key_saved:
                print("Loaded your saved Riot API key from the Keychain.")

    def set_key(self, text: str, remember: bool) -> bool:
        key = clean_key(text)
        if not KEY_FORMAT.fullmatch(key):
            raise DuoStatsError("That doesn't look like a complete Riot key. It should look like "
                                "RGAPI-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx. Use the Copy button next to the key "
                                "on developer.riotgames.com.")
        self.riot.check_key(key)
        self.key_saved = self.keychain.set(key) if remember else False
        return self.key_saved

    def forget_key(self):
        self.keychain.delete()
        self.riot.key, self.key_saved = "", False

    # ---- what the page asks for ----
    def status(self) -> dict:
        return {"hasKey": self.riot.available, "saved": self.key_saved, "client": self.tracker.status()}

    def settings(self) -> dict:
        s = self.storage.settings()
        return {k: s.get(k) for k in ("players", "region", "queue", "count")}

    def save_settings(self, body: dict) -> dict:
        allowed = {}
        if isinstance(body.get("players"), list):
            allowed["players"] = [str(p).strip() for p in body["players"]][:2]
        if body.get("region") in config.REGIONS:
            allowed["region"] = body["region"]
        if "queue" in body:
            allowed["queue"] = body.get("queue") or ""
        if "count" in body:
            try:
                allowed["count"] = max(1, min(int(body["count"]), 1000))
            except (TypeError, ValueError):
                pass
        self.storage.update_settings(**allowed)
        return self.settings()

    def load_stats(self, body: dict, save: bool = True) -> dict:
        """save: False for another computer on the network, which sees this Mac's settings but can't change them."""
        if save:
            self.save_settings(body)
        s = self.storage.settings()
        return self.stats.build(s.get("players") or [], s.get("region") or "NA", s.get("queue") or None,
                                s.get("count") or 40)

    def s_rank(self, body: dict) -> dict:
        region = body.get("region") or self.storage.settings().get("region") or "NA"
        players = self.directory.resolve(body.get("players") or self.storage.settings().get("players") or [], region)
        return self.season.board(players, region)

    def champions(self) -> list:
        catalog = self.client.ensure_champions()
        return [{"id": cid, "alias": alias, "name": catalog.display.get(alias, alias)} for cid, alias in catalog.alias.items()]

    def match(self, game_id: str) -> dict:
        return self.stats.match(game_id)

    # ---- badge showcases: one per player, saved here so each of you can see the other's ----
    SHOWCASE_LIMIT = 3000   # badges per showcase

    def showcases(self) -> dict:
        """{player (lowercase Riot ID): {"board": {badge key: {x, y, z}}, "updated": ms}}"""
        data = self.storage.read_json(self.storage.path("showcases.json"), {})
        return data if isinstance(data, dict) else {}

    def save_showcase(self, body: dict, viewer: bool) -> dict:
        """Only your own showcase can be changed: Player 1's from this Mac, Player 2's from another computer."""
        players = self.tracker.players()
        own = players[1 if viewer else 0] if len(players) > (1 if viewer else 0) else None
        if not own or clean_riot_id(str(body.get("owner", ""))).lower() != own.key:
            raise PermissionError("You can only arrange your own showcase.")
        board = {}
        for key, v in list((body.get("board") or {}).items())[:self.SHOWCASE_LIMIT]:
            try:
                x, y, z = float(v["x"]), float(v["y"]), int(v.get("z") or 0)
            except (TypeError, ValueError, KeyError):
                continue
            if isinstance(key, str) and len(key) <= 120 and 0 <= x <= 1 and 0 <= y <= 1:
                board[key] = {"x": round(x, 4), "y": round(y, 4), "z": max(0, min(z, 100000))}
        data = self.showcases()
        data[own.key] = {"board": board, "updated": now_ms()}
        self.storage.write_json(self.storage.path("showcases.json"), data)
        return {"ok": True, "owner": own.riot_id, "badges": len(board)}

    def live_status(self, riot_ids) -> dict:
        out = self.live.status(riot_ids)
        out["version"] = self.tracker.version
        return out


def main():
    from .access import Access
    from .server import make_server

    parser = argparse.ArgumentParser(prog="duo_stats.py", description="Compare your League stats with your duo partner's.")
    parser.add_argument("--lan", action="store_true",
                        help="also let other computers on this network open the page (they can look, not change anything)")
    parser.add_argument("--pin", default=os.environ.get("DUO_STATS_PIN", ""),
                        help="with --lan: a PIN other computers enter once before they can see anything")
    args = parser.parse_args()
    if args.pin and not args.lan:
        print("--pin only matters with --lan; ignoring it.")

    app = App()
    try:
        app.storage.root.mkdir(parents=True, exist_ok=True)
    except OSError:
        pass
    access = Access(lan=args.lan, pin=args.pin if args.lan else "", secret_file=app.storage.path("lan_secret"))
    try:
        server = make_server(app, config.PORT, access)
    except OSError:
        print(f"Port {config.PORT} is already in use. Is Duo Stats already running in another Terminal window?")
        sys.exit(1)
    app.load_saved_key()
    app.tracker.start()
    url = f"http://localhost:{config.PORT}"
    print(f"Duo Stats is running at {url}  (press Ctrl+C to stop)")
    print("Listening for the League client in the background; games are saved as you play.")
    if access.lan:
        print("\nOther computers on this network can open it at:")
        for u in access.urls(config.PORT):
            print(f"    {u}")
        print("They can look at everything but can't change settings or the Riot key."
              + (" They'll be asked for the PIN once." if access.pin else ""))
        print("If macOS asks whether Python may accept incoming connections, choose Allow.")
    if not os.environ.get("DUO_STATS_NO_BROWSER"):
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
    finally:
        app.tracker.stop()
