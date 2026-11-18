// The site's data, as the exporter writes it under /data/. Every file is
// fetched once a page load; a table's columns arrive once, not per row.

export interface Table {
  cols: string[];
  rows: unknown[][];
}

export function rows<T>(t: Table | null | undefined): T[] {
  if (!t) return [];
  return t.rows.map((r) => {
    const o: Record<string, unknown> = {};
    t.cols.forEach((c, i) => (o[c] = r[i]));
    return o as T;
  });
}

export type Section = "pub" | "league";

export interface Meta {
  version: number;
  built: number;
  sections: Record<Section, {
    /** Matches the site counts: the league's leave out those nobody won. */
    matches: number; first_started: number | null; first_id: number | null; last_id: number | null;
    last_ended: number | null; bucket: number; recent: Table;
    /** Whether a match nobody won counts beyond the matches list: false for
     * the league (exporter/export.py Section.unfinished). */
    unfinished: boolean;
  }>;
  neobot: { games: number; first_id: number; last_id: number; bucket: number } | null;
  players: number;
  league_exclude: string[];
}

export interface PlayerIndexRow {
  key: string;
  name: string;
  pub_bot: boolean;
  league_bot: boolean;
  pub_matches: number;
  pub_played: number;
  league_matches: number;
  league_played: number;
  last_seen: number | null;
  /** Each section's first match, an earlier game if they played one. */
  pub_first: number | null;
  league_first: number | null;
}

/** A career as get_player_career returns it. null: not tracked. */
export interface Career {
  matches: number;
  wins: number;
  no_results: number;
  captained: number | null;
  best_streak: number | null;
  safe_touches: number | null;
  kills: number;
  deaths: number;
  teamkills: number | null;
  streaks: number | null;
  streak_ends: number | null;
  dmg_given: number;
  dmg_taken: number;
  attaches: number | null;
  attached_to: number | null;
  reps: number;
  bursts: number;
  active_time: number;
  rounds: number;
  rounds_won: number;
  player_name: string;
  last_team: string | null;
  last_match_id: number | null;
  neobot_matches: number | null;
}

export interface HistoryRow {
  id: number;
  started_at: number | null;
  mode: string;
  game_mode: string | null;
  arena: string | null;
  freq: number;
  team: string;
  result: "W" | "L" | "N" | "-";
  score_for: number;
  score_against: number;
  is_captain: number;
  exit_kind: string | null;
  safe_touches: number;
  kills: number;
  deaths: number;
  teamkills: number;
  best_streak: number;
  dmg_given: number;
  dmg_taken: number;
  attaches: number;
  attached_to: number;
  reps: number;
  bursts: number;
  active_time: number;
}

export interface NeobotHistoryRow {
  id: number;
  freq: number;
  result: "W" | "L" | "N" | "-";
  score_for: number;
  score_against: number;
  exit_kind: string | null;
  kills: number;
  deaths: number;
  teamkills: number | null;
  dmg_given: number;
  dmg_taken: number;
  attached_to: number | null;
  reps: number;
  bursts: number;
  greens: number | null;
  active_time: number;
  freqs_played: string | null;
}

export interface PlayerSection {
  name: string;
  bot: boolean;
  careers: Record<string, Career | null>;
  matches: Table;
  neobot?: Table;
  /** exporter/mates.py: by the page's buttons, the people played most with
   * and against, as [key, matches, wins, losses], most matches first. */
  mates?: Record<string, { with: MateRow[]; against: MateRow[] }>;
  /** exporter/ratings.py: over every decided match of the section, people
   * only; null for a bot or a player with no win or loss. */
  rating?: PlayerRating | null;
}
export type MateRow = [string, number, number, number];

export interface PlayerRating {
  rating: number;
  rank: number;
  of: number;
  matches: number;
  wins: number;
  /** Where everyone starts. */
  start: number;
  /** [match id, the rating after it], in the order played. */
  history: [number, number][];
}

export interface PlayerDoc {
  key: string;
  name: string;
  pub?: PlayerSection;
  league?: PlayerSection;
}

export interface MatchRow {
  id: number;
  mode: string;
  game_mode: string | null;
  game_mode_freq: number | null;
  game_mode_until: number | null;
  game_mode_end: string | null;
  arena: string | null;
  team_a: string;
  team_b: string;
  target: number;
  winby: number;
  team_size: number;
  time_limit: number | null;
  score_a: number;
  score_b: number;
  winner_freq: number | null;
  outcome: string;
  started_at: number | null;
  ended_at: number | null;
  held_seconds: number;
  dead_seconds: number;
  played_seconds: number;
  rounds_counted: number;
  players?: number;
  replay: string | null;
}

/** A bd_match_players row, or a bd_round_players one (some keys absent). */
export interface PlayerRow {
  player_name: string;
  team: string;
  freq: number;
  is_captain?: number;
  is_winner: number;
  no_result?: number;
  exit_kind?: string | null;
  safe_touches: number;
  kills: number;
  deaths: number;
  teamkills: number;
  best_streak?: number;
  streaks: number;
  streak_ends: number;
  dmg_given: number;
  dmg_taken: number;
  attaches: number;
  attached_to: number;
  reps: number;
  bursts: number;
  max_bounty?: number;
  active_time: number;
  seq?: number;
}

export interface RoundRow {
  seq: number;
  round_no: number;
  attempt: number;
  counted: number;
  base_num: number | null;
  winner_freq: number | null;
  ended_by: string;
  scorer_name: string | null;
  score_a: number;
  score_b: number;
  started_at: number | null;
  ended_at: number | null;
  duration_s: number;
}

/** One round's base control, from its replay (web/tools/control.mjs, by
 * ss-replay's own code): freq 0's Held percent as the replay's dashboard
 * shows it, and freq 0's share once a second, null where no base was played. */
export interface ControlRound {
  seq: number;
  held: number | null;
  shares: (number | null)[];
}

/** A league match's chat, from its replay (web/tools/chat.mjs): every line
 * as the recording kept it, public chat and the spectators' team chat, and the
 * replay's rounds to place them in. Times are ticks (1/100 s) from the
 * recording's start. A round's seq is null when the database has no row for
 * it; its end is null when it never closed. */
export interface ChatRound {
  seq: number | null;
  round: number;
  attempt: number;
  base: number;
  start: number;
  end: number | null;
}
/** [t, name (null: no sender), 1 = spectators' team chat, text] */
export type ChatLine = [number, string | null, 0 | 1, string];
export interface ChatDoc {
  end: number | null;
  rounds: ChatRound[];
  lines: ChatLine[];
}

export interface ReplayKill {
  t: number;
  killer: string;
  killed: string;
  weapon: string;
  teamKill: boolean;
  killerFreq: number;
  killedFreq: number;
}
export interface ReplayPlayer {
  player: number;
  name: string;
  shots: Record<string, number>;
}
/** Recording ticks; start includes a short lead-in before the event. */
export interface ReplayMoment {
  start: number;
  end: number;
  label?: string;
}
export interface ReplayHighlight {
  group: "Kills" | "Deaths" | "Movement";
  label: string;
  value: string;
  names: string[];
  more: number;
  description?: string;
  ranking: {
    name: string;
    value: string | null;
    run?: { start: number; end: number; seconds: number };
    moments?: ReplayMoment[];
  }[];
}
/** Replay stats embedded by the exporter; the page never fetches ss-replay. */
export interface ReplayStats {
  end: number;
  players: ReplayPlayer[];
  kills: ReplayKill[];
  breakdowns: Record<string, PlayerKillBreakdown>;
  highlights: ReplayHighlight[];
  streakEnds?: Record<string, ReplayMoment[]>;
}
export interface PlayerKillBreakdown {
  killed: Versus[];
  killedBy: Versus[];
  teamKilled: Versus[];
  teamKilledBy: Versus[];
  kills: number;
  deaths: number;
  weaponsOut: Record<string, number>;
  weaponsIn: Record<string, number>;
}
export interface Versus {
  name: string;
  freq: number;
  n: number;
  weapons: Record<string, number>;
}

export interface MatchDoc {
  match: MatchRow;
  players: Table;
  rounds: Table;
  round_players: Table;
  /** League matches with a replay only. */
  control?: { rounds: ControlRound[]; highlights?: ReplayHighlight[] };
  /** League matches whose replay holds any chat. */
  chat?: ChatDoc;
  /** Published league replay stats, read and prepared by the exporter. */
  stats?: ReplayStats;
}

export interface NeobotMatchRow {
  neobot_id: number;
  history_id: string;
  score_a: number;
  score_b: number;
  winner_freq: number | null;
  outcome: string;
  active_seconds: number;
  partial_stats: number;
  players?: number;
}

export interface NeobotPlayerRow {
  player_name: string;
  freq: number;
  is_winner: number;
  no_result: number;
  exit_kind: string | null;
  kills: number;
  deaths: number;
  teamkills: number | null;
  team_deaths: number | null;
  dmg_given: number;
  dmg_taken: number;
  attached_to: number | null;
  reps: number;
  bursts: number;
  greens: number | null;
  active_time: number;
  freqs_played: string | null;
}

export interface NeobotLineRow {
  line_no: number;
  player_name: string;
  freq: number;
  left_early: number;
  kills: number;
  deaths: number;
  teamkills: number | null;
  team_deaths: number | null;
  dmg_given: number;
  dmg_taken: number;
  attached_to: number | null;
  reps: number;
  bursts: number;
  greens: number | null;
  active_time: number;
}

export interface NeobotDoc {
  match: NeobotMatchRow;
  players: Table;
  lines: Table;
}

export interface Facts {
  matches: Table;
  players: Table;
}

const cache = new Map<string, Promise<unknown>>();

/** One file, fetched once. null when it is not there. */
export function load<T>(path: string): Promise<T | null> {
  let p = cache.get(path) as Promise<T | null> | undefined;
  if (!p) {
    p = fetch(`/data/${path}`).then((r) => {
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
      const type = r.headers.get("content-type") || "";
      // A dev server or SPA fallback answers a missing file with the page.
      if (!type.includes("json")) return null;
      return r.json() as Promise<T>;
    });
    p.catch(() => cache.delete(path));
    cache.set(path, p);
  }
  return p;
}

export const getMeta = () => load<Meta>("meta.json");

/** insights.json (exporter/insights.py): [decided, won] pairs and the like. */
export interface InsightsDoc {
  /** Freq 0's wins by block of earlier matches, then today's pub matches:
   * [first id, last id, decided, freq 0 won]. */
  eras: [number, number, number, number][];
  block: number;
  gap_max: number;
  sides: Record<"earlier" | "pub" | "private" | "league", [number, number]>;
  /** [people on freq 0 less freq 1, decided, freq 0 won]. */
  gap: Record<"earlier" | "pub", [number, number, number][]>;
  /** [decided, freq 0 had more people, freq 1 had more]. */
  more: Record<"earlier" | "pub", [number, number, number]>;
  /** One team had no person: [decided, the people won]. */
  vs_bots: Record<"earlier" | "pub", [number, number]>;
  /** [kills, deaths, field seconds]. */
  play: Record<"earlier" | "pub", Record<"people" | "bots", [number, number, number]>>;
  hard: { matches: number; decided: number; team_won: number; ended_early: number;
          team_points: number; other_points: number; first: number | null };
}
export const getInsights = () => load<InsightsDoc>("insights.json");

export interface PlayerIndex {
  list: PlayerIndexRow[];
  byFold: Map<string, PlayerIndexRow>;
  byKey: Map<string, PlayerIndexRow>;
}

let index: Promise<PlayerIndex> | null = null;
export function getPlayers(): Promise<PlayerIndex> {
  if (!index) {
    index = load<Table>("players.json").then((t) => {
      const list = rows<PlayerIndexRow>(t);
      const byFold = new Map<string, PlayerIndexRow>();
      const byKey = new Map<string, PlayerIndexRow>();
      for (const p of list) {
        byFold.set(p.name.replace(/[A-Z]/g, (c) => c.toLowerCase()), p);
        byKey.set(p.key, p);
      }
      return { list, byFold, byKey };
    });
  }
  return index;
}

export const getPlayer = (key: string) => load<PlayerDoc>(`p/${key}.json`);

/** One line of a records list (exporter/records.py): a player's best in a
 * match or run, or a match's or round's own. */
export interface RecordEntry {
  value: number;
  key?: string;
  match?: number;
  at?: number | null;
  earlier?: boolean;
  from?: number;
  to?: number;
  winner?: string | null;
  final?: [number, number];
  low?: [number, number];
  round?: string;
  base_num?: number | null;
  won_by?: string | null;
}
export interface RecordLists { all: RecordEntry[]; people: RecordEntry[] }
export interface RecordsDoc {
  top: number;
  kills: RecordLists;
  dmg_given: RecordLists;
  best_streak: RecordLists;
  safe_touches: RecordLists;
  winning_run: RecordLists;
  longest_match: RecordEntry[];
  most_rounds: RecordEntry[];
  comeback: RecordEntry[];
  longest_round: RecordEntry[];
}
export const getRecords = (section: Section) => load<RecordsDoc>(`records/${section}.json`);
export const getFacts = (section: Section) => load<Facts>(`facts/${section}.json`);
/** ratings/<section>.json: everyone rated, best first. */
export interface RatingBoard extends Table {
  start: number;
}
export const getRatings = (section: Section) => load<RatingBoard>(`ratings/${section}.json`);
export const getNeobotIndex = () => load<Table>("neobot/index.json");

export async function getMatch(section: Section, id: number): Promise<MatchDoc | null> {
  const meta = await getMeta();
  const bucket = meta ? meta.sections[section].bucket : 10;
  const shard = await load<Record<string, MatchDoc>>(`m/${section}/${Math.floor(id / bucket)}.json`);
  return shard ? shard[String(id)] ?? null : null;
}

export async function getNeobotMatch(id: number): Promise<NeobotDoc | null> {
  const meta = await getMeta();
  if (!meta || !meta.neobot) return null;
  const shard = await load<Record<string, NeobotDoc>>(
    `m/neobot/${Math.floor(id / meta.neobot.bucket)}.json`);
  return shard ? shard[String(id)] ?? null : null;
}

/** Is this number one of Neobot's? The pub bot's and Neobot's games share
 * one series of numbers, Neobot's first. */
export function isNeobotId(meta: Meta | null, id: number): boolean {
  return !!meta?.neobot && id >= meta.neobot.first_id && id <= meta.neobot.last_id;
}
