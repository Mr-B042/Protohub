import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Bar, CartesianGrid, Cell, ComposedChart, LabelList, Line, Pie, PieChart, ReferenceArea, ReferenceLine, ResponsiveContainer,
  Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis
} from "recharts";
import {
  AlertTriangle, ArrowLeft, ArrowUp, ArrowDown, Coins, Dices, Download, Filter, HandCoins, Inbox, MoreVertical, Percent,
  RefreshCw, Search, Tag, Target, TrendingUp, Trophy, Truck, UsersRound, X
} from "lucide-react";
import DateWindowNav from "../components/DateWindowNav";
import { shiftDay, shiftWindow, weekStart as sundayOf, windowSize, type DateWindow } from "../lib/date-window";
import { currencySymbol, money, shortMoney } from "../lib/money-privacy";
import type { UpsellPerformanceLog, UpsellPerformanceLogRow } from "../lib/api";

/**
 * Upselling & Cross-Selling Performance - built to Bright's image, element by
 * element (1 Oct 2026: "make sure we have exactly whats in the image"):
 * header with the date range, four headline cards, the trend / by-product /
 * by-package charts, then Rep Performance | Product Breakdown | Order Details
 * | Customer Insights with search, Filter and Export, five rep cards and the
 * rep table with its Total row. The ⋮ on each row opens the rep's detail.
 *
 * ⚠️ THE MONEY COMES FROM App.tsx, NOT FROM HERE. Every order's extra revenue,
 * contribution profit and rep bonus is worked out by expansionProfitBreakdown-
 * ForOrder - the same function as the Upsell & Cross-Sell Bonus tab - so the
 * two pages cannot disagree. This file only adds up what it is handed.
 *
 * ⚠️ HOW THINGS ARE COUNTED
 * - Sales and money: by the day the order was DELIVERED, like the bonus tab,
 *   payroll and the P&L.
 * - Conversion = delivered orders with an upsell or add-on ÷ delivered orders.
 *   The same measure the reps' weekly targets are set on. Every delivered
 *   order went through a confirmation call where an upsell had to be logged
 *   (no call was marked exempt from Aug 2026), so each one was a real chance.
 * - Orders Handled: orders assigned to the rep that were PLACED in the period.
 * - The call log (offers and answers) counts UPSELL offers only. Reps tick "no
 *   cross-sell offered" on every call, even ones that sold an add-on, so a
 *   cross-sell attempt figure would be false (Bright, 1 Oct 2026).
 */

export type UpsellPerfOrder = {
  id: string;
  repId: string | null;
  status: string;
  createdKey: string;
  deliveredKey: string | null;
  productKey: string;
  productName: string;
  state: string;
  customerName: string;
  isRepeatCustomer: boolean;
  /** What the customer first ordered, before any upsell or add-on. */
  originalValue: number;
  hasUpsell: boolean;
  hasCrossSell: boolean;
  upsellFromQty: number | null;
  upsellToQty: number | null;
  /** "1 to 2 pcs · Shelf + Edge Brusher Max" - what the rep added. */
  description: string;
  extraRevenue: number;
  /** extraRevenue split by kind - cross-sell has its own columns (1 Oct 2026). */
  upsellRevenue: number;
  crossSellRevenue: number;
  /** The cross-sell products on the order, with what each brought in. */
  addOns: Array<{ name: string; revenue: number }>;
  contributionProfit: number;
  bonus: number;
};

export type UpsellPerfRep = { id: string; name: string; role?: string };

/**
 * The table names Sales Reps. Orders handled by anyone else (an Admin, a
 * Recovery Rep, nobody) share one "Other staff" row, so the Total row still
 * matches the headline cards - but they never compete in the five rep cards.
 * (1 Oct 2026: Onyin, an Admin, closed 2 orders and showed up as "Lowest Bonus
 * Earned ₦0".)
 */
const OTHER_STAFF = "__other__";

type Props = {
  orders: UpsellPerfOrder[];
  reps: UpsellPerfRep[];
  log: UpsellPerformanceLog | null;
  logLoading: boolean;
  logError: string;
  /** False until the bonus engine's per-order amounts are in. */
  moneyReady: boolean;
  window: DateWindow;
  onWindowChange: (next: DateWindow) => void;
  todayKey: string;
  refreshing: boolean;
  onRefresh: () => void;
  onBack: () => void;
  onOpenOrder: (orderId: string) => void;
};

type Tab = "reps" | "products" | "orders" | "customers";
const TABS: Array<{ key: Tab; label: string }> = [
  { key: "reps", label: "Rep Performance" },
  { key: "products", label: "Product Breakdown" },
  { key: "orders", label: "Order Details" },
  { key: "customers", label: "Customer Insights" }
];

// Statuses say what the manager should DO, not what the rep IS. The image had
// Excellent / Good / Average / Needs Focus / Poor; Bright switched to these on
// 1 Oct 2026 - nobody gets permanently labelled "Poor", and the numbers next
// to the label already show who is behind.
type PerformanceLabel = "Strong" | "On Target" | "Below Target" | "Needs Attention";
const PERFORMANCE_TONE: Record<PerformanceLabel, string> = {
  Strong: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-200",
  "On Target": "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-500/30 dark:bg-sky-500/15 dark:text-sky-200",
  "Below Target": "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/15 dark:text-amber-200",
  "Needs Attention": "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/15 dark:text-rose-200"
};
const PERFORMANCE_LABELS: PerformanceLabel[] = ["Strong", "On Target", "Below Target", "Needs Attention"];

/**
 * Bands around the rep's own target - the same target the bonus tab sets.
 * "Needs Attention" (under half the target) is the same line the Needs
 * Improvement card counts.
 */
const performanceFor = (conversion: number | null, targetPct: number | null): PerformanceLabel | null => {
  if (conversion === null || !targetPct) return null;
  const pct = conversion * 100;
  if (pct >= targetPct * 1.5) return "Strong";
  if (pct >= targetPct) return "On Target";
  if (pct >= targetPct * 0.5) return "Below Target";
  return "Needs Attention";
};

const REFUSAL_LABEL: Record<string, string> = {
  not_interested: "Not interested",
  will_consider_later: "Will think about it",
  price_too_high: "Price too high",
  already_has_product: "Already has the product",
  wants_original_only: "Only wants what they ordered",
  offer_not_appropriate: "The offer didn't suit them",
  other: "Other reason"
};

const DONUT_COLORS = ["#22c55e", "#6366f1", "#f97316", "#a855f7", "#94a3b8"];
const AVATAR_TONES = [
  "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-200",
  "bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-200",
  "bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-200",
  "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-200",
  "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-200",
  "bg-teal-100 text-teal-700 dark:bg-teal-500/20 dark:text-teal-200"
];

const inWindow = (key: string | null | undefined, window: DateWindow) => Boolean(key) && key! >= window.start && key! <= window.end;
const isExpanded = (order: UpsellPerfOrder) => order.hasUpsell || order.hasCrossSell;
const sum = <T,>(rows: T[], pick: (row: T) => number) => rows.reduce((total, row) => total + (Number(pick(row)) || 0), 0);
const percent = (value: number | null, digits = 1) => (value === null ? "—" : `${(value * 100).toFixed(digits)}%`);
const count = (value: number) => value.toLocaleString("en-NG");
const shortDay = (key: string) => new Date(`${key}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const longDay = (key: string) => new Date(`${key}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

function Avatar({ name, size = "h-8 w-8 text-xs" }: { name: string; size?: string }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "?";
  const tone = AVATAR_TONES[[...name].reduce((total, char) => total + char.charCodeAt(0), 0) % AVATAR_TONES.length];
  return <span className={`inline-flex shrink-0 items-center justify-center rounded-full font-black ${size} ${tone}`}>{initials}</span>;
}

/** "↑ 28%" pill. Green when the change is good for the business. */
function DeltaPill({ value, unit = "%", lowerIsBetter = false }: { value: number | null; unit?: "%" | "pts"; lowerIsBetter?: boolean }) {
  if (value === null || !Number.isFinite(value)) return null;
  const good = lowerIsBetter ? value <= 0 : value >= 0;
  const Arrow = value >= 0 ? ArrowUp : ArrowDown;
  const text = unit === "pts" ? `${Math.abs(value).toFixed(1)}%` : `${Math.abs(Math.round(value))}%`;
  return (
    <span className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-black ${good ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-200" : "bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-200"}`}
      title={unit === "pts" ? "Change in percentage points vs the previous period of the same length" : "Change vs the previous period of the same length"}>
      <Arrow className="h-3 w-3" />{text}
    </span>
  );
}

/** "30 Aug – 5 Sept" on two lines, so four or five weeks fit side by side. */
function RangeTick({ x, y, payload }: { x?: number; y?: number; payload?: { value: string } }) {
  const [first, second] = String(payload?.value ?? "").split(" – ");
  return (
    <g transform={`translate(${x ?? 0},${y ?? 0})`}>
      <text textAnchor="middle" fontSize={10} fill="#6b7280">
        <tspan x={0} dy={12}>{second ? `${first} –` : first}</tspan>
        {second && <tspan x={0} dy={12}>{second}</tspan>}
      </text>
    </g>
  );
}

/** Upsell (more pieces), Cross-sell (another product) or Both. */
function TypePill({ order }: { order: UpsellPerfOrder }) {
  const [label, tone] = order.hasUpsell && order.hasCrossSell
    ? ["Both", "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-500/30 dark:bg-violet-500/15 dark:text-violet-200"]
    : order.hasCrossSell
      ? ["Cross-sell", "border-teal-200 bg-teal-50 text-teal-700 dark:border-teal-500/30 dark:bg-teal-500/15 dark:text-teal-200"]
      : ["Upsell", "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-200"];
  return <span className={`inline-flex whitespace-nowrap rounded-md border px-2 py-0.5 text-xs font-bold ${tone}`}>{label}</span>;
}

function SelectPill<T extends string>({ value, options, onChange, label }: { value: T; options: T[]; onChange: (next: T) => void; label: string }) {
  return (
    <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value as T)}
      className="!min-h-0 h-8 rounded-lg border border-gray-200 bg-white px-2.5 text-xs font-bold text-gray-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-900/15 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
      {options.map((option) => <option key={option} value={option}>{option}</option>)}
    </select>
  );
}

const csvCell = (value: unknown) => {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};
const downloadCsv = (fileName: string, header: string[], rows: Array<Array<unknown>>) => {
  const body = [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([body], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
};

type Totals = {
  handled: number;
  delivered: number;
  withUpsell: number;
  /** Delivered orders with a piece upgrade / with a cross-sell. An order with
   *  both counts in each, so these two can add up to more than withUpsell. */
  upsells: number;
  crossSells: number;
  upsellRevenue: number;
  crossSellRevenue: number;
  revenue: number;
  profit: number;
  bonus: number;
  conversion: number | null;
  /** Upsold orders PLACED in the period that delivered / that finished. */
  upsoldDelivered: number;
  upsoldFinished: number;
};
const totalsFor = (orders: UpsellPerfOrder[], window: DateWindow): Totals => {
  const delivered = orders.filter((order) => order.status === "Delivered" && inWindow(order.deliveredKey, window));
  const expanded = delivered.filter(isExpanded);
  const placedExpanded = orders.filter((order) => inWindow(order.createdKey, window) && isExpanded(order));
  return {
    handled: orders.filter((order) => inWindow(order.createdKey, window)).length,
    delivered: delivered.length,
    withUpsell: expanded.length,
    upsells: expanded.filter((order) => order.hasUpsell).length,
    crossSells: expanded.filter((order) => order.hasCrossSell).length,
    upsellRevenue: sum(expanded, (order) => order.upsellRevenue),
    crossSellRevenue: sum(expanded, (order) => order.crossSellRevenue),
    revenue: sum(expanded, (order) => order.extraRevenue),
    profit: sum(expanded, (order) => order.contributionProfit),
    bonus: sum(expanded, (order) => order.bonus),
    conversion: delivered.length > 0 ? expanded.length / delivered.length : null,
    // ⚠️ By the day the order was PLACED, not delivered: "do upsold orders
    // actually deliver" needs the failures too, and a failed order has no
    // delivery date. An upsell only shows on an order once it has delivered
    // or failed, so "finished" is exactly the set that can be judged.
    upsoldDelivered: placedExpanded.filter((order) => order.status === "Delivered").length,
    upsoldFinished: placedExpanded.filter((order) => order.status === "Delivered" || order.status === "Failed").length
  };
};
const ratio = (part: number, whole: number) => (whole > 0 ? part / whole : null);
const pointsChange = (current: number | null, previous: number | null) =>
  (current !== null && previous !== null ? (current - previous) * 100 : null);
const ratioChangePct = (current: number | null, previous: number | null) =>
  (current !== null && previous !== null && previous > 0 ? ((current - previous) / previous) * 100 : null);
const changePct = (current: number, previous: number) => (previous > 0 ? ((current - previous) / previous) * 100 : null);

export default function UpsellPerformancePage({
  orders, reps, log, logLoading, logError, moneyReady, window, onWindowChange, todayKey,
  refreshing, onRefresh, onBack, onOpenOrder
}: Props) {
  const [tab, setTab] = useState<Tab>("reps");
  const [search, setSearch] = useState("");
  const [trendGrain, setTrendGrain] = useState<"Daily" | "Weekly" | "Monthly">("Weekly");
  const [productMetric, setProductMetric] = useState<"Revenue" | "Profit" | "Orders">("Revenue");
  const [packageMetric, setPackageMetric] = useState<"Orders" | "Revenue" | "Profit">("Orders");
  const [filterOpen, setFilterOpen] = useState(false);
  const [productFilter, setProductFilter] = useState<Set<string>>(new Set());
  const [performanceFilter, setPerformanceFilter] = useState<Set<PerformanceLabel>>(new Set());
  const [repFilter, setRepFilter] = useState<string | null>(null);
  const [menuRepId, setMenuRepId] = useState<string | null>(null);
  const [drawerRepId, setDrawerRepId] = useState<string | null>(null);
  const filterRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!filterOpen && !menuRepId) return;
    const onDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (filterOpen && filterRef.current && !filterRef.current.contains(target)) setFilterOpen(false);
      if (menuRepId && !target.closest("[data-rep-menu]")) setMenuRepId(null);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [filterOpen, menuRepId]);

  const previousWindow = useMemo(() => shiftWindow(window, -windowSize(window)), [window]);
  // A sensible grouping for the range picked; the dropdown can still change it.
  // Weekly bars across a whole year are too thin to read.
  useEffect(() => {
    const days = windowSize(window);
    setTrendGrain(days <= 14 ? "Daily" : days <= 120 ? "Weekly" : "Monthly");
  }, [window.start, window.end]);
  const repName = useMemo(() => {
    const names = new Map(reps.map((rep) => [rep.id, rep.name]));
    return (id: string | null) => (id ? names.get(id) ?? "Former rep" : "Unassigned");
  }, [reps]);
  const salesRepIds = useMemo(() => new Set(reps.filter((rep) => rep.role === "Sales Rep").map((rep) => rep.id)), [reps]);
  const rowIdFor = (repId: string | null) => (repId && salesRepIds.has(repId) ? repId : OTHER_STAFF);

  // ── Headline cards and charts: the whole business, no tab filters ──────
  const current = useMemo(() => totalsFor(orders, window), [orders, window]);
  const previous = useMemo(() => totalsFor(orders, previousWindow), [orders, previousWindow]);
  const deliveredInWindow = useMemo(
    () => orders.filter((order) => order.status === "Delivered" && inWindow(order.deliveredKey, window)),
    [orders, window]
  );
  const expandedInWindow = useMemo(() => deliveredInWindow.filter(isExpanded), [deliveredInWindow]);

  const trend = useMemo(() => {
    const chartWindow = { start: window.start, end: window.end < todayKey ? window.end : todayKey };
    const buckets: Array<{ key: string; label: string; start: string; end: string }> = [];
    if (trendGrain === "Daily") {
      for (let day = chartWindow.start; day <= chartWindow.end; day = shiftDay(day, 1)) buckets.push({ key: day, label: shortDay(day), start: day, end: day });
    } else if (trendGrain === "Weekly") {
      for (let start = sundayOf(chartWindow.start); start <= chartWindow.end; start = shiftDay(start, 7)) {
        const end = shiftDay(start, 6);
        buckets.push({ key: start, label: `${shortDay(start)} – ${shortDay(end)}`, start: start < chartWindow.start ? chartWindow.start : start, end: end > chartWindow.end ? chartWindow.end : end });
      }
    } else {
      for (let month = chartWindow.start.slice(0, 7); month <= chartWindow.end.slice(0, 7);) {
        const first = `${month}-01`;
        const next = new Date(`${first}T00:00:00Z`);
        next.setUTCMonth(next.getUTCMonth() + 1);
        const last = shiftDay(next.toISOString().slice(0, 10), -1);
        buckets.push({
          key: month,
          label: new Date(`${first}T12:00:00`).toLocaleDateString("en-GB", { month: "short", year: "numeric" }),
          start: first < chartWindow.start ? chartWindow.start : first,
          end: last > chartWindow.end ? chartWindow.end : last
        });
        month = next.toISOString().slice(0, 7);
      }
    }
    return buckets.map((bucket) => {
      const delivered = deliveredInWindow.filter((order) => inWindow(order.deliveredKey, bucket));
      const expanded = delivered.filter(isExpanded);
      return {
        label: bucket.label,
        upsellRevenue: Math.round(sum(expanded, (order) => order.upsellRevenue)),
        crossSellRevenue: Math.round(sum(expanded, (order) => order.crossSellRevenue)),
        orders: expanded.length,
        // No deliveries is "no rate", not 0% - a gap, not a dive to the floor.
        conversion: delivered.length > 0 ? Math.round((expanded.length / delivered.length) * 1000) / 10 : null
      };
    });
  }, [deliveredInWindow, trendGrain, window, todayKey]);

  const metricValue = (rows: UpsellPerfOrder[], metric: "Revenue" | "Profit" | "Orders") =>
    metric === "Orders" ? rows.length : metric === "Profit" ? sum(rows, (order) => order.contributionProfit) : sum(rows, (order) => order.extraRevenue);

  const byProduct = useMemo(() => {
    const groups = new Map<string, { name: string; rows: UpsellPerfOrder[] }>();
    for (const order of expandedInWindow) {
      const group = groups.get(order.productKey) ?? { name: order.productName || "Unnamed product", rows: [] };
      group.rows.push(order);
      groups.set(order.productKey, group);
    }
    const ranked = [...groups.values()]
      .map((group) => ({ name: group.name, value: metricValue(group.rows, productMetric) }))
      .sort((a, b) => b.value - a.value);
    const top = ranked.slice(0, 4);
    const rest = ranked.slice(4);
    if (rest.length > 0) top.push({ name: "Others", value: sum(rest, (row) => row.value) });
    const total = sum(top, (row) => row.value);
    return { rows: top.map((row) => ({ ...row, share: total > 0 ? row.value / total : 0 })), total };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandedInWindow, productMetric]);

  // Every upsold order lands in exactly ONE bar, so the three add up to
  // "Orders with Upsell": a piece upgrade counts by where it started, and an
  // order with only an add-on is "Add-on Product".
  const byPackage = useMemo(() => {
    const twoPieces = expandedInWindow.filter((order) => order.hasUpsell && (order.upsellFromQty ?? 1) <= 1);
    const higherTier = expandedInWindow.filter((order) => order.hasUpsell && (order.upsellFromQty ?? 1) >= 2);
    const addOn = expandedInWindow.filter((order) => !order.hasUpsell && order.hasCrossSell);
    const rows = [
      { label: "2 Pieces / Bulk", hint: "Moved up from 1 piece to 2 or more", color: "bg-emerald-500", value: metricValue(twoPieces, packageMetric) },
      { label: "Cross-sell (Add-on)", hint: "Took an extra product (cross-sell) without more pieces", color: "bg-indigo-500", value: metricValue(addOn, packageMetric) },
      { label: "Higher Tier Pack", hint: "Already on a pack of 2 or more, moved to a bigger one", color: "bg-orange-400", value: metricValue(higherTier, packageMetric) }
    ];
    const total = sum(rows, (row) => row.value);
    return rows.map((row) => ({ ...row, share: total > 0 ? row.value / total : 0 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandedInWindow, packageMetric]);

  // ── The tab section: Filter applies here ─────────────────────────────
  const productOptions = useMemo(() => {
    const names = new Map<string, string>();
    for (const order of orders) if (inWindow(order.deliveredKey, window) || inWindow(order.createdKey, window)) names.set(order.productKey, order.productName || "Unnamed product");
    return [...names.entries()].map(([key, name]) => ({ key, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [orders, window]);
  const scopedOrders = useMemo(
    () => (productFilter.size === 0 ? orders : orders.filter((order) => productFilter.has(order.productKey))),
    [orders, productFilter]
  );
  const scopedCalls = useMemo(() => {
    const calls = (log?.attempts ?? []).filter((call) => call.eligible && inWindow(call.attemptedKey, window));
    if (productFilter.size === 0) return calls;
    return calls.filter((call) => productFilter.has(call.productId ?? `name:${call.productName.trim().toLowerCase()}`));
  }, [log, window, productFilter]);
  const orderById = useMemo(() => new Map(orders.map((order) => [order.id, order])), [orders]);
  const targetByRep = useMemo(() => new Map((log?.targets ?? []).map((target) => [target.repId, target.targetPct])), [log]);

  const repRows = useMemo(() => {
    const groups = new Map<string, UpsellPerfOrder[]>();
    const otherNames = new Set<string>();
    for (const order of scopedOrders) {
      if (!inWindow(order.createdKey, window) && !(order.status === "Delivered" && inWindow(order.deliveredKey, window))) continue;
      const rowId = rowIdFor(order.repId);
      if (rowId === OTHER_STAFF) otherNames.add(repName(order.repId));
      if (!groups.has(rowId)) groups.set(rowId, []);
    }
    for (const order of scopedOrders) {
      const rowId = rowIdFor(order.repId);
      groups.get(rowId)?.push(order);
    }
    const rows = [...groups.entries()].map(([repId, mine]) => {
      const totals = totalsFor(mine, window);
      const before = totalsFor(mine, previousWindow);
      const targetPct = repId === OTHER_STAFF ? null : targetByRep.get(repId) ?? null;
      return {
        repId,
        name: repId === OTHER_STAFF ? "Other staff" : repName(repId),
        detail: repId === OTHER_STAFF ? [...otherNames].sort().join(", ") : "",
        ...totals,
        previousConversion: before.conversion,
        targetPct,
        performance: performanceFor(totals.conversion, targetPct)
      };
    });
    return [
      ...rows.filter((row) => row.repId !== OTHER_STAFF)
        .sort((a, b) => b.revenue - a.revenue || b.withUpsell - a.withUpsell || a.name.localeCompare(b.name)),
      ...rows.filter((row) => row.repId === OTHER_STAFF)
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopedOrders, window, previousWindow, targetByRep, repName, salesRepIds]);

  const visibleRepRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return repRows.filter((row) =>
      (!query || row.name.toLowerCase().includes(query))
      && (performanceFilter.size === 0 || (row.performance !== null && performanceFilter.has(row.performance)))
    );
  }, [repRows, search, performanceFilter]);

  const repTotals = useMemo(() => ({
    handled: sum(visibleRepRows, (row) => row.handled),
    delivered: sum(visibleRepRows, (row) => row.delivered),
    withUpsell: sum(visibleRepRows, (row) => row.withUpsell),
    upsells: sum(visibleRepRows, (row) => row.upsells),
    crossSells: sum(visibleRepRows, (row) => row.crossSells),
    upsellRevenue: sum(visibleRepRows, (row) => row.upsellRevenue),
    crossSellRevenue: sum(visibleRepRows, (row) => row.crossSellRevenue),
    revenue: sum(visibleRepRows, (row) => row.revenue),
    bonus: sum(visibleRepRows, (row) => row.bonus)
  }), [visibleRepRows]);

  const repCards = useMemo(() => {
    const active = repRows.filter((row) => row.repId !== OTHER_STAFF && row.delivered > 0);
    const byProfit = [...active].sort((a, b) => b.profit - a.profit);
    const byBonus = [...active].sort((a, b) => b.bonus - a.bonus);
    const withTarget = active.filter((row) => row.targetPct);
    const lowTargets = withTarget.map((row) => row.targetPct! / 2);
    const needsImprovement = withTarget.filter((row) => (row.conversion ?? 0) * 100 < row.targetPct! / 2);
    return {
      top: byProfit[0] ?? null,
      metTarget: withTarget.filter((row) => (row.conversion ?? 0) * 100 >= row.targetPct!).length,
      repCount: active.length,
      needsImprovement: needsImprovement.length,
      // Targets are per rep; when they all match (they do today) one number reads cleanly.
      needsImprovementBelow: lowTargets.length > 0 && lowTargets.every((value) => value === lowTargets[0]) ? `${lowTargets[0]}%` : "half their target",
      highestBonus: byBonus[0] ?? null,
      lowestBonus: byBonus.length > 0 ? byBonus[byBonus.length - 1] : null
    };
  }, [repRows]);

  const productRows = useMemo(() => {
    const groups = new Map<string, { name: string; rows: UpsellPerfOrder[] }>();
    for (const order of scopedOrders) {
      if (order.status !== "Delivered" || !inWindow(order.deliveredKey, window)) continue;
      const group = groups.get(order.productKey) ?? { name: order.productName || "Unnamed product", rows: [] };
      group.rows.push(order);
      groups.set(order.productKey, group);
    }
    const query = search.trim().toLowerCase();
    return [...groups.entries()].map(([key, group]) => {
      const expanded = group.rows.filter(isExpanded);
      return {
        key,
        name: group.name,
        delivered: group.rows.length,
        withUpsell: expanded.length,
        upsells: expanded.filter((order) => order.hasUpsell).length,
        crossSells: expanded.filter((order) => order.hasCrossSell).length,
        conversion: group.rows.length > 0 ? expanded.length / group.rows.length : null,
        upsellRevenue: sum(expanded, (order) => order.upsellRevenue),
        crossSellRevenue: sum(expanded, (order) => order.crossSellRevenue),
        revenue: sum(expanded, (order) => order.extraRevenue),
        profit: sum(expanded, (order) => order.contributionProfit),
        bonus: sum(expanded, (order) => order.bonus)
      };
    }).filter((row) => !query || row.name.toLowerCase().includes(query))
      .sort((a, b) => b.revenue - a.revenue || b.delivered - a.delivered);
  }, [scopedOrders, window, search]);

  // Which products were cross-sold. An order with two add-ons counts once for
  // each product, so the Orders column can add up to more than Cross-sells.
  const addOnRows = useMemo(() => {
    const groups = new Map<string, { orders: number; revenue: number }>();
    for (const order of scopedOrders) {
      if (order.status !== "Delivered" || !inWindow(order.deliveredKey, window) || !order.hasCrossSell) continue;
      for (const addOn of order.addOns) {
        const name = addOn.name || "Unnamed product";
        const group = groups.get(name) ?? { orders: 0, revenue: 0 };
        group.orders += 1;
        group.revenue += addOn.revenue;
        groups.set(name, group);
      }
    }
    const total = sum([...groups.values()], (group) => group.revenue);
    const query = search.trim().toLowerCase();
    return [...groups.entries()]
      .map(([name, group]) => ({ name, ...group, share: total > 0 ? group.revenue / total : null }))
      .filter((row) => !query || row.name.toLowerCase().includes(query))
      .sort((a, b) => b.revenue - a.revenue);
  }, [scopedOrders, window, search]);

  // Upgrade paths come from the CALLS: each call that offered "1 → 2 pcs" on a
  // product, followed to whether that order was delivered with the upsell.
  const pathRows = useMemo(() => {
    const groups = new Map<string, { product: string; from: number; to: number; offered: number; accepted: number; delivered: number; profit: number }>();
    for (const call of scopedCalls) {
      const offer = call.upsell;
      if (!offer || offer.response === "waived_no_offer" || !offer.offeredQuantity) continue;
      const key = `${call.productId ?? call.productName}|${call.originalQuantity}|${offer.offeredQuantity}`;
      const group = groups.get(key) ?? { product: call.productName || "Unnamed product", from: call.originalQuantity, to: offer.offeredQuantity, offered: 0, accepted: 0, delivered: 0, profit: 0 };
      group.offered += 1;
      const order = orderById.get(call.orderId);
      if (offer.response === "accepted" || order?.hasUpsell) group.accepted += 1;
      if (order?.status === "Delivered" && order.hasUpsell) {
        group.delivered += 1;
        group.profit += order.contributionProfit;
      }
      groups.set(key, group);
    }
    const query = search.trim().toLowerCase();
    return [...groups.values()]
      .filter((row) => !query || row.product.toLowerCase().includes(query))
      .sort((a, b) => b.offered - a.offered);
  }, [scopedCalls, orderById, search]);

  const orderRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return scopedOrders
      .filter((order) => order.status === "Delivered" && inWindow(order.deliveredKey, window) && isExpanded(order))
      .filter((order) => !repFilter || rowIdFor(order.repId) === repFilter)
      .filter((order) => !query || [order.id, order.customerName, order.productName, repName(order.repId)].some((value) => value.toLowerCase().includes(query)))
      .sort((a, b) => (b.deliveredKey ?? "").localeCompare(a.deliveredKey ?? "") || b.id.localeCompare(a.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopedOrders, window, repFilter, search, repName, salesRepIds]);

  const refusals = useMemo(() => {
    const counts = new Map<string, number>();
    for (const call of scopedCalls) {
      const offer = call.upsell;
      if (!offer || (offer.response !== "declined" && offer.response !== "consider_later" && offer.response !== "not_appropriate")) continue;
      const key = offer.refusalReason ?? "none";
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const total = sum([...counts.values()], (value) => value);
    const query = tab === "customers" ? search.trim().toLowerCase() : "";
    return [...counts.entries()]
      .map(([key, value]) => ({ label: key === "none" ? "No reason given" : REFUSAL_LABEL[key] ?? key, value, share: total > 0 ? value / total : 0 }))
      .filter((row) => !query || row.label.toLowerCase().includes(query))
      .sort((a, b) => b.value - a.value);
  }, [scopedCalls, search, tab]);

  const segments = useMemo(() => {
    const delivered = scopedOrders.filter((order) => order.status === "Delivered" && inWindow(order.deliveredKey, window));
    const rate = (rows: UpsellPerfOrder[]) => ({ delivered: rows.length, withUpsell: rows.filter(isExpanded).length, conversion: rows.length > 0 ? rows.filter(isExpanded).length / rows.length : null });
    const buyers = [
      { label: "New buyers", ...rate(delivered.filter((order) => !order.isRepeatCustomer)) },
      { label: "Repeat buyers", ...rate(delivered.filter((order) => order.isRepeatCustomer)) }
    ];
    const stateGroups = new Map<string, UpsellPerfOrder[]>();
    for (const order of delivered) {
      const state = order.state.trim() || "No state recorded";
      stateGroups.set(state, [...(stateGroups.get(state) ?? []), order]);
    }
    const states = [...stateGroups.entries()].map(([label, rows]) => ({ label, ...rate(rows) }))
      .sort((a, b) => b.delivered - a.delivered).slice(0, 8);
    // Thirds of the period's own orders rather than fixed naira bands, so the
    // split means the same thing in every branch's currency.
    const values = delivered.map((order) => order.originalValue).sort((a, b) => a - b);
    const distinct = [...new Set(values)];
    const cut = (fraction: number) => values[Math.min(values.length - 1, Math.floor(values.length * fraction))] ?? 0;
    const low = cut(1 / 3);
    const high = cut(2 / 3);
    const sizes = (values.length < 3 ? [] : distinct.length <= 4
      ? distinct.map((value) => ({ label: `${money(value)} orders`, ...rate(delivered.filter((order) => order.originalValue === value)) }))
      : low === high
        ? [
            { label: `Up to ${money(low)}`, ...rate(delivered.filter((order) => order.originalValue <= low)) },
            { label: `Over ${money(low)}`, ...rate(delivered.filter((order) => order.originalValue > low)) }
          ]
        : [
            { label: `Up to ${money(low)}`, ...rate(delivered.filter((order) => order.originalValue <= low)) },
            { label: `${money(low)} – ${money(high)}`, ...rate(delivered.filter((order) => order.originalValue > low && order.originalValue <= high)) },
            { label: `Over ${money(high)}`, ...rate(delivered.filter((order) => order.originalValue > high)) }
          ]
    ).filter((row) => row.delivered > 0);
    const query = search.trim().toLowerCase();
    const matches = (row: { label: string }) => !query || row.label.toLowerCase().includes(query);
    return { buyers: buyers.filter(matches), states: states.filter(matches), sizes: sizes.filter(matches) };
  }, [scopedOrders, window, search]);

  const exportTab = () => {
    const stamp = `${window.start}_to_${window.end}`;
    if (tab === "reps") {
      downloadCsv(`upsell-performance-reps-${stamp}.csv`,
        ["Sales rep", "Orders handled", "Delivered orders", "Upsells", "Cross-sells", "Conversion rate", "Upsell revenue", "Cross-sell revenue", "Profit", "Bonus earned", "Target", "Performance"],
        visibleRepRows.map((row) => [row.name, row.handled, row.delivered, row.upsells, row.crossSells, percent(row.conversion), Math.round(row.upsellRevenue), Math.round(row.crossSellRevenue), Math.round(row.profit), Math.round(row.bonus), row.targetPct ? `${row.targetPct}%` : "", row.performance ?? ""]));
    } else if (tab === "products") {
      downloadCsv(`upsell-performance-products-${stamp}.csv`,
        ["Product", "Delivered orders", "Upsells", "Cross-sells", "Conversion rate", "Upsell revenue", "Cross-sell revenue", "Profit", "Bonus earned"],
        productRows.map((row) => [row.name, row.delivered, row.upsells, row.crossSells, percent(row.conversion), Math.round(row.upsellRevenue), Math.round(row.crossSellRevenue), Math.round(row.profit), Math.round(row.bonus)]));
    } else if (tab === "orders") {
      downloadCsv(`upsell-performance-orders-${stamp}.csv`,
        ["Order", "Delivered", "Sales rep", "Customer", "Product", "Type", "What was added", "Upsell revenue", "Cross-sell revenue", "Profit", "Bonus"],
        orderRows.map((order) => [order.id, order.deliveredKey ?? "", repName(order.repId), order.customerName, order.productName, order.hasUpsell && order.hasCrossSell ? "Both" : order.hasCrossSell ? "Cross-sell" : "Upsell", order.description, Math.round(order.upsellRevenue), Math.round(order.crossSellRevenue), Math.round(order.contributionProfit), Math.round(order.bonus)]));
    } else {
      downloadCsv(`upsell-performance-customers-${stamp}.csv`,
        ["Group", "Label", "Delivered orders", "Orders with upsell", "Conversion rate"],
        [
          ...refusals.map((row) => ["Why customers said no", row.label, row.value, "", percent(row.share)]),
          ...segments.buyers.map((row) => ["Buyer type", row.label, row.delivered, row.withUpsell, percent(row.conversion)]),
          ...segments.states.map((row) => ["State", row.label, row.delivered, row.withUpsell, percent(row.conversion)]),
          ...segments.sizes.map((row) => ["Order size", row.label, row.delivered, row.withUpsell, percent(row.conversion)])
        ]);
    }
  };

  const filterCount = productFilter.size + performanceFilter.size;
  const searchPlaceholder = tab === "reps" ? "Search sales rep..." : tab === "products" ? "Search product..." : tab === "orders" ? "Search order, customer or rep..." : "Search reason or state...";
  const money0 = (value: number) => (moneyReady ? money(value) : "…");
  const headlineCards = [
    {
      title: "Upsell & Cross-sell Revenue", value: money(current.revenue), delta: changePct(current.revenue, previous.revenue), unit: "%" as const,
      sub: `${money(current.upsellRevenue)} upsell · ${money(current.crossSellRevenue)} cross-sell`, icon: Dices,
      card: "border-emerald-100 bg-emerald-50/40 dark:border-emerald-500/20 dark:bg-emerald-500/5", tile: "bg-emerald-100 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-200"
    },
    {
      title: "Total Rep Bonus Earned", value: money0(current.bonus), delta: moneyReady ? changePct(current.bonus, previous.bonus) : null, unit: "%" as const,
      sub: "Based on bonus rules", icon: HandCoins,
      card: "border-violet-100 bg-violet-50/40 dark:border-violet-500/20 dark:bg-violet-500/5", tile: "bg-violet-100 text-violet-600 dark:bg-violet-500/20 dark:text-violet-200"
    },
    {
      title: "Upsell Conversion Rate", value: percent(current.conversion),
      delta: current.conversion !== null && previous.conversion !== null ? (current.conversion - previous.conversion) * 100 : null, unit: "pts" as const,
      sub: `${count(current.withUpsell)} of ${count(current.delivered)} delivered orders took an upsell or cross-sell`, icon: TrendingUp,
      card: "border-sky-100 bg-sky-50/40 dark:border-sky-500/20 dark:bg-sky-500/5", tile: "bg-sky-100 text-sky-600 dark:bg-sky-500/20 dark:text-sky-200"
    },
    {
      title: "Orders with Upsell or Cross-sell", value: count(current.withUpsell), delta: changePct(current.withUpsell, previous.withUpsell), unit: "%" as const,
      sub: `${count(current.upsells)} upsell · ${count(current.crossSells)} cross-sell · of ${count(current.delivered)} delivered`, icon: Inbox,
      card: "border-orange-100 bg-orange-50/40 dark:border-orange-500/20 dark:bg-orange-500/5", tile: "bg-orange-100 text-orange-500 dark:bg-orange-500/20 dark:text-orange-200"
    }
  ];

  const profitPerUpsell = ratio(current.profit, current.withUpsell);
  const avgUpsellValue = ratio(current.revenue, current.withUpsell);
  // Bonus as a share of the profit BEFORE bonuses (contribution profit is
  // already after them), so 100% would mean every naira went to the reps.
  const bonusShare = ratio(current.bonus, current.profit + current.bonus);
  const previousBonusShare = ratio(previous.bonus, previous.profit + previous.bonus);
  const upsoldDeliveryRate = ratio(current.upsoldDelivered, current.upsoldFinished);
  const moreCards = [
    {
      title: "Profit per Upsell", value: profitPerUpsell === null ? "—" : money0(profitPerUpsell),
      delta: moneyReady ? ratioChangePct(profitPerUpsell, ratio(previous.profit, previous.withUpsell)) : null, unit: "%" as const,
      sub: "Profit on each order with an upsell or cross-sell, after cost and rep bonus", icon: Coins,
      card: "border-teal-100 bg-teal-50/40 dark:border-teal-500/20 dark:bg-teal-500/5", tile: "bg-teal-100 text-teal-600 dark:bg-teal-500/20 dark:text-teal-200"
    },
    {
      title: "Average Upsell Value", value: avgUpsellValue === null ? "—" : money(avgUpsellValue),
      delta: ratioChangePct(avgUpsellValue, ratio(previous.revenue, previous.withUpsell)), unit: "%" as const,
      sub: "Extra revenue on each order with an upsell or cross-sell", icon: Tag,
      card: "border-indigo-100 bg-indigo-50/40 dark:border-indigo-500/20 dark:bg-indigo-500/5", tile: "bg-indigo-100 text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-200"
    },
    {
      title: "Bonus Share of Profit", value: moneyReady ? percent(bonusShare) : "…",
      delta: moneyReady ? pointsChange(bonusShare, previousBonusShare) : null, unit: "pts" as const, lowerIsBetter: true,
      sub: "Of upsell and cross-sell profit, the part paid out as rep bonus", icon: Percent,
      card: "border-rose-100 bg-rose-50/40 dark:border-rose-500/20 dark:bg-rose-500/5", tile: "bg-rose-100 text-rose-600 dark:bg-rose-500/20 dark:text-rose-200"
    },
    {
      title: "Upsell Delivery Rate", value: percent(upsoldDeliveryRate),
      delta: pointsChange(upsoldDeliveryRate, ratio(previous.upsoldDelivered, previous.upsoldFinished)), unit: "pts" as const,
      sub: `${count(current.upsoldDelivered)} of ${count(current.upsoldFinished)} upsold orders placed in this period delivered`, icon: Truck,
      card: "border-lime-100 bg-lime-50/40 dark:border-lime-500/20 dark:bg-lime-500/5", tile: "bg-lime-100 text-lime-700 dark:bg-lime-500/20 dark:text-lime-200"
    }
  ];

  // Profit vs conversion: each Sales Rep as a bubble, split at the team
  // average both ways. Other staff stay out - they aren't being coached here.
  const matrix = useMemo(() => {
    const points = repRows
      .filter((row) => row.repId !== OTHER_STAFF && row.delivered > 0)
      .map((row) => ({ name: row.name, repId: row.repId, x: Math.round((row.conversion ?? 0) * 1000) / 10, y: Math.round(row.profit), z: row.delivered }));
    if (points.length === 0) return null;
    const teamDelivered = sum(points, (point) => point.z);
    const teamWithUpsell = sum(repRows.filter((row) => row.repId !== OTHER_STAFF), (row) => row.withUpsell);
    const avgX = teamDelivered > 0 ? Math.round((teamWithUpsell / teamDelivered) * 1000) / 10 : 0;
    const avgY = Math.round(sum(points, (point) => point.y) / points.length);
    const xMax = Math.ceil(Math.max(avgX * 2, ...points.map((point) => point.x)) * 1.15) || 10;
    const yMin = Math.min(0, ...points.map((point) => point.y));
    const yMax = Math.max(avgY * 2, ...points.map((point) => point.y)) * 1.15 || 1000;
    const zone = (point: { x: number; y: number }) =>
      point.x >= avgX ? (point.y >= avgY ? "#10b981" : "#0ea5e9") : (point.y >= avgY ? "#f59e0b" : "#f43f5e");
    return { points: points.map((point) => ({ ...point, color: zone(point) })), avgX, avgY, xMax, yMin, yMax };
  }, [repRows]);

  const drawerRow = repRows.find((row) => row.repId === drawerRepId) ?? null;

  return (
    <div className="space-y-5">
      {/* ── Header ─────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <button type="button" onClick={onBack}
            className="!min-h-0 inline-flex items-center gap-2 text-sm font-semibold text-gray-700 hover:text-gray-900 dark:text-slate-300 dark:hover:text-white">
            <ArrowLeft className="h-4 w-4 text-[#1F8FE0]" /> Manager Dashboard
          </button>
          <div className="mt-3 flex items-start gap-3">
            <span className="inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-200">
              <TrendingUp className="h-7 w-7" strokeWidth={2.5} />
            </span>
            <div>
              <h1 className="m-0 text-2xl font-black tracking-tight text-gray-900 sm:text-3xl dark:text-slate-50">Upselling &amp; Cross-Selling Performance</h1>
              <p className="m-0 mt-1 text-sm text-gray-500 dark:text-slate-400">Track, compare and reward sales reps based on their upsell and cross-sell results.</p>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DateWindowNav variant="compact" value={window} onChange={onWindowChange} todayKey={todayKey} />
          <button type="button" onClick={onRefresh}
            className="!min-h-0 inline-flex h-10 items-center gap-2 rounded-xl border border-emerald-200 bg-white px-4 text-sm font-bold text-emerald-700 shadow-sm hover:bg-emerald-50 dark:border-emerald-500/30 dark:bg-slate-900 dark:text-emerald-200">
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} /> Refresh
          </button>
        </div>
      </div>

      {!moneyReady && (
        <p className="m-0 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm font-semibold text-amber-800">
          Working out this period's bonuses. Bonus and profit figures fill in when that finishes.
        </p>
      )}

      {/* ── Headline cards: the image's four, then four more ───────── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[...headlineCards, ...moreCards].map((card) => (
          <article key={card.title} className={`flex gap-4 rounded-2xl border p-5 shadow-sm ${card.card}`}>
            <span className={`inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${card.tile}`}>
              <card.icon className="h-6 w-6" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="m-0 text-sm font-semibold text-gray-700 dark:text-slate-300">{card.title}</p>
              <div className="mt-1 flex items-center justify-between gap-2">
                <strong className="whitespace-nowrap text-[22px] font-black leading-tight text-gray-900 dark:text-slate-50">{card.value}</strong>
                <DeltaPill value={card.delta} unit={card.unit} lowerIsBetter={Boolean((card as { lowerIsBetter?: boolean }).lowerIsBetter)} />
              </div>
              <p className="m-0 mt-1 text-xs text-gray-500 dark:text-slate-400">{card.sub}</p>
            </div>
          </article>
        ))}
      </div>

      {/* ── Three charts ───────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between gap-2">
            <h2 className="m-0 text-base font-black text-gray-900 dark:text-slate-100">Upsell &amp; Cross-Sell Trend</h2>
            <SelectPill label="Trend grouping" value={trendGrain} options={["Daily", "Weekly", "Monthly"]} onChange={setTrendGrain} />
          </div>
          <div className="mt-3 flex flex-wrap gap-4 text-xs text-gray-600 dark:text-slate-400">
            <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />Upsell Revenue</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-teal-300" />Cross-sell Revenue</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-indigo-500" />Orders with Upsell or Cross-sell</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-orange-500" />Conversion Rate</span>
          </div>
          <div className="mt-3 h-56">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={trend} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                <XAxis dataKey="label" tick={<RangeTick />} height={34} tickLine={false} axisLine={false} interval={trend.length <= 6 ? 0 : "preserveStartEnd"} />
                <YAxis yAxisId="money" tickFormatter={(value) => shortMoney(Number(value))} tick={{ fontSize: 10, fill: "#6b7280" }} tickLine={false} axisLine={false} width={52} />
                <YAxis yAxisId="orders" hide />
                <YAxis yAxisId="rate" orientation="right" tickFormatter={(value) => `${value}%`} tick={{ fontSize: 10, fill: "#6b7280" }} tickLine={false} axisLine={false} width={36} />
                <Tooltip formatter={(value: number, name: string) => name.endsWith("Revenue") ? money(value) : name === "Conversion Rate" ? `${value}%` : count(value)} />
                <Bar yAxisId="money" dataKey="upsellRevenue" name="Upsell Revenue" stackId="revenue" fill="#22c55e" maxBarSize={22} />
                <Bar yAxisId="money" dataKey="crossSellRevenue" name="Cross-sell Revenue" stackId="revenue" fill="#5eead4" radius={[3, 3, 0, 0]} maxBarSize={22} />
                <Bar yAxisId="orders" dataKey="orders" name="Orders with Upsell or Cross-sell" fill="#6366f1" radius={[3, 3, 0, 0]} maxBarSize={22} />
                <Line yAxisId="rate" type="monotone" dataKey="conversion" name="Conversion Rate" stroke="#f97316" strokeWidth={2} dot={{ r: 3 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between gap-2">
            <h2 className="m-0 text-base font-black text-gray-900 dark:text-slate-100">Upsell by Product</h2>
            <SelectPill label="Upsell by product measure" value={productMetric} options={["Revenue", "Profit", "Orders"]} onChange={setProductMetric} />
          </div>
          {byProduct.rows.length === 0 ? (
            <p className="m-0 py-16 text-center text-sm text-gray-400">No upsells delivered in this period.</p>
          ) : (
            <div className="mt-4 flex flex-col items-center gap-4 sm:flex-row">
              <div className="relative h-36 w-36 shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={byProduct.rows} dataKey="value" nameKey="name" innerRadius="72%" outerRadius="100%" paddingAngle={2} stroke="none">
                      {byProduct.rows.map((row, index) => <Cell key={row.name} fill={DONUT_COLORS[index % DONUT_COLORS.length]} />)}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                <div className="pointer-events-none absolute inset-[18%] flex flex-col items-center justify-center text-center">
                  <strong className="text-sm font-black leading-tight text-gray-900 dark:text-slate-50">
                    {productMetric === "Orders" ? count(byProduct.total) : productMetric === "Profit" ? money0(byProduct.total) : money(byProduct.total)}
                  </strong>
                  <span className="mt-0.5 text-[10px] leading-tight text-gray-500 dark:text-slate-400">
                    {productMetric === "Orders" ? "Orders with either" : productMetric === "Profit" ? "Upsell + Cross-sell Profit" : "Upsell + Cross-sell Revenue"}
                  </span>
                </div>
              </div>
              <ul className="m-0 w-full min-w-0 list-none space-y-2.5 p-0 text-[11px]">
                {byProduct.rows.map((row, index) => (
                  <li key={row.name} className="grid grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: DONUT_COLORS[index % DONUT_COLORS.length] }} />
                    <span className="leading-tight text-gray-700 dark:text-slate-300">{row.name}</span>
                    <span className="font-bold text-gray-900 dark:text-slate-100">{Math.round(row.share * 100)}%</span>
                    <span className="text-right text-gray-700 dark:text-slate-300">
                      {productMetric === "Orders" ? count(row.value) : productMetric === "Profit" ? money0(row.value) : money(row.value)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between gap-2">
            <h2 className="m-0 text-base font-black text-gray-900 dark:text-slate-100">Upsell by Package Type</h2>
            <SelectPill label="Upsell by package measure" value={packageMetric} options={["Orders", "Revenue", "Profit"]} onChange={setPackageMetric} />
          </div>
          <div className="mt-8 space-y-6">
            {byPackage.map((row) => (
              <div key={row.label} className="grid grid-cols-[minmax(96px,auto)_1fr_auto] items-center gap-3 text-sm" title={row.hint}>
                <span className="text-gray-700 dark:text-slate-300">{row.label}</span>
                <span className="h-5 overflow-hidden rounded bg-gray-100 dark:bg-slate-800">
                  <span className={`block h-full rounded ${row.color}`} style={{ width: `${Math.max(row.share * 100, row.value > 0 ? 2 : 0)}%` }} />
                </span>
                <span className="min-w-[72px] text-right text-gray-700 dark:text-slate-300">
                  {packageMetric === "Orders" ? count(row.value) : packageMetric === "Profit" ? money0(row.value) : money(row.value)} ({Math.round(row.share * 100)}%)
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* ── Tabs ───────────────────────────────────────────────────── */}
      <section className="rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="inline-flex flex-wrap items-center gap-1 rounded-xl bg-gray-100 p-1 dark:bg-slate-800">
            {TABS.map((item) => (
              <button key={item.key} type="button" onClick={() => { setTab(item.key); setSearch(""); }}
                className={`!min-h-0 rounded-lg px-5 py-2 text-sm font-bold transition-colors ${tab === item.key ? "bg-[#1F8FE0] text-white shadow-sm" : "text-gray-600 hover:text-gray-900 dark:text-slate-300 dark:hover:text-white"}`}>
                {item.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={searchPlaceholder}
                className="!min-h-0 h-10 w-full rounded-xl border border-gray-200 bg-white pl-9 pr-3 text-sm text-gray-700 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-slate-900/15 sm:w-56 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200" />
            </label>
            <div className="relative" ref={filterRef}>
              <button type="button" onClick={() => setFilterOpen((open) => !open)}
                className="!min-h-0 inline-flex h-10 items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 text-sm font-bold text-gray-700 shadow-sm hover:bg-gray-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
                <Filter className="h-4 w-4" /> Filter
                {filterCount > 0 && <span className="rounded-full bg-[#1F8FE0] px-1.5 text-[11px] font-black text-white">{filterCount}</span>}
              </button>
              {filterOpen && (
                <div className="absolute right-0 top-12 z-30 w-72 rounded-xl border border-gray-200 bg-white p-3 shadow-2xl dark:border-slate-700 dark:bg-slate-900">
                  <p className="m-0 px-1 text-[10px] font-black uppercase tracking-wider text-gray-400">Products</p>
                  <div className="mt-1 max-h-48 overflow-y-auto">
                    {productOptions.map((option) => (
                      <label key={option.key} className="flex cursor-pointer items-center gap-2 rounded-lg px-1 py-1.5 text-sm text-gray-700 hover:bg-gray-50 dark:text-slate-300 dark:hover:bg-slate-800">
                        <input type="checkbox" checked={productFilter.has(option.key)}
                          onChange={() => setProductFilter((current) => { const next = new Set(current); if (next.has(option.key)) next.delete(option.key); else next.add(option.key); return next; })} />
                        {option.name}
                      </label>
                    ))}
                  </div>
                  <p className="m-0 mt-3 px-1 text-[10px] font-black uppercase tracking-wider text-gray-400">Performance</p>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {PERFORMANCE_LABELS.map((label) => (
                      <button key={label} type="button"
                        onClick={() => setPerformanceFilter((current) => { const next = new Set(current); if (next.has(label)) next.delete(label); else next.add(label); return next; })}
                        className={`!min-h-0 rounded-md border px-2 py-1 text-xs font-bold ${performanceFilter.has(label) ? PERFORMANCE_TONE[label] : "border-gray-200 text-gray-600 dark:border-slate-700 dark:text-slate-300"}`}>
                        {label}
                      </button>
                    ))}
                  </div>
                  {filterCount > 0 && (
                    <button type="button" onClick={() => { setProductFilter(new Set()); setPerformanceFilter(new Set()); }}
                      className="!min-h-0 mt-3 w-full rounded-lg border border-gray-200 py-1.5 text-xs font-bold text-gray-600 hover:bg-gray-50 dark:border-slate-700 dark:text-slate-300">
                      Clear filters
                    </button>
                  )}
                </div>
              )}
            </div>
            <button type="button" onClick={exportTab}
              className="!min-h-0 inline-flex h-10 items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 text-sm font-bold text-gray-700 shadow-sm hover:bg-gray-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
              <Download className="h-4 w-4" /> Export
            </button>
          </div>
        </div>

        {tab === "reps" && (
          <div className="space-y-4 px-4 pb-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
              <article className="flex gap-3 rounded-xl border border-emerald-100 bg-emerald-50/50 p-4 dark:border-emerald-500/20 dark:bg-emerald-500/5">
                <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-200"><Trophy className="h-5 w-5" /></span>
                <div className="min-w-0">
                  <strong className="block text-xl font-black text-gray-900 dark:text-slate-50">{repCards.top ? 1 : 0}</strong>
                  <p className="m-0 text-sm text-gray-600 dark:text-slate-300">Top Performer</p>
                  {repCards.top && (
                    <p className="m-0 mt-1 flex items-center gap-1.5 text-xs">
                      <Avatar name={repCards.top.name} size="h-5 w-5 text-[9px]" />
                      <span className="min-w-0">
                        <span className="block truncate font-semibold text-emerald-700 dark:text-emerald-200">{repCards.top.name}</span>
                        <span className="block text-emerald-700 dark:text-emerald-200">{money0(repCards.top.profit)} upsell profit</span>
                      </span>
                    </p>
                  )}
                </div>
              </article>
              <article className="flex gap-3 rounded-xl border border-sky-100 bg-sky-50/50 p-4 dark:border-sky-500/20 dark:bg-sky-500/5">
                <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-sky-100 text-sky-600 dark:bg-sky-500/20 dark:text-sky-200"><UsersRound className="h-5 w-5" /></span>
                <div>
                  <strong className="block text-xl font-black text-gray-900 dark:text-slate-50">{repCards.metTarget}</strong>
                  <p className="m-0 text-sm text-gray-600 dark:text-slate-300">Reps Met Target</p>
                  <p className="m-0 mt-1 text-xs text-gray-500 dark:text-slate-400">Out of {repCards.repCount} reps</p>
                </div>
              </article>
              <article className="flex gap-3 rounded-xl border border-amber-100 bg-amber-50/50 p-4 dark:border-amber-500/20 dark:bg-amber-500/5">
                <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-600 dark:bg-amber-500/20 dark:text-amber-200"><AlertTriangle className="h-5 w-5" /></span>
                <div>
                  <strong className="block text-xl font-black text-gray-900 dark:text-slate-50">{repCards.needsImprovement}</strong>
                  <p className="m-0 text-sm text-gray-600 dark:text-slate-300">Needs Improvement</p>
                  <p className="m-0 mt-1 text-xs text-gray-500 dark:text-slate-400">Below {repCards.needsImprovementBelow} conversion rate</p>
                </div>
              </article>
              <article className="flex gap-3 rounded-xl border border-violet-100 bg-violet-50/50 p-4 dark:border-violet-500/20 dark:bg-violet-500/5">
                <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-violet-100 text-violet-600 dark:bg-violet-500/20 dark:text-violet-200"><HandCoins className="h-5 w-5" /></span>
                <div className="min-w-0">
                  <strong className="block text-xl font-black text-violet-700 dark:text-violet-200">{repCards.highestBonus ? money0(repCards.highestBonus.bonus) : "—"}</strong>
                  <p className="m-0 text-sm text-gray-600 dark:text-slate-300">Highest Bonus Earned</p>
                  {repCards.highestBonus && <p className="m-0 mt-1 flex items-center gap-1.5 text-xs text-gray-600 dark:text-slate-300"><Avatar name={repCards.highestBonus.name} size="h-5 w-5 text-[9px]" />{repCards.highestBonus.name}</p>}
                </div>
              </article>
              <article className="flex gap-3 rounded-xl border border-rose-100 bg-rose-50/50 p-4 dark:border-rose-500/20 dark:bg-rose-500/5">
                <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-rose-100 text-rose-600 dark:bg-rose-500/20 dark:text-rose-200"><Target className="h-5 w-5" /></span>
                <div className="min-w-0">
                  <strong className="block text-xl font-black text-rose-600 dark:text-rose-200">{repCards.lowestBonus ? money0(repCards.lowestBonus.bonus) : "—"}</strong>
                  <p className="m-0 text-sm text-gray-600 dark:text-slate-300">Lowest Bonus Earned</p>
                  {repCards.lowestBonus && <p className="m-0 mt-1 flex items-center gap-1.5 text-xs text-gray-600 dark:text-slate-300"><Avatar name={repCards.lowestBonus.name} size="h-5 w-5 text-[9px]" />{repCards.lowestBonus.name}</p>}
                </div>
              </article>
            </div>

            <div className="overflow-x-auto rounded-xl border border-gray-100 dark:border-slate-800">
              <table className="w-full !min-w-[960px] text-sm">
                <thead>
                  <tr className="text-left text-xs font-bold text-gray-700 dark:text-slate-300">
                    {["#", "Sales Rep", "Orders Handled", "Delivered Orders", "Upsells", "Cross-sells", "Conversion Rate", `Upsell Revenue (${currencySymbol()})`, `Cross-sell Revenue (${currencySymbol()})`, `Bonus Earned (${currencySymbol()})`, "Target", "Performance", ""].map((header, index) => (
                      // Long headings wrap to two lines so all 13 columns fit.
                      <th key={`${header}-${index}`} className="bg-gray-50 px-2.5 py-3 align-bottom font-bold leading-tight dark:bg-slate-800/60"
                        title={header === "Conversion Rate" ? "Delivered orders with an upsell or a cross-sell ÷ delivered orders" : header === "Upsells" ? "Delivered orders where the customer took more pieces" : header === "Cross-sells" ? "Delivered orders where the customer added another product" : undefined}>
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visibleRepRows.length === 0 ? (
                    <tr><td colSpan={13} className="!text-gray-400 px-4 py-10 text-center text-sm text-gray-400">No sales rep handled or delivered an order in this period.</td></tr>
                  ) : visibleRepRows.map((row, index) => {
                    const conversionPct = (row.conversion ?? 0) * 100;
                    const barTone = !row.targetPct ? "bg-gray-300" : conversionPct >= row.targetPct ? "bg-emerald-500" : conversionPct >= row.targetPct / 2 ? "bg-amber-400" : "bg-rose-500";
                    const barScale = Math.max(20, ...visibleRepRows.map((item) => (item.conversion ?? 0) * 100));
                    return (
                      <tr key={row.repId} onClick={() => { if (row.repId !== OTHER_STAFF) setDrawerRepId(row.repId); }}
                        className="cursor-pointer border-t border-gray-100 hover:bg-gray-50/70 dark:border-slate-800 dark:hover:bg-slate-800/40 [&>td]:align-middle [&>td]:text-gray-800 dark:[&>td]:text-slate-200">
                        <td className="px-2.5 py-3 font-semibold">{index + 1}</td>
                        <td className="px-2.5 py-3">
                          <span className="inline-flex items-center gap-2.5 whitespace-nowrap font-bold">
                            <Avatar name={row.name} />
                            <span>
                              {row.name}
                              {row.detail && <span className="block max-w-[160px] truncate text-[11px] font-medium text-gray-400" title={row.detail}>{row.detail}</span>}
                            </span>
                          </span>
                        </td>
                        <td className="px-2.5 py-3">{count(row.handled)}</td>
                        <td className="px-2.5 py-3">{count(row.delivered)}</td>
                        <td className="px-2.5 py-3">{count(row.upsells)}</td>
                        <td className="px-2.5 py-3">{count(row.crossSells)}</td>
                        <td className="px-2.5 py-3">
                          <span className="flex items-center gap-2">
                            <span className="w-11">{percent(row.conversion)}</span>
                            <span className="h-2.5 w-16 overflow-hidden rounded-full bg-gray-100 dark:bg-slate-800">
                              <span className={`block h-full rounded-full ${barTone}`} style={{ width: `${Math.min(100, (conversionPct / barScale) * 100)}%` }} />
                            </span>
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-2.5 py-3">{money(row.upsellRevenue)}</td>
                        <td className="whitespace-nowrap px-2.5 py-3">{money(row.crossSellRevenue)}</td>
                        <td className="whitespace-nowrap px-2.5 py-3">{money0(row.bonus)}</td>
                        <td className="px-2.5 py-3">{row.targetPct ? `≥ ${row.targetPct}%` : "—"}</td>
                        <td className="px-2.5 py-3">
                          {row.performance
                            ? <span className={`inline-flex whitespace-nowrap rounded-md border px-2 py-1 text-xs font-bold ${PERFORMANCE_TONE[row.performance]}`}>{row.performance}</span>
                            : <span className="text-xs text-gray-400">{row.delivered === 0 ? "No deliveries" : "No target"}</span>}
                        </td>
                        <td className="relative px-1 py-3 text-right" data-rep-menu onClick={(event) => event.stopPropagation()}>
                          <button type="button" aria-label={`Actions for ${row.name}`} onClick={() => setMenuRepId((open) => (open === row.repId ? null : row.repId))}
                            className="!min-h-0 inline-flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-slate-800">
                            <MoreVertical className="h-4 w-4" />
                          </button>
                          {menuRepId === row.repId && (
                            <div className="absolute right-2 top-11 z-20 w-48 rounded-xl border border-gray-200 bg-white p-1 text-left shadow-xl dark:border-slate-700 dark:bg-slate-900">
                              {row.repId !== OTHER_STAFF && (
                                <button type="button" onClick={() => { setDrawerRepId(row.repId); setMenuRepId(null); }}
                                  className="!min-h-0 block w-full rounded-lg px-3 py-2 text-left text-sm font-semibold text-gray-700 hover:bg-gray-50 dark:text-slate-200 dark:hover:bg-slate-800">View performance</button>
                              )}
                              <button type="button" onClick={() => { setRepFilter(row.repId); setTab("orders"); setSearch(""); setMenuRepId(null); }}
                                className="!min-h-0 block w-full rounded-lg px-3 py-2 text-left text-sm font-semibold text-gray-700 hover:bg-gray-50 dark:text-slate-200 dark:hover:bg-slate-800">View their orders</button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                {visibleRepRows.length > 0 && (
                  <tfoot>
                    <tr className="border-t border-gray-200 dark:border-slate-700 [&>td]:align-middle [&>td]:font-black [&>td]:text-gray-900 dark:[&>td]:text-slate-100">
                      <td className="px-2.5 py-3" colSpan={2}>Total</td>
                      <td className="px-2.5 py-3">{count(repTotals.handled)}</td>
                      <td className="px-2.5 py-3">{count(repTotals.delivered)}</td>
                      <td className="px-2.5 py-3">{count(repTotals.upsells)}</td>
                      <td className="px-2.5 py-3">{count(repTotals.crossSells)}</td>
                      <td className="px-2.5 py-3">{percent(repTotals.delivered > 0 ? repTotals.withUpsell / repTotals.delivered : null)}</td>
                      <td className="whitespace-nowrap px-2.5 py-3">{money(repTotals.upsellRevenue)}</td>
                      <td className="whitespace-nowrap px-2.5 py-3">{money(repTotals.crossSellRevenue)}</td>
                      <td className="whitespace-nowrap px-2.5 py-3">{money0(repTotals.bonus)}</td>
                      <td className="px-2.5 py-3">-</td>
                      <td className="px-2.5 py-3">-</td>
                      <td />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>

            <section className="rounded-xl border border-gray-100 p-4 dark:border-slate-800">
              <h3 className="m-0 text-sm font-black text-gray-900 dark:text-slate-100">Profit vs Conversion</h3>
              <p className="m-0 mt-0.5 text-xs text-gray-500 dark:text-slate-400">
                Each bubble is a sales rep; a bigger bubble means more delivered orders. The dashed lines are the team average.
              </p>
              {!matrix ? (
                <p className="m-0 py-10 text-center text-sm text-gray-400">No sales rep delivered an order in this period.</p>
              ) : (
                <div className="mt-3 h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <ScatterChart margin={{ top: 16, right: 24, bottom: 24, left: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <ReferenceArea x1={matrix.avgX} x2={matrix.xMax} y1={matrix.avgY} y2={matrix.yMax} fill="#10b981" fillOpacity={0.06}
                        label={{ value: "Strong performers", position: "insideTopRight", fontSize: 11, fill: "#059669" }} />
                      <ReferenceArea x1={0} x2={matrix.avgX} y1={matrix.avgY} y2={matrix.yMax} fill="#f59e0b" fillOpacity={0.06}
                        label={{ value: "High profit, converts less", position: "insideTopLeft", fontSize: 11, fill: "#d97706" }} />
                      <ReferenceArea x1={matrix.avgX} x2={matrix.xMax} y1={matrix.yMin} y2={matrix.avgY} fill="#0ea5e9" fillOpacity={0.06}
                        label={{ value: "Converts well, needs more orders", position: "insideBottomRight", fontSize: 11, fill: "#0284c7" }} />
                      <ReferenceArea x1={0} x2={matrix.avgX} y1={matrix.yMin} y2={matrix.avgY} fill="#f43f5e" fillOpacity={0.06}
                        label={{ value: "Needs coaching", position: "insideBottomLeft", fontSize: 11, fill: "#e11d48" }} />
                      <ReferenceLine x={matrix.avgX} stroke="#94a3b8" strokeDasharray="4 4" />
                      <ReferenceLine y={matrix.avgY} stroke="#94a3b8" strokeDasharray="4 4" />
                      <XAxis type="number" dataKey="x" domain={[0, matrix.xMax]} tickFormatter={(value) => `${value}%`} tick={{ fontSize: 10, fill: "#6b7280" }}
                        label={{ value: "Conversion rate", position: "insideBottom", offset: -14, fontSize: 11, fill: "#6b7280" }} />
                      <YAxis type="number" dataKey="y" domain={[matrix.yMin, matrix.yMax]} tickFormatter={(value) => shortMoney(Number(value))} tick={{ fontSize: 10, fill: "#6b7280" }} width={56}
                        label={{ value: "Upsell profit", angle: -90, position: "insideLeft", offset: 4, fontSize: 11, fill: "#6b7280" }} />
                      <ZAxis type="number" dataKey="z" range={[90, 700]} />
                      <Tooltip cursor={{ strokeDasharray: "3 3" }} content={({ payload }) => {
                        const point = payload?.[0]?.payload as { name: string; x: number; y: number; z: number } | undefined;
                        if (!point) return null;
                        return (
                          <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs shadow-lg dark:border-slate-700 dark:bg-slate-900">
                            <p className="m-0 font-black text-gray-900 dark:text-slate-100">{point.name}</p>
                            <p className="m-0 mt-1 text-gray-600 dark:text-slate-300">{point.x}% conversion · {money0(point.y)} upsell profit</p>
                            <p className="m-0 text-gray-500 dark:text-slate-400">{count(point.z)} delivered orders</p>
                          </div>
                        );
                      }} />
                      <Scatter data={matrix.points} onClick={(point: any) => point?.repId && setDrawerRepId(point.repId)} className="cursor-pointer">
                        {matrix.points.map((point) => <Cell key={point.repId} fill={point.color} fillOpacity={0.75} stroke={point.color} />)}
                        <LabelList dataKey="name" position="top" offset={10} className="fill-gray-700 dark:fill-slate-200" style={{ fontSize: 11, fontWeight: 700 }} />
                      </Scatter>
                    </ScatterChart>
                  </ResponsiveContainer>
                </div>
              )}
            </section>
          </div>
        )}

        {tab === "products" && (
          <div className="space-y-5 px-4 pb-4">
            <div className="overflow-x-auto rounded-xl border border-gray-100 dark:border-slate-800">
              <table className="w-full !min-w-[760px] text-sm">
                <thead>
                  <tr className="text-left text-xs font-bold text-gray-700 dark:text-slate-300">
                    {["Product", "Delivered Orders", "Upsells", "Cross-sells", "Conversion Rate", `Upsell Revenue (${currencySymbol()})`, `Cross-sell Revenue (${currencySymbol()})`, `Profit (${currencySymbol()})`, `Bonus Earned (${currencySymbol()})`].map((header) => (
                      <th key={header} className="whitespace-nowrap bg-gray-50 px-4 py-3 font-bold dark:bg-slate-800/60">{header}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {productRows.length === 0 ? (
                    <tr><td colSpan={9} className="px-4 py-10 text-center text-sm text-gray-400">No delivered orders in this period.</td></tr>
                  ) : productRows.map((row) => (
                    <tr key={row.key} className="border-t border-gray-100 dark:border-slate-800 [&>td]:align-middle [&>td]:text-gray-800 dark:[&>td]:text-slate-200">
                      <td className="px-4 py-3 font-bold">{row.name}</td>
                      <td className="px-4 py-3">{count(row.delivered)}</td>
                      <td className="px-4 py-3">{count(row.upsells)}</td>
                      <td className="px-4 py-3">{count(row.crossSells)}</td>
                      <td className="px-4 py-3">{percent(row.conversion)}</td>
                      <td className="px-4 py-3">{money(row.upsellRevenue)}</td>
                      <td className="px-4 py-3">{money(row.crossSellRevenue)}</td>
                      <td className="px-4 py-3">{money0(row.profit)}</td>
                      <td className="px-4 py-3">{money0(row.bonus)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div>
              <h3 className="m-0 text-sm font-black text-gray-900 dark:text-slate-100">Cross-sell products</h3>
              <p className="m-0 mt-0.5 text-xs text-gray-500 dark:text-slate-400">The extra products reps added to orders delivered in this period.</p>
              <div className="mt-3 overflow-x-auto rounded-xl border border-gray-100 dark:border-slate-800">
                <table className="w-full !min-w-[560px] text-sm">
                  <thead>
                    <tr className="text-left text-xs font-bold text-gray-700 dark:text-slate-300">
                      {["Cross-sell product", "Orders", `Cross-sell Revenue (${currencySymbol()})`, "Share of cross-sell revenue"].map((header) => (
                        <th key={header} className="whitespace-nowrap bg-gray-50 px-4 py-3 font-bold dark:bg-slate-800/60">{header}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {addOnRows.length === 0 ? (
                      <tr><td colSpan={4} className="px-4 py-8 text-center text-sm text-gray-400">No cross-sells were delivered in this period.</td></tr>
                    ) : addOnRows.map((row) => (
                      <tr key={row.name} className="border-t border-gray-100 dark:border-slate-800 [&>td]:align-middle [&>td]:text-gray-800 dark:[&>td]:text-slate-200">
                        <td className="px-4 py-3 font-bold">{row.name}</td>
                        <td className="px-4 py-3">{count(row.orders)}</td>
                        <td className="px-4 py-3">{money(row.revenue)}</td>
                        <td className="px-4 py-3">{percent(row.share)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <h3 className="m-0 text-sm font-black text-gray-900 dark:text-slate-100">Upgrade paths</h3>
              <p className="m-0 mt-0.5 text-xs text-gray-500 dark:text-slate-400">
                Each upgrade the reps offered on a confirmation call in this period, followed to delivery. Add-ons aren't listed: reps don't log add-on offers yet.
              </p>
              <div className="mt-3 overflow-x-auto rounded-xl border border-gray-100 dark:border-slate-800">
                <table className="w-full !min-w-[760px] text-sm">
                  <thead>
                    <tr className="text-left text-xs font-bold text-gray-700 dark:text-slate-300">
                      {["Product", "Upgrade", "Offered", "Customer said yes", "Delivered", "Delivered conversion", `Upsell Profit (${currencySymbol()})`].map((header) => (
                        <th key={header} className="whitespace-nowrap bg-gray-50 px-4 py-3 font-bold dark:bg-slate-800/60">{header}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {logLoading && !log ? (
                      <tr><td colSpan={7} className="px-4 py-8 text-center text-sm text-gray-400">Loading the call log…</td></tr>
                    ) : pathRows.length === 0 ? (
                      <tr><td colSpan={7} className="px-4 py-8 text-center text-sm text-gray-400">{logError || "No upgrades were offered on calls in this period."}</td></tr>
                    ) : pathRows.map((row) => (
                      <tr key={`${row.product}-${row.from}-${row.to}`} className="border-t border-gray-100 dark:border-slate-800 [&>td]:align-middle [&>td]:text-gray-800 dark:[&>td]:text-slate-200">
                        <td className="px-4 py-3 font-bold">{row.product}</td>
                        <td className="px-4 py-3">{row.from} → {row.to} {row.to === 1 ? "piece" : "pieces"}</td>
                        <td className="px-4 py-3">{count(row.offered)}</td>
                        <td className="px-4 py-3">{count(row.accepted)}</td>
                        <td className="px-4 py-3">{count(row.delivered)}</td>
                        <td className="px-4 py-3">{percent(row.offered > 0 ? row.delivered / row.offered : null)}</td>
                        <td className="px-4 py-3">{money0(row.profit)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {tab === "orders" && (
          <div className="space-y-3 px-4 pb-4">
            {repFilter && (
              <p className="m-0 inline-flex items-center gap-2 rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-bold text-sky-700">
                Showing {repFilter === OTHER_STAFF ? "other staff" : `${repName(repFilter)}'s`} upsells and cross-sells
                <button type="button" aria-label="Show every rep" onClick={() => setRepFilter(null)} className="!min-h-0"><X className="h-3.5 w-3.5" /></button>
              </p>
            )}
            <div className="overflow-x-auto rounded-xl border border-gray-100 dark:border-slate-800">
              <table className="w-full !min-w-[960px] text-sm">
                <thead>
                  <tr className="text-left text-xs font-bold text-gray-700 dark:text-slate-300">
                    {["Order", "Delivered", "Sales Rep", "Customer", "Product", "Type", "What was added", `Upsell Revenue (${currencySymbol()})`, `Cross-sell Revenue (${currencySymbol()})`, `Profit (${currencySymbol()})`, `Bonus (${currencySymbol()})`].map((header) => (
                      <th key={header} className="whitespace-nowrap bg-gray-50 px-4 py-3 font-bold dark:bg-slate-800/60">{header}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {orderRows.length === 0 ? (
                    <tr><td colSpan={11} className="px-4 py-10 text-center text-sm text-gray-400">No orders with an upsell or cross-sell were delivered in this period.</td></tr>
                  ) : orderRows.map((order) => (
                    <tr key={order.id} className="border-t border-gray-100 dark:border-slate-800 [&>td]:align-middle [&>td]:text-gray-800 dark:[&>td]:text-slate-200">
                      <td className="px-4 py-3">
                        <button type="button" onClick={() => onOpenOrder(order.id)} className="!min-h-0 font-black text-[#1F8FE0] hover:underline">#{order.id}</button>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">{order.deliveredKey ? longDay(order.deliveredKey) : "—"}</td>
                      <td className="px-4 py-3">{repName(order.repId)}</td>
                      <td className="px-4 py-3">{order.customerName}</td>
                      <td className="px-4 py-3">{order.productName}</td>
                      <td className="px-4 py-3"><TypePill order={order} /></td>
                      <td className="px-4 py-3 text-gray-600 dark:text-slate-400">{order.description}</td>
                      <td className="whitespace-nowrap px-4 py-3">{money(order.upsellRevenue)}</td>
                      <td className="whitespace-nowrap px-4 py-3">{money(order.crossSellRevenue)}</td>
                      <td className="px-4 py-3">{money0(order.contributionProfit)}</td>
                      <td className="px-4 py-3">{money0(order.bonus)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {tab === "customers" && (
          <div className="grid grid-cols-1 gap-4 px-4 pb-4 xl:grid-cols-2">
            <section className="rounded-xl border border-gray-100 p-4 dark:border-slate-800">
              <h3 className="m-0 text-sm font-black text-gray-900 dark:text-slate-100">Why customers say no</h3>
              <p className="m-0 mt-0.5 text-xs text-gray-500 dark:text-slate-400">The reason reps logged when a customer turned an upgrade down on the confirmation call.</p>
              {logLoading && !log ? (
                <p className="m-0 py-8 text-center text-sm text-gray-400">Loading the call log…</p>
              ) : refusals.length === 0 ? (
                <p className="m-0 py-8 text-center text-sm text-gray-400">{logError || "No upgrades were turned down in this period."}</p>
              ) : (
                <ul className="m-0 mt-4 list-none space-y-3 p-0">
                  {refusals.map((row) => (
                    <li key={row.label} className="grid grid-cols-[minmax(150px,auto)_1fr_auto] items-center gap-3 text-sm">
                      <span className="text-gray-700 dark:text-slate-300">{row.label}</span>
                      <span className="h-3 overflow-hidden rounded-full bg-gray-100 dark:bg-slate-800"><span className="block h-full rounded-full bg-rose-400" style={{ width: `${row.share * 100}%` }} /></span>
                      <span className="min-w-[88px] text-right text-gray-700 dark:text-slate-300">{count(row.value)} ({Math.round(row.share * 100)}%)</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="rounded-xl border border-gray-100 p-4 dark:border-slate-800">
              <h3 className="m-0 text-sm font-black text-gray-900 dark:text-slate-100">Who says yes</h3>
              <p className="m-0 mt-0.5 text-xs text-gray-500 dark:text-slate-400">Share of delivered orders that took an upsell or add-on, by type of customer.</p>
              {[
                { title: "New or repeat buyer", rows: segments.buyers },
                { title: "By state (busiest 8)", rows: segments.states },
                { title: "By size of the first order", rows: segments.sizes }
              ].map((group) => (
                <div key={group.title} className="mt-4">
                  <p className="m-0 text-[11px] font-black uppercase tracking-wider text-gray-400">{group.title}</p>
                  {group.rows.length === 0 ? (
                    <p className="m-0 mt-2 text-sm text-gray-400">Not enough delivered orders in this period.</p>
                  ) : (
                    <ul className="m-0 mt-2 list-none space-y-2 p-0">
                      {group.rows.map((row) => (
                        <li key={row.label} className="grid grid-cols-[minmax(140px,auto)_1fr_auto] items-center gap-3 text-sm">
                          <span className="truncate text-gray-700 dark:text-slate-300">{row.label}</span>
                          <span className="h-3 overflow-hidden rounded-full bg-gray-100 dark:bg-slate-800"><span className="block h-full rounded-full bg-emerald-500" style={{ width: `${Math.min(100, (row.conversion ?? 0) * 100 * 4)}%` }} /></span>
                          <span className="min-w-[132px] text-right text-gray-700 dark:text-slate-300">{percent(row.conversion)} · {count(row.withUpsell)} of {count(row.delivered)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </section>
          </div>
        )}
      </section>

      {drawerRow && (
        <RepDrawer
          row={drawerRow}
          calls={scopedCalls.filter((call) => call.repId === drawerRow.repId)}
          orders={scopedOrders.filter((order) => order.repId === drawerRow.repId)}
          orderById={orderById}
          window={window}
          logLoading={logLoading && !log}
          logError={logError}
          money0={money0}
          onOpenOrder={onOpenOrder}
          onClose={() => setDrawerRepId(null)}
        />
      )}
    </div>
  );
}

type RepRow = Totals & { repId: string; name: string; detail: string; targetPct: number | null; performance: PerformanceLabel | null; previousConversion: number | null };

/**
 * One rep's detail, opened from the table's ⋮ (or the row). The funnel follows
 * this period's CALLS: of the confirmation calls the rep logged, how many got
 * an upgrade offer, how many customers said yes, and how many of those orders
 * were then delivered with it.
 */
function RepDrawer({ row, calls, orders, orderById, window, logLoading, logError, money0, onOpenOrder, onClose }: {
  row: RepRow;
  calls: UpsellPerformanceLogRow[];
  orders: UpsellPerfOrder[];
  orderById: Map<string, UpsellPerfOrder>;
  window: DateWindow;
  logLoading: boolean;
  logError: string;
  money0: (value: number) => string;
  onOpenOrder: (orderId: string) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const offered = calls.filter((call) => call.upsell && call.upsell.response !== "waived_no_offer");
  const saidYes = calls.filter((call) => call.upsell?.response === "accepted" || isExpanded(orderById.get(call.orderId) ?? ({} as UpsellPerfOrder)));
  const delivered = saidYes.filter((call) => {
    const order = orderById.get(call.orderId);
    return order?.status === "Delivered" && isExpanded(order);
  });
  const stillOpen = calls.filter((call) => {
    const status = orderById.get(call.orderId)?.status;
    return status && !["Delivered", "Failed", "Cancelled"].includes(status);
  }).length;
  const steps = [
    { label: "Confirmation calls", value: calls.length },
    { label: "Upgrade offered", value: offered.length },
    { label: "Customer said yes", value: saidYes.length },
    { label: "Delivered with an upsell or add-on", value: delivered.length }
  ];

  const paths = new Map<string, { label: string; offered: number; delivered: number }>();
  for (const call of offered) {
    if (!call.upsell?.offeredQuantity) continue;
    const key = `${call.productName}|${call.originalQuantity}|${call.upsell.offeredQuantity}`;
    const entry = paths.get(key) ?? { label: `${call.productName} · ${call.originalQuantity} → ${call.upsell.offeredQuantity}`, offered: 0, delivered: 0 };
    entry.offered += 1;
    const order = orderById.get(call.orderId);
    if (order?.status === "Delivered" && order.hasUpsell) entry.delivered += 1;
    paths.set(key, entry);
  }
  const pathRows = [...paths.values()].sort((a, b) => b.offered - a.offered).slice(0, 6);

  const reasons = new Map<string, number>();
  for (const call of offered) {
    if (call.upsell?.response === "accepted") continue;
    const key = call.upsell?.refusalReason ? REFUSAL_LABEL[call.upsell.refusalReason] ?? call.upsell.refusalReason : "No reason given";
    reasons.set(key, (reasons.get(key) ?? 0) + 1);
  }
  const reasonRows = [...reasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
  const recent = orders
    .filter((order) => order.status === "Delivered" && inWindow(order.deliveredKey, window) && isExpanded(order))
    .sort((a, b) => (b.deliveredKey ?? "").localeCompare(a.deliveredKey ?? ""))
    .slice(0, 5);

  return createPortal((
    <div className="fixed inset-0 z-[70] flex justify-end bg-slate-900/30" onClick={onClose}>
      <aside role="dialog" aria-label={`${row.name} upsell and cross-sell performance`} onClick={(event) => event.stopPropagation()}
        className="h-full w-full max-w-md overflow-y-auto bg-white shadow-2xl dark:bg-slate-900">
        <header className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-gray-100 bg-white px-5 py-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center gap-3">
            <Avatar name={row.name} size="h-11 w-11 text-sm" />
            <div>
              <h2 className="m-0 text-base font-black text-gray-900 dark:text-slate-50">{row.name} — Upsell &amp; Cross-sell Performance</h2>
              <p className="m-0 text-xs text-gray-500 dark:text-slate-400">{count(row.upsells)} upsells · {count(row.crossSells)} cross-sells · {count(row.delivered)} delivered orders</p>
            </div>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="!min-h-0 rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 dark:hover:bg-slate-800"><X className="h-4 w-4" /></button>
        </header>

        <div className="space-y-6 px-5 py-5">
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: "Conversion rate", value: percent(row.conversion) },
              { label: "Upsell revenue", value: money(row.upsellRevenue) },
              { label: "Cross-sell revenue", value: money(row.crossSellRevenue) },
              { label: "Profit", value: money0(row.profit) },
              { label: "Bonus earned", value: money0(row.bonus) }
            ].map((stat) => (
              <div key={stat.label} className="rounded-xl border border-gray-100 p-3 dark:border-slate-800">
                <p className="m-0 text-[11px] font-bold uppercase tracking-wider text-gray-400">{stat.label}</p>
                <p className="m-0 mt-1 text-lg font-black text-gray-900 dark:text-slate-50">{stat.value}</p>
              </div>
            ))}
          </div>

          <section>
            <h3 className="m-0 text-sm font-black text-gray-900 dark:text-slate-100">From call to delivery</h3>
            <p className="m-0 mt-0.5 text-xs text-gray-500 dark:text-slate-400">The confirmation calls {row.name} logged in this period.</p>
            {logLoading ? <p className="m-0 mt-3 text-sm text-gray-400">Loading the call log…</p>
              : logError ? <p className="m-0 mt-3 text-sm text-rose-600">{logError}</p>
              : (
                <ol className="m-0 mt-3 list-none space-y-2 p-0">
                  {steps.map((step, index) => (
                    <li key={step.label}>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-gray-700 dark:text-slate-300">{step.label}</span>
                        <span className="font-bold text-gray-900 dark:text-slate-100">
                          {count(step.value)}{index > 0 && steps[0].value > 0 ? <span className="ml-1.5 text-xs font-semibold text-gray-400">{percent(step.value / steps[0].value)}</span> : null}
                        </span>
                      </div>
                      <span className="mt-1 block h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-slate-800">
                        <span className="block h-full rounded-full bg-[#1F8FE0]" style={{ width: `${steps[0].value > 0 ? (step.value / steps[0].value) * 100 : 0}%` }} />
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            {stillOpen > 0 && !logLoading && (
              <p className="m-0 mt-2 text-xs text-gray-500 dark:text-slate-400">
                {count(stillOpen)} of these orders are still open. An upsell only shows on an order once it is delivered or fails, so the last two steps can still grow.
              </p>
            )}
          </section>

          <section>
            <h3 className="m-0 text-sm font-black text-gray-900 dark:text-slate-100">What {row.name} sells best</h3>
            {pathRows.length === 0 ? <p className="m-0 mt-2 text-sm text-gray-400">No upgrades offered in this period.</p> : (
              <ul className="m-0 mt-2 list-none space-y-2 p-0">
                {pathRows.map((path) => (
                  <li key={path.label} className="flex items-center justify-between gap-3 rounded-lg bg-gray-50 px-3 py-2 text-sm dark:bg-slate-800/60">
                    <span className="text-gray-700 dark:text-slate-300">{path.label}</span>
                    <span className="whitespace-nowrap font-bold text-gray-900 dark:text-slate-100">{path.delivered}/{path.offered} → {percent(path.offered > 0 ? path.delivered / path.offered : null)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h3 className="m-0 text-sm font-black text-gray-900 dark:text-slate-100">Why their customers said no</h3>
            {reasonRows.length === 0 ? <p className="m-0 mt-2 text-sm text-gray-400">No refusals logged in this period.</p> : (
              <ul className="m-0 mt-2 list-none space-y-1.5 p-0 text-sm">
                {reasonRows.map(([label, value]) => (
                  <li key={label} className="flex justify-between text-gray-700 dark:text-slate-300"><span>{label}</span><span className="font-bold">{count(value)}</span></li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h3 className="m-0 text-sm font-black text-gray-900 dark:text-slate-100">Recent upsells and cross-sells</h3>
            {recent.length === 0 ? <p className="m-0 mt-2 text-sm text-gray-400">None delivered in this period.</p> : (
              <ul className="m-0 mt-2 list-none space-y-2 p-0">
                {recent.map((order) => (
                  <li key={order.id} className="rounded-lg border border-gray-100 px-3 py-2 text-sm dark:border-slate-800">
                    <div className="flex items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-2">
                        <button type="button" onClick={() => onOpenOrder(order.id)} className="!min-h-0 font-black text-[#1F8FE0] hover:underline">#{order.id}</button>
                        <TypePill order={order} />
                      </span>
                      <span className="font-bold text-gray-900 dark:text-slate-100">{money(order.extraRevenue)}</span>
                    </div>
                    <p className="m-0 mt-0.5 text-xs text-gray-500 dark:text-slate-400">{order.description}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </aside>
    </div>
  ), document.body);
}
