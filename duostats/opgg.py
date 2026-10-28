"""op.gg's builds for a champion in ARAM and ARAM Mayhem: starting items, core builds, and the most-picked
Prismatic, Gold and Silver augments. Read from op.gg's normal public pages and kept on this Mac for a few hours."""

from __future__ import annotations

import json
import re
import threading
import time
import urllib.request

from .errors import DuoStatsError
from .storage import Storage

MODES = {2400: "aram-mayhem", 450: "aram"}   # queue id -> op.gg's name for the mode
PAGE = "https://op.gg/lol/modes/{mode}/{slug}/{page}"
REFRESH_HOURS = 12   # op.gg updates its numbers daily
BROWSER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Safari/605.1.15"
RARITY = {1: "Silver", 4: "Gold", 8: "Prismatic"}
SHOW_BUILDS, SHOW_AUGMENTS = 3, 6   # starting item sets and core builds; augments of each rarity


def slug(alias: str) -> str:
    """op.gg's name for a champion in its addresses: the game's alias in lowercase ("MonkeyKing" -> "monkeyking")."""
    return re.sub(r"[^a-z0-9]", "", str(alias).lower())


def page_data(page_html: str) -> str:
    """op.gg's pages carry their data as text pushed to self.__next_f; this joins it back into one string."""
    out = []
    for chunk in re.findall(r"self\.__next_f\.push\((\[.*?\])\)</script>", page_html, re.S):
        try:
            part = json.loads(chunk)
        except ValueError:
            continue
        if len(part) > 1 and isinstance(part[1], str):
            out.append(part[1])
    return "".join(out)


def _list_after(data: str, label: str) -> list:
    """The list of rows shown under a heading on the items page ("Core builds", "Starter items")."""
    at = data.find(f'"children":"{label}"')
    at = data.find('"data":[', at) if at >= 0 else -1
    if at < 0:
        return []
    try:
        rows = json.JSONDecoder().raw_decode(data, at + len('"data":'))[0]
    except ValueError:
        return []
    return rows if isinstance(rows, list) else []


def _number(v) -> float:
    try:
        return float(str(v).replace(",", ""))
    except ValueError:
        return 0.0


def _build(row: dict) -> dict:
    return {"items": [int(i) for i in row.get("ids") or []], "pick": round(_number(row.get("pick_rate")), 1),
            "win": round(_number(row.get("win_rate")), 1), "games": int(_number(row.get("play")))}


def parse_items(page_html: str) -> dict:
    """{"starter": [...], "core": [...]} from a champion's items page, each {items, pick, win, games}, most picked first."""
    data = page_data(page_html)
    found = {key: [_build(r) for r in _list_after(data, label) if isinstance(r, dict) and r.get("ids")][:SHOW_BUILDS]
             for key, label in (("starter", "Starter items"), ("core", "Core builds"))}
    if not found["core"]:
        raise DuoStatsError("Couldn't read the builds on op.gg's page (its layout may have changed).")
    return found


def parse_augments(page_html: str, rarity_of=None) -> dict:
    """{"Prismatic": [...], "Gold": [...], "Silver": [...]} from a champion's augments page, each {id, name, pick}.
    rarity_of: augment id -> "Silver"/"Gold"/"Prismatic" from the game, for the augments op.gg leaves it off."""
    data = page_data(page_html)
    at = re.search(r'\{"data":\s*\[\{"id":', data)
    if not at:
        raise DuoStatsError("Couldn't read the augments on op.gg's page (its layout may have changed).")
    rows = json.JSONDecoder().raw_decode(data, at.start())[0]["data"]
    tiers = {tier: [] for tier in ("Prismatic", "Gold", "Silver")}
    for a in sorted(rows, key=lambda r: -_number(r.get("popular"))):   # op.gg's order: most picked first
        tier = RARITY.get(a.get("rarity")) or (rarity_of or {}).get(str(a.get("id")))
        if tier in tiers and len(tiers[tier]) < SHOW_AUGMENTS:
            tiers[tier].append({"id": a.get("id"), "name": a.get("name") or "", "pick": round(_number(a.get("popular")), 2)})
    return tiers


class OpggBuilds:
    def __init__(self, storage: Storage, rarity_of=None, fetch=None):
        """rarity_of: a function giving {augment id: rarity} from the game's list. fetch: url -> page HTML (for tests)."""
        self.storage, self.rarity_of = storage, rarity_of or (lambda: {})
        self.fetch = fetch or self._fetch
        self._locks, self._lock = {}, threading.Lock()

    @staticmethod
    def _fetch(url: str) -> str:
        req = urllib.request.Request(url, headers={"User-Agent": BROWSER_AGENT, "Accept-Language": "en-US,en"})
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                return r.read().decode("utf-8", "replace")
        except Exception as e:
            raise DuoStatsError(f"Couldn't reach op.gg: {e}") from e

    def builds(self, alias: str, queue_id) -> dict:
        """op.gg's builds for a champion in the mode of this queue, from this Mac's copy when it's recent enough."""
        try:
            mode = MODES[int(queue_id)]
        except (KeyError, TypeError, ValueError):
            raise DuoStatsError("op.gg builds are only shown for ARAM and ARAM Mayhem.")
        name = slug(alias)
        if not name:
            raise DuoStatsError("No champion picked.")
        path = self.storage.path(f"opgg/{mode}-{name}.json")
        with self._lock:
            lock = self._locks.setdefault(path, threading.Lock())
        with lock:   # the page asks again every few seconds: fetch once
            cached = self.storage.read_json(path) or {}
            if cached.get("fetched", 0) > time.time() - REFRESH_HOURS * 3600:
                return cached
            try:
                fresh = self._from_opgg(mode, name)
            except DuoStatsError:
                if cached:
                    return {**cached, "stale": True}   # op.gg unreachable: the last copy is better than nothing
                raise
            self.storage.write_json(path, fresh)
            return fresh

    def _from_opgg(self, mode: str, name: str) -> dict:
        url = PAGE.format(mode=mode, slug=name, page="build")
        out = {"mode": mode, "url": url, "fetched": time.time(),
               **parse_items(self.fetch(PAGE.format(mode=mode, slug=name, page="items")))}
        if mode == "aram-mayhem":   # augments are only in Mayhem
            rarity = {}
            try:
                rarity = self.rarity_of() or {}
            except Exception:
                pass
            out["augments"] = parse_augments(self.fetch(PAGE.format(mode=mode, slug=name, page="augments")), rarity)
        return out
