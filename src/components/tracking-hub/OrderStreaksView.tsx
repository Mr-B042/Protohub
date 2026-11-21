import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, ArrowUp, ArrowUpDown, ChevronRight, Flame, HelpCircle, Layers, PowerOff } from "lucide-react";
import { trackingHubApi, type HubStreakRow, type HubStreakVerdict } from "../../lib/api";
import { LoadState, PlatformIcon, SearchBox, ago, naira, nf, rowCls, selectCls, shortDay, tableCls, useLoad } from "./HubParts";

// Ad Spend -> Order Streaks (Bright, 20 Nov 2026: "ads that are consistently
// getting orders ... will give us an edge to scale it"). Every ad that ran in
// the last 7 days: how steadily it gets orders, and whether it is cheap enough
// to scale. Rules: backend lib/ad-streaks.ts.

const VERDICTS: Array<{ key: HubStreakVerdict; label: string; tone: string; dot: string }> = [
  { key: "scale", label: "Scale it", tone: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30", dot: "bg-emerald-500" },
  { key: "steady_ok", label: "Steady, near break-even", tone: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/30", dot: "bg-blue-500" },
  { key: "steady_no_target", label: "Steady, no break-even", tone: "bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/30", dot: "bg-violet-500" },
  { key: "steady_costly", label: "Steady, but costly", tone: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/30", dot: "bg-rose-500" },
  { key: "building", label: "Building", tone: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30", dot: "bg-amber-500" },
  { key: "patchy", label: "Patchy", tone: "bg-gray-100 text-gray-700 border-gray-200 dark:bg-slate-800", dot: "bg-gray-400" }
];
const verdictOf = (key: HubStreakVerdict) => VERDICTS.find((row) => row.key === key)!;
type SortKey = "verdict" | "run" | "share14" | "share7" | "orders14" | "cost";
type StatusFilter = "all" | "live" | "off";
const statusOf = (row: HubStreakRow) => row.campaignStatus ?? "unknown";

// Motion (Bright, 21 Nov 2026: "nice UX/UI, icon motions, animations"): rows
// ease in when the list changes, live dots pulse. All of it is motion-safe:
// a phone set to reduce motion gets the same page without movement.
const MOTION_CSS = `
@keyframes streakRowIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
@keyframes streakSoftPulse { 0%, 100% { box-shadow: 0 0 0 0 rgba(16,185,129,.35); } 50% { box-shadow: 0 0 0 5px rgba(16,185,129,0); } }
@media (prefers-reduced-motion: no-preference) {
  .streak-row-in { animation: streakRowIn .32s cubic-bezier(.2,.7,.2,1) both; }
  .streak-live-pill { animation: streakSoftPulse 2.4s ease-in-out infinite; }
}`;

// Sticky filter bar (Bright, 21 Nov 2026: "let this be sticky so we don't
// scroll up when we are down looking for it ... make it smart").

/** Bottom edge of the app's fixed top bar (its height changes with banners), measured, not guessed. */
function useTopBarOffset() {
  const [offset, setOffset] = useState(64);
  useEffect(() => {
    const measure = () => {
      let el = document.elementFromPoint(window.innerWidth / 2, 2) as HTMLElement | null;
      while (el && el !== document.body) {
        const position = getComputedStyle(el).position;
        if (position === "fixed" || position === "sticky") { setOffset(Math.round(el.getBoundingClientRect().bottom)); return; }
        el = el.parentElement;
      }
      setOffset(0);
    };
    measure();
    window.addEventListener("resize", measure);
    const timer = window.setTimeout(measure, 600); // banners can arrive after the first paint
    return () => { window.removeEventListener("resize", measure); window.clearTimeout(timer); };
  }, []);
  return offset;
}

/** The element that actually scrolls (the app's main area on phones, the window on desktop). */
function scrollerOf(node: HTMLElement | null): HTMLElement | Window {
  let el = node?.parentElement ?? null;
  while (el && el !== document.body) {
    const overflowY = getComputedStyle(el).overflowY;
    if ((overflowY === "auto" || overflowY === "scroll") && el.scrollHeight > el.clientHeight) return el;
    el = el.parentElement;
  }
  return window;
}
const scrollByTop = (node: HTMLElement | null, delta: number) => {
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  scrollerOf(node).scrollBy({ top: delta, behavior: reduce ? "auto" : "smooth" });
};

/** Green pulsing dot: the campaign is delivering right now. */
function LiveDot({ size = "h-2 w-2" }: { size?: string }) {
  return (
    <span className={`relative inline-flex ${size}`}>
      <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 motion-safe:animate-ping" />
      <span className={`relative inline-flex ${size} rounded-full bg-emerald-500`} />
    </span>
  );
}

/** Live / Off / not known, with this ad's own state when the campaign is live but the ad is not. */
function StatusBadge({ row }: { row: HubStreakRow }) {
  const status = statusOf(row);
  if (status === "live" && row.adLive === false) {
    return <span title="The campaign is running, but this ad is switched off" className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10.5px] font-bold text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300"><LiveDot size="h-1.5 w-1.5" />Live · this ad off</span>;
  }
  if (status === "live") {
    return <span title="Delivering right now (checked live with Meta)" className="streak-live-pill inline-flex shrink-0 whitespace-nowrap items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10.5px] font-bold text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300"><LiveDot size="h-1.5 w-1.5" />Live</span>;
  }
  if (status === "off") {
    return <span title="Not delivering right now (checked live with Meta)" className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-gray-200 bg-gray-100 px-2 py-0.5 text-[10.5px] font-bold text-gray-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400"><PowerOff className="h-3 w-3" />Off</span>;
  }
  return <span title={row.platform === "tiktok" ? "TikTok doesn't say live, so this can't be checked" : "Meta didn't answer for this ad account"} className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-dashed border-gray-300 px-2 py-0.5 text-[10.5px] font-semibold text-gray-400 dark:border-slate-600"><HelpCircle className="h-3 w-3" />Not known</span>;
}

/** Live now / Off / All, with a highlight that slides between them. */
function StatusSwitch({ value, onChange, counts }: { value: StatusFilter; onChange: (value: StatusFilter) => void; counts: Record<StatusFilter, number> }) {
  const items: Array<{ key: StatusFilter; label: string; icon: ReactNode }> = [
    { key: "all", label: "All", icon: <Layers className="h-3.5 w-3.5" /> },
    { key: "live", label: "Live now", icon: <LiveDot /> },
    { key: "off", label: "Off", icon: <PowerOff className="h-3.5 w-3.5" /> }
  ];
  const index = items.findIndex((item) => item.key === value);
  return (
    <div role="tablist" aria-label="Campaign status" className="relative grid h-10 grid-cols-3 rounded-xl border border-gray-200 bg-gray-50 p-1 dark:border-slate-700 dark:bg-slate-800/60">
      <span aria-hidden className="absolute bottom-1 left-1 top-1 rounded-lg bg-white shadow-sm ring-1 ring-black/5 transition-transform duration-300 ease-out dark:bg-slate-900"
        style={{ width: "calc((100% - 0.5rem) / 3)", transform: `translateX(${index * 100}%)` }} />
      {items.map((item) => (
        <button key={item.key} type="button" role="tab" aria-selected={value === item.key} onClick={() => onChange(item.key)}
          className={`!min-h-0 relative z-10 inline-flex items-center justify-center gap-1.5 whitespace-nowrap px-3 text-[12.5px] font-semibold transition-colors ${value === item.key ? (item.key === "live" ? "text-emerald-700 dark:text-emerald-300" : "text-gray-900 dark:text-slate-100") : "text-gray-500 hover:text-gray-800 dark:text-slate-400"}`}>
          {item.icon}{item.label}<span className="rounded-full bg-gray-200/70 px-1.5 text-[10.5px] tabular-nums text-gray-600 dark:bg-slate-700 dark:text-slate-300">{counts[item.key]}</span>
        </button>
      ))}
    </div>
  );
}

/** 14 squares, oldest left: green = an order that day, grey = ran with no order, blank = off. */
function Strip({ days }: { days: HubStreakRow["days"] }) {
  return (
    <span className="inline-flex gap-[3px]" aria-label="Last 14 days">
      {days.map((cell) => {
        const tone = cell.orders > 0
          ? cell.orders >= 3 ? "bg-emerald-600" : "bg-emerald-400"
          : cell.spend > 0 ? "bg-gray-300 dark:bg-slate-600" : "border border-dashed border-gray-300 bg-transparent dark:border-slate-600";
        const words = cell.orders > 0 ? `${cell.orders} order${cell.orders === 1 ? "" : "s"}` : cell.spend > 0 ? "ran, no order" : "off";
        return <span key={cell.day} title={`${shortDay(cell.day)}: ${words}${cell.spend > 0 ? ` · ${naira(cell.spend)} spent` : ""}`} className={`h-4 w-3 rounded-[3px] ${tone}`} />;
      })}
    </span>
  );
}

function Share({ part, whole }: { part: number; whole: number }) {
  if (whole === 0) return <span className="text-gray-400">—</span>;
  const pct = Math.round((part / whole) * 100);
  return (
    <span className="whitespace-nowrap">
      <b className={pct >= 70 ? "text-emerald-700 dark:text-emerald-300" : pct >= 50 ? "text-amber-700 dark:text-amber-300" : "text-gray-600 dark:text-slate-300"}>{part} of {whole}</b>
      <span className="ml-1 text-[11px] text-gray-500">{pct}%</span>
    </span>
  );
}

function CostCell({ row }: { row: HubStreakRow }) {
  if (row.costPerOrder14 === null) return <span className="text-gray-400">No order</span>;
  if (row.target === null) return <span>{naira(row.costPerOrder14)}<span className="block text-[11px] text-gray-400">break-even not known</span></span>;
  const ratio = row.costPerOrder14 / row.target;
  const tone = ratio <= 0.7 ? "bg-emerald-500" : ratio <= 1 ? "bg-amber-500" : "bg-rose-500";
  return (
    <span className="block min-w-[120px]">
      <b>{naira(row.costPerOrder14)}</b><span className="ml-1 text-[11px] text-gray-500">of {naira(row.target)}</span>
      <span className="mt-1 block h-1.5 w-full rounded-full bg-gray-100 dark:bg-slate-800"><span className={`block h-1.5 rounded-full ${tone}`} style={{ width: `${Math.min(100, Math.round(ratio * 100))}%` }} /></span>
    </span>
  );
}

export default function OrderStreaksView({ platform, refreshKey }: { platform: string; refreshKey: string }) {
  const { data, error, reload } = useLoad(() => trackingHubApi.orderStreaks(platform), [platform, refreshKey]);
  useEffect(() => {
    const timer = setInterval(() => { if (document.visibilityState === "visible") reload(); }, 10 * 60_000);
    return () => clearInterval(timer);
  }, [platform]); // eslint-disable-line react-hooks/exhaustive-deps
  const [verdict, setVerdict] = useState<HubStreakVerdict | "">("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [productId, setProductId] = useState("");
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "verdict", dir: 1 });
  // Sticky bar: where it sits, how tall it is, and whether it has stuck.
  const topOffset = useTopBarOffset();
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);
  const tableRef = useRef<HTMLDivElement | null>(null);
  const [barHeight, setBarHeight] = useState(56);
  const [stuck, setStuck] = useState(false);
  useLayoutEffect(() => {
    const bar = barRef.current;
    if (!bar || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setBarHeight(Math.round(bar.getBoundingClientRect().height)));
    observer.observe(bar);
    return () => observer.disconnect();
  }, [data !== null]);
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => setStuck(!entry.isIntersecting && entry.boundingClientRect.top < topOffset + 1),
      { rootMargin: `-${topOffset + 1}px 0px 0px 0px`, threshold: [0, 1] });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [topOffset, data !== null]);
  /** After a filter change while scrolled down, bring the first result up under the bar. */
  const settleList = useCallback(() => {
    window.requestAnimationFrame(() => {
      const table = tableRef.current;
      if (!table) return;
      const delta = table.getBoundingClientRect().top - (topOffset + barHeight + 8);
      if (delta < 0) scrollByTop(table, delta);
    });
  }, [topOffset, barHeight]);
  const filterKey = `${status}|${verdict}|${productId}|${search.trim()}`;
  const lastFilterKey = useRef(filterKey);
  useEffect(() => {
    if (lastFilterKey.current === filterKey) return;
    lastFilterKey.current = filterKey;
    if (stuck) settleList();
  }, [filterKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const backToTop = () => { const sentinel = sentinelRef.current; if (sentinel) scrollByTop(sentinel, sentinel.getBoundingClientRect().top - topOffset - 140); };
  if (!data) return <LoadState text="Checking which ads get orders day after day…" error={error} onRetry={reload} />;

  const statusCounts: Record<StatusFilter, number> = { all: 0, live: 0, off: 0 };
  const base = data.rows.filter((row) => (!productId || row.productId === productId)
    && (!search.trim() || `${row.adName} ${row.adsetName} ${row.campaignName} ${row.accountName} ${row.productName ?? ""}`.toLowerCase().includes(search.trim().toLowerCase())));
  for (const row of base) {
    statusCounts.all += 1;
    if (statusOf(row) === "live") statusCounts.live += 1;
    if (statusOf(row) === "off") statusCounts.off += 1;
  }
  const shown = base.filter((row) => status === "all" || statusOf(row) === status);
  const counts = new Map<HubStreakVerdict, number>();
  for (const row of shown) counts.set(row.verdict, (counts.get(row.verdict) ?? 0) + 1);
  const order = VERDICTS.map((row) => row.key);
  const value = (row: HubStreakRow): number => sort.key === "verdict" ? order.indexOf(row.verdict)
    : sort.key === "cost" ? row.costPerOrder14 ?? Number.MAX_SAFE_INTEGER : sort.key === "share14" ? row.share14 ?? -1 : sort.key === "share7" ? row.share7 ?? -1 : row[sort.key];
  const rows = shown.filter((row) => !verdict || row.verdict === verdict)
    .sort((a, b) => (value(a) - value(b)) * sort.dir || (b.share14 ?? 0) - (a.share14 ?? 0) || b.orders14 - a.orders14);
  const productOptions = Array.from(new Map(data.rows.filter((row) => row.productId).map((row) => [row.productId!, row.productName ?? ""])).entries()).sort((a, b) => a[1].localeCompare(b[1]));
  const th = (key: SortKey, label: string, title?: string) => (
    <th key={key} title={title} className="cursor-pointer select-none whitespace-nowrap" onClick={() => setSort(sort.key === key ? { key, dir: sort.dir === 1 ? -1 : 1 } : { key, dir: key === "verdict" || key === "cost" ? 1 : -1 })}>
      <span className="inline-flex items-center gap-1">{label}<ArrowUpDown className={`h-3 w-3 ${sort.key === key ? "text-gray-700" : "text-gray-300"}`} /></span>
    </th>
  );
  const toggle = (id: string) => { const next = new Set(open); if (next.has(id)) next.delete(id); else next.add(id); setOpen(next); };
  const r = data.rules;

  return (
    <div className="mt-3 space-y-3">
      <style>{MOTION_CSS}</style>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
        {VERDICTS.map((item) => (
          <button key={item.key} type="button" onClick={() => setVerdict(verdict === item.key ? "" : item.key)}
            className={`!min-h-0 rounded-xl border px-3 py-2.5 text-left ${item.tone} ${verdict === item.key ? "ring-2 ring-blue-500" : ""}`}>
            <span className="flex items-center gap-1.5 text-[12px] font-semibold"><span className={`h-2 w-2 rounded-full ${item.dot}`} />{item.label}</span>
            <strong className="mt-0.5 block text-[22px] font-black leading-tight">{nf(counts.get(item.key) ?? 0)}</strong>
          </button>
        ))}
      </div>

      <div ref={sentinelRef} aria-hidden className="h-px" />
      <div ref={barRef} style={{ top: topOffset }}
        className={`sticky z-30 -mx-4 px-4 py-2 transition-[background-color,box-shadow,backdrop-filter] duration-300 ${stuck ? "border-b border-gray-200/80 bg-white/90 shadow-[0_8px_24px_-12px_rgba(15,23,42,0.25)] backdrop-blur-md dark:border-slate-700/80 dark:bg-slate-900/90" : "bg-transparent"}`}>
        <div className="flex flex-wrap items-center gap-2.5">
          <StatusSwitch value={status} onChange={setStatus} counts={statusCounts} />
          <SearchBox value={search} onChange={setSearch} placeholder="Search ads, ad sets, campaigns…" className="min-w-[200px] flex-1 xl:max-w-[280px]" />
          <select value={productId} onChange={(event) => setProductId(event.target.value)} className={`${selectCls} w-[170px]`}><option value="">All Products</option>{productOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select>
          <span className="ml-auto flex flex-wrap items-center gap-3 text-[11.5px] text-gray-500 dark:text-slate-400">
            <span className="inline-flex items-center gap-1"><span className="h-3 w-2.5 rounded-[2px] bg-emerald-400" />order</span>
            <span className="inline-flex items-center gap-1"><span className="h-3 w-2.5 rounded-[2px] bg-gray-300 dark:bg-slate-600" />ran, no order</span>
            <span className="inline-flex items-center gap-1"><span className="h-3 w-2.5 rounded-[2px] border border-dashed border-gray-300" />off</span>
            {data.lastSyncAt ? <span>Spend read {ago(data.lastSyncAt)}</span> : null}
          </span>
        </div>
        {/* Stuck: the verdict cards are out of sight, so a compact copy rides along. */}
        <div className={`grid transition-[grid-template-rows,opacity,margin] duration-300 ease-out ${stuck ? "mt-2 grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`} aria-hidden={!stuck}>
          <div className="flex min-h-0 flex-wrap items-center gap-1.5 overflow-hidden">
            {VERDICTS.map((item) => (
              <button key={item.key} type="button" tabIndex={stuck ? 0 : -1} onClick={() => setVerdict(verdict === item.key ? "" : item.key)}
                className={`!min-h-0 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] font-semibold transition-transform active:scale-95 ${item.tone} ${verdict === item.key ? "ring-2 ring-blue-500" : ""}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${item.dot}`} />{item.label}<b className="tabular-nums">{nf(counts.get(item.key) ?? 0)}</b>
              </button>
            ))}
            <span className="ml-auto flex items-center gap-2 text-[11.5px] text-gray-500 dark:text-slate-400">
              <span className="tabular-nums">{nf(rows.length)} shown</span>
              <button type="button" tabIndex={stuck ? 0 : -1} onClick={backToTop} className="!min-h-0 inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white px-2.5 py-1 font-semibold text-gray-700 transition-colors hover:bg-gray-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
                <ArrowUp className="h-3 w-3 motion-safe:transition-transform motion-safe:group-hover:-translate-y-0.5" />Top
              </button>
            </span>
          </div>
        </div>
      </div>

      {data.liveFailures?.length ? (
        <p className="m-0 flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />Couldn't check live or off for {data.liveFailures.map((row) => row.name).join(", ")}. Their ads show "Not known".
        </p>
      ) : null}

      <div ref={tableRef} className="overflow-x-auto xl:overflow-visible rounded-xl border border-gray-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <table className={tableCls}>
          <thead style={{ top: topOffset + barHeight }} className="text-gray-600 dark:text-slate-300 xl:sticky xl:z-20 [&_th]:bg-gray-50 dark:[&_th]:bg-slate-800 [&_th:first-child]:rounded-tl-xl [&_th:last-child]:rounded-tr-xl">
            <tr>
              <th className="w-6" />
              <th>Ad</th>
              <th className="whitespace-nowrap">Last 14 days</th>
              {th("run", "Run", "Days in a row with an order, back from yesterday. Days the ad was off are skipped.")}
              {th("share14", "14 days", "Days with an order ÷ days the ad ran")}
              {th("share7", "7 days", "Days with an order ÷ days the ad ran, this past week")}
              {th("orders14", "Orders")}
              {th("cost", "Cost / order", "14-day spend ÷ orders, against the product's break-even")}
              <th className="whitespace-nowrap">Today</th>
              {th("verdict", "Verdict")}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={10} className="py-10 text-center text-gray-500">{data.rows.length ? "No ad matches these filters." : "No ad ran in the last 7 days."}</td></tr>
            ) : rows.map((row, index) => {
              const v = verdictOf(row.verdict);
              const isOpen = open.has(row.adId);
              const off = statusOf(row) === "off";
              return (
                // The key carries the filter so rows ease in again when it changes; delay staggers the first dozen.
                <Fragment key={`${row.adId}:${status}:${verdict}`}>
                  <tr style={{ animationDelay: `${Math.min(index, 12) * 28}ms` }}
                    className={`${rowCls} streak-row-in group cursor-pointer transition-[background-color,opacity] duration-200 hover:bg-gray-50 dark:hover:bg-slate-800/40 ${off ? "bg-gray-50/40 dark:bg-slate-900/40 [&>td]:opacity-55 [&>td]:transition-opacity hover:[&>td]:opacity-100" : ""} ${statusOf(row) === "live" ? "[&>td:first-child]:shadow-[inset_3px_0_0_0_rgb(16_185_129)]" : ""}`} onClick={() => toggle(row.adId)}>
                    <td><ChevronRight className={`h-4 w-4 text-gray-400 transition-transform duration-200 ${isOpen ? "rotate-90" : "group-hover:translate-x-0.5"}`} /></td>
                    <td className="min-w-[230px] max-w-[320px]">
                      <span className="flex items-center gap-2">
                        <PlatformIcon platform={row.platform} size="sm" />
                        <span className="min-w-0">
                          {/* Campaign first: most ads are named alike ("New Sales ad"). */}
                          <b className="block truncate" title={row.campaignName}>{row.campaignName}</b>
                          <span className="block truncate text-[11.5px] text-gray-500" title={`${row.adsetName} › ${row.adName}`}>{row.adsetName} › {row.adName}</span>
                          <span className="mt-0.5 flex min-w-0 items-center gap-1.5"><StatusBadge row={row} /><span className="truncate text-[11px] text-gray-400">{row.accountName}{row.productName ? ` · ${row.productName}` : " · product not known"}</span></span>
                        </span>
                      </span>
                    </td>
                    <td className={off ? "grayscale" : ""}><Strip days={row.days} /></td>
                    <td className="whitespace-nowrap">{row.run > 0 ? <span className="inline-flex items-center gap-1 font-bold text-orange-600"><Flame className="h-3.5 w-3.5" />{row.run} day{row.run === 1 ? "" : "s"}</span> : <span className="text-gray-400">0</span>}</td>
                    <td><Share part={row.orderDays14} whole={row.activeDays14} /></td>
                    <td><Share part={row.orderDays7} whole={row.activeDays7} /></td>
                    <td className="whitespace-nowrap"><b>{nf(row.orders14)}</b><span className="block text-[11px] text-gray-500">{nf(row.confirmed14)} confirmed</span></td>
                    <td><CostCell row={row} /></td>
                    <td className="whitespace-nowrap">{row.ordersToday > 0 ? <b className="text-emerald-700">{row.ordersToday} so far</b> : <span className="text-gray-400">{row.spendToday > 0 ? "none yet" : "—"}</span>}</td>
                    <td>
                      <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-[11.5px] font-bold ${v.tone}`}><span className={`h-1.5 w-1.5 rounded-full ${v.dot}`} />{v.label}</span>
                      {off && row.verdict === "scale" ? <span className="mt-1 block text-[10.5px] font-semibold text-emerald-700 dark:text-emerald-300">Was winning · turn it back on?</span> : null}
                    </td>
                  </tr>
                  {isOpen ? (
                    <tr className="streak-row-in border-t border-gray-100 bg-gray-50/70 dark:border-slate-800 dark:bg-slate-800/30">
                      <td />
                      <td colSpan={9} className="py-3 text-[12.5px] text-gray-700 dark:text-slate-300">
                        <p className="m-0 font-semibold">{row.reason}</p>
                        <p className="m-0 mt-1 text-gray-500">Spent {naira(row.spend14)} over the 14 days. Ad id {row.adId}.</p>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {row.days.map((cell) => (
                            <span key={cell.day} className="rounded-md border border-gray-200 bg-white px-2 py-1 text-[11px] dark:border-slate-700 dark:bg-slate-900">
                              <b>{shortDay(cell.day)}</b> · {cell.spend > 0 || cell.orders > 0 ? `${cell.orders} order${cell.orders === 1 ? "" : "s"} · ${naira(cell.spend)}` : "off"}
                            </span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="m-0 text-[12px] text-gray-500 dark:text-slate-400">
        Steady = an order on at least {Math.round(r.steadyShare * 100)}% of the days the ad ran, over the last {r.window} days and the last {r.recent}, after at least {r.minActiveDays} days running.
        {" "}Scale it = steady and costing at most {Math.round(r.scaleBelow * 100)}% of the product's break-even per order (the same target as Since Start).
        {" "}Days the ad was off don't count against it. Today is shown on its own until the day is over.
      </p>
    </div>
  );
}
