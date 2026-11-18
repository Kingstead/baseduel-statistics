// A match's board, as the bots draw it (PyCore pubduel/board.py:
// scoreboard_items, neobot_items, highlight_lines, _marker_key), so a board
// here and !bdmatch in game show the same numbers. Pure: rows in, cells out.

import type { NeobotLineRow, NeobotPlayerRow, PlayerRow, ReplayHighlight, ReplayMoment, RoundRow } from "./data";
import { duration, fold, pyFixed, pySum, rating, timeShare } from "./format";

// The bots' columns. Kills and deaths are K and D: players read the league
// board's W and L as wins and losses (the pub bot renamed them 2026-10-22),
// so the site uses K and D for both.
export const SB_COLS = ["ST", "K", "D", "TK", "KS", "KS#", "KSE", "R", "KPM",
  "Time", "DG", "DT", "Att", "AtBy", "Rep", "Brst"];
export const NEOBOT_COLS = ["K", "D", "TK", "R", "KPM", "Time", "DG", "DT",
  "AtBy", "Rep", "Brst", "Grns"];

/** The columns in their families, as <colgroup>s (Claude Design, 2026-11-05):
 * a hairline marks where each family starts, and the headline columns (ST,
 * R and KPM) are `lead`. The spans add up to the columns above. */
export interface ColGroup { cls: string; span: number; lead?: boolean }
export const SB_GROUPS: ColGroup[] = [
  { cls: "g-score", span: 1, lead: true }, { cls: "g-fight", span: 3 },
  { cls: "g-streak", span: 3 }, { cls: "g-rate", span: 2, lead: true },
  { cls: "g-time", span: 1 }, { cls: "g-damage", span: 2 },
  { cls: "g-attach", span: 2 }, { cls: "g-items", span: 2 },
];
export const NEOBOT_GROUPS: ColGroup[] = [
  { cls: "g-fight", span: 3 }, { cls: "g-rate", span: 2, lead: true },
  { cls: "g-time", span: 1 }, { cls: "g-damage", span: 2 },
  { cls: "g-attach", span: 1 }, { cls: "g-items", span: 3 },
];

export const COL_HELP: Record<string, string> = {
  ST: "Safe touches that scored a point",
  K: "Kills",
  D: "Deaths",
  TK: "Team kills",
  KS: "Longest kill streak (the team's is its best)",
  "KS#": "Kill streaks of 10+ reached",
  KSE: "Enemy streaks of 10+ ended",
  R: "Rating: (kills − team kills) / (deaths + 1)",
  KPM: "Kills per minute on the field",
  Time: "Time on the field, and its share of the match",
  DG: "Damage given",
  DT: "Damage taken",
  Att: "Attaches to a team-mate",
  AtBy: "Times attached to",
  Rep: "Repels fired",
  Brst: "Bursts fired",
  Grns: "Greens picked up (recorded in earlier matches only)",
};

export type Cell = string | number;

export interface BoardRow {
  name: string;
  /** S left the fight, D left the arena, N no result. */
  marker: string | null;
  /** Neobot's (name): played on this freq and left it before the end. */
  leftEarly?: boolean;
  cells: Cell[];
}

export interface BoardGroup {
  freq: number;
  label: string;
  captain: string | null;
  verdict: "Winner" | "Loser" | null;
  rows: BoardRow[];
  team: BoardRow | null;
}

export type BoardSortDirection = "ascending" | "descending";

function boardSortValue(cell: Cell): number | null {
  if (cell === "-") return null;
  if (typeof cell === "number") return cell;
  const time = /^(\d+):(\d{2}) \(\d+%\)$/.exec(cell);
  if (time) return Number(time[1]) * 60 + Number(time[2]);
  const value = Number(cell);
  if (cell.trim() === "" || !Number.isFinite(value)) throw new Error(`Unsortable scoreboard value: ${cell}`);
  return value;
}

/** Column -1 is Player. Time sorts by elapsed seconds, not its percentage;
 * untracked cells stay last in either direction. */
export function sortBoardRows(rows: BoardRow[], column: number, direction: BoardSortDirection): BoardRow[] {
  const sign = direction === "ascending" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const names = cmp(fold(a.name), fold(b.name));
    if (column === -1) return sign * names;
    const av = boardSortValue(a.cells[column]), bv = boardSortValue(b.cells[column]);
    if (av == null && bv != null) return 1;
    if (av != null && bv == null) return -1;
    return sign * ((av ?? 0) - (bv ?? 0)) || names;
  });
}

const n = (v: number | null | undefined) => v || 0;
const kpm = (k: number, act: number) => (act >= 1.0 ? pyFixed(k / (act / 60.0), 2) : "-");
/** The KPM a player's match list shows for one of their rows: the board's
 * cell, from the same two figures. */
export const rowKpm = (r: { kills: number; active_time: number }) => kpm(r.kills, r.active_time);

function freqOrder(freqs: Iterable<number>, winner: number | null): number[] {
  return [...new Set(freqs)].sort((a, b) =>
    (a === winner ? 0 : 1) - (b === winner ? 0 : 1) || a - b);
}

function byKills<T extends { kills: number; deaths: number; player_name: string }>(rs: T[]): T[] {
  return [...rs].sort((a, b) =>
    n(b.kills) - n(a.kills) || n(a.deaths) - n(b.deaths) ||
    cmp(a.player_name.toLowerCase(), b.player_name.toLowerCase()));
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** The pub bot's and the league bot's board: scoreboard_items. */
export function ownBoard(records: PlayerRow[], winner: number | null, played: number,
                         teamNames: Map<number, string>): BoardGroup[] {
  const byFreq = new Map<number, PlayerRow[]>();
  for (const r of records) {
    if (!byFreq.has(r.freq)) byFreq.set(r.freq, []);
    byFreq.get(r.freq)!.push(r);
  }
  return freqOrder([...teamNames.keys(), ...byFreq.keys()], winner).map((f) => {
    const members = byKills(byFreq.get(f) || []);
    const tot = new Array(13).fill(0);
    let tks = 0;
    let tact = 0;
    const rowsOut = members.map((r) => {
      const k = n(r.kills), d = n(r.deaths), tk = n(r.teamkills);
      const ks = n(r.best_streak), act = n(r.active_time);
      const vals = [n(r.safe_touches), k, d, tk, ks, n(r.streaks), n(r.streak_ends),
        n(r.dmg_given), n(r.dmg_taken), n(r.attaches), n(r.attached_to), n(r.reps), n(r.bursts)];
      vals.forEach((v, i) => (tot[i] += v));
      tks = Math.max(tks, ks);
      tact += act;
      const marker = r.no_result ? "N" : r.exit_kind || null;
      return {
        name: r.player_name,
        marker,
        cells: [...vals.slice(0, 7), pyFixed((k - tk) / (d + 1), 2), kpm(k, act),
          timeShare(act, played), ...vals.slice(7)],
      };
    });
    let team: BoardRow | null = null;
    if (members.length > 1) {
      const [k, d, tk] = [tot[1], tot[2], tot[3]];
      team = {
        name: "Team", marker: null,
        cells: [tot[0], k, d, tk, tks, tot[5], tot[6], pyFixed((k - tk) / (d + 1), 2),
          kpm(k, tact), timeShare(tact, played * members.length), ...tot.slice(7, 13)],
      };
    }
    return {
      freq: f,
      label: teamNames.get(f) || `Freq ${f}`,
      captain: members.find((r) => r.is_captain)?.player_name ?? null,
      verdict: winner == null ? null : f === winner ? "Winner" : "Loser",
      rows: rowsOut,
      team,
    };
  });
}

const dash = (v: number | null) => (v == null ? "-" : v);

function neobotCells(r: {
  kills: number; deaths: number; teamkills: number | null; active_time: number;
  dmg_given: number; dmg_taken: number; attached_to: number | null; reps: number;
  bursts: number; greens: number | null;
}, shareOf: number): Cell[] {
  const k = r.kills, d = r.deaths, act = r.active_time;
  return [k, d, dash(r.teamkills), pyFixed((k - (r.teamkills || 0)) / (d + 1), 2),
    kpm(k, act), timeShare(act, shareOf), r.dmg_given, r.dmg_taken,
    dash(r.attached_to), r.reps, r.bursts, dash(r.greens)];
}

type Summable = "kills" | "deaths" | "teamkills" | "active_time" | "dmg_given" |
  "dmg_taken" | "attached_to" | "reps" | "bursts" | "greens";

/** neobot_items: every row of the old bot's screen, in brackets on a freq
 * the player left, with each player's marker on the row they finished on. */
export function neobotBoard(lines: NeobotLineRow[], players: NeobotPlayerRow[],
                            winner: number | null, played: number): BoardGroup[] {
  const finished = new Map<string, number>();
  for (const r of lines) if (!r.left_early) finished.set(r.player_name.toLowerCase(), r.freq);
  const marks = new Map<string, string>();
  for (const p of players) {
    const kind = p.no_result ? "N" : p.exit_kind;
    if (kind) {
      const l = p.player_name.toLowerCase();
      marks.set(`${l}\u0000${finished.get(l) ?? p.freq}`, kind);
    }
  }
  const byFreq = new Map<number, NeobotLineRow[]>([[0, []], [1, []]]);
  for (const r of lines) {
    if (!byFreq.has(r.freq)) byFreq.set(r.freq, []);
    byFreq.get(r.freq)!.push(r);
  }
  return freqOrder(byFreq.keys(), winner).map((f) => {
    const members = byKills(byFreq.get(f)!);
    let team: BoardRow | null = null;
    if (members.length > 1) {
      // _neobot_team adds with sum(), so these must too.
      const sum = (c: Summable) => {
        const got = members.map((r) => r[c]).filter((v): v is number => v != null);
        return got.length ? pySum(got) : null;
      };
      team = {
        name: "Team", marker: null,
        cells: neobotCells({
          kills: sum("kills")!, deaths: sum("deaths")!, teamkills: sum("teamkills"),
          active_time: sum("active_time")!, dmg_given: sum("dmg_given")!,
          dmg_taken: sum("dmg_taken")!, attached_to: sum("attached_to"), reps: sum("reps")!,
          bursts: sum("bursts")!, greens: sum("greens"),
        }, played * members.length),
      };
    }
    return {
      freq: f,
      label: `Freq ${f}`,
      captain: null,
      verdict: winner == null ? null : f === winner ? "Winner" : "Loser",
      rows: members.map((r) => ({
        name: r.player_name,
        leftEarly: !!r.left_early,
        marker: marks.get(`${r.player_name.toLowerCase()}\u0000${f}`) ?? null,
        cells: neobotCells(r, played),
      })),
      team,
    };
  });
}

export const HIGHLIGHT_GROUPS = ["Score & time", "Kills", "Deaths", "Damage", "Teamwork", "Items", "Movement"] as const;
export type HighlightGroup = typeof HIGHLIGHT_GROUPS[number];

export interface Highlight extends Omit<ReplayHighlight, "group"> {
  group: HighlightGroup;
}

const HIGHLIGHT_MAX_NAMES = 3;

export function highlightLeaders<T extends { player_name: string }>(
  group: HighlightGroup, label: string, records: T[], value: (r: T) => number | null,
  show: (v: number) => string = String, includeNonPositive = false,
): Highlight | null {
  if (!records.length) return null;
  const scores = records.map((r) => ({ name: r.player_name, raw: value(r) }));
  const best = Math.max(...scores.map((r) => r.raw ?? 0));
  if (!includeNonPositive && best <= 0) return null;
  const disp = show(best);
  const leaders = scores.filter((r) => show(r.raw ?? 0) === disp).map((r) => r.name)
    .sort((a, b) => cmp(a.toLowerCase(), b.toLowerCase()));
  const ranking = scores.sort((a, b) => {
    if (a.raw == null && b.raw != null) return 1;
    if (a.raw != null && b.raw == null) return -1;
    return (b.raw ?? 0) - (a.raw ?? 0) || cmp(a.name.toLowerCase(), b.name.toLowerCase());
  }).map((r) => ({ name: r.name, value: r.raw == null ? null : show(r.raw) }));
  return {
    group, label, value: disp,
    names: leaders.slice(0, HIGHLIGHT_MAX_NAMES),
    more: Math.max(0, leaders.length - HIGHLIGHT_MAX_NAMES),
    ranking,
  };
}

type HighlightField = Exclude<keyof PlayerRow, "player_name" | "team" | "exit_kind">;
export type HighlightRecord = { player_name: string } & Partial<Record<HighlightField, number | null>>;

function fmtTime(secs: number): string {
  const s = Math.floor(Math.max(0, secs));
  const m = Math.floor(s / 60);
  return m ? `${m}m ${String(s % 60).padStart(2, "0")}s` : `${s % 60}s`;
}

/** highlight_lines: the leader in each category; a tie shares the line. */
export function highlights(records: HighlightRecord[], streakEnds?: Record<string, ReplayMoment[]>): Highlight[] {
  if (!records.length) return [];
  const col = (key: HighlightField) => (r: HighlightRecord) => r[key] ?? null;
  const cats: [HighlightGroup, string, (r: HighlightRecord) => number | null, (v: number) => string][] = [
    ["Score & time", "Highest rated", (r) => rating(Number(r.kills || 0), Number(r.teamkills || 0), Number(r.deaths || 0)), (v) => pyFixed(v, 2)],
    ["Kills", "Most kills", col("kills"), String],
    ["Deaths", "Most deaths", col("deaths"), String],
    ["Kills", "Most team kills", col("teamkills"), String],
    ["Kills", "Best kill streak", col("best_streak"), String],
    ["Kills", "Most kill streaks", col("streaks"), String],
    ["Kills", "Most streaks ended", col("streak_ends"), String],
    ["Score & time", "Most safe touches", col("safe_touches"), String],
    ["Damage", "Most damage given", col("dmg_given"), String],
    ["Damage", "Most damage taken", col("dmg_taken"), String],
    ["Teamwork", "Most attaches", col("attaches"), String],
    ["Teamwork", "Most attached to", col("attached_to"), String],
    ["Items", "Most repels fired", col("reps"), String],
    ["Items", "Most bursts fired", col("bursts"), String],
    ["Score & time", "Highest bounty", col("max_bounty"), String],
    ["Score & time", "Most field time", col("active_time"), fmtTime],
  ];
  const out: Highlight[] = [];
  for (const [group, label, value, show] of cats) {
    const h = highlightLeaders(group, label, records, value, show, label === "Highest rated");
    if (h && label === "Most streaks ended" && streakEnds) {
      h.ranking = h.ranking.map((r) => ({ ...r, moments: streakEnds[fold(r.name)] }));
      h.description = "Values are the bot's scoreboard totals. Replay links show reconstructed enemy " +
        "streaks of 10+ ended during the whole recording and may not match those totals. " +
        "Each link starts 5 seconds before the ending kill and follows the player who ended the streak.";
    }
    if (h) out.push(h);
  }
  return out;
}

/** _marker_key: only when someone left or has no result. */
export function markerKey(records: { no_result?: number; exit_kind?: string | null }[],
                          winner: number | null): string | null {
  const noResult = records.some((r) => r.no_result);
  if (!noResult && !records.some((r) => r.exit_kind)) return null;
  return "*S left the fight, *D left the arena" +
    (winner != null ? " (either is a loss)" : "") +
    (noResult ? ", *N no result" : "");
}

/** How a round ended, in words. */
export function roundHow(r: RoundRow): string {
  switch (r.ended_by) {
    case "touch": return r.scorer_name ? `Touch by ${r.scorer_name}` : "Touch";
    case "wipe": return "Wipe";
    case "timeout": return "Time ran out";
    case "nextbase": return "Skipped (!nextbase)";
    case "hold": return "Timeout called";
    case "setscore": return "Score set by an official";
    case "restart": return "Restarted";
    case "abort": return "Match ended";
    default: return r.ended_by;
  }
}

export function roundLabel(r: RoundRow): string {
  return `R${r.round_no}${r.attempt === 1 ? "" : "." + r.attempt}`;
}

export const LEGEND: string[] = [
  "R = rating: (kills − team kills) / (deaths + 1). KPM = kills per minute on the field.",
  "Time = time on the field, and its share of the match. Team = the team's totals; its KS is its best streak.",
  "*S = left the fight. *D = left the arena. Either is a loss.",
  "*N = no result: under a minute of active play, switched sides, or taken off by a captain, an official or .setup.",
  "Touches count only rounds won by reaching the safe; a round won by a wipe has no scorer.",
];

export { duration };
