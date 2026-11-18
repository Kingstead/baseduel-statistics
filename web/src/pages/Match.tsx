import { useEffect, useRef, useState } from "preact/hooks";
import { LineChart, niceTicks, type Series } from "../charts";
import {
  BoardGroup, COL_HELP, HIGHLIGHT_GROUPS, highlights, LEGEND, markerKey, NEOBOT_COLS, NEOBOT_GROUPS, neobotBoard,
  ownBoard, roundHow, roundLabel, SB_COLS, SB_GROUPS, sortBoardRows, type BoardSortDirection,
  type Cell, type ColGroup, type Highlight, type HighlightRecord,
} from "../board";
import {
  getMatch, getMeta, getNeobotMatch, isNeobotId, rows, type ChatDoc, type ControlRound, type MatchDoc, type NeobotDoc,
  type NeobotLineRow, type NeobotPlayerRow, type PlayerRow, type ReplayMoment, type RoundRow, type Section,
} from "../data";
import { chatCounts, chatTimeline } from "../chat";
import { dateTime, duration, fold, num } from "../format";
import { freqsOf, kindLabel, modeLine, outcomeWord, teamNames } from "../matchinfo";
import { MatchPlayerModal } from "../MatchPlayerModal";
import { playerHref } from "../router";
import { Loading, Modal, Pills, Problem, Team, useLoad, useTitle } from "../ui";

export function Match({ section, id }: { section: Section; id: number }) {
  const [got, error] = useLoad(async () => {
    const meta = await getMeta();
    if (section === "pub" && isNeobotId(meta, id)) {
      return { neobot: await getNeobotMatch(id) };
    }
    return { own: await getMatch(section, id) };
  }, [section, id]);
  useTitle(section === "league" ? `League match ${id}` : `Match ${id}`);
  if (error) return <Problem error={error} />;
  if (!got) return <Loading />;
  if (got.neobot) return <NeobotGame id={id} doc={got.neobot} />;
  if (got.own) return <OwnMatch section={section} doc={got.own} />;
  return (
    <section class="card">
      <h1>No {section === "league" ? "league " : ""}match {id}</h1>
      <p class="muted">There is no match with that number. A match that has just ended
        shows here a few minutes later.</p>
      <p><a href={`/matches?s=${section}`}>All matches →</a></p>
    </section>
  );
}

function ScoreBanner({ names, fa, fb, a, b, winner, how }: {
  names: Map<number, string>; fa: number; fb: number; a: number; b: number;
  winner: number | null; how: string;
}) {
  const side = (f: number, score: number, s: "a" | "b") => (
    <div class={`banner-side ${winner == null ? "" : winner === f ? "won" : "lost"}`}>
      <Team side={s}><span class="banner-name">{names.get(f)}</span></Team>
      <span class="banner-score">{score}</span>
      {winner === f && <span class="banner-tag">{how}</span>}
    </div>
  );
  return (
    <div class="banner">
      {side(fa, a, "a")}
      <span class="banner-dash" aria-hidden="true">–</span>
      {side(fb, b, "b")}
    </div>
  );
}

/** How the winner won, as the Discord card's final says it. At the whistle
 * the leader wins and the live round is closed as "timeout"; level at the
 * whistle is sudden death, so a winner past the limit otherwise won in it. */
function howWon(m: MatchDoc["match"], rounds: RoundRow[]): string {
  if (m.outcome === "forfeit") return "won by forfeit";
  if (!m.time_limit) return "won";
  const last = [...rounds].reverse().find((r) => r.counted);
  if (last?.ended_by === "timeout") return "won on time";
  return m.played_seconds > m.time_limit ? "won in sudden death" : "won";
}

function OwnMatch({ section, doc }: { section: Section; doc: MatchDoc }) {
  const m = doc.match;
  const players = rows<PlayerRow>(doc.players);
  const rounds = rows<RoundRow>(doc.rounds);
  const roundPlayers = rows<PlayerRow>(doc.round_players);
  const [fa, fb] = freqsOf(m.mode, players.map((p) => p.freq));
  const names = teamNames(section, m, players.map((p) => p.freq));
  const groups = ownBoard(players, m.winner_freq, m.played_seconds, names);
  const counted = rounds.filter((r) => r.counted).length;
  const caps = [...players].sort((x, y) => x.freq - y.freq).filter((p) => p.is_captain).map((p) => p.player_name);
  const mode = modeLine(m);
  const [stat, setStat] = useState<{ name: string; column: string; value: Cell } | null>(null);
  return (
    <>
      <header class="page-head">
        <p class="eyebrow">{section === "league" ? "League match" : "Match"} {m.id} · {kindLabel(m.mode)}{m.arena ? ` · ${m.arena}` : ""}</p>
        <ScoreBanner names={names} fa={fa} fb={fb} a={m.score_a} b={m.score_b}
                     winner={m.winner_freq} how={howWon(m, rounds)} />
        <ul class="facts">
          <li>{dateTime(m.started_at)}</li>
          <li>{duration(m.played_seconds)} played</li>
          <li>First to {m.target}, win by {m.winby}{m.time_limit ? `, ${Math.floor(m.time_limit / 60)}-minute limit` : ""}</li>
          <li>{counted} round{counted === 1 ? "" : "s"}</li>
          {caps.length > 0 && <li>Captains {caps.join(" / ")}</li>}
          {m.winner_freq == null && <li class="warn">No result ({outcomeWord(m.outcome)})</li>}
          {mode && <li>{mode}</li>}
        </ul>
        {m.replay && <p><a class="button" href={m.replay} target="_blank" rel="noopener">▶ Watch the replay</a></p>}
      </header>

      {players.length > 0 && (
        <section class="card">
          <Board heading="Scoreboard" cols={SB_COLS} colGroups={SB_GROUPS} groups={groups}
                 onStat={doc.stats ? (name, column, value) => setStat({ name, column, value }) : undefined} />
          <BoardNotes keyLine={markerKey(players, m.winner_freq)} />
        </section>
      )}
      {stat && doc.stats && (
        <MatchPlayerModal key={`${stat.name}:${stat.column}`} name={stat.name} column={stat.column} value={stat.value}
                          stats={doc.stats} rounds={doc.chat?.rounds} fa={fa}
                          row={players.find((p) => fold(p.player_name) === fold(stat.name))}
                          onClose={() => setStat(null)} />
      )}
      {players.length > 0 && <Highlights records={players}
        replayHighlights={[...(doc.stats?.highlights ?? []), ...(doc.control?.highlights ?? [])]}
        streakEnds={doc.stats?.streakEnds} replay={m.replay} />}
      <Rounds rounds={rounds} names={names} fa={fa} roundPlayers={roundPlayers} control={doc.control?.rounds} />
      {doc.chat && <Chat chat={doc.chat} rounds={rounds} names={names} fa={fa} replay={m.replay} />}
    </>
  );
}

/** Both teams in one table, as the bots' board is one box, so the columns
 * line up from one team to the other. Winner first. */
/** Comfortable or Compact (Claude Design's idea 6): Compact tightens the
 * board's rows and type so a ten-a-side board fits a laptop. The choice is
 * the viewer's own, kept in this browser for every board. */
type Density = "comfortable" | "compact";
const DENSITY_KEY = "bd-stats.board-density";

function useDensity(): [Density, (d: Density) => void] {
  const [d, setD] = useState<Density>(() => {
    try { return localStorage.getItem(DENSITY_KEY) === "compact" ? "compact" : "comfortable"; } catch { return "comfortable"; }
  });
  return [d, (v) => {
    setD(v);
    try { localStorage.setItem(DENSITY_KEY, v); } catch { /* private window: this page only */ }
  }];
}

const DETAIL_COLS = new Set(["K", "D", "TK", "KS", "KS#", "KSE", "KPM", "DG", "DT", "Att", "AtBy", "Rep", "Brst"]);

function Board({ heading, cols, colGroups, groups, onStat }: {
  heading: string; cols: string[]; colGroups: ColGroup[]; groups: BoardGroup[];
  onStat?: (name: string, column: string, value: Cell) => void;
}) {
  const [density, setDensity] = useDensity();
  const [sort, setSort] = useState<{ column: number; direction: BoardSortDirection } | null>(null);
  const changeSort = (column: number) => setSort((current) => ({
    column,
    direction: current?.column === column
      ? current.direction === "ascending" ? "descending" : "ascending"
      : column === -1 ? "ascending" : "descending",
  }));
  const th = (label: string, column: number) => (
    <th scope="col" class={column === -1 ? "name-col" : "n"} title={COL_HELP[label]}
        aria-sort={sort?.column === column ? sort.direction : undefined}>
      <button type="button" class="sort" onClick={() => changeSort(column)}>{label}</button>
    </th>
  );
  // Only when the families cover the columns exactly: a mismatch would draw
  // the hairlines in the wrong places.
  const grouped = colGroups.reduce((n, g) => n + g.span, 0) === cols.length;
  return (
    <>
    <div class="card-head">
      <h2>{heading}</h2>
      <Pills label="Board density" value={density} onChange={setDensity}
             options={[["comfortable", "Comfortable"], ["compact", "Compact"]]} />
    </div>
    <div class="scroll">
      <table class={`data board-table ${density === "compact" ? "compact" : ""}`}>
        {grouped && <colgroup><col /></colgroup>}
        {grouped && colGroups.map((g) => (
          <colgroup class={g.cls}><col class={g.lead ? "lead" : undefined} span={g.span} /></colgroup>
        ))}
        <thead><tr>
          {th("Player", -1)}
          {cols.map((c, i) => th(c, i))}
        </tr></thead>
        {groups.map((g) => (
          <tbody class="board-group">
            <tr class="group-head">
              <th scope="colgroup" colSpan={cols.length + 1}>
                <span class="group-label">
                  {g.verdict && <span class={`verdict verdict-${g.verdict.toLowerCase()}`}>{g.verdict}</span>}
                  <Team side={sideOf(groups, g)}>{g.label}</Team>
                  {g.captain && <span class="muted"> · captain {g.captain}</span>}
                </span>
              </th>
            </tr>
            {g.rows.length === 0 && (
              <tr><td colSpan={cols.length + 1} class="muted">Nobody played for this team.</td></tr>
            )}
            {(sort ? sortBoardRows(g.rows, sort.column, sort.direction) : g.rows).map((r) => (
              <tr>
                <th scope="row" class="name-col">
                  <a href={playerHref(r.name)}>{r.leftEarly ? `(${r.name})` : r.name}</a>
                  {r.marker && <span class="marker" title={MARKERS[r.marker]}> *{r.marker}</span>}
                </th>
                {r.cells.map((c, i) => <td class="n">
                  {onStat && DETAIL_COLS.has(cols[i]) ? (
                    <button class="stat-detail" aria-label={`${r.name}: ${COL_HELP[cols[i]]}`}
                            title={`View ${cols[i]} details for ${r.name}`}
                            onClick={() => onStat(r.name, cols[i], c)}>{fmtCell(c)}</button>
                  ) : fmtCell(c)}
                </td>)}
              </tr>
            ))}
            {g.team && (
              <tr class="team-row">
                <th scope="row" class="name-col">Team</th>
                {g.team.cells.map((c) => <td class="n">{fmtCell(c)}</td>)}
              </tr>
            )}
          </tbody>
        ))}
      </table>
    </div>
    </>
  );
}

/** Orange for the lower freq, blue for the higher, whatever order the
 * board lists them in (winner first). */
function sideOf(groups: BoardGroup[], g: BoardGroup): "a" | "b" {
  const low = Math.min(...groups.map((x) => x.freq));
  return g.freq === low ? "a" : "b";
}

const MARKERS: Record<string, string> = {
  S: "Left the fight", D: "Left the arena", N: "No result",
};

const fmtCell = (c: Cell) => (typeof c === "number" ? num(c) : c);

function BoardNotes({ keyLine, brackets = false }: { keyLine: string | null; brackets?: boolean }) {
  return (
    <div class="board-notes">
      {brackets && <p class="note">A name in brackets played on that freq and left it before the end.</p>}
      {keyLine && <p class="note">{keyLine}.</p>}
      <details>
        <summary>What the columns mean</summary>
        <dl class="legend">
          {Object.entries(COL_HELP).map(([k, v]) => <><dt>{k}</dt><dd>{v}</dd></>)}
        </dl>
        {LEGEND.map((l) => <p class="note">{l}</p>)}
      </details>
    </div>
  );
}

const highlightValue = (v: string) => /^\d+$/.test(v) ? num(Number(v)) : v;
const hasReplayMoments = (h: Highlight) => h.ranking.some((r) => r.run || r.moments?.length);

function HighlightList({ items, replay, onPick }: {
  items: Highlight[]; replay?: string | null; onPick: (h: Highlight) => void;
}) {
  return (
    <dl class="highlights">
      {items.map((h) => (
        <div>
          <dt><button class="highlight-pick" aria-haspopup="dialog"
                      onClick={() => onPick(h)}>{h.label}
            {replay && hasReplayMoments(h) && <span class="highlight-replay"
              title="Replay moments available">Replay</span>}
            <svg class="highlight-open" viewBox="0 0 16 16" aria-hidden="true">
              <path d="m6 3 5 5-5 5" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </button></dt>
          <dd>
            {h.names.map((n, i) => <>{i > 0 && ", "}<a href={playerHref(n)}>{n}</a></>)}
            {h.more > 0 && <span class="muted"> +{h.more} more</span>}
            <span class="hl-value"> {highlightValue(h.value)}</span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Highlights({ records, replayHighlights, streakEnds, replay }: {
  records: HighlightRecord[]; replayHighlights?: Highlight[]; replay?: string | null;
  streakEnds?: Record<string, ReplayMoment[]>;
}) {
  const [picked, setPicked] = useState<Highlight | null>(null);
  const hs = highlights(records, streakEnds);
  if (replayHighlights) hs.push(...replayHighlights);
  if (!hs.length) return null;
  return (
    <section class="card">
      <h2>Highlights</h2>
      {HIGHLIGHT_GROUPS.map((group) => {
        const items = hs.filter((h) => h.group === group);
        return items.length > 0 && <div class="highlight-group">
          <h3>{group}</h3>
          <HighlightList items={items} replay={replay} onPick={setPicked} />
        </div>;
      })}
      {picked && <Modal title={picked.label} onClose={() => setPicked(null)}>
        {picked.description && <p class="chart-note">{picked.description}</p>}
        <p class="chart-note">All players in this match, highest to lowest.</p>
        <div class="scroll">
          <table class="data">
            <thead><tr>
              <th scope="col" class="n">#</th>
              <th scope="col">Player</th>
              <th scope="col" class="n">Value</th>
              {replay && hasReplayMoments(picked) && <th scope="col">Replay</th>}
            </tr></thead>
            <tbody>
              {picked.ranking.map((r, i) => <tr>
                <td class="n">{i + 1}</td>
                <th scope="row"><a href={playerHref(r.name)}>{r.name}</a></th>
                <td class="n">{r.value == null ? <span class="muted">Not tracked</span> : highlightValue(r.value)}</td>
                {replay && hasReplayMoments(picked) && <td>
                  {r.run && replay ? <>
                    <a href={`${replay}?t=${r.run.start / 100}&follow=${encodeURIComponent(r.name)}`}
                       target="_blank" rel="noopener">Watch run</a>
                    <span class="muted"> · {r.run.seconds}s cloaked</span>
                  </> : r.moments?.length ? <ul class="replay-moments">
                    {r.moments.map((moment) => <li>
                      <a href={`${replay}?t=${moment.start / 100}&follow=${encodeURIComponent(r.name)}`}
                         target="_blank" rel="noopener">{moment.label ?? "Watch moment"}</a>
                      <span class="muted"> · {duration(moment.start / 100)} – {duration(moment.end / 100)}</span>
                    </li>)}
                  </ul> : <span class="muted">–</span>}
                </td>}
              </tr>)}
            </tbody>
          </table>
        </div>
      </Modal>}
    </section>
  );
}

function Rounds({ rounds, names, fa, roundPlayers, control }: {
  rounds: RoundRow[]; names: Map<number, string>; fa: number; roundPlayers: PlayerRow[];
  control?: ControlRound[];
}) {
  const [open, setOpen] = useState<number | null>(null);
  if (!rounds.length) {
    return <section class="card"><h2>Rounds</h2><p class="muted">No rounds were recorded for this match.</p></section>;
  }
  const held = new Map((control ?? []).map((c) => [c.seq, c.held]));
  return (
    <section class="card">
      <h2>Rounds</h2>
      <ScoreChart rounds={rounds} names={names} fa={fa} />
      <Timeline rounds={rounds} names={names} fa={fa} open={open} onPick={(r) => {
        if (roundPlayers.some((p) => p.seq === r.seq)) setOpen(r.seq);
        document.getElementById(`round-${r.seq}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }} />
      {control && <ControlChart rounds={rounds} control={control} names={names} fa={fa} />}
      <div class="scroll">
        <table class="data rounds">
          <thead><tr>
            <th scope="col">Round</th><th scope="col">Base</th><th scope="col">Won by</th>
            <th scope="col" class="c">Score</th><th scope="col">How</th><th scope="col" class="n">Length</th>
            {control && <th scope="col" class="n" title="Share of the base each team held over the round, in percent, as the replay counts it">Held</th>}
            <th scope="col"><span class="sr-only">Players</span></th>
          </tr></thead>
          <tbody>
            {rounds.map((r) => {
              const mine = roundPlayers.filter((p) => p.seq === r.seq);
              const isOpen = open === r.seq;
              return (
                <>
                  <tr id={`round-${r.seq}`} class={r.counted ? "" : "uncounted"}>
                    <td>{roundLabel(r)}</td>
                    <td>{r.base_num ?? "?"}</td>
                    <td>{r.winner_freq == null ? <span class="muted">–</span>
                      : <Team side={r.winner_freq === fa ? "a" : "b"}>{names.get(r.winner_freq) || `Freq ${r.winner_freq}`}</Team>}</td>
                    <td class="c">{r.score_a}–{r.score_b}</td>
                    <td>{roundHow(r)}{!r.counted && <span class="muted"> (not counted)</span>}</td>
                    <td class="n">{duration(r.duration_s)}</td>
                    {control && <td class="n">{held.get(r.seq) == null ? <span class="muted">–</span> : (
                      <><Team side="a">{held.get(r.seq)}</Team><span class="muted">–</span><Team side="b">{100 - held.get(r.seq)!}</Team></>
                    )}</td>}
                    <td>{mine.length > 0 && (
                      <button class="link" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : r.seq)}>
                        {isOpen ? "Hide" : "Players"}
                      </button>
                    )}</td>
                  </tr>
                  {isOpen && (
                    <tr class="round-detail"><td colSpan={control ? 8 : 7}>
                      <RoundPlayers list={mine} fa={fa} />
                    </td></tr>
                  )}
                </>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** Claude Design's round timeline (idea 4, a mock-up): one block a round in
 * the order played, as wide as it lasted, in the colour of the team that won
 * it, grey where nobody did (time ran out, a skip, a timeout called). Every
 * round in the table is here, counted or not. A block opens its round below.
 * Kept slight (the user, 2026-11-05: "so bulky"): a thin line, no labels;
 * the hover and the table name the rounds. */
function Timeline({ rounds, names, fa, open, onPick }: {
  rounds: RoundRow[]; names: Map<number, string>; fa: number; open: number | null;
  onPick: (r: RoundRow) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const lengths = rounds.map((r) => Math.max(1, r.duration_s || 0));
  const total = lengths.reduce((a, b) => a + b, 0);
  if (rounds.length < 2) return null;
  // Where each block starts and how wide it is, as the flex row lays them
  // out: the gaps come off first, the rest is shared by length.
  const GAP = 2;
  const room = width - GAP * (rounds.length - 1);
  const px = lengths.map((l) => (l / total) * room);
  const left = px.map((_, i) => px.slice(0, i).reduce((a, b) => a + b, 0) + GAP * i);
  const side = (r: RoundRow) => (r.winner_freq == null ? "none" : r.winner_freq === fa ? "a" : "b");
  const who = (r: RoundRow) => (r.winner_freq == null ? "No point" : names.get(r.winner_freq) || `Freq ${r.winner_freq}`);
  const tip = hover == null ? null : rounds[hover];
  const mid = hover == null ? 0 : left[hover] + px[hover] / 2;
  const flip = mid + 180 > width;
  return (
    <div class="timeline">
      <div class="tl-row" ref={box}>
        {rounds.map((r, i) => (
          <div class="tl-cell" style={{ flexGrow: lengths[i] }}>
            <button type="button" class={`tl-block tl-${side(r)}`} aria-pressed={open === r.seq}
                    aria-label={`${roundLabel(r)}, base ${r.base_num ?? "unknown"}: ${who(r)}, ${roundHow(r)}, ${duration(r.duration_s)}`}
                    onClick={() => onPick(r)}
                    onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)}
                    onFocus={() => setHover(i)} onBlur={() => setHover(null)} />
          </div>
        ))}
      </div>
      {tip && (
        <div class="chart-tip tl-tip" style={flip ? { right: `${Math.max(0, width - mid - 12)}px` } : { left: `${Math.max(0, mid - 12)}px` }}>
          <div class="tip-head">{roundLabel(tip)} · base {tip.base_num ?? "?"} · {duration(tip.duration_s)}</div>
          <div class="tip-row">
            {tip.winner_freq != null && <span class={`key viz-${side(tip)}`} aria-hidden="true" />}
            <strong>{who(tip)}</strong>
          </div>
          <div class="tip-note">{roundHow(tip)}{!tip.counted && " (not counted)"}</div>
        </div>
      )}
      <p class="chart-note">Each round as long as it lasted ({duration(total)} in all). Tap one for its players.</p>
    </div>
  );
}

/** The score after each round, one step line a team: how the match went,
 * comebacks and all. The rounds table below is its table view. Only the
 * rounds that count; a match of one round has nothing to show. */
function ScoreChart({ rounds, names, fa }: { rounds: RoundRow[]; names: Map<number, string>; fa: number }) {
  const counted = rounds.filter((r) => r.counted);
  if (counted.length < 2) return null;
  const fb = [...names.keys()].find((f) => f !== fa)!;
  const a = [0, ...counted.map((r) => r.score_a)];
  const b = [0, ...counted.map((r) => r.score_b)];
  const top = niceTicks(Math.max(...a, ...b, 1), Math.min(5, Math.max(...a, ...b, 1)));
  const n = counted.length;
  // Every round offered; the chart keeps as many as fit.
  const xTicks = [0, ...counted.map((_, i) => i + 1)];
  const series: Series[] = [
    { id: "a", label: names.get(fa) || `Freq ${fa}`, cls: "viz-a", values: a, dy: -1.5 },
    { id: "b", label: names.get(fb) || `Freq ${fb}`, cls: "viz-b", values: b, dy: 1.5 },
  ];
  return (
    <LineChart
      label={`Score after each round: ${series[0].label} ${a[n]}, ${series[1].label} ${b[n]}`}
      xs={n + 1} series={series} step height={200}
      yMax={top.max} yTicks={top.ticks} yFmt={String}
      xTicks={[...new Set(xTicks)]}
      xFmt={(i) => (i === 0 ? "Start" : roundLabel(counted[i - 1]))}
      endLabel={(_, v) => String(v)}
      tip={(i) => {
        const r = counted[i - 1];
        return {
          head: i === 0 ? "Start" : `${roundLabel(r)} · base ${r.base_num ?? "?"} · ${duration(r.duration_s)}`,
          rows: series.map((s) => ({ cls: s.cls, label: s.label, value: String(s.values[i]) })),
          note: i === 0 ? undefined : roundHow(r),
        };
      }}
    />
  );
}

/** Base control, as the replay's own chart counts it (ss-replay control.ts):
 * once a second, the share of the base the first team's ships reach first
 * through the corridors. The rounds laid end to end in the order played, the
 * breaks between them left out; above the middle line the first team held
 * more. From the match's replay, so only a league match with one has it. */
function ControlChart({ rounds, control, names, fa }: {
  rounds: RoundRow[]; control: ControlRound[]; names: Map<number, string>; fa: number;
}) {
  const bySeq = new Map(rounds.map((r) => [r.seq, r]));
  const fb = [...names.keys()].find((f) => f !== fa)!;
  const A = names.get(fa) || `Freq ${fa}`, B = names.get(fb) || `Freq ${fb}`;
  // One x position a second; a null between two rounds breaks the line.
  const values: (number | null)[] = [];
  const at: ({ r: RoundRow; s: number } | null)[] = [];
  const starts: number[] = [];
  for (const c of control) {
    const r = bySeq.get(c.seq);
    if (!r || !c.shares.length) continue;
    if (values.length) { values.push(null); at.push(null); }
    starts.push(values.length);
    c.shares.forEach((v, s) => { values.push(v == null ? null : v * 100); at.push({ r, s }); });
  }
  if (!values.some((v) => v != null)) return null;
  return (
    <div class="control">
      <h3>Base control</h3>
      <LineChart
        label={`Base control, once a second, round by round: above the middle line ${A} held more of the base, below it ${B}.`}
        xs={values.length} series={[{ id: "a", label: A, cls: "viz-a", values }]} height={180}
        yMax={100} yTicks={[0, 25, 50, 75, 100]} yFmt={(v) => `${v}%`}
        xTicks={starts} xFmt={(i) => roundLabel(at[i]!.r)}
        reference={{ y: 50, label: "even" }}
        // the colour of whoever holds more, as the replay's chart draws it
        split={{ y: 50, above: "viz-a", below: "viz-b" }}
        tip={(i) => {
          const here = at[i] ?? at[i + 1]!;          // a break: the round after it
          const v = at[i] ? values[i] : null;
          const a = v == null ? null : Math.round(v);
          return {
            head: `${roundLabel(here.r)} · base ${here.r.base_num ?? "?"} · ${at[i] ? `${duration(here.s)} in` : "start"}`,
            rows: a == null ? [] : [
              { cls: "viz-a", label: A, value: `${a}%` },
              { cls: "viz-b", label: B, value: `${100 - a}%` },
            ],
            note: at[i] && v == null ? "No base was being played." : undefined,
          };
        }}
      />
      <p class="chart-note">The share of the base each team reached first, once a second, as the replay counts it.
        Above the middle line {A} held more, below it {B}.</p>
    </div>
  );
}

/** The match's chat from its replay, as it was said between the rounds:
 * public chat and the spectators' team chat (the only team chat a recording
 * keeps), yellow as the game shows team chat; commands dimmed. Names are never
 * in a team's colour, only the team a point went to (the user, 2026-11-08:
 * chat lines tell apart only public and spectator chat). A timeout's line
 * names no team: neither the database nor the replay says who called it. Open from the start (the user,
 * 2026-11-08), in a box of its own height; the summary folds it away. A time
 * opens the replay at that moment. */
function Chat({ chat, rounds, names, fa, replay }: {
  chat: ChatDoc; rounds: RoundRow[]; names: Map<number, string>; fa: number; replay: string | null;
}) {
  const items = chatTimeline(chat, rounds);
  const { total, pub, spec } = chatCounts(chat);
  const team = (f: number) => <Team side={f === fa ? "a" : "b"}>{names.get(f) || `Freq ${f}`}</Team>;
  // the replay's own link form for a moment: seconds to a tenth (main.ts linkSeconds)
  const at = (t: number) => (
    replay ? <a class="chat-t" href={`${replay}?t=${Math.round(t / 10) / 10}`} target="_blank" rel="noopener"
                title="Watch from here in the replay">{duration(t / 100)}</a>
      : <span class="chat-t">{duration(t / 100)}</span>
  );
  return (
    <section class="card">
      <h2>Chat</h2>
      <details class="chat-fold" open>
        <summary>{num(total)} {total === 1 ? "line" : "lines"} · {num(pub)} public, {num(spec)} from spectators</summary>
        <p class="chart-note">Public chat and the spectators' team chat, in yellow as the game shows it, as the
          recording kept them; private messages and the teams' own chat are never recorded. Times count from
          the start of the recording{replay ? "; a time opens the replay there" : ""}.</p>
        <ol class="chat-log">
          {items.map((it) => {
            switch (it.kind) {
              case "round":
                return <li class="chat-round"><span class="chat-t">{duration(it.t / 100)}</span>
                  <span>Round {it.round}{it.attempt > 1 ? `, attempt ${it.attempt}` : ""} · base {it.base}</span></li>;
              case "gap":
                return <li class="chat-gap">{it.label}</li>;
              case "end":
                return <li class="chat-end"><span class="chat-t">{duration(it.t / 100)}</span>
                  <span>{it.winner != null ? <>Point {team(it.winner)} · {it.score[0]}–{it.score[1]} · {it.how}</> : it.how}</span></li>;
              case "line":
                return (
                  <li class={`chat-line${it.spec ? " spec" : ""}${it.cmd ? " cmd" : ""}`}>
                    {at(it.t)}
                    <span class="chat-msg">
                      {it.spec && <span class="sr-only">Spectators: </span>}
                      {it.name != null && <b class="chat-who">{it.name}&gt;</b>}{" "}
                      {it.text}
                    </span>
                  </li>
                );
            }
          })}
        </ol>
      </details>
    </section>
  );
}

function RoundPlayers({ list, fa }: { list: PlayerRow[]; fa: number }) {
  const sorted = [...list].sort((a, b) => a.freq - b.freq || b.kills - a.kills);
  return (
    <table class="data compact">
      <thead><tr>
        <th scope="col">Player</th><th class="n">K</th><th class="n">D</th><th class="n">ST</th>
        <th class="n">DG</th><th class="n">DT</th><th class="n">Time</th>
      </tr></thead>
      <tbody>
        {sorted.map((p) => (
          <tr>
            <td><Team side={p.freq === fa ? "a" : "b"}>●</Team> <a href={playerHref(p.player_name)}>{p.player_name}</a></td>
            <td class="n">{p.kills}</td><td class="n">{p.deaths}</td><td class="n">{p.safe_touches}</td>
            <td class="n">{num(p.dmg_given)}</td><td class="n">{num(p.dmg_taken)}</td>
            <td class="n">{duration(p.active_time)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function NeobotGame({ id, doc }: { id: number; doc: NeobotDoc }) {
  const m = doc.match;
  const lines = rows<NeobotLineRow>(doc.lines);
  const players = rows<NeobotPlayerRow>(doc.players);
  const names = new Map([[0, "Freq 0"], [1, "Freq 1"]]);
  const groups = neobotBoard(lines, players, m.winner_freq, m.active_seconds);
  return (
    <>
      <header class="page-head">
        <p class="eyebrow">Match {id} · Pub</p>
        <ScoreBanner names={names} fa={0} fb={1} a={m.score_a} b={m.score_b} winner={m.winner_freq} how="won" />
        <ul class="facts">
          <li>{duration(m.active_seconds)} played</li>
          {m.winner_freq == null && <li class="warn">No result ({outcomeWord(m.outcome)})</li>}
          <li class="muted">No date, rounds or bases were recorded for this match.</li>
        </ul>
        {!!m.partial_stats && <p class="note">These stats cover only part of the match, so some of them may be inaccurate.</p>}
      </header>
      {lines.length > 0 && (
        <section class="card">
          <Board heading="Scoreboard" cols={NEOBOT_COLS} colGroups={NEOBOT_GROUPS} groups={groups} />
          <BoardNotes keyLine={markerKey(players, m.winner_freq)} brackets={lines.some((l) => l.left_early)} />
        </section>
      )}
      {players.length > 0 && <Highlights records={players} />}
    </>
  );
}
