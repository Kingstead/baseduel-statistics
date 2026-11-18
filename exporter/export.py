"""
Snapshots in, the site's data out: JSON files under one folder.

Two sections, never added together (the user, 2026-11-05):
  pub     pubduel.db: the pub bot's matches, and Neobot's games beside them
  league  baseduel.db: the league bot's matches

A file is rewritten only when its bytes change, so a deploy uploads only what
a new match touched, and a file nothing produced any more is removed.

What is never exported: bd_settings, bd_arena_bases, and every list in
bd_player_flags but the bot list (the allow, follow and notify lists).
"""
import itertools
import json
import os
import sys
import time

from exporter import insights, mates, ratings, readers, records
from exporter.rules import (
    CAREER_KEYS, LEAGUE_SCOPES, NEOBOT_UNTRACKED_STATS, PUB_SCOPES, TOP_STATS,
    fold, freqs_of, glob_match, match_seconds, player_key, result,
)

EXPORT_VERSION = 1

# Matches per data file: the pub bot's and the league's carry rounds and
# round players (about 2 KB a match gzipped), Neobot's only their screen.
OWN_BUCKET = 10
NEOBOT_BUCKET = 100

# Cloudflare Pages' free plan: 20,000 files and 25 MiB a file. The export
# stops well short, so a deploy can never fail on them unseen.
MAX_FILES = 15000
MAX_FILE_BYTES = 20 * 2 ** 20

# Matches the home page lists for each section.
RECENT = 12

# The pub section's extra career: earlier and recent pub matches together.
PUB_COMBINED = "pub_all"


class ExportError(Exception):
    pass


class Writer:
    """Writes JSON under `root`, only when a file's bytes change, and removes
    the .json files a run did not produce."""

    def __init__(self, root):
        self.root = root
        self.written = set()
        self.changed = 0
        self.bytes = 0

    def json(self, rel, obj):
        data = json.dumps(obj, separators=(",", ":"), ensure_ascii=False,
                          allow_nan=False).encode("utf-8")
        if len(data) > MAX_FILE_BYTES:
            raise ExportError("%s is %d bytes, over the %d limit"
                              % (rel, len(data), MAX_FILE_BYTES))
        if rel in self.written:
            raise ExportError("%s written twice" % rel)
        self.written.add(rel)
        self.bytes += len(data)
        path = os.path.join(self.root, rel)
        try:
            with open(path, "rb") as f:
                if f.read() == data:
                    return
        except FileNotFoundError:
            pass
        os.makedirs(os.path.dirname(path), exist_ok=True)
        tmp = path + ".tmp"
        with open(tmp, "wb") as f:
            f.write(data)
        os.replace(tmp, path)
        self.changed += 1

    def stale(self, keep=()):
        """The .json files under root this run has not written."""
        out = []
        for folder, _dirs, files in os.walk(self.root):
            for name in files:
                rel = os.path.relpath(os.path.join(folder, name), self.root)
                if (name.endswith(".json") and rel not in self.written
                        and rel not in keep):
                    out.append(rel)
        return out

    def finish(self):
        if len(self.written) > MAX_FILES:
            raise ExportError("%d files, over the %d limit"
                              % (len(self.written), MAX_FILES))
        stale = self.stale()
        for rel in stale:
            os.remove(os.path.join(self.root, rel))
        return len(stale)


def table(dict_rows, cols):
    """Rows as {"cols": [...], "rows": [[...]]}: the keys once, not per row."""
    return {"cols": list(cols), "rows": [[r.get(c) for c in cols]
                                         for r in dict_rows]}


def by_match(rows):
    out = {}
    for r in rows:
        out.setdefault(r["match_id"], []).append(r)
    return out


# Columns of a bd_match_players row on a match page, and in a player's history.
MATCH_PLAYER_COLS = (
    "player_name", "team", "freq", "is_captain", "is_winner", "no_result",
    "exit_kind", "safe_touches", "kills", "deaths", "teamkills",
    "best_streak", "streaks", "streak_ends", "dmg_given", "dmg_taken",
    "attaches", "attached_to", "reps", "bursts", "max_bounty", "active_time",
)
ROUND_COLS = ("seq", "round_no", "attempt", "counted", "base_num",
              "winner_freq", "ended_by", "scorer_name", "score_a", "score_b",
              "started_at", "ended_at", "duration_s")
ROUND_PLAYER_COLS = (
    "seq", "player_name", "team", "freq", "is_winner", "safe_touches",
    "kills", "deaths", "teamkills", "streaks", "streak_ends", "dmg_given",
    "dmg_taken", "attaches", "attached_to", "reps", "bursts", "active_time",
)
MATCH_COLS = (
    "id", "mode", "game_mode", "game_mode_freq", "game_mode_until",
    "game_mode_end", "arena", "team_a", "team_b", "target", "winby",
    "team_size", "time_limit", "score_a", "score_b", "winner_freq",
    "outcome", "started_at", "ended_at", "held_seconds", "dead_seconds",
)
NEOBOT_MATCH_COLS = ("neobot_id", "history_id", "score_a", "score_b",
                     "winner_freq", "outcome", "active_seconds",
                     "partial_stats")
NEOBOT_PLAYER_COLS = (
    "player_name", "freq", "is_winner", "no_result", "exit_kind", "kills",
    "deaths", "teamkills", "team_deaths", "dmg_given", "dmg_taken",
    "attached_to", "reps", "bursts", "greens", "active_time", "freqs_played",
)
NEOBOT_LINE_COLS = (
    "line_no", "player_name", "freq", "left_early", "kills", "deaths",
    "teamkills", "team_deaths", "dmg_given", "dmg_taken", "attached_to",
    "reps", "bursts", "greens", "active_time",
)
# A player's history: one row a match, enough to list it and link to it.
HISTORY_COLS = (
    "id", "started_at", "mode", "game_mode", "arena", "freq", "team",
    "result", "score_for", "score_against", "is_captain", "exit_kind",
    "safe_touches", "kills", "deaths", "teamkills", "best_streak",
    "dmg_given", "dmg_taken", "attaches", "attached_to", "reps", "bursts",
    "active_time",
)
NEOBOT_HISTORY_COLS = (
    "id", "freq", "result", "score_for", "score_against", "exit_kind",
    "kills", "deaths", "teamkills", "dmg_given", "dmg_taken", "attached_to",
    "reps", "bursts", "greens", "active_time", "freqs_played",
)
CAREER_COLS = CAREER_KEYS + ("player_name", "last_team", "last_match_id",
                             "neobot_matches")


def control_doc(match_id, doc, rounds, players=()):
    """A league match's base control, from web/tools/control.mjs's file for
    its replay: per round (by seq, never round_no), freq 0's Held percent as
    the replay's dashboard shows it and its share once a second. Only rounds
    of this match in bd_rounds, plus optional cloak-run highlights; None
    when the match has no joined rounds."""
    if not doc:
        return None
    seqs = {r["seq"] for r in rounds}
    out = []
    for r in doc.get("rounds", ()):
        if r.get("seq") not in seqs:
            print("control: match %s: replay round %s.%s has no bd_rounds row "
                  "(seq %s), left out" % (match_id, r.get("round"),
                                          r.get("attempt"), r.get("seq")),
                  file=sys.stderr)
            continue
        out.append({"seq": r["seq"], "held": r["pct"],
                    "shares": r["shares"]})
    result = {"rounds": out} if out else None
    if result is not None:
        highlights = [highlight for highlight in (
            cloak_highlight(doc, seqs, players),
            cloak_totals_highlight(doc, seqs, players),
        ) if highlight]
        if highlights:
            result["highlights"] = highlights
    return result


def cloak_highlight(doc, seqs, players):
    """Replay-only corridor progress; only rounds joined to this match."""
    tracked = {fold(name) for name in doc.get("cloakPlayers", ())}
    best = {}
    for run in doc.get("cloak", ()):
        if run["seq"] not in seqs:
            continue
        name = fold(run["name"])
        if name not in best or run["tiles"] > best[name]["tiles"]:
            best[name] = run
    scores = []
    for p in players:
        name = p["player_name"]
        run = best.get(fold(name))
        value = run["tiles"] if run else 0 if fold(name) in tracked else None
        scores.append((name, value, run))
    scores.sort(key=lambda row: (row[1] is None, -(row[1] or 0), fold(row[0])))
    peak = max((value or 0 for _name, value, _run in scores), default=0)
    if peak <= 0:
        return None
    leaders = sorted((name for name, value, _run in scores if value == peak),
                     key=fold)
    ranking = []
    for name, value, run in scores:
        row = {"name": name, "value": "%s tiles" % value
               if value is not None else None}
        if run:
            row["run"] = {key: run[key] for key in ("start", "end", "seconds")}
        ranking.append(row)
    return {
        "group": "Movement", "label": "Longest cloaked advance",
        "value": "%s tiles" % peak,
        "names": leaders[:3], "more": max(0, len(leaders) - 3),
        "ranking": ranking,
        "description": (
            "Net progress toward the enemy safe through the base corridors, "
            "in map tiles (16 pixels), starting 10 seconds after each round "
            "begins. Earlier movement and cloaked time do not count. "
            "Visible forward movement does not count; "
            "backtracking undoes progress. Shooting reveals of up to 2 seconds "
            "can join a run. Death, ship/team changes, warps/attaches, leaving "
            "the base, missing position data and round boundaries reset it. "
            "A packet-derived estimate, not a bot stat."),
    }


def cloak_totals_highlight(doc, seqs, players):
    """Total observed cloak time and each separate run's best advance."""
    if "cloakTotals" not in doc:
        return None
    tracked = {fold(name) for name in doc.get("cloakPlayers", ())}
    totals = {name: {"tiles": 0, "ticks": 0} for name in tracked}
    for row in doc["cloakTotals"]:
        name = fold(row["name"])
        if row["seq"] not in seqs or name not in totals:
            continue
        totals[name]["tiles"] += row["tiles"]
        totals[name]["ticks"] += round(row["seconds"] * 100)
    scores = [(p["player_name"], totals.get(fold(p["player_name"])))
              for p in players]
    scores.sort(key=lambda row: (row[1] is None,
                                -row[1]["tiles"] if row[1] else 0,
                                fold(row[0])))
    peak = max((value["tiles"] for _name, value in scores if value),
               default=0)
    if peak <= 0:
        return None
    leaders = sorted((name for name, value in scores
                      if value and value["tiles"] == peak), key=fold)
    ranking = []
    for name, total in scores:
        value = None
        if total is not None:
            seconds = total["ticks"] // 100
            value = "%s tiles / %d:%02d cloaked" % (
                total["tiles"], seconds // 60, seconds % 60)
        ranking.append({"name": name, "value": value})
    return {
        "group": "Movement", "label": "Total cloaked time & progress",
        "value": "%s tiles" % peak,
        "names": leaders[:3], "more": max(0, len(leaders) - 3),
        "ranking": ranking,
        "description": (
            "Ranked by total progress toward the enemy safe, summing each "
            "separate cloak run's best net advance through the base corridors. "
            "Backtracking and returning within a run does not earn progress "
            "again. Time includes all observed cloaked time in the base, even "
            "while stationary or retreating, not just the best runs. Visible "
            "shooting gaps add no time or forward progress. Each round's "
            "first 10 seconds, unmatched rounds and position discontinuities "
            "are excluded. One tile is 16 pixels; time is minutes:seconds. "
            "A packet-derived estimate, not a bot stat."),
    }


def chat_doc(doc, rounds):
    """A league match's chat, from web/tools/chat.mjs's file for its replay:
    every line as the recording kept it, [t, name, spec, text], t in ticks
    from the recording's start, and the replay's rounds on the same clock to
    place them in. A round with no bd_rounds row (match 117's recording began
    inside R1) keeps its heading with seq None, so nothing is said of how it
    ended. None when the replay holds no chat."""
    if not doc or not doc.get("lines"):
        return None
    seqs = {r["seq"] for r in rounds}
    return {"end": doc.get("end"),
            "rounds": [{"seq": r["seq"] if r.get("seq") in seqs else None,
                        "round": r["round"], "attempt": r["attempt"],
                        "base": r["base"], "start": r["start"],
                        "end": r["end"]} for r in doc.get("rounds", ())],
            "lines": doc["lines"]}


def _rolling_minute_peak(ticks):
    left = best = 0
    moment = None
    for right, tick in enumerate(ticks):
        while tick - ticks[left] >= 6000:
            left += 1
        if right - left + 1 > best:
            best = right - left + 1
            moment = (ticks[left], tick)
    return best, moment


def _replay_peaks(kills, name):
    """The match page's replay highlights, from one player's kill events."""
    me = fold(name)
    ordered = sorted(kills, key=lambda k: k["t"])
    kills_at, deaths_at, live_kills, kill_free_deaths = [], [], [], []
    kills_without_dying = deaths_without_killing = 0
    deaths = deaths_before_kill = 0
    moments = {}
    enemy_run = []
    longest = 0

    def peak(key, ticks, best):
        value, moment = _rolling_minute_peak(ticks)
        if value > best:
            moments[key] = moment
        return max(best, value)

    for k in ordered:
        killer, killed = fold(k["killer"]), fold(k["killed"])
        if killer == me and killed != me:
            kills_at.append(k["t"])
            live_kills.append(k["t"])
            deaths_without_killing = peak(
                "deathsMinuteWithoutKilling", kill_free_deaths,
                deaths_without_killing)
            kill_free_deaths = []
            if not k["teamKill"]:
                deaths = 0
                enemy_run.append(k["t"])
                if len(enemy_run) > longest:
                    longest = len(enemy_run)
                    moments["killsBeforeDying"] = (enemy_run[0], k["t"])
        if killed == me:
            deaths_at.append(k["t"])
            kill_free_deaths.append(k["t"])
            kills_without_dying = peak(
                "killsMinuteWithoutDying", live_kills, kills_without_dying)
            live_kills = []
            enemy_run = []
            deaths += 1
            if deaths == 1:
                death_start = k["t"]
            if deaths > deaths_before_kill:
                deaths_before_kill = deaths
                moments["deathsBeforeKill"] = (death_start, k["t"])

    kills_minute, moments["killsMinute"] = _rolling_minute_peak(kills_at)
    deaths_minute, moments["deathsMinute"] = _rolling_minute_peak(deaths_at)
    values = {
        "killsMinute": kills_minute,
        "deathsMinute": deaths_minute,
        "killsBeforeDying": longest,
        "deathsBeforeKill": deaths_before_kill,
        "killsMinuteWithoutDying": peak(
            "killsMinuteWithoutDying", live_kills, kills_without_dying),
        "deathsMinuteWithoutKilling": peak(
            "deathsMinuteWithoutKilling", kill_free_deaths,
            deaths_without_killing),
    }
    return values, moments


def replay_highlights(kills, players):
    """The same replay-only highlight rows the match page used to derive."""
    categories = (
        ("Kills", "Most kills in a minute", "killsMinute"),
        ("Kills", "Most enemy kills before dying", "killsBeforeDying"),
        ("Deaths", "Most deaths in a minute", "deathsMinute"),
        ("Deaths", "Most deaths before a kill", "deathsBeforeKill"),
        ("Kills", "Most kills in a minute without dying",
         "killsMinuteWithoutDying"),
        ("Deaths", "Most deaths in a minute without killing",
         "deathsMinuteWithoutKilling"),
    )
    peaks = [(p["player_name"], *_replay_peaks(kills, p["player_name"]))
             for p in players]
    out = []
    for group, label, key in categories:
        scores = [(name, values[key], moments.get(key))
                  for name, values, moments in peaks]
        best = max((value for _name, value, _moment in scores), default=0)
        if best <= 0:
            continue
        leaders = sorted((name for name, value, _moment in scores if value == best),
                         key=str.lower)
        ranking = []
        for name, value, moment in sorted(
                scores, key=lambda row: (-row[1], row[0].lower())):
            row = {"name": name, "value": str(value)}
            if moment is not None:
                row["moments"] = [{"start": max(0, moment[0] - 500),
                                   "end": moment[1]}]
            ranking.append(row)
        out.append({
            "group": group, "label": label, "value": str(best),
            "names": leaders[:3], "more": max(0, len(leaders) - 3),
            "description": (
                "Replay-derived counts over the whole recording, including "
                "time between rounds. Minute windows are rolling and exclude "
                "events exactly 60 seconds apart. Team kills count in minute "
                "peaks; enemy-kill streaks exclude them, and any death ends "
                "a streak. Deaths before a kill reset on an enemy kill; "
                "uninterrupted-minute death runs reset on any kill. "
                "Watch the first occurrence of each player's best result, "
                "starting 5 seconds before its first event."),
            "ranking": ranking,
        })
    return out


def streak_end_moments(kills):
    """Every reconstructed enemy streak of 10+ ended, with a 5s lead-in."""
    active, out = {}, {}
    for k in sorted(kills, key=lambda k: k["t"]):
        killer, killed = fold(k["killer"]), fold(k["killed"])
        count = active.pop(killed, 0)
        if killer == killed or k["teamKill"]:
            continue
        if count >= 10:
            out.setdefault(killer, []).append({
                "start": max(0, k["t"] - 500), "end": k["t"],
                "label": "Ended %s's %s-kill streak" % (k["killed"], count),
            })
        active[killer] = active.get(killer, 0) + 1
    return out


def player_kill_breakdown(kills, name):
    """One player's whole-recording kills by enemy, teammate and weapon."""
    me = fold(name)
    buckets = {key: {} for key in ("killed", "killedBy", "teamKilled",
                                    "teamKilledBy")}
    out = {"killed": [], "killedBy": [], "teamKilled": [],
           "teamKilledBy": [], "kills": 0, "deaths": 0,
           "weaponsOut": {}, "weaponsIn": {}}

    def add(bucket, other, freq, weapon):
        key = fold(other)
        item = bucket.get(key)
        if item is None:
            item = {"name": other, "freq": freq, "n": 0, "weapons": {}}
            bucket[key] = item
        item["n"] += 1
        item["weapons"][weapon] = item["weapons"].get(weapon, 0) + 1

    for k in kills:
        gave = fold(k["killer"]) == me
        took = fold(k["killed"]) == me
        if gave == took:
            continue
        if gave:
            if k["teamKill"]:
                add(buckets["teamKilled"], k["killed"], k["killedFreq"],
                    k["weapon"])
            else:
                out["kills"] += 1
                out["weaponsOut"][k["weapon"]] = \
                    out["weaponsOut"].get(k["weapon"], 0) + 1
                add(buckets["killed"], k["killed"], k["killedFreq"],
                    k["weapon"])
        elif k["teamKill"]:
            add(buckets["teamKilledBy"], k["killer"], k["killerFreq"],
                k["weapon"])
        else:
            out["deaths"] += 1
            out["weaponsIn"][k["weapon"]] = \
                out["weaponsIn"].get(k["weapon"], 0) + 1
            add(buckets["killedBy"], k["killer"], k["killerFreq"],
                k["weapon"])

    for key, bucket in buckets.items():
        out[key] = sorted(bucket.values(),
                          key=lambda item: (-item["n"], item["name"].lower()))
    return out


def replay_stats_doc(raw, players):
    """The useful, compact portion of ss-replay's stats for a match page."""
    names = {p["player"]: p["name"] for p in raw["players"]}
    kills = [{
        "t": k["t"],
        "killer": names.get(k["killer"], "?"),
        "killed": names.get(k["killed"], "?"),
        "weapon": k.get("weapon") or "unknown",
        "teamKill": k["teamKill"],
        "killerFreq": k["killerFreq"],
        "killedFreq": k["killedFreq"],
    } for k in raw["killLog"]]
    return {
        "end": raw["source"]["endTick"],
        "players": [{"player": p["player"], "name": p["name"],
                     "shots": p.get("shots", {})} for p in raw["players"]],
        "kills": kills,
        "breakdowns": {fold(p["player_name"]): player_kill_breakdown(
            kills, p["player_name"]) for p in players},
        "highlights": replay_highlights(kills, players),
        "streakEnds": streak_end_moments(kills),
    }


def career(c):
    """A career as the site stores it: None for none, else every key, with
    None for anything not tracked."""
    if c is None:
        return None
    return {k: c.get(k) for k in CAREER_COLS}


class Section:
    """One bot's database, read once."""

    def __init__(self, name, conn, scopes, is_bot, replays=None,
                 replay_site=None, unfinished=True, control=None, chat=None,
                 stats_dir=None):
        self.name = name
        self.scopes = scopes
        self.is_bot = is_bot
        # Whether a match nobody won is shown beyond the matches list and its
        # own page. The league's are not (the user, 2026-11-06): a stopped or
        # abandoned league match is in no history, count or base. The
        # careers, boards, records and ratings of both sections already
        # leave such matches out, as the bots do.
        self.unfinished = unfinished
        self.matches = readers.own_matches(conn)
        self.match_by_id = {m["id"]: m for m in self.matches}
        self.players = readers.own_players(conn)
        self.players_by_match = by_match(self.players)
        self.players_by_lname = {}
        for p in self.players:
            self.players_by_lname.setdefault(fold(p["player_name"]),
                                             []).append(p)
        self.rounds_by_match = by_match(readers.own_rounds(conn))
        self.round_players_by_match = by_match(readers.own_round_players(conn))
        self.careers = {}
        neobot_rows = readers.neobot_career_rows(conn)
        for scope_name, scope in scopes.items():
            if scope.get("neobot"):
                self.careers[scope_name] = {
                    lname: c for lname, c in
                    ((l, readers.neobot_career(r))
                     for l, r in neobot_rows.items()) if c is not None}
            else:
                self.careers[scope_name] = readers.own_careers(conn, scope)
        if "neobot" in scopes:
            own_all, own_pub = self.careers["all"], self.careers["pub"]
            old = self.careers["neobot"]
            self.careers["all"] = {
                lname: readers.merge_all(own_all.get(lname), old.get(lname))
                for lname in set(own_all) | set(old)}
            # Every pub match, earlier and recent, as one career (the user,
            # 2026-11-05: combine them). Not a scope the bot has: its own
            # 'pub' and 'neobot' careers, put together by the very rule its
            # no-scope career uses.
            self.careers[PUB_COMBINED] = {
                lname: readers.merge_all(own_pub.get(lname), old.get(lname))
                for lname in set(own_pub) | set(old)}
        self.neobot_names = {l: r["name"] for l, r in neobot_rows.items()}
        self.neobot_matches = readers.neobot_matches(conn)
        self.neobot_players = readers.neobot_players(conn)
        # The screens' lines are read as they are written (export), not here.
        self.conn = conn
        self.replay = {}
        self.control = {}
        self.chat = {}
        self.stats_dir = stats_dir
        self.stats_replay_id = {}
        if replays is not None:
            for m in self.matches:
                rid = ("%s-%s" % (m.get("arena"), m.get("recording"))
                       if m.get("recording") else None)
                if rid and rid.lower() in replays:
                    replay_id = replays[rid.lower()]
                    self.replay[m["id"]] = "%s/r/%s" % (
                        replay_site.rstrip("/"), replay_id)
                    got = control_doc(m["id"], (control or {}).get(rid.lower()),
                                      self.rounds_by_match.get(m["id"], []),
                                      self.players_by_match.get(m["id"], []))
                    if got:
                        self.control[m["id"]] = got
                    said = chat_doc((chat or {}).get(rid.lower()),
                                    self.rounds_by_match.get(m["id"], []))
                    if said:
                        self.chat[m["id"]] = said
                    if stats_dir:
                        path = os.path.join(stats_dir, replay_id + ".stats.json")
                        if os.path.isfile(path):
                            self.stats_replay_id[m["id"]] = replay_id

    def counts(self, m):
        """Whether a match is in histories, counts and bases."""
        return self.unfinished or m["winner_freq"] is not None

    def last_seen(self):
        """{folded name: (latest ended_at, casing then)}: get_known_players'
        casing, the one of their latest match."""
        out = {}
        for p in self.players:
            m = self.match_by_id[p["match_id"]]
            when = m.get("ended_at") or m.get("started_at") or 0
            lname = fold(p["player_name"])
            if lname not in out or when > out[lname][0]:
                out[lname] = (when, p["player_name"])
        return out

    def history(self, lname):
        """A player's own rows, newest first, as HISTORY_COLS."""
        out = []
        for p in self.players_by_lname.get(lname, ()):
            m = self.match_by_id[p["match_id"]]
            if not self.counts(m):
                continue
            fa, _fb = freqs_of(m["mode"], self.players_by_match[m["id"]])
            mine, theirs = ((m["score_a"], m["score_b"]) if p["freq"] == fa
                            else (m["score_b"], m["score_a"]))
            row = dict(p, id=m["id"], started_at=m.get("started_at"),
                       mode=m["mode"], game_mode=m.get("game_mode"),
                       arena=m.get("arena"),
                       result=result(m["winner_freq"], p["is_winner"],
                                     p["no_result"]),
                       score_for=mine, score_against=theirs)
            out.append(row)
        out.sort(key=lambda r: -r["id"])
        return out

    def match_doc(self, m):
        mid = m["id"]
        doc = {k: m.get(k) for k in MATCH_COLS}
        doc.update(played_seconds=match_seconds(m),
                   rounds_counted=m["rounds_counted"],
                   replay=self.replay.get(mid))
        out = {
            "match": doc,
            "players": table(self.players_by_match.get(mid, []),
                             MATCH_PLAYER_COLS),
            "rounds": table(self.rounds_by_match.get(mid, []), ROUND_COLS),
            "round_players": table(self.round_players_by_match.get(mid, []),
                                   ROUND_PLAYER_COLS),
        }
        if mid in self.control:
            out["control"] = self.control[mid]
        if mid in self.chat:
            out["chat"] = self.chat[mid]
        if mid in self.stats_replay_id:
            path = os.path.join(
                self.stats_dir, self.stats_replay_id[mid] + ".stats.json")
            with open(path, encoding="utf-8") as f:
                out["stats"] = replay_stats_doc(
                    json.load(f), self.players_by_match.get(mid, []))
        return out

    def facts(self, keys):
        """Every match and every player-match row, for the browser to filter
        and count: the matches list now, the leaderboards next."""
        matches = []
        for m in self.matches:
            doc = {k: m.get(k) for k in MATCH_COLS}
            doc.update(played_seconds=match_seconds(m),
                       rounds_counted=m["rounds_counted"],
                       players=m["players"],
                       replay=self.replay.get(m["id"]))
            matches.append(doc)
        players = []
        for p in self.players:
            m = self.match_by_id[p["match_id"]]
            players.append(dict(p, key=keys[fold(p["player_name"])],
                                result=result(m["winner_freq"],
                                              p["is_winner"],
                                              p["no_result"])))
        cols = ("match_id", "key", "freq", "result") + tuple(
            c for c in MATCH_PLAYER_COLS if c not in ("player_name", "team",
                                                      "freq"))
        return {"matches": table(matches, tuple(matches[0]) if matches
                                 else MATCH_COLS),
                "players": table(players, cols)}


# A round on the bases page: where it was played and how it ended. "side"
# is who won it: "a" the lower freq (0, or 100 in a private match), "b" the
# higher, None for no point.
ROUND_FACT_COLS = ("match", "arena", "mode", "base", "counted", "ended_by",
                   "side", "seconds")


def round_facts(section):
    """rounds/<section>.json: every round of every match a person played in
    (records.py's rule: bots alone tell nothing about a base), skipped ones
    too."""
    people, _earlier = records.with_people(section)
    out = []
    for m in section.matches:
        if m["id"] not in people or not section.counts(m):
            continue
        fa, _fb = freqs_of(m["mode"], section.players_by_match.get(m["id"], []))
        for r in section.rounds_by_match.get(m["id"], []):
            w = r["winner_freq"]
            out.append({"match": m["id"], "arena": m.get("arena"),
                        "mode": m["mode"], "base": r["base_num"],
                        "counted": r["counted"], "ended_by": r["ended_by"],
                        "side": None if w is None else "a" if w == fa else "b",
                        "seconds": r["duration_s"]})
    return table(out, ROUND_FACT_COLS)


def neobot_history(games, rows):
    """One player's rows of Neobot's games, newest first, as
    NEOBOT_HISTORY_COLS. Built a player at a time, as their file is written:
    all of them at once were 220 MB."""
    out = []
    for p in rows:
        g = games[p["match_id"]]
        mine, theirs = ((g["score_a"], g["score_b"]) if p["freq"] == 0
                        else (g["score_b"], g["score_a"]))
        out.append(dict(
            p, id=g["neobot_id"],
            result=result(g["winner_freq"], p["is_winner"], p["no_result"]),
            score_for=mine, score_against=theirs))
    out.sort(key=lambda r: -r["id"])
    return out


def export(pub_conn, league_conn, out, league_exclude=(), replays=None,
           replay_site="https://ss-replay.pages.dev", now=None, control=None,
           chat=None, stats_dir=None):
    """Write the whole site's data under `out`. Returns a summary dict."""
    started = time.monotonic()
    pub_bots = readers.bot_names(pub_conn)
    pub = Section("pub", pub_conn, PUB_SCOPES, lambda l: l in pub_bots)
    league = Section("league", league_conn, LEAGUE_SCOPES,
                     lambda l: any(glob_match(p, l) for p in league_exclude),
                     replays=replays, replay_site=replay_site,
                     unfinished=False, control=control, chat=chat,
                     stats_dir=stats_dir)
    w = Writer(out)

    # ---- who is who ---------------------------------------------------------
    pub_seen, league_seen = pub.last_seen(), league.last_seen()
    names = {}
    for lname, name in pub.neobot_names.items():
        names[lname] = (0, name)
    for seen in (league_seen, pub_seen):
        for lname, (when, name) in seen.items():
            if lname not in names or when >= names[lname][0]:
                names[lname] = (when, name)
    keys = {}
    for lname in names:
        key = player_key(lname)
        if key in keys.values():
            raise ExportError("two players share the key %s" % key)
        keys[lname] = key

    # ---- ratings: every decided match replayed in order (ratings.py) -------
    rated = {sec.name: ratings.rate(sec) for sec in (pub, league)}
    rank_of = {name: {l: i + 1 for i, l in enumerate(ratings.ranked(r))}
               for name, r in rated.items()}

    # ---- each player ---------------------------------------------------------
    games = {g["neobot_id"]: g for g in pub.neobot_matches}
    old_rows = {}
    for p in pub.neobot_players:
        old_rows.setdefault(fold(p["player_name"]), []).append(p)
    players_by_game = by_match(pub.neobot_players)
    index = []
    for lname, (when, name) in sorted(names.items()):
        doc = {"key": keys[lname], "name": name}
        pub_careers = {s: career(pub.careers[s].get(lname))
                       for s in tuple(PUB_SCOPES) + (PUB_COMBINED,)}
        own = pub.history(lname)
        old = neobot_history(games, old_rows.get(lname, ()))
        if own or old or any(pub_careers.values()):
            # Each section names a player as its own bot does: the casing of
            # their latest match there, else Neobot's.
            doc["pub"] = {"name": pub_seen[lname][1] if lname in pub_seen
                          else pub.neobot_names.get(lname, name),
                          "bot": pub.is_bot(lname), "careers": pub_careers,
                          "matches": table(own, HISTORY_COLS),
                          "neobot": table(old, NEOBOT_HISTORY_COLS),
                          "mates": mates.mates(pub, lname, keys, old,
                                               players_by_game),
                          "rating": ratings.player(rated["pub"], rank_of["pub"],
                                                   lname)}
        league_careers = {s: career(league.careers[s].get(lname))
                          for s in LEAGUE_SCOPES}
        theirs = league.history(lname)
        # Everyone the league bot knows has a league section, even one who
        # played only in a match nobody won (check_names).
        if theirs or any(league_careers.values()) or lname in league_seen:
            doc["league"] = {"name": league_seen[lname][1]
                             if lname in league_seen else name,
                             "bot": league.is_bot(lname),
                             "careers": league_careers,
                             "matches": table(theirs, HISTORY_COLS),
                             "mates": mates.mates(league, lname, keys),
                             "rating": ratings.player(rated["league"],
                                                      rank_of["league"], lname)}
        w.json("p/%s.json" % keys[lname], doc)
        pc, lc = pub_careers["all"], league_careers["all"]
        index.append({
            "key": keys[lname], "name": name,
            "pub_bot": bool(doc.get("pub", {}).get("bot")),
            "league_bot": bool(doc.get("league", {}).get("bot")),
            "pub_matches": pc["matches"] if pc else 0,
            "pub_played": len(own) + len(old),
            "league_matches": lc["matches"] if lc else 0,
            "league_played": len(theirs),
            "last_seen": when or None,
            # Each section's first match, for the activity page's new
            # players: an earlier game if they played one, as those came
            # first.
            "pub_first": min((r["id"] for r in old or own), default=None),
            "league_first": min((r["id"] for r in theirs), default=None),
        })
    w.json("players.json", table(index, tuple(index[0]) if index else ()))

    # ---- the matches ---------------------------------------------------------
    for section in (pub, league):
        bucket, docs = None, {}
        for m in section.matches:
            current = m["id"] // OWN_BUCKET
            if bucket is not None and current != bucket:
                w.json("m/%s/%d.json" % (section.name, bucket), docs)
                docs = {}
            bucket = current
            docs[str(m["id"])] = section.match_doc(m)
        if docs:
            w.json("m/%s/%d.json" % (section.name, bucket), docs)
        w.json("facts/%s.json" % section.name, section.facts(keys))
        w.json("records/%s.json" % section.name,
               records.section_records(section, keys))
        w.json("rounds/%s.json" % section.name, round_facts(section))
        w.json("ratings/%s.json" % section.name,
               ratings.board(rated[section.name], keys))
    w.json("insights.json", insights.insights(pub, league))

    # Each earlier game's page, a bucket of games at a time, each written as
    # soon as it is whole: the lines come in game order, as the games do.
    lines = itertools.groupby(readers.neobot_lines(pub.conn),
                              key=lambda l: l["match_id"])
    pending = next(lines, None)
    bucket, docs = None, {}
    for g in pub.neobot_matches:
        gid = g["neobot_id"]
        while pending is not None and pending[0] < gid:
            pending = next(lines, None)
        mine = []
        if pending is not None and pending[0] == gid:
            mine = list(pending[1])
            pending = next(lines, None)
        if gid // NEOBOT_BUCKET != bucket:
            if docs:
                w.json("m/neobot/%d.json" % bucket, docs)
            bucket, docs = gid // NEOBOT_BUCKET, {}
        docs[str(gid)] = {
            "match": {k: g.get(k) for k in NEOBOT_MATCH_COLS},
            "players": table(players_by_game.get(gid, []), NEOBOT_PLAYER_COLS),
            "lines": table(mine, NEOBOT_LINE_COLS),
        }
    if docs:
        w.json("m/neobot/%d.json" % bucket, docs)
    if pub.neobot_matches:
        w.json("neobot/index.json", table(
            [dict(g, players=len(players_by_game.get(g["neobot_id"], [])))
             for g in reversed(pub.neobot_matches)],
            NEOBOT_MATCH_COLS + ("players",)))
        w.json("neobot/careers.json", table(
            [dict(c, key=keys[l]) for l, c in sorted(pub.careers["neobot"].items())],
            ("key",) + CAREER_COLS))

    # ---- what the site needs to know about all of it --------------------------
    def summary(section):
        ms = section.matches
        shown = [m for m in ms if section.counts(m)]
        # The latest few, newest first, as the facts file has them: the home
        # page lists them without loading the whole file.
        recent = sorted(shown, key=lambda m: (m.get("ended_at") or
                                              m.get("started_at") or 0, m["id"]),
                        reverse=True)[:RECENT]
        return {"matches": len(shown),
                "unfinished": section.unfinished,
                # When the bot's record begins: the site calls Neobot's games
                # "earlier matches", from before this (the user, 2026-11-05).
                "first_started": min((m["started_at"] for m in ms
                                      if m.get("started_at")), default=None),
                "first_id": ms[0]["id"] if ms else None,
                "last_id": ms[-1]["id"] if ms else None,
                "last_ended": max((m.get("ended_at") or 0 for m in ms),
                                  default=None) or None,
                "bucket": OWN_BUCKET,
                "recent": table([dict({k: m.get(k) for k in MATCH_COLS},
                                      played_seconds=match_seconds(m),
                                      players=m["players"])
                                 for m in recent],
                                MATCH_COLS + ("played_seconds", "players"))}
    # The build time moves only when the data did, so a run that changed
    # nothing leaves every file as it was and needs no deploy.
    built = int(now if now is not None else time.time())
    if w.changed == 0 and not w.stale(keep=("meta.json",)):
        try:
            with open(os.path.join(out, "meta.json"), encoding="utf-8") as f:
                built = json.load(f).get("built", built)
        except (FileNotFoundError, ValueError):
            pass
    meta = {
        "version": EXPORT_VERSION,
        "built": built,
        "sections": {"pub": summary(pub), "league": summary(league)},
        "neobot": ({"games": len(pub.neobot_matches),
                    "first_id": pub.neobot_matches[0]["neobot_id"],
                    "last_id": pub.neobot_matches[-1]["neobot_id"],
                    "bucket": NEOBOT_BUCKET}
                   if pub.neobot_matches else None),
        "players": len(index),
        "top_stats": TOP_STATS,
        "neobot_untracked_stats": list(NEOBOT_UNTRACKED_STATS),
        "league_exclude": list(league_exclude),
    }
    w.json("meta.json", meta)
    removed = w.finish()
    return {"files": len(w.written), "changed": w.changed, "removed": removed,
            "bytes": w.bytes, "seconds": round(time.monotonic() - started, 2),
            "players": len(index), "pub_matches": len(pub.matches),
            "league_matches": len(league.matches),
            "neobot_games": len(pub.neobot_matches),
            "replay_links": len(league.replay),
            "control_matches": len(league.control),
            "chat_matches": len(league.chat),
            "stats_matches": len(league.stats_replay_id)}
