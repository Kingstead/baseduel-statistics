import { render } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { Activity } from "./pages/Activity";
import { Bases } from "./pages/Bases";
import { Compare } from "./pages/Compare";
import { Home } from "./pages/Home";
import { Insights } from "./pages/Insights";
import { Leaders } from "./pages/Leaders";
import { Match } from "./pages/Match";
import { Matches } from "./pages/Matches";
import { Player } from "./pages/Player";
import { Records } from "./pages/Records";
import { installLinkHandler, useRoute } from "./router";
import { PlayerSearch, useTitle } from "./ui";
import { installTooltips } from "./tooltip";
import "./style.css";

function Page() {
  const { path, query } = useRoute();
  let m: RegExpMatchArray | null;
  if (path === "/") return <Home />;
  if ((m = path.match(/^\/p\/(.+)$/))) return <Player name={decodeURIComponent(m[1])} query={query} />;
  if ((m = path.match(/^\/m\/(\d+)$/))) return <Match section="pub" id={Number(m[1])} />;
  if ((m = path.match(/^\/league\/m\/(\d+)$/))) return <Match section="league" id={Number(m[1])} />;
  if (path === "/top") return <Leaders query={query} />;
  if (path === "/records") return <Records query={query} />;
  if (path === "/bases") return <Bases query={query} />;
  if (path === "/activity") return <Activity query={query} />;
  if (path === "/insights") return <Insights />;
  if ((m = path.match(/^\/compare\/([^/]+)(?:\/([^/]+))?$/))) {
    return <Compare a={decodeURIComponent(m[1])} b={m[2] ? decodeURIComponent(m[2]) : null} query={query} />;
  }
  if (path === "/matches") {
    // Any other value, the old ?s=neobot included, is the pub arena's list.
    return <Matches tab={query.get("s") === "league" ? "league" : "pub"} />;
  }
  return <NotFound />;
}

function NotFound() {
  useTitle("Not found");
  return (
    <section class="card">
      <h1>Nothing here</h1>
      <p><a href="/">Back to the start →</a></p>
    </section>
  );
}

/** The emblem (Claude Design, 2026-11-05): a gold shield, three nested rings
 * sharing a point, and a slash through them. design/brand/ has the files. */
function BrandMark() {
  return (
    <svg class="brand-mark" viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <linearGradient id="bds-gold" x1="0.2" y1="0" x2="0.8" y2="1">
          <stop offset="0" stop-color="#ffdc5a" />
          <stop offset="1" stop-color="#f2a400" />
        </linearGradient>
      </defs>
      <g fill="none" stroke="url(#bds-gold)" stroke-linecap="round" stroke-linejoin="round">
        <path stroke-width="3" d="M32 3C31 9 23 14.5 8.5 18C7.5 29 10 38 17.5 45.5C23.5 51 28.5 54 32 61C35.5 54 40.5 51 46.5 45.5C54 38 56.5 29 55.5 18C41 14.5 33 9 32 3Z" />
        <g stroke-width="2.1">
          <circle cx="26" cy="26.5" r="6.5" />
          <circle cx="28.8" cy="29.3" r="10.5" />
          <circle cx="32" cy="32.5" r="15" />
          <path d="M17.5 19.2L46 47.7" />
        </g>
      </g>
    </svg>
  );
}

function App() {
  const { path } = useRoute();
  // On a phone the links scroll sideways: keep the current one in view, and
  // fade whichever edge has more links past it.
  const nav = useRef<HTMLElement>(null);
  const edges = () => {
    const n = nav.current;
    if (!n) return;
    const more = [n.scrollLeft > 1 && "left", n.scrollLeft + n.clientWidth < n.scrollWidth - 1 && "right"];
    n.dataset.more = more.filter(Boolean).join(" ");
  };
  useEffect(() => {
    const n = nav.current;
    const el = n?.querySelector<HTMLElement>('[aria-current="page"]');
    if (n && el && (el.offsetLeft < n.scrollLeft || el.offsetLeft + el.offsetWidth > n.scrollLeft + n.clientWidth - 56)) {
      n.scrollLeft = el.offsetLeft - 16;
    }
    edges();
  }, [path]);
  useEffect(() => {
    window.addEventListener("resize", edges);
    return () => window.removeEventListener("resize", edges);
  }, []);
  return (
    <>
      <header class="site-head">
        <div class="wrap site-head-in">
          <a class="brand" href="/"><BrandMark /><span class="brand-name">Base Duel Stats</span></a>
          <nav class="site-nav" aria-label="Site" ref={nav} onScroll={edges}>
            <a href="/top" aria-current={path === "/top" ? "page" : undefined}>Leaderboards</a>
            <a href="/matches" aria-current={path === "/matches" ? "page" : undefined}>Matches</a>
            <a href="/records" aria-current={path === "/records" ? "page" : undefined}>Records</a>
            <a href="/bases" aria-current={path === "/bases" ? "page" : undefined}>Bases</a>
            <a href="/activity" aria-current={path === "/activity" ? "page" : undefined}>Activity</a>
            <a href="/insights" aria-current={path === "/insights" ? "page" : undefined}>Insights</a>
          </nav>
          {path !== "/" && <PlayerSearch compact />}
        </div>
      </header>
      <main class="wrap">
        <Page />
      </main>
      <footer class="wrap site-foot muted small">
        Numbers are the bots' own: what <code>!bdstats</code> and <code>!bdmatch</code> say in game.
        Replays at <a href="https://ss-replay.pages.dev" target="_blank" rel="noopener">ss-replay.pages.dev</a>.
      </footer>
    </>
  );
}

installLinkHandler();
installTooltips();
render(<App />, document.getElementById("app")!);
