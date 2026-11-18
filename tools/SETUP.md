# Running bd-stats on a server

A server that holds the bots' databases can rebuild and deploy the site on
its own: `tools/refresh.sh` on a timer, plus a path watch that refreshes soon
after a league match.

## 1. Get the code and packages

```bash
git clone <this repository> ~/bd-stats
cd ~/bd-stats/web && npm ci
```

Node 22 and Python 3.10 or newer.

## 2. Credentials

Create `~/bd-stats/.cloudflare.env` (gitignored) with `CLOUDFLARE_API_TOKEN`
and `CLOUDFLARE_ACCOUNT_ID` for the Pages project.

## 3. Paths

`tools/refresh.sh` reads the databases from `~/PyCore` and replays from
`~/ss-replay` by default. It reads matching `<replay id>.stats.json` files
from the same data folder as the replay index. Override with
`BDSTATS_PUB_DB`, `BDSTATS_LEAGUE_DB`, `BDSTATS_REPLAYS`, `BDSTATS_SSREPLAY`
and `BDSTATS_LEAGUE_EXCLUDE`.

## 4. One run by hand

```bash
cd ~/bd-stats && tools/refresh.sh preview
```

A second run with nothing new says `databases unchanged, nothing to do`.

## 5. The timer and the league watch

The units in `tools/systemd/` assume the user `bdstats` with the checkout at
`/home/bdstats/bd-stats` and the bots under `/home/bdstats`. Edit `User=` and
the paths to match your server, then:

```bash
sudo cp tools/systemd/* /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now bd-stats-refresh.timer bd-stats-league.path
```

Watch it with `journalctl -u bd-stats-refresh -u bd-stats-league -f`.

## Updating

`git pull --ff-only` (and `cd web && npm ci` if the lockfile changed). The
next run deploys the new code.
