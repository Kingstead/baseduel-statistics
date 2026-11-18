#!/usr/bin/env bash
# Every check, in order. The two parity checks need PyCore (read-only) and
# snapshots in .snap/; without them they print SKIP.
#   tools/check.sh
# REPLAYS=<ss-replay index.json> links the league's replays. REPLAYS_DATA=<the
# folder holding it and the replays> also links its index, works out base
# control (web/tools/control.mjs, with ss-replay's code from $BD_STATS_SSREPLAY
# or ~/ss-replay) into .snap/control, their chat into .snap/chat, and passes
# <id>.stats.json files to the exporter.
set -euo pipefail
cd "$(dirname "$0")/.."
export PYTHONDONTWRITEBYTECODE=1
ssreplay="${BD_STATS_SSREPLAY:-$HOME/ss-replay}"

python3 tests/test_export.py
web/node_modules/.bin/tsc -p web --noEmit && echo "typecheck: ok"
node web/tools/control-rounds.test.mjs
node web/tools/cloak.test.mjs
node web/tools/chat.test.mjs
node web/tools/killlog.test.mjs
if [ -f .snap/pubduel.db ] && [ -f .snap/baseduel.db ]; then
  replay_args=()
  if [ -n "${REPLAYS:-}" ]; then
    replay_args=(--replays "$REPLAYS")
  elif [ -n "${REPLAYS_DATA:-}" ] && [ -f "$REPLAYS_DATA/index.json" ]; then
    replay_args=(--replays "$REPLAYS_DATA/index.json")
  fi
  replay_data_args=()
  if [ -n "${REPLAYS_DATA:-}" ]; then
    replays_data="$(cd "$REPLAYS_DATA" && pwd)"
    (cd web && node tools/control.mjs "$replays_data" "$ssreplay/web/src" ../.snap/control)
    (cd web && node tools/chat.mjs "$replays_data" ../.snap/chat)
    replay_data_args=(--control .snap/control --chat .snap/chat --stats "$replays_data")
    export CONTROL_DIR=.snap/control
  elif [ -n "${REPLAYS:-}" ]; then
    replay_data_args=(--stats "$(cd "$(dirname "$REPLAYS")" && pwd)")
  fi
  python3 -m exporter export --pub .snap/pubduel.db --league .snap/baseduel.db \
    --out web/public/data "${replay_args[@]}" "${replay_data_args[@]}"
  python3 tests/test_parity.py
  python3 tests/test_site_parity.py
else
  echo "SKIP parity: no snapshots in .snap/"
fi
