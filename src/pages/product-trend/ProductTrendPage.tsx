import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import {
  ArrowUpDown, BarChart3, Bookmark, Boxes, CalendarDays, CirclePercent, Columns3, Download, Ellipsis, Grid3x3, LineChart as LineChartIcon, Loader2,
  MapPin, Package, RotateCcw, Search, Star, TrendingUp, Truck, UserRound, X
} from "lucide-react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { productMediaApi, type ProductMedia } from "../../lib/api";
import {
  ALL, EMPTY_FILTERS, MIN_RATE_SAMPLE, TREND_METRICS, buildCostBook, buildProductRows, buildStateRows, daysBetween, filterOrders, growthPct,
  mapStateName, previousPeriod, seriesOver, stateLabel, type Granularity, type ProductRow, type TrendAgent, type TrendExpense, type TrendFilters,
  type TrendHub, type TrendMetric, type TrendOrder, type TrendProduct
} from "./product-trend-model";
import { Delta, NigeriaMap, Panel, ProductThumb, SERIES_COLORS, Segmented, SelectBox, Sparkline, downloadCsv, nf, pct1, useClickAway, type MapDatum } from "./parts";
import { ProductDetailPanel } from "./DetailPanels";
import { HeatmapTab, StateBreakdownTab } from "./TabsStatesHeatmap";
import { AgentPerformanceTab, TrendsOverTimeTab } from "./TabsAgentsTime";
import { StockRecommendationTab } from "./TabStock";
import type { TabCtx, TransferRequest, TrendModel } from "./tab-context";

// ── Product Trend (Bright's designs, 20 Oct 2026) ───────────────────────────
// A sidebar page with six tabs, each laid out as Bright's design for it.
// Figures use Finance's definitions (see product-trend-model.ts); orders come
// from the same server summary Finance reads, for the period and for the same
// length of time before it (the "vs previous period" figures).
// Stock Recommendation shares WAREHOUSE stock across states. It recommends;
// it never moves stock - its button opens the normal Create Waybill form.

export type ProductTrendPageProps = {
  products: TrendProduct[];
  agents: TrendAgent[];
  hubs: TrendHub[];
  expenses: TrendExpense[];
  /** Orders placed in [from, to], already in TrendOrder shape. */
  loadOrders: (from: string, to: string) => Promise<TrendOrder[]>;
  /** Net profit is for Owner / Admin (Manager has no Finance page). */
  canSeeProfit: boolean;
  formatMoney: (value: number) => string;
  /** Who may create stock transfers (Owner / Admin / inventory roles). */
  canCreateTransfer: boolean;
  onCreateTransfer?: (request: TransferRequest) => void;
  onOpenReplenishment?: () => void;
  onOpenProducts?: () => void;
};

type TabKey = "trend" | "states" | "heatmap" | "agents" | "time" | "stock";
const TABS: Array<{ key: TabKey; label: string; Icon: typeof BarChart3 }> = [
  { key: "trend", label: "Product Trend", Icon: BarChart3 },
  { key: "states", label: "State Breakdown", Icon: MapPin },
  { key: "heatmap", label: "Product × State Heatmap", Icon: Grid3x3 },
  { key: "agents", label: "Agent Performance", Icon: UserRound },
  { key: "time", label: "Trends Over Time", Icon: LineChartIcon },
  { key: "stock", label: "Stock Recommendation", Icon: Boxes }
];
const SUBTITLE: Record<TabKey, string> = {
  trend: "See your best performing products and the states driving the most orders and deliveries. Use real data to plan stock, focus on high-demand states and make smarter decisions.",
  states: "See your best performing products and the states driving the most orders and deliveries. Use real data to plan stock, focus on high-demand states and make smarter decisions.",
  heatmap: "See your best performing products and the states driving the most orders and deliveries. Use real data to plan stock, focus on high-demand states and make smarter decisions.",
  agents: "See your best performing products and the states driving the most orders and deliveries. Use real data to plan stock, focus on high-demand states and make smarter decisions.",
  time: "See how your products, states and agents perform over time. Track trends, compare periods and forecast future demand.",
  stock: "See your best performing products and the states driving the most orders and deliveries. Use real data to plan stock, focus on high-demand states and make smarter decisions."
};

const STATUSES = ["New", "Confirmed", "In Process", "Dispatched", "Postponed", "Delivered", "Failed", "Cancelled"];

const lagosToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Lagos" });
const shiftDay = (key: string, days: number) => {
  const date = new Date(`${key}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};
const monthStart = (key: string) => `${key.slice(0, 7)}-01`;
const longDate = (key: string) => new Date(`${key}T12:00:00Z`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });

type Range = { from: string; to: string };
const PRESETS: Array<{ label: string; range: () => Range }> = [
  { label: "Today", range: () => ({ from: lagosToday(), to: lagosToday() }) },
  { label: "Yesterday", range: () => ({ from: shiftDay(lagosToday(), -1), to: shiftDay(lagosToday(), -1) }) },
  { label: "Last 7 days", range: () => ({ from: shiftDay(lagosToday(), -6), to: lagosToday() }) },
  { label: "Last 14 days", range: () => ({ from: shiftDay(lagosToday(), -13), to: lagosToday() }) },
  { label: "Last 30 days", range: () => ({ from: shiftDay(lagosToday(), -29), to: lagosToday() }) },
  { label: "This month", range: () => ({ from: monthStart(lagosToday()), to: lagosToday() }) },
  { label: "Last month", range: () => { const end = shiftDay(monthStart(lagosToday()), -1); return { from: monthStart(end), to: end }; } },
  { label: "Last 90 days", range: () => ({ from: shiftDay(lagosToday(), -89), to: lagosToday() }) }
];
const defaultRange = () => PRESETS[5].range();

type Applied = Range & TrendFilters & { metric: TrendMetric; grain: Granularity; stockStatus: string };
const DEFAULT_EXTRAS = { metric: "delivered" as TrendMetric, grain: "daily" as Granularity, stockStatus: ALL };

// "Save View" keeps the filters on THIS device (a per-viewer convenience).
const VIEW_KEY = "protohub.productTrend.savedView";
const loadSavedView = (): Partial<Applied> | null => {
  try { const raw = window.localStorage.getItem(VIEW_KEY); return raw ? JSON.parse(raw) : null; } catch { return null; }
};

type LeaderKey = "orders" | "delivered" | "rate" | "aov" | "net" | "name" | "growth";
type ColumnKey = "orders" | "delivered" | "rate" | "aov" | "net" | "statesOrders" | "statesDelivered" | "trend";
const COLUMN_LABELS: Record<ColumnKey, string> = {
  orders: "Total Orders", delivered: "Delivered", rate: "Delivery Rate", aov: "Delivered AOV", net: "Net Profit (Delivered)",
  statesOrders: "Top 3 States (by Orders)", statesDelivered: "Top 3 States (by Delivered)", trend: "Trend (Orders)"
};

const CHIP_TONES = [
  "bg-blue-50 text-blue-700 ring-blue-100 dark:bg-blue-500/15 dark:text-blue-200 dark:ring-blue-500/20",
  "bg-violet-50 text-violet-700 ring-violet-100 dark:bg-violet-500/15 dark:text-violet-200 dark:ring-violet-500/20",
  "bg-orange-50 text-orange-700 ring-orange-100 dark:bg-orange-500/15 dark:text-orange-200 dark:ring-orange-500/20"
];
const shortState = (state: string) => (state === "Rivers" ? "PH" : stateLabel(state));

export default function ProductTrendPage(props: ProductTrendPageProps) {
  const { products, agents, hubs, expenses, loadOrders, canSeeProfit, formatMoney } = props;
  const money = formatMoney;
  const [tab, setTab] = useState<TabKey>("trend");
  const [compare, setCompare] = useState(true);
  const [applied, setApplied] = useState<Applied>(() => ({ ...defaultRange(), ...EMPTY_FILTERS, ...DEFAULT_EXTRAS, ...(loadSavedView() ?? {}) }));
  const [draft, setDraft] = useState<Applied>(applied);
  const [savedNote, setSavedNote] = useState("");
  const [data, setData] = useState<{ key: string; orders: TrendOrder[]; previous: TrendOrder[]; at: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadTick, setReloadTick] = useState(0);
  const [images, setImages] = useState<Record<string, string>>({});
  const [detailProductId, setDetailProductId] = useState<string | null>(null);

  // ── Load the period + the period before it ────────────────────────────────
  const prev = useMemo(() => previousPeriod(applied.from, applied.to), [applied.from, applied.to]);
  const periodKey = `${applied.from}|${applied.to}`;
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    Promise.all([loadOrders(applied.from, applied.to), loadOrders(prev.from, prev.to)])
      .then(([orders, previous]) => { if (!cancelled) setData({ key: periodKey, orders, previous, at: Date.now() }); })
      .catch((err: any) => { if (!cancelled) setError(err?.message ?? "Could not load the orders."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [periodKey, prev.from, prev.to, loadOrders, applied.from, applied.to, reloadTick]);

  // Product photos: the gallery cover (or first approved photo), never a package picture.
  useEffect(() => {
    productMediaApi.list().then((result) => {
      const out: Record<string, string> = {};
      const media = (result?.media ?? []).filter((item: ProductMedia) => item.kind === "image" && item.status === "approved" && (item.thumbUrl || item.url));
      media.sort((a, b) => Number(b.isCover) - Number(a.isCover) || a.displayOrder - b.displayOrder);
      for (const item of media) if (!out[item.productId]) out[item.productId] = (item.thumbUrl || item.url)!;
      if (result?.settings?.defaultMainImageUrl) out.__default = result.settings.defaultMainImageUrl;
      setImages(out);
    }).catch(() => undefined);
  }, []);
  const imageOf = (productId: string) => images[productId] ?? images.__default ?? null;

  // ── Figures ───────────────────────────────────────────────────────────────
  const ready = data && data.key === periodKey ? data : null;
  const filters: TrendFilters = { productId: applied.productId, state: applied.state, agentId: applied.agentId, status: applied.status };
  const wholeProduct = applied.state === ALL && applied.agentId === ALL && applied.status === ALL;
  const model = useMemo(() => {
    if (!ready) return null;
    const costs = buildCostBook(ready.orders, expenses, applied.from, applied.to);
    const previousCosts = buildCostBook(ready.previous, expenses, prev.from, prev.to);
    const orders = filterOrders(ready.orders, filters);
    const previous = filterOrders(ready.previous, filters);
    const shownProducts = applied.productId === ALL ? products : products.filter((product) => product.id === applied.productId);
    const productRows = buildProductRows({ products: shownProducts, orders, previousOrders: previous, costs, previousCosts, hubs, from: applied.from, to: applied.to, wholeProduct });
    const stateRows = buildStateRows({ orders, previousOrders: previous, costs, previousCosts, hubs, productId: applied.productId });
    const out: TrendModel = { costs, previousCosts, orders, previous, productRows, stateRows };
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, expenses, products, hubs, applied.from, applied.to, applied.productId, applied.state, applied.agentId, applied.status, prev.from, prev.to, wholeProduct]);

  const totals = useMemo(() => {
    if (!model) return null;
    const sum = (pick: (row: ProductRow) => number) => model.productRows.reduce((total, row) => total + pick(row), 0);
    const orders = model.orders.length, previousOrders = model.previous.length;
    const delivered = model.orders.filter((o) => o.status === "Delivered").length;
    const previousDelivered = model.previous.filter((o) => o.status === "Delivered").length;
    const rate = orders > 0 ? (delivered / orders) * 100 : 0;
    const previousRate = previousOrders > 0 ? (previousDelivered / previousOrders) * 100 : 0;
    const topProduct = [...model.productRows].sort((a, b) => b.now.orders - a.now.orders)[0] ?? null;
    const topState = model.stateRows[0] ?? null;
    return {
      orders, previousOrders, delivered, previousDelivered, rate, previousRate,
      net: sum((row) => row.now.net), previousNet: sum((row) => row.before.net),
      revenue: sum((row) => row.now.revenue), previousRevenue: sum((row) => row.before.revenue),
      topProduct, topState
    };
  }, [model]);

  // ── Header pieces ─────────────────────────────────────────────────────────
  const rangeLabel = `${longDate(applied.from)} – ${longDate(applied.to)}`;
  const isDefaultRange = (() => { const d = defaultRange(); return d.from === applied.from && d.to === applied.to; })();
  const applyFilters = () => setApplied({ ...draft });
  const resetFilters = () => { const next = { ...defaultRange(), ...EMPTY_FILTERS, ...DEFAULT_EXTRAS }; setDraft(next); setApplied(next); };
  const saveView = () => {
    try { window.localStorage.setItem(VIEW_KEY, JSON.stringify(draft)); setSavedNote("View saved on this device"); }
    catch { setSavedNote("Could not save on this device"); }
    setApplied({ ...draft });
    window.setTimeout(() => setSavedNote(""), 2500);
  };

  const stateOptions = useMemo(() => {
    const set = new Set<string>();
    for (const order of [...(ready?.orders ?? []), ...(ready?.previous ?? [])]) if (order.state) set.add(order.state);
    return [...set].sort();
  }, [ready]);

  const exportRef = useRef<() => void>(() => undefined);
  const days = daysBetween(applied.from, applied.to) + 1;
  const ctx: TabCtx | null = model ? {
    model, products, hubs, agents, canSeeProfit, money, from: applied.from, to: applied.to, prevFrom: prev.from, prevTo: prev.to, days, exportRef, imageOf,
    onViewProduct: setDetailProductId, productId: applied.productId, state: applied.state, metric: applied.metric, grain: applied.grain, stockStatus: applied.stockStatus,
    canCreateTransfer: props.canCreateTransfer, onCreateTransfer: props.onCreateTransfer, onOpenReplenishment: props.onOpenReplenishment,
    onOnlyAgent: (agentId) => { const next = { ...applied, agentId }; setApplied(next); setDraft(next); }
  } : null;
  const onShowState = (state: string) => { const next = { ...applied, state }; setApplied(next); setDraft(next); };

  // Filter row per tab, as each design shows it.
  const productField = <Field label="Product"><SelectBox label="Product" value={draft.productId} onChange={(productId) => setDraft((d) => ({ ...d, productId }))} options={[{ value: ALL, label: "All Products" }, ...products.map((product) => ({ value: product.id, label: product.name }))]} /></Field>;
  const stateField = <Field label="State"><SelectBox label="State" value={draft.state} onChange={(state) => setDraft((d) => ({ ...d, state }))} options={[{ value: ALL, label: "All States" }, ...stateOptions.map((state) => ({ value: state, label: stateLabel(state) }))]} /></Field>;
  const agentField = (label: string) => <Field label={label}><SelectBox label={label} value={draft.agentId} onChange={(agentId) => setDraft((d) => ({ ...d, agentId }))} options={[{ value: ALL, label: "All Agents" }, ...[...agents].sort((a, b) => a.name.localeCompare(b.name)).map((agent) => ({ value: agent.id, label: agent.name }))]} /></Field>;
  const statusField = <Field label="Order Status"><SelectBox label="Order Status" value={draft.status} onChange={(status) => setDraft((d) => ({ ...d, status }))} options={[{ value: ALL, label: "All Orders" }, ...STATUSES.map((status) => ({ value: status, label: status }))]} /></Field>;
  const fields: ReactNode[] = tab === "time"
    ? [productField, stateField, agentField("Delivery Agent"),
      <Field key="m" label="Metric"><SelectBox label="Metric" value={draft.metric} onChange={(metric) => setDraft((d) => ({ ...d, metric }))} options={TREND_METRICS.map((m) => ({ value: m.key, label: m.label }))} /></Field>,
      <Field key="g" label="Group By"><SelectBox label="Group By" value={draft.grain} onChange={(grain) => setDraft((d) => ({ ...d, grain }))} options={[{ value: "daily", label: "Daily" }, { value: "weekly", label: "Weekly" }, { value: "monthly", label: "Monthly" }]} /></Field>]
    : tab === "stock"
      ? [productField, stateField, agentField("Agent"),
        <Field key="s" label="Stock Status"><SelectBox label="Stock Status" value={draft.stockStatus} onChange={(stockStatus) => setDraft((d) => ({ ...d, stockStatus }))} options={[{ value: ALL, label: "All Status" }, { value: "Critical", label: "Critical" }, { value: "High", label: "High" }, { value: "Medium", label: "Medium" }, { value: "Low", label: "Low" }]} /></Field>]
      : [productField, stateField, agentField(tab === "heatmap" ? "Delivery Agent" : "Agent"), statusField];
  const withSaveView = tab === "states" || tab === "agents" || tab === "stock";

  const tabBar = (
    <div className="flex flex-col gap-2 rounded-xl border border-gray-200 bg-white p-1 shadow-sm dark:border-slate-800 xl:flex-row xl:items-center">
    <nav className="no-scrollbar flex min-w-0 flex-1 gap-1 overflow-x-auto" role="tablist" aria-label="Product Trend views">
      {TABS.map(({ key, label, Icon }) => (
        <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)}
          className={`!min-h-0 inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-2 text-[12.5px] font-semibold transition-colors ${tab === key ? "bg-[#1F8FE0] text-white shadow-sm" : "text-gray-700 hover:bg-gray-50 dark:text-slate-300 dark:hover:bg-slate-800"}`}>
          <Icon className="h-4 w-4" />{label}
        </button>
      ))}
    </nav>
      {tab === "trend" && (
        <label className="flex shrink-0 cursor-pointer items-center gap-2 whitespace-nowrap px-2 text-[12px] font-medium text-gray-700 dark:text-slate-300">
          <button type="button" role="switch" aria-checked={compare} onClick={() => setCompare((value) => !value)}
            className={`!min-h-0 relative h-5 w-9 rounded-full transition-colors ${compare ? "bg-[#1F8FE0]" : "bg-gray-300 dark:bg-slate-600"}`}>
            <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${compare ? "left-[18px]" : "left-0.5"}`} />
          </button>
          Compare with previous period
        </label>
      )}
    </div>
  );

  return (
    <div className="space-y-4 pb-10 text-gray-900 dark:text-slate-100" data-testid="product-trend-page">
      {/* ── Title row ─────────────────────────────────────────────────── */}
      <header className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#1F8FE0] text-white shadow-md"><TrendingUp className="h-5 w-5" /></span>
          <div>
            <h1 className="m-0 text-[26px] font-black tracking-tight text-gray-900 dark:text-slate-50">Product Trend</h1>
            <p className="m-0 mt-0.5 max-w-4xl text-[13px] text-gray-500 dark:text-slate-400">{SUBTITLE[tab]}</p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2 lg:flex-nowrap">
          <span className="inline-flex h-10 items-center gap-2 whitespace-nowrap rounded-lg border border-gray-200 bg-white px-3 text-[13px] font-medium text-gray-800 dark:border-slate-700 dark:text-slate-100">
            <CalendarDays className="h-4 w-4 text-gray-500" />{rangeLabel}
            {!isDefaultRange && (
              <button type="button" aria-label="Back to this month" title="Back to this month" onClick={() => { const next = { ...applied, ...defaultRange() }; setApplied(next); setDraft(next); }}
                className="!min-h-0 rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"><X className="h-3.5 w-3.5" /></button>
            )}
          </span>
          <button type="button" onClick={() => exportRef.current()} disabled={!model}
            className="!min-h-0 inline-flex h-10 items-center gap-2 rounded-lg bg-[#1F8FE0] px-4 text-[13px] font-semibold text-white shadow-sm hover:bg-[#1a7dc4] disabled:opacity-40">
            <Download className="h-4 w-4" /> Export
          </button>
        </div>
      </header>

      {/* Tab 1 keeps its design: KPI cards above the tabs. */}
      {tab === "trend" && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <Kpi Icon={Star} tone="bg-amber-50 text-amber-500" label="Total Orders" value={totals ? nf(totals.orders) : null}
            foot={totals && compare ? <><Delta value={growthPct(totals.orders, totals.previousOrders)} /> <span>vs previous period</span></> : null} />
          <Kpi Icon={Truck} tone="bg-emerald-50 text-emerald-600" label="Total Delivered" value={totals ? nf(totals.delivered) : null}
            foot={totals && compare ? <><Delta value={growthPct(totals.delivered, totals.previousDelivered)} /> <span>vs previous period</span></> : null} />
          <Kpi Icon={CirclePercent} tone="bg-emerald-50 text-emerald-600" label="Overall Delivery Rate" value={totals ? pct1(totals.rate) : null}
            info="Of the orders placed in the period, how many are now delivered (the Orders page way). Recent orders may still be on the way."
            foot={totals && compare ? <><Delta value={totals.previousOrders > 0 ? totals.rate - totals.previousRate : null} points /> <span>vs previous period</span></> : null} />
          <Kpi Icon={Package} tone="bg-orange-50 text-orange-500" label="Top Performing Product" value={totals?.topProduct ? totals.topProduct.product.name : totals ? "—" : null} small
            foot={totals?.topProduct && totals.orders > 0 ? <span>{pct1((totals.topProduct.now.orders / totals.orders) * 100)} of total orders</span> : null} />
          <Kpi Icon={MapPin} tone="bg-rose-50 text-rose-500" label="Top Performing State" value={totals?.topState ? stateLabel(totals.topState.state) : totals ? "—" : null} small
            foot={totals?.topState && totals.orders > 0 ? <span>{pct1((totals.topState.now.orders / totals.orders) * 100)} of total orders</span> : null} />
          {canSeeProfit ? (
            <Kpi Icon={TrendingUp} tone="bg-blue-50 text-[#1F8FE0]" label="Total Net Profit (Delivered)" value={totals ? money(totals.net) : null}
              info="Delivered revenue − product cost − delivery fees − every running cost of the period (ads, salaries, rent...). Same as Finance › Product Profitability: Direct Net Profit − Shared Opex."
              foot={totals && compare ? <><Delta value={totals.previousNet > 0 ? growthPct(totals.net, totals.previousNet) : null} /> <span>vs previous period</span></> : null} />
          ) : (
            <Kpi Icon={TrendingUp} tone="bg-blue-50 text-[#1F8FE0]" label="Delivered Revenue" value={totals ? money(totals.revenue) : null}
              foot={totals && compare ? <><Delta value={growthPct(totals.revenue, totals.previousRevenue)} /> <span>vs previous period</span></> : null} />
          )}
        </div>
      )}

      {tabBar}

      {error && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-100">
          <span>Could not load the orders: {error}</span>
          <button type="button" onClick={() => setReloadTick((n) => n + 1)} className="!min-h-0 rounded-lg border border-rose-300 bg-white px-3 py-1.5 font-semibold text-rose-700">Try again</button>
        </div>
      )}

      {!ctx ? (
        <>
          <FilterRow fields={fields} draft={draft} setDraft={setDraft} onApply={applyFilters} onReset={resetFilters} onSave={withSaveView ? saveView : undefined} savedNote={savedNote} />
          <LoadingBlock loading={loading} />
        </>
      ) : (
        <TabBody tab={tab} ctx={ctx}
          filters={<FilterRow fields={fields} draft={draft} setDraft={setDraft} onApply={applyFilters} onReset={resetFilters} onSave={withSaveView ? saveView : undefined} savedNote={savedNote} />}
          trend={<TrendTab model={ctx.model} compare={compare} canSeeProfit={canSeeProfit} money={money} imageOf={imageOf} totalsOrders={totals?.orders ?? 0}
            products={products} from={applied.from} to={applied.to} exportRef={exportRef}
            onView={setDetailProductId} onOnly={(productId) => { const next = { ...applied, productId }; setApplied(next); setDraft(next); }}
            onOpenProducts={props.onOpenProducts} onShowStates={() => setTab("states")} />}
          onShowState={onShowState} />
      )}

      {ready && (
        <p className="m-0 text-[11.5px] text-gray-400">
          Orders placed {rangeLabel}, compared with {longDate(prev.from)} – {longDate(prev.to)}. Held duplicate orders are left out. Updated {new Date(ready.at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}.
          {loading && <Loader2 className="ml-1 inline h-3 w-3 animate-spin" />}
        </p>
      )}

      {detailProductId && model && (
        <ProductDetailPanel productId={detailProductId} products={products} orders={model.orders} previous={model.previous} costs={model.costs} previousCosts={model.previousCosts}
          hubs={hubs} agents={agents} canSeeProfit={canSeeProfit} money={money} imageOf={imageOf} from={applied.from} to={applied.to} onClose={() => setDetailProductId(null)} />
      )}
    </div>
  );
}

/**
 * Tab 1: filters, then its content (KPIs are above the tabs). Tabs 2-6: their
 * own KPI row comes first, then the filters, then the rest - as each design.
 * Each tab renders its KPI row at the top of its own output, so the filters
 * are slotted in after the first child.
 */
function TabBody({ tab, ctx, filters, trend, onShowState }: { tab: TabKey; ctx: TabCtx; filters: ReactNode; trend: ReactNode; onShowState: (state: string) => void }) {
  if (tab === "trend") return <>{filters}{trend}</>;
  if (tab === "heatmap") return <>{filters}<HeatmapTab ctx={ctx} /></>;
  const body = tab === "states" ? <StateBreakdownTab ctx={ctx} onShowState={onShowState} filters={filters} />
    : tab === "agents" ? <AgentPerformanceTab ctx={ctx} filters={filters} />
      : tab === "time" ? <TrendsOverTimeTab ctx={ctx} filters={filters} />
        : <StockRecommendationTab ctx={ctx} filters={filters} />;
  return body;
}

function FilterRow({ fields, draft, setDraft, onApply, onReset, onSave, savedNote }: {
  fields: ReactNode[]; draft: Applied; setDraft: (update: (d: Applied) => Applied) => void; onApply: () => void; onReset: () => void; onSave?: () => void; savedNote: string;
}) {
  return (
    <section className="rounded-2xl border border-gray-200 bg-white px-4 py-3.5 shadow-sm dark:border-slate-800">
      <div className={`grid grid-cols-1 gap-3 sm:grid-cols-2 lg:items-end ${fields.length > 4 ? "lg:grid-cols-[1.3fr_1fr_1fr_1fr_1fr_1fr_auto_auto]" : "lg:grid-cols-[1.3fr_1fr_1fr_1fr_1fr_auto_auto_auto]"}`}>
        <Field label="Date Range"><RangePicker value={draft} onChange={(range) => setDraft((d) => ({ ...d, ...range }))} /></Field>
        {fields.map((field, i) => <div key={i} className="min-w-0">{field}</div>)}
        <button type="button" onClick={onApply} className="!min-h-0 h-9 rounded-lg bg-[#1F8FE0] px-5 text-[13px] font-semibold text-white shadow-sm hover:bg-[#1a7dc4]">Apply Filters</button>
        <button type="button" onClick={onReset} className="!min-h-0 inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-gray-200 bg-white px-4 text-[13px] font-semibold text-gray-700 hover:bg-gray-50 dark:border-slate-700 dark:text-slate-200"><RotateCcw className="h-3.5 w-3.5" /> Reset</button>
        {onSave && <button type="button" onClick={onSave} title="Keep these filters on this device" className="!min-h-0 inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-gray-200 bg-white px-4 text-[13px] font-semibold text-gray-700 hover:bg-gray-50 dark:border-slate-700 dark:text-slate-200"><Bookmark className="h-3.5 w-3.5" /> Save View</button>}
      </div>
      {savedNote && <p className="m-0 mt-2 text-[11.5px] font-semibold text-emerald-700">{savedNote}</p>}
    </section>
  );
}

// ── Small pieces of tab 1 ───────────────────────────────────────────────────

function Kpi({ Icon, tone, label, value, foot, info, small = false }: { Icon: typeof Star; tone: string; label: string; value: string | null; foot: ReactNode; info?: string; small?: boolean }) {
  // Long figures step down a size instead of being cut off.
  const size = small ? "text-[15px] leading-tight line-clamp-2 break-words" : (value ?? "").length > 10 ? "text-[17px]" : (value ?? "").length > 7 ? "text-[19px]" : "text-[22px]";
  return (
    <div className="flex items-start gap-2.5 rounded-2xl border border-gray-200 bg-white p-3.5 shadow-sm dark:border-slate-800">
      <span className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${tone} dark:bg-white/5`}><Icon className="h-[18px] w-[18px]" /></span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1 text-[12px] font-medium text-gray-600 dark:text-slate-400">{label}{info && <span title={info} className="cursor-help text-gray-400">ⓘ</span>}</div>
        {value === null
          ? <div className="mt-1.5 h-6 w-20 animate-pulse rounded bg-gray-100 dark:bg-slate-800" />
          : <div className={`mt-0.5 font-black tracking-tight text-gray-900 dark:text-slate-50 ${size} ${small ? "" : "whitespace-nowrap"}`} title={value}>{value}</div>}
        {foot && <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px] text-gray-500 dark:text-slate-400">{foot}</div>}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div className="min-w-0"><div className="mb-1 text-[12px] font-semibold text-gray-800 dark:text-slate-200">{label}</div>{children}</div>;
}

function RangePicker({ value, onChange }: { value: Range; onChange: (range: Range) => void }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const ref = useClickAway<HTMLDivElement>(open, close);
  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen((o) => !o)}
        className="!min-h-0 flex h-9 w-full items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 text-left text-[13px] text-gray-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
        <CalendarDays className="h-4 w-4 shrink-0 text-gray-500" />
        <span className="truncate">{longDate(value.from)} – {longDate(value.to)}</span>
      </button>
      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 w-72 rounded-xl border border-gray-200 bg-white p-3 shadow-xl dark:border-slate-700 dark:bg-slate-900">
          <div className="grid grid-cols-2 gap-1.5">
            {PRESETS.map((preset) => (
              <button key={preset.label} type="button" onClick={() => { onChange(preset.range()); setOpen(false); }}
                className="!min-h-0 rounded-lg border border-gray-200 px-2 py-1.5 text-[12px] font-medium text-gray-700 hover:border-[#1F8FE0] hover:text-[#1F8FE0] dark:border-slate-700 dark:text-slate-200">{preset.label}</button>
            ))}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-gray-500">
            <label>From<input type="date" value={value.from} max={value.to} onChange={(e) => e.target.value && onChange({ ...value, from: e.target.value })} className="mt-0.5 w-full rounded-md border border-gray-200 px-2 py-1 text-[12px] text-gray-800 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100" /></label>
            <label>To<input type="date" value={value.to} min={value.from} max={lagosToday()} onChange={(e) => e.target.value && onChange({ ...value, to: e.target.value })} className="mt-0.5 w-full rounded-md border border-gray-200 px-2 py-1 text-[12px] text-gray-800 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100" /></label>
          </div>
          <p className="m-0 mt-2 text-[11px] text-gray-400">Press Apply Filters to load the new dates.</p>
        </div>
      )}
    </div>
  );
}

function LoadingBlock({ loading }: { loading: boolean }) {
  return (
    <div className="space-y-3 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-slate-800">
      {loading ? (
        <>
          <div className="flex items-center gap-2 text-[13px] text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading orders for the period…</div>
          {[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-10 animate-pulse rounded-lg bg-gray-100 dark:bg-slate-800" />)}
        </>
      ) : <div className="py-6 text-center text-[13px] text-gray-500">No figures to show.</div>}
    </div>
  );
}

type Model = TrendModel;

// ── Tab 1: Product Trend ────────────────────────────────────────────────────

function TrendTab({ model, compare, canSeeProfit, money, imageOf, totalsOrders, products, from, to, exportRef, onView, onOnly, onOpenProducts, onShowStates }: {
  model: Model; compare: boolean; canSeeProfit: boolean; money: (value: number) => string; imageOf: (productId: string) => string | null; totalsOrders: number;
  products: TrendProduct[]; from: string; to: string; exportRef: MutableRefObject<() => void>;
  onView: (productId: string) => void; onOnly: (productId: string) => void; onOpenProducts?: () => void; onShowStates: () => void;
}) {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ key: LeaderKey; desc: boolean }>({ key: "orders", desc: true });
  const [columns, setColumns] = useState<Record<ColumnKey, boolean>>(() => ({
    orders: true, delivered: true, rate: true, aov: true, net: canSeeProfit, statesOrders: true, statesDelivered: true, trend: true
  }));
  const [columnsOpen, setColumnsOpen] = useState(false);
  const closeColumns = useCallback(() => setColumnsOpen(false), []);
  const columnsRef = useClickAway<HTMLDivElement>(columnsOpen, closeColumns);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const closeMenu = useCallback(() => setMenuFor(null), []);
  const menuRef = useClickAway<HTMLDivElement>(menuFor !== null, closeMenu);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    const value = (row: ProductRow): number | string => {
      switch (sort.key) {
        case "name": return row.product.name.toLowerCase();
        case "orders": return row.now.orders;
        case "delivered": return row.now.delivered;
        case "rate": return row.now.orders >= MIN_RATE_SAMPLE ? row.now.rate : -1;
        case "aov": return row.now.aov;
        case "net": return row.now.net;
        case "growth": return growthPct(row.now.orders, row.before.orders) ?? -Infinity;
      }
    };
    return model.productRows
      .filter((row) => !term || row.product.name.toLowerCase().includes(term) || (row.product.sku ?? "").toLowerCase().includes(term))
      .sort((a, b) => {
        const va = value(a), vb = value(b);
        const cmp = typeof va === "string" ? va.localeCompare(vb as string) : (va as number) - (vb as number);
        return (sort.desc ? -cmp : cmp) || b.now.orders - a.now.orders;
      });
  }, [model.productRows, search, sort]);
  // Rank = place by total orders, whatever the table is sorted by.
  const rankOf = useMemo(() => {
    const map = new Map<string, number>();
    [...model.productRows].sort((a, b) => b.now.orders - a.now.orders).forEach((row, i) => map.set(row.product.id, i + 1));
    return map;
  }, [model.productRows]);

  exportRef.current = () => downloadCsv(`product-trend-${from}-to-${to}.csv`, [
    ["Rank", "Product", "SKU", "Active", "Total Orders", "Orders before", "Delivered", "Units Delivered", "Delivery Rate %", "Delivered Revenue", "Delivered AOV",
      ...(canSeeProfit ? ["Net Profit (Delivered)"] : []), "Stock with agents", "Top 3 States (by Orders)", "Top 3 States (by Delivered)"],
    ...rows.map((row) => [
      rankOf.get(row.product.id) ?? "", row.product.name, row.product.sku ?? "", row.product.active ? "Yes" : "No", row.now.orders, row.before.orders, row.now.delivered,
      row.now.unitsDelivered, row.now.rate.toFixed(1), Math.round(row.now.revenue), Math.round(row.now.aov),
      ...(canSeeProfit ? [Math.round(row.now.net)] : []), row.stockWithAgents,
      row.topStatesByOrders.map((s) => `${stateLabel(s.key)} ${s.share.toFixed(0)}%`).join("; "),
      row.topStatesByDelivered.map((s) => `${stateLabel(s.key)} ${s.share.toFixed(0)}%`).join("; ")
    ])
  ]);

  const header = (key: LeaderKey | null, label: string, align = "text-left") => (
    <th className={`sticky top-0 z-10 !border-b !border-gray-200 bg-gray-50 !px-2.5 !py-2.5 ${align} !text-[11.5px] !font-semibold !text-gray-600 dark:!border-slate-800 dark:bg-slate-900 dark:!text-slate-300`}>
      {key ? (
        <button type="button" onClick={() => setSort((s) => ({ key, desc: s.key === key ? !s.desc : key !== "name" }))} className="!min-h-0 inline-flex items-center gap-1 whitespace-nowrap">
          {label}<ArrowUpDown className={`h-3 w-3 ${sort.key === key ? "text-[#1F8FE0]" : "text-gray-400"}`} />
        </button>
      ) : <span className="whitespace-nowrap">{label}</span>}
    </th>
  );
  const cell = "!border-b !border-gray-100 !px-2.5 !py-3 align-middle dark:!border-slate-800";
  const chips = (shares: ProductRow["topStatesByOrders"]) => (
    <div className="flex gap-1">
      {shares.length === 0 ? <span className="text-[11px] text-gray-400">—</span> : shares.map((share, i) => (
        <span key={share.key} className={`inline-flex min-w-[40px] flex-col items-center rounded-md px-1 py-1 text-[10px] font-semibold leading-tight ring-1 ${CHIP_TONES[i]}`} title={`${stateLabel(share.key)}: ${share.count} (${share.share.toFixed(1)}%)`}>
          <span className="max-w-[56px] truncate">{shortState(share.key)}</span><span>{Math.round(share.share)}%</span>
        </span>
      ))}
    </div>
  );

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-slate-800">
        <div className="flex flex-col gap-3 px-4 pt-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="m-0 flex items-center gap-1.5 text-[18px] font-black text-gray-900 dark:text-slate-50">Top Performing Products <span title="Products with orders in the period. Rank is by total orders; click a heading to sort." className="cursor-help text-[12px] font-normal text-gray-400">ⓘ</span></h2>
            <p className="m-0 mt-0.5 text-[12.5px] text-gray-500 dark:text-slate-400">Ranked by total orders with detailed state performance and key metrics.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex h-9 w-full items-center gap-2 rounded-lg border border-gray-200 px-3 sm:w-56 dark:border-slate-700">
              <Search className="h-4 w-4 text-gray-400" />
              <span className="sr-only">Search product</span>
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search product..." className="!min-h-0 w-full bg-transparent text-[13px] outline-none" />
            </label>
            <div className="relative" ref={columnsRef}>
              <button type="button" onClick={() => setColumnsOpen((o) => !o)} className="!min-h-0 inline-flex h-9 items-center gap-1.5 rounded-lg border border-gray-200 px-3 text-[13px] font-semibold text-gray-700 hover:bg-gray-50 dark:border-slate-700 dark:text-slate-200"><Columns3 className="h-4 w-4" /> Columns</button>
              {columnsOpen && (
                <div className="absolute right-0 top-full z-30 mt-1 w-60 rounded-xl border border-gray-200 bg-white p-2 shadow-xl dark:border-slate-700 dark:bg-slate-900">
                  {(Object.keys(COLUMN_LABELS) as ColumnKey[]).filter((key) => key !== "net" || canSeeProfit).map((key) => (
                    <label key={key} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[12.5px] hover:bg-gray-50 dark:hover:bg-slate-800">
                      <input type="checkbox" checked={columns[key]} onChange={(e) => setColumns((c) => ({ ...c, [key]: e.target.checked }))} />{COLUMN_LABELS[key]}
                    </label>
                  ))}
                </div>
              )}
            </div>
            <button type="button" onClick={() => exportRef.current()} className="!min-h-0 inline-flex h-9 items-center gap-1.5 rounded-lg border border-gray-200 px-3 text-[13px] font-semibold text-gray-700 hover:bg-gray-50 dark:border-slate-700 dark:text-slate-200"><Download className="h-4 w-4" /> Export</button>
          </div>
        </div>
        <div className="mt-3 max-h-[640px] overflow-auto">
          <table className="w-full !min-w-[1120px] border-separate border-spacing-0 text-[13px]">
            <thead>
              <tr>
                {header(null, "#")}
                {header("name", "Product")}
                {columns.orders && header("orders", "Total Orders")}
                {columns.delivered && header("delivered", "Delivered")}
                {columns.rate && header("rate", "Delivery Rate")}
                {columns.aov && header("aov", "Delivered AOV")}
                {columns.net && canSeeProfit && header("net", "Net Profit (Delivered)")}
                {columns.statesOrders && header(null, "Top 3 States (by Orders)")}
                {columns.statesDelivered && header(null, "Top 3 States (by Delivered)")}
                {columns.trend && header("growth", "Trend (Orders)")}
                {header(null, "Actions")}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={11} className={`${cell} py-10 text-center text-gray-500`}>{search ? "No product matches the search." : "No orders in this period."}</td></tr>
              )}
              {rows.map((row) => (
                <tr key={row.product.id} className="hover:bg-gray-50/70 dark:hover:bg-slate-800/40 [&>td]:[color:inherit]">
                  <td className={`${cell} w-8 font-semibold text-gray-700`}>{rankOf.get(row.product.id)}</td>
                  <td className={`${cell} min-w-[200px]`}>
                    <div className="flex items-center gap-3">
                      <ProductThumb src={imageOf(row.product.id)} name={row.product.name} />
                      <div className="min-w-0">
                        <button type="button" onClick={() => onView(row.product.id)} className="!min-h-0 block max-w-[200px] truncate text-left text-[13px] font-semibold text-gray-900 hover:text-[#1F8FE0] dark:text-slate-100">{row.product.name}</button>
                        <span className={`mt-1 inline-block rounded px-1.5 py-0.5 text-[10.5px] font-semibold ${row.product.active ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300" : "bg-gray-100 text-gray-500 dark:bg-slate-800"}`}>{row.product.active ? "Active" : "Inactive"}</span>
                      </div>
                    </div>
                  </td>
                  {columns.orders && <td className={cell}><div className="text-[14px] font-bold">{nf(row.now.orders)}</div>{compare && <Delta value={growthPct(row.now.orders, row.before.orders)} />}</td>}
                  {columns.delivered && <td className={cell}><div className="text-[14px] font-bold">{nf(row.now.delivered)}</div>{compare && <Delta value={growthPct(row.now.delivered, row.before.delivered)} />}</td>}
                  {columns.rate && (
                    <td className={cell} title={row.now.orders < MIN_RATE_SAMPLE ? `Only ${row.now.orders} orders - too few to judge the rate.` : undefined}>
                      <div className={`text-[14px] font-bold ${row.now.orders < MIN_RATE_SAMPLE ? "text-gray-400" : ""}`}>{pct1(row.now.rate)}</div>
                      {compare && <Delta value={row.before.orders > 0 && row.now.orders > 0 ? row.now.rate - row.before.rate : null} points />}
                    </td>
                  )}
                  {columns.aov && <td className={cell}><div className="text-[14px] font-bold">{row.now.delivered > 0 ? money(row.now.aov) : "—"}</div>{compare && <Delta value={row.before.delivered > 0 && row.now.delivered > 0 ? growthPct(row.now.aov, row.before.aov) : null} />}</td>}
                  {columns.net && canSeeProfit && (
                    <td className={cell}>
                      <div className={`text-[14px] font-bold ${row.now.net < 0 ? "text-rose-600" : ""}`}>{money(row.now.net)}</div>
                      {compare && <Delta value={row.before.net > 0 ? growthPct(row.now.net, row.before.net) : null} />}
                    </td>
                  )}
                  {columns.statesOrders && <td className={cell}>{chips(row.topStatesByOrders)}</td>}
                  {columns.statesDelivered && <td className={cell}>{chips(row.topStatesByDelivered)}</td>}
                  {columns.trend && (
                    <td className={cell}>
                      <Sparkline values={row.spark} />
                      <div className="pl-6">{compare && <Delta value={growthPct(row.now.orders, row.before.orders)} />}</div>
                    </td>
                  )}
                  <td className={cell}>
                    <div className="relative flex items-center gap-1.5" ref={menuFor === row.product.id ? menuRef : undefined}>
                      <button type="button" onClick={() => onView(row.product.id)} className="!min-h-0 rounded-lg border border-blue-200 bg-white px-3 py-1.5 text-[12.5px] font-semibold text-[#1F8FE0] hover:bg-blue-50 dark:border-blue-500/30">View</button>
                      <button type="button" aria-label={`More for ${row.product.name}`} onClick={() => setMenuFor(menuFor === row.product.id ? null : row.product.id)} className="!min-h-0 rounded-lg border border-gray-200 px-2 py-1.5 text-gray-600 hover:bg-gray-50 dark:border-slate-700"><Ellipsis className="h-4 w-4" /></button>
                      {menuFor === row.product.id && (
                        <div className="absolute right-0 top-full z-30 mt-1 w-52 rounded-xl border border-gray-200 bg-white p-1 text-[12.5px] shadow-xl dark:border-slate-700 dark:bg-slate-900">
                          <MenuButton onClick={() => { onView(row.product.id); setMenuFor(null); }}>View details</MenuButton>
                          <MenuButton onClick={() => { onOnly(row.product.id); setMenuFor(null); }}>Show only this product</MenuButton>
                          {onOpenProducts && <MenuButton onClick={() => { onOpenProducts(); setMenuFor(null); }}>Open Products &amp; Stock</MenuButton>}
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <BottomPanels model={model} products={products} totalsOrders={totalsOrders} from={from} to={to} money={money} onShowStates={onShowStates} />
    </div>
  );
}

function MenuButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return <button type="button" onClick={onClick} className="!min-h-0 block w-full rounded-lg px-3 py-2 text-left text-gray-700 hover:bg-gray-50 dark:text-slate-200 dark:hover:bg-slate-800">{children}</button>;
}

// ── The four panels under the table ─────────────────────────────────────────

type StateMode = "orders" | "delivered" | "rate";

function BottomPanels({ model, products, totalsOrders, from, to, money, onShowStates }: {
  model: Model; products: TrendProduct[]; totalsOrders: number; from: string; to: string; money: (value: number) => string; onShowStates: () => void;
}) {
  const [stateMode, setStateMode] = useState<StateMode>("orders");
  const [mapProduct, setMapProduct] = useState<string>(ALL);
  const [mapMode, setMapMode] = useState<"orders" | "delivered">("orders");
  const [trendMetric, setTrendMetric] = useState<TrendMetric>("orders");
  const [grain, setGrain] = useState<Granularity>(daysBetween(from, to) > 62 ? "weekly" : "daily");

  // Orders by state (top 10 + the rest).
  const stateList = useMemo(() => {
    const rows = model.stateRows.map((row) => ({ state: row.state, value: stateMode === "orders" ? row.now.orders : stateMode === "delivered" ? row.now.delivered : row.now.rate, orders: row.now.orders }))
      .filter((row) => stateMode !== "rate" || row.orders >= MIN_RATE_SAMPLE)
      .sort((a, b) => b.value - a.value);
    const top = rows.slice(0, 9);
    const rest = rows.slice(9);
    const total = stateMode === "delivered" ? model.stateRows.reduce((s, r) => s + r.now.delivered, 0) : totalsOrders;
    const others = stateMode === "rate"
      ? (() => { const o = rest.reduce((s, r) => s + r.orders, 0); const d = model.stateRows.filter((r) => rest.some((x) => x.state === r.state)).reduce((s, r) => s + r.now.delivered, 0); return o > 0 ? (d / o) * 100 : 0; })()
      : rest.reduce((s, r) => s + r.value, 0) + (stateMode === "orders" ? model.orders.filter((o) => !o.state).length : 0);
    return { top, others, hasOthers: rest.length > 0 || (stateMode === "orders" && model.orders.some((o) => !o.state)), total };
  }, [model, stateMode, totalsOrders]);
  const maxValue = Math.max(1, ...stateList.top.map((row) => row.value), stateMode === "rate" ? 100 : stateList.others);

  // Delivery rate by state (top 10 by rate, enough orders only).
  const rateList = useMemo(() => {
    const eligible = model.stateRows.filter((row) => row.now.orders >= MIN_RATE_SAMPLE).sort((a, b) => b.now.rate - a.now.rate);
    const top = eligible.slice(0, 9);
    const rest = model.stateRows.filter((row) => !top.includes(row));
    const restOrders = rest.reduce((s, r) => s + r.now.orders, 0);
    return { top, othersRate: restOrders > 0 ? (rest.reduce((s, r) => s + r.now.delivered, 0) / restOrders) * 100 : null };
  }, [model.stateRows]);

  // Map data.
  const mapData = useMemo(() => {
    const orders = mapProduct === ALL ? model.orders : model.orders.filter((order) => order.productId === mapProduct);
    const out: Record<string, MapDatum> = {};
    const byState = new Map<string, { orders: number; delivered: number }>();
    for (const order of orders) {
      if (!order.state) continue;
      const entry = byState.get(order.state) ?? { orders: 0, delivered: 0 };
      entry.orders += 1;
      if (order.status === "Delivered") entry.delivered += 1;
      byState.set(order.state, entry);
    }
    for (const [state, entry] of byState) {
      out[mapStateName(state)] = {
        value: mapMode === "orders" ? entry.orders : entry.delivered,
        tooltip: (
          <div className="space-y-0.5 text-gray-600 dark:text-slate-300">
            <div>Orders: <strong className="text-gray-900 dark:text-slate-100">{nf(entry.orders)}</strong></div>
            <div>Delivered: <strong className="text-gray-900 dark:text-slate-100">{nf(entry.delivered)}</strong></div>
            <div>Delivery rate: <strong className="text-gray-900 dark:text-slate-100">{entry.orders > 0 ? pct1((entry.delivered / entry.orders) * 100) : "—"}</strong></div>
          </div>
        )
      };
    }
    return out;
  }, [model.orders, mapProduct, mapMode]);

  // Trend lines: the five products with the most orders.
  const topFive = useMemo(() => [...model.productRows].sort((a, b) => b.now.orders - a.now.orders).slice(0, 5), [model.productRows]);
  const trendRows = useMemo(() => {
    const series: Record<string, TrendOrder[]> = {};
    for (const row of topFive) series[row.product.id] = model.orders.filter((order) => order.productId === row.product.id);
    return seriesOver(series, from, to, grain, trendMetric);
  }, [topFive, model.orders, from, to, grain, trendMetric]);
  const metricInfo = TREND_METRICS.find((m) => m.key === trendMetric)!;
  const fmtMetric = (value: number) => metricInfo.money ? money(value) : metricInfo.percent ? `${value.toFixed(1)}%` : nf(value);

  const rankBadge = (i: number) => (
    <span className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded text-[10px] font-bold ${i < 3 ? "bg-blue-50 text-blue-700 dark:bg-blue-500/20 dark:text-blue-200" : "text-gray-500"}`}>{i + 1}</span>
  );

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-4">
      <Panel title="Orders by State (Top 10)" info="Where the period's orders came from. 'Others' = every other state and orders with no state."
        action={<button type="button" onClick={onShowStates} className="!min-h-0 text-[12px] font-semibold text-[#1F8FE0]">View All</button>}>
        <Segmented small fill value={stateMode} onChange={setStateMode} options={[{ value: "orders", label: "Total Orders" }, { value: "delivered", label: "Delivered Orders" }, { value: "rate", label: "Delivery Rate" }]} />
        <ol className="m-0 mt-3 list-none space-y-2 p-0">
          {stateList.top.map((row, i) => (
            <li key={row.state} className="grid grid-cols-[16px_minmax(0,72px)_1fr_auto] items-center gap-2 text-[12.5px]">
              {rankBadge(i)}
              <span className="truncate text-gray-800 dark:text-slate-200">{stateLabel(row.state)}</span>
              <span className="h-2 rounded-full bg-gray-100 dark:bg-slate-800"><span className="block h-2 rounded-full bg-[#1F8FE0]" style={{ width: `${(row.value / maxValue) * 100}%` }} /></span>
              <span className="whitespace-nowrap text-right text-[11.5px] text-gray-600 dark:text-slate-300">
                {stateMode === "rate" ? pct1(row.value) : `${nf(row.value)} (${stateList.total > 0 ? ((row.value / stateList.total) * 100).toFixed(1) : "0"}%)`}
              </span>
            </li>
          ))}
          {stateList.hasOthers && (
            <li className="grid grid-cols-[16px_minmax(0,72px)_1fr_auto] items-center gap-2 text-[12.5px]">
              <span className="inline-flex h-4 w-4 items-center justify-center text-[10px] font-bold text-gray-500">{stateList.top.length + 1}</span>
              <span className="text-gray-500">Others</span>
              <span className="h-2 rounded-full bg-gray-100 dark:bg-slate-800"><span className="block h-2 rounded-full bg-gray-400" style={{ width: `${(stateList.others / maxValue) * 100}%` }} /></span>
              <span className="whitespace-nowrap text-right text-[11.5px] text-gray-600 dark:text-slate-300">
                {stateMode === "rate" ? pct1(stateList.others) : `${nf(stateList.others)} (${stateList.total > 0 ? ((stateList.others / stateList.total) * 100).toFixed(1) : "0"}%)`}
              </span>
            </li>
          )}
          {stateList.top.length === 0 && <li className="py-6 text-center text-[12.5px] text-gray-400">{stateMode === "rate" ? `No state has ${MIN_RATE_SAMPLE}+ orders yet.` : "No orders."}</li>}
        </ol>
      </Panel>

      <Panel title="Delivery Rate by State (Top 10)" info={`Delivered ÷ orders placed. Only states with at least ${MIN_RATE_SAMPLE} orders are ranked, so a state with 2 orders and 2 deliveries does not top the list.`}
        action={<button type="button" onClick={onShowStates} className="!min-h-0 text-[12px] font-semibold text-[#1F8FE0]">View All</button>}>
        <ol className="m-0 list-none space-y-2.5 p-0">
          {rateList.top.map((row, i) => (
            <li key={row.state} className="grid grid-cols-[16px_minmax(0,72px)_1fr_44px] items-center gap-2 text-[12.5px]">
              <span className="text-[11px] font-bold text-amber-600">{i + 1}</span>
              <span className="truncate text-gray-800 dark:text-slate-200">{stateLabel(row.state)}</span>
              <span className="h-2.5 rounded-sm bg-gray-100 dark:bg-slate-800"><span className="block h-2.5 rounded-sm bg-emerald-600" style={{ width: `${row.now.rate}%` }} /></span>
              <span className="text-right text-[11.5px] font-semibold text-gray-700 dark:text-slate-200">{pct1(row.now.rate)}</span>
            </li>
          ))}
          {rateList.othersRate !== null && rateList.top.length > 0 && (
            <li className="grid grid-cols-[16px_minmax(0,72px)_1fr_44px] items-center gap-2 text-[12.5px]">
              <span className="text-[11px] font-bold text-gray-400">{rateList.top.length + 1}</span>
              <span className="text-gray-500">Others</span>
              <span className="h-2.5 rounded-sm bg-gray-100 dark:bg-slate-800"><span className="block h-2.5 rounded-sm bg-emerald-600/60" style={{ width: `${rateList.othersRate}%` }} /></span>
              <span className="text-right text-[11.5px] font-semibold text-gray-700 dark:text-slate-200">{pct1(rateList.othersRate)}</span>
            </li>
          )}
          {rateList.top.length === 0 && <li className="py-6 text-center text-[12.5px] text-gray-400">No state has {MIN_RATE_SAMPLE}+ orders yet.</li>}
        </ol>
      </Panel>

      <Panel title="Product Demand by State" info="Shaded by orders (or deliveries) in each state. Hover a state for its figures.">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <SelectBox label="Product on the map" className="min-w-0 flex-1" value={mapProduct} onChange={setMapProduct}
            options={[{ value: ALL, label: "All Products" }, ...products.filter((p) => model.orders.some((o) => o.productId === p.id)).map((p) => ({ value: p.id, label: p.name }))]} />
          <Segmented small value={mapMode} onChange={setMapMode} options={[{ value: "orders", label: "Orders" }, { value: "delivered", label: "Delivered" }]} />
        </div>
        <NigeriaMap data={mapData} />
      </Panel>

      <Panel title="Trend Over Time" info="The five products with the most orders in the period.">
        <div className="mb-2 flex gap-2">
          <SelectBox label="Measure" className="flex-1" value={trendMetric} onChange={setTrendMetric} options={TREND_METRICS.map((m) => ({ value: m.key, label: m.label }))} />
          <SelectBox label="Grouping" className="w-28" value={grain} onChange={setGrain} options={[{ value: "daily", label: "Daily" }, { value: "weekly", label: "Weekly" }, { value: "monthly", label: "Monthly" }]} />
        </div>
        <div className="h-60">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={trendRows} margin={{ top: 6, right: 8, left: -14, bottom: 0 }}>
              <CartesianGrid stroke="#e5e7eb" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="key" tick={{ fontSize: 10, fill: "#6b7280" }} tickFormatter={(key: string) => grain === "monthly" ? new Date(`${key}T12:00:00Z`).toLocaleDateString("en-GB", { month: "short" }) : `${Number(key.slice(8))} ${new Date(`${key}T12:00:00Z`).toLocaleDateString("en-GB", { month: "short" })}`} minTickGap={18} />
              <YAxis tick={{ fontSize: 10, fill: "#6b7280" }} width={44} tickFormatter={(v: number) => metricInfo.money ? (v >= 1e6 ? `${(v / 1e6).toFixed(1)}m` : v >= 1e3 ? `${Math.round(v / 1e3)}k` : String(v)) : metricInfo.percent ? `${v}%` : String(v)} />
              <Tooltip formatter={(value: any, name: any) => [value === null ? "—" : fmtMetric(Number(value)), products.find((p) => p.id === name)?.name ?? name]} labelFormatter={(key: any) => longDate(String(key))} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
              <Legend formatter={(id: any) => <span className="text-[11px] text-gray-700 dark:text-slate-300">{products.find((p) => p.id === id)?.name ?? id}</span>} iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
              {topFive.map((row, i) => (
                <Line key={row.product.id} type="monotone" dataKey={row.product.id} stroke={SERIES_COLORS[i]} strokeWidth={2} dot={{ r: 2.5, strokeWidth: 0, fill: SERIES_COLORS[i] }} activeDot={{ r: 4 }} connectNulls={false} isAnimationActive={false} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Panel>
    </div>
  );
}
