import contextlib
import io
import unittest

from duostats.chat import GRADE, PostGameChatReader, is_post_game
from duostats.games import Player
from duostats.season import SeasonGrades
from tests.helpers import FakeClient, FakeRiot, TempStorageCase

ISOLATE = "⁦{}⁩"   # the client wraps player names in these invisible direction marks


class GradePatternTests(unittest.TestCase):
    def test_finds_s_grades(self):
        self.assertEqual(GRADE.findall("Name earned an S on Xerath"), ["S"])
        self.assertEqual(GRADE.findall("Name earned an S+ on Ekko"), ["S+"])
        self.assertEqual(GRADE.findall("earned an S- on Vi"), ["S-"])

    def test_ignores_s_inside_words_and_names(self):
        self.assertEqual(GRADE.findall("Seraphine Sona SS S++ S1"), [])


class PostGameTests(unittest.TestCase):
    def test_post_game_conversations(self):
        self.assertTrue(is_post_game({"type": "postGame"}))
        self.assertTrue(is_post_game({"id": "abc@post-game.pvp.net"}))
        self.assertFalse(is_post_game({"type": "championSelect", "id": "x@champ-select"}))


class ChatReaderTests(TempStorageCase):
    def setUp(self):
        super().setUp()
        self.client = FakeClient()
        self.client.convs = [{"id": "c1", "type": "postGame"}, {"id": "lobby", "type": "customGame"}]
        self.client.session_data = {"gameData": {"gameId": 777, "teamOne": [
            {"puuid": "puuid-one", "championId": 37}, {"puuid": "puuid-two", "championId": 101}]}}
        self.season = SeasonGrades(self.storage, self.client, FakeRiot())
        self.reader = PostGameChatReader(self.storage, self.client, self.season)
        self.players = [Player("Duo One#NA1"), Player("Duo Two#NA2")]

    def say(self, *messages):
        self.client.msgs["c1"] = [{"id": str(i), "type": t, "body": b} for i, (t, b) in enumerate(messages)]

    def read(self):
        with contextlib.redirect_stdout(io.StringIO()):   # it prints each new grade
            return self.reader.read(self.players)

    def test_named_player_gets_their_champion_from_the_game(self):
        self.say(("celebration", ISOLATE.format("Duo Two") + " earned an S on Xerath"),
                 ("celebration", ISOLATE.format("Someone Else") + " earned an S+ on Ekko"))
        self.assertEqual(self.read(), [("Duo Two#NA2", "101", "S")])
        self.assertEqual(self.storage.game_grades("777"), {"duo two#na2": "S"})
        self.assertEqual(self.storage.season()["duo two#na2"]["apiGrades"]["101"][0], "S")

    def test_you_means_the_logged_in_player(self):
        self.say(("celebration", "You earned an S+ on Sona"))
        self.assertEqual(self.read(), [("Duo One#NA1", "37", "S+")])

    def test_players_own_messages_are_ignored(self):
        self.say(("chat", "Duo Two earned an S on Xerath lol"), ("groupchat", "Duo One S+"))
        self.assertEqual(self.read(), [])
        self.assertFalse(self.storage.path("postgame_messages.jsonl").exists())   # and never logged

    def test_each_message_counts_once(self):
        self.say(("celebration", "You earned an S on Sona"))
        self.assertEqual(len(self.read()), 1)
        self.assertEqual(self.read(), [])

    def test_champion_name_fallback_prefers_the_longest_match(self):
        self.client.session_data = {}   # the game session is gone
        self.say(("celebration", "Duo One earned an S on Viktor"))
        self.assertEqual(self.read(), [("Duo One#NA1", "112", "S")])   # Viktor, not Vi

    def test_closed_client_finds_nothing(self):
        self.client.closed = True
        self.assertEqual(self.reader.read(self.players), [])


if __name__ == "__main__":
    unittest.main()
