#!/usr/bin/env bash
# The VM's job, run by bd-stats-refresh.timer: snapshot the live databases,
# export, and deploy only when the site changed; when the databases have not
# been written since the last run, none of that. One line in the journal a
# run says what happened.
#
#   tools/refresh.sh [preview|main]      preview by default
#
# A change is anything in the data, the exporter, the site's code or the
# deploy script newer than the last deploy to that branch (.deployed-<branch>,
# touched only after a deploy succeeds), so a deploy that failed is tried
# again on the next run, and pulled code goes up without waiting for a match.
# DRY_RUN=1 does everything but the deploy.
#
# TRIGGER=league is a run bd-stats-league.path started because the league
# bot wrote its database or ss-replay published a replay: it waits for a run
# already going instead of skipping (that one may have copied the database
# before the match), and goes on only for a new league match or a new replay
# index; the bot also writes a setting or two during a match.
#
# Where the databases are, and which league names are bots:
#   BDSTATS_PUB_DB      ~/PyCore/pubduel.db
#   BDSTATS_LEAGUE_DB   ~/PyCore/baseduel.db
#   BDSTATS_REPLAYS     ~/ss-replay/web/public/data/index.json (links to the
#                       league's published replays; base control, chat and
#                       replay stats are read from this folder)
#   BDSTATS_SSREPLAY    ~/ss-replay (its web/src: the base control code that
#                       web/tools/control.mjs runs over the replays beside the
#                       index, read-only, into .snap/control)
#   BDSTATS_LEAGUE_EXCLUDE  Zero-EG-*  (the league bot's BASEDUEL_STATS_EXCLUDE)
set -euo pipefail
cd "$(dirname "$0")/.."
export PYTHONDONTWRITEBYTECODE=1

branch="${1:-preview}"
case "$branch" in
  preview|main) ;;
  *) echo "usage: tools/refresh.sh [preview|main]" >&2; exit 2 ;;
esac

# One run at a time: a slow deploy must not overlap the next tick.
exec 9>.refresh.lock
if [ "${TRIGGER:-}" = league ]; then
  if ! flock -w 900 9; then echo "refresh: another run held the lock for 15 minutes, skipped"; exit 0; fi
elif ! flock -n 9; then echo "refresh: another run is going, skipped"; exit 0; fi

pub_db="${BDSTATS_PUB_DB:-$HOME/PyCore/pubduel.db}"
league_db="${BDSTATS_LEAGUE_DB:-$HOME/PyCore/baseduel.db}"
replays="${BDSTATS_REPLAYS:-$HOME/ss-replay/web/public/data/index.json}"
ssreplay="${BDSTATS_SSREPLAY:-$HOME/ss-replay}"
started=$(date +%s)

marker=".deployed-$branch"
replays_seen() {
  local index stats data
  index=$(stat -L -c '%n %s %.9Y' "$replays" 2>/dev/null || echo "$replays none")
  data="$(dirname "$replays")"
  if [ -d "$data" ]; then
    stats=$(find "$data" -maxdepth 1 -type f -name '*.stats.json' \
      -printf '%f %s %.9T@\n' | LC_ALL=C sort | cksum | awk '{print $1 ":" $2}')
  else
    stats=none
  fi
  printf '%s %s\n' "$index" "$stats"
}
newer() {
  find web/public/data web/src web/index.html web/public/_headers web/package.json \
    web/tools/control.mjs web/tools/control-rounds.mjs web/tools/chat.mjs tools/deploy.sh exporter \
    -newer "$marker" -print -quit
}

mkdir -p .snap
if [ "${TRIGGER:-}" = league ]; then
  league_last=$(python3 -m exporter matches "$league_db")
  if [ "$league_last" = "$(cat .snap/league-last 2>/dev/null)" ] &&
     grep -qxF "$(replays_seen)" .snap/seen 2>/dev/null; then
    echo "refresh: no new league match or replay, nothing to do"
    exit 0
  fi
fi

# Most runs fall between matches, when nothing has been written: those stop
# here, having looked at the databases, their write-ahead logs, replay index
# and stats-file metadata. Any write by a bot makes a full run.
seen=$(for f in "$pub_db" "$pub_db-wal" "$league_db" "$league_db-wal"; do
  stat -L -c '%n %s %.9Y' "$f" 2>/dev/null || echo "$f none"; done; replays_seen)
if [ -f "$marker" ] && [ "$seen" = "$(cat .snap/seen 2>/dev/null)" ] && [ -z "$(newer)" ]; then
  echo "refresh: databases unchanged, nothing to do"
  exit 0
fi

# The backup API, never cp: the bots have these open.
python3 -m exporter snapshot "$pub_db" .snap/pubduel.db >/dev/null
python3 -m exporter snapshot "$league_db" .snap/baseduel.db >/dev/null
args=(--pub .snap/pubduel.db --league .snap/baseduel.db --out web/public/data
      --league-exclude "${BDSTATS_LEAGUE_EXCLUDE:-Zero-EG-*}")
control=""
chat=""
if [ -f "$replays" ]; then
  replay_data="$(dirname "$replays")"
  args+=(--replays "$replays" --stats "$replay_data")
  # Base control of each league replay: only new or changed ones are worked
  # out. If ss-replay's code will not run, the files from the last run stay,
  # so no chart disappears from the site over it.
  if ! control=$(cd web && node tools/control.mjs "$replay_data" "$ssreplay/web/src" ../.snap/control); then
    echo "refresh: base control FAILED, the last run's kept" >&2
    control=""
  fi
  if [ -d .snap/control ]; then args+=(--control .snap/control); fi
  # The chat of each league replay, read only when the replay is new or
  # changed; the same rule if it fails: the last run's files stay.
  if ! chat=$(cd web && node tools/chat.mjs "$replay_data" ../.snap/chat); then
    echo "refresh: chat FAILED, the last run's kept" >&2
    chat=""
  fi
  if [ -d .snap/chat ]; then args+=(--chat .snap/chat); fi
fi
summary="$(python3 -m exporter export "${args[@]}")${control:+ $control}${chat:+ $chat}"
# Taken before the snapshots: a write while they ran makes the next run full.
printf '%s\n' "$seen" > .snap/seen
# The league's last match as exported, for the next TRIGGER=league run.
python3 -m exporter matches .snap/baseduel.db > .snap/league-last

changed=""
if [ -f "$marker" ]; then changed=$(newer); fi
if [ -f "$marker" ] && [ -z "$changed" ]; then
  echo "refresh: no change, no deploy ($(( $(date +%s) - started ))s) $summary"
  exit 0
fi
if [ "${DRY_RUN:-}" = 1 ]; then
  echo "refresh: would deploy to $branch (${changed:-first deploy}) $summary"
  exit 0
fi
# The marker takes the time from before the upload: anything changed while it
# ran is newer, so the next run sends it.
touch "$marker.next"
if ! tools/deploy.sh "$branch" >.deploy.log 2>&1; then
  echo "refresh: deploy to $branch FAILED, tried again next run:" >&2
  tail -n 5 .deploy.log >&2
  rm -f "$marker.next"
  exit 1
fi
mv "$marker.next" "$marker"
echo "refresh: deployed to $branch ($(( $(date +%s) - started ))s) $summary"
