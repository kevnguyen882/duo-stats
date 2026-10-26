"""Settings that don't change while the app runs: where things live, ports, region hosts."""

from __future__ import annotations

import os
from pathlib import Path

PORT = int(os.environ.get("DUO_STATS_PORT", "8765"))

# the project folder (the one with duo_stats.py in it)
PROJECT_DIR = Path(__file__).resolve().parent.parent

# everything the app saves lives here
DATA_DIR = Path(os.environ.get("DUO_STATS_DATA", str(PROJECT_DIR / "data")))

# the web page (index.html, style.css, js/)
WEB_DIR = PROJECT_DIR / "web"

USER_AGENT = "duo-stats/2.0"

# region label -> (platform host, regional routing host) for Riot's web API
REGIONS = {
    "NA": ("na1", "americas"), "BR": ("br1", "americas"), "LAN": ("la1", "americas"),
    "LAS": ("la2", "americas"), "EUW": ("euw1", "europe"), "EUNE": ("eun1", "europe"),
    "TR": ("tr1", "europe"), "RU": ("ru", "europe"), "ME": ("me1", "europe"),
    "KR": ("kr", "asia"), "JP": ("jp1", "asia"), "OCE": ("oc1", "sea"),
    "PH": ("ph2", "sea"), "SG": ("sg2", "sea"), "TH": ("th2", "sea"),
    "TW": ("tw2", "sea"), "VN": ("vn2", "sea"),
}

# where the League client keeps its connection details when it can't be found in the process list
LOCKFILE_PATHS = [
    Path("/Applications/League of Legends.app/Contents/LoL/lockfile"),
    Path.home() / "Applications/League of Legends.app/Contents/LoL/lockfile",
    Path("C:/Riot Games/League of Legends/lockfile"),
]

# the in-game Live Client Data API (only up while a game is loaded)
LIVE_GAME_URL = "https://127.0.0.1:2999/liveclientdata/"

# public copies of game data, used when the League client is closed
CDRAGON = "https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/"

# augment descriptions (CC BY-SA 3.0), read from the wiki's normal public page every few days
WIKI_AUGMENTS_URL = "https://wiki.leagueoflegends.com/en-us/ARAM:_Mayhem/Augments"
WIKI_REFRESH_DAYS = 3

KEYCHAIN_SERVICE = "duo-stats-riot-api-key"

# phases of the client's "gameflow"
PHASES_PICKING = ("ChampSelect",)
PHASES_IN_GAME = ("GameStart", "InProgress", "Reconnect")
PHASES_POST_GAME = ("WaitingForStats", "PreEndOfGame", "EndOfGame")
