"""Ductopia (first called Duck Utopia, then Ducktopia): an idle duck-city race, powered by the games you play together (see the design doc).

Each tracked player has a utopia, kept in data/utopia.json. Everything is worked out on this Mac so both of you see
the same race, and it's brought up to date whenever the page asks: idle breadcrumbs are counted from the time that
passed, so nothing runs in the background.

  Founding Day  the first time, each player's saved games together are replayed: every triple / quadra is a
                permanent breadcrumb boost, every pentakill a golden duck, every S- or S a champion duck and every
                S+ a fire duck. The pond starts with STARTING_DUCKS ducks.
  each new game together, after that
                a win gives bonus breadcrumbs, the badges give their rewards, and geese raid both utopias. Your five
                defenders fight them automatically.

The duck pipeline: new ducks come from the Duck Infirmary, a lab whose nests are fluid chambers. You spawn a
duckling into a free nest for breadcrumbs (spawn_cost(), a little more after each one; never while the nests are
full). It grows there for grow_minutes(), then moves to the pond, or waits at its edge if it's full. Only ducks in
the pond collect breadcrumbs (golden, champion and fire ducks collect wherever they are). The infirmary's upgrades:
more nests, and a shorter incubation time. Wins used to give ducklings; any still in the old lost and found box move
to nests.

The Champion Quarter is a lounge where your five defenders rest; there you can see each one's stats and buy it hats
(just for looks: HATS). Hats belong to the champion, so they stay if it leaves the squad and comes back.
The Volcano Spa is where the fire ducks soak, one for each game with an S+ (volcano_spa()).

First version: the numbers below are guesses to see how it plays, and are meant to be tuned.
"""

from __future__ import annotations

import math
import random
import threading

from .grades import grade_rank, now_ms

# ---- tuning ----
FOUNDING_GIFT = 300          # breadcrumbs to start with, so there's a first choice to make straight away
STARTING_DUCKS = 5           # ducks in the pond to start with (it holds 5 at level 1)
FRESH_START = 2              # data version: utopias saved before this start over once (see fresh_start)
DUCK_RATE = 1.0              # breadcrumbs a minute for each duck in the pond
GOLDEN_RATE = 3.0            # ... for each golden duck (pentakills)
CHAMPION_RATE = 1.5          # ... for each champion duck (S- or S on a champion)
FIRE_RATE = 2.0              # ... for each fire duck (S+)
BAKERY_BONUS = 0.25          # +25% breadcrumbs per bakery level
TRIPLE_BOOST, QUADRA_BOOST = 0.005, 0.015   # permanent breadcrumb boost per triple / quadra kill
GROW_MINUTES = 8 * 60        # how long a duckling takes to grow in its nest, before incubation upgrades
INCUBATION_SPEEDUP = 0.8     # each incubation time level: 20% less time in the nest
SPAWN_COST = 100             # breadcrumbs for the first duckling spawned ...
SPAWN_GROWTH = 1.05          # ... and 5% more for each one after (slow at first, then steep)
WIN_CRUMBS = 100              # bonus breadcrumbs for a new win (catch-up boost applies)
MAX_REPORTS, MAX_LOG = 10, 30

# hat -> (name, breadcrumbs), cheapest first
HATS = {
    "cap": ("Baseball cap", 200), "beanie": ("Beanie", 300), "party": ("Party hat", 500), "flowers": ("Flower crown", 700),
    "cowboy": ("Cowboy hat", 1000), "tophat": ("Top hat", 1500), "chef": ("Chef's hat", 2000), "viking": ("Viking helmet", 3000),
    "wizard": ("Wizard hat", 4500), "crown": ("Royal crown", 8000),
}

# building -> (first cost, cost growth per level, highest level, names by level)
BUILDINGS = {
    "nests":  (300, 1.7, 12, [(1, "Nests")]),   # in the Duck Infirmary
    "pond":   (400, 1.8, 12, [(1, "Pond"), (4, "Lake"), (7, "Lagoon")]),
    "bakery": (500, 1.9, 10, [(1, "Bakery")]),
    "spa":    (20000, 4.0, 2, [(1, "Spa"), (2, "Hot springs")]),
    "fence":  (600, 1.7, 9, [(1, "Fences"), (4, "Scarecrows"), (7, "Honk-proof walls")]),
    "incubation": (500, 2.0, 10, [(1, "Incubation time")]),   # in the Duck Infirmary
}
START_LEVELS = {"nests": 1, "pond": 1, "bakery": 0, "spa": 0, "fence": 0, "incubation": 0}


def grow_minutes(level: int) -> float:
    return GROW_MINUTES * INCUBATION_SPEEDUP ** level     # 8 h, 6 h 24, 5 h 7 ... 51 min at level 10


def spawn_cost(spawned: int) -> int:
    return round(SPAWN_COST * SPAWN_GROWTH ** spawned)    # 100, 105, 110 ... 163 for the 11th, 1,147 for the 51st


def nest_space(level: int) -> int:
    return 2 + 2 * level


def pond_space(level: int) -> int:
    return 5 * level * (level + 1) // 2   # 5, 15, 30, 50 ...


def upgrade_cost(building: str, level: int):
    """Breadcrumbs to go from `level` to the next one; None at the top."""
    first, growth, top, _ = BUILDINGS[building]
    start = START_LEVELS[building]
    return None if level >= top else round(first * growth ** (level - start))


def building_name(building: str, level: int) -> str:
    names = BUILDINGS[building][3]
    return next((n for lvl, n in reversed(names) if level >= lvl), names[0][1])


# ---- the race ----
def score(s: dict) -> int:
    """The Ductopia Score: ducks, buildings, districts and raid wins."""
    ducks = s["pond"] + s["edge"] + len(s["ducklings"]) + s["lost"]
    lv = s["levels"]
    return (10 * ducks + 50 * s["golden"] + 40 * len(s["champs"]) + 50 * s["fire"]
            + 20 * (lv["nests"] + lv["pond"]) + 25 * lv["bakery"] + 60 * lv["spa"] + 15 * lv["fence"]
            + 100 * len(districts(s)) + 30 * s["raidWins"])


def districts(s: dict) -> list:
    """Districts unlocked by real achievements only."""
    out = []
    if s["golden"]:
        out.append("penta")
    if s["champs"]:
        out.append("champion")
    if s["fire"]:
        out.append("volcano")
    return out


def catch_up(mine: int, best: int) -> float:
    """The trailing player's boost on rewards from new games: nothing for a small gap, x1.25 at 10% behind, up to x2."""
    if best <= 0 or mine >= best:
        return 1.0
    gap = (best - mine) / best
    if gap < 0.1:
        return 1.0
    return round(1.25 + min((gap - 0.1) / 0.4, 1) * 0.75, 2)


def crumb_rate(s: dict) -> float:
    """Breadcrumbs a minute."""
    base = (s["pond"] * DUCK_RATE + s["golden"] * GOLDEN_RATE + len(s["champs"]) * CHAMPION_RATE
            + s["fire"] * FIRE_RATE)
    return base * (1 + BAKERY_BONUS * s["levels"]["bakery"]) * (1 + s["boost"])


# ---- the duck pipeline over time ----
def advance(s: dict, now: int):
    """Bring a utopia up to `now`: breadcrumbs collected, ducklings grown and into the pond."""
    t = s["tick"]
    while True:
        _fill_nests(s, t)
        due = min(s["ducklings"]) if s["ducklings"] else None
        end = due if due is not None and due <= now else now
        s["crumbs"] += crumb_rate(s) * max(0, end - t) / 60000
        t = end
        if due is None or due > now:
            break
        for _ in [r for r in s["ducklings"] if r <= t]:
            if s["pond"] < pond_space(s["levels"]["pond"]):
                s["pond"] += 1
            else:
                s["edge"] += 1
        s["ducklings"] = [r for r in s["ducklings"] if r > t]
    s["tick"] = max(s["tick"], now)


def _fill_nests(s: dict, t: int):
    """Ducklings from the old lost and found box (from when wins gave ducklings) into free nests."""
    take = max(0, min(nest_space(s["levels"]["nests"]) - len(s["ducklings"]), s["lost"]))
    if take:
        s["lost"] -= take
        s["ducklings"] += [t + round(grow_minutes(s["levels"]["incubation"]) * 60000)] * take


def migrate(s: dict):
    """Utopias saved before the Duck Infirmary, or its first version (which hatched ducklings on a timer)."""
    for b in ("incubator", "serum"):
        s["levels"].pop(b, None)
    for b, lvl in START_LEVELS.items():
        s["levels"].setdefault(b, lvl)
    s["lost"] += s.pop("held", 0)
    s.pop("nextSpawn", None)
    s.setdefault("spawned", 0)
    s.setdefault("hats", {})


def _fill_pond(s: dict):
    take = max(0, min(pond_space(s["levels"]["pond"]) - s["pond"], s["edge"]))
    s["pond"] += take
    s["edge"] -= take


def boost_breakdown(s: dict, rows: list) -> dict:
    """Where the multikill boost came from: the games behind it, by kind, by champion, and the latest ones."""
    counted = set(s["games"])
    games = [r for r in rows if r["matchId"] in counted and not r.get("remake") and (r.get("triples") or r.get("quadras"))]
    triples = sum(r.get("triples") or 0 for r in games)
    quadras = sum(r.get("quadras") or 0 for r in games)
    champs = {}
    for r in games:
        c = champs.setdefault(r["champion"], {"champion": r["champion"], "triples": 0, "quadras": 0})
        c["triples"] += r.get("triples") or 0
        c["quadras"] += r.get("quadras") or 0
    for c in champs.values():
        c["boost"] = round(TRIPLE_BOOST * c["triples"] + QUADRA_BOOST * c["quadras"], 4)
    since = [r for r in games if (r.get("start") or 0) >= s["founded"]]
    return {"triples": triples, "quadras": quadras, "perTriple": TRIPLE_BOOST, "perQuadra": QUADRA_BOOST,
            "fromTriples": round(TRIPLE_BOOST * triples, 4), "fromQuadras": round(QUADRA_BOOST * quadras, 4),
            "sinceFounding": round(sum(TRIPLE_BOOST * (r.get("triples") or 0) + QUADRA_BOOST * (r.get("quadras") or 0) for r in since), 4),
            "champions": sorted(champs.values(), key=lambda c: (-c["boost"], c["champion"]))[:5],
            "latest": [{"champion": r["champion"], "triples": r.get("triples") or 0, "quadras": r.get("quadras") or 0,
                        "start": r.get("start")} for r in sorted(games, key=lambda r: -(r.get("start") or 0))[:3]]}


def penta_plaza(s: dict, rows: list) -> list:
    """Penta Plaza's residents: one golden duck for each game with a pentakill, oldest first. A game with more than
    one pentakill makes one bigger duck (it still counts as a golden duck per pentakill for breadcrumbs and score)."""
    counted = set(s["games"])
    games = [r for r in rows if r["matchId"] in counted and not r.get("remake") and r.get("pentas")]
    return [{"matchId": r["matchId"], "champion": r["champion"], "pentas": r["pentas"], "start": r.get("start"),
             "win": bool(r.get("win")), "kills": r.get("kills") or 0, "deaths": r.get("deaths") or 0,
             "assists": r.get("assists") or 0, "grade": r.get("grade")}
            for r in sorted(games, key=lambda r: r.get("start") or 0)]


def volcano_spa(s: dict, rows: list) -> list:
    """The Volcano Spa's residents: one fire duck for each game with an S+, oldest first."""
    counted = set(s["games"])
    games = [r for r in rows if r["matchId"] in counted and not r.get("remake") and (r.get("grade") or "").upper() == "S+"]
    return [{"matchId": r["matchId"], "champion": r["champion"], "start": r.get("start"), "win": bool(r.get("win")),
             "kills": r.get("kills") or 0, "deaths": r.get("deaths") or 0, "assists": r.get("assists") or 0}
            for r in sorted(games, key=lambda r: r.get("start") or 0)]


# ---- defenders ----
CLASSES = ("tank", "mage", "marksman", "support", "fighter", "assassin")
STAR = {"S-": 1, "S": 2, "S+": 3}


def champion_records(rows: list) -> dict:
    """champion -> {games, wins, kills, deaths, assists, triples, quadras, pentas, grade} from one player's rows."""
    out = {}
    for r in rows:
        if r.get("remake"):
            continue
        c = out.setdefault(r["champion"], {"games": 0, "wins": 0, "kills": 0, "deaths": 0, "assists": 0,
                                           "triples": 0, "quadras": 0, "pentas": 0, "grade": ""})
        c["games"] += 1
        c["wins"] += 1 if r.get("win") else 0
        for k in ("kills", "deaths", "assists", "triples", "quadras", "pentas"):
            c[k] += r.get(k) or 0
        g = r.get("grade") or ""
        if g and grade_rank(g) < grade_rank(c["grade"] or "?"):
            c["grade"] = g
    return out


def defender(champion: str, rec: dict, cls: str, training: int) -> dict:
    """A champion's raid stats, from that player's own games on it."""
    level = min(rec["games"], 20)
    wr = rec["wins"] / rec["games"] if rec["games"] else 0
    kda = (rec["kills"] + rec["assists"]) / max(rec["deaths"], 1)
    star = STAR.get(rec["grade"], 0)
    boost = 1 + 0.12 * star + 0.1 * training
    hp = round((60 + 6 * level) * (0.7 + 0.6 * wr) * boost)
    return {"champion": champion, "cls": cls, "level": level, "hp": hp, "atk": round((6 + 1.2 * min(kda, 8) + 0.4 * level) * boost, 1),
            "star": star, "grade": rec["grade"], "training": training, "triples": rec["triples"], "quadras": rec["quadras"],
            "pentas": rec["pentas"], "games": rec["games"], "winRate": round(wr, 3), "kda": round(kda, 2)}


# ---- goose raids ----
GEESE = {   # type -> (health, attack, cost in the wave's budget, how many come together)
    "goose": (40, 6, 10, 1), "armoured": (80, 5, 18, 1), "goslings": (12, 2, 10, 4), "flying": (30, 8, 14, 1),
}


def goose_wave(seed, wave: int) -> list:
    """The geese in one raid. Seeded by the game, so both utopias face the same wave; bigger as more raids happen."""
    rng = random.Random(f"wave-{seed}")
    budget = min(60 + 8 * wave, 400)
    out = []
    while budget >= 10:
        kind = rng.choice([k for k, v in GEESE.items() if v[2] <= budget])
        budget -= GEESE[kind][2]
        out += [kind] * GEESE[kind][3]
    return out


def raid(defenders: list, seed, wave: int, fence: int, max_rounds: int = 15) -> dict:
    """Your squad against one goose wave, fought automatically. Returns the raid report."""
    rng = random.Random(f"fight-{seed}-{'|'.join(d['champion'] for d in defenders)}")
    kinds = goose_wave(seed, wave)
    tough = 1 + 0.03 * wave   # later waves bring tougher geese, not just more of them
    geese = [{"kind": k, "hp": GEESE[k][0] * tough, "atk": GEESE[k][1] * tough} for k in kinds]
    squad = [{**d, "max": d["hp"], "used_ult": False} for d in defenders]
    shield = min(0.06 * fence, 0.5)   # fences and walls take some of every goose's bite
    log = []
    alive = lambda xs: [x for x in xs if x["hp"] > 0]

    def hit(g, dmg, pierce=False):
        g["hp"] -= dmg * (0.5 if g["kind"] == "armoured" and not pierce else 1)

    rounds = 0
    for rounds in range(1, max_rounds + 1):
        for d in alive(squad):
            targets = alive(geese)
            if not targets:
                break
            a, cls = d["atk"], d["cls"]
            if d["pentas"] and not d["used_ult"] and rounds >= 2:
                d["used_ult"] = True
                for g in targets:
                    hit(g, a * 1.5, pierce=True)
                log.append(f"Round {rounds}: {d['champion']} used a pentakill ultimate on the whole wave!")
                continue
            multi = 4 if d["quadras"] and rng.random() < min(0.1 * d["quadras"], 0.3) else \
                3 if d["triples"] and rng.random() < min(0.1 * d["triples"], 0.3) else 0
            if multi:
                for g in rng.sample(targets, min(multi, len(targets))):
                    hit(g, a)
                log.append(f"Round {rounds}: {d['champion']} hit {min(multi, len(targets))} geese at once.")
            elif cls == "mage":
                for g in rng.sample(targets, min(3, len(targets))):
                    hit(g, a * 0.6 * (1.5 if g["kind"] == "goslings" else 1))
            elif cls == "marksman":
                hit(max(targets, key=lambda g: g["hp"]), a * 1.5, pierce=True)
            elif cls == "support":
                hurt = [x for x in alive(squad) if x["hp"] < x["max"]]
                if hurt:
                    x = min(hurt, key=lambda x: x["hp"] / x["max"])
                    x["hp"] = min(x["max"], x["hp"] + a)
                else:
                    hit(rng.choice(targets), a * 0.5)
            elif cls == "assassin":
                g = min(targets, key=lambda g: g["hp"])
                hit(g, a * 1.3 * (1.5 if g["kind"] == "flying" else 1))
            elif cls == "fighter":
                hit(rng.choice(targets), a * 1.1)
                d["hp"] = min(d["max"], d["hp"] + a * 0.2)
            else:   # tank
                hit(rng.choice(targets), a * 0.8)
            if d["star"] == 3:   # S+: a flame aura singes every goose
                for g in alive(geese):
                    g["hp"] -= 2
        down = len(geese) - len(alive(geese))
        for g in alive(geese):
            ds = alive(squad)
            if not ds:
                break
            tanks = [x for x in ds if x["cls"] == "tank"]
            if g["kind"] == "flying":   # flies over the tanks
                pool = [x for x in ds if x["cls"] != "tank"] or ds
            else:
                pool = tanks or ds
            x = rng.choice(pool)
            x["hp"] -= g["atk"] * (1 - shield)
            if x["hp"] <= 0:
                log.append(f"Round {rounds}: {x['champion']} was knocked out.")
        if not alive(geese):
            log.append(f"Round {rounds}: the last goose ran off. Utopia saved!")
            break
        if not alive(squad):
            log.append(f"Round {rounds}: every defender is down. The geese raid the pantry.")
            break
        if rounds in (1, 5, 10):
            log.append(f"Round {rounds}: {down} of {len(geese)} geese chased off so far.")
    else:
        log.append("The geese outlasted the defence and waddled off with snacks.")
    won = not alive(geese)
    counts = {}
    for k in kinds:
        counts[k] = counts.get(k, 0) + 1
    return {"win": won, "rounds": rounds, "wave": wave, "geese": counts, "chased": len(geese) - len(alive(geese)),
            "total": len(geese), "log": log[-14:],
            "squad": [{"champion": d["champion"], "cls": d["cls"], "up": d["hp"] > 0} for d in squad]}


# ---- the game ----
def new_utopia(riot_id: str, now: int) -> dict:
    return {"riotId": riot_id, "founded": now, "tick": now, "crumbs": float(FOUNDING_GIFT), "feathers": 0,
            "levels": dict(START_LEVELS), "ducklings": [], "lost": 0, "spawned": 0, "hats": {}, "pond": STARTING_DUCKS, "edge": 0,
            "golden": 0, "boost": 0.0, "champs": {}, "fire": 0, "graded": {}, "games": [], "raids": [], "raidWins": 0,
            "squad": [], "training": {}, "log": [], "founding": None}


def fresh_start(s: dict, now: int) -> dict:
    """The Duck Infirmary's fresh start: breadcrumbs, ducks, buildings and defenders back to the beginning. Kept: the
    ducks earned by badges (golden, champion and fire), the multikill boost, and which games have been counted."""
    new = new_utopia(s["riotId"], now)
    for k in ("golden", "champs", "fire", "boost", "games", "founded", "founding"):
        new[k] = s[k]
    if "graded" in s:
        new["graded"] = s["graded"]
    else:
        new.pop("graded")   # worked out from the ducks later (first_graded)
    new["log"] = [{"t": now, "text": f"Fresh start: {STARTING_DUCKS} ducks in the pond and {FOUNDING_GIFT} breadcrumbs. "
                                     "Golden, champion and fire ducks and the multikill boost stay."}]
    return new


def apply_badges(s: dict, r: dict) -> list:
    """One game's badge rewards (new ducks come from the infirmary, not wins). Returns what happened."""
    got = []
    if r.get("triples") or r.get("quadras"):
        s["boost"] = round(s["boost"] + TRIPLE_BOOST * (r.get("triples") or 0) + QUADRA_BOOST * (r.get("quadras") or 0), 4)
        got.append("a breadcrumb boost")
    if r.get("pentas"):
        s["golden"] += r["pentas"]
        got.append(f"{r['pentas']} golden duck{'s' if r['pentas'] > 1 else ''}")
    g = (r.get("grade") or "").upper()
    if g in STAR:
        got += grade_rewards(s, r["champion"], g)
        s.setdefault("graded", {})[r["matchId"]] = g
    return got


def grade_rewards(s: dict, champion: str, g: str, before: str = "") -> list:
    """A game's S grade: a champion duck if it's that champion's best yet, and a fire duck for an S+. before: the grade
    this game was already rewarded for, when a better one arrives later (so an S+ never gives two fire ducks)."""
    got = []
    cur = s["champs"].get(champion, "")
    if not cur or grade_rank(g) < grade_rank(cur):
        s["champs"][champion] = g
        got.append(f"a {champion} champion duck ({g})")
    if g == "S+" and before != "S+":
        s["fire"] += 1
        got.append("a fire duck")
    return got


def late_grades(s: dict, rows: list) -> list:
    """Grades that arrived after their game was counted (the post-game chat can be slow, or a grade is added by hand):
    they still earn their ducks. Returns [(row, what it earned)]."""
    if "graded" not in s:
        s["graded"] = first_graded(s, rows)
    counted, out = set(s["games"]), []
    for r in sorted(rows, key=lambda r: r.get("start") or 0):
        g, before = (r.get("grade") or "").upper(), s["graded"].get(r["matchId"], "")
        if r["matchId"] not in counted or r.get("remake") or g not in STAR or (before and grade_rank(g) >= grade_rank(before)):
            continue
        got = grade_rewards(s, r["champion"], g, before)
        s["graded"][r["matchId"]] = g
        out.append((r, got))
    return out


def first_graded(s: dict, rows: list) -> dict:
    """For utopias from before grades were remembered per game: which counted games' grades were rewarded, as far as
    the ducks show. A champion without its duck, or fewer fire ducks than S+ games, means a grade came too late."""
    counted = set(s["games"])
    games = sorted((r for r in rows if r["matchId"] in counted and not r.get("remake") and (r.get("grade") or "").upper() in STAR),
                   key=lambda r: r.get("start") or 0)
    graded = {}
    for r in games:
        g, cur = r["grade"].upper(), s["champs"].get(r["champion"], "")
        if cur and grade_rank(cur) <= grade_rank(g):
            graded[r["matchId"]] = g
    fire = [r["matchId"] for r in games if r["matchId"] in graded and graded[r["matchId"]] == "S+"]
    for mid in fire[s["fire"]:] if len(fire) > s["fire"] else []:   # the newest S+ games are the ones missing a fire duck
        graded.pop(mid)
    return graded


class DuckUtopia:
    def __init__(self, storage, stats, tracker, client):
        self.storage, self.stats, self.tracker, self.client = storage, stats, tracker, client
        self.path = storage.path("utopia.json")
        self._lock = threading.Lock()

    def _load(self) -> dict:
        data = self.storage.read_json(self.path, {})
        return data if isinstance(data, dict) and isinstance(data.get("players"), dict) else {"players": {}, "raids": 0, "version": FRESH_START}

    def _classes(self) -> dict:
        try:
            roles = self.client.ensure_champions().roles
        except Exception:
            roles = getattr(self.client.champions, "roles", {})
        return {alias: next((r for r in rs if r in CLASSES), "fighter") for alias, rs in roles.items()}

    def state(self, viewer: bool, now: int | None = None) -> dict:
        with self._lock:
            data = self._update(now or now_ms())
            return self._view(data, viewer, now or now_ms())

    def act(self, body: dict, viewer: bool, now: int | None = None) -> dict:
        """Your own utopia only: player 1 from this Mac, player 2 from another computer (as with showcases)."""
        now = now or now_ms()
        with self._lock:
            data = self._update(now)
            players = self.tracker.players()
            i = 1 if viewer else 0
            if len(players) <= i or str(body.get("owner", "")).lower() != players[i].key:
                raise PermissionError("You can only build in your own Ductopia.")
            s = data["players"][players[i].key]
            result = self._do(s, body, players[i], now, data)
            self.storage.write_json(self.path, data)
            out = self._view(data, viewer, now)
            out["result"] = result
            return out

    # ---- keeping up with games ----
    def _update(self, now: int) -> dict:
        data = self._load()
        if data.get("version", 1) < FRESH_START:   # once: a copy of the old utopias is kept, then they start over
            if data["players"]:
                self.storage.write_json(self.storage.path("utopia-before-fresh-start.json"), data)
            data["players"] = {k: fresh_start(s, now) for k, s in data["players"].items()}
            data["version"] = FRESH_START
        players = self.tracker.players()
        rows = self.stats.together(players) if players else {}
        classes = self._classes()
        for p in players:
            if p.key not in data["players"]:
                data["players"][p.key] = self._found(p, rows.get(p.key, []), now)
        for p in players:
            migrate(data["players"][p.key])
            advance(data["players"][p.key], now)
            if "graded" not in data["players"][p.key]:   # before any new game is counted, so no grade pays twice
                data["players"][p.key]["graded"] = first_graded(data["players"][p.key], rows.get(p.key, []))
        # new games together since Founding Day, oldest first: rewards, then the same goose wave for both
        seen = set().union(*(set(data["players"][p.key]["games"]) for p in players)) if players else set()
        fresh = {}
        for p in players:
            for r in rows.get(p.key, []):
                if r["matchId"] not in data["players"][p.key]["games"]:
                    fresh.setdefault(r["matchId"], {})[p.key] = r
        scores = {p.key: score(data["players"][p.key]) for p in players}
        for mid in sorted(fresh, key=lambda m: min(r.get("start") or 0 for r in fresh[m].values())):
            if mid not in seen:
                data["raids"] = data.get("raids", 0) + 1
            best = max(scores.values()) if scores else 0
            for key, r in fresh[mid].items():
                s = data["players"][key]
                s["games"].append(mid)
                if r.get("remake"):
                    continue
                boost = catch_up(scores[key], best)
                got = apply_badges(s, r)
                if r.get("win"):
                    s["crumbs"] += WIN_CRUMBS * boost
                    got.insert(0, f"{round(WIN_CRUMBS * boost)} breadcrumbs")
                if got:
                    self._note(s, now, f"{'Won' if r.get('win') else 'Played'} on {r['champion']}: {', '.join(got)}.")
                recs = champion_records(rows.get(key, []))
                squad = self._squad(s, recs, classes)
                if squad:
                    rep = raid(squad, mid, data["raids"], s["levels"]["fence"])
                    self._reward(s, rep, boost)
                    rep.update(matchId=mid, t=now, champion=r["champion"])
                    s["raids"] = ([rep] + s["raids"])[:MAX_REPORTS]
                    self._note(s, now, "Goose raid: " + (f"won! +{rep['reward']['crumbs']} breadcrumbs, +{rep['reward']['feathers']} feathers"
                                                         if rep["win"] else f"lost. The geese took {rep['stolen']} breadcrumbs."))
                _fill_nests(s, now)
                scores[key] = score(s)
        for p in players:   # grades that came in after their game was counted still earn their ducks
            s = data["players"][p.key]
            for r, got in late_grades(s, rows.get(p.key, [])):
                if got:
                    self._note(s, now, f"Late {r['grade'].upper()} on {r['champion']}: {', '.join(got)}.")
        for p in players:
            data["players"][p.key]["riotId"] = p.riot_id
        self.storage.write_json(self.path, data)
        return data

    def _found(self, player, rows: list, now: int) -> dict:
        s = new_utopia(player.riot_id, now)
        summary = {"games": 0, "wins": 0, "boosts": 0, "golden": 0, "champs": 0, "fire": 0}
        for r in sorted(rows, key=lambda r: r.get("start") or 0):
            s["games"].append(r["matchId"])
            if r.get("remake"):
                continue
            before = (s["golden"], len(s["champs"]), s["fire"])
            apply_badges(s, r)
            summary["games"] += 1
            summary["wins"] += 1 if r.get("win") else 0
            summary["boosts"] += (r.get("triples") or 0) + (r.get("quadras") or 0)
            summary["golden"] += s["golden"] - before[0]
            summary["champs"] += len(s["champs"]) - before[1]
            summary["fire"] += s["fire"] - before[2]
        s["founding"] = summary
        self._note(s, now, f"Founding Day: {summary['games']} games together replayed.")
        return s

    def _squad(self, s: dict, recs: dict, classes: dict) -> list:
        """The five defenders: the chosen squad, filled up with the most-played champions."""
        chosen = [c for c in s["squad"] if c in recs][:5]
        for c in sorted(recs, key=lambda c: (-recs[c]["games"], c)):
            if len(chosen) >= 5:
                break
            if c not in chosen:
                chosen.append(c)
        return [defender(c, recs[c], classes.get(c, "fighter"), s["training"].get(c, 0)) for c in chosen]

    def _reward(self, s: dict, rep: dict, boost: float):
        if rep["win"]:
            s["raidWins"] += 1
            crumbs, feathers = round(30 * rep["total"] * boost), round((1 + rep["wave"] // 5) * boost)
            s["crumbs"] += crumbs
            s["feathers"] += feathers
            rep["reward"], rep["stolen"] = {"crumbs": crumbs, "feathers": feathers}, 0
        else:
            stolen = round(min(s["crumbs"] * 0.15, 500))
            s["crumbs"] -= stolen
            rep["reward"], rep["stolen"] = {"crumbs": 0, "feathers": 0}, stolen

    @staticmethod
    def _note(s: dict, now: int, text: str):
        s["log"] = ([{"t": now, "text": text}] + s["log"])[:MAX_LOG]

    # ---- what you can do ----
    def _do(self, s: dict, body: dict, player, now: int, data: dict) -> dict:
        action = body.get("action")
        rows = self.stats.together([player]) if action in ("squad", "train", "practice", "hat") else {}
        recs = champion_records(rows.get(player.key, []))
        if action == "upgrade":
            b = body.get("building")
            if b not in BUILDINGS:
                raise ValueError("There's no such building.")
            cost = upgrade_cost(b, s["levels"][b])
            if cost is None:
                raise ValueError("That's already as big as it gets.")
            if s["crumbs"] < cost:
                raise ValueError(f"Not enough breadcrumbs: {cost:,} needed.")
            s["crumbs"] -= cost
            old = s["levels"][b]
            s["levels"][b] += 1
            if b == "incubation":   # the ducklings already growing speed up too
                k = grow_minutes(old + 1) / grow_minutes(old)
                s["ducklings"] = [now + round(max(0, d - now) * k) for d in s["ducklings"]]
            if b == "pond":
                _fill_pond(s)
            if b == "nests":
                _fill_nests(s, now)
            name, level = building_name(b, s["levels"][b]), s["levels"][b]
            self._note(s, now, f"Built the {name}." if level == 1 or name != building_name(b, level - 1)
                       else f"Upgraded the {name} to level {level}.")
            return {"built": name, "level": level}
        if action == "spawn":
            if len(s["ducklings"]) + s["lost"] >= nest_space(s["levels"]["nests"]):
                raise ValueError("The nests are full: upgrade the nests, or wait for a duckling to grow.")
            cost = spawn_cost(s["spawned"])
            if s["crumbs"] < cost:
                raise ValueError(f"Not enough breadcrumbs: {cost:,} needed.")
            s["crumbs"] -= cost
            s["spawned"] += 1
            s["ducklings"].append(now + round(grow_minutes(s["levels"]["incubation"]) * 60000))
            return {"spawned": s["spawned"]}
        if action == "hat":   # buy a hat for a champion, put one on, or take it off
            c, hat, op = body.get("champion"), body.get("hat"), body.get("op")
            if c not in recs:
                raise ValueError("Only champions you've played together live in the Champion Quarter.")
            mine = s["hats"].setdefault(c, {"owned": [], "on": None})
            if op == "off":
                mine["on"] = None
                return {"hat": None}
            if hat not in HATS:
                raise ValueError("There's no such hat.")
            if op == "buy":
                if hat in mine["owned"]:
                    raise ValueError(f"{c} already has that hat.")
                name, cost = HATS[hat]
                if s["crumbs"] < cost:
                    raise ValueError(f"Not enough breadcrumbs: {cost:,} needed.")
                s["crumbs"] -= cost
                mine["owned"].append(hat)
                self._note(s, now, f"Bought {c} a {name.lower()}.")
            elif op != "wear" or hat not in mine["owned"]:
                raise ValueError(f"{c} doesn't have that hat yet.")
            mine["on"] = hat
            return {"hat": hat}
        if action == "squad":
            squad = [c for c in body.get("squad") or [] if isinstance(c, str) and c in recs]
            if len(set(squad)) != len(squad) or not 1 <= len(squad) <= 5:
                raise ValueError("Pick up to five different champions you've played together.")
            s["squad"] = squad
            return {"squad": squad}
        if action == "train":
            c = body.get("champion")
            if c not in recs:
                raise ValueError("Only champions you've played together can train.")
            level = s["training"].get(c, 0)
            if level >= 10:
                raise ValueError("Fully trained.")
            cost = 2 + level
            if s["feathers"] < cost:
                raise ValueError(f"Not enough goose feathers: {cost} needed.")
            s["feathers"] -= cost
            s["training"][c] = level + 1
            return {"trained": c, "level": level + 1}
        if action == "practice":   # a test raid: nothing won or lost
            squad = self._squad(s, recs, self._classes())
            if not squad:
                raise ValueError("Play a game together first: defenders are champions you've played.")
            # a practice wave is a few raids tougher than the next real one, so there's something to see
            rep = raid(squad, f"practice-{now}", data.get("raids", 0) + 6, s["levels"]["fence"])
            rep.update(practice=True, t=now)
            return {"raid": rep}
        raise ValueError("Unknown action.")

    # ---- what the page gets ----
    def _view(self, data: dict, viewer: bool, now: int) -> dict:
        players = self.tracker.players()
        rows = self.stats.together(players) if players else {}
        classes = self._classes()
        scores = [score(data["players"][p.key]) for p in players if p.key in data["players"]]
        best = max(scores) if scores else 0
        out = []
        for i, p in enumerate(players):
            s = data["players"].get(p.key)
            if not s:
                continue
            recs = champion_records(rows.get(p.key, []))
            lv = s["levels"]
            out.append({
                **{k: s[k] for k in ("riotId", "feathers", "levels", "lost", "spawned", "hats", "pond", "edge", "golden", "boost",
                                     "champs", "fire", "raids", "raidWins", "training", "log", "founding", "founded")},
                "crumbs": round(s["crumbs"], 2), "ducklings": sorted(s["ducklings"]),
                "score": scores[i], "catchUp": catch_up(scores[i], best), "leading": len(scores) > 1 and scores[i] == best and scores.count(best) == 1,
                "rate": round(crumb_rate(s), 3), "nestSpace": nest_space(lv["nests"]), "pondSpace": pond_space(lv["pond"]),
                "districts": districts(s), "boostFrom": boost_breakdown(s, rows.get(p.key, [])),
                "plaza": penta_plaza(s, rows.get(p.key, [])), "volcano": volcano_spa(s, rows.get(p.key, [])),
                "lab": {"spawnCost": spawn_cost(s["spawned"]), "grow": grow_minutes(lv["incubation"]),
                        "growNext": grow_minutes(lv["incubation"] + 1) if upgrade_cost("incubation", lv["incubation"]) is not None else None,
                        "nestSpaceNext": nest_space(lv["nests"] + 1)},
                "buildings": {b: {"level": lv[b], "name": building_name(b, lv[b]) if lv[b] else None,
                                  "next": building_name(b, lv[b] + 1) if upgrade_cost(b, lv[b]) is not None else None,
                                  "cost": upgrade_cost(b, lv[b])} for b in BUILDINGS},
                "squad": self._squad(s, recs, classes),
                "champions": sorted(({"champion": c, "cls": classes.get(c, "fighter"), "games": r["games"]}
                                     for c, r in recs.items()), key=lambda x: (-x["games"], x["champion"])),
            })
        return {"now": now, "me": 1 if viewer else 0, "players": out, "goldenRate": GOLDEN_RATE, "fireRate": FIRE_RATE,
                "hatShop": [{"id": h, "name": n, "cost": c} for h, (n, c) in HATS.items()]}
