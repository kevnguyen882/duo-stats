import re
import unittest
from pathlib import Path

from duostats.badges import BADGES, attach, attach_match, badge_counts, catalog, game_badges


def game(mid="1", **over):
    """An ordinary game that earns nothing; pass what a test needs."""
    r = {"matchId": mid, "champion": "Annie", "win": True, "remake": False, "withDuo": True, "duration": 1500,
         "kills": 5, "deaths": 5, "assists": 5, "kp": 0.5, "dmgShare": 0.2, "damage": 20000, "gold": 12000, "heal": 1000,
         "mitigated": 10000, "crit": 0, "spree": 2, "pentas": 0, "quadras": 0, "triples": 0}
    r.update(over)
    return r


def ids(x, **kw):
    return [b["id"] for b in game_badges(x, **kw)]


class BadgeRuleTests(unittest.TestCase):
    def test_an_ordinary_game_earns_no_badges(self):
        self.assertEqual(ids(game()), [])

    def test_each_badge_at_its_threshold_and_just_under_it(self):
        cases = [
            ("sixfig", {"damage": 100000}, {"damage": 99999}),
            ("untouch", {"kills": 6, "assists": 10, "deaths": 2}, {"kills": 6, "assists": 9, "deaths": 2}),   # KDA 8 vs 7.5
            ("spree", {"kills": 30}, {"kills": 29}),
            ("playmaker", {"assists": 50}, {"assists": 49}),
            ("marathon", {"duration": 1800}, {"duration": 1799}),
            ("lifeline", {"heal": 25000}, {"heal": 24999}),
            ("wall", {"mitigated": 120000}, {"mitigated": 119999}),
            ("crit", {"crit": 1500}, {"crit": 1499}),
            ("unstoppable", {"spree": 8}, {"spree": 7}),
            ("midas", {"gold": 25000}, {"gold": 24999}),
        ]
        for bid, earns, misses in cases:
            self.assertIn(bid, ids(game(**earns)), f"{bid} should be earned")
            self.assertNotIn(bid, ids(game(**misses)), f"{bid} should not be earned")

    def test_percentages_count_as_the_page_rounds_them(self):
        self.assertIn("everywhere", ids(game(kp=0.895)))      # shown as 90%
        self.assertNotIn("everywhere", ids(game(kp=0.894)))   # shown as 89%
        self.assertIn("carry", ids(game(dmgShare=0.395)))
        self.assertNotIn("carry", ids(game(dmgShare=0.394)))
        self.assertNotIn("everywhere", ids(game(kp=None)))   # no team kills

    def test_kda_with_no_deaths_counts_deaths_as_one(self):
        self.assertIn("untouch", ids(game(kills=4, assists=4, deaths=0)))

    def test_a_remake_earns_nothing(self):
        self.assertEqual(ids(game(remake=True, damage=200000, pentas=1)), [])

    def test_personal_best_needs_that_players_best_damage(self):
        self.assertIn("best", ids(game(damage=50000), best=50000))
        self.assertNotIn("best", ids(game(damage=49000), best=50000))
        self.assertNotIn("best", ids(game(damage=50000)))   # best not known
        b = game_badges(game(damage=50000), best=50000, name="Kev")[0]
        self.assertEqual(b["what"], "50,000 damage: Kev's highest damage to champions in any saved game.")

    def test_duo_badges_need_both_of_you_on_the_team(self):
        big = game(damage=70000, kills=20)
        duo = lambda mate: [i for i in ids(big, mate=mate) if i in ("twins", "killers")]
        self.assertEqual(duo(game(damage=70000, kills=20)), ["twins", "killers"])
        self.assertEqual(duo(game(damage=69999, kills=19)), [])
        self.assertEqual(duo(None), [])   # no partner in that game

    def test_multikills_one_badge_per_kind_with_how_many(self):
        b = {x["id"]: x for x in game_badges(game(pentas=2, quadras=1, kills=10, deaths=10))}
        self.assertEqual((b["penta"]["multi"], b["quadra"]["multi"]), (2, 0))   # a quadra: just one
        self.assertEqual(b["penta"]["what"], "2 pentakills in one game.")
        self.assertEqual(b["quadra"]["what"], "1 quadra kill in one game.")

    def test_what_each_badge_means_for_the_game(self):
        x = game(damage=123456, kills=6, assists=10, deaths=2, kp=0.912, duration=1845, mitigated=130000)
        what = {b["id"]: b["what"] for b in game_badges(x)}
        self.assertEqual(what["sixfig"], "Dealt 123,456 damage to champions (100,000 or more).")
        self.assertEqual(what["untouch"], "A KDA of 8.0 (8 or better).")
        self.assertEqual(game_badges(game(kills=33, assists=0, deaths=4))[0]["what"], "A KDA of 8.3 (8 or better).")   # 8.25
        self.assertEqual(what["everywhere"], "In on 91% of the team's kills (90% or more).")
        self.assertEqual(what["marathon"], "A 30-minute game (30 minutes or more).")
        self.assertEqual(what["wall"], "Blocked or reduced 130,000 damage (120,000 or more).")


class CatalogueTests(unittest.TestCase):
    def test_every_badge_has_a_border_drawn_for_it(self):
        art = (Path(__file__).parent.parent / "web" / "js" / "badgeart.js").read_text()
        borders = art[art.index("const BADGE_BORDERS"):]
        borders = set(re.findall(r"^\s+(\w+):", borders[:borders.index("};")], re.M))
        self.assertEqual({b[0] for b in BADGES} - borders, set())

    def test_catalogue_lists_every_badge_in_order(self):
        c = catalog()
        self.assertEqual([b["id"] for b in c], [b[0] for b in BADGES])
        self.assertEqual(c[1], {"id": "sixfig", "ic": "💥", "name": "Six Figures", "how": "Deal 100,000 or more damage to champions."})


class AttachTests(unittest.TestCase):
    def test_rows_get_their_badges_with_each_players_best_and_partner(self):
        rows = {"a#1": [game("1", damage=80000, kills=25), game("2", damage=30000)],
                "b#2": [game("1", damage=75000, kills=20), game("2", damage=10000)]}
        attach(rows, {"a#1": "a", "b#2": "b"})
        self.assertEqual([b["id"] for b in rows["a#1"][0]["badges"]], ["best", "twins", "killers"])
        self.assertIn("a's highest", rows["a#1"][0]["badges"][0]["what"])
        self.assertEqual(rows["a#1"][1]["badges"], [])
        self.assertEqual([b["id"] for b in rows["b#2"][0]["badges"]], ["best", "twins", "killers"])
        solo = {"a#1": [game("1", damage=80000, kills=25)]}
        attach(solo, {"a#1": "a"})
        self.assertEqual([b["id"] for b in solo["a#1"][0]["badges"]], ["best"])   # no partner, no duo badges

    def test_counts_are_one_per_game(self):
        rows = {"a": [game("1", damage=80000, kills=25, triples=2), game("2", triples=1)],
                "b": [game("1", damage=75000, kills=20), game("2", damage=10000)]}
        self.assertEqual(badge_counts(rows)["a"], {"best": 1, "twins": 1, "killers": 1, "triple": 2})

    def test_match_details_badges_for_everyone(self):
        me = dict(game(damage=90000, kills=22), name="Kev", player=0, riotId="Kev#NA1")
        duo = dict(game(damage=71000, kills=20), name="Steph", player=1, riotId="Steph#NA1")
        stranger = dict(game(damage=150000), name="Rando", player=None, riotId="")
        foe = dict(game(damage=80000, kills=21), name="Foe", player=None, riotId="")
        detail = {"duration": 1500, "remake": False, "teams": [{"players": [me, duo, stranger]}, {"players": [foe]}]}
        attach_match(detail, {"kev#na1": 90000, "steph#na1": 100000})
        got = lambda r: [b["id"] for b in r["badges"]]
        self.assertEqual(got(me), ["best", "twins", "killers"])
        self.assertEqual(got(duo), ["twins", "killers"])   # not Steph's best
        self.assertEqual(got(stranger), ["sixfig"])        # no Personal Best for someone untracked
        self.assertEqual(got(foe), [])
