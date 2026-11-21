import { useEffect } from "react";

/**
 * Smart sticky, everywhere (Bright, 21 Nov 2026: "always build a smart sticky
 * here, check all similar places, do a deep audit and fix all").
 *
 * Mounted ONCE (App root). For every long table on screen it:
 *   1. finds the table's FILTER BAR (search box, dropdowns or a row of filter
 *      buttons just above the table) and pins it under the app's top bar with
 *      CSS sticky. A parent with overflow:hidden (rounded cards) would stop
 *      sticky, so that parent is switched to overflow:clip, which clips the
 *      same but does not trap sticky. The bar lets go once the table has
 *      scrolled past, and is never pinned when taller than a quarter of the
 *      screen (phones). Pinned bars get a frosted background + shadow.
 *   2. pins the table's COLUMN HEADINGS under the bar (or the top bar). Most
 *      tables sit in a sideways-scrolling box, which traps CSS sticky, so the
 *      headings are a synced COPY (same column widths, follows sideways
 *      scrolling). Clicks on the copy go to the real heading (sort, select all).
 *
 * The "top line" is MEASURED: the bottom of whatever fixed/sticky header sits
 * at the top of the scrolling area (app top bar, a modal's own header), so
 * banners and panels never misplace it.
 *
 * Opt out: put data-smart-sticky="off" on a table or any ancestor (views that
 * pin themselves: Order Streaks, Campaign Decisions detail).
 */

const MIN_TABLE_HEIGHT = 420;
const MIN_ROWS = 6;
const BAR_MAX_SHARE = 0.25;
const ATTR_BAR = "data-ss-bar";
const ATTR_STUCK = "data-ss-stuck";
const CSS = `
[${ATTR_BAR}] { transition: background-color .2s ease, box-shadow .2s ease; }
[${ATTR_BAR}][${ATTR_STUCK}] { background-color: rgba(255,255,255,.93) !important; -webkit-backdrop-filter: saturate(1.4) blur(8px); backdrop-filter: saturate(1.4) blur(8px); box-shadow: 0 10px 24px -16px rgba(15,23,42,.45); }
.dark [${ATTR_BAR}][${ATTR_STUCK}], [data-theme="dark"] [${ATTR_BAR}][${ATTR_STUCK}] { background-color: rgba(15,23,42,.92) !important; }
.ss-head { position: fixed; z-index: 35; overflow: hidden; pointer-events: auto; box-shadow: 0 8px 18px -14px rgba(15,23,42,.5); border-bottom: 1px solid rgba(148,163,184,.25); }
@media (prefers-reduced-motion: no-preference) { .ss-head { animation: ssIn .16s ease-out; } }
@keyframes ssIn { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }
`;

type Entry = { table: HTMLTableElement; bar: HTMLElement | null; head: HTMLDivElement | null; headTable: HTMLTableElement | null; scroller: HTMLElement | null; signature: string };

const isOff = (el: Element) => Boolean(el.closest('[data-smart-sticky="off"]'));
const visible = (el: HTMLElement) => el.offsetParent !== null || getComputedStyle(el).position === "fixed";

/** Nearest ancestor that scrolls vertically (null = the page / window). */
function verticalScroller(el: HTMLElement): HTMLElement | null {
  let node = el.parentElement;
  while (node && node !== document.body) {
    const s = getComputedStyle(node);
    if ((s.overflowY === "auto" || s.overflowY === "scroll") && node.scrollHeight > node.clientHeight + 4) return node;
    node = node.parentElement;
  }
  return null;
}

/** Nearest ancestor that scrolls sideways, up to (not past) `stop`. */
function horizontalScroller(el: HTMLElement): HTMLElement | null {
  let node = el.parentElement;
  while (node && node !== document.body) {
    const s = getComputedStyle(node);
    if (s.overflowX === "auto" || s.overflowX === "scroll") return node;
    if (s.overflowY === "auto" || s.overflowY === "scroll") return null;
    node = node.parentElement;
  }
  return null;
}

/** The top line of a scrolling area: below its own fixed/sticky header (the app top bar on the page). */
function topLine(scroller: HTMLElement | null): number {
  const top = scroller ? scroller.getBoundingClientRect().top : 0;
  const rect = scroller ? scroller.getBoundingClientRect() : { left: 0, width: window.innerWidth };
  const probeX = rect.left + rect.width / 2;
  let line = Math.max(0, top);
  const probe = document.elementFromPoint(probeX, Math.max(1, top + 2)) as HTMLElement | null;
  let node = probe;
  while (node && node !== document.body && node !== scroller) {
    if (node.classList?.contains("ss-head") || node.hasAttribute?.(ATTR_BAR)) break;
    const position = getComputedStyle(node).position;
    if (position === "fixed" || position === "sticky") { line = Math.max(line, Math.round(node.getBoundingClientRect().bottom)); break; }
    node = node.parentElement;
  }
  return line;
}

const isControlRow = (el: HTMLElement) => {
  const inputs = el.querySelectorAll('input[type="search"], input[type="text"], input:not([type]), select, [role="combobox"]');
  const buttons = el.querySelectorAll("button");
  return inputs.length >= 1 || buttons.length >= 3;
};

/** The filter bar just above a table: a previous sibling of the table or of one of its near ancestors. */
function findBar(table: HTMLTableElement): HTMLElement | null {
  let node: HTMLElement | null = table;
  for (let depth = 0; depth < 6 && node && node.parentElement; depth += 1) {
    let sibling = node.previousElementSibling as HTMLElement | null;
    for (let hops = 0; hops < 2 && sibling; hops += 1) {
      const h = sibling.getBoundingClientRect().height;
      if (h > 0 && h <= 180 && !sibling.querySelector("table") && isControlRow(sibling)) return sibling;
      if (h > 0 && h > 180) break;
      sibling = sibling.previousElementSibling as HTMLElement | null;
    }
    node = node.parentElement;
    // Stop at a box that really scrolls up and down (a sideways-only box reports overflow-y auto too).
    if (node && /auto|scroll/.test(getComputedStyle(node).overflowY) && node.scrollHeight > node.clientHeight + 4) break;
  }
  return null;
}

/** Let a bar stick: ancestors with overflow:hidden (up to the scroller) become overflow:clip. */
function freeAncestors(bar: HTMLElement, scroller: HTMLElement | null) {
  let node = bar.parentElement;
  while (node && node !== document.body && node !== scroller) {
    const s = getComputedStyle(node);
    if (s.overflowX === "auto" || s.overflowX === "scroll" || s.overflowY === "auto" || s.overflowY === "scroll") return false;
    if (s.overflow === "hidden" || s.overflowX === "hidden" || s.overflowY === "hidden") {
      // Only rounded cards are switched to clip (same look). Any other hidden box is
      // a layout container: leave it alone and don't pin the bar.
      if (parseFloat(s.borderTopLeftRadius) > 0 || parseFloat(s.borderTopRightRadius) > 0) node.style.overflow = "clip";
      else return false;
    }
    node = node.parentElement;
  }
  return true;
}

function backgroundOf(el: HTMLElement): string {
  let node: HTMLElement | null = el;
  while (node) {
    const bg = getComputedStyle(node).backgroundColor;
    if (bg && bg !== "transparent" && !bg.startsWith("rgba(0, 0, 0, 0")) return bg;
    node = node.parentElement;
  }
  return document.documentElement.classList.contains("dark") ? "#0f172a" : "#ffffff";
}

/** Same element in the real heading as `target` in the copy (by child-index path). */
function realTarget(copyRoot: Element, realRoot: Element, target: Element): HTMLElement | null {
  const path: number[] = [];
  let node: Element | null = target;
  while (node && node !== copyRoot) { const parent: Element | null = node.parentElement; if (!parent) return null; path.unshift(Array.prototype.indexOf.call(parent.children, node)); node = parent; }
  let real: Element | null = realRoot;
  for (const i of path) { real = real?.children[i] ?? null; if (!real) return null; }
  return real as HTMLElement;
}

export default function SmartSticky() {
  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") return;
    const style = document.createElement("style");
    style.textContent = CSS;
    document.head.appendChild(style);
    const entries = new Map<HTMLTableElement, Entry>();
    let frame = 0;

    const dropHead = (e: Entry) => { e.head?.remove(); e.head = null; e.headTable = null; e.signature = ""; };
    const release = (e: Entry) => {
      if (e.bar) { e.bar.style.position = ""; e.bar.style.top = ""; e.bar.style.zIndex = ""; e.bar.removeAttribute(ATTR_STUCK); e.bar.removeAttribute(ATTR_BAR); }
      dropHead(e);
    };

    const scan = () => {
      const tables = Array.from(document.querySelectorAll("table")) as HTMLTableElement[];
      const live = new Set<HTMLTableElement>();
      for (const table of tables) {
        if (!table.tHead || !visible(table) || isOff(table) || table.closest(".ss-head")) continue;
        const rows = table.tBodies[0]?.rows.length ?? 0;
        if (rows < MIN_ROWS || table.getBoundingClientRect().height < MIN_TABLE_HEIGHT) continue;
        // A heading that already sticks by itself (CSS sticky that works) needs nothing.
        const th = table.tHead.rows[0]?.cells[0];
        if (th && (getComputedStyle(table.tHead).position === "sticky" || getComputedStyle(th).position === "sticky") && !horizontalScroller(table)) continue;
        live.add(table);
        if (!entries.has(table)) entries.set(table, { table, bar: null, head: null, headTable: null, scroller: null, signature: "" });
        const e = entries.get(table)!;
        e.scroller = verticalScroller(table);
        const bar = findBar(table);
        if (bar !== e.bar) { if (e.bar) release({ ...e, head: null }); e.bar = bar; }
      }
      for (const [table, e] of entries) if (!live.has(table)) { release(e); entries.delete(table); }
      tick();
    };

    const buildHead = (e: Entry) => {
      const real = e.table.tHead!;
      const wrap = document.createElement("div");
      wrap.className = "ss-head";
      wrap.setAttribute("aria-hidden", "true");
      const copy = document.createElement("table");
      copy.className = e.table.className;
      copy.style.tableLayout = "fixed";
      copy.style.margin = "0";
      copy.appendChild(real.cloneNode(true));
      wrap.appendChild(copy);
      wrap.style.background = backgroundOf(real.rows[0]?.cells[0] ?? real);
      wrap.addEventListener("click", (event) => {
        const target = event.target as Element;
        const head = copy.tHead;
        const hit = head ? realTarget(head, real, target) : null;
        if (hit) { event.preventDefault(); hit.click(); window.setTimeout(() => { scan(); }, 60); }
      });
      document.body.appendChild(wrap);
      e.head = wrap; e.headTable = copy;
    };

    const syncWidths = (e: Entry) => {
      const real = e.table.tHead!, copy = e.headTable!.tHead!;
      const realCells = Array.from(real.querySelectorAll("th, td")) as HTMLElement[];
      const copyCells = Array.from(copy.querySelectorAll("th, td")) as HTMLElement[];
      const checks = (root: Element) => Array.from(root.querySelectorAll("input")).map((i) => (i.checked ? 1 : i.indeterminate ? 2 : 0)).join("");
      const sig = `${e.table.offsetWidth}|${realCells.map((c) => Math.round(c.getBoundingClientRect().width)).join(",")}|${real.textContent ?? ""}|${checks(real)}`;
      if (sig === e.signature) return;
      if (real.textContent !== copy.textContent || realCells.length !== copyCells.length || checks(real) !== checks(copy)) {
        // Headings changed (sort arrow, select-all state): copy again.
        copy.replaceWith(real.cloneNode(true));
      }
      const fresh = Array.from(e.headTable!.tHead!.querySelectorAll("th, td")) as HTMLElement[];
      e.headTable!.style.width = `${e.table.offsetWidth}px`;
      realCells.forEach((cell, i) => { const w = cell.getBoundingClientRect().width; if (fresh[i]) { fresh[i].style.width = `${w}px`; fresh[i].style.minWidth = `${w}px`; fresh[i].style.maxWidth = `${w}px`; } });
      e.signature = sig;
    };

    const tick = () => {
      frame = 0;
      const vh = window.innerHeight;
      for (const e of entries.values()) {
        const tRect = e.table.getBoundingClientRect();
        if (tRect.bottom < -200 || tRect.top > vh + 200) { if (e.head) dropHead(e); if (e.bar?.hasAttribute(ATTR_STUCK)) e.bar.removeAttribute(ATTR_STUCK); continue; }
        let line = topLine(e.scroller);
        // 1. The filter bar.
        if (e.bar && e.bar.isConnected) {
          const barH = e.bar.getBoundingClientRect().height;
          const room = (e.scroller ? e.scroller.clientHeight : vh) * BAR_MAX_SHARE;
          const tableStillThere = tRect.bottom > line + barH + 60;
          if (barH <= room && tableStillThere && freeAncestors(e.bar, e.scroller)) {
            e.bar.setAttribute(ATTR_BAR, "");
            if (e.bar.style.position !== "sticky") { e.bar.style.position = "sticky"; e.bar.style.zIndex = "30"; }
            // Sticky "top" counts from inside the scroller's padding (the app's main area has 96px).
            const pad = e.scroller ? parseFloat(getComputedStyle(e.scroller).paddingTop) || 0 : 0;
            e.bar.style.top = `${line - (e.scroller ? e.scroller.getBoundingClientRect().top : 0) - pad}px`;
            const bRect = e.bar.getBoundingClientRect();
            const stuck = bRect.top <= line + 0.5 && tRect.top < bRect.bottom;
            if (stuck) { e.bar.setAttribute(ATTR_STUCK, ""); line = Math.round(bRect.bottom); } else e.bar.removeAttribute(ATTR_STUCK);
          } else if (e.bar.hasAttribute(ATTR_BAR)) {
            e.bar.style.position = ""; e.bar.style.top = ""; e.bar.style.zIndex = ""; e.bar.removeAttribute(ATTR_STUCK); e.bar.removeAttribute(ATTR_BAR);
          }
        }
        // 2. The column headings.
        const thead = e.table.tHead;
        if (!thead) continue;
        const hRect = thead.getBoundingClientRect();
        const show = hRect.top < line - 1 && tRect.bottom > line + hRect.height + 24;
        if (!show) { if (e.head) dropHead(e); continue; }
        if (!e.head) buildHead(e);
        syncWidths(e);
        const box = (horizontalScroller(e.table) ?? e.table).getBoundingClientRect();
        e.head!.style.top = `${line}px`;
        e.head!.style.left = `${box.left}px`;
        e.head!.style.width = `${box.width}px`;
        e.headTable!.style.transform = `translateX(${tRect.left - box.left}px)`;
      }
    };
    const schedule = () => { if (!frame) frame = window.requestAnimationFrame(tick); };

    let scanTimer = 0;
    const scheduleScan = () => { window.clearTimeout(scanTimer); scanTimer = window.setTimeout(scan, 250); };
    const observer = new MutationObserver((records) => {
      // Ignore our own copies.
      if (records.every((r) => (r.target as Element).closest?.(".ss-head"))) return;
      scheduleScan();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener("scroll", schedule, { capture: true, passive: true });
    window.addEventListener("resize", scheduleScan);
    scan();
    return () => {
      observer.disconnect();
      document.removeEventListener("scroll", schedule, { capture: true } as any);
      window.removeEventListener("resize", scheduleScan);
      window.clearTimeout(scanTimer);
      if (frame) window.cancelAnimationFrame(frame);
      for (const e of entries.values()) release(e);
      style.remove();
    };
  }, []);
  return null;
}
