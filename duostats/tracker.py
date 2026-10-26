"""The background listener: follows the League client and saves everything as it happens.

  - when League opens (or an account logs in): saves any games from its match history that
    aren't saved yet, and that player's season-best grades
  - when the scoreboard shows: reads S grades from the post-game chat
  - shortly after each game: saves the finished game and the updated grades

It runs inside the app, so none of this depends on the web page being open. It listens to
the client's event stream, and falls back to checking every few seconds if that's unavailable.
"""

from __future__ import annotations

import threading
import time

from . import config
from .chat import PostGameChatReader
from .errors import DuoStatsError
from .events import ClientEventStream
from .games import Player
from .grades import now_ms
from .league_client import LeagueClient
from .live import LiveView
from .season import SeasonGrades
from .storage import Storage, game_id_of


class GameTracker:
    HISTORY_PAGE = 50          # games per match-history request
    HISTORY_DEPTH = 1000       # how far back the startup check looks
    AFTER_GAME_CHECKS = (20, 60, 180)   # seconds after a game ends: the game and grades can take a while to appear
    POLL_SECONDS = 3           # used only when the event stream isn't available

    def __init__(self, storage: Storage, client: LeagueClient, season: SeasonGrades,
                 chat: PostGameChatReader, live: LiveView):
        self.storage, self.client, self.season, self.chat, self.live = storage, client, season, chat, live
        self.stream = ClientEventStream(client, self._on_event, self._on_connection)
        self.version = 0           # goes up whenever something new is saved; the page reloads when it changes
        self.phase = "None"
        self.me = ""
        self.last_saved = None
        self.last_note = ""
        self._history_lock = threading.Lock()
        self._games_handled = set()
        self._stop = threading.Event()

    # ---- running ----
    def start(self):
        self.stream.start()
        threading.Thread(target=self._watch, name="client-watch", daemon=True).start()

    def stop(self):
        self._stop.set()
        self.stream.stop()

    def status(self) -> dict:
        running = self.stream.connected or self.client.is_running()
        return {"connected": running, "listening": self.stream.connected, "me": self.me if running else "",
                "phase": self.phase if running else "NoClient", "version": self.version,
                "lastSaved": self.last_saved, "note": self.last_note}

    def _changed(self, note: str = ""):
        self.version += 1
        if note:
            self.last_note = note

    def _in_background(self, fn, *args):
        threading.Thread(target=self._safely, args=(fn, *args), daemon=True).start()

    @staticmethod
    def _safely(fn, *args):
        try:
            fn(*args)
        except DuoStatsError:
            pass   # League closed partway: the next connection picks up where this left off
        except Exception as e:
            print(f"[tracker] {fn.__name__}: {e}")

    def _watch(self):
        """Fallback when the event stream is down but the client is reachable: check the phase every few seconds."""
        while not self._stop.wait(self.POLL_SECONDS):
            if self.stream.connected:
                continue
            try:
                self._on_phase(self.client.phase())
            except DuoStatsError:
                if self.phase != "NoClient":
                    self.phase = "NoClient"

    # ---- who to track ----
    def players(self) -> list:
        settings = self.storage.settings()
        known = settings.get("ids") or {}
        out = []
        for rid in settings.get("players") or []:
            if rid and "#" in rid:
                p = Player(rid)
                p.ids.update(known.get(p.key, []))
                try:
                    p.ids.add(self.client.puuid_for(rid))
                except DuoStatsError:
                    pass
                out.append(p)
        return out

    # ---- events ----
    def _on_connection(self, up: bool):
        if up:
            self._in_background(self._client_opened)
        else:
            self.phase = "NoClient"

    def _on_event(self, uri: str, kind: str, data):
        if uri == "/lol-gameflow/v1/gameflow-phase":
            self._on_phase(data if isinstance(data, str) else "None")
        elif uri.startswith("/lol-chat/v1/conversations/") and "/messages/" in uri and kind == "Create":
            if self.phase in config.PHASES_POST_GAME or "post-game" in uri:
                self._in_background(self._read_chat)
        elif uri == "/lol-end-of-game/v1/eog-stats-block" and isinstance(data, dict) and data.get("gameId"):
            self._game_over(str(data["gameId"]))

    def _on_phase(self, phase: str):
        if phase == self.phase:
            return
        self.phase = phase
        if phase in config.PHASES_POST_GAME:
            self._in_background(self._read_chat)
            try:
                gid = (self.client.session().get("gameData") or {}).get("gameId")
            except DuoStatsError:
                gid = None
            self._game_over(str(gid) if gid else f"ended-{int(time.time() // 600)}")

    # ---- what happens when ----
    def _client_opened(self):
        self.client.ensure_champions()
        self.me = self.client.current_riot_id()
        print(f"Connected to the League client{f' ({self.me})' if self.me else ''}. Listening for games.")
        new = self.save_history(self.HISTORY_DEPTH)
        graded = self.season.capture_from_client()
        if new or graded:
            self._changed(f"Saved {new} game{'s' if new != 1 else ''} from the League client." if new else "")
        try:
            self._on_phase(self.client.phase())
        except DuoStatsError:
            pass

    def _game_over(self, game_id: str):
        if game_id in self._games_handled:
            return
        self._games_handled.add(game_id)
        self._in_background(self._after_game)

    def _after_game(self):
        for delay in self.AFTER_GAME_CHECKS:
            if self._stop.wait(delay):
                return
            new = self.save_history(self.HISTORY_PAGE)
            graded = self.season.capture_from_client()
            found = self._read_chat(quiet=True)
            if new or graded or found:
                self._changed("Saved your latest game." if new else "Updated grades.")

    def _read_chat(self, quiet: bool = False):
        found = self.chat.read(self.players())
        if found and not quiet:
            self._changed("New S grade from the post-game chat.")
        return found

    # ---- saving games from the client's match history ----
    def save_history(self, depth: int) -> int:
        """Save every game in the logged-in player's history (up to `depth` back) that isn't saved yet."""
        with self._history_lock:
            me = self.client.current_summoner()
            puuid = me.get("puuid")
            if not puuid:
                return 0
            saved = self.storage.saved_game_ids()
            listed, new, beg = set(), 0, 0
            while beg < depth:
                page = self.client.match_history(puuid, beg, min(beg + self.HISTORY_PAGE, depth) - 1)
                ids = [game_id_of(g.get("gameId")) for g in page if g.get("gameId")]
                fresh = [i for i in ids if i not in listed]
                if not fresh:   # the end of the history (or the client repeating itself)
                    break
                listed.update(fresh)
                for gid in fresh:
                    if gid not in saved:
                        game = self.client.game(gid)
                        if isinstance(game, dict) and game.get("participants"):
                            self.storage.save_client_game(game)
                            saved.add(gid)
                            new += 1
                beg += len(ids)
            if new:
                self.last_saved = now_ms()
                print(f"Saved {new} new game{'s' if new != 1 else ''} from the League client.")
            return new
