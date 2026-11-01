import unittest

from duostats import utopia
from duostats.games import Player
from duostats.utopia import (DuckUtopia, advance, apply_badges, boost_breakdown, boss, boss_fight, catch_up, crumb_rate,
                             defender, goose_wave, heat, perk_power, with_perk,
                             grow_minutes, migrate, new_utopia, penta_plaza, raid, score, spawn_cost, upgrade_cost,
                             first_graded, fire_ducks, late_grades, wild_fire_ducks)
from tests.helpers import TempStorageCase

MIN = 60000


def empty(riot_id="A#1", now=0):
    """A new utopia with an empty pond, to follow ducks through the pipeline."""
    s = new_utopia(riot_id, now)
    s["pond"] = 0
    return s


def row(mid, start, win=True, champion="Annie", **over):
    r = {"matchId": mid, "start": start, "win": win, "champion": champion, "remake": False, "kills": 5, "deaths": 2,
         "assists": 8, "triples": 0, "quadras": 0, "pentas": 0, "grade": None}
    r.update(over)
    return r


class PipelineTests(unittest.TestCase):
    def test_breadcrumbs_come_from_pond_ducks_over_time(self):
        s = new_utopia("A#1", 0)
        s["pond"] = 4
        advance(s, 10 * MIN)
        self.assertAlmostEqual(s["crumbs"], utopia.FOUNDING_GIFT + 4 * utopia.DUCK_RATE * 10)

    def test_duckling_waits_for_a_nest_grows_then_joins_the_pond(self):
        s = empty()
        s["lost"] = utopia.nest_space(1) + 2   # two more than the nests hold
        advance(s, 0)
        self.assertEqual((len(s["ducklings"]), s["lost"]), (utopia.nest_space(1), 2))
        advance(s, utopia.GROW_MINUTES * MIN)          # the first batch grows; the waiting two move in
        self.assertEqual(s["pond"], utopia.nest_space(1))
        self.assertEqual((len(s["ducklings"]), s["lost"]), (2, 0))
        advance(s, 2 * utopia.GROW_MINUTES * MIN)
        self.assertEqual((s["pond"], s["edge"]), (utopia.pond_space(1), 0))   # the pond holds 6: room for all of them
        s["lost"] = utopia.nest_space(1)
        advance(s, 3 * utopia.GROW_MINUTES * MIN)
        self.assertEqual((s["pond"], s["edge"]), (6, utopia.nest_space(1)))   # now it's full: a clutch's worth waits at the edge
        s["lost"] = 2
        advance(s, 4 * utopia.GROW_MINUTES * MIN)
        self.assertEqual((s["edge"], s["waddled"]), (utopia.nest_space(1), 2))   # the edge is full too: these two waddle off
        self.assertIn("2 ducklings grew up with no room in the pond or at its edge and waddled off", s["log"][0]["text"])
        s["levels"]["pond"] = 2
        advance(s, 4 * utopia.GROW_MINUTES * MIN + 1)
        self.assertEqual((s["pond"], s["edge"]), (10, 0))   # a bigger pond: the ducks at the edge move in first

    def test_a_pond_already_over_its_size_keeps_its_ducks(self):
        s = empty()
        s.update(pond=40, edge=30)   # from before: more in the pond and at the edge than there's room for now
        s["lost"] = 1
        advance(s, 0)
        advance(s, utopia.GROW_MINUTES * MIN)
        self.assertEqual((s["pond"], s["edge"], s["waddled"]), (40, 30, 1))   # nobody already there leaves; the new duck waddles off

    def test_new_pond_ducks_collect_from_when_they_arrive(self):
        s = empty()
        s["crumbs"], s["lost"] = 0, 1
        advance(s, 0)
        advance(s, (utopia.GROW_MINUTES + 10) * MIN)
        self.assertAlmostEqual(s["crumbs"], 10 * utopia.DUCK_RATE)   # nothing while it was a duckling

    def test_bakery_and_boost_multiply(self):
        s = new_utopia("A#1", 0)
        s.update(pond=10, boost=0.5)
        s["levels"]["bakery"] = 2
        self.assertAlmostEqual(crumb_rate(s), 10 * 1.25 ** 2 * 1.5)   # bakery levels compound

    def test_bakery_compounds(self):
        s = new_utopia("A#1", 0)
        s["pond"] = 10
        s["levels"]["bakery"] = 10
        self.assertAlmostEqual(crumb_rate(s), 10 * 1.25 ** 10)   # x9.3, where +25% a level gave x3.5

    def test_duck_science_multiplies_pond_ducks_only(self):
        s = new_utopia("A#1", 0)
        s.update(pond=10, golden=1)
        s["levels"]["science"] = 2
        self.assertAlmostEqual(crumb_rate(s), 10 * 1.5 ** 2 + utopia.GOLDEN_RATE)
        self.assertEqual(utopia.upgrade_cost("science", 0), 1000)
        self.assertEqual(utopia.upgrade_cost("science", 2), 9000)

    def test_win_rewards_grow_with_income(self):
        s = new_utopia("A#1", 0)
        s["pond"] = 1
        self.assertEqual(utopia.win_crumbs(s), utopia.WIN_CRUMBS)   # early on: the flat amount
        s["pond"] = 100
        self.assertEqual(utopia.win_crumbs(s), crumb_rate(s) * utopia.WIN_MINUTES)   # later: half an hour of breadcrumbs

    def test_rate_breakdown_adds_up(self):
        s = new_utopia("A#1", 0)
        s.update(pond=10, golden=2, champs={"Lux": "S", "Nami": "S+"}, caught=["Nami"], boost=0.5)
        s["levels"]["bakery"] = 2
        b = utopia.rate_breakdown(s)
        self.assertEqual([(x["id"], x["count"]) for x in b["sources"]], [("pond", 10), ("marsh", 0), ("golden", 2), ("champion", 2), ("fire", 1)])
        self.assertAlmostEqual(b["base"], sum(x["perMin"] for x in b["sources"]))
        self.assertAlmostEqual(b["total"], b["base"] * (1 + b["bakery"]) * (1 + b["boost"]))
        self.assertAlmostEqual(b["total"], crumb_rate(s))


class MarshTests(unittest.TestCase):
    def test_two_of_a_kind_become_one_of_the_next(self):
        s = new_utopia("A#1", 0)
        s["pond"] = 5
        self.assertEqual(utopia.merge_birds(s, 0), {1: 1})
        self.assertEqual((s["pond"], s["birds"][0], utopia.pond_used(s)), (3, 1, 4))   # a spot freed
        with self.assertRaises(ValueError):   # only one mallard
            utopia.merge_birds(s, 1)
        with self.assertRaises(ValueError):   # royal swans are the top
            utopia.merge_birds(s, len(utopia.BIRDS) - 1)

    def test_merging_everything_cascades_and_keeps_the_score(self):
        s = new_utopia("A#1", 0)
        s["pond"] = 8
        before = score(s)
        self.assertEqual(utopia.merge_birds(s, None, every=True), {1: 4, 2: 2, 3: 1})   # 8 ducks -> 1 wood duck
        self.assertEqual((s["pond"], s["birds"][:3]), (0, [0, 0, 1]))
        self.assertEqual(score(s), before)   # a bird counts as the ducks that went into it

    def test_each_kind_collects_more_and_duck_science_multiplies_them(self):
        s = new_utopia("A#1", 0)
        s.update(pond=2, birds=[1, 0, 1, 0, 0, 0, 0, 0])
        s["levels"]["science"] = 1
        self.assertAlmostEqual(crumb_rate(s), (2 + utopia.MARSH_STEP + utopia.MARSH_STEP ** 3) * utopia.SCIENCE_BOOST)
        self.assertAlmostEqual(utopia.bird_rate(1), 2 * 1.1)   # 10% more than the two ducks

    def test_birds_take_pond_spots(self):
        s = empty()
        s["birds"] = [utopia.pond_space(1)] + [0] * (len(utopia.BIRDS) - 2)   # a pond full of mallards
        s["lost"] = 1
        advance(s, 0)
        advance(s, utopia.GROW_MINUTES * MIN)
        self.assertEqual((s["pond"], s["edge"]), (0, 1))   # no room: the new duck waits at the edge


    def test_the_new_ducks_sit_below_the_swans_and_old_saves_keep_their_worth(self):
        self.assertEqual([k for k, _ in utopia.BIRDS], ["duck", "mallard", "wood", "baker", "chad", "firefighter", "police", "raver", "dj",
                                                         "swan", "black", "royal"])
        s = new_utopia("A#1", 0)
        s["birds"] = [1, 0, 2, 0, 1]   # saved with the old ladder: a mallard, two swans and a royal swan
        before = (score(s), crumb_rate(s))
        migrate(s)
        self.assertEqual(s["birds"], [1, 0, 2, 0, 1] + [0] * (len(utopia.BIRDS) - 6))   # now a mallard, two baker ducks and a firefighter duck
        self.assertEqual((score(s), crumb_rate(s)), before)


class AutoNesterTests(unittest.TestCase):
    def nester(self, crumbs, pond=5):
        s = new_utopia("A#1", 0)
        s.update(crumbs=float(crumbs), pond=pond)
        s["levels"]["autonest"] = 1
        return s

    def test_it_fills_empty_nests_when_it_can_pay(self):
        s = self.nester(10000)
        advance(s, 0)
        self.assertEqual(len(s["ducklings"]), utopia.nest_space(1))
        self.assertEqual(s["autoSpawned"], utopia.nest_space(1))
        self.assertLess(s["crumbs"], 10000)

    def test_it_refills_a_nest_as_soon_as_a_duckling_grows(self):
        s = self.nester(10000, pond=0)
        advance(s, 0)
        grow = utopia.GROW_MINUTES * MIN
        advance(s, grow + 5 * MIN)   # the first batch grew at `grow`: the nests filled again right then
        self.assertEqual(s["pond"] + s["birds"][0], utopia.nest_space(1))
        self.assertEqual(sorted(s["ducklings"]), [2 * grow] * utopia.nest_space(1))

    def test_it_waits_until_it_can_afford_one(self):
        s = self.nester(0)
        s["pond"] = 10   # 10 a minute; a duckling costs spawn_cost(10)
        advance(s, 0)
        self.assertEqual(s["ducklings"], [])
        cost = spawn_cost(utopia.flock(s))
        advance(s, 60 * MIN)
        first = min(s["ducklings"])
        self.assertAlmostEqual(first - utopia.GROW_MINUTES * MIN, cost / 10 * MIN, delta=MIN)   # bought the moment it could

    def test_it_can_be_turned_off(self):
        s = self.nester(10000)
        s["autoOn"] = False
        advance(s, 0)
        self.assertEqual(s["ducklings"], [])


class DuckLabTests(unittest.TestCase):
    def test_costs_and_times(self):
        self.assertEqual(spawn_cost(0), utopia.SPAWN_COST)
        self.assertLess(spawn_cost(1) - spawn_cost(0), spawn_cost(50) - spawn_cost(49))   # slow at first, then steep
        self.assertEqual(grow_minutes(0), 8 * 60)
        self.assertLess(grow_minutes(5), grow_minutes(0))

    def test_the_top_incubation_level_grows_a_duckling_in_half_an_hour(self):
        self.assertAlmostEqual(grow_minutes(10), 30)

    def test_ducklings_cost_more_with_a_bigger_flock_and_merging_brings_it_down(self):
        s = new_utopia("A#1", 0)
        self.assertEqual(spawn_cost(utopia.flock(s)), utopia.SPAWN_COST)   # the 5 starting ducks are free of it
        s["pond"] = 6
        expensive = spawn_cost(utopia.flock(s))
        utopia.merge_birds(s, 0)
        self.assertLess(spawn_cost(utopia.flock(s)), expensive)

    def test_some_ducklings_hatch_as_mallards(self):
        s = empty()
        s["levels"]["pond"] = 12
        s["levels"]["nests"] = 12
        s["levels"]["science"] = 15   # (it doesn't touch growing, only the odds: 5% + 1% a level, up to 20%)
        self.assertEqual(utopia.lucky_chance(s), utopia.MAX_LUCKY)
        s["lost"] = utopia.pond_space(12)
        advance(s, 0)
        advance(s, 2 * utopia.GROW_MINUTES * MIN)   # two nestfuls
        self.assertEqual(s["pond"] + s["birds"][0], utopia.pond_space(12))
        self.assertTrue(0 < s["birds"][0] < 25)   # about a fifth of the 50 came out as mallards

    def test_old_utopias_lose_the_timer_but_keep_waiting_ducklings(self):
        s = new_utopia("A#1", 0)
        s.update(held=2, nextSpawn=5)
        s["levels"].update(incubator=3, serum=1)
        del s["spawned"], s["levels"]["incubation"]
        migrate(s)
        self.assertEqual((s["lost"], s["spawned"], s["levels"]["incubation"]), (2, 0, 0))
        self.assertNotIn("incubator", s["levels"])
        self.assertNotIn("nextSpawn", s)


class RewardTests(unittest.TestCase):
    def test_badges(self):
        s = new_utopia("A#1", 0)
        apply_badges(s, row("1", 0, triples=2, quadras=1, pentas=1, grade="S"))
        self.assertEqual((s["lost"], s["golden"], s["champs"]), (0, 1, {"Annie": "S"}))   # a win isn't a duckling any more
        self.assertAlmostEqual(s["boost"], 2 * utopia.TRIPLE_BOOST + utopia.QUADRA_BOOST)
        apply_badges(s, row("2", 0, win=False, grade="S+"))
        self.assertEqual((s["fire"], s["champs"]["Annie"]), (1, "S+"))
        apply_badges(s, row("3", 0, win=False, grade="A"))   # not an S grade: nothing
        self.assertEqual(s["champs"]["Annie"], "S+")

    def test_boost_breakdown_adds_up(self):
        s = new_utopia("A#1", 100)
        rows = [row("1", 50, champion="Draven", triples=2, quadras=1), row("2", 60, champion="Vi", triples=1),
                row("3", 150, champion="Draven", quadras=1), row("4", 160, champion="Vi", triples=5, remake=True),
                row("5", 170, champion="Vi", triples=3)]   # game 5 isn't counted in the utopia yet
        s["games"] = ["1", "2", "3", "4"]
        for r in rows[:4]:
            if not r["remake"]:
                apply_badges(s, r)
        b = boost_breakdown(s, rows)
        self.assertEqual((b["triples"], b["quadras"]), (3, 2))
        self.assertAlmostEqual(b["fromTriples"] + b["fromQuadras"], s["boost"])
        self.assertAlmostEqual(b["sinceFounding"], utopia.QUADRA_BOOST)   # only game 3 came after
        self.assertEqual([c["champion"] for c in b["champions"]], ["Draven", "Vi"])
        self.assertEqual([g["champion"] for g in b["latest"]], ["Draven", "Vi", "Draven"])   # newest first

    def test_penta_plaza_has_a_duck_per_penta_game(self):
        s = new_utopia("A#1", 0)
        rows = [row("3", 30, champion="Vi", pentas=2), row("1", 10, champion="Draven", pentas=1),
                row("2", 20, pentas=0), row("4", 40, champion="Jinx", pentas=1, remake=True),
                row("5", 50, champion="Kayn", pentas=1)]   # game 5 isn't counted in the utopia yet
        s["games"] = ["1", "2", "3", "4"]
        plaza = penta_plaza(s, rows)
        self.assertEqual([(d["champion"], d["pentas"]) for d in plaza], [("Draven", 1), ("Vi", 2)])   # oldest first
        self.assertEqual(plaza[1]["start"], 30)

    def test_a_late_grade_still_earns_its_ducks_once(self):
        s = new_utopia("A#1", 0)
        r = row("1", 10, champion="Lux")
        s["games"] = ["1"]
        apply_badges(s, r)                       # counted before its grade arrived
        self.assertEqual((s["champs"], s["fire"]), ({}, 0))
        r["grade"] = "S"                         # the grade comes in
        self.assertEqual([got for _, got in late_grades(s, [r])], [["a Lux champion duck (S)"]])
        self.assertEqual(late_grades(s, [r]), [])   # and only pays once
        r["grade"] = "S+"                        # a better one later: the upgrade and a fire duck
        late_grades(s, [r]); late_grades(s, [r])
        self.assertEqual((s["champs"], s["fire"]), ({"Lux": "S+"}, 1))

    def test_late_grades_skip_games_not_counted_yet_and_remakes(self):
        s = new_utopia("A#1", 0)
        s["games"] = ["1"]
        self.assertEqual(late_grades(s, [row("2", 20, grade="S+"), row("1", 10, grade="S+", remake=True)]), [])
        self.assertEqual(s["fire"], 0)

    def test_older_utopias_find_the_grades_that_missed_their_ducks(self):
        # rewarded: Sona S+ (champion and fire duck) and Annie S; never rewarded: Lux S (no duck) and Nilah S+ (one fire duck short)
        s = new_utopia("A#1", 0)
        s.pop("graded")
        s.update(games=["1", "2", "3", "4"], champs={"Sona": "S+", "Annie": "S", "Nilah": "S+"}, fire=1)
        rows = [row("1", 10, champion="Sona", grade="S+"), row("2", 20, champion="Annie", grade="S"),
                row("3", 30, champion="Lux", grade="S"), row("4", 40, champion="Nilah", grade="S+")]
        self.assertEqual(first_graded(s, rows), {"1": "S+", "2": "S"})
        got = [(r["champion"], g) for r, g in late_grades(s, rows)]
        self.assertEqual(got, [("Lux", ["a Lux champion duck (S)"]), ("Nilah", [])])   # Nilah's fire duck came with game 1
        self.assertEqual((s["fire"], s["champs"]["Lux"]), (2, "S"))
        self.assertEqual(late_grades(s, rows), [])

    def test_a_fire_duck_for_each_champion_with_an_s_plus(self):
        s = new_utopia("A#1", 0)
        rows = [row("3", 30, champion="Lux", grade="S+"), row("1", 10, champion="Nilah", grade="S+"),
                row("2", 20, champion="Sona", grade="S"), row("4", 40, champion="Jinx", grade="S+", remake=True),
                row("6", 35, champion="Nilah", grade="S+"),
                row("5", 50, champion="Kayn", grade="S+")]   # game 5 isn't counted in the utopia yet
        s["games"] = ["1", "2", "3", "4", "6"]
        got = [apply_badges(s, r) for r in sorted(rows, key=lambda r: r["start"]) if r["matchId"] in s["games"] and not r["remake"]]
        self.assertIn("a wild Nilah fire duck at the volcano", got[0])
        self.assertNotIn("a wild Nilah fire duck at the volcano", got[3])   # her second S+: the same duck
        ducks = fire_ducks(s, rows, {"Lux": "mage", "Nilah": "marksman"})
        self.assertEqual([(d["champion"], d["cls"], d["games"], d["caught"]) for d in ducks],
                         [("Nilah", "marksman", 2, False), ("Lux", "mage", 1, False)])   # oldest first; an S isn't a fire duck
        self.assertEqual(ducks[1]["first"], 30)
        self.assertEqual(wild_fire_ducks(s, "mage", {"Lux": "mage", "Nilah": "marksman"}), ["Lux"])

    def test_wild_fire_ducks_do_nothing_until_caught(self):
        s = new_utopia("A#1", 0)
        s["champs"] = {"Lux": "S+", "Nilah": "S+"}
        s["fire"] = 2
        none = dict(s, fire=0)   # (the S+ games themselves don't count; Lux and Nilah are still champion ducks)
        self.assertEqual((crumb_rate(s), heat(s), score(s)), (crumb_rate(none), 0, score(none)))
        s["caught"] = ["Lux"]
        self.assertAlmostEqual(crumb_rate(s) - crumb_rate(dict(s, caught=[])), utopia.FIRE_RATE)
        self.assertEqual(heat(s), utopia.FIRE_HEAT)

    def test_catch_up_curve(self):
        self.assertEqual(catch_up(1000, 1000), 1.0)
        self.assertEqual(catch_up(950, 1000), 1.0)    # a small gap doesn't count
        self.assertEqual(catch_up(900, 1000), 1.25)
        self.assertEqual(catch_up(700, 1000), 1.62)
        self.assertEqual(catch_up(100, 1000), 2.0)    # capped

    def test_costs_grow_and_stop_at_the_top(self):
        self.assertEqual(upgrade_cost("pond", 1), 400)
        self.assertGreater(upgrade_cost("pond", 2), 400)
        self.assertEqual(upgrade_cost("bakery", 0), 500)
        self.assertIsNone(upgrade_cost("spa", 2))
        self.assertIsNotNone(upgrade_cost("pond", 19))   # the lagoon goes to level 20 ...
        self.assertIsNone(upgrade_cost("pond", 20))
        self.assertEqual([utopia.pond_space(n) for n in (1, 12, 13, 20)], [6, 50, 65, 200])   # ... holding up to 200


class RaidTests(unittest.TestCase):
    def squad(self, cls="fighter", hp=200, atk=20, **over):
        d = {"champion": "Annie", "cls": cls, "level": 10, "hp": hp, "atk": atk, "star": 0, "training": 0,
             "triples": 0, "quadras": 0, "pentas": 0}
        d.update(over)
        return [dict(d, champion=f"C{i}") for i in range(5)]

    def test_same_wave_for_both_and_bigger_later(self):
        self.assertEqual(goose_wave("123", 3), goose_wave("123", 3))
        self.assertGreater(len(goose_wave("123", 20)), len(goose_wave("123", 1)))

    def test_raid_is_repeatable(self):
        self.assertEqual(raid(self.squad(), "9", 5, 0), raid(self.squad(), "9", 5, 0))

    def test_strong_squad_wins_weak_squad_loses(self):
        self.assertTrue(raid(self.squad(hp=400, atk=40), "9", 3, 0)["win"])
        self.assertFalse(raid(self.squad(hp=20, atk=1), "9", 20, 0)["win"])

    def test_pentakill_ultimate(self):
        rep = raid(self.squad(hp=400, atk=10, pentas=1), "9", 10, 0)
        self.assertTrue(any("ultimate" in line for line in rep["log"]))


class TrainingGroundsTests(unittest.TestCase):
    def champ(self, games=10, wins=5, cls="fighter", rank=0, **over):
        rec = {"games": games, "wins": wins, "kills": 9, "deaths": 3, "assists": 0, "triples": 0, "quadras": 0,
               "pentas": 0, "grade": ""}
        rec.update(over)
        return defender("Garen", rec, cls, 0, rank)

    def test_levels_won_add_to_the_level_and_bosses_get_tougher(self):
        self.assertEqual(self.champ(rank=3)["level"], self.champ()["level"] + 3)
        self.assertGreater(boss(self.champ(rank=3))["hp"], boss(self.champ())["hp"])
        self.assertEqual(boss(self.champ())["name"], "Sergeant Honk")
        self.assertEqual(boss(self.champ(rank=7))["name"], "The Goose King")

    def test_boss_fight_records_each_round_for_the_page(self):
        f = boss_fight(self.champ(pentas=1), 5)
        self.assertEqual([s["round"] for s in f["steps"]], list(range(1, f["rounds"] + 1)))
        self.assertIn("ult", f["steps"][1]["moves"])
        last = f["steps"][-1]
        self.assertEqual((last["bossHp"], last["hp"]), (f["bossLeft"], f["hpLeft"]))
        self.assertEqual("bite" in last, not f["win"])   # a beaten boss doesn't bite back

    def test_boss_fight_is_repeatable_and_fair(self):
        self.assertEqual(boss_fight(self.champ(), 5), boss_fight(self.champ(), 5))
        wins = lambda d: sum(boss_fight(d, i)["win"] for i in range(200))
        self.assertGreater(wins(self.champ()), 100)            # an average champion usually beats its first boss ...
        self.assertLess(wins(self.champ(rank=6)), 100)         # ... but the bosses higher up are a real test
        self.assertGreater(wins(self.champ(wins=8, grade="S")), wins(self.champ()))   # better games, better odds


class SpaTests(unittest.TestCase):
    def test_hotter_is_stronger_and_fire_ducks_heat_it_up_to_a_limit(self):
        s = new_utopia("A#1", 0)
        self.assertEqual([perk_power(s, "chili", k) for k in ("warm", "hot", "scalding")], [0.15, 0.3, 0.5])
        self.assertEqual(perk_power(s, "golden", "warm"), 0.3)   # golden salts: twice as much, in raid rewards
        s["caught"] = ["C1", "C2", "C3", "C4"]
        self.assertEqual((heat(s), perk_power(s, "chili", "hot")), (0.2, 0.36))
        s["caught"] = [f"C{i}" for i in range(50)]
        self.assertEqual(heat(s), utopia.MAX_HEAT)

    def test_perks_make_the_defender_stronger_not_its_boss(self):
        rec = {"games": 10, "wins": 5, "kills": 9, "deaths": 3, "assists": 0, "triples": 0, "quadras": 0, "pentas": 0, "grade": ""}
        d = defender("Garen", rec, "fighter", 0)
        strong = with_perk(d, {"salt": "eucalyptus", "temp": "hot", "power": 0.3})
        self.assertEqual(strong["hp"], round(d["hp"] * 1.3))
        self.assertEqual(with_perk(d, {"salt": "chili", "temp": "warm", "power": 0.15})["atk"], round(d["atk"] * 1.15, 1))
        self.assertEqual(boss(strong), boss(d))


class FakeTracker:
    def __init__(self, players):
        self._players = players

    def players(self):
        return self._players


class FakeStats:
    def __init__(self, rows):
        self.rows = rows

    def together(self, players):
        return {p.key: self.rows.get(p.key, []) for p in players}


class FakeChamps:
    roles = {"Annie": ["mage"], "Garen": ["fighter", "tank"], "Draven": ["marksman"]}

    @staticmethod
    def alias_of(cid):
        return {"1": "Annie", "119": "Draven"}.get(str(cid), str(cid))


class FakeSeason:
    def __init__(self, grades):
        self.grades = grades   # {player key: {champion id: grade}}

    def saved_best(self, player):
        return self.grades.get(player.key, {})


class FakeClient:
    champions = FakeChamps()

    def ensure_champions(self):
        return self.champions


class GameTests(TempStorageCase):
    def setUp(self):
        super().setUp()
        self.players = [Player("Duo One#NA1"), Player("Duo Two#NA2")]
        self.rows = {"duo one#na1": [row("1", 1, pentas=1), row("2", 2, win=False)],
                     "duo two#na2": [row("1", 1, champion="Garen"), row("2", 2, win=False, champion="Garen", grade="S")]}
        self.game = DuckUtopia(self.storage, FakeStats(self.rows), FakeTracker(self.players), FakeClient())

    def test_founding_day_replays_history(self):
        v = self.game.state(viewer=False, now=1000)
        one, two = v["players"]
        self.assertEqual((one["pond"], one["edge"], one["golden"], one["founding"]["wins"]),
                         (utopia.STARTING_DUCKS, 0, 1, 1))   # wins aren't ducks
        self.assertEqual(two["champs"], {"Garen": "S"})
        self.assertEqual(one["crumbs"], utopia.FOUNDING_GIFT)
        self.assertEqual(one["raids"], [])   # history doesn't raid
        self.assertEqual([d["champion"] for d in one["plaza"]], ["Annie"])
        self.assertEqual(two["plaza"], [])
        self.assertTrue(two["leading"] or one["leading"])

    def test_a_new_win_gives_breadcrumbs_and_raids_both(self):
        rate = self.game.state(viewer=False, now=1000)["players"][0]["rate"]
        self.rows["duo one#na1"].insert(0, row("3", 3))
        self.rows["duo two#na2"].insert(0, row("3", 3, champion="Garen"))
        v = self.game.state(viewer=False, now=2000)
        one, two = v["players"]
        self.assertEqual(len(one["ducklings"]), utopia.WIN_EGGS)   # a win lays two eggs, straight into free nests
        self.assertIn("2 eggs in the Duck Lab", one["log"][-1 if not one["raids"] else 1]["text"])
        self.assertIn(f"{round(rate * utopia.WIN_MINUTES):,} breadcrumbs", one["log"][-1 if not one["raids"] else 1]["text"])   # half an hour's worth
        self.assertEqual(one["raids"][0]["matchId"], "3")
        self.assertEqual(one["raids"][0]["geese"], two["raids"][0]["geese"])   # the same wave
        again = self.game.state(viewer=False, now=3000)
        self.assertEqual(len(again["players"][0]["raids"]), 1)   # each game raids once

    def test_squad_defaults_to_most_played_and_can_be_chosen(self):
        v = self.game.state(viewer=False, now=1000)
        self.assertEqual([d["champion"] for d in v["players"][1]["squad"]], ["Garen"])
        self.assertEqual(v["players"][1]["squad"][0]["cls"], "fighter")
        self.assertEqual(v["players"][1]["squad"][0]["star"], 2)
        out = self.game.act({"owner": "duo one#na1", "action": "squad", "squad": ["Annie"]}, viewer=False, now=1000)
        self.assertEqual(out["result"], {"squad": ["Annie"]})
        with self.assertRaises(ValueError):   # not a champion played together
            self.game.act({"owner": "duo one#na1", "action": "squad", "squad": ["Teemo"]}, viewer=False, now=1000)

    def test_upgrades_spend_breadcrumbs(self):
        self.game.state(viewer=False, now=0)
        out = self.game.act({"owner": "duo one#na1", "action": "upgrade", "building": "nests"}, viewer=False, now=0)
        p = out["players"][0]
        self.assertEqual(p["levels"]["nests"], 2)
        self.assertEqual(p["crumbs"], utopia.FOUNDING_GIFT - upgrade_cost("nests", 1))
        with self.assertRaises(ValueError):   # can't afford the pond now
            self.game.act({"owner": "duo one#na1", "action": "upgrade", "building": "pond"}, viewer=False, now=0)

    def give(self, crumbs):
        data = self.game._load()
        data["players"]["duo one#na1"]["crumbs"] = crumbs
        self.storage.write_json(self.game.path, data)

    def test_spawning_a_duckling(self):
        self.game.state(viewer=False, now=1)   # (now=0 would mean "the real time")
        self.give(10000)
        spawn = {"owner": "duo one#na1", "action": "spawn"}
        p = self.game.act(spawn, viewer=False, now=1)["players"][0]
        self.assertEqual((p["ducklings"], p["spawned"], p["crumbs"]), ([1 + 8 * 60 * MIN], 1, 10000 - utopia.SPAWN_COST))
        self.assertEqual(p["lab"]["spawnCost"], spawn_cost(utopia.STARTING_DUCKS + 1))   # by the flock: 5 ducks and this one
        for _ in range(utopia.nest_space(1) - 1):
            self.game.act(spawn, viewer=False, now=1)
        with self.assertRaises(ValueError):   # the nests are full
            self.game.act(spawn, viewer=False, now=1)
        p = self.game.state(viewer=False, now=1 + 8 * 60 * MIN)["players"][0]
        room = utopia.pond_space(1) - utopia.STARTING_DUCKS
        self.assertEqual((len(p["ducklings"]), p["pondUsed"], p["edge"]), (0, utopia.pond_space(1), utopia.nest_space(1) - room))   # grown; the rest wait

    def test_the_auto_nester_needs_duck_science_and_can_be_switched(self):
        self.game.state(viewer=False, now=1)
        self.give(100000)
        build = {"owner": "duo one#na1", "action": "upgrade", "building": "autonest"}
        with self.assertRaises(ValueError):   # needs Duck Science level 3
            self.game.act(build, viewer=False, now=1)
        data = self.game._load()
        data["players"]["duo one#na1"]["levels"]["science"] = utopia.AUTONEST_SCIENCE
        self.storage.write_json(self.game.path, data)
        p = self.game.act(build, viewer=False, now=1)["players"][0]
        self.assertEqual((p["levels"]["autonest"], len(p["ducklings"])), (1, utopia.nest_space(1)))   # filled the nests straight away
        p = self.game.act({"owner": "duo one#na1", "action": "autonest", "on": False}, viewer=False, now=1)["players"][0]
        self.assertFalse(p["lab"]["autoOn"])

    def test_hatching_a_clutch_fills_every_free_nest_for_less(self):
        self.game.state(viewer=False, now=1)
        self.give(10000)
        s = self.game._load()["players"]["duo one#na1"]
        one_by_one = sum(spawn_cost(utopia.flock(s) + i) for i in range(utopia.nest_space(1)))
        self.assertEqual(utopia.clutch_cost(s), round(one_by_one * 0.9))
        out = self.game.act({"owner": "duo one#na1", "action": "clutch"}, viewer=False, now=1)
        p = out["players"][0]
        self.assertEqual((out["result"]["clutch"], len(p["ducklings"]), p["lab"]["freeNests"]), (utopia.nest_space(1), utopia.nest_space(1), 0))
        self.assertEqual(p["crumbs"], 10000 - round(one_by_one * 0.9))
        with self.assertRaises(ValueError):   # every nest is taken now
            self.game.act({"owner": "duo one#na1", "action": "clutch"}, viewer=False, now=1)

    def test_a_clutch_needs_the_breadcrumbs_for_all_of_it(self):
        self.game.state(viewer=False, now=1)
        self.give(150)
        with self.assertRaises(ValueError):
            self.game.act({"owner": "duo one#na1", "action": "clutch"}, viewer=False, now=1)

    def test_incubation_upgrade_speeds_up_growing_ducklings(self):
        self.game.state(viewer=False, now=1)
        self.give(10000)
        self.game.act({"owner": "duo one#na1", "action": "spawn"}, viewer=False, now=1)
        p = self.game.act({"owner": "duo one#na1", "action": "upgrade", "building": "incubation"}, viewer=False, now=1)["players"][0]
        self.assertEqual(p["levels"]["incubation"], 1)
        self.assertEqual(p["ducklings"], [1 + round(8 * 60 * MIN * utopia.INCUBATION_SPEEDUP)])

    def test_old_utopias_start_over_once_keeping_badge_ducks(self):
        self.game.state(viewer=False, now=1)
        data = self.game._load()
        old = data["players"]["duo one#na1"]
        old.update(crumbs=99999, pond=40, edge=7, feathers=12, champs={"Annie": "S"}, fire=2, boost=0.5, raidWins=3)
        old["levels"]["pond"] = 6
        del data["version"]   # saved before the fresh start
        self.storage.write_json(self.game.path, data)
        p = self.game.state(viewer=False, now=2)["players"][0]
        self.assertEqual((p["crumbs"], p["pond"], p["edge"], p["feathers"], p["raidWins"], p["levels"]["pond"]),
                         (utopia.FOUNDING_GIFT, utopia.STARTING_DUCKS, 0, 0, 0, 1))
        self.assertEqual((p["golden"], p["champs"], p["fire"], p["boost"]), (1, {"Annie": "S"}, 2, 0.5))
        self.assertEqual(len(p["plaza"]), 1)
        self.assertEqual(self.storage.read_json(self.storage.path("utopia-before-fresh-start.json"))["players"]["duo one#na1"]["crumbs"], 99999)
        again = self.game.state(viewer=False, now=60 * MIN)["players"][0]
        self.assertGreater(again["crumbs"], utopia.FOUNDING_GIFT)   # only once: it carries on from there

    def test_hats_for_a_defender(self):
        self.game.state(viewer=False, now=1)
        self.give(1000)
        hat = lambda **kw: self.game.act({"owner": "duo one#na1", "action": "hat", "champion": "Annie", **kw}, viewer=False, now=1)
        p = hat(hat="cap", op="buy")["players"][0]
        self.assertEqual(p["hats"]["Annie"], {"owned": ["cap"], "on": "cap"})   # bought hats go straight on
        self.assertEqual(p["crumbs"], 1000 - utopia.HATS["cap"][1])
        with self.assertRaises(ValueError):   # already has it
            hat(hat="cap", op="buy")
        with self.assertRaises(ValueError):   # not bought yet
            hat(hat="crown", op="wear")
        with self.assertRaises(ValueError):   # can't afford it
            hat(hat="crown", op="buy")
        self.assertIsNone(hat(op="off")["players"][0]["hats"]["Annie"]["on"])
        self.assertEqual(hat(hat="cap", op="wear")["players"][0]["hats"]["Annie"]["on"], "cap")
        with self.assertRaises(ValueError):   # not a champion played together
            self.game.act({"owner": "duo one#na1", "action": "hat", "champion": "Teemo", "hat": "cap", "op": "buy"}, viewer=False, now=1)

    def bakery(self, level, crumbs=100000):
        data = self.game._load()
        data["players"]["duo one#na1"]["levels"]["bakery"] = level
        data["players"]["duo one#na1"]["crumbs"] = crumbs
        self.storage.write_json(self.game.path, data)

    def bake(self, action, treat, now=1):
        return self.game.act({"owner": "duo one#na1", "action": action, "treat": treat}, viewer=False, now=now)["players"][0]

    def test_bakery_levels_unlock_machines_and_speed_upgrades(self):
        self.game.state(viewer=False, now=1)
        with self.assertRaises(ValueError):   # no bakery yet
            self.bake("machine", "marksman")
        self.bakery(2)
        p = self.bake("machine", "marksman")
        self.assertEqual(p["crumbs"], 100000 - utopia.TREATS["marksman"][3])
        self.assertEqual(p["bakery"]["machines"]["marksman"]["speed"], 0)
        with self.assertRaises(ValueError):   # the honey oven needs bakery level 3
            self.bake("machine", "support")
        with self.assertRaises(ValueError):   # already bought
            self.bake("machine", "marksman")
        with self.assertRaises(ValueError):   # no dough mixer to speed up
            self.bake("speed", "fighter")
        p = self.bake("speed", "marksman")   # the first speed upgrade needs bakery level 2
        self.assertEqual(p["bakery"]["machines"]["marksman"]["minutes"], 45 * utopia.MACHINE_SPEEDUP)
        self.assertEqual(p["bakery"]["machines"]["marksman"]["speedNeeds"], 4)
        with self.assertRaises(ValueError):   # the second needs level 4
            self.bake("speed", "marksman")

    def test_baking_uses_up_breadcrumbs_and_badges(self):
        for i in range(4):   # 4 Triple Kill badges and 1 Big Crit
            self.rows["duo one#na1"].append(row(f"b{i}", 0, triples=1, crit=1600 if i == 0 else 0))
        self.game.state(viewer=False, now=1)
        self.bakery(1)
        self.bake("machine", "marksman")
        p = self.bake("bake", "marksman")
        b = p["bakery"]
        self.assertEqual((b["earned"]["triple"], b["badges"]["triple"], b["badges"]["crit"]), (4, 1, 0))
        self.assertEqual(b["spent"], {"triple": 3, "crit": 1})
        self.assertEqual(p["crumbs"], 100000 - utopia.TREATS["marksman"][3] - utopia.TREATS["marksman"][4])
        self.assertEqual(b["bakes"], {"marksman": [1 + 45 * MIN]})
        with self.assertRaises(ValueError):   # one batch at a time
            self.bake("bake", "marksman")
        self.bakery(2)
        p = self.bake("speed", "marksman")   # the batch in the fryer speeds up too
        self.assertEqual(p["bakery"]["bakes"], {"marksman": [1 + round(45 * MIN * utopia.MACHINE_SPEEDUP)]})
        p = self.game.state(viewer=False, now=1 + round(45 * MIN * utopia.MACHINE_SPEEDUP))["players"][0]
        self.assertEqual((p["bakery"]["treats"], p["bakery"]["bakes"]), ({"marksman": 1}, {}))
        self.assertIn("bullseye donuts", p["log"][0]["text"])
        with self.assertRaises(ValueError) as e:   # the badges are used up
            self.bake("bake", "marksman", now=2 + 45 * MIN)
        self.assertIn("2 more Triple Kill, 1 more Big Crit", str(e.exception))

    def treats(self, **n):
        data = self.game._load()
        data["players"]["duo one#na1"]["treats"] = n
        self.storage.write_json(self.game.path, data)

    def test_luring_a_wild_fire_duck_with_its_class_of_treat(self):
        self.rows["duo one#na1"].append(row("9", 0, grade="S+"))   # Annie (a mage): her fire duck is unlocked
        p = self.game.state(viewer=False, now=1)["players"][0]
        self.assertEqual([(d["champion"], d["cls"], d["caught"]) for d in p["volcano"]], [("Annie", "mage", False)])
        rate = p["rate"]
        lure = lambda treat: self.game.act({"owner": "duo one#na1", "action": "lure", "treat": treat}, viewer=False, now=1)
        self.treats(marksman=1)
        with self.assertRaises(ValueError):   # no wild marksman fire ducks
            lure("marksman")
        with self.assertRaises(ValueError):   # no macarons in the pantry
            lure("mage")
        self.treats(mage=2)
        out = lure("mage")
        p = out["players"][0]
        self.assertEqual(out["result"], {"caught": "Annie", "treat": "mage"})
        self.assertEqual((p["bakery"]["treats"], p["caught"]), ({"mage": 1}, ["Annie"]))
        self.assertTrue(p["volcano"][0]["caught"])
        self.assertAlmostEqual(p["rate"] - rate, utopia.FIRE_RATE)   # caught: it collects breadcrumbs and heats the Spa
        self.assertEqual(p["heat"], utopia.FIRE_HEAT)
        self.assertIn("caught Annie's fire duck", p["log"][0]["text"])
        with self.assertRaises(ValueError):   # every mage fire duck is caught
            lure("mage")

    def test_a_season_best_s_plus_unlocks_a_fire_duck_too(self):
        season = FakeSeason({"duo one#na1": {"119": "S+", "1": "S", "999": "S+"}})   # Draven S+ in a solo game; 999: unknown
        self.game.season = season
        p = self.game.state(viewer=False, now=5)["players"][0]
        self.assertEqual([(d["champion"], d["cls"], d["games"], d["caught"]) for d in p["volcano"]], [("Draven", "marksman", 0, False)])
        self.assertIn("season-best S+ grades: Draven", p["log"][0]["text"])
        self.assertNotIn("Draven", p["champs"])   # a fire duck, not a champion duck: those still need a game together
        season.grades = {}   # a new season: it stays unlocked
        p = self.game.state(viewer=False, now=6)["players"][0]
        self.assertEqual([d["champion"] for d in p["volcano"]], ["Draven"])
        self.rows["duo one#na1"].insert(0, row("7", 7, champion="Draven", grade="S+"))   # an S+ together later: the same duck
        p = self.game.state(viewer=False, now=8)["players"][0]
        self.assertEqual([(d["champion"], d["games"]) for d in p["volcano"]], [("Draven", 1)])
        self.assertFalse(any("wild Draven" in l["text"] for l in p["log"]))

    def test_more_machines_once_the_speed_upgrades_are_done(self):
        for i in range(12):   # badges for four batches
            self.rows["duo one#na1"].append(row(f"b{i}", 0, triples=1, crit=1600))
        self.game.state(viewer=False, now=1)
        self.bakery(10, crumbs=10_000_000)
        self.bake("machine", "marksman")
        with self.assertRaises(ValueError):   # the speed upgrades come first
            self.bake("extra", "marksman")
        for _ in range(utopia.MACHINE_SPEEDS):
            self.bake("speed", "marksman")
        before = self.bake("bake", "marksman")
        with self.assertRaises(ValueError):   # one machine: one batch at a time
            self.bake("bake", "marksman")
        p = self.bake("extra", "marksman")
        m = p["bakery"]["machines"]["marksman"]
        self.assertEqual(before["crumbs"] - p["crumbs"], utopia.EXTRA_MIN)   # very expensive
        self.assertEqual((m["count"], m["extraCost"]), (2, utopia.EXTRA_MIN * utopia.EXTRA_GROWTH))
        p = self.bake("bake", "marksman", now=2)   # two machines: two batches at once
        mins = round(utopia.bake_minutes("marksman", utopia.MACHINE_SPEEDS) * MIN)
        self.assertEqual(p["bakery"]["bakes"], {"marksman": [1 + mins, 2 + mins]})
        with self.assertRaises(ValueError):
            self.bake("bake", "marksman", now=2)
        p = self.game.state(viewer=False, now=2 + mins)["players"][0]
        self.assertEqual((p["bakery"]["treats"], p["bakery"]["bakes"]), ({"marksman": 2}, {}))
        self.assertIn("finished 2 batches", p["log"][0]["text"])   # both done by now: one note
        self.assertEqual(utopia.extra_machine_cost("assassin", 1), 1_000_000)
        self.assertIsNone(utopia.extra_machine_cost("marksman", utopia.MAX_MACHINES))

    def test_old_bakes_become_one_batch_each(self):
        s = new_utopia("A#1", 0)
        s["bakes"] = {"marksman": 500}
        migrate(s)
        self.assertEqual(s["bakes"], {"marksman": [500]})

    def test_only_your_own_utopia(self):
        with self.assertRaises(PermissionError):
            self.game.act({"owner": "duo two#na2", "action": "upgrade", "building": "nests"}, viewer=False)
        with self.assertRaises(PermissionError):
            self.game.act({"owner": "duo one#na1", "action": "upgrade", "building": "nests"}, viewer=True)

    def test_practice_raid_changes_nothing(self):
        before = self.game.state(viewer=False, now=1000)["players"][0]
        out = self.game.act({"owner": "duo one#na1", "action": "practice"}, viewer=False, now=1000)
        self.assertTrue(out["result"]["raid"]["practice"])
        after = out["players"][0]
        self.assertEqual((after["crumbs"], after["feathers"], after["raids"]), (before["crumbs"], before["feathers"], []))

    def test_each_win_on_a_defender_earns_a_boss_challenge(self):
        self.game.state(viewer=False, now=1000)
        self.assertEqual(self.game.state(viewer=False, now=1000)["players"][0]["challenges"], [])   # history doesn't count
        challenge = lambda: self.game.act({"owner": "duo one#na1", "action": "challenge", "champion": "Annie"}, viewer=False, now=5000)
        with self.assertRaises(ValueError):   # no win yet
            challenge()
        self.rows["duo one#na1"][:0] = [row("4", 4), row("3", 3)]   # two wins on Annie: two challenges
        self.assertEqual(self.game.state(viewer=False, now=2000)["players"][0]["challenges"], ["Annie", "Annie"])
        before = self.game.state(viewer=False, now=5000)["players"][0]["squad"][0]
        out = challenge()
        fight, p = out["result"]["fight"], out["players"][0]
        self.assertEqual(p["challenges"], ["Annie"])   # one used up, win or lose; the other still waits
        self.assertEqual(p["bossFights"][0]["boss"]["name"], fight["boss"]["name"])
        self.assertEqual(p["ranks"].get("Annie", 0), 1 if fight["win"] else 0)
        self.assertEqual(p["squad"][0]["level"], before["level"] + (1 if fight["win"] else 0))
        self.assertEqual(challenge()["players"][0]["challenges"], [])   # the second fight
        with self.assertRaises(ValueError):   # and no third
            challenge()

    def test_no_challenges_once_every_boss_is_beaten(self):
        self.game.state(viewer=False, now=1000)
        data = self.game._load()
        data["players"]["duo one#na1"]["ranks"]["Annie"] = utopia.MAX_RANK
        self.storage.write_json(self.game.path, data)
        self.rows["duo one#na1"].insert(0, row("3", 3))
        self.assertEqual(self.game.state(viewer=False, now=2000)["players"][0]["challenges"], [])

    def test_a_test_fight_needs_no_challenge_and_changes_nothing(self):
        before = self.game.state(viewer=False, now=1000)["players"][0]
        out = self.game.act({"owner": "duo one#na1", "action": "spar", "champion": "Annie"}, viewer=False, now=1000)
        fight, after = out["result"]["fight"], out["players"][0]
        self.assertTrue(fight["practice"])
        self.assertEqual((after["ranks"], after["bossFights"], after["challenges"], after["crumbs"]),
                         (before["ranks"], [], [], before["crumbs"]))
        with self.assertRaises(ValueError):   # not a champion played together
            self.game.act({"owner": "duo one#na1", "action": "spar", "champion": "Teemo"}, viewer=False, now=1000)

    def test_a_win_off_the_squad_earns_a_challenge_too_but_a_loss_doesnt(self):
        self.game.state(viewer=False, now=1000)
        # five defenders: Annie, then the most played; Zed, played once, is left out
        self.rows["duo one#na1"][:0] = [row(f"{c}{i}", 10, win=False, champion=c) for c in "BCDE" for i in range(3)]
        self.rows["duo one#na1"][:0] = [row("Z", 20, champion="Zed"), row("A", 20, win=False)]
        p = self.game.state(viewer=False, now=2000)["players"][0]
        self.assertNotIn("Zed", [d["champion"] for d in p["squad"]])
        self.assertEqual(p["challenges"], ["Zed"])   # the losses (Annie's included) earn nothing
        self.assertEqual([(d["champion"], d["boss"]["name"]) for d in p["challengers"]], [("Zed", "Sergeant Honk")])
        out = self.game.act({"owner": "duo one#na1", "action": "challenge", "champion": "Zed"}, viewer=False, now=3000)
        p = out["players"][0]
        self.assertEqual((p["challenges"], p["challengers"], p["ranks"].get("Zed", 0)), ([], [], 1 if out["result"]["fight"]["win"] else 0))

    def spa(self, level=1, crumbs=10000):
        self.game.state(viewer=False, now=1000)
        data = self.game._load()
        s = data["players"]["duo one#na1"]
        s["levels"]["spa"], s["crumbs"] = level, crumbs
        self.storage.write_json(self.game.path, data)

    def soak(self, champion="Annie", salt="chili", temp="hot", now=1000):
        return self.game.act({"owner": "duo one#na1", "action": "soak", "champion": champion, "salt": salt, "temp": temp},
                             viewer=False, now=now)

    def test_a_soak_costs_breadcrumbs_and_takes_the_defender_out_of_the_squad(self):
        with self.assertRaises(ValueError):   # no spa yet
            self.soak()
        self.spa()
        p = self.soak()["players"][0]
        self.assertAlmostEqual(p["crumbs"], 10000 - utopia.TEMPS["hot"][1])
        self.assertEqual([x["champion"] for x in p["soaks"]], ["Annie"])
        self.assertNotIn("Annie", [d["champion"] for d in p["squad"]])
        with self.assertRaises(ValueError):   # one pool, and it's taken
            self.soak(champion="Garen")
        with self.assertRaises(ValueError):   # can't fight while soaking
            self.game.act({"owner": "duo one#na1", "action": "spar", "champion": "Annie"}, viewer=False, now=1000)
        p = self.game.state(viewer=False, now=1000 + 120 * MIN)["players"][0]
        self.assertEqual((p["soaks"], p["perks"]["Annie"]["salt"]), ([], "chili"))
        annie = next(d for d in p["squad"] if d["champion"] == "Annie")   # back, and stronger
        self.assertEqual(annie["atk"], round(annie["baseAtk"] * 1.3, 1))
        with self.assertRaises(ValueError):   # already refreshed
            self.soak(now=1000 + 120 * MIN)

    def test_the_hot_springs_have_two_pools(self):
        self.rows["duo one#na1"].append(row("0", 0, champion="Garen"))
        self.spa(level=2)
        self.soak()
        self.assertEqual(len(self.soak(champion="Garen")["players"][0]["soaks"]), 2)

    def test_the_next_raid_uses_up_perks_and_golden_salts_pay_more(self):
        self.spa()
        self.soak(salt="golden")
        self.game.state(viewer=False, now=1000 + 120 * MIN)
        self.rows["duo one#na1"].insert(0, row("3", 3))
        p = self.game.state(viewer=False, now=1000 + 121 * MIN)["players"][0]
        self.assertEqual(p["perks"], {})
        rep = p["raids"][0]
        if rep["win"]:
            self.assertEqual(rep["reward"]["crumbs"], round(30 * rep["total"] * 1.6))

    def test_a_boss_challenge_uses_up_a_health_or_attack_perk(self):
        self.spa()
        self.rows["duo one#na1"].insert(0, row("3", 3))   # a win: a challenge for Annie
        self.game.state(viewer=False, now=1000)
        data = self.game._load()   # then a soak (after that game's raid)
        data["players"]["duo one#na1"]["perks"]["Annie"] = {"salt": "chili", "temp": "hot", "power": 0.3}
        self.storage.write_json(self.game.path, data)
        out = self.game.act({"owner": "duo one#na1", "action": "challenge", "champion": "Annie"}, viewer=False, now=2000)
        self.assertEqual(out["result"]["fight"]["perk"]["salt"], "chili")
        self.assertEqual(out["players"][0]["perks"], {})

    def test_the_ladder_shows_only_the_birds_youve_made(self):
        p = self.game.state(viewer=False, now=1000)["players"][0]
        self.assertEqual(p["discovered"], 0)   # only ducks so far: the mallard is the mystery
        p = self.game.act({"owner": "duo one#na1", "action": "mergeAll"}, viewer=False, now=1000)["players"][0]
        self.assertEqual(p["discovered"], 2)   # 5 ducks: two mallards, then a wood duck
        self.assertIn("a new bird! Two mallards became a wood duck", p["log"][0]["text"])
        data = self.game._load()   # merged away, it stays discovered
        data["players"]["duo one#na1"]["birds"] = [0] * (len(utopia.BIRDS) - 1)
        self.storage.write_json(self.game.path, data)
        self.assertEqual(self.game.state(viewer=False, now=1000)["players"][0]["discovered"], 2)

    def test_every_game_together_lays_an_egg(self):
        self.game.state(viewer=False, now=1000)
        self.rows["duo one#na1"].insert(0, row("3", 3, win=False))
        p = self.game.state(viewer=False, now=2000)["players"][0]
        self.assertEqual(len(p["ducklings"]), utopia.GAME_EGGS)   # a loss: one egg
        self.assertIn("1 egg in the Duck Lab", p["log"][-1 if not p["raids"] else 1]["text"])

    def test_merging_in_the_marsh(self):
        self.game.state(viewer=False, now=1000)
        out = self.game.act({"owner": "duo one#na1", "action": "merge", "tier": 0}, viewer=False, now=1000)
        p = out["players"][0]
        self.assertEqual((out["result"], p["pond"], p["birds"][0], p["pondUsed"]), ({"made": {1: 1}}, utopia.STARTING_DUCKS - 2, 1, utopia.STARTING_DUCKS - 1))
        p = self.game.act({"owner": "duo one#na1", "action": "mergeAll"}, viewer=False, now=1000)["players"][0]
        self.assertEqual((p["pond"], p["birds"][:2]), (1, [0, 1]))   # 3 ducks + a mallard -> 1 duck + a wood duck
        with self.assertRaises(ValueError):
            self.game.act({"owner": "duo one#na1", "action": "merge", "tier": 0}, viewer=False, now=1000)

    def test_score_counts_districts(self):
        s = new_utopia("A#1", 0)
        base = score(s)
        s["golden"] = 1
        self.assertEqual(score(s) - base, 50 + 100)   # a golden duck, and Penta Plaza opens


if __name__ == "__main__":
    unittest.main()
