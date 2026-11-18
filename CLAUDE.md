# bd-stats — the base duel stats site

A static site (Cloudflare Pages): player profiles, match boards, leaderboards,
records, ratings and insights for a Subspace Continuum zone's two base duel
bots, built from their SQLite databases.

The bots live in two sibling projects, PyCore (the bots and their databases)
and ss-replay (published match replays). **This project only reads them, and
never writes to them.** Python that imports PyCore runs with
`PYTHONDONTWRITEBYTECODE=1`; git reads there use `GIT_OPTIONAL_LOCKS=0`;
PyCore's database classes only ever open a copy (their `start()` migrates).

## The two sections, never added together

| section | database | bot | URL |
|---|---|---|---|
| pub | `pubduel.db` | the pub bot (pub 0/1, private 100/200), plus an older bot's imported games | `/m/<id>` |
| league | `baseduel.db` | the league bot (match, scrim, pickup) | `/league/m/<id>` |

The league's match numbers overlap the pub's, hence its own URL. A player's
page shows both sections side by side; nothing sums them (different arenas and
settings).

The pub section's older games ("earlier matches") and the pub bot's own are
one record. No page names the older bot; its games are described as "before
<the pub bot's first match>" and carry no date. Internal names (files, tables,
code) keep `neobot`.

## THE RULE: a number on the site is the number the bot gives in game

Two checks hold it, and both must stay at 0 differences:

- `tests/test_parity.py`: PyCore's own readers (`get_player_career`,
  `get_match`, ...) against the exported data, every player and scope.
- `tests/test_site_parity.py`: PyCore's `pubduel/board.py` against what the
  site's TypeScript draws from that data (`web/tools/cells.mjs`): every board,
  row and cell, plus leaderboards, history, bases, activity, chat and base
  control.

What made them pass, and must stay:

- **Python's rounding** (`web/src/format.ts`): `pyFixed` is `'%.2f'` (half to
  even), `pyRound` is `round()`.
- **Python 3.12's `sum()`** is Neumaier-compensated: `pySum`.
- **Names fold as SQLite does**, ASCII letters only (`fold`).
- Scopes are the bots' (`exporter/rules.py`). Careers count decided matches
  only; Win% leaves out no-results.
- A league match nobody won counts nowhere but the Matches list
  (`Section.unfinished`).
- A field the older bot never tracked is "not tracked", never 0: NULLs stay
  null through the export.
- The site writes K and D for kills and deaths.

## Features

- **Player page** (`pages/Player.tsx`): one section at a time with scope
  buttons; Rating / Record / K/D / KPM tiles driving the Form chart and
  lighting a history column; teammates and rivals; full history.
- **Leaderboards** (`/top`, `leaderboard.ts`): the bot's `get_leaderboard`
  done in the browser, plus a time range and a minimum-matches filter.
- **Records** (`exporter/records.py`), **Compare** (`compare.ts`), **Bases**
  (`bases.ts`), **Activity** (`activity.ts`), **Insights**
  (`exporter/insights.py`).
- **Ratings** (`exporter/ratings.py`): Weng-Lin Bradley-Terry over people
  only, decided matches in play order. `tools/ratings-study/` is how the
  method was chosen.
- **League match pages with a published replay**: base control (computed with
  ss-replay's own code, bundled by `web/tools/control.mjs`, never ported) and
  the recording's chat (`web/tools/chat.mjs`, `web/src/chat.ts`).
- **Charts** (`charts.tsx`): one SVG `LineChart` and a `BarChart`, colours as
  validated tokens.

## Layout

```
exporter/        stdlib Python: snapshot.py (backup API), rules.py (the bots'
                 rules), readers.py (read-only SQL), export.py (the JSON)
tests/           test_export.py (fixtures from the real schema), test_parity.py,
                 test_site_parity.py
web/             Vite + TypeScript + Preact, no other runtime deps
  tools/shot.mjs   headless Chrome: errors, sideways scroll, screenshots
  tools/cells.mjs  what the site draws, for test_site_parity
tools/check.sh   every check; deploy.sh [preview|main|mockup]; refresh.sh
tools/systemd/   units for a server that refreshes and deploys on its own
```

Data (`web/public/data/`, gitignored) is written only when its bytes change.
The export refuses past 15,000 files or 20 MiB a file (Pages limits).

**Never exported:** `bd_settings`, `bd_arena_bases`, and every
`bd_player_flags` list but `bot` (`test_only_the_bot_list_leaves_the_database`).

## Commands

```
python3 -m exporter snapshot SRC DST [--immutable]
python3 -m exporter export --pub .snap/pubduel.db --league .snap/baseduel.db \
    --out web/public/data [--replays <index.json>] [--control .snap/control] \
    [--chat .snap/chat] [--stats <ss-replay data dir>] \
    [--league-exclude 'pattern']
tools/check.sh                       # everything
cd web && node_modules/.bin/vite     # dev server
tools/deploy.sh preview              # needs .cloudflare.env
```

## Secrets

`.cloudflare.env` holds the Pages token and is gitignored. Chat is player
text going onto the site: `deploy.sh` refuses to deploy anything that looks
like a webhook or token.
