#!/usr/bin/env python3
"""
Duo Stats: compare your League of Legends stats with your duo partner's, for the games you play together.

Run:    python3 duo_stats.py
Then:   your browser opens http://localhost:8765  (press Ctrl+C in Terminal to stop)

While it runs, the app listens to the League client on this Mac and saves every game you
play, plus the S grades announced in the post-game chat. A Riot API key is optional: add
one in Options to also load games from Riot's servers when League isn't open.

Everything is saved in the data/ folder next to this file. Only uses Python's standard library.

How the code is organised (duostats/):
    app.py            puts the pieces together and starts everything
    server.py         the local web server for the page
    tracker.py        the background listener that saves games as you play
    events.py         the League client's event stream (a small WebSocket client)
    league_client.py  talking to the League client
    riot_api.py       talking to Riot's web API (optional)
    games.py          turning saved games into rows for the page
    stats.py          building the stats the page shows
    players.py        working out who the players are
    season.py         season-best grades (S Rank Challenge)
    chat.py           reading S grades from the post-game chat
    live.py           which champion you're on right now
    augments.py       augment names, icons and descriptions
    ugg.py            opening u.gg build pages
    utopia.py         Duck Utopia, the idle game
    storage.py        everything saved on this Mac
    keychain.py       the Riot API key in the macOS Keychain
    grades.py, config.py, errors.py   small shared helpers
The page itself is in web/ (index.html, style.css and js/, one file per tab).
"""

import sys
from pathlib import Path

if sys.version_info < (3, 8):
    sys.exit("Duo Stats needs Python 3.8 or newer.")

sys.path.insert(0, str(Path(__file__).resolve().parent))

from duostats.app import main  # noqa: E402

if __name__ == "__main__":
    main()
