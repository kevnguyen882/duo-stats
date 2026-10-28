"""Everything the app keeps on this Mac, in the project's data/ folder.

    client/<game id>.json        games saved from the League client (the main source)
    matches/<REGION>_<id>.json   games saved from Riot's web API
    grades/<game id>.json        S grades announced in that game's post-game chat
    season_grades.json           each player's season-best grades
    settings.json                Riot IDs, region and other choices made on the page
    augments.json, augicons/     augment names and icons
    augment_descriptions.json    augment descriptions from the League of Legends Wiki
    opgg/<mode>-<champion>.json  op.gg's builds and augments for a champion, refreshed every few hours
    postgame_messages.jsonl      post-game system messages, kept for checking the chat reader
"""

from __future__ import annotations

import json
import os
import threading
from pathlib import Path

from . import config
from .grades import better


def game_id_of(match_or_game_id) -> str:
    """'NA1_5664919632' and 5664919632 both become '5664919632', so the two sources line up."""
    return str(match_or_game_id).rsplit("_", 1)[-1]


class Storage:
    def __init__(self, root: Path = config.DATA_DIR):
        self.root = Path(root)
        self.client_dir = self.root / "client"
        self.api_dir = self.root / "matches"
        self.grades_dir = self.root / "grades"
        self.icons_dir = self.root / "augicons"
        self._lock = threading.Lock()
        self._parsed = {}   # path -> (mtime, data): saved games are read once, not on every load

    # ---- plain JSON files ----
    def path(self, name: str) -> Path:
        return self.root / name

    def read_json(self, path: Path, default=None):
        try:
            return json.loads(Path(path).read_text())
        except (OSError, ValueError):
            return default

    def write_json(self, path: Path, data) -> bool:
        """Write via a temporary file, so a crash never leaves half a file behind."""
        path = Path(path)
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            tmp = path.with_name(path.name + ".tmp")
            tmp.write_text(json.dumps(data))
            os.replace(tmp, path)
            return True
        except OSError:
            return False

    # ---- saved games ----
    def saved_game_ids(self) -> set:
        return ({game_id_of(p.stem) for p in self.client_dir.glob("*.json")}
                | {game_id_of(p.stem) for p in self.api_dir.glob("*.json")})

    def has_game(self, game_id) -> bool:
        gid = game_id_of(game_id)
        return (self.client_dir / f"{gid}.json").exists() or any(self.api_dir.glob(f"*_{gid}.json"))

    def client_game(self, game_id):
        return self.read_json(self.client_dir / f"{game_id_of(game_id)}.json")

    def save_client_game(self, game: dict) -> bool:
        return self.write_json(self.client_dir / f"{game_id_of(game.get('gameId'))}.json", game)

    def api_match(self, match_id):
        return self.read_json(self.api_dir / f"{match_id}.json")

    def saved_game(self, game_id):
        """(source, raw) for one saved game, the League client's copy first; None if it isn't saved."""
        gid = game_id_of(game_id)
        raw = self.client_game(gid)
        if isinstance(raw, dict):
            return "client", raw
        for path in self.api_dir.glob(f"*_{gid}.json"):
            raw = self._cached(path)
            if isinstance(raw, dict):
                return "api", raw
        return None

    def save_api_match(self, match: dict) -> bool:
        match_id = (match.get("metadata") or {}).get("matchId")
        return bool(match_id) and self.write_json(self.api_dir / f"{match_id}.json", match)

    def _cached(self, path: Path):
        try:
            mtime = path.stat().st_mtime
        except OSError:
            return None
        hit = self._parsed.get(path)
        if hit and hit[0] == mtime:
            return hit[1]
        data = self.read_json(path)
        if data is not None:
            self._parsed[path] = (mtime, data)
        return data

    def saved_games(self):
        """Every saved game as (source, raw), one per game; the League client's copy wins when both exist."""
        out = {}
        for path in sorted(self.client_dir.glob("*.json")):
            raw = self._cached(path)
            if isinstance(raw, dict):
                out[game_id_of(path.stem)] = ("client", raw)
        for path in sorted(self.api_dir.glob("*.json")):
            gid = game_id_of(path.stem)
            if gid not in out:
                raw = self._cached(path)
                if isinstance(raw, dict):
                    out[gid] = ("api", raw)
        return list(out.values())

    # ---- grades earned in a game (from the post-game chat) ----
    def game_grades(self, game_id) -> dict:
        return self.read_json(self.grades_dir / f"{game_id_of(game_id)}.json", {}) or {}

    def save_game_grades(self, game_id, grades: dict) -> bool:
        """grades: {riot id (lowercase): grade}; keeps the better grade if one is already saved."""
        with self._lock:
            path = self.grades_dir / f"{game_id_of(game_id)}.json"
            cur = self.read_json(path, {}) or {}
            for k, g in grades.items():
                cur[k] = better(g, cur.get(k, "")) if cur.get(k) else g
            return self.write_json(path, cur)

    # ---- season-best grades ----
    def season(self) -> dict:
        return self.read_json(self.path("season_grades.json"), {}) or {}

    def update_season(self, change):
        """change(data) edits the season data in place; done under a lock so threads don't overwrite each other."""
        with self._lock:
            data = self.season()
            result = change(data)
            self.write_json(self.path("season_grades.json"), data)
            return result

    # ---- page settings ----
    def settings(self) -> dict:
        return self.read_json(self.path("settings.json"), {}) or {}

    def update_settings(self, **values) -> dict:
        with self._lock:
            cur = self.settings()
            cur.update({k: v for k, v in values.items() if v is not None})
            self.write_json(self.path("settings.json"), cur)
            return cur

    # ---- post-game chat log ----
    def log_postgame_message(self, entry: dict):
        try:
            self.root.mkdir(parents=True, exist_ok=True)
            with (self.root / "postgame_messages.jsonl").open("a") as f:
                f.write(json.dumps(entry) + "\n")
        except OSError:
            pass
