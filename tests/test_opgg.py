"""op.gg's builds: reading its pages, and keeping a copy on this Mac. Uses small made-up pages, never the network."""

import json
import time
import unittest

from duostats.errors import DuoStatsError
from duostats.opgg import OpggBuilds, parse_augments, parse_items, slug

from .helpers import TempStorageCase


def page(data: str) -> str:
    """A page shaped like op.gg's: its data pushed in pieces to self.__next_f."""
    half = len(data) // 2
    return "<html><body>" + "".join(f"<script>self.__next_f.push({json.dumps([1, part])})</script>"
                                    for part in (data[:half], data[half:])) + "</body></html>"


def items_page() -> str:
    core = [{"ids": [6655, 4646, 4645], "pick_rate": 9.48, "play": "1,223", "win_rate": 53.811},
            {"ids": [3118, 4645, 3089], "pick_rate": 8.29, "play": "195", "win_rate": 48.2}]
    starter = [{"ids": [2003, 2003, 3802], "pick_rate": 65.29, "play": "1,851", "win_rate": 54.99}] + \
              [{"ids": [1001], "pick_rate": 1, "play": "5", "win_rate": 50}] * 5
    boots = [{"ids": [3020], "pick_rate": 85.88, "play": "2,245", "win_rate": 55.1}]
    final = [{"ids": [4645 + i], "pick_rate": 60 - i, "play": "100", "win_rate": 50} for i in range(8)]
    return page('["$","li","items",{"children":"Items"}],'   # the Items tab, not the table
                f'["$","h3",null,{{"children":"Core builds"}}],["$","$L62",null,{{"data":{json.dumps(core)}}}],'
                f'["$","h3",null,{{"children":"Boots"}}],["$","$L6a",null,{{"data":{json.dumps(boots)}}}],'
                f'["$","h3",null,{{"children":"Starter items"}}],["$","$L6b",null,{{"data":{json.dumps(starter)}}}],'
                f'["$","h3",null,{{"children":"Items"}}],["$","$L6a",null,{{"data":{json.dumps(final)}}}]')


def augments_page() -> str:
    rows = [{"id": 100 + i, "name": f"Silver {i}", "rarity": 1, "popular": 5 - i / 10} for i in range(8)]
    rows += [{"id": 200, "name": "Gold", "rarity": 4, "popular": 3}, {"id": 300, "name": "Prism", "rarity": 8, "popular": 9},
             {"id": 201, "popular": 4}]   # op.gg sometimes leaves the name and rarity off
    return page('["$","$L63",null,' + json.dumps({"data": rows}) + "]")


class ParseTest(unittest.TestCase):
    def test_slug(self):
        self.assertEqual(slug("MonkeyKing"), "monkeyking")
        self.assertEqual(slug("Nunu"), "nunu")

    def test_items(self):
        got = parse_items(items_page())
        self.assertEqual(got["core"][0], {"items": [6655, 4646, 4645], "pick": 9.5, "win": 53.8, "games": 1223})
        self.assertEqual(len(got["core"]), 2)
        self.assertEqual(got["starter"][0]["items"], [2003, 2003, 3802])   # boots aren't mistaken for starters
        self.assertEqual(len(got["starter"]), 3)                           # the top 3 only
        self.assertEqual([b["items"] for b in got["final"]], [[4645 + i] for i in range(6)])   # the top 6 items
        self.assertEqual(got["final"][0]["pick"], 60.0)

    def test_items_layout_changed(self):
        with self.assertRaises(DuoStatsError):
            parse_items(page('{"nothing":"here"}'))

    def test_augments(self):
        got = parse_augments(augments_page(), {"201": "Gold"})
        self.assertEqual([a["id"] for a in got["Silver"]], [100, 101, 102, 103, 104, 105])   # most picked 6
        self.assertEqual([a["id"] for a in got["Gold"]], [201, 200])   # 201's rarity comes from the game
        self.assertEqual(got["Prismatic"], [{"id": 300, "name": "Prism", "pick": 9.0}])


class BuildsTest(TempStorageCase):
    def setUp(self):
        super().setUp()
        self.asked = []
        self.down = False

        def fetch(url):
            self.asked.append(url)
            if self.down:
                raise DuoStatsError("Couldn't reach op.gg")
            return augments_page() if url.endswith("/augments") else items_page()
        self.opgg = OpggBuilds(self.storage, lambda: {}, fetch)

    def test_mayhem_has_augments_and_is_kept(self):
        got = self.opgg.builds("MonkeyKing", 2400)
        self.assertEqual(got["url"], "https://op.gg/lol/modes/aram-mayhem/monkeyking/build")
        self.assertIn("augments", got)
        self.assertEqual(len(self.asked), 2)
        self.opgg.builds("MonkeyKing", "2400")   # asked again soon: the saved copy
        self.assertEqual(len(self.asked), 2)

    def test_older_saved_format_is_fetched_again(self):
        self.storage.write_json(self.storage.path("opgg/aram-ahri.json"), {"fetched": time.time(), "core": []})
        self.assertIn("final", self.opgg.builds("Ahri", 450))
        self.assertEqual(len(self.asked), 1)

    def test_aram_has_items_only(self):
        got = self.opgg.builds("Ahri", 450)
        self.assertNotIn("augments", got)
        self.assertEqual(self.asked, ["https://op.gg/lol/modes/aram/ahri/items"])

    def test_other_modes(self):
        with self.assertRaises(DuoStatsError):
            self.opgg.builds("Ahri", 420)

    def test_old_copy_when_opgg_is_down(self):
        self.opgg.builds("Ahri", 450)
        path = self.storage.path("opgg/aram-ahri.json")
        old = self.storage.read_json(path)
        self.storage.write_json(path, {**old, "fetched": time.time() - 2 * 86400})
        self.down = True
        got = self.opgg.builds("Ahri", 450)
        self.assertTrue(got["stale"])
        self.assertEqual(got["core"], old["core"])

    def test_down_with_no_copy(self):
        self.down = True
        with self.assertRaises(DuoStatsError):
            self.opgg.builds("Ahri", 450)
