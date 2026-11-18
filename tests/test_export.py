"""
The exporter's rules, on small databases with the bots' real schema.

    python3 tests/test_export.py
"""
import json
import os
import shutil
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
sys.dont_write_bytecode = True

from exporter import export as ex  # noqa: E402
from exporter.rules import (  # noqa: E402
    fold, glob_match, parse_exclude_list, player_key, rating, result,
)
from exporter.snapshot import open_snapshot, snapshot  # noqa: E402
from tests.fixtures import FixtureDB  # noqa: E402


def rows(t):
    return [dict(zip(t["cols"], r)) for r in t["rows"]]


class ExportCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.pub = FixtureDB(os.path.join(self.tmp, "pub.db"), "pub")
        self.league = FixtureDB(os.path.join(self.tmp, "league.db"), "league")
        self.out = os.path.join(self.tmp, "data")

    def tearDown(self):
        self.pub.close()
        self.league.close()
        shutil.rmtree(self.tmp)

    def run_export(self, **kw):
        pub = open_snapshot(self.pub.path)
        league = open_snapshot(self.league.path)
        try:
            return ex.export(pub, league, self.out, **kw)
        finally:
            pub.close()
            league.close()

    def load(self, rel):
        with open(os.path.join(self.out, rel), encoding="utf-8") as f:
            return json.load(f)

    def player(self, name):
        return self.load("p/%s.json" % player_key(name))

    def all_text(self):
        text = []
        for folder, _d, files in os.walk(self.out):
            for f in files:
                with open(os.path.join(folder, f), encoding="utf-8") as fh:
                    text.append(fh.read())
        return "\n".join(text)


class TestCareers(ExportCase):
    def test_a_neobot_only_career_says_not_tracked_never_zero(self):
        self.pub.neobot_career("Oldie", matches=4, wins=3, kills=40,
                               deaths=10, teamkills=None, attached_to=None,
                               active_time=3600.0)
        self.run_export()
        for scope in ("all", "neobot"):
            c = self.player("Oldie")["pub"]["careers"][scope]
            self.assertEqual(c["matches"], 4)
            self.assertEqual(c["neobot_matches"], 4)
            for untracked in ("teamkills", "attached_to", "safe_touches",
                              "best_streak", "streaks", "attaches",
                              "captained"):
                self.assertIsNone(c[untracked], (scope, untracked))
        self.assertIsNone(self.player("Oldie")["pub"]["careers"]["pub"])

    def test_no_scope_adds_neobot_to_the_pub_bot(self):
        m = self.pub.match()
        self.pub.player(m, "Both", 0, True, kills=7, deaths=2, teamkills=1,
                        safe_touches=2, active_time=500.0)
        self.pub.neobot_career("Both", matches=10, wins=4, kills=30,
                               deaths=20, teamkills=None, active_time=900.0)
        self.run_export()
        careers = self.player("Both")["pub"]["careers"]
        self.assertEqual(careers["all"]["matches"], 11)
        self.assertEqual(careers["all"]["kills"], 37)
        # A Neobot NULL adds as 0 to a merged career, as the bot sums it.
        self.assertEqual(careers["all"]["teamkills"], 1)
        self.assertEqual(careers["all"]["safe_touches"], 2)
        self.assertEqual(careers["all"]["neobot_matches"], 10)
        self.assertEqual(careers["pub"]["matches"], 1)
        self.assertIsNone(careers["pub"]["neobot_matches"])
        # Every pub match, earlier and recent, together.
        self.assertEqual(careers["pub_all"]["matches"], 11)
        self.assertEqual(careers["pub_all"]["kills"], 37)
        self.assertEqual(careers["pub_all"]["neobot_matches"], 10)

    def test_the_combined_pub_career_leaves_out_private_matches(self):
        pub = self.pub.match()
        priv = self.pub.match(mode="private", score=(5, 1), winner=100)
        self.pub.player(pub, "Kim", 0, True, kills=2)
        self.pub.player(priv, "Kim", 100, True, kills=50)
        self.pub.neobot_career("Kim", matches=3, wins=1, kills=6)
        self.run_export()
        c = self.player("Kim")["pub"]["careers"]
        self.assertEqual((c["pub_all"]["matches"], c["pub_all"]["kills"]), (4, 8))
        self.assertEqual((c["all"]["matches"], c["all"]["kills"]), (5, 58))

    def test_an_aborted_match_counts_in_no_career_but_is_in_the_history(self):
        m = self.pub.match(score=(0, 0), winner=None, outcome="aborted")
        self.pub.player(m, "Ann", 0, False, kills=3)
        self.run_export()
        doc = self.player("Ann")
        self.assertIsNone(doc["pub"]["careers"]["all"])
        hist = rows(doc["pub"]["matches"])
        self.assertEqual([(h["id"], h["result"]) for h in hist], [(m, "-")])

    def test_a_no_result_row_is_neither_a_win_nor_a_loss(self):
        m = self.pub.match()
        self.pub.player(m, "Late", 1, False, no_result=1)
        self.run_export()
        doc = self.player("Late")
        self.assertEqual(doc["pub"]["careers"]["all"]["no_results"], 1)
        self.assertEqual(rows(doc["pub"]["matches"])[0]["result"], "N")

    def test_the_scopes_narrow_as_the_bot_does(self):
        hard = self.pub.match(game_mode="hard", game_mode_freq=0)
        priv = self.pub.match(mode="private", score=(2, 5), winner=200)
        self.pub.player(hard, "Kim", 0, True)
        self.pub.player(priv, "Kim", 200, True)
        self.run_export()
        c = self.player("Kim")["pub"]["careers"]
        self.assertEqual((c["all"]["matches"], c["pub"]["matches"],
                          c["hard"]["matches"], c["private"]["matches"]),
                         (2, 1, 1, 1))
        self.assertIsNone(c["neobot"])

    def test_counted_rounds_only_joined_on_round_id(self):
        m = self.pub.match()
        self.pub.player(m, "Ann", 0, True)
        r1 = self.pub.round(m, 1, 0)
        skipped = self.pub.round(m, 2, None, counted=0, ended_by="nextbase",
                                 round_no=2)
        r2 = self.pub.round(m, 3, 0, round_no=2, attempt=2)
        for rid in (r1, skipped, r2):
            self.pub.round_player(rid, m, "Ann", 0, rid != skipped)
        self.run_export()
        c = self.player("Ann")["pub"]["careers"]["all"]
        self.assertEqual((c["rounds"], c["rounds_won"]), (2, 2))

    def test_a_league_section_is_never_added_to_the_pub_one(self):
        pm = self.pub.match()
        self.pub.player(pm, "Dual", 0, True, kills=5)
        lm = self.league.match(mode="scrim", team_a="Lions", team_b="Hyenas")
        self.league.player(lm, "Dual", 1, False, team="Hyenas", kills=9)
        self.run_export()
        doc = self.player("Dual")
        self.assertEqual(doc["pub"]["careers"]["all"]["kills"], 5)
        self.assertEqual(doc["league"]["careers"]["all"]["kills"], 9)
        self.assertEqual(doc["league"]["careers"]["scrim"]["last_team"],
                         "Hyenas")
        self.assertIsNone(doc["league"]["careers"]["league"])


class TestHistory(ExportCase):
    def test_a_private_players_score_is_their_own_freqs(self):
        m = self.pub.match(mode="private", score=(2, 5), winner=200)
        self.pub.player(m, "Cap", 200, True)
        self.run_export()
        h = rows(self.player("Cap")["pub"]["matches"])[0]
        self.assertEqual((h["result"], h["score_for"], h["score_against"]),
                         ("W", 5, 2))

    def test_newest_first_with_neobot_games_kept_apart(self):
        for start in (1.0, 2.0):
            m = self.pub.match(started=1760000000.0 + start)
            self.pub.player(m, "Ann", 1, False)
        self.pub.neobot_game(300, score=(1, 5), winner=1)
        self.pub.neobot_player(300, "Ann", 1, True, teamkills=None)
        self.pub.neobot_career("Ann", matches=1, wins=1)
        self.run_export()
        doc = self.player("Ann")["pub"]
        self.assertEqual([h["id"] for h in rows(doc["matches"])], [2, 1])
        old = rows(doc["neobot"])
        self.assertEqual((old[0]["id"], old[0]["result"],
                          old[0]["score_for"], old[0]["teamkills"]),
                         (300, "W", 5, None))

    def test_the_index_has_each_sections_first_match_earlier_games_included(self):
        m = self.pub.match()
        self.pub.player(m, "Ann", 0, True)
        self.pub.player(m, "Bob", 1, False)
        self.pub.neobot_game(300, score=(1, 5), winner=1)
        self.pub.neobot_player(300, "Ann", 1, True)
        self.pub.neobot_career("Ann", matches=1, wins=1)
        lm = self.league.match()
        self.league.player(lm, "Bob", 0, True)
        self.run_export()
        got = {p["name"]: (p["pub_first"], p["league_first"])
               for p in rows(self.load("players.json"))}
        self.assertEqual(got, {"Ann": (300, None), "Bob": (m, lm)})

    def test_a_league_match_nobody_won_is_only_in_the_matches_list(self):
        # The user, 2026-11-06: in the league, a match with no result counts
        # nowhere; its page and the matches list keep it, as !bdrecent does.
        stopped = self.league.match(mode="scrim", score=(1, 1), winner=None,
                                    outcome="aborted")
        self.league.player(stopped, "Ann", 0, False, kills=4)
        self.league.player(stopped, "Cy", 1, False)
        self.league.round(stopped, 1, 0, base_num=3)
        won = self.league.match(mode="scrim")
        self.league.player(won, "Ann", 0, True, kills=2)
        self.league.round(won, 1, 0, base_num=5)
        self.run_export()
        ann = self.player("Ann")["league"]
        self.assertEqual([h["id"] for h in rows(ann["matches"])], [won])
        self.assertEqual(ann["careers"]["all"]["kills"], 2)
        cy = self.player("Cy")
        self.assertEqual((rows(cy["league"]["matches"]), cy["league"]["careers"]["all"]),
                         ([], None))
        index = {p["name"]: p for p in rows(self.load("players.json"))}
        self.assertEqual((index["Ann"]["league_played"], index["Ann"]["league_first"]),
                         (1, won))
        self.assertEqual([r["base"] for r in rows(self.load("rounds/league.json"))], [5])
        meta = self.load("meta.json")["sections"]["league"]
        self.assertEqual((meta["matches"], [r["id"] for r in rows(meta["recent"])],
                          meta["unfinished"]), (1, [won], False))
        self.assertEqual(sorted(r["id"] for r in rows(self.load("facts/league.json")["matches"])),
                         sorted([stopped, won]))
        self.assertIn(str(stopped), self.load("m/league/0.json"))
        # The pub keeps its own: listed, and counted on the home page.
        m = self.pub.match(score=(0, 0), winner=None, outcome="aborted")
        self.pub.player(m, "Ann", 0, False)
        self.run_export()
        self.assertEqual([h["id"] for h in rows(self.player("Ann")["pub"]["matches"])], [m])
        self.assertTrue(self.load("meta.json")["sections"]["pub"]["unfinished"])


class TestPrivacy(ExportCase):
    def test_only_the_bot_list_leaves_the_database(self):
        m = self.pub.match()
        self.pub.player(m, "Marv1", 0, True)
        self.pub.player(m, "Human", 1, False)
        for player, flag in (("Marv1", "bot"), ("Allowed", "allow"),
                             ("Human", "allow"),
                             ("Follower", "follow_private"),
                             ("Notified", "notify_private")):
            self.pub.add("bd_player_flags", arena="*", player=player,
                         flag=flag, set_by="SecretOp")
        self.pub.add("bd_settings", arena="bdeg", key="game_mode",
                     value="SecretSetting", updated_by="SecretOp")
        self.run_export()
        self.assertTrue(self.player("Marv1")["pub"]["bot"])
        self.assertFalse(self.player("Human")["pub"]["bot"])
        text = self.all_text()
        for secret in ("Allowed", "Follower", "Notified", "SecretOp",
                       "SecretSetting"):
            self.assertNotIn(secret, text)

    def test_the_league_excludes_by_pattern(self):
        m = self.league.match(mode="scrim")
        self.league.player(m, "Zero-EG-3", 0, True)
        self.league.player(m, "ZeroCool", 1, False)
        self.run_export(league_exclude=parse_exclude_list("Zero-EG-*"))
        self.assertTrue(self.player("Zero-EG-3")["league"]["bot"])
        self.assertFalse(self.player("ZeroCool")["league"]["bot"])


class TestMatches(ExportCase):
    def test_a_replay_link_only_when_it_is_published(self):
        a = self.league.match(mode="match", arena="bdl",
                              recording="bd202611011900")
        b = self.league.match(mode="match", arena="bdl",
                              recording="bd202611012000")
        for mid in (a, b):
            self.league.player(mid, "Ann", 0, True)
        self.run_export(replays={"bdl-bd202611011900": "bdl-bd202611011900"},
                        replay_site="https://example.test/")
        shard = self.load("m/league/0.json")
        self.assertEqual(shard[str(a)]["match"]["replay"],
                         "https://example.test/r/bdl-bd202611011900")
        self.assertIsNone(shard[str(b)]["match"]["replay"])

    def test_base_control_only_from_a_published_replay_and_its_rounds(self):
        recs = ("bd202611011900", "bd202611012000", "bd202611012100")
        a, b, c = (self.league.match(mode="match", arena="bdl", recording=r)
                   for r in recs)
        for mid in (a, b, c):
            self.league.player(mid, "Ann", 0, True)
            self.league.round(mid, 1, 0)
        rnd = lambda seq, pct, shares: {"seq": seq, "round": seq, "attempt": 1,
                                        "base": 3, "held": pct / 100.0,
                                        "pct": pct, "shares": shares}
        control = {"bdl-" + r: {"id": "bdl-" + r, "rounds": [
            rnd(1, 62, [0.5, None, 0.74]),
            rnd(9, 40, [0.4])]}           # seq 9: no bd_rounds row, left out
            for r in (recs[0], recs[2])}
        # b is published with no control file; c has one, but no replay
        self.run_export(replays={"bdl-" + r: "bdl-" + r for r in recs[:2]},
                        control=control)
        shard = self.load("m/league/0.json")
        self.assertEqual(shard[str(a)]["control"], {"rounds": [
            {"seq": 1, "held": 62, "shares": [0.5, None, 0.74]}]})
        self.assertNotIn("control", shard[str(b)])
        self.assertNotIn("control", shard[str(c)])
        # the match page only: the lists and leaderboards' facts stay small
        self.assertNotIn('"shares"', json.dumps(self.load("facts/league.json")))

    def test_cloak_highlight_uses_published_matched_rounds_and_roster(self):
        recs = ("bd202611011900", "bd202611012000", "bd202611012100")
        a, b, c = (self.league.match(mode="match", arena="bdl", recording=r)
                   for r in recs)
        for mid in (a, b, c):
            for name in ("Ann", "Bob", "Carl", "Dan"):
                self.league.player(mid, name, 0, True)
            self.league.round(mid, 1, 0)
        replay_control = {
            "rounds": [{"seq": 1, "pct": 50, "shares": [0.5]}],
            "cloakPlayers": ["ANN", "bob", "Carl", "Spectator"],
            "cloak": [
                {"seq": 1, "name": "ann", "tiles": 20, "start": 100,
                 "end": 500, "seconds": 3.5},
                {"seq": 1, "name": "Bob", "tiles": 20, "start": 200,
                 "end": 600, "seconds": 4},
                {"seq": 9, "name": "Ann", "tiles": 1000, "start": 700,
                 "end": 900, "seconds": 2},
                {"seq": 1, "name": "Spectator", "tiles": 2000, "start": 100,
                 "end": 800, "seconds": 7},
            ],
            "cloakTotals": [
                {"seq": 1, "name": "ann", "tiles": 25, "seconds": 60.1},
                {"seq": 1, "name": "ANN", "tiles": 15, "seconds": 0.9},
                {"seq": 1, "name": "Bob", "tiles": 30, "seconds": 20},
                {"seq": 9, "name": "Ann", "tiles": 1000, "seconds": 1000},
                {"seq": 1, "name": "Spectator", "tiles": 2000, "seconds": 2000},
            ],
        }
        self.run_export(
            replays={"bdl-" + r: "bdl-" + r for r in recs[:2]},
            control={"bdl-" + recs[0]: replay_control,
                     "bdl-" + recs[2]: replay_control})
        shard = self.load("m/league/0.json")
        highlight, totals = shard[str(a)]["control"]["highlights"]
        self.assertEqual((highlight["group"], highlight["value"],
                          highlight["names"]), ("Movement", "20 tiles",
                                                ["Ann", "Bob"]))
        self.assertEqual(highlight["ranking"], [
            {"name": "Ann", "value": "20 tiles",
             "run": {"start": 100, "end": 500, "seconds": 3.5}},
            {"name": "Bob", "value": "20 tiles",
             "run": {"start": 200, "end": 600, "seconds": 4}},
            {"name": "Carl", "value": "0 tiles"},
            {"name": "Dan", "value": None},
        ])
        self.assertEqual((totals["label"], totals["value"], totals["names"]),
                         ("Total cloaked time & progress", "40 tiles", ["Ann"]))
        self.assertEqual(totals["ranking"], [
            {"name": "Ann", "value": "40 tiles / 1:01 cloaked"},
            {"name": "Bob", "value": "30 tiles / 0:20 cloaked"},
            {"name": "Carl", "value": "0 tiles / 0:00 cloaked"},
            {"name": "Dan", "value": None},
        ])
        for mid in (b, c):
            self.assertNotIn("control", shard[str(mid)])
        self.assertNotIn("cloak", json.dumps(self.load("facts/league.json")))

    def test_chat_only_from_a_published_replay_with_its_rounds(self):
        recs = ("bd202611011900", "bd202611012000", "bd202611012100",
                "bd202611012200")
        a, b, c, d = (self.league.match(mode="match", arena="bdl", recording=r)
                      for r in recs)
        for mid in (a, b, c, d):
            self.league.player(mid, "Ann", 0, True)
            self.league.round(mid, 1, 0)
        rnd = lambda seq, round_no: {"seq": seq, "round": round_no,
                                     "attempt": 1, "base": 3,
                                     "start": 100 * round_no,
                                     "end": 100 * round_no + 50}
        lines = [[40, "Ann", 0, "gl"], [120, "Bob", 1, "nice"],
                 [130, None, 0, "no sender"]]
        chat = {"bdl-" + recs[0]: {"id": "bdl-" + recs[0], "end": 900,
                                   # seq 9: no bd_rounds row (a recording
                                   # begun inside a round)
                                   "rounds": [rnd(9, 0), rnd(1, 1)],
                                   "lines": lines},
                "bdl-" + recs[2]: {"id": "bdl-" + recs[2], "end": 900,
                                   "rounds": [], "lines": lines},
                "bdl-" + recs[3]: {"id": "bdl-" + recs[3], "end": 900,
                                   "rounds": [rnd(1, 1)], "lines": []}}
        # b is published with no chat file; c has one but no replay; d's
        # replay has no chat at all
        got = self.run_export(replays={"bdl-" + r: "bdl-" + r
                                       for r in (recs[0], recs[1], recs[3])},
                              chat=chat)
        shard = self.load("m/league/0.json")
        self.assertEqual(shard[str(a)]["chat"], {
            "end": 900, "lines": lines,
            "rounds": [dict(rnd(9, 0), seq=None), rnd(1, 1)]})
        for mid in (b, c, d):
            self.assertNotIn("chat", shard[str(mid)])
        self.assertEqual(got["chat_matches"], 1)
        # the match page only
        self.assertNotIn("no sender", json.dumps(self.load("facts/league.json")))

    def test_stats_are_embedded_only_for_published_replays(self):
        recs = ("bd202611151432", "bd202611151500", "bd202611151530")
        a, b, c = (self.league.match(mode="match", arena="bdl", recording=r)
                   for r in recs)
        for mid in (a, b, c):
            self.league.player(mid, "Ann", 0, True)
            self.league.player(mid, "Bob", 1, False)
            self.league.player(mid, "Cy", 1, False)
        stats_dir = os.path.join(self.tmp, "replays")
        os.makedirs(stats_dir)
        raw = {
            "source": {"endTick": 10000},
            "players": [
                {"player": 1, "name": "ann", "shots": {"burst": 2}},
                {"player": 2, "name": "Bob", "shots": {"repel": 3}},
                {"player": 3, "name": "Cy", "shots": {}},
            ],
            "killLog": [
                {"t": 100, "killer": 1, "killed": 2, "weapon": "bullet",
                 "teamKill": False, "killerFreq": 0, "killedFreq": 1},
                {"t": 200, "killer": 1, "killed": 2, "weapon": "burst",
                 "teamKill": False, "killerFreq": 0, "killedFreq": 1},
                {"t": 300, "killer": 2, "killed": 1, "weapon": None,
                 "teamKill": False, "killerFreq": 1, "killedFreq": 0},
                {"t": 400, "killer": 3, "killed": 1, "weapon": "bomb",
                 "teamKill": True, "killerFreq": 1, "killedFreq": 0},
            ],
        }
        with open(os.path.join(stats_dir, "bdl-%s.stats.json" % recs[0]), "w") as f:
            json.dump(raw, f)
        # A stats file for an unpublished replay must not become site data.
        with open(os.path.join(stats_dir, "bdl-%s.stats.json" % recs[2]), "w") as f:
            json.dump(raw, f)

        got = self.run_export(
            replays={"bdl-" + r: "bdl-" + r for r in recs[:2]},
            stats_dir=stats_dir)
        shard = self.load("m/league/0.json")
        stats = shard[str(a)]["stats"]
        self.assertEqual(stats["end"], 10000)
        self.assertEqual(stats["players"][0],
                         {"player": 1, "name": "ann", "shots": {"burst": 2}})
        self.assertEqual(stats["kills"][0], {
            "t": 100, "killer": "ann", "killed": "Bob", "weapon": "bullet",
            "teamKill": False, "killerFreq": 0, "killedFreq": 1})
        self.assertEqual(stats["kills"][2]["weapon"], "unknown")
        self.assertEqual((stats["breakdowns"]["ann"]["kills"],
                          stats["breakdowns"]["ann"]["deaths"]), (2, 1))
        self.assertEqual(stats["breakdowns"]["ann"]["killed"], [{
            "name": "Bob", "freq": 1, "n": 2,
            "weapons": {"bullet": 1, "burst": 1}}])
        self.assertEqual(stats["breakdowns"]["ann"]["teamKilledBy"][0]["name"],
                         "Cy")
        self.assertEqual(
            [(h["label"], h["value"], h["names"]) for h in stats["highlights"]],
            [("Most kills in a minute", "2", ["Ann"]),
             ("Most enemy kills before dying", "2", ["Ann"]),
             ("Most deaths in a minute", "2", ["Ann", "Bob"]),
             ("Most deaths before a kill", "2", ["Ann", "Bob"]),
             ("Most kills in a minute without dying", "2", ["Ann"]),
             ("Most deaths in a minute without killing", "2", ["Ann", "Bob"])])
        self.assertNotIn("stats", shard[str(b)])
        self.assertNotIn("stats", shard[str(c)])
        self.assertEqual(got["stats_matches"], 1)

    def test_replay_highlights_use_half_open_rolling_minute_windows(self):
        kills = [
            {"t": 5900, "killer": "Ann", "killed": "Bob"},
            {"t": 6100, "killer": "Ann", "killed": "Cy"},
            {"t": 11899, "killer": "Ann", "killed": "Dee"},
            {"t": 11900, "killer": "Ann", "killed": "Eve"},
        ]
        for kill in kills:
            kill["teamKill"] = False
        highlights = ex.replay_highlights(kills, [{"player_name": "Ann"}])
        values = {h["label"]: h["value"] for h in highlights}
        # At 11900, the 5900 event is exactly 60 seconds old and is outside
        # the half-open window; the other three still qualify together.
        self.assertEqual(values["Most kills in a minute"], "3")
        self.assertEqual(values["Most kills in a minute without dying"], "3")
        self.assertEqual(values["Most enemy kills before dying"], "4")
        minute = next(h for h in highlights if h["label"] == "Most kills in a minute")
        self.assertEqual(minute["ranking"][0]["moments"],
                         [{"start": 5400, "end": 11899}])

    def test_replay_moments_preserve_death_and_team_kill_boundaries(self):
        events = [
            (100, "Ann", "Bob", False), (200, "Bob", "Ann", False),
            (300, "Cy", "ANN", True), (400, "Ann", "Ann", True),
            (500, "ANN", "Cy", True), (600, "Bob", "Ann", False),
            (700, "Ann", "Bob", False), (800, "Bob", "Ann", False),
        ]
        kills = [{"t": t + 10000, "killer": killer, "killed": killed,
                  "teamKill": team_kill}
                 for t, killer, killed, team_kill in events]
        hs = {h["label"]: h for h in
              ex.replay_highlights(list(reversed(kills)), [
                  {"player_name": "Ann"}, {"player_name": "Nobody"}])}
        expected = {
            "Most kills in a minute": ("3", 9600, 10700),
            "Most deaths in a minute": ("5", 9700, 10800),
            "Most enemy kills before dying": ("1", 9600, 10100),
            "Most deaths before a kill": ("4", 9700, 10600),
            "Most kills in a minute without dying": ("1", 9600, 10100),
            "Most deaths in a minute without killing": ("3", 9700, 10400),
        }
        for label, (value, start, end) in expected.items():
            row, zero = hs[label]["ranking"]
            self.assertEqual(row["value"], value, label)
            self.assertEqual(row["moments"], [{"start": start, "end": end}], label)
            self.assertNotIn("moments", zero)
        early = ex.replay_highlights([
            {"t": 0, "killer": "Ann", "killed": "Bob", "teamKill": False}],
            [{"player_name": "Ann"}])
        self.assertEqual(early[0]["ranking"][0]["moments"],
                         [{"start": 0, "end": 0}])

    def test_streak_end_moments_include_each_enemy_ending_not_team_kills(self):
        kills = []
        for start, killer, killed, team_kill in [
                (0, "ANN", "Bob", False), (2000, "Ann", "BOB", True),
                (4000, "Bob", "Bob", True), (6000, "ann", "Bob", False)]:
            kills.extend({"t": start + i * 100, "killer": "Bob",
                          "killed": "Victim", "teamKill": False}
                         for i in range(10))
            kills.append({"t": start + 1000, "killer": killer,
                          "killed": killed, "teamKill": team_kill})
        self.assertEqual(ex.streak_end_moments(list(reversed(kills))), {"ann": [
            {"start": 500, "end": 1000, "label": "Ended Bob's 10-kill streak"},
            {"start": 6500, "end": 7000, "label": "Ended Bob's 10-kill streak"},
        ]})

    def test_play_time_leaves_out_holds_and_gaps(self):
        m = self.pub.match(length=1000.0, held_seconds=100.0,
                           dead_seconds=50.0)
        self.pub.player(m, "Ann", 0, True)
        self.run_export()
        doc = self.load("m/pub/0.json")[str(m)]
        self.assertEqual(doc["match"]["played_seconds"], 850.0)

    def test_a_neobot_game_keeps_its_screen(self):
        self.pub.neobot_game(250)
        self.pub.neobot_player(250, "Ann", 0, True, kills=3)
        self.pub.neobot_career("Ann", matches=1, wins=1, kills=3)
        self.run_export()
        game = self.load("m/neobot/2.json")["250"]
        self.assertEqual(rows(game["lines"])[0]["player_name"], "Ann")
        self.assertEqual(self.load("meta.json")["neobot"]["first_id"], 250)


class TestRecords(ExportCase):
    def recs(self, section="pub"):
        return self.load("records/%s.json" % section)

    def test_a_tie_goes_to_whoever_set_it_first_and_bots_leave_people_lists(self):
        self.pub.add("bd_player_flags", arena="*", player="Marv1", flag="bot",
                     set_by="Op")
        for kills in (9, 12, 12):
            m = self.pub.match()
            self.pub.player(m, "Ann", 0, True, kills=kills)
        m = self.pub.match()
        self.pub.player(m, "Marv1", 1, False, kills=40)
        self.pub.player(m, "Bo", 0, True)          # a person: the match counts
        self.run_export()
        kills = self.recs()["kills"]
        self.assertEqual([(e["value"], e["match"]) for e in kills["all"]],
                         [(40, 4), (12, 2), (12, 3), (9, 1)])
        self.assertEqual([e["value"] for e in kills["people"]], [12, 12, 9])

    def test_only_a_match_somebody_won_and_not_a_marathon_holds_a_record(self):
        # The 0-0 game left running: no winner, no record.
        m = self.pub.match(score=(0, 0), winner=None, outcome="aborted", length=900)
        self.pub.player(m, "Ann", 0, False, kills=500)
        self.pub.round(m, 1, None, ended_by="abort", duration_s=880.0)
        # A won match of over two hours of play: its totals hold none.
        m = self.pub.match(length=3 * 3600)
        self.pub.player(m, "Bo", 0, True, kills=400)
        self.pub.neobot_game(300, seconds=4 * 3600)
        self.pub.neobot_player(300, "Old", 0, True, kills=300)
        self.pub.neobot_career("Old", matches=1, wins=1, kills=300)
        m = self.pub.match(length=600)
        self.pub.player(m, "Cy", 0, True, kills=20)
        self.run_export()
        r = self.recs()
        self.assertEqual([e["value"] for e in r["kills"]["all"]], [20])
        # Match records want a winner, but no cap on length.
        self.assertEqual([e["match"] for e in r["longest_match"]], [2, 3])
        self.assertEqual(r["longest_round"], [])

    def test_a_match_of_bots_alone_holds_no_record(self):
        self.pub.add("bd_player_flags", arena="*", player="Marv1", flag="bot", set_by="Op")
        self.pub.add("bd_player_flags", arena="*", player="Marv2", flag="bot", set_by="Op")
        m = self.pub.match(length=5000)                      # bots alone
        self.pub.player(m, "Marv1", 0, True, kills=90)
        self.pub.player(m, "Marv2", 1, False, kills=80)
        self.pub.round(m, 1, 1, score_a=0, score_b=3, duration_s=900.0)
        self.pub.round(m, 2, 0, score_a=5, score_b=3, duration_s=900.0)
        m2 = self.pub.match(winner=1)                        # a person there
        self.pub.player(m2, "Marv1", 0, False, kills=7)
        self.pub.player(m2, "Ann", 1, True, kills=5)
        m3 = self.pub.match()                                # bots alone again
        self.pub.player(m3, "Marv1", 0, True, kills=3)
        self.pub.player(m3, "Marv2", 1, False)
        m4 = self.pub.match()
        self.pub.player(m4, "Marv1", 0, True, kills=1)
        self.pub.player(m4, "Ann", 1, False)
        self.run_export()
        r = self.recs()
        self.assertEqual([(e["value"], e["match"]) for e in r["kills"]["all"]],
                         [(7, m2), (5, m2), (1, m4)])
        self.assertEqual([e["match"] for e in r["longest_match"]], [m2, m4])
        self.assertEqual(r["comeback"], [])
        # Marv1 lost m2 and won m4: m3, bots alone, is as if never played.
        runs = {e["key"]: (e["value"], e["from"]) for e in r["winning_run"]["all"]}
        self.assertEqual(runs[player_key("Marv1")], (1, m4))

    def test_what_the_earlier_matches_never_kept_comes_from_recent_ones(self):
        self.pub.neobot_game(300)
        self.pub.neobot_player(300, "Old", 0, True, kills=99)
        self.pub.neobot_career("Old", matches=1, wins=1, kills=99)
        m = self.pub.match()
        self.pub.player(m, "Ann", 0, True, kills=5, best_streak=4)
        self.run_export()
        r = self.recs()
        self.assertEqual([(e["value"], e["earlier"]) for e in r["kills"]["all"]],
                         [(99, True), (5, False)])
        self.assertEqual([e["key"] for e in r["best_streak"]["all"]],
                         [player_key("Ann")])
        self.assertEqual(r["safe_touches"]["all"], [])

    def test_a_no_result_neither_adds_to_a_winning_run_nor_ends_it(self):
        # As on the real database, the bot's matches are numbered after the
        # earlier games: play order is number order.
        self.pub.neobot_game(1, winner=0)
        self.pub.neobot_player(1, "Ann", 0, True)
        self.pub.neobot_career("Ann", matches=1, wins=1)
        for mid, winner, won, extra in ((11, 0, True, {"no_result": 1}),
                                        (12, None, False, {}),
                                        (13, 0, True, {}),
                                        (14, 1, False, {}),
                                        (15, 0, True, {})):
            m = self.pub.match(id=mid, winner=winner,
                               outcome="abandoned" if winner is None else "completed")
            self.pub.player(m, "Ann", 0, won, **extra)
        self.run_export()
        run = self.recs()["winning_run"]["all"]
        self.assertEqual([(e["value"], e["from"], e["to"]) for e in run],
                         [(2, 1, 13)])

    def test_a_comeback_is_the_furthest_the_winner_trailed(self):
        m = self.pub.match(score=(5, 3), winner=0)
        self.pub.player(m, "Ann", 0, True)
        for seq, (a, b) in enumerate([(0, 1), (0, 2), (1, 3), (2, 3), (5, 3)], 1):
            self.pub.round(m, seq, 0 if a > (b if seq == 1 else 0) else 1,
                           score_a=a, score_b=b)
        self.pub.round(m, 6, None, counted=0, ended_by="nextbase",
                       score_a=0, score_b=9)
        # An official's score is not play: this match is no comeback.
        m2 = self.pub.match(score=(5, 4), winner=0)
        self.pub.player(m2, "Ann", 0, True)
        self.pub.round(m2, 1, None, ended_by="setscore", score_a=0, score_b=4)
        self.pub.round(m2, 2, 0, score_a=5, score_b=4)
        self.run_export()
        c = self.recs()["comeback"]
        self.assertEqual([(e["value"], e["match"], e["low"], e["final"]) for e in c],
                         [(2, m, [1, 3], [5, 3])])
        self.assertEqual(c[0]["winner"], "Freq 0")

    def test_the_league_keeps_its_own_records_with_team_names(self):
        m = self.league.match(mode="match", team_a="Aliens", team_b="Bigfoot",
                              score=(3, 5), winner=1)
        self.league.player(m, "Ann", 0, False, kills=7)
        self.league.player(m, "Bo", 1, True, kills=3)
        self.pub.player(self.pub.match(), "Cy", 0, True, kills=50)
        self.run_export()
        self.assertEqual([e["value"] for e in self.recs("league")["kills"]["all"]], [7, 3])
        self.assertEqual(self.recs("league")["longest_match"][0]["winner"], "Bigfoot")


class TestMates(ExportCase):
    def test_teammates_and_rivals_by_button_people_only(self):
        self.pub.add("bd_player_flags", arena="*", player="Marv1", flag="bot", set_by="Op")
        k = player_key
        m = self.pub.match(winner=0)                     # Ann + Bo beat Cy (+ a bot)
        for name, freq, won in (("Ann", 0, True), ("Bo", 0, True), ("Cy", 1, False), ("Marv1", 1, False)):
            self.pub.player(m, name, freq, won)
        m = self.pub.match(mode="private", winner=200)   # Ann with Cy, lost to Bo
        for name, freq, won in (("Ann", 100, False), ("Cy", 100, False), ("Bo", 200, True)):
            self.pub.player(m, name, freq, won)
        m = self.pub.match(winner=None, outcome="aborted")   # nobody won: not counted
        self.pub.player(m, "Ann", 0, False)
        self.pub.player(m, "Bo", 0, False)
        self.pub.neobot_game(300, winner=1)              # earlier: Ann lost with Bo
        self.pub.neobot_player(300, "Ann", 0, False)
        self.pub.neobot_player(300, "Bo", 0, False)
        self.pub.neobot_career("Ann", matches=1)
        self.pub.neobot_career("Bo", matches=1)
        self.run_export()
        got = self.player("Ann")["pub"]["mates"]
        self.assertEqual(got["all"]["with"], [[k("Bo"), 2, 1, 1], [k("Cy"), 1, 0, 1]])
        self.assertEqual(got["all"]["against"], [[k("Bo"), 1, 0, 1], [k("Cy"), 1, 1, 0]])
        self.assertEqual(got["pub_all"]["with"], [[k("Bo"), 2, 1, 1]])
        self.assertEqual(got["private"], {"with": [[k("Cy"), 1, 0, 1]],
                                          "against": [[k("Bo"), 1, 0, 1]]})
        self.assertNotIn("hard", got)


class TestRoundFacts(ExportCase):
    def test_rounds_by_base_with_the_side_that_won_and_no_bots_alone(self):
        self.pub.add("bd_player_flags", arena="*", player="Marv1", flag="bot", set_by="Op")
        m = self.pub.match(mode="private", score=(1, 1), winner=None, outcome="aborted")
        self.pub.player(m, "Ann", 100, False)
        self.pub.round(m, 1, 200, base_num=7, ended_by="wipe", duration_s=90.0)
        self.pub.round(m, 2, None, counted=0, base_num=4, ended_by="nextbase")
        self.pub.round(m, 3, 100, base_num=4, ended_by="touch")
        m2 = self.pub.match()                          # bots alone: left out
        self.pub.player(m2, "Marv1", 0, True)
        self.pub.round(m2, 1, 0, base_num=7)
        self.run_export()
        got = rows(self.load("rounds/pub.json"))
        self.assertEqual([(r["match"], r["base"], r["side"], r["ended_by"], r["counted"]) for r in got],
                         [(m, 7, "b", "wipe", 1), (m, 4, None, "nextbase", 0), (m, 4, "a", "touch", 1)])


class TestInsights(ExportCase):
    def test_sides_people_and_bots_from_matches_a_person_played(self):
        self.pub.add("bd_player_flags", arena="*", player="Marv1", flag="bot", set_by="Op")
        self.pub.add("bd_player_flags", arena="*", player="Marv2", flag="bot", set_by="Op")
        # Earlier: Ann alone on freq 0 against a bot, won by freq 0 (gap +1,
        # people beat a team of bots); a game of bots alone, left out.
        self.pub.neobot_game(300, winner=0)
        self.pub.neobot_player(300, "Ann", 0, True, kills=6, deaths=2, active_time=600.0)
        self.pub.neobot_player(300, "Marv1", 1, False, kills=2, deaths=6, active_time=600.0)
        self.pub.neobot_game(1400, winner=1)
        self.pub.neobot_player(1400, "Marv1", 0, False)
        self.pub.neobot_player(1400, "Marv2", 1, True)
        # Today: a person each side, freq 1 wins (gap 0); a hard-mode match
        # on freq 0 lost 1-5; a private match won by 100.
        m = self.pub.match(winner=1, score=(2, 5))
        self.pub.player(m, "Ann", 0, False)
        self.pub.player(m, "Bob", 1, True)
        h = self.pub.match(winner=1, score=(1, 5), game_mode="hard", game_mode_freq=0)
        self.pub.player(h, "Ann", 0, False)
        self.pub.player(h, "Marv1", 0, False)
        self.pub.player(h, "Marv2", 1, True)
        p = self.pub.match(mode="private", winner=100, score=(5, 0))
        self.pub.player(p, "Ann", 100, True)
        self.pub.player(p, "Bob", 200, False)
        self.run_export()
        got = self.load("insights.json")
        self.assertEqual(got["sides"], {"earlier": [1, 1], "pub": [2, 0], "private": [1, 1],
                                        "league": [0, 0]})
        self.assertEqual(got["eras"], [[300, 300, 1, 1], [m, h, 2, 0]])
        self.assertEqual(dict((g, (n, w)) for g, n, w in got["gap"]["earlier"] if n), {1: (1, 1)})
        self.assertEqual(dict((g, (n, w)) for g, n, w in got["gap"]["pub"] if n), {0: (1, 0), 1: (1, 0)})
        self.assertEqual(got["more"], {"earlier": [1, 1, 0], "pub": [2, 1, 0]})
        self.assertEqual(got["vs_bots"], {"earlier": [1, 1], "pub": [1, 0]})
        self.assertEqual(got["play"]["earlier"], {"people": [6, 2, 600.0], "bots": [2, 6, 600.0]})
        self.assertEqual({k: got["hard"][k] for k in ("matches", "decided", "team_won", "team_points", "other_points")},
                         {"matches": 1, "decided": 1, "team_won": 0, "team_points": 1, "other_points": 5})


class TestRatings(ExportCase):
    def test_people_only_decided_matches_own_result_earlier_games_first(self):
        self.pub.add("bd_player_flags", arena="*", player="Marv1", flag="bot", set_by="Op")
        self.pub.neobot_game(300, winner=0)
        self.pub.neobot_player(300, "Ann", 0, True)
        self.pub.neobot_player(300, "Bob", 1, False)
        self.pub.neobot_career("Ann", matches=1, wins=1)
        self.pub.neobot_career("Bob", matches=1)
        m1 = self.pub.match(winner=0)
        self.pub.player(m1, "Ann", 0, True)
        self.pub.player(m1, "Bob", 1, False)
        self.pub.player(m1, "Marv1", 1, False)               # a bot: never rated
        self.pub.player(m1, "Cy", 1, False, no_result=1)     # no result: never moves
        m2 = self.pub.match(winner=None, score=(1, 1), outcome="aborted")
        self.pub.player(m2, "Ann", 0, False)                 # nobody won: no change
        self.pub.player(m2, "Bob", 1, False)
        m3 = self.pub.match(winner=0)
        self.pub.player(m3, "Ann", 0, False)                 # left a team that won: a loss
        self.pub.player(m3, "Dee", 0, True)
        self.pub.player(m3, "Bob", 1, False)
        self.run_export()
        board = {r["key"]: r for r in rows(self.load("ratings/pub.json"))}
        keys = {n: player_key(n) for n in ("Ann", "Bob", "Cy", "Dee", "Marv1")}
        self.assertEqual(set(board), {keys["Ann"], keys["Bob"], keys["Dee"]})
        ann = self.player("Ann")["pub"]["rating"]
        self.assertEqual([h[0] for h in ann["history"]], [300, m1, m3])
        self.assertEqual((ann["matches"], ann["wins"]), (3, 2))
        after_wins, after_leaving = ann["history"][1][1], ann["history"][2][1]
        self.assertGreater(after_wins, ex.ratings.START)
        self.assertLess(after_leaving, after_wins)
        self.assertLess(self.player("Bob")["pub"]["rating"]["rating"], ex.ratings.START)
        self.assertIsNone(self.player("Cy")["pub"]["rating"])
        self.assertIsNone(self.player("Marv1")["pub"]["rating"])
        listed = rows(self.load("ratings/pub.json"))
        values = [r["rating"] for r in listed]
        self.assertEqual(values, sorted(values, reverse=True))
        order = [r["key"] for r in listed]
        for n in ("Ann", "Bob", "Dee"):
            r = self.player(n)["pub"]["rating"]
            self.assertEqual((r["rank"], r["of"]), (order.index(keys[n]) + 1, 3))


class TestWriter(ExportCase):
    def test_a_second_run_changes_nothing_and_keeps_the_build_time(self):
        m = self.pub.match()
        self.pub.player(m, "Ann", 0, True)
        first = self.run_export(now=1000)
        second = self.run_export(now=2000)
        self.assertGreater(first["changed"], 0)
        self.assertEqual(second["changed"], 0)
        self.assertEqual(self.load("meta.json")["built"], 1000)
        self.pub.player(m, "Bob", 1, False)
        self.run_export(now=3000)
        self.assertEqual(self.load("meta.json")["built"], 3000)

    def test_a_file_nothing_produced_is_removed(self):
        m = self.pub.match()
        self.pub.player(m, "Ann", 0, True)
        self.run_export()
        stray = os.path.join(self.out, "p", "0000000000.json")
        with open(stray, "w") as f:
            f.write("{}")
        got = self.run_export()
        self.assertEqual(got["removed"], 1)
        self.assertFalse(os.path.exists(stray))

    def test_files_past_the_limits_stop_the_export(self):
        w = ex.Writer(self.out)
        old = ex.MAX_FILE_BYTES
        ex.MAX_FILE_BYTES = 10
        try:
            with self.assertRaises(ex.ExportError):
                w.json("big.json", {"x": "y" * 20})
        finally:
            ex.MAX_FILE_BYTES = old
        old = ex.MAX_FILES
        ex.MAX_FILES = 1
        try:
            w.json("a.json", 1)
            w.json("b.json", 2)
            with self.assertRaises(ex.ExportError):
                w.finish()
        finally:
            ex.MAX_FILES = old


class TestLastMatch(ExportCase):
    def test_the_last_match_and_the_count_read_only(self):
        # tools/refresh.sh's question for a league-triggered run: was a
        # match added? Asked of the live database, so it must change nothing.
        from exporter.__main__ import last_match
        self.assertEqual(last_match(self.league.path), "0 0")
        self.league.match()
        b = self.league.match()
        before = os.stat(self.league.path)
        self.assertEqual(last_match(self.league.path), "%d 2" % b)
        after = os.stat(self.league.path)
        self.assertEqual((before.st_size, before.st_mtime_ns),
                         (after.st_size, after.st_mtime_ns))


class TestRules(unittest.TestCase):
    def test_names_fold_as_sqlite_does(self):
        self.assertEqual(fold("GoLdEn Knight"), "golden knight")
        self.assertEqual(fold("ÉLAN"), "Élan")
        self.assertEqual(player_key("Ann"), player_key("ANN"))

    def test_glob_is_sqlite_glob(self):
        self.assertTrue(glob_match("zero-eg-*", "Zero-EG-12"))
        self.assertFalse(glob_match("zero-eg-?", "Zero-EG-12"))
        self.assertTrue(glob_match("marv[^x]", "Marv1"))
        self.assertFalse(glob_match("marv[^x]", "Marvx"))

    def test_rating_and_result(self):
        self.assertEqual(rating(10, 2, 3), 2.0)
        self.assertEqual(rating(0, None, 0), 0.0)
        self.assertEqual(result(None, 1, 0), "-")
        self.assertEqual(result(0, 1, 1), "N")
        self.assertEqual(result(0, 1, 0), "W")
        self.assertEqual(result(0, 0, 0), "L")


class TestSnapshot(unittest.TestCase):
    def test_a_snapshot_is_one_checked_file(self):
        tmp = tempfile.mkdtemp()
        try:
            src = FixtureDB(os.path.join(tmp, "src.db"), "pub")
            src.conn.execute("PRAGMA journal_mode=WAL")
            src.match()
            dst = snapshot(src.path, os.path.join(tmp, "copy.db"))
            src.close()
            self.assertFalse(os.path.exists(dst + "-wal"))
            conn = open_snapshot(dst)
            self.assertEqual(conn.execute(
                "SELECT COUNT(*) FROM bd_matches").fetchone()[0], 1)
            conn.close()
        finally:
            shutil.rmtree(tmp)


if __name__ == "__main__":
    unittest.main()
