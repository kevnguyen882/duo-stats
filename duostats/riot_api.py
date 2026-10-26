"""Riot's web API: an optional fallback for when the League client isn't open, and for older games."""

from __future__ import annotations

import json
import re
import ssl
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

from . import config
from .errors import RiotApiError

KEY_FORMAT = re.compile(r"RGAPI-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")

_FRIENDLY = {
    400: "Riot rejected the request (400). Check the Riot ID and region.",
    401: "Riot didn't recognize this API key (401). Usually the key was cut off when copying, or it was "
         "regenerated after you copied it. Copy the current key from developer.riotgames.com again.",
    403: "Riot rejected your API key. Dev keys expire every 24 hours, so grab a fresh one from developer.riotgames.com.",
    404: "Not found. Double-check the Riot ID (Name#TAG) and the region.",
}


def clean_key(text: str) -> str:
    """Drop spaces, quotes and invisible characters picked up while copying."""
    return re.sub(r"[^A-Za-z0-9-]", "", str(text or ""))


class RiotApi:
    MIN_GAP = 0.06   # stay under 20 requests / second

    def __init__(self, key: str = ""):
        self.key = key
        self._lock = threading.Lock()
        self._last_call = 0.0
        self._accounts = {}

    @property
    def available(self) -> bool:
        return bool(self.key)

    # ---- low level ----
    def _request(self, url: str):
        req = urllib.request.Request(url, headers={"X-Riot-Token": self.key, "User-Agent": config.USER_AGENT})
        with urllib.request.urlopen(req, timeout=20) as r:
            return json.loads(r.read().decode("utf-8"))

    def get(self, url: str):
        """GET a Riot API URL, pacing requests and waiting out rate limits."""
        if not self.key:
            raise RiotApiError("No Riot API key is set.")
        for _ in range(6):
            with self._lock:
                gap = time.time() - self._last_call
                if gap < self.MIN_GAP:
                    time.sleep(self.MIN_GAP - gap)
                self._last_call = time.time()
            try:
                return self._request(url)
            except urllib.error.HTTPError as e:
                if e.code == 429:   # rate limited: wait as long as Riot asks
                    try:
                        wait = int(e.headers.get("Retry-After") or 10)
                    except ValueError:
                        wait = 10
                    print(f"  rate limited by Riot, waiting {wait}s...")
                    time.sleep(wait + 0.5)
                    continue
                if e.code in (500, 502, 503, 504):
                    time.sleep(2)
                    continue
                detail = ""
                try:
                    detail = json.loads(e.read().decode("utf-8")).get("status", {}).get("message", "")
                except Exception:
                    pass
                raise RiotApiError(_FRIENDLY.get(e.code, f"Riot API error ({e.code}).")
                                   + (f' (Riot said: "{detail}")' if detail else ""))
            except urllib.error.URLError as e:
                if isinstance(getattr(e, "reason", None), ssl.SSLCertVerificationError):
                    raise RiotApiError(
                        "Python couldn't verify Riot's SSL certificate. If you installed Python from python.org, "
                        "open Applications > Python 3.x and run 'Install Certificates.command', "
                        "or run this app with /usr/bin/python3 instead.")
                raise RiotApiError(f"Couldn't reach Riot's servers: {e.reason}")
        raise RiotApiError("Riot kept rate-limiting the requests. Wait a minute and try again.")

    @staticmethod
    def hosts(region: str):
        platform, regional = config.REGIONS.get(region, config.REGIONS["NA"])
        account = "asia" if regional == "sea" else regional
        return platform, regional, account

    # ---- endpoints ----
    def check_key(self, key: str):
        """Raises RiotApiError if Riot won't accept this key."""
        old = self.key
        self.key = key
        try:
            self.get("https://na1.api.riotgames.com/lol/status/v4/platform-data")
        except RiotApiError:
            self.key = old
            raise

    def account(self, riot_id: str, region: str) -> dict:
        name, _, tag = riot_id.rpartition("#")
        _, _, host = self.hosts(region)
        k = (host, riot_id.lower())
        if k not in self._accounts:
            q = urllib.parse.quote
            self._accounts[k] = self.get(f"https://{host}.api.riotgames.com/riot/account/v1/accounts/"
                                         f"by-riot-id/{q(name.strip())}/{q(tag.strip())}")
        return self._accounts[k]

    def match_ids(self, puuid: str, region: str, count: int, queue=None) -> list:
        _, regional, _ = self.hosts(region)
        ids = []
        for start in range(0, count, 100):   # Riot returns at most 100 match IDs per request
            params = {"start": start, "count": min(100, count - start)}
            if queue:
                params["queue"] = int(queue)
            page = self.get(f"https://{regional}.api.riotgames.com/lol/match/v5/matches/by-puuid/"
                            f"{puuid}/ids?{urllib.parse.urlencode(params)}") or []
            ids.extend(page)
            if len(page) < params["count"]:
                break
        return ids

    def match(self, match_id: str, region: str) -> dict:
        _, regional, _ = self.hosts(region)
        return self.get(f"https://{regional}.api.riotgames.com/lol/match/v5/matches/{match_id}")

    def ranks(self, puuid: str, region: str) -> dict:
        platform, _, _ = self.hosts(region)
        entries = self.get(f"https://{platform}.api.riotgames.com/lol/league/v4/entries/by-puuid/{puuid}") or []
        return {e.get("queueType"): {k: e.get(k) for k in ("tier", "rank", "leaguePoints", "wins", "losses")}
                for e in entries if isinstance(e, dict)}

    def mastery(self, puuid: str, region: str) -> list:
        platform, _, _ = self.hosts(region)
        return self.get(f"https://{platform}.api.riotgames.com/lol/champion-mastery/v4/"
                        f"champion-masteries/by-puuid/{puuid}") or []
