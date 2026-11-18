// Who killed whom in a league match, from the kill log of its published
// replay (ss-replay's <id>.stats.json). The log covers the whole recording,
// so its totals can differ by a few from the bot's scoreboard, which counts
// the match's rounds; the match page says so.

import { fold } from "./format";
import type { PlayerKillBreakdown, ReplayKill, Versus } from "./data";
export type { ReplayStats, Versus } from "./data";
export type Kill = ReplayKill;
export type PlayerKills = PlayerKillBreakdown;

const bump = (m: Record<string, number>, k: string) => { m[k] = (m[k] ?? 0) + 1; };

/** One player's side of the kill log, optionally within [from, to) ticks.
 * Names compare as the bot's do (`fold`): the replay may spell them with
 * other letter case than the database. */
export function playerKills(kills: Kill[], name: string, window?: [number, number]): PlayerKills {
  const me = fold(name);
  const out: PlayerKills = {
    killed: [], killedBy: [], teamKilled: [], teamKilledBy: [],
    kills: 0, deaths: 0, weaponsOut: {}, weaponsIn: {},
  };
  const tallies = {
    killed: new Map<string, Versus>(), killedBy: new Map<string, Versus>(),
    teamKilled: new Map<string, Versus>(), teamKilledBy: new Map<string, Versus>(),
  };
  const add = (bucket: Map<string, Versus>, other: string, freq: number, weapon: string) => {
    const key = fold(other);
    let v = bucket.get(key);
    if (!v) bucket.set(key, (v = { name: other, freq, n: 0, weapons: {} }));
    v.n++;
    bump(v.weapons, weapon);
  };
  for (const k of kills) {
    if (window && (k.t < window[0] || k.t >= window[1])) continue;
    const gave = fold(k.killer) === me;
    const took = fold(k.killed) === me;
    if (gave === took) continue; // not this player's, or a suicide
    if (gave) {
      if (k.teamKill) add(tallies.teamKilled, k.killed, k.killedFreq, k.weapon);
      else {
        out.kills++;
        bump(out.weaponsOut, k.weapon);
        add(tallies.killed, k.killed, k.killedFreq, k.weapon);
      }
    } else if (k.teamKill) add(tallies.teamKilledBy, k.killer, k.killerFreq, k.weapon);
    else {
      out.deaths++;
      bump(out.weaponsIn, k.weapon);
      add(tallies.killedBy, k.killer, k.killerFreq, k.weapon);
    }
  }
  const sorted = (m: Map<string, Versus>) =>
    [...m.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
  out.killed = sorted(tallies.killed);
  out.killedBy = sorted(tallies.killedBy);
  out.teamKilled = sorted(tallies.teamKilled);
  out.teamKilledBy = sorted(tallies.teamKilledBy);
  return out;
}

export interface Streak {
  kills: Kill[];
  endedBy?: Kill;
}

/** Reconstructed enemy-kill streaks, not the bot's recorded streak counters.
 * Any death resets a streak; team kills do not advance it. */
export function playerStreaks(kills: Kill[], name: string, window?: [number, number]) {
  const active = new Map<string, Kill[]>();
  const streaks: Streak[] = [];
  for (const k of [...kills].sort((a, b) => a.t - b.t)) {
    if (window && (k.t < window[0] || k.t >= window[1])) continue;
    const killer = fold(k.killer), killed = fold(k.killed);
    const ended = active.get(killed);
    if (ended?.length) streaks.push({ kills: ended, endedBy: k });
    active.delete(killed);
    if (killer === killed || k.teamKill) continue;
    const run = active.get(killer) ?? [];
    run.push(k);
    active.set(killer, run);
  }
  for (const run of active.values()) streaks.push({ kills: run });
  const me = fold(name);
  return {
    streaks: streaks.filter((s) => fold(s.kills[0].killer) === me),
    ended: streaks.filter((s) => s.kills.length >= 10 && s.endedBy &&
      !s.endedBy.teamKill && fold(s.endedBy.killer) === me && fold(s.endedBy.killed) !== me),
  };
}

/** Wall-clock recording minutes, including quiet minutes and a partial last
 * minute. These are counts, not the bot's active-field-time KPM. */
export function minuteKills(kills: Kill[], name: string, window: [number, number]) {
  const [start, end] = window;
  const buckets = Array.from({ length: Math.ceil(Math.max(0, end - start) / 6000) }, (_, i) => ({
    start: start + i * 6000, end: Math.min(end, start + (i + 1) * 6000), kills: 0,
  }));
  const me = fold(name);
  for (const k of kills) {
    if (k.t < start || k.t >= end || fold(k.killer) !== me || fold(k.killed) === me) continue;
    buckets[Math.floor((k.t - start) / 6000)].kills++;
  }
  return buckets;
}
