"""The League client running on this Mac.

While League is open it serves a local API, protected by a password it writes to a
"lockfile" and passes on its command line. It uses a self-signed certificate, so
certificate checks are skipped for these connections, which never leave 127.0.0.1.
"""

from __future__ import annotations

import base64
import json
import re
import ssl
import subprocess
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

from . import config
from .errors import ClientRequestError, ClientUnavailable

_ctx = ssl.create_default_context()
_ctx.check_hostname = False
_ctx.verify_mode = ssl.CERT_NONE
LOCAL_OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}), urllib.request.HTTPSHandler(context=_ctx))
LOCAL_SSL = _ctx


def same_riot_id(obj: dict, riot_id: str, name_key="gameName", tag_key="tagLine") -> bool:
    name, _, tag = riot_id.rpartition("#")
    return (str(obj.get(name_key, "")).lower() == name.strip().lower()
            and str(obj.get(tag_key, "")).lower() == tag.strip().lower())


class ChampionCatalog:
    """Champion id <-> alias ("MonkeyKing", used for icons) <-> display name ("Wukong")."""

    def __init__(self):
        self.alias = {}      # id -> alias (real champions only)
        self.display = {}    # alias -> display name
        self.by_name = {}    # lowercase display name -> alias
        self.variants = {}   # id of a game mode's copy of a champion -> the real champion's alias
        self.roles = {}      # alias -> League classes, e.g. ["mage", "support"] (Ductopia's defenders)

    # Real champions have ids below 1000. Some game modes add copies with their own ids and aliases
    # ("Jade_Leona", 60089); those aren't separate champions and have no Data Dragon picture.
    VARIANT_IDS_FROM = 1000

    def load(self, summary: list):
        entries = [c for c in summary or [] if isinstance(c, dict) and c.get("id", -1) > 0]
        for c in entries:
            if c["id"] < self.VARIANT_IDS_FROM:
                alias = c.get("alias") or c.get("name")
                self.alias[c["id"]] = alias
                self.display[alias] = c.get("name") or alias
                self.by_name[str(c.get("name", "")).lower()] = alias
                self.roles[alias] = [str(r).lower() for r in c.get("roles") or []]
        for c in entries:
            if c["id"] >= self.VARIANT_IDS_FROM:
                real = self.by_name.get(str(c.get("name", "")).lower())
                if real:
                    self.variants[c["id"]] = real

    def __bool__(self):
        return bool(self.alias)

    def alias_of(self, champion_id) -> str:
        try:
            cid = int(champion_id)
        except (TypeError, ValueError):
            return str(champion_id)
        return self.alias.get(cid) or self.variants.get(cid) or str(champion_id)


class LeagueClient:
    CREDS_TTL = 10   # seconds to reuse the connection details before looking again

    def __init__(self, champion_cache=None):
        self.champion_cache = champion_cache   # where the champion list is kept for when League is closed
        self._creds = None
        self._creds_at = 0.0
        self._lock = threading.Lock()
        self.champions = ChampionCatalog()
        self._puuids = {}   # riot id (lowercase) -> the client's ID for that player

    # ---- finding the client ----
    @staticmethod
    def _find_creds():
        try:   # the running client's own arguments are the most reliable source
            out = subprocess.run(["ps", "-A", "-o", "args"], capture_output=True, text=True, timeout=5).stdout
            for line in out.splitlines():
                if "LeagueClientUx" in line and "--app-port=" in line:
                    port = re.search(r"--app-port=(\d+)", line)
                    token = re.search(r"--remoting-auth-token=([\w-]+)", line)
                    if port and token:
                        return int(port.group(1)), token.group(1)
        except Exception:
            pass
        for path in config.LOCKFILE_PATHS:
            try:
                parts = path.read_text().split(":")
                return int(parts[2]), parts[3]
            except (OSError, IndexError, ValueError):
                continue
        raise ClientUnavailable()

    def creds(self):
        """(port, password) for the running client; raises ClientUnavailable if League isn't open."""
        with self._lock:
            if self._creds and time.time() - self._creds_at < self.CREDS_TTL:
                return self._creds
            self._creds = self._find_creds()
            self._creds_at = time.time()
            return self._creds

    def forget_creds(self):
        with self._lock:
            self._creds = None

    def auth_header(self):
        _, password = self.creds()
        return "Basic " + base64.b64encode(f"riot:{password}".encode()).decode()

    # ---- requests ----
    def _open(self, path: str, accept_json=True):
        port, _ = self.creds()
        headers = {"Authorization": self.auth_header()}
        if accept_json:
            headers["Accept"] = "application/json"
        req = urllib.request.Request(f"https://127.0.0.1:{port}{path}", headers=headers)
        try:
            with LOCAL_OPENER.open(req, timeout=15) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            raise ClientRequestError(path, e.code)
        except (urllib.error.URLError, OSError):
            self.forget_creds()   # client restarted or closed: look it up again next time
            raise ClientUnavailable()

    def get(self, path: str):
        body = self._open(path)
        return json.loads(body.decode("utf-8")) if body else None

    def get_bytes(self, path: str) -> bytes:
        return self._open(path, accept_json=False)

    def is_running(self) -> bool:
        """True if the client is open and answering (not just that its details were found recently)."""
        try:
            self.get("/lol-gameflow/v1/gameflow-phase")
            return True
        except ClientUnavailable:
            return False
        except ClientRequestError:
            return True   # it answered, just not with a phase (e.g. still logging in)

    # ---- who's logged in, and who is who ----
    def current_summoner(self) -> dict:
        return self.get("/lol-summoner/v1/current-summoner") or {}

    def current_riot_id(self) -> str:
        me = self.current_summoner()
        return f'{me.get("gameName")}#{me.get("tagLine")}' if me.get("gameName") else ""

    def puuid_for(self, riot_id: str) -> str:
        """The client's own ID for a player (Riot's web API uses different, encrypted IDs)."""
        key = riot_id.lower()
        if key in self._puuids:
            return self._puuids[key]
        me = self.current_summoner()
        if same_riot_id(me, riot_id):
            self._puuids[key] = me["puuid"]
            return me["puuid"]
        name, _, tag = riot_id.rpartition("#")
        q = urllib.parse.quote
        for path in (f"/lol-summoner/v1/alias/lookup?gameName={q(name.strip())}&tagLine={q(tag.strip())}",
                     f"/lol-summoner/v1/summoners?name={q(riot_id)}"):
            try:
                r = self.get(path)
                if isinstance(r, dict) and r.get("puuid"):
                    self._puuids[key] = r["puuid"]
                    return r["puuid"]
            except ClientRequestError:
                pass
        raise ClientRequestError(f"/lol-summoner (looking up {riot_id})", 404)

    def ensure_champions(self) -> ChampionCatalog:
        """Champion names from the client; with League closed, from the copy saved last time (or Data Dragon)."""
        if self.champions:
            return self.champions
        try:
            summary = self.get("/lol-game-data/assets/v1/champion-summary.json")
            if summary and self.champion_cache:
                self.champion_cache.parent.mkdir(parents=True, exist_ok=True)
                self.champion_cache.write_text(json.dumps(summary))
        except ClientUnavailable:
            summary = None
            try:
                summary = json.loads(self.champion_cache.read_text()) if self.champion_cache else None
            except (OSError, ValueError):
                pass
            if not summary:
                summary = self._data_dragon_champions()
        self.champions.load(summary)
        return self.champions

    @staticmethod
    def _data_dragon_champions() -> list:
        try:
            req = lambda u: json.loads(urllib.request.urlopen(
                urllib.request.Request(u, headers={"User-Agent": config.USER_AGENT}), timeout=15).read())
            version = req("https://ddragon.leagueoflegends.com/api/versions.json")[0]
            data = req(f"https://ddragon.leagueoflegends.com/cdn/{version}/data/en_US/champion.json")["data"]
            return [{"id": int(c["key"]), "alias": c["id"], "name": c["name"], "roles": c.get("tags") or []}
                    for c in data.values()]
        except Exception:
            return []

    # ---- match history ----
    def match_history(self, puuid: str, beg: int, end: int) -> list:
        data = self.get(f"/lol-match-history/v1/products/lol/{puuid}/matches?begIndex={beg}&endIndex={end}") or {}
        return (data.get("games") or {}).get("games") or []

    def game(self, game_id) -> dict:
        """Full details of one game, with all ten players."""
        return self.get(f"/lol-match-history/v1/games/{game_id}")

    # ---- game flow ----
    def phase(self) -> str:
        return self.get("/lol-gameflow/v1/gameflow-phase") or "None"

    def session(self) -> dict:
        return self.get("/lol-gameflow/v1/session") or {}

    def champ_select(self) -> dict:
        return self.get("/lol-champ-select/v1/session") or {}

    def end_of_game_stats(self) -> dict:
        return self.get("/lol-end-of-game/v1/eog-stats-block") or {}

    # ---- chat ----
    def conversations(self) -> list:
        return self.get("/lol-chat/v1/conversations") or []

    def messages(self, conversation_id: str) -> list:
        return self.get(f"/lol-chat/v1/conversations/{urllib.parse.quote(str(conversation_id), safe='')}/messages") or []

    # ---- mastery and rank ----
    def mastery_entries(self) -> dict:
        """The logged-in player's mastery, champion id -> entry. The client keeps two copies; the plain list
        can be hours behind after a game, so whichever entry was played most recently wins."""
        entries = {}
        sources = (("/lol-champion-mastery/v1/local-player/champion-mastery-sets-and-rewards",
                    lambda r: r.get("championMasteries") if isinstance(r, dict) else None),
                   ("/lol-champion-mastery/v1/local-player/champion-mastery", lambda r: r))
        for path, pick in sources:
            try:
                for e in pick(self.get(path)) or []:
                    cid = str(e.get("championId"))
                    if cid not in entries or (e.get("lastPlayTime") or 0) > (entries[cid].get("lastPlayTime") or 0):
                        entries[cid] = e
            except ClientRequestError:
                continue
        return entries

    def ranks(self, puuid: str) -> dict:
        """Ranked Solo/Flex in the same shape as Riot's web API ({} if the client won't say)."""
        data = self.get(f"/lol-ranked/v1/ranked-stats/{puuid}") or {}
        out = {}
        for queue, e in (data.get("queueMap") or {}).items():
            tier = str(e.get("tier") or "")
            if tier and tier not in ("NONE", "UNRANKED"):
                out[queue] = {"tier": tier, "rank": e.get("division") or e.get("rank") or "",
                              "leaguePoints": e.get("leaguePoints", 0), "wins": e.get("wins", 0),
                              "losses": e.get("losses", 0)}
        return out


class LiveGame:
    """The in-game Live Client Data API, served by the game itself while a game is loaded."""

    @staticmethod
    def get(path: str):
        req = urllib.request.Request(config.LIVE_GAME_URL + path)
        with LOCAL_OPENER.open(req, timeout=3) as r:
            return json.loads(r.read().decode("utf-8"))

    def players(self) -> list:
        return self.get("playerlist")
