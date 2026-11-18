"""
python3 -m exporter snapshot SRC DST [--immutable]
python3 -m exporter export --pub PUBDB --league LEAGUEDB --out DIR
                           [--replays INDEX] [--replay-site URL]
                           [--control DIR] [--chat DIR] [--stats DIR]
                           [--league-exclude 'Zero-EG-*']
python3 -m exporter matches DB

`snapshot` copies a live database with the backup API. `export` reads two
snapshots and writes the site's data. Prints one summary line as JSON.
`matches` prints a database's last match number and how many it holds,
"157 157", read-only: tools/refresh.sh asks it whether a match was added.
"""
import argparse
import json
import os
import sqlite3
import sys

from exporter.export import export
from exporter.rules import parse_exclude_list
from exporter.snapshot import open_snapshot, snapshot


def load_replays(path):
    """ss-replay's index.json, as {lowercased replay id: id}: only replays
    that are published get a link."""
    with open(path, encoding="utf-8") as f:
        entries = json.load(f)
    return {e["id"].lower(): e["id"] for e in entries if e.get("id")}


def load_control(folder):
    """web/tools/control.mjs's files, as {lowercased replay id: doc}: the
    base control of each league replay, by ss-replay's own code."""
    return by_replay(folder)


def load_chat(folder):
    """web/tools/chat.mjs's files, as {lowercased replay id: doc}: the chat
    of each league replay, as the recording kept it."""
    return by_replay(folder)


def by_replay(folder):
    """A folder of one JSON file a replay, by the replay's lowercased id."""
    out = {}
    for name in sorted(os.listdir(folder)):
        if name.endswith(".json"):
            with open(os.path.join(folder, name), encoding="utf-8") as f:
                doc = json.load(f)
            out[doc["id"].lower()] = doc
    return out


def last_match(path):
    """"<last id> <count>" of bd_matches, opened read-only: a live database's
    writer is never held up and nothing on disk changes."""
    conn = sqlite3.connect("file:%s?mode=ro" % os.path.abspath(path), uri=True)
    try:
        last, count = conn.execute(
            "SELECT COALESCE(MAX(id), 0), COUNT(*) FROM bd_matches").fetchone()
    finally:
        conn.close()
    return "%d %d" % (last, count)


def main(argv=None):
    ap = argparse.ArgumentParser(prog="exporter")
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("snapshot", help="copy a live database")
    s.add_argument("src")
    s.add_argument("dst")
    s.add_argument("--immutable", action="store_true",
                   help="the source is a copy nobody is writing")
    e = sub.add_parser("export", help="write the site's data")
    e.add_argument("--pub", required=True, help="snapshot of pubduel.db")
    e.add_argument("--league", required=True, help="snapshot of baseduel.db")
    e.add_argument("--out", required=True, help="the data folder")
    e.add_argument("--replays", help="ss-replay's data/index.json")
    e.add_argument("--replay-site", default="https://ss-replay.pages.dev")
    e.add_argument("--control", help="web/tools/control.mjs's output folder")
    e.add_argument("--chat", help="web/tools/chat.mjs's output folder")
    e.add_argument("--stats", help="ss-replay data folder with <id>.stats.json files")
    e.add_argument("--league-exclude", default="Zero-EG-*",
                   help="BASEDUEL_STATS_EXCLUDE's patterns, comma-separated")
    m = sub.add_parser("matches", help="the last match number and the count")
    m.add_argument("db")
    args = ap.parse_args(argv)

    if args.cmd == "matches":
        print(last_match(args.db))
        return 0
    if args.cmd == "snapshot":
        snapshot(args.src, args.dst, immutable=args.immutable)
        print(json.dumps({"snapshot": args.dst}))
        return 0
    pub, league = open_snapshot(args.pub), open_snapshot(args.league)
    try:
        got = export(pub, league, args.out,
                     league_exclude=parse_exclude_list(args.league_exclude),
                     replays=load_replays(args.replays) if args.replays
                     else None,
                     replay_site=args.replay_site,
                     control=load_control(args.control) if args.control
                     else None,
                     chat=load_chat(args.chat) if args.chat else None,
                     stats_dir=args.stats)
    finally:
        pub.close()
        league.close()
    print(json.dumps(got))
    return 0


if __name__ == "__main__":
    sys.exit(main())
