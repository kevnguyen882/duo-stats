import unittest

from duostats import utopia
from duostats.games import Player
from duostats.utopia import (DuckUtopia, advance, apply_badges, catch_up, crumb_rate, goose_wave, new_utopia, raid,
                             score, upgrade_cost)
from tests.helpers import TempStorageCase

MIN = 60000


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
        s = new_utopia("A#1", 0)
        s["lost"] = utopia.nest_space(1) + 2   # two more than the nests hold
        advance(s, 0)
        self.assertEqual((len(s["ducklings"]), s["lost"]), (utopia.nest_space(1), 2))
        advance(s, utopia.GROW_MINUTES * MIN)          # the first batch grows; the waiting two move in
        self.assertEqual(s["pond"], utopia.nest_space(1))
        self.assertEqual((len(s["ducklings"]), s["lost"]), (2, 0))
        advance(s, 2 * utopia.GROW_MINUTES * MIN)
        self.assertEqual((s["pond"], s["edge"]), (5, 1))   # the pond holds 5: one waits at the edge

    def test_new_pond_ducks_collect_from_when_they_arrive(self):
        s = new_utopia("A#1", 0)
        s["crumbs"], s["lost"] = 0, 1
        advance(s, 0)
        advance(s, (utopia.GROW_MINUTES + 10) * MIN)
        self.assertAlmostEqual(s["crumbs"], 10 * utopia.DUCK_RATE)   # nothing while it was a duckling

    def test_bakery_and_boost_multiply(self):
        s = new_utopia("A#1", 0)
        s.update(pond=10, boost=0.5)
        s["levels"]["bakery"] = 2
        self.assertAlmostEqual(crumb_rate(s), 10 * (1 + 2 * utopia.BAKERY_BONUS) * 1.5)


class RewardTests(unittest.TestCase):
    def test_badges(self):
        s = new_utopia("A#1", 0)
        apply_badges(s, row("1", 0, triples=2, quadras=1, pentas=1, grade="S"), grown=False)
        self.assertEqual((s["lost"], s["golden"], s["champs"]), (1, 1, {"Annie": "S"}))
        self.assertAlmostEqual(s["boost"], 2 * utopia.TRIPLE_BOOST + utopia.QUADRA_BOOST)
        apply_badges(s, row("2", 0, win=False, grade="S+"), grown=False)
        self.assertEqual((s["lost"], s["fire"], s["champs"]["Annie"]), (1, 1, "S+"))
        apply_badges(s, row("3", 0, win=False, grade="A"), grown=False)   # not an S grade: nothing
        self.assertEqual(s["champs"]["Annie"], "S+")

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
        self.assertEqual((one["pond"], one["golden"], one["founding"]["wins"]), (1, 1, 1))
        self.assertEqual(two["champs"], {"Garen": "S"})
        self.assertEqual(one["crumbs"], utopia.FOUNDING_GIFT)
        self.assertEqual(one["raids"], [])   # history doesn't raid
        self.assertTrue(two["leading"] or one["leading"])

    def test_a_new_game_gives_a_duckling_and_raids_both(self):
        self.game.state(viewer=False, now=1000)
        self.rows["duo one#na1"].insert(0, row("3", 3))
        self.rows["duo two#na2"].insert(0, row("3", 3, champion="Garen"))
        v = self.game.state(viewer=False, now=2000)
        one, two = v["players"]
        self.assertEqual(len(one["ducklings"]), 1)
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
