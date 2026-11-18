// New replay-only metric, not a bot stat. Geometry and decoded tracks come
// from ss-replay; distances are shortest four-neighbour paths in its bases.
const CLOAK = 2, FLASH = 16;
const REVEAL_TICKS = 200, STALE_TICKS = 150, ROUND_WARMUP_TICKS = 1000;

function distances(base, safe) {
  const out = new Int32Array(base.floor.length).fill(-1);
  const first = base.floor.indexOf(safe);
  if (first < 0) throw new Error(`base ${base.num}: safe is outside its floor`);
  const queue = [first];
  out[first] = 0;
  for (let i = 0; i < queue.length; i++) {
    const tile = queue[i];
    for (let j = tile * 4; j < tile * 4 + 4; j++) {
      const next = base.nbr[j];
      if (next >= 0 && out[next] < 0) {
        out[next] = out[tile] + 1;
        queue.push(next);
      }
    }
  }
  return out;
}

/** Best run and totals per player and round. A run only earns net progress
 * while both bounding packets are cloaked. Visible retreats undo progress, so
 * shooting, retreating visibly and recloaking cannot farm distance. */
export function cloakStats(doc, model, control, rounds) {
  if (doc.tickRate !== 100) throw new Error("cloak runs require 100 ticks per second");
  const geometry = new Map(control.bases.map((base, index) => [base.num, {
    index, goals: base.safes.map((safe) => distances(base, safe)),
  }]));
  const resets = new Map(), shots = new Map();
  for (const e of doc.events) {
    const player = e.type === "kill" ? e.killed : e.player;
    if (!["kill", "enter", "leave", "ship", "freq"].includes(e.type)) continue;
    if (!resets.has(player)) resets.set(player, []);
    resets.get(player).push(e.t);
  }
  for (const fire of doc.fires ?? []) {
    if (!shots.has(fire.player)) shots.set(fire.player, []);
    shots.get(fire.player).push(fire.t);
  }
  const runs = [], totals = [];
  for (const [player, track] of model.trackArrays()) {
    const boundaries = (resets.get(player) ?? []).sort((a, b) => a - b);
    const fires = (shots.get(player) ?? []).sort((a, b) => a - b);
    let ri = 0, bi = 0, fi = 0, previous = null, run = null;
    const best = new Map(), roundTotals = new Map();
    for (let i = 0; i < track.t.length; i++) {
      const t = track.t[i];
      while (ri < rounds.length && t >= (rounds[ri].end ?? doc.source.endTick)) ri++;
      const round = rounds[ri];
      let reset = false;
      while (bi < boundaries.length && boundaries[bi] <= t) {
        if (previous && boundaries[bi] > previous.t) reset = true;
        bi++;
      }
      while (fi < fires.length && fires[fi] <= t) {
        fi++;
      }
      const fired = !!previous && fi > 0 && fires[fi - 1] >= previous.t;
      const life = model.lifeAt(player, t), g = round && geometry.get(round.base);
      const where = g && control.locate(track.x[i], track.y[i]);
      if (!round || t < round.start + ROUND_WARMUP_TICKS || !life.present || life.ship === 8 ||
          (life.freq !== 0 && life.freq !== 1) || !where || where.base !== g.index) {
        previous = run = null;
        continue;
      }
      const distance = g.goals[1 - life.freq][where.tile];
      if (distance < 0) { previous = run = null; continue; }
      const current = { t, i, round: ri, freq: life.freq, ship: life.ship, distance,
        cloaked: !!(track.status[i] & CLOAK) };
      if (previous) {
        const dt = t - previous.t, p = previous.i;
        // Shooting can set the flash bit too. Only a non-firing flash or
        // a departure from the predicted position breaks a shooting reveal.
        const elapsed = Math.min(dt, 100) / 1000;
        const flash = (track.status[i] & FLASH) && !(track.status[p] & FLASH);
        reset ||= previous.round !== ri || previous.freq !== life.freq ||
          previous.ship !== life.ship || dt > STALE_TICKS || (flash && !fired) ||
          Math.hypot(track.x[i] - track.x[p] - track.vx[p] * elapsed,
            track.y[i] - track.y[p] - track.vy[p] * elapsed) > 48;
      }
      if (reset) { run = null; previous = null; }
      if (!roundTotals.has(ri)) {
        roundTotals.set(ri, { player, name: model.name(player), seq: round.seq, tiles: 0, ticks: 0 });
      }
      const total = roundTotals.get(ri);
      if (previous?.cloaked && current.cloaked) total.ticks += t - previous.t;
      if (run && !current.cloaked && previous?.cloaked) {
        if (fired) run.revealed = t;
        else run = null;
      }
      if (run && run.revealed !== null && t - run.revealed > REVEAL_TICKS) run = null;
      if (!run && current.cloaked) run = { start: t, tiles: 0, revealed: null, seconds: 0, peak: 0 };
      if (run && previous) {
        const advance = previous.distance - distance;
        if (previous.cloaked && current.cloaked) {
          run.tiles += advance;
          run.seconds += (t - previous.t) / 100;
        } else {
          run.tiles += Math.min(0, advance);
        }
        if (run.tiles <= 0 && current.cloaked) {
          run = { ...run, start: t, tiles: 0, revealed: null, seconds: 0 };
        }
        if (current.cloaked) {
          run.revealed = null;
          // Sum each run's best advance, not repeated back-and-forth gains.
          if (run.tiles > run.peak) {
            total.tiles += run.tiles - run.peak;
            run.peak = run.tiles;
          }
          if (run.tiles > (best.get(ri)?.tiles ?? 0)) {
            best.set(ri, { player, name: model.name(player), seq: round.seq,
              start: run.start, end: t, tiles: run.tiles,
              seconds: Math.round(run.seconds * 100) / 100 });
          }
        }
      }
      previous = current;
    }
    runs.push(...best.values());
    for (const { ticks, ...total } of roundTotals.values()) {
      if (ticks > 0) totals.push({ ...total, seconds: ticks / 100 });
    }
  }
  return { runs, totals };
}
