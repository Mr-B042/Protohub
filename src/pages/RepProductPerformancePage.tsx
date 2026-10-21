import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  ArrowDown, ArrowLeft, ArrowUp, ArrowUpDown, BarChart3, CalendarDays, ChevronDown, CirclePercent, Download, LayoutGrid, Percent, PlayCircle,
  Plus, RotateCcw, Search, ShoppingCart, Table2, Trophy, Truck, X
} from "lucide-react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { productMediaApi, type ProductMedia } from "../lib/api";
import { PRESET_LABEL, presetRange, shiftWindow, windowSize, type DateWindow, type PresetKey } from "../lib/date-window";
import { money } from "../lib/money-privacy";
import { Avatar, ProductThumb, SidePanel, downloadCsv, useClickAway } from "./product-trend/parts";
import { downloadXlsx } from "./product-trend/exports";

// ── Product Performance (Sales Rep) — Bright's design, 21 Oct 2026 ──────────
// Opens from the Manager Dashboard tab "Rep Product Performance". Shows how
// every rep does on every product, so a good overall rate cannot hide a weak
// product (Chelsea 65% overall, 40% on one shelf).
//
// ⚠️ HOW IT COUNTS (the Orders page's COHORT rule, see the delivery-rate note
// in memory): the period picks orders PLACED in it; "Delivered" is how many of
// THOSE are delivered now; Delivery Rate = delivered ÷ placed. Revenue and AOV
// are those delivered orders' amounts. "vs last week" = the same-length period
// just before. Held repeat orders are left out, like every conversion report.
//
// Only the "Product Performance (Sales Rep)" tab and its "Product Breakdown by
// Sales Rep" view are designed so far; the other tabs say so (Bright chose to
// send their designs later rather than have them guessed).

export type RepProductOrder = {
  id: string;
  repId: string | null;
  status: string;
  createdKey: string;
  productKey: string;
  productName: string;
  state: string;
  source: string;
  customer: string;
  amount: number;
};

export type RepProductPerformanceProps = {
  orders: RepProductOrder[];
  reps: Array<{ id: string; name: string }>;
  todayKey: string;
  /** Company delivery-rate target (Delivery Goals), for the green/amber/red. */
  target: number;
  /** Rep bonus earned on these delivered orders - the Manager Dashboard's own sum. */
  bonusFor: (orderIds: string[]) => number;
  onBack: () => void;
  onOpenOrder: (orderId: string) => void;
};

const ALL = "all";
const TOP_TABS = ["Overview", "Product Performance (Sales Rep)", "Team Performance", "Product Comparison", "State Breakdown", "Upsell & Cross-Sell", "Product Trends", "Customer Insights"] as const;
type TopTab = (typeof TOP_TABS)[number];
const LOWER_TABS = ["Product Breakdown by Sales Rep", "Product Comparison", "Best & Worst Products", "Product Conversion Funnel"] as const;
type LowerTab = (typeof LOWER_TABS)[number];
const PERIODS: PresetKey[] = ["today", "yesterday", "thisWeek", "lastWeek", "last7", "last30", "thisMonth", "lastMonth", "thisYear"];
const SERIES = ["#3b82f6", "#8b5cf6", "#22c55e", "#f59e0b"];
const OTHERS_COLOR = "#cbd5e1";
const OTHERS = "__others";
type BarMetric = "delivered" | "placed" | "revenue";

type Stat = { placed: number; delivered: number; revenue: number; ids: string[]; deliveredIds: string[] };
const emptyStat = (): Stat => ({ placed: 0, delivered: 0, revenue: 0, ids: [], deliveredIds: [] });
const add = (stat: Stat, order: RepProductOrder) => {
  stat.placed += 1;
  stat.ids.push(order.id);
  if (order.status === "Delivered") { stat.delivered += 1; stat.revenue += Number(order.amount) || 0; stat.deliveredIds.push(order.id); }
};
const rateOf = (stat: Stat) => (stat.placed > 0 ? (stat.delivered / stat.placed) * 100 : null);
const aovOf = (stat: Stat) => (stat.delivered > 0 ? stat.revenue / stat.delivered : null);
const change = (now: number, before: number) => (before > 0 ? ((now - before) / before) * 100 : null);
const nf = (value: number) => Math.round(value).toLocaleString("en-NG");
const compareLabel = (preset: PresetKey | "custom") =>
  preset === "thisWeek" || preset === "lastWeek" || preset === "last7" ? "vs last week"
  : preset === "thisMonth" || preset === "lastMonth" || preset === "last30" ? "vs last month"
  : preset === "today" || preset === "yesterday" ? "vs day before"
  : preset === "thisYear" ? "vs last year" : "vs previous period";
const longDate = (key: string) => new Date(`${key}T00:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });

export default function RepProductPerformancePage({ orders, reps, todayKey, target, bonusFor, onBack, onOpenOrder }: RepProductPerformanceProps) {
  const [topTab, setTopTab] = useState<TopTab>("Product Performance (Sales Rep)");
  const [lowerTab, setLowerTab] = useState<LowerTab>("Product Breakdown by Sales Rep");
  const [preset, setPreset] = useState<PresetKey | "custom">("thisWeek");
  const [window, setWindow] = useState<DateWindow>(() => presetRange("thisWeek", todayKey));
  const [repFilter, setRepFilter] = useState(ALL);
  const [productFilter, setProductFilter] = useState(ALL);
  const [sourceFilter, setSourceFilter] = useState(ALL);
  const [stateFilter, setStateFilter] = useState(ALL);
  const [barMetric, setBarMetric] = useState<BarMetric>("delivered");
  const [view, setView] = useState<"table" | "chart">("table");
  const [search, setSearch] = useState("");
  const [othersOpen, setOthersOpen] = useState(false);
  const [allTop, setAllTop] = useState(false);
  const [cell, setCell] = useState<{ productKey: string; repId: string } | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const closeExport = useCallback(() => setExportOpen(false), []);
  const exportRef = useClickAway<HTMLDivElement>(exportOpen, closeExport);

  const [images, setImages] = useState<Record<string, string>>({});
  useEffect(() => {
    productMediaApi.list().then((result) => {
      const out: Record<string, string> = {};
      const media = (result?.media ?? []).filter((item: ProductMedia) => item.kind === "image" && item.status === "approved" && (item.thumbUrl || item.url));
      media.sort((a, b) => Number(b.isCover) - Number(a.isCover) || a.displayOrder - b.displayOrder);
      for (const item of media) if (!out[item.productId]) out[item.productId] = (item.thumbUrl || item.url)!;
      setImages(out);
    }).catch(() => undefined);
  }, []);
  const imageOf = (productKey: string) => images[productKey] ?? null;

  const repName = useMemo(() => new Map(reps.map((rep) => [rep.id, rep.name])), [reps]);
  const nameOfRep = (id: string) => (id === "" ? "Unassigned" : repName.get(id) ?? "Former staff");

  // Filter options come from the orders themselves, so nothing is invented.
  const options = useMemo(() => {
    const products = new Map<string, string>(), sources = new Set<string>(), states = new Set<string>(), repIds = new Set<string>();
    for (const order of orders) {
      products.set(order.productKey, order.productName || "Unnamed product");
      if (order.source) sources.add(order.source);
      if (order.state) states.add(order.state);
      repIds.add(order.repId ?? "");
    }
    return {
      products: [...products].sort((a, b) => a[1].localeCompare(b[1])),
      sources: [...sources].sort(),
      states: [...states].sort(),
      reps: [...repIds].map((id) => [id, nameOfRep(id)] as const).sort((a, b) => a[1].localeCompare(b[1]))
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders, repName]);

  const matches = (order: RepProductOrder) =>
    (repFilter === ALL || (order.repId ?? "") === repFilter)
    && (productFilter === ALL || order.productKey === productFilter)
    && (sourceFilter === ALL || order.source === sourceFilter)
    && (stateFilter === ALL || order.state === stateFilter);
  const previous = useMemo(() => shiftWindow(window, -windowSize(window)), [window]);
  const current = useMemo(() => orders.filter((order) => order.createdKey >= window.start && order.createdKey <= window.end && matches(order)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [orders, window, repFilter, productFilter, sourceFilter, stateFilter]);
  const before = useMemo(() => orders.filter((order) => order.createdKey >= previous.start && order.createdKey <= previous.end && matches(order)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [orders, previous, repFilter, productFilter, sourceFilter, stateFilter]);

  const model = useMemo(() => {
    const total = emptyStat(), prior = emptyStat();
    const byProduct = new Map<string, { name: string; stat: Stat }>();
    const byRep = new Map<string, Stat>();
    const byCell = new Map<string, Stat>();
    for (const order of current) {
      add(total, order);
      const product = byProduct.get(order.productKey) ?? { name: order.productName || "Unnamed product", stat: emptyStat() };
      add(product.stat, order); byProduct.set(order.productKey, product);
      const repId = order.repId ?? "";
      const rep = byRep.get(repId) ?? emptyStat(); add(rep, order); byRep.set(repId, rep);
      const key = `${order.productKey}|${repId}`;
      const one = byCell.get(key) ?? emptyStat(); add(one, order); byCell.set(key, one);
    }
    for (const order of before) add(prior, order);
    // Best first: most delivered, then most placed.
    const products = [...byProduct].map(([key, value]) => ({ key, ...value }))
      .sort((a, b) => b.stat.delivered - a.stat.delivered || b.stat.placed - a.stat.placed || a.name.localeCompare(b.name));
    const repIds = [...byRep].sort((a, b) => b[1].delivered - a[1].delivered || b[1].placed - a[1].placed).map(([id]) => id);
    // The design: four named products, the rest as "Others".
    const named = products.length > 5 ? products.slice(0, 4) : products;
    const rest = products.length > 5 ? products.slice(4) : [];
    return { total, prior, products, named, rest, repIds, byRep, byCell };
  }, [current, before]);

  const statOf = (productKeys: string[], repId?: string) => {
    const out = emptyStat();
    for (const key of productKeys) {
      const ids = repId === undefined ? model.repIds : [repId];
      for (const id of ids) {
        const stat = model.byCell.get(`${key}|${id}`);
        if (!stat) continue;
        out.placed += stat.placed; out.delivered += stat.delivered; out.revenue += stat.revenue;
        out.ids.push(...stat.ids); out.deliveredIds.push(...stat.deliveredIds);
      }
    }
    return out;
  };
  const colorOf = (productKey: string) => {
    const index = model.named.findIndex((product) => product.key === productKey);
    return index >= 0 && index < SERIES.length ? SERIES[index] : OTHERS_COLOR;
  };

  const { total, prior } = model;
  const rate = rateOf(total), priorRate = rateOf(prior);
  const aov = aovOf(total), priorAov = aovOf(prior);
  const bonus = useMemo(() => bonusFor(total.deliveredIds), [bonusFor, total.deliveredIds]);

  const resetFilters = () => {
    setPreset("thisWeek"); setWindow(presetRange("thisWeek", todayKey));
    setRepFilter(ALL); setProductFilter(ALL); setSourceFilter(ALL); setStateFilter(ALL); setSearch("");
  };

  // ── Table rows (also used by the exports) ────────────────────────────────
  const needle = search.trim().toLowerCase();
  const tableRows = useMemo(() => {
    const rows: Array<{ key: string; name: string; keys: string[]; isOthers?: boolean; child?: boolean }> = [];
    const visible = (name: string) => !needle || name.toLowerCase().includes(needle);
    for (const product of model.named) if (visible(product.name)) rows.push({ key: product.key, name: product.name, keys: [product.key] });
    if (model.rest.length) {
      const restMatches = model.rest.filter((product) => visible(product.name));
      if (needle) for (const product of restMatches) rows.push({ key: product.key, name: product.name, keys: [product.key] });
      else {
        rows.push({ key: OTHERS, name: `Others (${model.rest.length})`, keys: model.rest.map((product) => product.key), isOthers: true });
        if (othersOpen) for (const product of model.rest) rows.push({ key: product.key, name: product.name, keys: [product.key], child: true });
      }
    }
    return rows;
  }, [model, needle, othersOpen]);

  const periodLabel = `${longDate(window.start)} – ${longDate(window.end)}`;
  const exportCsv = () => {
    const header = ["Product", ...model.repIds.flatMap((id) => [`${nameOfRep(id)} placed`, `${nameOfRep(id)} delivered`, `${nameOfRep(id)} DR %`, `${nameOfRep(id)} AOV`]), "Team placed", "Team delivered", "Team DR %", "Team revenue"];
    const line = (name: string, keys: string[]) => {
      const team = statOf(keys);
      return [name, ...model.repIds.flatMap((id) => { const s = statOf(keys, id); return [s.placed, s.delivered, rateOf(s) === null ? "" : Math.round(rateOf(s)!), aovOf(s) === null ? "" : Math.round(aovOf(s)!)]; }),
        team.placed, team.delivered, rateOf(team) === null ? "" : Math.round(rateOf(team)!), Math.round(team.revenue)];
    };
    downloadCsv(`rep-product-performance-${window.start}-to-${window.end}.csv`, [header, ...model.products.map((p) => line(p.name, [p.key])), line("Rep Total", model.products.map((p) => p.key))]);
  };
  const exportExcel = () => {
    const detail: Array<Array<string | number>> = [["Sales rep", "Product", "Placed", "Delivered", "Delivery rate %", "Delivered AOV", "Delivered revenue"]];
    for (const id of model.repIds) for (const product of model.products) {
      const s = statOf([product.key], id);
      if (!s.placed) continue;
      detail.push([nameOfRep(id), product.name, s.placed, s.delivered, Math.round(rateOf(s) ?? 0), Math.round(aovOf(s) ?? 0), Math.round(s.revenue)]);
    }
    downloadXlsx(`rep-product-performance-${window.start}-to-${window.end}.xlsx`, [
      { name: "Summary", rows: [["Product Performance (Sales Rep)"], ["Period", periodLabel], ["Total orders", total.placed], ["Delivered orders", total.delivered], ["Delivery rate %", Math.round(rate ?? 0)], ["Delivered AOV", Math.round(aov ?? 0)], ["Revenue (delivered)", Math.round(total.revenue)], ["Total rep bonus", Math.round(bonus)], [], ["Counting: orders PLACED in the period; delivered = of those, delivered now; delivery rate = delivered ÷ placed."]] },
      { name: "Rep x Product", rows: detail }
    ]);
  };

  const placeholder = (what: string) => (
    <div className="rounded-2xl border border-dashed border-gray-300 bg-white px-6 py-14 text-center dark:border-slate-700 dark:bg-slate-900">
      <LayoutGrid className="mx-auto h-8 w-8 text-gray-300" />
      <p className="m-0 mt-3 text-[15px] font-bold text-gray-800 dark:text-slate-100">{what} is waiting for its design</p>
      <p className="m-0 mt-1 text-[13px] text-gray-500">Send the screen for this tab and it will be built exactly like it.</p>
    </div>
  );

  return (
    <div className="space-y-5">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div>
        <button type="button" onClick={onBack} className="!min-h-0 inline-flex items-center gap-1.5 rounded-lg border border-indigo-100 bg-indigo-50/60 px-3 py-1.5 text-[12.5px] font-semibold text-indigo-700 hover:bg-indigo-50 dark:border-indigo-500/20 dark:bg-indigo-500/10 dark:text-indigo-300">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to Manager Dashboard
        </button>
        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="m-0 text-[22px] font-black tracking-tight text-gray-900 sm:text-[26px] dark:text-slate-50">Product Performance (Sales Rep)</h1>
              <span className="inline-flex items-center gap-0.5 rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-bold text-violet-700 dark:bg-violet-500/15 dark:text-violet-300"><Plus className="h-3 w-3" />New</span>
            </div>
            <p className="m-0 mt-1 text-[13.5px] text-gray-500 dark:text-slate-400">Detailed product performance for each sales rep. See which products each rep is doing best and worst on, with full metrics and insights.</p>
          </div>
          <div className="flex shrink-0 gap-2">
            <div className="relative" ref={exportRef}>
              <button type="button" onClick={() => setExportOpen((open) => !open)} aria-haspopup="menu" aria-expanded={exportOpen}
                className="!min-h-0 inline-flex h-10 items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 text-[13.5px] font-semibold text-indigo-700 shadow-sm hover:bg-gray-50 dark:border-slate-700 dark:bg-slate-900 dark:text-indigo-300">
                <Download className="h-4 w-4" /> Export <ChevronDown className="h-4 w-4" />
              </button>
              {exportOpen && (
                <div role="menu" className="absolute right-0 top-full z-30 mt-1 w-64 rounded-xl border border-gray-200 bg-white p-1.5 text-[13px] shadow-xl dark:border-slate-700 dark:bg-slate-900">
                  {[["This table (CSV)", "Every product × rep, as a spreadsheet", exportCsv], ["Full report (Excel)", "Summary + one row per rep and product", exportExcel]].map(([title, sub, run]) => (
                    <button key={title as string} type="button" role="menuitem" onClick={() => { (run as () => void)(); setExportOpen(false); }} className="!min-h-0 block w-full rounded-lg px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-slate-800">
                      <span className="block font-semibold text-gray-900 dark:text-slate-100">{title as string}</span><span className="block text-[11px] text-gray-500">{sub as string}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button type="button" onClick={() => setHelpOpen(true)} className="!min-h-0 inline-flex h-10 items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 text-[13.5px] font-semibold text-indigo-700 shadow-sm hover:bg-gray-50 dark:border-slate-700 dark:bg-slate-900 dark:text-indigo-300">
              <PlayCircle className="h-4 w-4" /> How to use
            </button>
          </div>
        </div>
      </div>

      {/* ── Tabs ────────────────────────────────────────────────────────── */}
      <div className="-mx-1 overflow-x-auto border-b border-gray-200 dark:border-slate-800">
        <div className="flex min-w-max gap-1 px-1">
          {TOP_TABS.map((tab) => (
            <button key={tab} type="button" onClick={() => setTopTab(tab)} aria-current={topTab === tab ? "page" : undefined}
              className={`!min-h-0 whitespace-nowrap border-b-2 px-3.5 py-3 text-[14px] font-semibold transition-colors ${topTab === tab ? "border-indigo-600 text-indigo-700 dark:text-indigo-300" : "border-transparent text-gray-600 hover:text-gray-900 dark:text-slate-400"}`}>{tab}</button>
          ))}
        </div>
      </div>

      {topTab !== "Product Performance (Sales Rep)" ? placeholder(topTab) : (<>
        {/* ── Filters ──────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
          <FilterSelect icon={<CalendarDays className="h-4 w-4 text-gray-500" />} label="Period" value={preset} onChange={(value) => {
            if (value === "custom") { setPreset("custom"); return; }
            setPreset(value as PresetKey); setWindow(presetRange(value as PresetKey, todayKey));
          }} options={[...PERIODS.map((key) => ({ value: key, label: PRESET_LABEL[key] })), { value: "custom", label: "Custom range" }]} className="col-span-2 sm:w-[150px]" />
          <DateRange value={window} todayKey={todayKey} onChange={(next) => { setPreset("custom"); setWindow(next); }} />
          <FilterSelect label="Sales rep" value={repFilter} onChange={setRepFilter} options={[{ value: ALL, label: "All Sales Reps" }, ...options.reps.map(([id, name]) => ({ value: id, label: name }))]} className="sm:w-[170px]" />
          <FilterSelect label="Product" value={productFilter} onChange={setProductFilter} options={[{ value: ALL, label: "All Products" }, ...options.products.map(([id, name]) => ({ value: id, label: name }))]} className="sm:w-[170px]" />
          <FilterSelect label="Order source" value={sourceFilter} onChange={setSourceFilter} options={[{ value: ALL, label: "All Order Sources" }, ...options.sources.map((source) => ({ value: source, label: source }))]} className="sm:w-[170px]" />
          <FilterSelect label="State" value={stateFilter} onChange={setStateFilter} options={[{ value: ALL, label: "All States" }, ...options.states.map((state) => ({ value: state, label: state }))]} className="sm:w-[150px]" />
          <button type="button" onClick={resetFilters} className="!min-h-0 col-span-2 justify-end sm:ml-auto inline-flex h-9 items-center gap-1.5 px-2 text-[13px] font-semibold text-indigo-700 hover:underline dark:text-indigo-300"><RotateCcw className="h-4 w-4" /> Reset Filters</button>
        </div>

        {/* ── KPI cards ────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <KpiCard icon={<ShoppingCart className="h-5 w-5" />} tone="bg-violet-100 text-violet-600" value={nf(total.placed)} label="Total Orders" compare={compareLabel(preset)} delta={change(total.placed, prior.placed)} />
          <KpiCard icon={<Truck className="h-5 w-5" />} tone="bg-emerald-100 text-emerald-600" value={nf(total.delivered)} label="Delivered Orders" compare={compareLabel(preset)} delta={change(total.delivered, prior.delivered)} />
          <KpiCard icon={<Percent className="h-5 w-5" />} tone="bg-rose-100 text-rose-600" value={rate === null ? "—" : `${Math.round(rate)}%`} label="Delivery Rate" compare={compareLabel(preset)} delta={rate === null || priorRate === null ? null : rate - priorRate} points />
          <KpiCard icon={<CirclePercent className="h-5 w-5" />} tone="bg-emerald-100 text-emerald-600" value={aov === null ? "—" : money(aov)} label="Delivered AOV" compare={compareLabel(preset)} delta={aov === null || priorAov === null ? null : change(aov, priorAov)} />
          <KpiCard icon={<BarChart3 className="h-5 w-5" />} tone="bg-blue-100 text-blue-600" value={money(total.revenue)} label="Revenue (Delivered)" compare={compareLabel(preset)} delta={change(total.revenue, prior.revenue)} />
          <KpiCard icon={<Trophy className="h-5 w-5" />} tone="bg-amber-100 text-amber-600" value={money(bonus)} label="Total Rep Bonus" />
        </div>

        {total.placed === 0 ? (
          <div className="rounded-2xl border border-gray-200 bg-white px-6 py-14 text-center text-[14px] text-gray-500 shadow-sm dark:border-slate-800 dark:bg-slate-900">No orders found for the selected filters.</div>
        ) : (<>
          {/* ── Three cards ────────────────────────────────────────────── */}
          <div className="grid gap-4 lg:grid-cols-3">
            <Card title="Top Performing Products (All Reps)" sub="Based on delivered orders this period"
              action={model.products.length > 4 && <button type="button" onClick={() => setAllTop((open) => !open)} className="!min-h-0 rounded-lg border border-indigo-100 bg-indigo-50 px-3 py-1 text-[12.5px] font-semibold text-indigo-700 dark:border-indigo-500/20 dark:bg-indigo-500/10 dark:text-indigo-300">{allTop ? "Show Less" : "View All"}</button>}>
              <ol className="m-0 list-none space-y-3 p-0">
                {(allTop ? model.products : model.products.slice(0, 4)).map((product, index) => {
                  const share = total.delivered > 0 ? (product.stat.delivered / total.delivered) * 100 : 0;
                  return (
                    <li key={product.key} className="flex items-center gap-3">
                      <RankBadge rank={index + 1} />
                      <ProductThumb src={imageOf(product.key)} name={product.name} size={40} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] font-semibold text-gray-900 dark:text-slate-100">{product.name}</div>
                        <div className="text-[11.5px] text-gray-500">{nf(product.stat.delivered)} delivered</div>
                        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-gray-100 dark:bg-slate-800"><div className="h-full rounded-full" style={{ width: `${share}%`, background: colorOf(product.key) === OTHERS_COLOR ? "#94a3b8" : colorOf(product.key) }} /></div>
                      </div>
                      <div className="w-14 shrink-0 text-right"><div className="text-[15px] font-black text-gray-900 dark:text-slate-100">{Math.round(share)}%</div><div className="text-[10.5px] text-gray-400">of total</div></div>
                    </li>
                  );
                })}
              </ol>
            </Card>

            <Card title="Delivered Orders by Product" sub="Share of delivered orders">
              <DeliveredDonut total={total.delivered} slices={[
                ...model.named.slice(0, 4).map((product) => ({ label: product.name, value: product.stat.delivered, color: colorOf(product.key) })),
                ...(model.rest.length ? [{ label: "Others", value: model.rest.reduce((sum, product) => sum + product.stat.delivered, 0), color: OTHERS_COLOR }] : [])
              ]} />
            </Card>

            <Card title="Product Performance by Sales Rep"
              action={<FilterSelect label="Measure" value={barMetric} onChange={(value) => setBarMetric(value as BarMetric)} options={[{ value: "delivered", label: "Delivered Orders" }, { value: "placed", label: "Placed Orders" }, { value: "revenue", label: "Delivered Revenue" }]} className="w-[150px] shrink-0" />}>
              <RepBars
                rows={model.repIds.map((id) => ({
                  name: nameOfRep(id),
                  parts: [...model.named.map((product) => ({ key: product.key, label: product.name, color: colorOf(product.key), stat: statOf([product.key], id) })),
                    ...(model.rest.length ? [{ key: OTHERS, label: "Others", color: OTHERS_COLOR, stat: statOf(model.rest.map((p) => p.key), id) }] : [])]
                }))}
                metric={barMetric}
              />
              <div className="mt-4 flex flex-wrap gap-x-3 gap-y-1.5 text-[11.5px] text-gray-600 dark:text-slate-400">
                {model.named.map((product) => <span key={product.key} className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: colorOf(product.key) }} />{product.name}</span>)}
                {model.rest.length > 0 && <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: OTHERS_COLOR }} />Others</span>}
              </div>
            </Card>
          </div>

          {/* ── Breakdown ──────────────────────────────────────────────── */}
          <div className="flex flex-col gap-3 2xl:flex-row 2xl:items-center 2xl:justify-between">
            <div className="-mx-1 overflow-x-auto"><div className="flex min-w-max gap-2 px-1">
              {LOWER_TABS.map((tab) => (
                <button key={tab} type="button" onClick={() => setLowerTab(tab)}
                  className={`!min-h-0 whitespace-nowrap rounded-xl px-4 py-2.5 text-[13.5px] font-semibold transition-colors ${lowerTab === tab ? "bg-indigo-600 text-white shadow-sm" : "border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"}`}>{tab}</button>
              ))}
            </div></div>
            {lowerTab === "Product Breakdown by Sales Rep" && (
              <div className="flex flex-wrap items-center gap-2">
                <label className="relative block w-full sm:w-[220px]">
                  <span className="sr-only">Search product</span>
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                  <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search product..." className="h-10 w-full rounded-xl border border-gray-200 bg-white pl-9 pr-3 text-[13px] outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" />
                </label>
                <div className="flex gap-1">
                  {([["table", "Table View", Table2], ["chart", "Chart View", BarChart3]] as const).map(([key, label, Icon]) => (
                    <button key={key} type="button" onClick={() => setView(key)} aria-pressed={view === key}
                      className={`!min-h-0 inline-flex h-10 items-center gap-1.5 rounded-xl px-3.5 text-[13px] font-semibold ${view === key ? "border border-indigo-500 bg-white text-indigo-700 dark:bg-slate-900 dark:text-indigo-300" : "text-gray-600 hover:bg-gray-100 dark:text-slate-300"}`}><Icon className="h-4 w-4" />{label}</button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {lowerTab !== "Product Breakdown by Sales Rep" ? placeholder(lowerTab) : view === "chart" ? (
            <RateChart rows={tableRows.filter((row) => !row.child)} repIds={model.repIds} nameOfRep={nameOfRep} statOf={statOf} target={target} />
          ) : (
            <BreakdownTable rows={tableRows} repIds={model.repIds} nameOfRep={nameOfRep} statOf={statOf} target={target} imageOf={imageOf}
              allKeys={model.products.map((product) => product.key)} othersOpen={othersOpen} onToggleOthers={() => setOthersOpen((open) => !open)}
              onOpenCell={(productKey, repId) => setCell({ productKey, repId })} />
          )}
          <p className="m-0 text-[11.5px] text-gray-500 dark:text-slate-400">Orders placed {periodLabel}. Delivered = of those orders, how many are delivered now. DR = delivered ÷ placed (green at or above the {target}% target). AOV = delivered revenue ÷ delivered orders. Tap a rep's figures to see the orders.</p>
        </>)}
      </>)}

      {cell && (() => {
        const productName = model.products.find((product) => product.key === cell.productKey)?.name ?? "Product";
        const list = current.filter((order) => order.productKey === cell.productKey && (order.repId ?? "") === cell.repId);
        const stat = statOf([cell.productKey], cell.repId);
        return (
          <SidePanel title={`${nameOfRep(cell.repId)} · ${productName}`} subtitle={`${stat.placed} placed · ${stat.delivered} delivered · ${rateOf(stat) === null ? "—" : `${Math.round(rateOf(stat)!)}%`} · ${periodLabel}`} onClose={() => setCell(null)}>
            <ul className="m-0 list-none divide-y divide-gray-100 p-0 dark:divide-slate-800">
              {list.map((order) => (
                <li key={order.id}>
                  <button type="button" onClick={() => onOpenOrder(order.id)} className="!min-h-0 flex w-full items-center gap-3 py-3 text-left hover:bg-gray-50 dark:hover:bg-slate-900">
                    <div className="min-w-0 flex-1">
                      <div className="text-[13.5px] font-semibold text-gray-900 dark:text-slate-100">#{order.id} · {order.customer || "Customer"}</div>
                      <div className="text-[12px] text-gray-500">{order.state || "No state"} · placed {longDate(order.createdKey)}</div>
                    </div>
                    <StatusChip status={order.status} />
                    <div className="w-24 shrink-0 text-right text-[13px] font-semibold text-gray-900 dark:text-slate-100">{money(order.amount)}</div>
                  </button>
                </li>
              ))}
            </ul>
          </SidePanel>
        );
      })()}

      {helpOpen && createPortal(
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-slate-900/40 p-4 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="rpp-help">
          <div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl dark:bg-slate-900">
            <div className="flex items-start justify-between gap-3">
              <h2 id="rpp-help" className="m-0 text-[17px] font-bold text-gray-900 dark:text-slate-100">How to use this page</h2>
              <button type="button" onClick={() => setHelpOpen(false)} aria-label="Close" className="!min-h-0 rounded-lg p-1 text-gray-500 hover:bg-gray-100"><X className="h-5 w-5" /></button>
            </div>
            <ul className="m-0 mt-3 list-disc space-y-2 pl-5 text-[13.5px] text-gray-700 dark:text-slate-300">
              <li>Pick a period and filters at the top. Every card and the table follow them.</li>
              <li>The table shows each rep on each product: orders placed, how many of those are delivered, the delivery rate (DR) and the average delivered order (AOV).</li>
              <li>A rep can look fine overall and still be weak on one product. Look for red DR figures in a rep's column.</li>
              <li>DR colours: green at or above the {target}% delivery target, amber within 15 points of it, red below that. Fewer than 5 orders is too few to judge.</li>
              <li>Tap a rep's figures to see the orders behind them, and open any order.</li>
              <li>"vs last week" compares with the same number of days just before the period.</li>
            </ul>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

// ── Pieces ──────────────────────────────────────────────────────────────────

function FilterSelect({ value, onChange, options, label, icon, className = "" }: {
  value: string; onChange: (value: string) => void; options: Array<{ value: string; label: string }>; label: string; icon?: ReactNode; className?: string;
}) {
  return (
    <label className={`relative block ${className}`}>
      <span className="sr-only">{label}</span>
      {icon && <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2">{icon}</span>}
      <select value={value} onChange={(event) => onChange(event.target.value)}
        className={`!min-h-0 h-10 w-full appearance-none truncate rounded-xl border border-gray-200 bg-white ${icon ? "pl-9" : "pl-3"} pr-8 text-[13px] font-medium text-gray-800 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100`}>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
    </label>
  );
}

function DateRange({ value, todayKey, onChange }: { value: DateWindow; todayKey: string; onChange: (next: DateWindow) => void }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const ref = useClickAway<HTMLDivElement>(open, close);
  return (
    <div className="relative col-span-2" ref={ref}>
      <button type="button" onClick={() => setOpen((o) => !o)} className="!min-h-0 inline-flex h-10 w-full items-center justify-between gap-2 sm:w-auto rounded-xl border border-gray-200 bg-white px-3 text-[13px] text-gray-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
        {longDate(value.start)} – {longDate(value.end)} <ArrowUpDown className="h-3.5 w-3.5 text-gray-400" />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 grid w-64 grid-cols-2 gap-2 rounded-xl border border-gray-200 bg-white p-3 text-[11px] text-gray-500 shadow-xl dark:border-slate-700 dark:bg-slate-900">
          <label>From<input type="date" value={value.start} max={value.end} onChange={(e) => e.target.value && onChange({ ...value, start: e.target.value })} className="mt-0.5 w-full rounded-md border border-gray-200 px-2 py-1 text-[12px] text-gray-800 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100" /></label>
          <label>To<input type="date" value={value.end} min={value.start} onChange={(e) => e.target.value && onChange({ ...value, end: e.target.value })} className="mt-0.5 w-full rounded-md border border-gray-200 px-2 py-1 text-[12px] text-gray-800 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100" /></label>
        </div>
      )}
    </div>
  );
}

function KpiCard({ icon, tone, value, label, delta, points = false, compare = "" }: { icon: ReactNode; tone: string; value: string; label: string; delta?: number | null; points?: boolean; compare?: string }) {
  const size = value.length > 10 ? "text-[16px] sm:text-[17px]" : value.length > 7 ? "text-[18px] sm:text-[19px]" : "text-[20px] sm:text-[22px]";
  const deltaText = delta === undefined ? null : delta === null ? <span className="text-[11px] text-gray-400">—</span> : (
    <span className={`inline-flex shrink-0 items-center gap-0.5 whitespace-nowrap text-[11.5px] font-bold ${delta >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
      {delta >= 0 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}{Math.abs(Math.round(delta))}{points ? " pts" : "%"}
    </span>
  );
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-gray-200 bg-white p-3 shadow-sm sm:p-3.5 dark:border-slate-800 dark:bg-slate-900">
      <span className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full sm:h-11 sm:w-11 ${tone} dark:bg-white/5`}>{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-1">
          <div className={`whitespace-nowrap font-black tracking-tight text-gray-900 dark:text-slate-50 ${size}`}>{value}</div>
          {deltaText && <div className="hidden shrink-0 text-right leading-tight 2xl:block">{deltaText}<div className="text-[10px] text-gray-400">{compare}</div></div>}
        </div>
        <div className="mt-0.5 truncate text-[12px] text-gray-500 dark:text-slate-400" title={label}>{label}</div>
        {deltaText && <div className="mt-0.5 flex items-center gap-1 text-[10.5px] text-gray-400 2xl:hidden">{deltaText}<span className="truncate">{compare}</span></div>}
      </div>
    </div>
  );
}

function Card({ title, sub, action, children }: { title: string; sub?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="min-w-0 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0"><h2 className="m-0 text-[15px] font-bold text-gray-900 dark:text-slate-100">{title}</h2>{sub && <p className="m-0 mt-0.5 text-[12px] text-gray-500">{sub}</p>}</div>
        {action}
      </div>
      {children}
    </section>
  );
}

function RankBadge({ rank }: { rank: number }) {
  const tone = rank === 1 ? "bg-amber-100 text-amber-700 ring-amber-300" : rank === 2 ? "bg-slate-100 text-slate-600 ring-slate-300" : rank === 3 ? "bg-orange-100 text-orange-700 ring-orange-300" : "bg-blue-50 text-blue-700 ring-blue-200";
  return <span className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-black ring-2 ${tone}`}>{rank}</span>;
}

function DeliveredDonut({ total, slices }: { total: number; slices: Array<{ label: string; value: number; color: string }> }) {
  const sum = slices.reduce((s, slice) => s + slice.value, 0);
  const r = 40, c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row">
      <div className="relative h-[170px] w-[170px] shrink-0">
        <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90" role="img" aria-label="Delivered orders by product">
          <circle cx={50} cy={50} r={r} fill="none" stroke="#eef2f7" strokeWidth={16} />
          {sum > 0 && slices.filter((slice) => slice.value > 0).map((slice) => {
            const length = (slice.value / sum) * c;
            const el = <circle key={slice.label} cx={50} cy={50} r={r} fill="none" stroke={slice.color} strokeWidth={16} strokeDasharray={`${Math.max(0, length - 0.8)} ${c}`} strokeDashoffset={-offset}><title>{`${slice.label}: ${slice.value}`}</title></circle>;
            offset += length;
            return el;
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
          <div className="text-[24px] font-black leading-none text-gray-900 dark:text-slate-50">{nf(total)}</div>
          <div className="mt-1 text-[11px] leading-tight text-gray-500">Delivered<br />Orders</div>
        </div>
      </div>
      <ul className="m-0 w-full list-none space-y-2.5 p-0">
        {slices.map((slice) => (
          <li key={slice.label} className="flex items-start gap-2 text-[12.5px]">
            <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: slice.color }} />
            <span className="min-w-0"><span className="block truncate text-gray-700 dark:text-slate-300">{slice.label}</span>
              <span className="text-gray-900 dark:text-slate-100">{sum > 0 ? Math.round((slice.value / sum) * 100) : 0}% ({nf(slice.value)})</span></span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function RepBars({ rows, metric }: { rows: Array<{ name: string; parts: Array<{ key: string; label: string; color: string; stat: Stat }> }>; metric: BarMetric }) {
  const value = (stat: Stat) => (metric === "delivered" ? stat.delivered : metric === "placed" ? stat.placed : stat.revenue);
  const totals = rows.map((row) => row.parts.reduce((sum, part) => sum + value(part.stat), 0));
  const max = Math.max(1, ...totals);
  return (
    <ul className="m-0 list-none space-y-3.5 p-0">
      {rows.map((row, index) => (
        <li key={row.name} className="flex items-center gap-3">
          <span className="w-28 shrink-0 truncate text-[13px] font-medium text-gray-800 dark:text-slate-200" title={row.name}>{row.name}</span>
          <div className="flex h-3.5 min-w-0 flex-1 overflow-hidden rounded-full bg-gray-100 dark:bg-slate-800">
            <div className="flex h-full" style={{ width: `${(totals[index] / max) * 100}%` }}>
              {row.parts.filter((part) => value(part.stat) > 0).map((part) => (
                <span key={part.key} className="h-full" style={{ width: `${(value(part.stat) / Math.max(1, totals[index])) * 100}%`, background: part.color }} title={`${part.label}: ${metric === "revenue" ? money(value(part.stat)) : nf(value(part.stat))}`} />
              ))}
            </div>
          </div>
          <span className="w-16 shrink-0 text-right text-[13px] font-semibold text-gray-900 dark:text-slate-100">{metric === "revenue" ? money(totals[index]) : nf(totals[index])}</span>
        </li>
      ))}
    </ul>
  );
}

function rateTone(rate: number | null, placed: number, target: number) {
  if (rate === null) return "text-gray-400 dark:text-slate-500";
  if (placed < 5) return "text-gray-500 dark:text-slate-400";
  return rate >= target ? "text-emerald-600" : rate >= target - 15 ? "text-amber-600" : "text-rose-600";
}

function BreakdownTable({ rows, repIds, nameOfRep, statOf, target, imageOf, allKeys, othersOpen, onToggleOthers, onOpenCell }: {
  rows: Array<{ key: string; name: string; keys: string[]; isOthers?: boolean; child?: boolean }>;
  repIds: string[]; nameOfRep: (id: string) => string; statOf: (keys: string[], repId?: string) => Stat; target: number;
  imageOf: (key: string) => string | null; allKeys: string[]; othersOpen: boolean; onToggleOthers: () => void; onOpenCell: (productKey: string, repId: string) => void;
}) {
  const th = "px-2 py-2 text-[11px] font-medium text-gray-500 dark:text-slate-400";
  const td = "px-2 py-3 text-center text-[13px] text-gray-800 dark:text-slate-200";
  // No base text colour here: it would beat the green / amber / red.
  const tdRate = "px-2 py-3 text-center text-[13px] font-bold";
  const repCells = (keys: string[], clickKey: string | null, bold = false) => repIds.map((id) => {
    const stat = statOf(keys, id), rate = rateOf(stat), aov = aovOf(stat);
    const open = clickKey && stat.placed > 0 ? () => onOpenCell(clickKey, id) : undefined;
    const click = open ? { onClick: open, className: "cursor-pointer hover:bg-indigo-50/60 dark:hover:bg-indigo-500/10", title: `${nameOfRep(id)}: show the orders` } : { className: "" };
    return (
      <CellGroup key={id}>
        <td {...click} className={`${td} border-l border-gray-100 dark:border-slate-800 ${bold ? "font-bold" : ""} ${click.className}`}
          tabIndex={open ? 0 : undefined} role={open ? "button" : undefined} aria-label={open ? `${nameOfRep(id)}: show the orders` : undefined}
          onKeyDown={open ? (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); open(); } } : undefined}>{stat.placed}</td>
        <td {...click} className={`${td} ${bold ? "font-bold" : ""} ${click.className}`}>{stat.delivered}</td>
        <td {...click} className={`${tdRate} ${rateTone(rate, stat.placed, target)} ${click.className}`}>{rate === null ? "-" : `${Math.round(rate)}%`}</td>
        <td {...click} className={`${td} whitespace-nowrap ${bold ? "font-bold" : ""} ${click.className}`}>{aov === null ? "-" : money(aov)}</td>
      </CellGroup>
    );
  });
  const teamCells = (keys: string[], bold = false) => {
    const stat = statOf(keys), rate = rateOf(stat);
    return (
      <>
        <td className={`${td} border-l border-gray-200 bg-slate-50 font-bold dark:border-slate-700 dark:bg-slate-800/50`}>{stat.placed}</td>
        <td className={`${td} bg-slate-50 font-bold dark:bg-slate-800/50`}>{stat.delivered}</td>
        <td className={`${tdRate} bg-slate-50 dark:bg-slate-800/50 ${rateTone(rate, stat.placed, target)}`}>{rate === null ? "-" : `${Math.round(rate)}%`}</td>
        <td className={`${td} whitespace-nowrap bg-slate-50 dark:bg-slate-800/50 ${bold ? "font-black" : "font-bold"}`}>{money(stat.revenue)}</td>
      </>
    );
  };
  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="max-h-[70vh] overflow-auto">
        <table className="w-full min-w-max border-collapse">
          <thead className="sticky top-0 z-20 bg-white dark:bg-slate-900">
            <tr className="border-b border-gray-100 dark:border-slate-800">
              <th rowSpan={2} className="sticky left-0 z-30 min-w-[150px] bg-white px-3 text-left text-[12px] font-medium text-gray-600 dark:bg-slate-900 dark:text-slate-300">Product <ArrowUpDown className="inline h-3 w-3" /></th>
              {repIds.map((id) => (
                <th key={id} colSpan={4} className="border-l border-gray-100 px-2 py-2.5 dark:border-slate-800">
                  <span className="inline-flex items-center gap-2 text-[13px] font-bold text-gray-900 dark:text-slate-100"><Avatar name={nameOfRep(id)} size={26} />{nameOfRep(id)}</span>
                </th>
              ))}
              <th colSpan={4} className="border-l border-gray-200 bg-slate-50 px-2 py-2.5 text-[13px] font-bold text-gray-900 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-100">Team Total</th>
            </tr>
            <tr className="border-b border-gray-200 dark:border-slate-700">
              {repIds.map((id) => (
                <CellGroup key={id}><th className={`${th} border-l border-gray-100 dark:border-slate-800`}>Placed</th><th className={th}>Delivered</th><th className={th}>DR %</th><th className={th}>AOV</th></CellGroup>
              ))}
              <th className={`${th} border-l border-gray-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/50`}>Placed</th><th className={`${th} bg-slate-50 dark:bg-slate-800/50`}>Delivered</th><th className={`${th} bg-slate-50 dark:bg-slate-800/50`}>DR %</th><th className={`${th} bg-slate-50 dark:bg-slate-800/50`}>Revenue</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
            {rows.length === 0 && <tr><td colSpan={1 + (repIds.length + 1) * 4} className="px-4 py-10 text-center text-[13px] text-gray-500">No product matches your search.</td></tr>}
            {rows.map((row) => (
              <tr key={`${row.key}${row.child ? "-c" : ""}`} className="hover:bg-gray-50/70 dark:hover:bg-slate-800/40">
                <th scope="row" className={`sticky left-0 z-10 bg-white px-3 py-2 text-left dark:bg-slate-900 ${row.child ? "pl-8" : ""}`}>
                  {row.isOthers ? (
                    <button type="button" onClick={onToggleOthers} aria-expanded={othersOpen} className="!min-h-0 inline-flex items-center gap-2 text-[12.5px] font-semibold text-gray-900 dark:text-slate-100">
                      <ChevronDown className={`h-4 w-4 text-gray-400 transition-transform ${othersOpen ? "" : "-rotate-90"}`} />{row.name}
                    </button>
                  ) : (
                    <span className="flex items-center gap-2.5">
                      <ProductThumb src={imageOf(row.key)} name={row.name} size={row.child ? 28 : 34} />
                      <span className="max-w-[120px] text-[12.5px] font-semibold leading-tight text-gray-900 dark:text-slate-100">{row.name}</span>
                    </span>
                  )}
                </th>
                {repCells(row.keys, row.isOthers ? null : row.key)}
                {teamCells(row.keys)}
              </tr>
            ))}
            <tr className="border-t-2 border-gray-200 dark:border-slate-700">
              <th scope="row" className="sticky left-0 z-10 bg-white px-3 py-3 text-left text-[13px] font-bold text-gray-900 dark:bg-slate-900 dark:text-slate-100">Rep Total</th>
              {repCells(allKeys, null, true)}
              {teamCells(allKeys, true)}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Groups one rep's cells (a keyed fragment). */
function CellGroup({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

function RateChart({ rows, repIds, nameOfRep, statOf, target }: {
  rows: Array<{ key: string; name: string; keys: string[] }>; repIds: string[]; nameOfRep: (id: string) => string; statOf: (keys: string[], repId?: string) => Stat; target: number;
}) {
  const data = rows.map((row) => {
    const entry: Record<string, string | number | null> = { product: row.name.length > 18 ? `${row.name.slice(0, 17)}…` : row.name };
    for (const id of repIds) { const stat = statOf(row.keys, id); entry[id] = stat.placed > 0 ? Math.round(rateOf(stat)!) : null; }
    return entry;
  });
  const colors = ["#3b82f6", "#8b5cf6", "#22c55e", "#f59e0b", "#ef4444", "#14b8a6", "#64748b", "#ec4899"];
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <h3 className="m-0 text-[14px] font-bold text-gray-900 dark:text-slate-100">Delivery rate by product and rep</h3>
      <p className="m-0 mt-0.5 text-[12px] text-gray-500">Target {target}%. A missing bar means the rep had no orders for that product.</p>
      <div className="mt-3 h-[360px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
            <XAxis dataKey="product" tick={{ fontSize: 11 }} interval={0} />
            <YAxis tick={{ fontSize: 11 }} domain={[0, 100]} unit="%" />
            <Tooltip formatter={(value: number, name: string) => [`${value}%`, nameOfRep(name)]} />
            <Legend formatter={(value: string) => nameOfRep(value)} wrapperStyle={{ fontSize: 12 }} />
            {repIds.map((id, index) => <Bar key={id} dataKey={id} fill={colors[index % colors.length]} radius={[4, 4, 0, 0]} />)}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function StatusChip({ status }: { status: string }) {
  const tone = status === "Delivered" ? "bg-emerald-50 text-emerald-700" : status === "Cancelled" || status === "Failed" ? "bg-rose-50 text-rose-700" : "bg-amber-50 text-amber-700";
  return <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${tone}`}>{status}</span>;
}
