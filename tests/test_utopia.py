import unittest

from duostats import utopia
from duostats.games import Player
from duostats.utopia import (DuckUtopia, advance, apply_badges, boost_breakdown, catch_up, crumb_rate, goose_wave,
                             grow_minutes, migrate, new_utopia, penta_plaza, raid, score, spawn_cost, upgrade_cost,
                             first_graded, late_grades, volcano_spa)
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
        self.assertEqual((s["pond"], s["edge"]), (5, 1))   # the pond holds 5: one waits at the edge

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
        self.assertAlmostEqual(crumb_rate(s), 10 * (1 + 2 * utopia.BAKERY_BONUS) * 1.5)


class InfirmaryTests(unittest.TestCase):
    def test_costs_and_times(self):
        self.assertEqual(spawn_cost(0), utopia.SPAWN_COST)
        self.assertLess(spawn_cost(1) - spawn_cost(0), spawn_cost(50) - spawn_cost(49))   # slow at first, then steep
        self.assertEqual(grow_minutes(0), 8 * 60)
        self.assertLess(grow_minutes(5), grow_minutes(0))

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
        self.assertEqual(got, [("Lux", ["a Lux champion duck (S)"]), ("Nilah", ["a fire duck"])])
        self.assertEqual((s["fire"], s["champs"]["Lux"]), (2, "S"))
        self.assertEqual(late_grades(s, rows), [])

    def test_volcano_spa_has_a_fire_duck_per_s_plus_game(self):
        s = new_utopia("A#1", 0)
        rows = [row("3", 30, champion="Lux", grade="S+"), row("1", 10, champion="Nilah", grade="S+"),
                row("2", 20, champion="Sona", grade="S"), row("4", 40, champion="Jinx", grade="S+", remake=True),
                row("5", 50, champion="Kayn", grade="S+")]   # game 5 isn't counted in the utopia yet
        s["games"] = ["1", "2", "3", "4"]
        spa = volcano_spa(s, rows)
        self.assertEqual([d["champion"] for d in spa], ["Nilah", "Lux"])   # oldest first; an S isn't a fire duck
        self.assertEqual(spa[1]["start"], 30)

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
    roles = {"Annie": ["mage"], "Garen": ["fighter", "tank"]}


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
        self.game.state(viewer=False, now=1000)
        self.rows["duo one#na1"].insert(0, row("3", 3))
        self.rows["duo two#na2"].insert(0, row("3", 3, champion="Garen"))
        v = self.game.state(viewer=False, now=2000)
        one, two = v["players"]
        self.assertEqual(len(one["ducklings"]), 0)   # no duckling for a win: they come from the infirmary
        self.assertIn(f"{utopia.WIN_CRUMBS} breadcrumbs", one["log"][-1 if not one["raids"] else 1]["text"])
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
        self.assertEqual(p["lab"]["spawnCost"], spawn_cost(1))
        for _ in range(utopia.nest_space(1) - 1):
            self.game.act(spawn, viewer=False, now=1)
        with self.assertRaises(ValueError):   # the nests are full
            self.game.act(spawn, viewer=False, now=1)
        p = self.game.state(viewer=False, now=1 + 8 * 60 * MIN)["players"][0]
        self.assertEqual((len(p["ducklings"]), p["edge"]), (0, utopia.nest_space(1)))   # grown; the pond was full

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

    def test_score_counts_districts(self):
        s = new_utopia("A#1", 0)
        base = score(s)
        s["golden"] = 1
        self.assertEqual(score(s) - base, 50 + 100)   # a golden duck, and Penta Plaza opens


if __name__ == "__main__":
    unittest.main()
