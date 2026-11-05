"""Ductopia (first called Duck Utopia, then Ducktopia): an idle duck-city race, powered by the games you play together (see the design doc).

Each tracked player has a utopia, kept in data/utopia.json. Everything is worked out on this Mac so both of you see
the same race, and it's brought up to date whenever the page asks: idle breadcrumbs are counted from the time that
passed, so nothing runs in the background.

  Founding Day  the first time, each player's saved games together are replayed: every triple / quadra is a
                permanent breadcrumb boost, every pentakill a golden duck, every S- or S a champion duck, and every
                champion's first S+ a wild fire duck. The pond starts with STARTING_DUCKS ducks.
  each new game together, after that
                a win gives bonus breadcrumbs, the badges give their rewards, and geese raid both utopias. Your five
                defenders fight them automatically.

The duck pipeline: new ducks come from the Duck Lab, whose nests are fluid chambers. You spawn a
duckling into a free nest for breadcrumbs (spawn_cost(): more the bigger your flock is now, so merging in the Mystic
Marsh brings it back down; never while the nests are full), and every game together lays a free egg (a win, two:
GAME_EGGS), which waits for a free nest ("lost", from the old lost and found box). It grows there for grow_minutes(),
then moves to the pond. If the pond is full it waits at the edge, up to one full clutch (edge_space()), moving in first
when there's room; beyond that it waddles off to find another pond (waddle_off(), which logs it). Now and then one hatches as a mallard
(lucky_chance()). Only ducks in the pond collect breadcrumbs (golden, champion and caught fire ducks collect wherever they are). The
Duck Lab's upgrades: more nests, a shorter incubation time, Duck Science (each level: pond ducks collect x1.5), and
with Duck Science level AUTONEST_SCIENCE and the pond a lagoon (AUTONEST_POND) the Auto-nester, which spawns into
empty nests by itself (auto_nest()).

The Mystic Marsh: the Mystic, a wizard toad, zaps two pond birds of the same kind into one of the next kind up
(BIRDS: duck, mallard, wood duck, baker, finance chad, lab, firefighter, police, raver and DJ ducks, swan, black swan,
royal swan). Each collects MARSH_STEP times the one below (10% more
than the two it replaced) and takes one pond spot, so merging frees room. Duck Science multiplies them all.

The Champion Quarter is a lounge where your five defenders rest; there you can see each one's stats and buy it hats
(just for looks: HATS). Hats belong to the champion, so they stay if it leaves the squad and comes back.
The Volcano Spa: an S+ on a champion unlocks its fire duck, wild at first (fire_ducks()): an S+ in a game together, or
a season-best S+ from the S Rank Challenge (season.py; from any game, so solo ones count too). Once unlocked it stays,
even when a new season starts. A wild fire duck does
nothing until it's caught: lure it with the sweet treat for its champion's class (TREATS), and a wild fire duck of that
class, picked at random, eats it and is caught. Caught fire ducks soak in the volcano's pools, collect breadcrumbs and
heat the Spa. The aim: catch them all.
The Training Grounds: a new win on any champion earns it a challenge (a defender or not), and they add up. Challenge
the boss there, a one-on-one fight scaled to the defender's level (boss_fight()); beat it and the defender goes up a
level for good. Win or lose, the challenge is used up.
The Spa (once built): recovery soaks. A defender soaks in a pool with bath salts at one of three temperatures (SALTS,
TEMPS; hotter costs more and does more). It sits out raids while it soaks, then comes out refreshed with the salt's
perk, used up by its next goose raid or boss fight. The Hot springs have a second pool, and every caught fire duck
heats the water a little more (heat()).
The Bakery: besides its breadcrumb bonus, each bakery level unlocks machines that bake sweet treats, one for each
class (TREATS). A treat costs breadcrumbs and badges, and takes a while to bake; speed upgrades shorten that, and
need higher bakery levels too. Once a machine has every speed upgrade, more of the same machine can be bought (very
expensive: extra_machine_cost()), each one baking another batch at the same time. Badges are spent from a pool for each player: those earned (badges.py, as in the badge
showcase) minus those already used up. They leave Ductopia only, never the showcase. Treats lure fire ducks.

First version: the numbers below are guesses to see how it plays, and are meant to be tuned.
"""

from __future__ import annotations

import math
import random
import threading

from .badges import BADGE_INFO, badge_counts
from .grades import grade_rank, now_ms

# ---- tuning ----
FOUNDING_GIFT = 300          # breadcrumbs to start with, so there's a first choice to make straight away
STARTING_DUCKS = 5           # ducks in the pond to start with (it holds 5 at level 1)
FRESH_START = 2              # data version: utopias saved before this start over once (see fresh_start)
DUCK_RATE = 1.0              # breadcrumbs a minute for each duck in the pond
GOLDEN_RATE = 3.0            # ... for each golden duck (pentakills)
CHAMPION_RATE = 1.5          # ... for each champion duck (S- or S on a champion)
FIRE_RATE = 2.0              # ... for each caught fire duck (S+)
BAKERY_BONUS = 0.25          # each bakery level multiplies breadcrumbs by 1.25 (compounding: x9.3 at level 10)
SCIENCE_BOOST = 1.5          # each Duck Science level multiplies what every pond duck collects by 1.5
MARSH_STEP = 2.2             # in the Mystic Marsh, 2 birds -> 1 of the next kind, collecting 2.2x (10% more than both)
TRIPLE_BOOST, QUADRA_BOOST = 0.005, 0.015   # permanent breadcrumb boost per triple / quadra kill
GROW_MINUTES = 8 * 60        # how long a duckling takes to grow in its nest, before incubation upgrades
TOP_GROW_MINUTES = 15        # ... and at the very top incubation level (with every city stage's extra levels): one smooth
                             # exponential curve between them, big savings early on and smaller ones as it goes
# the Duck Lab's upgrades get more levels with each city stage the pond reaches: building -> levels added a stage
CITY_LAB_LEVELS = {"nests": 3, "science": 2, "incubation": 2}
SPAWN_COST = 100             # breadcrumbs for the first duckling spawned ...
SPAWN_GROWTH = 1.05          # ... and 5% more for each duck or bird in your flock past the first STARTING_DUCKS
CLUTCH_DISCOUNT = 0.1       # hatching a clutch (every free nest at once, 2 or more): 10% off
GAME_EGGS, WIN_EGGS = 1, 2
# a special delivery, dropped by each new win and opened from the page: kind -> (rarity, chance out of 100)
CRATE_LOOT = {"crumbs": ("common", 55), "feathers": ("common", 15), "eggs": ("uncommon", 15), "mallards": ("uncommon", 8),
              "baker": ("rare", 5), "golden": ("legendary", 2)}
CRATE_MINUTES, CRATE_MIN_CRUMBS, CRATE_FEATHERS = 60, 500, 5   # free eggs laid in the Duck Lab by each new game together, and by a win
LUCKY_EGG, LUCKY_SCIENCE, MAX_LUCKY = 0.05, 0.01, 0.2   # chance a duckling hatches as a mallard: 5%, +1% a Duck Science level
WIN_CRUMBS = 100              # bonus breadcrumbs for a new win, at least (catch-up boost applies) ...
WIN_MINUTES = 30             # ... or this many minutes of breadcrumbs, whichever is more, so wins keep mattering
RAID_MINUTES = 15            # a raid win: 30 breadcrumbs a goose, or this many minutes of breadcrumbs if that's more
STEAL_MINUTES = 10           # a raid loss: 15% of breadcrumbs, up to 500 or this many minutes of breadcrumbs
MAX_REPORTS, MAX_LOG = 10, 30

# hat -> (name, breadcrumbs), cheapest first
HATS = {
    "cap": ("Baseball cap", 200), "beanie": ("Beanie", 300), "party": ("Party hat", 500), "flowers": ("Flower crown", 700),
    "cowboy": ("Cowboy hat", 1000), "tophat": ("Top hat", 1500), "chef": ("Chef's hat", 2000), "viking": ("Viking helmet", 3000),
    "wizard": ("Wizard hat", 4500), "crown": ("Royal crown", 8000),
}

# past the lagoon (level 20) the pond grows into a city, in stages: each longer, roomier and steeper than the last
CITY_STAGES = [   # name, its last level, room added a level, how much more each level costs than the one before
    ("Duck Village", 30, 20, 1.15), ("Duck Town", 45, 25, 1.18), ("Duck City", 60, 35, 1.21), ("Duckopolis", 80, 50, 1.24)]


def city_stage(level: int):
    """The city stage a pond level (past 20) is in: (name, first level, last level, room a level, cost growth)."""
    first = 21
    for name, last, room, growth in CITY_STAGES:
        if level <= last:
            return name, first, last, room, growth
        first = last + 1
    return city_stage(CITY_STAGES[-1][1])


# building -> (first cost, cost growth per level, highest level, names by level)
BUILDINGS = {
    "nests":  (300, 1.7, 12, [(1, "Nests")]),   # in the Duck Lab
    "pond":   (400, 1.8, CITY_STAGES[-1][1], [(1, "Pond"), (4, "Lake"), (7, "Lagoon")]   # ... and past the lagoon, the city
               + [(city_stage(last)[1], name) for name, last, _, _ in CITY_STAGES]),
    "bakery": (500, 1.9, 10, [(1, "Bakery")]),
    "spa":    (20000, 4.0, 2, [(1, "Spa"), (2, "Hot springs")]),
    "fence":  (600, 1.7, 9, [(1, "Fences"), (4, "Scarecrows"), (7, "Honk-proof walls")]),
    "incubation": (500, 2.0, 10, [(1, "Incubation time")]),   # in the Duck Lab
    "science": (1000, 3.0, 15, [(1, "Duck Science")]),          # in the Duck Lab: what each pond duck collects
    "autonest": (20000, 1.0, 1, [(1, "Auto-nester")]),          # in the Duck Lab, with Duck Science 3 and the lagoon: fills empty nests
}
INCUBATION_TOP = BUILDINGS["incubation"][2] + CITY_LAB_LEVELS["incubation"] * len(CITY_STAGES)   # 18
INCUBATION_SPEEDUP = (TOP_GROW_MINUTES / GROW_MINUTES) ** (1 / INCUBATION_TOP)   # each level: ~17.5% less time
START_LEVELS = {"nests": 1, "pond": 1, "bakery": 0, "spa": 0, "fence": 0, "incubation": 0, "science": 0, "autonest": 0}
AUTONEST_SCIENCE, AUTONEST_POND = 3, 7   # the Auto-nester needs Duck Science level 3 and the pond to be a lagoon


def grow_minutes(level: int) -> float:
    """How long a duckling grows: 8 h, 6 h 36, 5 h 27 ... 1 h 11 at level 10 (the top before the city) ... 15 min at the
    very top (INCUBATION_TOP, at Duckopolis)."""
    return GROW_MINUTES * INCUBATION_SPEEDUP ** min(level, INCUBATION_TOP)


def stages_reached(s: dict) -> int:
    """How many city stages the pond has grown into (0 before Duck Village)."""
    return sum(1 for _, last, _, _ in CITY_STAGES if s["levels"]["pond"] >= city_stage(last)[1])


def top_level(s: dict, building: str) -> int:
    """A building's highest level for this utopia: the Duck Lab's upgrades get more with each city stage reached."""
    return BUILDINGS[building][2] + CITY_LAB_LEVELS.get(building, 0) * stages_reached(s)


def next_unlock(s: dict, building: str):
    """The city stage that would give a maxed-out building more levels, if one would."""
    if building not in CITY_LAB_LEVELS or s["levels"][building] < top_level(s, building):
        return None
    n = stages_reached(s)
    return CITY_STAGES[n][0] if n < len(CITY_STAGES) else None


def spawn_cost(flock: int) -> int:
    """A duckling's price, by how many ducks and birds you have now (flock()): 100 up to STARTING_DUCKS, then 5% more
    for each one (163 with 15, 1,147 with 55). Merging two birds into one in the Mystic Marsh makes it cheaper again."""
    return round(SPAWN_COST * SPAWN_GROWTH ** max(0, flock - STARTING_DUCKS))


def open_crate(s: dict, now: int) -> dict:
    """Open one special delivery: roll its loot (seeded by how many this player has opened, so reloading can't change it),
    give it, and say what it was."""
    n = s.get("cratesOpened", 0)
    roll, total = random.Random(f"crate-{s['riotId']}-{n}").random() * 100, 0
    kind = next(k for k, (_, chance) in CRATE_LOOT.items() if roll < (total := total + chance))
    loot = {"kind": kind, "rarity": CRATE_LOOT[kind][0]}
    if kind == "crumbs":
        amount = round(max(CRATE_MIN_CRUMBS, crumb_rate(s) * CRATE_MINUTES))
        s["crumbs"] += amount
        loot.update(amount=amount, name=f"{amount:,} breadcrumbs", icon="icon-breadcrumb")
    elif kind == "feathers":
        s["feathers"] += CRATE_FEATHERS
        loot.update(amount=CRATE_FEATHERS, name=f"{CRATE_FEATHERS} goose feathers", icon="icon-feather")
    elif kind == "eggs":   # a full clutch: one for each nest
        amount = nest_space(s["levels"]["nests"])
        s["lost"] += amount
        _fill_nests(s, now)
        loot.update(amount=amount, name=f"a clutch of {amount} eggs", icon="egg")
    elif kind == "mallards":
        s["birds"][0] += 2
        loot.update(amount=2, name="2 mallards", icon="bird-mallard")
    else:   # a baker duck, or a golden egg: the next bird up from the best you've made (a mystery until now)
        tier = 3 if kind == "baker" else min(discovered(s) + 1, len(BIRDS) - 1)
        s["birds"][tier - 1] += 1
        loot.update(amount=1, tier=tier, name=("a golden egg: " if kind == "golden" else "") + f"a {BIRDS[tier][1].lower()}",
                    icon="bird-" + BIRDS[tier][0])
    s["crates"] -= 1
    s["cratesOpened"] = n + 1
    return loot


def free_nests(s: dict) -> int:
    return max(0, nest_space(s["levels"]["nests"]) - len(s["ducklings"]) - s["lost"])


def clutch_cost(s: dict) -> int:
    """Breadcrumbs to fill every free nest at once: each duckling priced as if spawned one after another (each one makes
    the flock bigger), with CLUTCH_DISCOUNT off when it's two or more."""
    n, f = free_nests(s), flock(s)
    total = sum(spawn_cost(f + i) for i in range(n))
    return round(total * (1 - CLUTCH_DISCOUNT)) if n >= 2 else total


def flock(s: dict) -> int:
    """Every duck and bird you have, one each however big: in the pond, at its edge, growing, and eggs waiting."""
    return pond_used(s) + s["edge"] + len(s["ducklings"]) + s["lost"]


def lucky_chance(s: dict) -> float:
    return min(LUCKY_EGG + LUCKY_SCIENCE * s["levels"]["science"], MAX_LUCKY)


# the Mystic Marsh's birds, smallest first: plain pond ducks, then what two of the kind before turn into
BIRDS = [("duck", "Duck"), ("mallard", "Mallard"), ("wood", "Wood duck"), ("baker", "Baker duck"), ("chad", "Finance Chad duck"),
         ("lab", "Lab duck"), ("firefighter", "Firefighter duck"), ("police", "Police duck"), ("raver", "Raver duck"), ("dj", "DJ duck"),
         ("swan", "Swan"), ("black", "Black swan"), ("royal", "Royal swan")]


def bird_rate(tier: int, science: int = 0) -> float:
    """Breadcrumbs a minute for one bird of a kind (0: a plain duck), with Duck Science."""
    return DUCK_RATE * MARSH_STEP ** tier * SCIENCE_BOOST ** science


def discovered(s: dict) -> int:
    """The biggest kind of bird this player has ever made (0: only ducks). The marsh's ladder shows up to it, and the
    next one as a mystery; the rest stay hidden."""
    return max(s.get("discovered", 0), max((i + 1 for i, n in enumerate(s["birds"]) if n), default=0))


def pond_used(s: dict) -> int:
    """Pond spots taken: plain ducks and every bird from the Mystic Marsh, one spot each."""
    return s["pond"] + sum(s["birds"])


def nest_space(level: int) -> int:
    return 2 + 2 * level


LAGOON_SPACE = [65, 80, 95, 110, 130, 150, 175, 200]   # the lagoon's levels 13 to 20


def pond_space(level: int) -> int:
    """Kept small at first, so room is worth making in the Mystic Marsh: 6, 10, 14 ... 50 at level 12, then the lagoon's
    bigger steps up to 200 at level 20, and then the city it grows into (CITY_STAGES): Duck Village ... 400 at level 30,
    Duck Town ... 775 at 45, Duck City ... 1,300 at 60 and Duckopolis ... 2,300 at the top (80). A pond already holding
    more keeps every duck."""
    if level <= 12:
        return 2 + 4 * level
    if level <= 20:
        return LAGOON_SPACE[level - 13]
    return 200 + sum(city_stage(lvl)[3] for lvl in range(21, min(level, CITY_STAGES[-1][1]) + 1))


def population(s: dict) -> int:
    """Every duck you have, counting each bird from the Mystic Marsh as the ducks that went into it (a mallard is 2), so
    merging never lowers it: in the pond and at its edge, plus ducklings growing and eggs waiting."""
    return s["pond"] + s["edge"] + len(s["ducklings"]) + s["lost"] + sum(n * 2 ** (i + 1) for i, n in enumerate(s["birds"]))


def edge_space(s: dict) -> int:
    """Ducks that can wait at the pond's edge for a spot: one full clutch, a duck for each nest. Any more waddle off."""
    return nest_space(s["levels"]["nests"])


def upgrade_cost(building: str, level: int, top: int | None = None):
    """Breadcrumbs to go from `level` to the next one; None at the top (`top`, if the utopia has a different one:
    top_level())."""
    first, growth, base_top, _ = BUILDINGS[building]
    start = START_LEVELS[building]
    if level >= (top if top is not None else base_top):
        return None
    if building == "pond" and level >= 20:   # the city: on from the lagoon's last step, by each level's stage's growth
        return round(first * growth ** (19 - start) * math.prod(city_stage(lvl)[4] for lvl in range(21, level + 2)))
    return round(first * growth ** (level - start))


def building_name(building: str, level: int) -> str:
    names = BUILDINGS[building][3]
    return next((n for lvl, n in reversed(names) if level >= lvl), names[0][1])


# ---- the race ----
def score(s: dict) -> int:
    """The Ductopia Score: ducks, buildings, districts and raid wins."""
    ducks = population(s)   # (merging never lowers it)
    lv = s["levels"]
    return (10 * ducks + 50 * s["golden"] + 40 * len(s["champs"]) + 50 * len(s["caught"])
            + 20 * (lv["nests"] + lv["pond"]) + 25 * (lv["bakery"] + lv["science"]) + 60 * lv["spa"] + 15 * lv["fence"]
            + 100 * len(districts(s)) + 30 * s["raidWins"])


def districts(s: dict) -> list:
    """Districts unlocked by real achievements only."""
    out = []
    if s["golden"]:
        out.append("penta")
    if s["champs"]:
        out.append("champion")
    if wild_and_caught(s):
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
    return rate_breakdown(s)["total"]


def rate_breakdown(s: dict) -> dict:
    """Where the breadcrumbs a minute come from: each kind of duck (how many, and how much each collects; Duck Science
    raises what pond ducks collect), then the bakery's bonus and the multikill boost, which multiply them all."""
    sci, marsh = s["levels"]["science"], sum(n * bird_rate(i + 1, s["levels"]["science"]) for i, n in enumerate(s["birds"]))
    sources = [("pond", "Ducks in the pond", s["pond"], bird_rate(0, sci)),
               ("marsh", "Birds from the Mystic Marsh", sum(s["birds"]), marsh / sum(s["birds"]) if sum(s["birds"]) else 0), ("golden", "Golden ducks (Penta Plaza)", s["golden"], GOLDEN_RATE),
               ("champion", "Champion ducks (Champion Quarter)", len(s["champs"]), CHAMPION_RATE),
               ("fire", "Caught fire ducks (in the Spa)", len(s["caught"]), FIRE_RATE)]
    base = sum(n * each for _, _, n, each in sources)
    bakery = (1 + BAKERY_BONUS) ** s["levels"]["bakery"] - 1
    return {"sources": [{"id": k, "name": name, "count": n, "each": each, "perMin": n * each} for k, name, n, each in sources],
            "base": base, "bakery": bakery, "boost": s["boost"], "total": base * (1 + bakery) * (1 + s["boost"])}


def win_crumbs(s: dict) -> float:
    """A win's breadcrumbs, before the catch-up boost: WIN_MINUTES of breadcrumbs, or WIN_CRUMBS early on."""
    return max(WIN_CRUMBS, crumb_rate(s) * WIN_MINUTES)


def merge_birds(s: dict, tier, every: bool = False) -> dict:
    """The Mystic zaps a pair of `tier` (0: plain ducks) into one of the next kind; every: all pairs, smallest first
    (so new mallards can pair up too). Returns {tier made: how many}."""
    have = lambda t: s["pond"] if t == 0 else s["birds"][t - 1]
    def take(t, n):
        if t == 0:
            s["pond"] -= n
        else:
            s["birds"][t - 1] -= n
    made = {}
    if every:
        for t in range(len(BIRDS) - 1):
            pairs = have(t) // 2
            if pairs:
                take(t, pairs * 2)
                s["birds"][t] += pairs
                made[t + 1] = pairs
        return made
    if not isinstance(tier, int) or not 0 <= tier < len(BIRDS):
        raise ValueError("There's no such bird.")
    if tier == len(BIRDS) - 1:
        raise ValueError("A royal swan is as grand as birds get.")
    if have(tier) < 2:
        raise ValueError(f"The Mystic needs two {BIRDS[tier][1].lower()}s.")
    take(tier, 2)
    s["birds"][tier] += 1
    return {tier + 1: 1}


# ---- the duck pipeline over time ----
def advance(s: dict, now: int):
    """Bring a utopia up to `now`: breadcrumbs collected, ducklings grown and into the pond."""
    t, left = s["tick"], 0
    while True:
        _fill_pond(s)   # ducks waiting at the edge go in first, whenever there's room
        _fill_nests(s, t)
        auto_nest(s, t)
        due = min(s["ducklings"]) if s["ducklings"] else None
        end = due if due is not None and due <= now else now
        wait = _autonest_wait(s, t)   # the Auto-nester's next duckling is due then: stop there to spawn it
        if wait is not None and t + wait < end:
            end = t + wait
        s["crumbs"] += crumb_rate(s) * max(0, end - t) / 60000
        t = end
        if t >= now and (due is None or due > now):
            break
        _fill_pond(s)   # (before the new ones)
        for i, due_at in enumerate(r for r in s["ducklings"] if r <= t):
            if pond_used(s) >= pond_space(s["levels"]["pond"]):
                if s["edge"] < edge_space(s):
                    s["edge"] += 1   # it waits at the edge for a spot
                else:
                    left += 1        # no room there either: it waddles off to find another pond
            elif random.Random(f"egg-{s['riotId']}-{due_at}-{i}").random() < lucky_chance(s):   # the same for both of you
                s["birds"][0] += 1   # a lucky egg: a mallard
            else:
                s["pond"] += 1
        s["ducklings"] = [r for r in s["ducklings"] if r > t]
    _fill_nests(s, now)   # (anything due at `now` itself)
    auto_nest(s, now)
    s["tick"] = max(s["tick"], now)
    if left:
        waddle_off(s, left, now)


def waddle_off(s: dict, n: int, now: int):
    """Ducklings that grew up with no room in the pond or at its edge: they leave, and the log says so (one line for all)."""
    s["waddled"] = s.get("waddled", 0) + n
    s["log"] = ([{"t": now, "text": f"{n} duckling{'s' if n > 1 else ''} grew up with no room in the pond or at its edge and waddled off "
                                   f"to find a new one. Merge birds in the Mystic Marsh or upgrade the pond to keep them."}] + s["log"])[:MAX_LOG]


def autonest_gap(s: dict) -> float:
    """The Auto-nester is a production line: one duckling every incubation time / nests (in ms), so they hatch evenly,
    at the same rate as filling every nest at once would, rather than in batches that stay together for good."""
    return grow_minutes(s["levels"]["incubation"]) * 60000 / nest_space(s["levels"]["nests"])


def auto_nest(s: dict, t: int):
    """The Auto-nester: a duckling into an empty nest at time t, at the normal price, if it can pay and its last one was
    at least autonest_gap() ago."""
    if not (s["levels"]["autonest"] and s.get("autoOn", True)):
        return
    last = s.get("autoLast")
    if free_nests(s) and s["crumbs"] >= spawn_cost(flock(s)) and (last is None or t - last >= autonest_gap(s) - 1):
        s["crumbs"] -= spawn_cost(flock(s))
        s["spawned"] += 1
        s["autoSpawned"] = s.get("autoSpawned", 0) + 1
        s["autoLast"] = t
        s["ducklings"].append(t + round(grow_minutes(s["levels"]["incubation"]) * 60000))


def _autonest_wait(s: dict, t: int):
    """Milliseconds from t until the Auto-nester's next duckling, with a nest free: once its pace allows one and it can
    pay for it; None if it can't (no breadcrumbs coming in)."""
    if not (s["levels"]["autonest"] and s.get("autoOn", True) and free_nests(s)):
        return None
    last = s.get("autoLast")
    pace = 0 if last is None else max(0, last + autonest_gap(s) - t)
    short, rate = spawn_cost(flock(s)) - s["crumbs"], crumb_rate(s)
    if short > 0 and rate <= 0:
        return None
    return max(1, math.ceil(max(pace, short / rate * 60000 if short > 0 else 0)))


def _fill_nests(s: dict, t: int):
    """Eggs waiting for a free nest (laid by games together, or from the old lost and found box) into free nests."""
    take = max(0, min(nest_space(s["levels"]["nests"]) - len(s["ducklings"]), s["lost"]))
    if take:
        s["lost"] -= take
        s["ducklings"] += [t + round(grow_minutes(s["levels"]["incubation"]) * 60000)] * take


def migrate(s: dict):
    """Utopias saved before the Duck Lab, or its first version (which hatched ducklings on a timer)."""
    for b in ("incubator", "serum"):
        s["levels"].pop(b, None)
    for b, lvl in START_LEVELS.items():
        s["levels"].setdefault(b, lvl)
    s["lost"] += s.pop("held", 0)
    s.pop("nextSpawn", None)
    s.setdefault("spawned", 0)
    s.setdefault("hats", {})
    for k, v in (("ranks", {}), ("challenges", []), ("bossFights", []), ("soaks", []), ("perks", {}),   # Training Grounds, Spa
                 ("machines", {}), ("bakes", {}), ("treats", {}), ("spentBadges", {}),               # Bakery
                 ("caught", []), ("seasonFire", {}), ("machineCount", {}),                          # Volcano Spa, Bakery
                 ("birds", [0] * (len(BIRDS) - 1))):                                                # Mystic Marsh
        s.setdefault(k, v)
    # saved before new ducks joined the ladder below the swans: each bird keeps its place, and so its worth (a swan made
    # from 8 ducks becomes a baker duck, a black swan a finance chad duck, and so on)
    s["birds"] += [0] * (len(BIRDS) - 1 - len(s["birds"]))
    s["discovered"] = discovered(s)   # (and remembers a lucky mallard from growing ducklings)
    s["bakes"] = {t: u if isinstance(u, list) else [u] for t, u in s["bakes"].items()}   # one batch per machine, from before extra machines


def _fill_pond(s: dict):
    take = max(0, min(pond_space(s["levels"]["pond"]) - pond_used(s), s["edge"]))
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


def wild_and_caught(s: dict) -> list:
    """Every champion whose fire duck is unlocked (an S+ on it together, or a season-best S+), wild or caught."""
    return list(dict.fromkeys([c for c, g in s["champs"].items() if g == "S+"] + list(s.get("seasonFire") or {})))


def fire_ducks(s: dict, rows: list, classes: dict) -> list:
    """The Volcano Spa's fire ducks: one for each champion with an S+, in the order they appeared. cls: the class of
    treat that lures it; caught: whether it's been caught (only caught ones collect breadcrumbs and heat the Spa)."""
    counted = set(s["games"])
    games = sorted((r for r in rows if r["matchId"] in counted and not r.get("remake") and (r.get("grade") or "").upper() == "S+"),
                   key=lambda r: r.get("start") or 0)
    first, n = {}, {}
    for r in games:
        first.setdefault(r["champion"], r)
        n[r["champion"]] = n.get(r["champion"], 0) + 1
    since = lambda c: (first[c].get("start") or 0) if c in first else s["seasonFire"].get(c, 0)   # season-best ones: when they turned up
    champs = sorted(wild_and_caught(s), key=since)
    return [{"champion": c, "cls": classes.get(c, "fighter"), "caught": c in s["caught"], "games": n.get(c, 0),
             "first": first[c].get("start") if c in first else None} for c in champs]


def wild_fire_ducks(s: dict, cls: str, classes: dict) -> list:
    """The wild fire ducks a treat for `cls` can lure."""
    return [c for c in wild_and_caught(s) if c not in s["caught"] and classes.get(c, "fighter") == cls]


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


def defender(champion: str, rec: dict, cls: str, training: int, rank: int = 0) -> dict:
    """A champion's raid stats, from that player's own games on it (and the levels it won in the Training Grounds)."""
    level = min(rec["games"], 20) + rank
    wr = rec["wins"] / rec["games"] if rec["games"] else 0
    kda = (rec["kills"] + rec["assists"]) / max(rec["deaths"], 1)
    star = STAR.get(rec["grade"], 0)
    boost = 1 + 0.12 * star + 0.1 * training
    hp = round((60 + 6 * level) * (0.7 + 0.6 * wr) * boost)
    return {"champion": champion, "cls": cls, "level": level, "hp": hp, "atk": round((6 + 1.2 * min(kda, 8) + 0.4 * level) * boost, 1),
            "star": star, "grade": rec["grade"], "training": training, "rank": rank, "triples": rec["triples"], "quadras": rec["quadras"],
            "pentas": rec["pentas"], "games": rec["games"], "winRate": round(wr, 3), "kda": round(kda, 2)}


# ---- the Training Grounds ----
MAX_RANK = 10        # levels a defender can win from bosses
BOSS_STEP = 0.06     # each boss beaten gives that defender's next one 6% more health
BOSSES = [(0, "Sergeant Honk"), (2, "The Goose Knight"), (4, "Mother Goose"), (7, "The Goose King")]   # by levels won


def boss(d: dict) -> dict:
    """The boss a defender faces next. Its stats sit halfway between the defender's own and an average champion's at
    the same level, so a strong defender is favoured but never sure to win; each level won makes the next boss tougher."""
    lv = d["level"]
    hp = (d.get("baseHp", d["hp"]) + 60 + 6 * lv) / 2     # a spa perk makes the defender stronger, not its boss
    atk = (d.get("baseAtk", d["atk"]) + 9.6 + 0.4 * lv) / 2
    name = next(n for r, n in reversed(BOSSES) if d["rank"] >= r)
    return {"name": name, "level": lv, "hp": round(6 * atk * (1 + BOSS_STEP * d["rank"])), "atk": round(hp / 7, 1)}


def boss_fight(d: dict, seed, max_rounds: int = 20) -> dict:
    """One defender against its boss, fought automatically. Returns the fight report."""
    rng = random.Random(f"boss-{seed}-{d['champion']}")
    b = boss(d)
    hp, bhp, a, cls = d["hp"], b["hp"], d["atk"], d["cls"]
    log, steps, used_ult = [], [], False   # steps: what happened each round, for the page to play back
    roll = lambda: rng.uniform(0.7, 1.3)
    rounds = 0
    for rounds in range(1, max_rounds + 1):
        step = {"round": rounds, "moves": []}
        steps.append(step)
        if d["pentas"] and not used_ult and rounds >= 2:
            used_ult, dmg = True, a * 3
            step["moves"].append("ult")
            log.append(f"Round {rounds}: {d['champion']} used a pentakill ultimate!")
        else:
            dmg = a * {"tank": 0.9, "mage": 1.1, "marksman": 1.15, "support": 0.9, "fighter": 1.0, "assassin": 1.1}[cls]
            if cls == "assassin" and rounds == 1:
                dmg *= 1.5
                step["moves"].append("first")
                log.append(f"Round 1: {d['champion']} struck first from the shadows.")
            if rng.random() < min(0.1 * d["triples"] + 0.15 * d["quadras"], 0.3):
                dmg *= 2
                step["moves"].append("double")
                log.append(f"Round {rounds}: {d['champion']} landed a double hit.")
        hit = dmg * roll() + (2 if d["star"] == 3 else 0)   # S+: a flame aura
        bhp -= hit
        step["hit"] = round(hit)
        if cls in ("fighter", "support"):
            healed = min(d["hp"], hp + a * (0.2 if cls == "fighter" else 0.4)) - hp
            hp += healed
            step["heal"] = round(healed)
        step.update(bossHp=max(0, round(bhp)), hp=max(0, round(hp)))
        if bhp <= 0:
            log.append(f"Round {rounds}: {b['name']} is beaten! {d['champion']} goes up a level.")
            break
        bite = b["atk"] * roll() * (0.75 if cls == "tank" else 1)
        if rounds % 3 == 0:
            bite *= 1.6
            step["moves"].append("honk")
            log.append(f"Round {rounds}: {b['name']} let out a Honk of Doom.")
        hp -= bite
        step.update(bite=round(bite), hp=max(0, round(hp)))
        if hp <= 0:
            log.append(f"Round {rounds}: {d['champion']} was knocked out.")
            break
        if rounds in (1, 5, 10, 15):
            log.append(f"Round {rounds}: {b['name']} has {max(0, round(bhp))} of {b['hp']} health left.")
    else:
        log.append(f"{b['name']} outlasted {d['champion']} and waddled off.")
    return {"win": bhp <= 0, "rounds": rounds, "champion": d["champion"], "cls": cls, "boss": b,
            "hp": d["hp"], "hpLeft": max(0, round(hp)), "bossLeft": max(0, round(bhp)), "log": log[-12:], "steps": steps}



# ---- the Spa: recovery soaks ----
SALTS = {   # salt -> (name, what its perk does)
    "eucalyptus": ("Eucalyptus salts", "more health"),
    "chili": ("Chili salts", "more attack"),
    "golden": ("Golden salts", "more breadcrumbs and feathers from its next raid win"),
}
TEMPS = {   # temperature -> (name, breadcrumbs, minutes soaking, perk strength)
    "warm": ("Warm", 400, 60, 0.15),
    "hot": ("Hot", 1200, 120, 0.30),
    "scalding": ("Scalding", 3000, 180, 0.50),
}
FIRE_HEAT, MAX_HEAT = 0.05, 0.5   # each caught fire duck makes every perk 5% stronger, up to 50%


def heat(s: dict) -> float:
    return round(min(FIRE_HEAT * len(s["caught"]), MAX_HEAT), 2)


def perk_power(s: dict, salt: str, temp: str) -> float:
    """How strong a soak's perk is: +15% / 30% / 50% health or attack, twice that in raid rewards for golden salts."""
    return round(TEMPS[temp][3] * (2 if salt == "golden" else 1) * (1 + heat(s)), 3)


def finish_soaks(s: dict, now: int) -> list:
    """Defenders whose soak is over come out refreshed. Returns their soaks."""
    done = [x for x in s["soaks"] if x["until"] <= now]
    s["soaks"] = [x for x in s["soaks"] if x["until"] > now]
    for x in done:
        s["perks"][x["champion"]] = {"salt": x["salt"], "temp": x["temp"], "power": x["power"]}
    return done


def with_perk(d: dict, perk) -> dict:
    """A defender with its spa perk applied. Its boss is still built from its own stats (baseHp, baseAtk)."""
    if not perk:
        return d
    d = dict(d, perk=perk, baseHp=d["hp"], baseAtk=d["atk"])
    if perk["salt"] == "eucalyptus":
        d["hp"] = round(d["hp"] * (1 + perk["power"]))
    elif perk["salt"] == "chili":
        d["atk"] = round(d["atk"] * (1 + perk["power"]), 1)
    return d


# ---- the Bakery: sweet treats, one for each class ----
# class -> (treat, machine, bakery level that unlocks the machine, machine's breadcrumbs, treat's breadcrumbs,
#           badges each treat uses up, minutes baking)
TREATS = {
    "marksman": ("Bullseye donuts", "Donut fryer", 1, 600, 150, {"triple": 3, "crit": 1}, 45),
    "fighter": ("Brawler's cinnamon rolls", "Dough mixer", 2, 1200, 250, {"triple": 2, "quadra": 1}, 60),
    "support": ("Healing honey cakes", "Honey oven", 3, 2500, 400, {"lifeline": 1, "everywhere": 1}, 60),
    "mage": ("Arcane macarons", "Enchanted piping bench", 5, 6000, 600, {"untouch": 1, "triple": 2}, 75),
    "tank": ("Fortress fruitcake", "Stone oven", 7, 15000, 900, {"wall": 1, "triple": 2}, 90),
    "assassin": ("Shadow truffles", "Chocolate tempering machine", 9, 40000, 1500, {"quadra": 1, "midas": 1}, 90),
}
MACHINE_SPEEDS = 5      # speed upgrades per machine; the nth needs bakery level 2n
MACHINE_SPEEDUP = 0.8   # each one: 20% less time baking
SPEED_COST = 0.5        # the first speed upgrade costs half the machine ...
SPEED_GROWTH = 1.8      # ... and each one after 80% more
MAX_MACHINES = 5        # of each machine, once its speed upgrades are done: each bakes a batch at the same time
EXTRA_MIN, EXTRA_TIMES, EXTRA_GROWTH = 100000, 25, 3   # the second costs 25 machines (at least 100,000), each after 3x more


def bake_minutes(treat: str, speed: int) -> float:
    return TREATS[treat][6] * MACHINE_SPEEDUP ** speed   # 60 min, 48, 38 ... 20 min at speed 5


def speed_needs(speed: int):
    """The bakery level the next speed upgrade needs, from `speed`; None at the top."""
    return None if speed >= MACHINE_SPEEDS else 2 * (speed + 1)


def speed_cost(treat: str, speed: int):
    return None if speed >= MACHINE_SPEEDS else round(TREATS[treat][3] * SPEED_COST * SPEED_GROWTH ** speed)


def extra_machine_cost(treat: str, count: int):
    """Breadcrumbs for another of this machine, with `count` already; None at the most. 100k, 300k, 900k, 2.7M for the
    cheaper machines; 1M, 3M, 9M, 27M for the chocolate tempering machine."""
    return None if count >= MAX_MACHINES else round(max(EXTRA_MIN, TREATS[treat][3] * EXTRA_TIMES) * EXTRA_GROWTH ** (count - 1))


def badges_left(earned: dict, spent: dict) -> dict:
    """Badges still to spend in Ductopia: earned (as in the badge showcase) minus those the bakery has used up."""
    return {b: max(0, n - spent.get(b, 0)) for b, n in earned.items()}


def finish_bakes(s: dict, now: int) -> list:
    """Batches that are done baking go into the pantry. Returns [(treat, how many batches)]."""
    out = []
    for t, untils in list(s["bakes"].items()):
        n = sum(1 for u in untils if u <= now)
        if n:
            s["treats"][t] = s["treats"].get(t, 0) + n
            out.append((t, n))
        if n == len(untils):
            del s["bakes"][t]
        elif n:
            s["bakes"][t] = [u for u in untils if u > now]
    return out


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
            "levels": dict(START_LEVELS), "ducklings": [], "lost": 0, "spawned": 0, "hats": {}, "pond": STARTING_DUCKS, "birds": [0] * (len(BIRDS) - 1), "edge": 0,
            "golden": 0, "boost": 0.0, "champs": {}, "fire": 0, "graded": {}, "games": [], "raids": [], "raidWins": 0,
            "squad": [], "training": {}, "ranks": {}, "challenges": [], "bossFights": [], "soaks": [], "perks": {},
            "machines": {}, "machineCount": {}, "bakes": {}, "treats": {}, "spentBadges": {}, "caught": [], "seasonFire": {}, "log": [], "founding": None}


def fresh_start(s: dict, now: int) -> dict:
    """The Duck Lab's fresh start: breadcrumbs, ducks, buildings and defenders back to the beginning. Kept: the
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
    """One game's badge rewards (new ducks come from the Duck Lab, not wins). Returns what happened."""
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
        s["fire"] += 1   # S+ games (see first_graded)
        if cur != "S+" and champion not in s.get("seasonFire", {}):   # (not already unlocked by a season-best S+)
            got.append(f"a wild {champion} fire duck at the volcano")
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
    def __init__(self, storage, stats, tracker, client, season=None):
        """season: the S Rank Challenge's grades (season.SeasonGrades), whose S+ grades unlock fire ducks too."""
        self.storage, self.stats, self.tracker, self.client, self.season = storage, stats, tracker, client, season
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
            for x in finish_soaks(data["players"][p.key], now):
                self._note(data["players"][p.key], now, f"{x['champion']} came out of the spa refreshed: {SALTS[x['salt']][1]}.")
            for t, n in finish_bakes(data["players"][p.key], now):
                self._note(data["players"][p.key], now, f"The {TREATS[t][1].lower()} finished a batch of {TREATS[t][0].lower()}." if n == 1
                           else f"The {TREATS[t][1].lower()}s finished {n} batches of {TREATS[t][0].lower()}.")
            self._season_fire(data["players"][p.key], p, now)
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
                eggs = WIN_EGGS if r.get("win") else GAME_EGGS
                s["lost"] += eggs   # into free nests below (_fill_nests), or they wait for one
                got.append(f"{eggs} egg{'s' if eggs > 1 else ''} in the Duck Lab")
                if r.get("win"):
                    s["crates"] = s.get("crates", 0) + 1
                    got.append("a special delivery")
                recs = champion_records(rows.get(key, []))
                squad = self._squad(s, recs, classes)
                if r.get("win"):
                    won = win_crumbs(s) * boost
                    s["crumbs"] += won
                    got.insert(0, f"{round(won):,} breadcrumbs")
                    if s["ranks"].get(r["champion"], 0) < MAX_RANK:
                        s["challenges"].append(r["champion"])   # a win on any champion: a boss challenge in the Training Grounds
                        got.append("a Training Grounds challenge")
                if got:
                    self._note(s, now, f"{'Won' if r.get('win') else 'Played'} on {r['champion']}: {', '.join(got)}.")
                if squad:
                    rep = raid(squad, mid, data["raids"], s["levels"]["fence"])
                    golden = sum(d["perk"]["power"] for d in squad if d.get("perk", {}).get("salt") == "golden")
                    self._reward(s, rep, boost, golden)
                    for d in squad:   # spa perks last one raid
                        s["perks"].pop(d["champion"], None)
                    rep.update(matchId=mid, t=now, champion=r["champion"])
                    s["raids"] = ([rep] + s["raids"])[:MAX_REPORTS]
                    self._note(s, now, "Goose raid: " + (f"won! +{rep['reward']['crumbs']:,} breadcrumbs, +{rep['reward']['feathers']} feathers"
                                                         if rep["win"] else f"lost. The geese took {rep['stolen']:,} breadcrumbs."))
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

    def _season_fire(self, s: dict, player, now: int):
        """Fire ducks unlocked by a season-best S+ (the S Rank Challenge's grades, from any game). They stay unlocked."""
        if not self.season:
            return
        try:
            catalog = self.client.ensure_champions()
        except Exception:
            catalog = self.client.champions
        new = []
        for cid, g in self.season.saved_best(player).items():
            c = catalog.alias_of(cid)
            if (g or "").upper() != "S+" or c == str(cid) or c in wild_and_caught(s):   # (an unknown champion id stays out)
                continue
            s["seasonFire"][c] = now
            new.append(c)
        if new:
            self._note(s, now, f"{'Wild fire ducks' if len(new) > 1 else 'A wild fire duck'} appeared at the volcano, from "
                               f"season-best S+ grades: {', '.join(new)}.")

    def _found(self, player, rows: list, now: int) -> dict:
        s = new_utopia(player.riot_id, now)
        summary = {"games": 0, "wins": 0, "boosts": 0, "golden": 0, "champs": 0, "fire": 0}
        for r in sorted(rows, key=lambda r: r.get("start") or 0):
            s["games"].append(r["matchId"])
            if r.get("remake"):
                continue
            before = (s["golden"], len(s["champs"]), len(wild_and_caught(s)))
            apply_badges(s, r)
            summary["games"] += 1
            summary["wins"] += 1 if r.get("win") else 0
            summary["boosts"] += (r.get("triples") or 0) + (r.get("quadras") or 0)
            summary["golden"] += s["golden"] - before[0]
            summary["champs"] += len(s["champs"]) - before[1]
            summary["fire"] += len(wild_and_caught(s)) - before[2]
        s["founding"] = summary
        self._note(s, now, f"Founding Day: {summary['games']} games together replayed.")
        return s

    def _squad(self, s: dict, recs: dict, classes: dict) -> list:
        """The five defenders: the chosen squad, filled up with the most-played champions. Champions soaking in the spa
        sit out, and others fill in for them."""
        soaking = {x["champion"] for x in s["soaks"]}
        chosen = [c for c in s["squad"] if c in recs and c not in soaking][:5]
        for c in sorted(recs, key=lambda c: (-recs[c]["games"], c)):
            if len(chosen) >= 5:
                break
            if c not in chosen and c not in soaking:
                chosen.append(c)
        return [self._defender(s, c, recs, classes) for c in chosen]

    @staticmethod
    def _defender(s: dict, c: str, recs: dict, classes: dict) -> dict:
        return with_perk(defender(c, recs[c], classes.get(c, "fighter"), s["training"].get(c, 0), s["ranks"].get(c, 0)),
                         s["perks"].get(c))

    def _reward(self, s: dict, rep: dict, boost: float, golden: float = 0):
        """golden: the bonus from defenders with golden spa salts (0.6 = +60%)."""
        if rep["win"]:
            s["raidWins"] += 1
            crumbs, feathers = round(max(30 * rep["total"], crumb_rate(s) * RAID_MINUTES) * boost * (1 + golden)), round((1 + rep["wave"] // 5) * boost * (1 + golden))
            s["crumbs"] += crumbs
            s["feathers"] += feathers
            rep["reward"], rep["stolen"] = {"crumbs": crumbs, "feathers": feathers}, 0
        else:
            stolen = round(min(s["crumbs"] * 0.15, max(500, crumb_rate(s) * STEAL_MINUTES)))
            s["crumbs"] -= stolen
            rep["reward"], rep["stolen"] = {"crumbs": 0, "feathers": 0}, stolen

    @staticmethod
    def _note(s: dict, now: int, text: str):
        s["log"] = ([{"t": now, "text": text}] + s["log"])[:MAX_LOG]

    # ---- what you can do ----
    def _do(self, s: dict, body: dict, player, now: int, data: dict) -> dict:
        action = body.get("action")
        rows = self.stats.together([player]) if action in ("squad", "train", "practice", "hat", "challenge", "spar", "soak") else {}
        recs = champion_records(rows.get(player.key, []))
        if action == "upgrade":
            b = body.get("building")
            if b not in BUILDINGS:
                raise ValueError("There's no such building.")
            cost = upgrade_cost(b, s["levels"][b], top_level(s, b))
            if cost is None:
                more = next_unlock(s, b)
                raise ValueError(f"More levels open when your pond grows into {more}." if more else "That's already as big as it gets.")
            if b == "autonest" and (s["levels"]["science"] < AUTONEST_SCIENCE or s["levels"]["pond"] < AUTONEST_POND):
                raise ValueError(f"The Auto-nester needs Duck Science level {AUTONEST_SCIENCE} and the lagoon (pond level {AUTONEST_POND}).")
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
            auto_nest(s, now)   # a new Auto-nester, or more nests for it, fills them straight away
            name, level = building_name(b, s["levels"][b]), s["levels"][b]
            self._note(s, now, f"Built the {name}." if level == 1 or name != building_name(b, level - 1)
                       else f"Upgraded the {name} to level {level}.")
            return {"built": name, "level": level}
        if action == "spawn":
            if len(s["ducklings"]) + s["lost"] >= nest_space(s["levels"]["nests"]):
                raise ValueError("The nests are full: upgrade the nests, or wait for a duckling to grow.")
            cost = spawn_cost(flock(s))
            if s["crumbs"] < cost:
                raise ValueError(f"Not enough breadcrumbs: {cost:,} needed.")
            s["crumbs"] -= cost
            s["spawned"] += 1
            s["ducklings"].append(now + round(grow_minutes(s["levels"]["incubation"]) * 60000))
            return {"spawned": s["spawned"]}
        if action == "openCrate":   # a special delivery from a win: what's inside was settled when it dropped
            if not s.get("crates"):
                raise ValueError("No special deliveries to open: win a game together to get one.")
            before = discovered(s)
            loot = open_crate(s, now)
            s["discovered"] = discovered(s)
            self._note(s, now, f"Opened a special delivery: {loot['name']} ({loot['rarity']}).")
            if s["discovered"] > before:
                self._note(s, now, f"The Mystic Marsh: a new bird! A golden egg hatched into a {BIRDS[s['discovered']][1].lower()}.")
            return {"loot": loot, "crates": s["crates"]}
        if action == "autonest":   # turn the Auto-nester on or off
            if not s["levels"]["autonest"]:
                raise ValueError("Build the Auto-nester first.")
            s["autoOn"] = bool(body.get("on"))
            if s["autoOn"]:
                auto_nest(s, now)
            return {"autoOn": s["autoOn"]}
        if action == "clutch":   # a duckling in every free nest at once, a little cheaper
            n, cost = free_nests(s), clutch_cost(s)
            if n < 1:
                raise ValueError("The nests are full: upgrade the nests, or wait for a duckling to grow.")
            if s["crumbs"] < cost:
                raise ValueError(f"Not enough breadcrumbs: {cost:,} needed for a clutch of {n}.")
            s["crumbs"] -= cost
            s["spawned"] += n
            s["ducklings"] += [now + round(grow_minutes(s["levels"]["incubation"]) * 60000)] * n
            self._note(s, now, f"Hatched a clutch of {n} duckling{'s' if n > 1 else ''} in the Duck Lab.")
            return {"spawned": s["spawned"], "clutch": n}
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
        if action == "spar":   # a test fight in the Training Grounds: no challenge needed, nothing won or lost
            c = body.get("champion")
            if c not in recs:
                raise ValueError("Only champions you've played together can fight here.")
            if any(x["champion"] == c for x in s["soaks"]):
                raise ValueError(f"{c} is soaking in the spa.")
            d = self._defender(s, c, recs, self._classes())
            rep = boss_fight(d, f"test-{now}")
            rep.update(t=now, level=d["level"], practice=True, perk=d.get("perk"))
            return {"fight": rep}
        if action == "challenge":   # the Training Grounds: one defender against its boss
            c = body.get("champion")
            if c not in s["challenges"]:
                raise ValueError(f"{c} has no challenge waiting: win a game on it to earn one.")
            if c not in recs:
                raise ValueError("Only champions you've played together can fight here.")
            if s["ranks"].get(c, 0) >= MAX_RANK:
                raise ValueError(f"{c} has beaten every boss.")
            if any(x["champion"] == c for x in s["soaks"]):
                raise ValueError(f"{c} is soaking in the spa: the challenge waits until it's out.")
            d = self._defender(s, c, recs, self._classes())
            rep = boss_fight(d, now)
            s["challenges"].remove(c)
            if d.get("perk") and d["perk"]["salt"] != "golden":   # golden salts are for raids, so they keep
                s["perks"].pop(c)
                rep["perk"] = d["perk"]
            if rep["win"]:
                s["ranks"][c] = s["ranks"].get(c, 0) + 1
            rep.update(t=now, level=d["level"] + (1 if rep["win"] else 0))
            s["bossFights"] = ([rep] + s["bossFights"])[:MAX_REPORTS]
            self._note(s, now, f"Training Grounds: {c} beat {rep['boss']['name']} and reached level {rep['level']}." if rep["win"]
                       else f"Training Grounds: {c} lost to {rep['boss']['name']}.")
            return {"fight": rep}
        if action == "soak":   # the Spa: a recovery soak, with bath salts at a temperature
            c, salt, temp = body.get("champion"), body.get("salt"), body.get("temp")
            if not s["levels"]["spa"]:
                raise ValueError("Build the Spa first.")
            if c not in recs:
                raise ValueError("Only champions you've played together can soak here.")
            if salt not in SALTS or temp not in TEMPS:
                raise ValueError("There's no such soak.")
            if any(x["champion"] == c for x in s["soaks"]):
                raise ValueError(f"{c} is already soaking.")
            if c in s["perks"]:
                raise ValueError(f"{c} is already refreshed: its perk is used up by its next raid or boss fight.")
            if len(s["soaks"]) >= s["levels"]["spa"]:
                raise ValueError("Every pool is taken: wait for a soak to finish" + (", or build the Hot springs." if s["levels"]["spa"] < 2 else "."))
            name, cost, minutes, _ = TEMPS[temp]
            if s["crumbs"] < cost:
                raise ValueError(f"Not enough breadcrumbs: {cost:,} needed.")
            s["crumbs"] -= cost
            soak = {"champion": c, "salt": salt, "temp": temp, "power": perk_power(s, salt, temp), "start": now,
                    "until": now + minutes * 60000}
            s["soaks"].append(soak)
            self._note(s, now, f"{c} is soaking in a {name.lower()} bath with {SALTS[salt][0].lower()}.")
            return {"soak": soak}
        if action == "lure":   # the Volcano Spa: a treat lures a wild fire duck of its class, and it's caught
            cls = body.get("treat")
            if cls not in TREATS:
                raise ValueError("There's no such treat.")
            name = TREATS[cls][0]
            wild = wild_fire_ducks(s, cls, self._classes())
            if not wild:
                raise ValueError(f"There are no wild {cls} fire ducks to lure: an S+ on a {cls} champion unlocks one.")
            if s["treats"].get(cls, 0) < 1:
                raise ValueError(f"No {name.lower()} in the pantry: bake some in the Bakery.")
            s["treats"][cls] -= 1
            c = random.Random(f"{s['riotId']}-{now}").choice(wild)
            s["caught"].append(c)
            self._note(s, now, f"Lured a wild fire duck with {name.lower()}: caught {c}'s fire duck!")
            return {"caught": c, "treat": cls}
        if action in ("machine", "speed", "extra", "bake"):   # the Bakery
            t = body.get("treat")
            if t not in TREATS:
                raise ValueError("There's no such treat.")
            name, machine, unlock, machine_cost, crumbs, recipe, _ = TREATS[t]
            bakery = s["levels"]["bakery"]
            if action == "machine":
                if t in s["machines"]:
                    raise ValueError(f"You already have the {machine.lower()}.")
                if bakery < unlock:
                    raise ValueError(f"The {machine.lower()} needs bakery level {unlock}.")
                cost = machine_cost
            elif t not in s["machines"]:
                raise ValueError(f"Buy the {machine.lower()} first.")
            elif action == "speed":
                speed = s["machines"][t]
                cost, needs = speed_cost(t, speed), speed_needs(speed)
                if cost is None:
                    raise ValueError(f"The {machine.lower()} is as fast as it gets.")
                if bakery < needs:
                    raise ValueError(f"The next speed upgrade needs bakery level {needs}.")
            elif action == "extra":
                count = s["machineCount"].get(t, 1)
                if s["machines"][t] < MACHINE_SPEEDS:
                    raise ValueError(f"Finish the {machine.lower()}'s speed upgrades first.")
                cost = extra_machine_cost(t, count)
                if cost is None:
                    raise ValueError(f"There's no room for more than {MAX_MACHINES} of the {machine.lower()}.")
            else:
                if len(s["bakes"].get(t, [])) >= s["machineCount"].get(t, 1):
                    raise ValueError(f"Every {machine.lower()} is already baking." if s["machineCount"].get(t, 1) > 1
                                     else f"The {machine.lower()} is already baking.")
                left = badges_left(badge_counts(self.stats.together(self.tracker.players())).get(player.key, {}), s["spentBadges"])
                short = [f"{n - left.get(b, 0)} more {BADGE_INFO[b][1]}" for b, n in recipe.items() if left.get(b, 0) < n]
                if short:
                    raise ValueError(f"Not enough badges: {', '.join(short)} needed.")
                cost = crumbs
            if s["crumbs"] < cost:
                raise ValueError(f"Not enough breadcrumbs: {cost:,} needed.")
            s["crumbs"] -= cost
            if action == "machine":
                s["machines"][t] = 0
                self._note(s, now, f"Bought the {machine.lower()} for the bakery.")
                return {"machine": t}
            if action == "speed":
                speed = s["machines"][t] = s["machines"][t] + 1
                if t in s["bakes"]:   # the batches in it speed up too
                    s["bakes"][t] = [now + round(max(0, u - now) * MACHINE_SPEEDUP) for u in s["bakes"][t]]
                self._note(s, now, f"Sped up the {machine.lower()} to level {speed}.")
                return {"speed": speed}
            if action == "extra":
                count = s["machineCount"][t] = s["machineCount"].get(t, 1) + 1
                self._note(s, now, f"Bought another {machine.lower()}: {count} batches of {name.lower()} can bake at once.")
                return {"machines": count}
            for b, n in recipe.items():
                s["spentBadges"][b] = s["spentBadges"].get(b, 0) + n
            until = now + round(bake_minutes(t, s["machines"][t]) * 60000)
            s["bakes"][t] = sorted(s["bakes"].get(t, []) + [until])
            self._note(s, now, f"Started baking {name.lower()} ({', '.join(f'{n} {BADGE_INFO[b][1]}' for b, n in recipe.items())}).")
            return {"baking": t, "until": until}
        if action in ("merge", "mergeAll"):   # the Mystic Marsh: two of a kind in, one of the next kind out
            before = discovered(s)
            made = merge_birds(s, body.get("tier"), action == "mergeAll")
            _fill_pond(s)   # merging frees pond spots: ducks waiting at the edge move in
            s["discovered"] = discovered(s)
            if action == "mergeAll" and made:
                self._note(s, now, f"The Mystic zapped {sum(made.values())} pair{'s' if sum(made.values()) != 1 else ''} in the Mystic Marsh.")
            for t in range(before + 1, s["discovered"] + 1):   # newest first in the log: these go on top
                self._note(s, now, f"The Mystic Marsh: a new bird! Two {BIRDS[t - 1][1].lower()}s became a {BIRDS[t][1].lower()}.")
            return {"made": made}
        raise ValueError("Unknown action.")

    # ---- what the page gets ----
    def _view(self, data: dict, viewer: bool, now: int) -> dict:
        players = self.tracker.players()
        rows = self.stats.together(players) if players else {}
        classes = self._classes()
        scores = [score(data["players"][p.key]) for p in players if p.key in data["players"]]
        best = max(scores) if scores else 0
        earned = badge_counts(rows)
        out = []
        for i, p in enumerate(players):
            s = data["players"].get(p.key)
            if not s:
                continue
            recs = champion_records(rows.get(p.key, []))
            lv = s["levels"]
            squad = [{**d, "boss": boss(d), "maxRank": d["rank"] >= MAX_RANK} for d in self._squad(s, recs, classes)]
            out.append({
                **{k: s[k] for k in ("riotId", "feathers", "levels", "lost", "spawned", "hats", "pond", "birds", "edge", "golden", "boost",
                                     "champs", "fire", "caught", "raids", "raidWins", "training", "ranks", "challenges", "bossFights", "soaks", "perks",
                                     "log", "founding", "founded")},
                "crumbs": round(s["crumbs"], 2), "ducklings": sorted(s["ducklings"]),
                "score": scores[i], "catchUp": catch_up(scores[i], best), "leading": len(scores) > 1 and scores[i] == best and scores.count(best) == 1,
                "rate": round(crumb_rate(s), 3), "rateFrom": rate_breakdown(s), "heat": heat(s), "nestSpace": nest_space(lv["nests"]), "pondSpace": pond_space(lv["pond"]), "pondUsed": pond_used(s), "edgeSpace": edge_space(s), "population": population(s), "crates": s.get("crates", 0), "discovered": discovered(s),
                "districts": districts(s), "boostFrom": boost_breakdown(s, rows.get(p.key, [])),
                "plaza": penta_plaza(s, rows.get(p.key, [])), "volcano": fire_ducks(s, rows.get(p.key, []), classes),
                "lab": {"spawnCost": spawn_cost(flock(s)), "clutchCost": clutch_cost(s), "freeNests": free_nests(s), "clutchDiscount": CLUTCH_DISCOUNT, "autoOn": s.get("autoOn", True), "autoSpawned": s.get("autoSpawned", 0), "autoScience": AUTONEST_SCIENCE, "autoPond": AUTONEST_POND, "flock": flock(s), "lucky": lucky_chance(s), "gameEggs": GAME_EGGS, "winEggs": WIN_EGGS,
                        "grow": grow_minutes(lv["incubation"]),
                        "growNext": grow_minutes(lv["incubation"] + 1) if upgrade_cost("incubation", lv["incubation"], top_level(s, "incubation")) is not None else None,
                        "nestSpaceNext": nest_space(lv["nests"] + 1)},
                "bakery": {"earned": earned.get(p.key, {}), "badges": badges_left(earned.get(p.key, {}), s["spentBadges"]),
                           "spent": s["spentBadges"], "treats": s["treats"], "bakes": s["bakes"],
                           "machines": {t: {"speed": sp, "minutes": bake_minutes(t, sp), "speedCost": speed_cost(t, sp),
                                            "speedNeeds": speed_needs(sp),
                                            "nextMinutes": bake_minutes(t, sp + 1) if sp < MACHINE_SPEEDS else None,
                                            "count": s["machineCount"].get(t, 1),
                                            "extraCost": extra_machine_cost(t, s["machineCount"].get(t, 1))}
                                        for t, sp in s["machines"].items()}},
                "buildings": {b: {"level": lv[b], "name": building_name(b, lv[b]) if lv[b] else None,
                                  "next": building_name(b, lv[b] + 1) if upgrade_cost(b, lv[b], top_level(s, b)) is not None else None,
                                  "cost": upgrade_cost(b, lv[b], top_level(s, b)), "top": top_level(s, b), "unlocks": next_unlock(s, b)}
                              for b in BUILDINGS},
                "squad": squad,
                "challengers": [{**d, "boss": boss(d), "maxRank": d["rank"] >= MAX_RANK}   # champions off the squad with a challenge waiting
                                for d in (self._defender(s, c, recs, classes) for c in dict.fromkeys(s["challenges"])
                                          if c in recs and c not in {x["champion"] for x in squad})],
                "champions": sorted(({"champion": c, "cls": classes.get(c, "fighter"), "games": r["games"]}
                                     for c, r in recs.items()), key=lambda x: (-x["games"], x["champion"])),
            })
        return {"now": now, "me": 1 if viewer else 0, "players": out, "goldenRate": GOLDEN_RATE, "fireRate": FIRE_RATE, "winCrumbs": WIN_CRUMBS, "winMinutes": WIN_MINUTES, "raidMinutes": RAID_MINUTES,
                "scienceBoost": SCIENCE_BOOST,
                "cityStages": [{"name": n, "first": city_stage(last)[1], "last": last} for n, last, _, _ in CITY_STAGES], "marshBirds": [{"id": k, "name": n, "rate": bird_rate(i)} for i, (k, n) in enumerate(BIRDS)],
                "hatShop": [{"id": h, "name": n, "cost": c} for h, (n, c) in HATS.items()],
                "salts": [{"id": k, "name": n, "does": does} for k, (n, does) in SALTS.items()],
                "temps": [{"id": k, "name": n, "cost": c, "minutes": m, "power": pw} for k, (n, c, m, pw) in TEMPS.items()],
                "treats": [{"id": t, "name": n, "machine": m, "unlock": u, "machineCost": mc, "crumbs": c,
                            "badges": [[b, k] for b, k in r.items()], "minutes": mins}
                           for t, (n, m, u, mc, c, r, mins) in TREATS.items()],
                "badgeInfo": {b: {"icon": ic, "name": n} for b, (ic, n) in BADGE_INFO.items()}, "speeds": MACHINE_SPEEDS, "maxMachines": MAX_MACHINES}
