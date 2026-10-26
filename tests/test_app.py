import unittest

from duostats.app import App
from tests.helpers import FakeClient, FakeRiot, TempStorageCase


class FakeKeychain:
    def get(self):
        return ""


class AppTests(TempStorageCase):
    def setUp(self):
        super().setUp()
        self.app = App(storage=self.storage, client=FakeClient(), riot=FakeRiot(), keychain=FakeKeychain())
        self.storage.update_settings(players=["Duo One#NA1", "Duo Two#NA2"])

    def test_save_settings_keeps_only_valid_values(self):
        out = self.app.save_settings({"players": [" A#1 ", "B#2", "C#3"], "region": "MOON", "queue": "450",
                                      "count": "5000", "secret": "x"})
        self.assertEqual(out["players"], ["A#1", "B#2"])   # two players at most, trimmed
        self.assertIsNone(out["region"])                   # not a real region
        self.assertEqual((out["queue"], out["count"]), ("450", 1000))
        self.assertNotIn("secret", self.storage.settings())

    def test_save_settings_bad_count_is_ignored(self):
        self.assertIsNone(self.app.save_settings({"count": "lots"})["count"])

    def test_each_player_arranges_only_their_own_showcase(self):
        board = {"best|Annie": {"x": 0.5, "y": 0.25, "z": 3}}
        self.assertEqual(self.app.save_showcase({"owner": "Duo One #NA1", "board": board}, viewer=False)["badges"], 1)
        self.assertEqual(self.app.save_showcase({"owner": "Duo Two#NA2", "board": board}, viewer=True)["badges"], 1)
        with self.assertRaises(PermissionError):   # this Mac is player 1
            self.app.save_showcase({"owner": "Duo Two#NA2", "board": board}, viewer=False)
        with self.assertRaises(PermissionError):   # another computer is player 2
            self.app.save_showcase({"owner": "Duo One#NA1", "board": board}, viewer=True)

    def test_showcase_drops_bad_positions(self):
        board = {"ok": {"x": 0.123456, "y": 1, "z": -5}, "off-board": {"x": 2, "y": 0}, "junk": {"x": "a", "y": 0},
                 "missing": {"y": 0}, "k" * 121: {"x": 0, "y": 0}}
        self.app.save_showcase({"owner": "Duo One#NA1", "board": board}, viewer=False)
        saved = self.app.showcases()["duo one#na1"]["board"]
        self.assertEqual(saved, {"ok": {"x": 0.1235, "y": 1.0, "z": 0}})


if __name__ == "__main__":
    unittest.main()
