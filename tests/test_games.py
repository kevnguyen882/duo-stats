import unittest

from duostats.games import Player, clean_riot_id, match_detail, parse, rows_for
from tests.helpers import api_match, catalog, client_game, default_players, stats


class CleanRiotIdTests(unittest.TestCase):
    def test_spaces_around_the_hash_are_dropped(self):
        self.assertEqual(clean_riot_id("damn son #NA12"), "damn son#NA12")
        self.assertEqual(clean_riot_id("  Name # TAG "), "Name#TAG")

    def test_no_tag(self):
        self.assertEqual(clean_riot_id("NoTag"), "NoTag")
        self.assertEqual(clean_riot_id(""), "")


class ParseTests(unittest.TestCase):
    def test_client_game(self):
        g = parse("client", client_game(), catalog())
        self.assertEqual((g.game_id, g.source, g.queue_id, g.duration), ("5000000001", "client", 450, 1500))
        me = g.participants[1]
        self.assertEqual(me.riot_id, "duo two#na2")
        self.assertEqual(me.name, "Duo Two")
        self.assertEqual(me.champion, "MonkeyKing")   # champion ids become aliases
        self.assertEqual(me.team, (100, 0))
        self.assertEqual(me.stats["cs"], 160)         # lane minions + jungle monsters

    def test_client_game_mode_copy_of_a_champion(self):
        players = [("A", "1", "p", 60062, 100, stats())]
        self.assertEqual(parse("client", client_game(players=players), catalog()).participants[0].champion, "MonkeyKing")

    def test_client_items_and_augments(self):
        st = stats(item0=3089, item1=0, item2=3020, playerAugment1=12, playerAugment2=0, playerSubteamId=3)
        p = parse("client", client_game(players=[("A", "1", "p", 1, 100, st)]), catalog()).participants[0]
        self.assertEqual(p.items, [3089, 3020])       # empty slots left out
        self.assertEqual(p.augments, [12])
        self.assertEqual(p.team, (100, 3))            # Arena sub-team

    def test_api_match(self):
        g = parse("api", api_match(), None)
        self.assertEqual((g.game_id, g.source), ("5000000002", "api"))   # "NA1_" prefix dropped, so both sources line up
        self.assertEqual(g.participants[0].riot_id, "duo one#na1")
        self.assertEqual(g.participants[0].champion, "Annie")

    def test_api_old_matches_in_milliseconds(self):
        self.assertEqual(parse("api", api_match(duration=1_500_000), None).duration, 1500)

    def test_remakes(self):
        self.assertTrue(parse("client", client_game(duration=240), catalog()).remake)   # under 5 minutes
        self.assertFalse(parse("client", client_game(duration=301), catalog()).remake)
        players = default_players()
        players[0] = players[0][:5] + (stats(gameEndedInEarlySurrender=True),)
        self.assertTrue(parse("api", api_match(players=players), None).remake)

    def test_missing_name(self):
        players = [("", "", "p", 1, 100, stats())]
        self.assertEqual(parse("client", client_game(players=players), catalog()).participants[0].riot_id, "")


class RowTests(unittest.TestCase):
    def setUp(self):
        self.game = parse("client", client_game(), catalog())
        self.one, self.two = Player("Duo One #NA1"), Player("Duo Two#NA2")

    def test_player_found_by_riot_id_or_puuid(self):
        self.assertEqual(self.one.find_in(self.game).champion, "Annie")
        by_id = Player("Renamed#XX", ids={"puuid-two"})   # a name change still matches by ID
        self.assertEqual(by_id.find_in(self.game).champion, "MonkeyKing")
        self.assertIsNone(Player("Nobody#NA1").find_in(self.game))

    def test_rows_together(self):
        rows = rows_for([self.one, self.two], self.game)
        r = rows["duo one#na1"]
        self.assertTrue(r["withDuo"])
        self.assertFalse(r["vsDuo"])
        self.assertAlmostEqual(r["kp"], (10 + 5) / 20)        # team kills: 10 + 6 + 4
        self.assertAlmostEqual(r["dmgShare"], 40000 / 100000)
        self.assertEqual(r["matchId"], "5000000001")

    def test_rows_against_each_other(self):
        players = default_players()
        players[1] = players[1][:4] + (200,) + players[1][5:]
        rows = rows_for([self.one, self.two], parse("client", client_game(players=players), catalog()))
        self.assertTrue(rows["duo one#na1"]["vsDuo"])
        self.assertFalse(rows["duo one#na1"]["withDuo"])

    def test_only_tracked_players_in_the_game_get_rows(self):
        self.assertEqual(list(rows_for([self.one, Player("Nobody#NA1")], self.game)), ["duo one#na1"])

    def test_no_team_kills_or_damage(self):
        players = [("Duo One", "NA1", "p", 1, 100, stats(kills=0, assists=0, totalDamageDealtToChampions=0))]
        r = rows_for([self.one], parse("client", client_game(players=players), catalog()))["duo one#na1"]
        self.assertIsNone(r["kp"])
        self.assertIsNone(r["dmgShare"])


class MatchDetailTests(unittest.TestCase):
    def test_our_team_first_with_grades(self):
        game = parse("client", client_game(), catalog())
        players = [Player("Duo One#NA1"), Player("Duo Two#NA2")]
        d = match_detail(game, players, {"duo two#na2": "S+"})
        self.assertEqual(len(d["teams"]), 2)
        ours = d["teams"][0]
        self.assertTrue(ours["win"])
        two = next(p for p in ours["players"] if p["name"] == "Duo Two")
        self.assertEqual((two["player"], two["grade"], two["riotId"]), (1, "S+", "Duo Two#NA2"))
        self.assertIsNone(next(p for p in ours["players"] if p["name"] == "Mate")["player"])

    def test_enemy_team_first_when_only_they_are_tracked(self):
        game = parse("client", client_game(), catalog())
        d = match_detail(game, [Player("Enemy A#EUW")], {})
        self.assertFalse(d["teams"][0]["win"])


if __name__ == "__main__":
    unittest.main()
