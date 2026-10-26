import contextlib
import io
import unittest
from unittest import mock

from duostats.games import Player
from duostats.season import SeasonGrades
from tests.helpers import FakeClient, FakeRiot, TempStorageCase


class SeasonTests(TempStorageCase):
    def setUp(self):
        super().setUp()
        self.client = FakeClient()
        self.season = SeasonGrades(self.storage, self.client, FakeRiot())

    def test_record_keeps_only_improvements(self):
        self.assertTrue(self.season.record("Duo One#NA1", 1, "S-"))
        self.assertFalse(self.season.record("Duo One#NA1", "1", "A"))
        self.assertTrue(self.season.record("Duo One#NA1", 1, "S+"))
        self.assertEqual(self.storage.season()["duo one#na1"]["apiGrades"]["1"][0], "S+")

    def test_capture_from_client(self):
        self.client.mastery = {"1": {"highestGrade": "S"}, "37": {"milestoneGrades": ["A"]}, "62": {}}
        with contextlib.redirect_stdout(io.StringIO()):   # it prints what it saved
            self.assertTrue(self.season.capture_from_client())
        self.assertEqual(self.storage.season()["duo one#na1"]["grades"], {"1": "S", "37": "A"})
        self.assertFalse(self.season.capture_from_client())   # nothing new the second time

    def test_board_only_s_grades_from_this_season(self):
        self.client.closed = True   # the board still works from what's saved
        start = 1_000_000
        self.storage.write_json(self.storage.path("season_grades.json"), {"duo one#na1": {
            "updated": start + 5,
            "grades": {"1": "S", "37": "A+"},
            "apiGrades": {"1": ["S+", start + 1], "62": ["S-", start - 1], "101": ["S", start + 2]},
        }})
        with mock.patch("duostats.season.season_start_ms", return_value=start):
            board = self.season.board([Player("Duo One#NA1")], "NA")
        self.assertEqual(board["players"][0]["champs"], {"1": "S+", "101": "S"})   # last season's 62 left out
        self.assertEqual(board["players"][0]["clientUpdated"], start + 5)

    def test_board_ignores_client_grades_from_last_season(self):
        self.client.closed = True
        self.storage.write_json(self.storage.path("season_grades.json"),
                                {"duo one#na1": {"updated": 10, "grades": {"1": "S+"}}})
        with mock.patch("duostats.season.season_start_ms", return_value=1000):
            p = self.season.board([Player("Duo One#NA1")], "NA")["players"][0]
        self.assertEqual((p["champs"], p["clientUpdated"]), ({}, None))


if __name__ == "__main__":
    unittest.main()
