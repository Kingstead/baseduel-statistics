// Small pieces every page uses.

import type { ComponentChildren } from "preact";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import { getPlayers, type PlayerIndexRow } from "./data";
import { fold } from "./format";
import { navigate, playerHref } from "./router";

/** Load something once per key; [value, error, loading]. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]): [T | undefined, Error | null, boolean] {
  const [state, setState] = useState<{ v?: T; e: Error | null; loading: boolean }>({ e: null, loading: true });
  useEffect(() => {
    let live = true;
    setState({ e: null, loading: true });
    fn().then((v) => live && setState({ v, e: null, loading: false }),
      (e: Error) => live && setState({ e, loading: false }));
    return () => { live = false; };
  }, deps);
  return [state.v, state.e, state.loading];
}

export function Loading({ what = "Loading" }: { what?: string }) {
  return <p class="muted loading">{what}…</p>;
}

export function Problem({ error }: { error: Error }) {
  return <p class="problem">Something went wrong loading this page: {error.message}</p>;
}

export function Modal({ title, children, onClose }: {
  title: ComponentChildren; children: ComponentChildren; onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useLayoutEffect(() => {
    const d = ref.current;
    if (!d) return;
    d.addEventListener("close", onClose);
    d.showModal();
    return () => {
      d.removeEventListener("close", onClose);
      if (d.open) d.close();
    };
  }, [onClose]);
  return (
    <dialog ref={ref} class="vs-modal" aria-labelledby={titleId}
            onClick={(e) => { if (e.target === ref.current) onClose(); }}>
      <div class="vs-body">
        <header class="vs-head">
          <h2 id={titleId}>{title}</h2>
          <button class="vs-close" onClick={onClose} aria-label="Close">×</button>
        </header>
        {children}
      </div>
    </dialog>
  );
}

export function useTitle(title: string) {
  useEffect(() => { document.title = title ? `${title} · Base Duel Stats` : "Base Duel Stats"; }, [title]);
}

export function Result({ r }: { r: string }) {
  const word = { W: "Win", L: "Loss", N: "No result", "-": "No winner" }[r] || r;
  return <span class={`res res-${r === "-" ? "none" : r}`} title={word}>{r === "-" ? "–" : r}</span>;
}

/** A team name or freq in its freq's colour: the lower freq orange, the
 * higher blue, as the Discord match images draw them. */
export function Team({ side, children }: { side: "a" | "b"; children: ComponentChildren }) {
  return <span class={`team team-${side}`}>{children}</span>;
}

export function Pager({ page, pages, onPage }: { page: number; pages: number; onPage: (p: number) => void }) {
  if (pages <= 1) return null;
  return (
    <nav class="pager" aria-label="Pages">
      <button disabled={page <= 0} onClick={() => onPage(page - 1)}>← Newer</button>
      <span class="muted">Page {page + 1} of {pages}</span>
      <button disabled={page >= pages - 1} onClick={() => onPage(page + 1)}>Older →</button>
    </nav>
  );
}

export function Pills<T extends string>({ value, options, onChange, label, large = false }: {
  value: T; options: [T, string, boolean?][]; onChange: (v: T) => void; label: string; large?: boolean;
}) {
  return (
    <div class={large ? "pills pills-lg" : "pills"} role="group" aria-label={label}>
      {options.map(([v, text, disabled]) => (
        <button aria-pressed={v === value} disabled={disabled && v !== value} onClick={() => onChange(v)}>{text}</button>
      ))}
    </div>
  );
}

/** Player search over players.json: prefix matches first, then anywhere.
 * Picking one opens their page, or does `onPick` instead. */
export function PlayerSearch({ autofocus = false, compact = false, onPick, placeholder }: {
  autofocus?: boolean; compact?: boolean; onPick?: (p: PlayerIndexRow) => void; placeholder?: string;
}) {
  const [players] = useLoad(getPlayers, []);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (autofocus) input.current?.focus(); }, []);

  const hits = useMemo(() => {
    const f = fold(q.trim());
    if (!players || !f) return [] as PlayerIndexRow[];
    const starts: PlayerIndexRow[] = [];
    const inside: PlayerIndexRow[] = [];
    for (const p of players.list) {
      const n = fold(p.name);
      if (n.startsWith(f)) starts.push(p);
      else if (n.includes(f)) inside.push(p);
    }
    const busy = (p: PlayerIndexRow) => p.pub_played + p.league_played;
    starts.sort((a, b) => busy(b) - busy(a));
    inside.sort((a, b) => busy(b) - busy(a));
    return [...starts, ...inside].slice(0, 8);
  }, [players, q]);

  const go = (p: PlayerIndexRow) => {
    setQ(""); setOpen(false); input.current?.blur();
    if (onPick) onPick(p);
    else navigate(playerHref(p.name));
  };

  return (
    <div class={`search ${compact ? "search-compact" : ""}`}>
      <input
        ref={input}
        type="search"
        placeholder={placeholder || (players ? `Find a player (${players.list.length.toLocaleString()} on record)` : "Find a player")}
        aria-label="Find a player"
        value={q}
        onInput={(e) => { setQ((e.target as HTMLInputElement).value); setActive(0); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { setActive((a) => Math.min(a + 1, hits.length - 1)); e.preventDefault(); }
          else if (e.key === "ArrowUp") { setActive((a) => Math.max(a - 1, 0)); e.preventDefault(); }
          else if (e.key === "Enter" && hits[active]) go(hits[active]);
          else if (e.key === "Escape") setOpen(false);
        }}
      />
      {open && hits.length > 0 && (
        <ul class="search-hits" role="listbox">
          {hits.map((p, i) => (
            <li role="option" aria-selected={i === active}
                onMouseDown={(e) => { e.preventDefault(); go(p); }}>
              <span>{p.name}</span>
              {(p.pub_bot || p.league_bot) && <span class="tag">bot</span>}
              <span class="muted small">{(p.pub_played + p.league_played).toLocaleString()} games</span>
            </li>
          ))}
        </ul>
      )}
      {open && q.trim() && players && hits.length === 0 && (
        <ul class="search-hits"><li class="muted">No player by that name.</li></ul>
      )}
    </div>
  );
}
