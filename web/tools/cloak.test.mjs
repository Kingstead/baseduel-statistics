import assert from "node:assert/strict";
import { cloakStats } from "./cloak.mjs";

// A bent corridor: tile distance, not straight-line displacement.
const points = [[0, 0], [1, 0], [2, 0], [2, 1], [1, 1], [0, 1], [0, 2]];
const floor = Int32Array.from(points.map(([x, y]) => y * 1024 + x));
const nbr = new Int32Array(points.length * 4).fill(-1);
for (let i = 0; i < points.length; i++) {
  if (i > 0) nbr[i * 4] = i - 1;
  if (i + 1 < points.length) nbr[i * 4 + 1] = i + 1;
}
const control = {
  bases: [{ num: 1, floor, nbr, safes: [floor[0], floor.at(-1)] }],
  locate(x, y) {
    const tile = points.findIndex(([a, b]) => a * 16 === x && b * 16 === y);
    return tile < 0 ? null : { base: 0, tile };
  },
};
const round = { seq: 1, base: 1, start: 0, end: 10000 };

// Existing movement cases use tick 0 as the end of the round's warmup.
function stats(frames, { freq = 0, events = [], fires = [], rounds = [{ ...round, start: -1000 }] } = {}) {
  const track = { t: [], x: [], y: [], vx: [], vy: [], status: [] };
  for (const [t, tile, status = 2] of frames) {
    track.t.push(t);
    track.x.push(points[tile] ? points[tile][0] * 16 : 1000);
    track.y.push(points[tile] ? points[tile][1] * 16 : 1000);
    track.vx.push(0); track.vy.push(0); track.status.push(status);
  }
  const doc = { tickRate: 100, source: { endTick: 10000 }, events, fires };
  const model = {
    trackArrays: () => new Map([[0, track]]),
    lifeAt: () => ({ present: true, ship: 4, freq }),
    name: () => "Cloaker",
  };
  return cloakStats(doc, model, control, rounds);
}
const compute = (frames, options) => stats(frames, options).runs;
const tiles = (frames, options) => Math.max(0, ...compute(frames, options).map((r) => r.tiles));

assert.equal(tiles([[0, 0], [10, 1], [20, 2], [30, 3], [40, 4], [50, 5], [60, 6]]), 6);
assert.equal(tiles([[0, 6], [10, 5], [20, 4]], { freq: 1 }), 2);
assert.equal(tiles([[0, 0], [10, 1], [20, 0], [30, 1], [40, 2]]), 2);

const reveal = [[0, 0], [10, 1], [20, 2, 0], [100, 3, 0], [150, 4], [160, 5]];
assert.equal(tiles(reveal, { fires: [{ player: 0, t: 20 }] }), 2);
assert.equal(tiles(reveal.map(([t, tile, status]) => [t, tile, t === 20 ? 16 : status]),
  { fires: [{ player: 0, t: 20 }] }), 2, "firing flash is not a warp");
assert.equal(tiles(reveal.map(([t, tile, status]) => [t, tile, t === 20 || t === 100 ? 16 : status]),
  { fires: [{ player: 0, t: 20 }] }), 2, "sustained firing flash");
assert.equal(tiles([[0, 0], [10, 1], [20, 1], [20, 1, 16], [30, 2], [40, 3]],
  { fires: [{ player: 0, t: 20 }] }), 2, "same-tick position packets");
assert.equal(tiles(reveal), 1); // Not caused by shooting: separate runs.
assert.equal(tiles([[0, 0], [10, 1], [20, 1, 0], [120, 1, 0], [220, 1], [230, 2]],
  { fires: [{ player: 0, t: 20 }] }), 2); // Exactly two seconds is allowed.
assert.equal(tiles([[0, 0], [10, 1], [20, 1, 0], [120, 1, 0], [221, 1], [230, 2]],
  { fires: [{ player: 0, t: 20 }] }), 1);
assert.equal(tiles([[0, 0], [10, 1], [20, 2], [30, 1, 0], [40, 0, 0], [50, 0],
  [60, 1], [70, 2]], { fires: [{ player: 0, t: 30 }] }), 2);

for (const type of ["kill", "ship", "freq", "leave", "enter"]) {
  assert.equal(tiles([[0, 0], [10, 1], [20, 2], [30, 3]],
    { events: [{ type, player: 0, killed: 0, t: 15 }] }), 1, type);
}
assert.equal(tiles([[0, 0], [10, 1], [20, 2, 18], [30, 3]]), 1, "warp flash");
assert.equal(tiles([[0, 0], [10, 1], [200, 2], [210, 3]]), 1, "stale track");
assert.equal(tiles([[0, 0], [10, 1], [20, -1], [30, 2], [40, 3]]), 1, "outside base");
assert.equal(tiles([[1000, 0], [1010, 1], [2020, 2], [2030, 3]], {
  rounds: [{ ...round, end: 1015 }, { ...round, seq: 2, start: 1015 }],
}), 1, "round boundary");
assert.equal(tiles([[0, 0, 0], [10, 1, 0]]), 0);
assert.equal(tiles([[0, 0], [10, 1]], { freq: 8025 }), 0);

assert.equal(tiles([[0, 0], [10, 1], [20, 2]], { rounds: [round] }), 0, "round warmup");
const afterWarmup = compute([[980, 0], [990, 1], [1000, 2], [1010, 3]], { rounds: [round] });
assert.deepEqual(afterWarmup.map(({ start, end, tiles, seconds }) => ({ start, end, tiles, seconds })),
  [{ start: 1000, end: 1010, tiles: 1, seconds: 0.1 }], "no progress or time crosses the ten-second cutoff");
assert.deepEqual(compute([[980, 0], [990, 1], [1000, 2], [1010, 3],
  [5990, 4], [6000, 5], [6010, 6]], {
  rounds: [{ ...round, end: 5000 }, { ...round, seq: 2, start: 5000 }],
}).map(({ seq, start, tiles }) => ({ seq, start, tiles })),
[{ seq: 1, start: 1000, tiles: 1 }, { seq: 2, start: 6000, tiles: 1 }],
"every round has its own ten-second warmup");
assert.equal(tiles([[0, 0], [10, 1]], { rounds: [{ ...round, end: 900 }] }), 0,
  "rounds shorter than ten seconds contribute nothing");

const totals = (frames, options) => stats(frames, options).totals.map(({ tiles, seconds }) => ({ tiles, seconds }));
assert.deepEqual(totals([[0, 0], [10, 1], [20, 2], [30, 2, 0], [40, 0],
  [50, 1], [60, 2]]), [{ tiles: 4, seconds: 0.4 }], "total includes separate runs in the same round");
assert.deepEqual(totals([[0, 0], [10, 0], [20, 0], [30, 1], [40, 0], [50, 1]]),
  [{ tiles: 1, seconds: 0.5 }], "stationary and backtracking time counts, repeated advances do not");
assert.deepEqual(totals(reveal, { fires: [{ player: 0, t: 20 }] }),
  [{ tiles: 2, seconds: 0.2 }], "shooting joins progress but visible time is excluded");
assert.deepEqual(totals([[980, 0], [990, 1], [1000, 2], [1010, 3]], { rounds: [round] }),
  [{ tiles: 1, seconds: 0.1 }], "totals exclude the warmup");
assert.deepEqual(totals([[0, 0], [10, 1], [200, 2], [210, 3]]),
  [{ tiles: 2, seconds: 0.2 }], "missing data is not cloaked time or progress");
assert.deepEqual(totals([[0, 0], [10, 1], [20, 2], [30, 3]],
  { events: [{ type: "kill", killed: 0, t: 15 }] }),
[{ tiles: 2, seconds: 0.2 }], "totals do not bridge deaths");
console.log("cloak runs: ok");
