# baseduel-statistics

The stats site for base duel in the game **Subspace Continuum**: player
profiles, match boards, leaderboards, records, ratings and insights, built
from the databases of the zone's two base duel bots.

**Live:** https://bd-stats.pages.dev

Base duel is a team game played in an arena of bases. Two freqs (teams)
fight over one base at a time, and a round goes to the team that touches the
enemy's safe or wipes them out. Two bots run it, and this site covers both:

| section | bot | what it covers |
|---|---|---|
| **Pub arena** | the pub bot | open pub matches on freqs 0/1, private challenge matches on 100/200, and 23,000+ earlier games imported from the bot before it |
| **League** | the league bot | official league matches, scrims and pickups |

The two are never added together: different arenas, different settings.

## What's on the site

- **Players:** a career for each section and scope (pub, private, hard mode;
  league, scrim, pickup), a rating, a Form chart (Win%, K/D, kills a minute
  or rating over time), teammates and rivals, and every match played.
- **Matches:** the full scoreboard the bot prints in game, the score after
  each round, a round timeline, and for league matches with a published
  replay, a base-control chart, the match's chat and replay-derived player
  breakdowns and highlights, linked to the replay. Replay stats are embedded
  by the exporter; the page does not fetch files from ss-replay.
  Player names open career pages; supported scoreboard stat cells open focused
  replay breakdowns: kills, deaths, team kills, reconstructed streaks, kills by
  recording minute, and repel/burst use (with estimated burst victims).
  Replay details are labelled separately from the bot's scoreboard totals.
  Damage relationships, attach relationships and available/remaining item
  counts are not in the available replay stats; those limitations are shown
  explicitly rather than inventing player breakdowns.
  Matches with replays add highlights for
  most kills/deaths in any rolling 60-second window, most enemy kills without
  dying and most deaths without an enemy kill. Replay peaks cover the whole
  recording, including between rounds and runs still in progress at its end.
  Minute counts include team kills; suicides count as deaths, not kills.
  Kill/death peak rankings link to the first occurrence of each player's
  best result, with a five-second lead-in and player-follow enabled.
  **Most streaks ended** keeps the bot's totals and adds links to each
  reconstructed enemy streak of 10+ ended in the recording; replay events
  and scoreboard totals can differ. A **Replay** badge marks highlights
  with watchable moments, including cloaked advances.
  With replay base geometry available, **Longest cloaked advance** measures
  net progress toward the enemy safe along the base's four-neighbour tile
  paths (one tile is 16 pixels), not total distance flown. Measurement starts
  10 seconds after each round begins, with no distance or cloaked time carried
  over from those first 10 seconds. Shooting reveals
  of up to two seconds join the same run; visible forward movement earns no
  distance and backtracking undoes progress. Death, ship/team changes,
  position discontinuities (warps/attaches), leaving the base, gaps in
  position data and round boundaries reset the run. Only matched rounds
  count. This is a packet-derived estimate, not a bot stat; the ranking links
  to each player's best run and shows its observed cloaked time.
  **Total cloaked time & progress** ranks players by the sum of each separate
  cloak run's best net advance and shows their total observed cloaked time
  alongside it. Stationary and retreating cloaked time counts too; visible
  shooting gaps do not. Backtracking within a run does not farm progress.
  The same round, warmup and position-continuity restrictions apply.
  Each highlight opens a complete highest-to-lowest ranking for the match;
  player names still link to career pages, and untracked values stay untracked.
  Highlights are grouped by score/time, kills, deaths, damage, teamwork, movement and
  items, with an arrow marking each clickable card. Uninterrupted-minute
  highlights count kills before any death and deaths before any kill within
  rolling windows of up to 60 seconds; shorter runs qualify and team kills
  count as kills. Scoreboard headers sort within each team, reversing on a
  second click; team totals stay at the bottom and untracked values sort last.
- **Leaderboards:** every board the bots offer in game, plus a time range and
  a minimum number of matches.
- **Records:** most kills and damage in a match, longest streaks, winning
  runs, longest matches, biggest comebacks.
- **Compare:** two players' head to head, together and against each other.
- **Bases:** for each arena and base, how often each side wins and how
  (touch or wipe), and how long a round takes.
- **Activity:** matches a day, players this week against last, and the busy
  hours of the week, in the viewer's own time zone.
- **Insights:** does freq 0 win more, how much an extra player is worth, people
  against bots, and hard mode.
- **Ratings:** a Weng-Lin (OpenSkill) rating over people only, with matches
  replayed in the order they were played. `tools/ratings-study/` holds the
  study that chose the method, scored on how well it predicts later matches.

## The rule: every number is the bot's number

A figure on the site is the figure the bot gives in game. Two checks hold it:

- `tests/test_parity.py` runs the bots' own Python readers against the
  exported data: every player, every scope, every match.
- `tests/test_site_parity.py` runs the bots' own scoreboard code against what
  the site's TypeScript draws: every board, row and cell, plus the
  leaderboards, histories, bases, activity, chat and base control.

Both must show 0 differences. Getting there meant copying Python's quirks
into the browser: `'%.2f'` rounds half to even, `sum()` is
Neumaier-compensated, names fold the way SQLite folds them. A stat the old
bot never tracked shows as "not tracked", never as 0.

## How it works

```
bots' SQLite databases ──snapshot──▶ exporter/ (Python) ──JSON──▶ web/ (Preact) ──▶ Cloudflare Pages
```

- `exporter/`: Python standard library only. Takes consistent snapshots with
  SQLite's backup API, applies the bots' own rules (`rules.py`) through
  read-only queries (`readers.py`), and writes the JSON the site reads
  (`export.py`), plus records, ratings, teammates and insights. A file is
  rewritten only when its bytes change.
- `web/`: Vite, TypeScript and Preact, with no other runtime dependency. One
  JSON file per player and per block of matches, so a page loads only what
  it shows. The charts are hand-made SVG.
- `tools/refresh.sh`: run on a timer (and, for the league, on a database
  write). It does nothing when no database has changed, and deploys only when
  the site would change. A league match is on the site about a minute after
  it ends. See `tools/SETUP.md`.

## Running it

You need the bots' databases (`pubduel.db` and `baseduel.db`).

```bash
mkdir -p .snap
python3 -m exporter snapshot /path/to/pubduel.db .snap/pubduel.db
python3 -m exporter snapshot /path/to/baseduel.db .snap/baseduel.db
python3 -m exporter export --pub .snap/pubduel.db --league .snap/baseduel.db \
    --out web/public/data [--replays /path/to/ss-replay/web/public/data/index.json \
    --stats /path/to/ss-replay/web/public/data]
cd web && npm ci && npm run dev
```

Requires Python 3.10+ and Node 22.

## Checks

```bash
tools/check.sh
```

This runs the exporter's tests, the TypeScript type check and the tools'
tests on their own. The two parity checks also need the bots' code (PyCore,
read-only) and database snapshots in `.snap/`. Without them they print SKIP.

## Contributing

Pull requests are welcome. Without the databases there is no data to view
the site with, so open an issue first for anything beyond a small fix. Every
change that touches a number has to pass the parity checks, which the
maintainer runs before merging.

## Licence

MIT. The Chakra Petch font in `web/public/fonts/` is under the SIL Open Font
License (`OFL.txt` beside it).
