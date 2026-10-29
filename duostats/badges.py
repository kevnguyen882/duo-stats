"""Badges: standout moments in a game (huge damage, a near-perfect KDA...). The rules live here and only here: the app
attaches each game's badges to the rows it sends (attach(), attach_match()), with what each one means for that game,
and sends the catalogue (catalog()) for the Badges tab. The page just shows them (web/js/badges.js).

Multikills are badges too, one per game per kind: 2 pentas and a quadra in a game earn one Pentakill badge (×2) and
one Quadra Kill. Percentages are compared as the page shows them (rounded), so 89.8% kill participation shown as 90%
counts. Duo badges (Twin Carries, Killing Machines) need both of you on the same team, and go to each of you.
Personal Best is the player's highest damage among the games the page has loaded.
"""

from __future__ import annotations

import math


def _n(x: dict, k: str):
    return x.get(k) or 0


def _kda(x: dict) -> float:
    return (_n(x, "kills") + _n(x, "assists")) / max(_n(x, "deaths"), 1)


def _shown(v, scale: int) -> int:
    """A number as the page shows it, rounded like JavaScript's Math.round (89.8% kill participation counts as 90%)."""
    return math.floor((v or 0) * scale + 0.5)


def _f0(v) -> str:
    return f"{math.floor(v + 0.5):,}"


def _pct(v) -> str:
    return f"{_shown(v, 100)}%"


def _times(n: int, word: str) -> str:
    return f"{n} {word}{'s' if n > 1 else ''} in one game."


# id, icon, name, how to earn it (for the Badges tab),
#   earned?(game row, best damage, duo partner's row in the same game or None),
#   what it means for this game(row, whose, partner's row), how many that game had (multikills only)
BADGES = [
    ("best", "🏆", "Personal Best", "Your highest damage to champions in any saved game.",
     lambda x, best, mate: bool(best) and _n(x, "damage") >= best and _n(x, "damage") > 0,
     lambda x, who, mate: f"{_f0(_n(x, 'damage'))} damage: {who} highest damage to champions in any saved game.", None),
    ("sixfig", "💥", "Six Figures", "Deal 100,000 or more damage to champions.",
     lambda x, best, mate: _n(x, "damage") >= 100000,
     lambda x, who, mate: f"Dealt {_f0(_n(x, 'damage'))} damage to champions (100,000 or more).", None),
    ("untouch", "🛡️", "Untouchable", "Finish with a KDA of 8 or better.",
     lambda x, best, mate: _shown(_kda(x), 10) >= 80,
     lambda x, who, mate: f"A KDA of {_shown(_kda(x), 10) / 10:.1f} (8 or better).", None),   # 8.25 shows as 8.3, as on the page
    ("everywhere", "🌐", "Everywhere", "Take part in 90% or more of your team's kills.",
     lambda x, best, mate: _shown(x.get("kp"), 100) >= 90,
     lambda x, who, mate: f"In on {_pct(x.get('kp'))} of the team's kills (90% or more).", None),
    ("carry", "🔥", "Hard Carry", "Deal 40% or more of your team's damage.",
     lambda x, best, mate: _shown(x.get("dmgShare"), 100) >= 40,
     lambda x, who, mate: f"Dealt {_pct(x.get('dmgShare'))} of the team's damage (40% or more).", None),
    ("spree", "☠️", "Killing Spree", "Get 30 or more kills.",
     lambda x, best, mate: _n(x, "kills") >= 30,
     lambda x, who, mate: f"{_n(x, 'kills')} kills in one game (30 or more).", None),
    ("playmaker", "🤝", "Playmaker", "Get 50 or more assists.",
     lambda x, best, mate: _n(x, "assists") >= 50,
     lambda x, who, mate: f"{_n(x, 'assists')} assists in one game (50 or more).", None),
    ("marathon", "⏳", "Marathon", "Play a game that lasts 30 minutes or more.",
     lambda x, best, mate: _n(x, "duration") >= 1800,
     lambda x, who, mate: f"A {_n(x, 'duration') // 60}-minute game (30 minutes or more).", None),
    ("lifeline", "🩹", "Lifeline", "Heal 25,000 or more in a game.",
     lambda x, best, mate: _n(x, "heal") >= 25000,
     lambda x, who, mate: f"Healed {_f0(_n(x, 'heal'))} (25,000 or more).", None),
    ("wall", "🧱", "Brick Wall", "Block or reduce 120,000 or more damage with armor, magic resist and shields.",
     lambda x, best, mate: _n(x, "mitigated") >= 120000,
     lambda x, who, mate: f"Blocked or reduced {_f0(_n(x, 'mitigated'))} damage (120,000 or more).", None),
    ("crit", "💢", "Big Crit", "Land a single critical strike of 1,500 or more.",
     lambda x, best, mate: _n(x, "crit") >= 1500,
     lambda x, who, mate: f"A {_f0(_n(x, 'crit'))} critical strike (1,500 or more).", None),
    ("unstoppable", "🌪️", "Unstoppable", "Get 8 or more kills in a row without dying.",
     lambda x, best, mate: _n(x, "spree") >= 8,
     lambda x, who, mate: f"{_n(x, 'spree')} kills in a row without dying (8 or more).", None),
    ("midas", "💰", "Gold Digger", "Earn 25,000 or more gold in a game.",
     lambda x, best, mate: _n(x, "gold") >= 25000,
     lambda x, who, mate: f"Earned {_f0(_n(x, 'gold'))} gold (25,000 or more).", None),
    ("twins", "👯", "Twin Carries", "Both of you deal 70,000 or more damage in the same game.",
     lambda x, best, mate: bool(mate) and _n(x, "damage") >= 70000 and _n(mate, "damage") >= 70000,
     lambda x, who, mate: f"Both of you dealt 70,000+ damage: {_f0(_n(x, 'damage'))} and {_f0(_n(mate, 'damage'))}.", None),
    ("killers", "🔪", "Killing Machines", "Both of you get 20 or more kills in the same game.",
     lambda x, best, mate: bool(mate) and _n(x, "kills") >= 20 and _n(mate, "kills") >= 20,
     lambda x, who, mate: f"Both of you got 20+ kills: {_n(x, 'kills')} and {_n(mate, 'kills')}.", None),
    ("penta", "👑", "Pentakill", "Get a pentakill.",
     lambda x, best, mate: _n(x, "pentas") > 0, lambda x, who, mate: _times(_n(x, "pentas"), "pentakill"), "pentas"),
    ("quadra", "⚔️", "Quadra Kill", "Get a quadra kill.",
     lambda x, best, mate: _n(x, "quadras") > 0, lambda x, who, mate: _times(_n(x, "quadras"), "quadra kill"), "quadras"),
    ("triple", "🗡️", "Triple Kill", "Get a triple kill.",
     lambda x, best, mate: _n(x, "triples") > 0, lambda x, who, mate: _times(_n(x, "triples"), "triple kill"), "triples"),
]
BADGE_INFO = {bid: (icon, name) for bid, icon, name, *_ in BADGES}


def catalog() -> list:
    """Every badge, in the usual order, for the Badges tab."""
    return [{"id": bid, "ic": icon, "name": name, "how": how} for bid, icon, name, how, *_ in BADGES]


def game_badges(x: dict, best: float = 0, mate: dict | None = None, name: str = "") -> list:
    """The badges one game earned (none for a remake): {id, ic, name, what it means for this game, multi: how many of
    that multikill the game had (0 when just one)}. name: whose game, for Personal Best's wording."""
    if x.get("remake"):
        return []
    who = f"{name}'s" if name else "their"
    out = []
    for bid, icon, bname, _, earned, what, count in BADGES:
        if earned(x, best, mate):
            n = _n(x, count) if count else 1
            out.append({"id": bid, "ic": icon, "name": bname, "what": what(x, who, mate), "multi": n if n > 1 else 0})
    return out


def best_damage(rows: dict) -> dict:
    """{player key: highest damage in a non-remake game}, from {player key: game rows}."""
    return {k: max([_n(r, "damage") for r in rs if not r.get("remake")] or [0]) for k, rs in rows.items()}


def _mates(rows: dict) -> dict:
    """{player key: (the other player's rows by game, or None)}; duo badges need your partner's row in the same game."""
    by_game = {k: {r["matchId"]: r for r in rs} for k, rs in rows.items()}
    return {k: next((by_game[o] for o in rows if o != k), None) for k in rows}


def attach(rows: dict, names: dict):
    """Each game row's badges, as its "badges". rows: {player key: game rows}; names: {player key: short name}."""
    best, mates = best_damage(rows), _mates(rows)
    for k, rs in rows.items():
        for r in rs:
            mate = mates[k].get(r["matchId"]) if mates[k] is not None and r.get("withDuo") else None
            r["badges"] = game_badges(r, best[k], mate, names.get(k, ""))


def attach_match(detail: dict, best: dict):
    """Badges for everyone in a match detail (games.match_detail). best: {Riot ID, lowercase: best damage}, for the
    tracked players; everyone else can't earn Personal Best. Duo badges go to tracked players on the same team."""
    for t in detail["teams"]:
        for r in t["players"]:
            x = dict(r, duration=detail["duration"], remake=detail["remake"])
            mate = next((o for o in t["players"] if o["player"] is not None and o["player"] != r["player"]), None) \
                if r["player"] is not None else None
            r["badges"] = game_badges(x, best.get((r.get("riotId") or "").lower(), 0), mate, r.get("name") or "")


def badge_counts(rows: dict) -> dict:
    """{player key: {badge id: how many games earned it}}, from {player key: game rows} (each player's games together)."""
    best, mates = best_damage(rows), _mates(rows)
    out = {}
    for k, rs in rows.items():
        counts = {}
        for r in rs:
            mate = mates[k].get(r["matchId"]) if mates[k] is not None and r.get("withDuo") else None
            for b in game_badges(r, best[k], mate):
                counts[b["id"]] = counts.get(b["id"], 0) + 1
        out[k] = counts
    return out
