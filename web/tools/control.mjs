// Base control for every league replay, worked out by ss-replay's own code
// (web/src/control.ts, model.ts, tiles.ts), bundled with esbuild and only
// read: the site's chart and Held column are then the replay's own numbers.
// cloak.mjs also measures replay-only cloaked advances and totals on that geometry.
//   node tools/control.mjs <ss-replay data dir> <ss-replay web/src> <out dir>
//
// THE RULE is control.ts's: once a second, each floor tile of the base being
// played goes to the side whose nearest living ship reaches it first through
// the corridors; a side's share is its part of the tiles either side holds.
// The rounds, their seq and Held are the replay dashboard's (ss-replay main,
// dash.ts findRounds, roundDamage and setControlSeries), copied here and in
// control-rounds.mjs because that file draws on a page and cannot be bundled
// for Node.
//
// One file a replay, <out>/<replay id>.json, rewritten only when the replay,
// its map or ss-replay's code changed. A replay that fails is a WARN and has
// no file; the run fails only if the code will not bundle. Prints one JSON line.
import { build } from "esbuild";
import { createHash } from "node:crypto";
import {
  existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";
import { docRounds } from "./control-rounds.mjs";
import { cloakStats } from "./cloak.mjs";

const STEP = 100;          // ticks a sample: control.ts computeSeries' step, one a second

const [data, src, out] = process.argv.slice(2);
if (!data || !src || !out) {
  console.error("usage: node tools/control.mjs <ss-replay data dir> <ss-replay web/src> <out dir>");
  process.exit(2);
}

const tmp = mkdtempSync(join(tmpdir(), "bd-control-"));
const entry = join(tmp, "entry.ts");
writeFileSync(entry, `
export { Model } from ${JSON.stringify(join(src, "model.ts"))};
export { Tiles } from ${JSON.stringify(join(src, "tiles.ts"))};
export { BaseControl } from ${JSON.stringify(join(src, "control.ts"))};
`);
const bundled = await build({ entryPoints: [entry], bundle: true, format: "esm", platform: "node",
  write: false, logLevel: "error" });
const code = bundled.outputFiles[0].text;
writeFileSync(join(tmp, "ssreplay.mjs"), code);
const { Model, Tiles, BaseControl } = await import(pathToFileURL(join(tmp, "ssreplay.mjs")).href);
rmSync(tmp, { recursive: true });
// ss-replay's code and ours: a change to any of it computes it all again
const codeHash = createHash("sha1").update(code).update(readFileSync(new URL(import.meta.url)))
  .update(readFileSync(new URL("./control-rounds.mjs", import.meta.url)))
  .update(readFileSync(new URL("./cloak.mjs", import.meta.url))).digest("hex");

function compute(doc, lvl) {
  const control = new BaseControl(lvl, new Tiles(lvl), [0, 1]);
  if (!control.bases.length) throw new Error("no bases found on the map");
  const model = new Model(doc);
  const endTick = doc.source.endTick;
  const rounds = docRounds(doc);
  const series = rounds.map((r) => {
    const end = r.end ?? endTick;
    // dash.ts setControlSeries: the samples from ceil(start) to end, as the
    // series holds them (a Float32Array), averaged where a base was played
    const shares = [];
    let sum = 0, n = 0;
    for (let i = Math.ceil(r.start / STEP); i * STEP <= end; i++) {
      const c = control.at(model.views(i * STEP));
      if (!c) { shares.push(null); continue; }
      const s = Math.fround(c.share);
      sum += s; n++;
      shares.push(Math.round(s * 1000) / 1000);
    }
    // pct is the dashboard's own cell, Math.round(held * 100), so the site
    // shows the replay's figure without rounding a second time
    return { round: r.round, attempt: r.attempt, seq: r.seq, base: r.base, start: r.start, end,
      held: n ? sum / n : null, pct: n ? Math.round((sum / n) * 100) : null, shares };
  });
  const { runs: cloak, totals: cloakTotals } = cloakStats(doc, model, control, rounds);
  return { rounds: series, cloak, cloakTotals,
    cloakPlayers: model.shipPlayers().map((p) => model.name(p)) };
}

mkdirSync(out, { recursive: true });
const index = JSON.parse(readFileSync(join(data, "index.json"), "utf8"));
const tally = { computed: 0, cached: 0, failed: 0, removed: 0, skipped: 0 };
const keep = new Set();
for (const e of index) {
  if (!e.match || !e.map || !e.replay) { tally.skipped++; continue; }   // not a bot's match: no sides
  const file = join(out, `${e.id}.json`);
  keep.add(`${e.id}.json`);
  try {
    const rp = join(data, e.replay), mp = join(data, e.map);
    const rs = statSync(rp), ms = statSync(mp);
    const key = createHash("sha1").update([codeHash, e.replay, rs.size, rs.mtimeMs, e.map, ms.size, ms.mtimeMs].join("|"))
      .digest("hex");
    if (existsSync(file)) {
      try {
        if (JSON.parse(readFileSync(file, "utf8")).key === key) { tally.cached++; continue; }
      } catch { /* unreadable: compute it again */ }
    }
    const doc = JSON.parse(gunzipSync(readFileSync(rp)).toString("utf8"));
    const result = compute(doc, new Uint8Array(readFileSync(mp)));
    writeFileSync(file + ".tmp", JSON.stringify({ key, id: e.id, match: e.match.id, step: STEP, ...result }));
    renameSync(file + ".tmp", file);
    tally.computed++;
  } catch (err) {
    console.error(`WARN ${e.id}: ${err?.message ?? err}`);
    rmSync(file, { force: true });       // never a chart from a replay that has changed since
    tally.failed++;
  }
}
// a replay taken down takes its chart with it
for (const f of readdirSync(out)) {
  if (f.endsWith(".json") && !keep.has(f)) { rmSync(join(out, f)); tally.removed++; }
}
console.log(JSON.stringify({ control: tally }));
