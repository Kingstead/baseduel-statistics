import { useState } from "preact/hooks";
import { COL_HELP, type Cell } from "./board";
import type { ChatRound, PlayerRow, ReplayStats, Versus } from "./data";
import { duration, fold, num } from "./format";
import { minuteKills, playerKills, playerStreaks } from "./killlog";
import { playerHref } from "./router";
import { Modal, Pills, Team } from "./ui";

const TITLES: Record<string, string> = {
  K: "Kills", D: "Deaths", TK: "Team kills", KS: "Longest kill streak",
  "KS#": "Kill streaks of 10+", KSE: "Enemy streaks ended", KPM: "Kills by minute",
  DG: "Damage given", DT: "Damage taken", Att: "Attaches", AtBy: "Attached to",
  Rep: "Repels", Brst: "Bursts",
};

const UNAVAILABLE: Record<string, string> = {
  DG: "Recordings contain no damage events. The bot stores total damage given, but not how much went to each player.",
  DT: "Recordings contain no damage events. The bot stores total damage taken, but not how much came from each player.",
  Att: "The bot stores the total attaches, but the available replay stats do not record whom you attached to.",
  AtBy: "The bot stores the total times attached to, but the available replay stats do not record who attached to you.",
};

function VersusList({ title, list, fa }: { title: string; list: Versus[]; fa: number }) {
  const sorted = [...list].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
  const max = sorted.reduce((m, v) => Math.max(m, v.n), 0);
  return (
    <section class="vs-col">
      <h3>{title} <span class="muted">{num(list.reduce((s, v) => s + v.n, 0))}</span></h3>
      {list.length === 0 ? <p class="muted">Nobody recorded.</p> : (
        <ol class="vs-list">
          {sorted.map((v) => (
            <li title={Object.entries(v.weapons).map(([w, n]) => `${w} ${n}`).join(", ")}>
              <Team side={v.freq === fa ? "a" : "b"}>
                <a class="vs-name" href={playerHref(v.name)}>{v.name}</a>
              </Team>
              <span class="vs-bar" aria-hidden="true"><span style={{ width: `${100 * v.n / max}%` }} /></span>
              <b class="n">{num(v.n)}</b>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function ReplayDetail({ stats, name, column, window, fa }: {
  stats: ReplayStats; name: string; column: string; window?: [number, number]; fa: number;
}) {
  const mine = window ? playerKills(stats.kills, name, window)
    : stats.breakdowns[fold(name)] ?? playerKills(stats.kills, name);
  if (column === "K" || column === "D" || column === "TK") return (
    <>
      {column === "K" && <VersusList title="Killed" list={mine.killed} fa={fa} />}
      {column === "D" && <VersusList title="Killed by" list={mine.killedBy} fa={fa} />}
      {column !== "D" && (column === "TK" || mine.teamKilled.length > 0) &&
        <VersusList title="Team kills" list={mine.teamKilled} fa={fa} />}
      {column === "D" && mine.teamKilledBy.length > 0 &&
        <VersusList title="Killed by teammates" list={mine.teamKilledBy} fa={fa} />}
    </>
  );
  if (column === "KS" || column === "KS#" || column === "KSE") {
    const { streaks, ended } = playerStreaks(stats.kills, name, window);
    const best = Math.max(0, ...streaks.map((s) => s.kills.length));
    const list = column === "KSE" ? ended : streaks.filter((s) =>
      column === "KS" ? s.kills.length === best : s.kills.length >= 10);
    return (
      <>
        <p class="chart-note">Reconstructed enemy-kill streaks: team kills do not advance a streak; any death
          ends it. These are not the bot's recorded streak counters. Selecting a round starts fresh at its boundary.</p>
        {list.length === 0 && <p class="muted">No qualifying streaks in the replay.</p>}
        {list.map((s) => (
          <section class="vs-col">
            <h3>{column === "KSE" ? `${s.kills[0].killer}'s` : ""} {num(s.kills.length)}-kill streak</h3>
            <p class="muted">{duration(s.kills[0].t / 100)} – {duration(s.kills[s.kills.length - 1].t / 100)} into recording
              {s.endedBy ? ` · Ended by ${s.endedBy.killer}` : " · No death recorded before the selection ended"}</p>
            {column !== "KSE" && <VersusList title="Killed during streak"
              list={playerKills(s.kills, name).killed} fa={fa} />}
          </section>
        ))}
      </>
    );
  }
  if (column === "KPM") {
    const minutes = minuteKills(stats.kills, name, window ?? [0, stats.end]);
    const full = minutes.filter((m) => m.end - m.start === 6000);
    const ranked = [...full].sort((a, b) => a.kills - b.kills);
    const quietest = ranked[0], busiest = ranked[ranked.length - 1];
    const max = Math.max(0, ...minutes.map((m) => m.kills));
    return (
      <>
        <p class="chart-note">Kills per recording minute, including team kills and quiet minutes.
          This is wall-clock time, not the active-field-time KPM on the scoreboard. Times are into the recording.</p>
        {full.length > 0 && <p>
          Busiest full minute: <b>{duration(busiest.start / 100)} – {duration(busiest.end / 100)}</b>
          {" "}({num(busiest.kills)} kills).
          {" "}Quietest: <b>{duration(quietest.start / 100)} – {duration(quietest.end / 100)}</b>
          {" "}({num(quietest.kills)} kills). Ties are possible; all minutes are below.
        </p>}
        {minutes.length === 0 && <p class="muted">No recording time in this selection.</p>}
        <ol class="vs-list">
          {minutes.map((m) => (
            <li>
              <span>{duration(m.start / 100)} – {duration(m.end / 100)}
                {m.end - m.start < 6000 && " (partial)"}</span>
              <span class="vs-bar" aria-hidden="true"><span style={{ width: `${max ? 100 * m.kills / max : 0}%` }} /></span>
              <b class="n">{num(m.kills)}</b>
            </li>
          ))}
        </ol>
      </>
    );
  }
  const player = stats.players.find((p) => fold(p.name) === fold(name));
  if (!player) return <p class="warn">This player was not found in the replay stats.</p>;
  const weapon = column === "Rep" ? "repel" : "burst";
  const used = player.shots[weapon] ?? 0;
  const burst = playerKills(stats.kills.filter((k) => k.weapon === "burst"), name);
  return (
    <>
      <p>Used in the whole recording: <b>{num(used)}</b> {column === "Rep" ? "repels" : "bursts"}.</p>
      <p class="chart-note">The replay counts weapon-use frames. It does not record how many items the
        player had available, so available, remaining and usage percentages cannot be shown.</p>
      {column === "Brst" && <>
        <VersusList title="Kills attributed to bursts" list={burst.killed} fa={fa} />
        {burst.teamKilled.length > 0 && <VersusList title="Team kills attributed to bursts" list={burst.teamKilled} fa={fa} />}
        <p class="chart-note">Weapon attribution is an estimate based on the killer's most recent
          eligible shot, not confirmed damage events.</p>
      </>}
    </>
  );
}

const roundLabel = (r: ChatRound) => `R${r.round}${r.attempt > 1 ? `.${r.attempt}` : ""}`;

export function MatchPlayerModal({ name, column, value, stats, rounds, fa, row, onClose }: {
  name: string; column: string; value: Cell; stats: ReplayStats; rounds?: ChatRound[]; fa: number; row?: PlayerRow;
  onClose: () => void;
}) {
  const [round, setRound] = useState("all");
  const unavailable = UNAVAILABLE[column];

  const picked = round === "all" ? undefined : rounds?.[Number(round)];
  const window: [number, number] | undefined = picked ? [picked.start, picked.end ?? stats.end] : undefined;
  const label = row?.player_name ?? name;
  const byRound = !unavailable && column !== "Rep" && column !== "Brst";

  return (
    <Modal onClose={onClose} title={<>
      {row ? <Team side={row.freq === fa ? "a" : "b"}>{label}</Team> : label}
      {" · "}{TITLES[column]}
    </>}>
        <p class="muted vs-sub">Scoreboard {column}: <b>{typeof value === "number" ? num(value) : value}</b>
          {" · "}<a href={playerHref(label)}>Career stats →</a></p>
        {unavailable ? <p>{unavailable} A player-by-player breakdown is unavailable.</p> : <>
          {byRound && rounds && rounds.length > 0 && (
            <div class="scroll">
              <Pills label="Round" value={round} onChange={setRound}
                     options={[["all", "Whole recording"], ...rounds.map((r, i): [string, string] => [String(i), roundLabel(r)])]} />
            </div>
          )}
          <ReplayDetail stats={stats} name={name} column={column} window={window} fa={fa} />
          <p class="chart-note">Replay-derived details, not a replacement for the bot's scoreboard.
            The whole recording includes time between rounds; totals can differ. Kills and deaths include
            team kills, listed separately.</p>
        </>}
        <p class="chart-note">{COL_HELP[column]}</p>
    </Modal>
  );
}
