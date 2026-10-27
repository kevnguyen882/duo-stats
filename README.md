# Duo Stats

Compare your League of Legends stats with your duo partner's, for the games you play together.

## Running it

```
python3 duo_stats.py
```

Your browser opens the page. Leave the Terminal window open while you play: the app listens to the
League client in the background and saves every game, plus the S grades announced in the post-game
chat. Press Ctrl+C in Terminal to stop it.

### Sharing it on your network

To let your duo partner open it from their own computer on the same Wi-Fi (nothing to install on theirs):

```
python3 duo_stats.py --lan --pin 1234
```

Terminal prints the address to give them (like `http://your-mac.local:8765`). They enter the PIN once in their
browser. From another computer the page is view only: settings, the Riot key and u.gg auto-opening can only be
changed on the Mac running the app. `--pin` is optional but recommended. If macOS asks whether Python may accept
incoming connections, choose Allow. Your Mac needs to be awake with the app running for them to reach it.

A Riot API key is optional. Add one in Options to also load games from Riot's servers (older games,
and games played while the app wasn't running).

Everything is saved in the `data/` folder inside the project. Only Python's standard library is used.

## Tests

From the project folder:

```
python3 -m unittest
node tests/js/run.js
```

The first runs the Python tests (Python's built-in `unittest`), the second the page's badge and score rules (plain Node,
no packages). Neither needs League open, a Riot key or the internet, and neither reads or changes your `data/` folder:
the tests use small made-up games (`tests/helpers.py`) and a pretend League client.

## How the code is organised

| File | What it does |
|---|---|
| `duo_stats.py` | Starts the app |
| `duostats/app.py` | Puts the pieces together |
| `duostats/server.py` | The local web server for the page |
| `duostats/access.py` | Who's asking (this Mac or another computer on the network) and the optional PIN |
| `duostats/tracker.py` | The background listener that saves games as you play |
| `duostats/events.py` | The League client's event stream (a small WebSocket client) |
| `duostats/league_client.py` | Talking to the League client |
| `duostats/riot_api.py` | Talking to Riot's web API (optional) |
| `duostats/games.py` | Turning saved games into rows for the page |
| `duostats/stats.py` | Building the stats the page shows |
| `duostats/players.py` | Working out who the players are |
| `duostats/season.py` | Season-best grades for the S Rank Challenge |
| `duostats/chat.py` | Reading S grades from the post-game chat |
| `duostats/live.py` | Which champion you're on right now |
| `duostats/augments.py` | Augment names, icons and descriptions |
| `duostats/ugg.py` | Opening u.gg build pages |
| `duostats/utopia.py` | Duck Utopia, the idle game: its rules, raids and saved state (`data/utopia.json`) |
| `duostats/storage.py` | Everything saved on this Mac |
| `duostats/keychain.py` | The Riot API key in the macOS Keychain |
| `duostats/grades.py`, `config.py`, `errors.py` | Small shared helpers |
| `web/index.html`, `web/style.css` | The page and its look |
| `web/utopia.html`, `web/utopia.css`, `web/js/utopia.js` | The Duck Utopia page (opened from the link at the top, or `/utopia`) |
| `web/js/utopia-art.js` | Duck Utopia's placeholder pixel art; a PNG with the same name in `web/img/utopia/` replaces each one |
| `web/js/` | The page's code, one file per tab (`overview.js`, `live.js`, `srank.js`, ...) |
| `tests/` | The tests: one `test_*.py` file per part of the app, and `js/` for the page's badge and score rules |
