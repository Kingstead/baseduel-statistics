// An instant tooltip for table column headers. A native title waits about a
// second to appear (and never does on a touch screen), while a header with one
// shows a help cursor. The headers keep writing `title`; the first time one is
// hovered its text moves to data-tip so the browser's own tooltip doesn't show
// twice, and the text is kept as the cell's accessible description.

const SELECTOR = "thead th[title], thead th[data-tip]";
const GAP = 8;

export function installTooltips() {
  const tip = document.createElement("div");
  tip.className = "tip";
  tip.setAttribute("role", "tooltip");
  tip.hidden = true;
  document.body.append(tip);

  let current: Element | null = null;

  const hide = () => {
    current = null;
    tip.hidden = true;
  };

  const show = (th: HTMLElement) => {
    const title = th.getAttribute("title");
    if (title) {
      th.dataset.tip = title;
      th.setAttribute("aria-description", title);
      th.removeAttribute("title");
    }
    const text = th.dataset.tip;
    if (!text) return;
    current = th;
    tip.textContent = text;
    tip.hidden = false;
    const r = th.getBoundingClientRect();
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    const left = Math.min(Math.max(GAP, r.left + r.width / 2 - w / 2), window.innerWidth - w - GAP);
    const above = r.top - h - GAP >= GAP;
    tip.style.left = `${left}px`;
    tip.style.top = `${above ? r.top - h - GAP : r.bottom + GAP}px`;
  };

  document.addEventListener("mouseover", (e) => {
    const th = (e.target as Element).closest?.(SELECTOR) as HTMLElement | null;
    if (th === current) return;
    if (th) show(th);
    else hide();
  });
  // a header scrolled out from under a still pointer, or a dialog opened over it
  window.addEventListener("scroll", hide, { capture: true, passive: true });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") hide(); });
}
