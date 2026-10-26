"""Augment names, rarities and icons (from the game) and descriptions (from the League of Legends Wiki)."""

from __future__ import annotations

import html.parser
import json
import re
import threading
import time
import urllib.request

from . import config
from .errors import DuoStatsError
from .league_client import LeagueClient
from .storage import Storage

RARITY = {"kSilver": "Silver", "kGold": "Gold", "kPrismatic": "Prismatic"}


def web_get(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": config.USER_AGENT})
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.read()


def name_key(name: str) -> str:
    """Normalise a name so the game's and the wiki's spellings match ("Light 'Em Up!" -> "light'emup")."""
    name = str(name).lower().replace("’", "'").replace("‘", "'").replace("`", "'")
    name = re.sub(r"^quest:\s*", "", name)   # the wiki calls quest augments "Quest: <name>"
    return re.sub(r"[^a-z0-9']", "", name)


# ---------- the wiki's augments table ----------
class _WikiAugmentTable(html.parser.HTMLParser):
    """Collects the rows of the first table with the "wikitable" class whose header starts with "Augment"."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.depth = 0          # how many tables deep we are
        self.target = None      # depth of the table being read
        self.done = False
        self.rows, self.row, self.cell, self.skip = [], None, None, 0

    def handle_starttag(self, tag, attrs):
        if tag in ("style", "script", "sup"):
            self.skip += 1
        if tag == "table":
            self.depth += 1
            if not self.done and self.target is None and "wikitable" in (dict(attrs).get("class") or ""):
                self.target, self.rows = self.depth, []
            return
        if self.target == self.depth:
            if tag == "tr":
                self.row = []
            elif tag in ("td", "th") and self.row is not None:
                self.cell = []
        if self.cell is not None and tag in ("br", "p", "li", "tr"):
            self.cell.append("\n")

    def handle_endtag(self, tag):
        if tag in ("style", "script", "sup"):
            self.skip = max(0, self.skip - 1)
        if tag == "table":
            if self.target == self.depth:
                head = [c.strip().lower() for c in (self.rows[0] if self.rows else [])]
                if head[:1] == ["augment"]:
                    self.done = True
                self.target = None
            self.depth -= 1
            return
        if self.target == self.depth:
            if tag in ("td", "th") and self.cell is not None and self.row is not None:
                self.row.append("".join(self.cell))
                self.cell = None
            elif tag == "tr" and self.row is not None:
                self.rows.append(self.row)
                self.row = None
        if self.cell is not None and tag == "p":
            self.cell.append("\n")

    def handle_data(self, data):
        if self.cell is not None and not self.skip:
            self.cell.append(data)


def _clean(text: str) -> str:
    lines = [re.sub(r"[ \t ]+", " ", ln).strip() for ln in text.split("\n")]
    return re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip()


def parse_wiki_augments(page_html: str) -> dict:
    """{name key: {name, desc, tier}} from the wiki page's augments table."""
    table = _WikiAugmentTable()
    table.feed(page_html)
    if not table.done:
        return {}
    found = {}
    for row in table.rows[1:]:
        if len(row) < 2:
            continue
        name = _clean(row[0]).split("\n")[-1].strip()
        desc = _clean(row[1])
        if name and desc:
            found[name_key(name)] = {"name": name, "desc": desc, "tier": _clean(row[2]) if len(row) > 2 else ""}
    return found


class AugmentCatalog:
    def __init__(self, storage: Storage, client: LeagueClient):
        self.storage, self.client = storage, client
        self._info = {}
        self._lock = threading.Lock()

    def _game_list(self) -> list:
        """The game's augment list: from the client, else the copy saved earlier, else CommunityDragon's copy."""
        path = self.storage.path("augments.json")
        raw = None
        try:
            raw = self.client.get("/lol-game-data/assets/v1/cherry-augments.json")
        except DuoStatsError:
            pass
        if not raw:
            raw = self.storage.read_json(path)
        if not raw:
            try:
                raw = json.loads(web_get(config.CDRAGON + "v1/cherry-augments.json"))
            except Exception:
                raw = []
        if raw:
            self.storage.write_json(path, raw)
        return raw if isinstance(raw, list) else []

    def descriptions(self) -> dict:
        """Wiki descriptions, refreshed every few days and kept on this Mac."""
        path = self.storage.path("augment_descriptions.json")
        cached = self.storage.read_json(path, {}) or {}
        if cached.get("fetched", 0) > time.time() - config.WIKI_REFRESH_DAYS * 86400:
            return cached.get("augments") or {}
        try:
            parsed = parse_wiki_augments(web_get(config.WIKI_AUGMENTS_URL).decode("utf-8", "replace"))
            if len(parsed) >= 20:   # sanity check: the page layout is what we expect
                self.storage.write_json(path, {"fetched": time.time(), "source": config.WIKI_AUGMENTS_URL,
                                               "augments": parsed})
                print(f"Loaded {len(parsed)} augment descriptions from the League of Legends Wiki.")
                return parsed
            print("Couldn't read augment descriptions from the wiki page (its layout may have changed).")
        except Exception as e:
            print(f"Couldn't reach the League of Legends Wiki for augment descriptions: {e}")
        return cached.get("augments") or {}

    def info(self) -> dict:
        """{augment id: {name, rarity, icon, desc}}"""
        with self._lock:
            if self._info:
                return self._info
            for a in self._game_list():
                if isinstance(a, dict) and a.get("id") is not None:
                    self._info[str(a["id"])] = {
                        "name": a.get("nameTRA") or a.get("name") or "",
                        "rarity": RARITY.get(a.get("rarity"), ""),
                        "icon": a.get("augmentLargeIconPath") or a.get("augmentSmallIconPath") or "",
                        "desc": "",
                    }
            if self._info:
                wiki = {name_key(v.get("name", "")): v for v in self.descriptions().values()}
                for entry in self._info.values():
                    entry["desc"] = (wiki.get(name_key(entry["name"])) or {}).get("desc", "")
            return self._info

    def for_page(self) -> dict:
        return {k: {"name": v["name"], "rarity": v["rarity"], "desc": v["desc"]} for k, v in self.info().items()}

    def icon(self, augment_id) -> bytes | None:
        """PNG of an augment's in-game icon, kept in augicons/ after the first time."""
        augment_id = re.sub(r"\D", "", str(augment_id))
        path = self.storage.icons_dir / f"{augment_id}.png"
        if path.exists():
            return path.read_bytes()
        icon_path = (self.info().get(augment_id) or {}).get("icon", "")
        if not icon_path:
            return None
        data = None
        try:
            data = self.client.get_bytes(icon_path)
        except DuoStatsError:
            pass
        if not data:
            try:   # CommunityDragon mirrors the client's assets with lowercase paths
                data = web_get(config.CDRAGON + icon_path.replace("/lol-game-data/assets/", "").lower())
            except Exception:
                data = None
        if data and data[:4] == b"\x89PNG":
            try:
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(data)
            except OSError:
                pass
            return data
        return None
