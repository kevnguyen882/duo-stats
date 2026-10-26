import unittest

from duostats.storage import game_id_of
from tests.helpers import TempStorageCase, api_match, client_game


class GameIdTests(unittest.TestCase):
    def test_both_sources_line_up(self):
        self.assertEqual(game_id_of("NA1_5664919632"), "5664919632")
        self.assertEqual(game_id_of(5664919632), "5664919632")


class StorageTests(TempStorageCase):
    def test_json_round_trip_and_defaults(self):
        path = self.storage.path("x/thing.json")
        self.assertEqual(self.storage.read_json(path, {"none": 1}), {"none": 1})
        self.assertTrue(self.storage.write_json(path, {"a": [1, 2]}))
        self.assertEqual(self.storage.read_json(path), {"a": [1, 2]})
        self.assertFalse(path.with_name("thing.json.tmp").exists())   # the temporary file is renamed into place

    def test_broken_json_reads_as_default(self):
        path = self.storage.path("bad.json")
        path.write_text("{not json")
        self.assertEqual(self.storage.read_json(path, []), [])

    def test_saved_games_prefer_the_client_copy(self):
        self.storage.save_client_game(client_game(game_id=5000000002))
        self.storage.save_api_match(api_match(match_id="NA1_5000000002"))   # the same game, from Riot's API
        self.storage.save_api_match(api_match(match_id="NA1_5000000003"))
        games = self.storage.saved_games()
        self.assertEqual(sorted(src for src, _ in games), ["api", "client"])
        self.assertEqual(self.storage.saved_game_ids(), {"5000000002", "5000000003"})
        self.assertTrue(self.storage.has_game("NA1_5000000003"))
        self.assertFalse(self.storage.has_game(1))
        self.assertEqual(self.storage.saved_game("5000000002")[0], "client")
        self.assertEqual(self.storage.saved_game("5000000003")[0], "api")
        self.assertIsNone(self.storage.saved_game("9"))

    def test_api_match_without_an_id_is_not_saved(self):
        self.assertFalse(self.storage.save_api_match({"metadata": {}}))

    def test_game_grades_keep_the_better_grade(self):
        self.storage.save_game_grades("NA1_7", {"a#1": "S"})
        self.storage.save_game_grades(7, {"a#1": "A", "b#2": "S-"})
        self.storage.save_game_grades("7", {"a#1": "S+"})
        self.assertEqual(self.storage.game_grades("7"), {"a#1": "S+", "b#2": "S-"})

    def test_settings_update_ignores_none(self):
        self.storage.update_settings(region="EUW", queue="450")
        self.storage.update_settings(region=None, queue="")
        self.assertEqual(self.storage.settings(), {"region": "EUW", "queue": ""})


if __name__ == "__main__":
    unittest.main()
