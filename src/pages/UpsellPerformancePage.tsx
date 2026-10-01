import { useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  Bar, CartesianGrid, Cell, ComposedChart, LabelList, Line, Pie, PieChart, ReferenceArea, ReferenceLine, ResponsiveContainer,
  Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis
} from "recharts";
import {
  AlertTriangle, ArrowDown, ArrowLeft, ArrowUp, Download, Filter, HandCoins, Layers, MoreVertical, PackagePlus,
  RefreshCw, Search, Target, TrendingUp, Trophy, UsersRound, X
} from "lucide-react";
import DateWindowNav from "../components/DateWindowNav";
import { shiftDay, shiftWindow, weekStart as sundayOf, windowSize, type DateWindow } from "../lib/date-window";
import { currencySymbol, money, shortMoney } from "../lib/money-privacy";
import type { UpsellPerformanceLog, UpsellPerformanceLogRow } from "../lib/api";

/**
 * Upselling & Cross-Selling Performance (Manager Dashboard).
 *
 * Layout (Bright, 1 Oct 2026 - "we need both so we can differentiate ... make
 * the cards smartly designed rather than crowd it"):
 *   header · a slim totals strip · an UPSELL scorecard next to a CROSS-SELL
 *   scorecard (each with its own rate, money, delivery rate and best/weakest
 *   rep) · one Both / Upsell / Cross-sell switch · then charts, rep cards, the
 *   rep table, the profit-vs-rate chart and the four tabs, ALL following the
 *   switch.
 *
 * Upsell = the customer took more pieces. Cross-sell = the customer added a
 * different product. They used to share one "Upsell" column, which hid that
 * cross-sell is most of this team's extra revenue (Chelsea, Sept: 7 upsells,
 * 13 cross-sells).
 *
 * ⚠️ THE MONEY COMES FROM App.tsx, NOT FROM HERE. Every order's extra revenue,
 * profit and rep bonus - split by upsell and cross-sell - comes from
 * expansionProfitBreakdownForOrder, the Upsell & Cross-Sell Bonus tab's own
 * function, so the two pages cannot disagree. This file only adds up.
 *
 * ⚠️ HOW THINGS ARE COUNTED
 * - Sales and money: by the day the order was DELIVERED, like the bonus tab.
 * - A rate = delivered orders with that kind ÷ delivered orders. "Both" is the
 *   measure the reps' weekly targets are set on.
 * - Delivery rate: upsold orders PLACED in the period that delivered ÷ those
 *   that finished (a failed order has no delivery date).
 * - The call log counts UPSELL offers only. Reps tick "no cross-sell offered"
 *   on every call, even ones that sold one, so a cross-sell offer rate would
 *   be false (Bright, 1 Oct 2026).
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
  /** What the customer first ordered, before any upsell or cross-sell. */
  originalValue: number;
  hasUpsell: boolean;
  hasCrossSell: boolean;
  upsellFromQty: number | null;
  upsellToQty: number | null;
  /** "1 to 2 pcs · Shelf + Edge Brusher Max" - what the rep added. */
  description: string;
  extraRevenue: number;
  contributionProfit: number;
  bonus: number;
  /** The three above, split by kind. Each pair adds up to its total. */
  upsellRevenue: number;
  crossSellRevenue: number;
  upsellProfit: number;
  crossSellProfit: number;
  upsellBonus: number;
  crossSellBonus: number;
  /** The cross-sell products on the order, with what each brought in. */
  addOns: Array<{ name: string; revenue: number }>;
};

export type UpsellPerfRep = { id: string; name: string; role?: string };

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

// ── Kinds ──────────────────────────────────────────────────────────────────
type Kind = "both" | "upsell" | "cross";
const KINDS: Kind[] = ["both", "upsell", "cross"];
const KIND_LABEL: Record<Kind, string> = { both: "Both", upsell: "Upsell", cross: "Cross-sell" };
const KIND_PLURAL: Record<Kind, string> = { both: "Upsells & cross-sells", upsell: "Upsells", cross: "Cross-sells" };
const KIND_RATE: Record<Kind, string> = { both: "Conversion rate", upsell: "Upsell rate", cross: "Cross-sell rate" };
const UPSELL_COLOR = "#22c55e";
const UPSELL_LINE = "#15803d";
const CROSS_COLOR = "#818cf8";
const CROSS_LINE = "#4338ca";

const isExpanded = (order: UpsellPerfOrder) => order.hasUpsell || order.hasCrossSell;
const hasKind = (order: UpsellPerfOrder, kind: Kind) =>
  kind === "both" ? isExpanded(order) : kind === "upsell" ? order.hasUpsell : order.hasCrossSell;
const revenueOf = (order: UpsellPerfOrder, kind: Kind) =>
  kind === "both" ? order.extraRevenue : kind === "upsell" ? order.upsellRevenue : order.crossSellRevenue;
const profitOf = (order: UpsellPerfOrder, kind: Kind) =>
  kind === "both" ? order.contributionProfit : kind === "upsell" ? order.upsellProfit : order.crossSellProfit;
const bonusOf = (order: UpsellPerfOrder, kind: Kind) =>
  kind === "both" ? order.bonus : kind === "upsell" ? order.upsellBonus : order.crossSellBonus;

/**
 * The table names Sales Reps. Orders handled by anyone else (an Admin, a
 * Recovery Rep, nobody) share one "Other staff" row, so the Total row still
 * matches the cards - but they never compete for best or weakest. (Onyin, an
 * Admin, closed 2 orders and showed up as "Lowest Bonus Earned ₦0".)
 */
const OTHER_STAFF = "__other__";
/** Fewer delivered orders than this and a rate is too thin to rank anyone on. */
const MIN_DELIVERED_TO_RANK = 5;

type Tab = "reps" | "products" | "orders" | "customers";
const TABS: Array<{ key: Tab; label: string }> = [
  { key: "reps", label: "Rep Performance" },
  { key: "products", label: "Product Breakdown" },
  { key: "orders", label: "Order Details" },
  { key: "customers", label: "Customer Insights" }
];

// Statuses say what the manager should DO, not what the rep IS (no "Poor").
// "Both" is judged against the rep's own target (set on the bonus tab).
// Upsell or cross-sell alone has no target of its own, so it is judged against
// the team's average for that kind.
type PerformanceLabel = "Strong" | "On Target" | "Below Target" | "Above Average" | "Below Average" | "Needs Attention";
const PERFORMANCE_TONE: Record<PerformanceLabel, string> = {
  Strong: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-200",
  "On Target": "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-500/30 dark:bg-sky-500/15 dark:text-sky-200",
  "Above Average": "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-500/30 dark:bg-sky-500/15 dark:text-sky-200",
  "Below Target": "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/15 dark:text-amber-200",
  "Below Average": "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/15 dark:text-amber-200",
  "Needs Attention": "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/15 dark:text-rose-200"
};
const PERFORMANCE_LABELS: Record<"target" | "average", PerformanceLabel[]> = {
  target: ["Strong", "On Target", "Below Target", "Needs Attention"],
  average: ["Strong", "Above Average", "Below Average", "Needs Attention"]
};
/** Bands around a benchmark: the rep's target ("Both") or the team average. */
const performanceFor = (rate: number | null, benchmarkPct: number | null, against: "target" | "average"): PerformanceLabel | null => {
  if (rate === null || !benchmarkPct) return null;
  const pct = rate * 100;
  if (pct >= benchmarkPct * 1.5) return "Strong";
  if (pct >= benchmarkPct) return against === "target" ? "On Target" : "Above Average";
  if (pct >= benchmarkPct * 0.5) return against === "target" ? "Below Target" : "Below Average";
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
const sum = <T,>(rows: T[], pick: (row: T) => number) => rows.reduce((total, row) => total + (Number(pick(row)) || 0), 0);
const ratio = (part: number, whole: number) => (whole > 0 ? part / whole : null);
const percent = (value: number | null, digits = 1) => (value === null ? "—" : `${(value * 100).toFixed(digits)}%`);
const count = (value: number) => value.toLocaleString("en-NG");
const shortDay = (key: string) => new Date(`${key}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const longDay = (key: string) => new Date(`${key}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const changePct = (current: number | null, previous: number | null) =>
  (current !== null && previous !== null && previous > 0 ? ((current - previous) / previous) * 100 : null);
const pointsChange = (current: number | null, previous: number | null) =>
  (current !== null && previous !== null ? (current - previous) * 100 : null);

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
    <span className={`inline-flex shrink-0 items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-black ${good ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-200" : "bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-200"}`}
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
      ? ["Cross-sell", "border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-500/30 dark:bg-indigo-500/15 dark:text-indigo-200"]
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

// ── Totals ─────────────────────────────────────────────────────────────────
type KindTotals = {
  orders: number;
  rate: number | null;
  revenue: number;
  profit: number;
  bonus: number;
  /** Orders of this kind PLACED in the period: delivered / finished. */
  placedDelivered: number;
  placedFinished: number;
};
type Totals = { handled: number; delivered: number } & Record<Kind, KindTotals>;

const totalsFor = (orders: UpsellPerfOrder[], window: DateWindow): Totals => {
  const delivered = orders.filter((order) => order.status === "Delivered" && inWindow(order.deliveredKey, window));
  const placed = orders.filter((order) => inWindow(order.createdKey, window));
  const kindTotals = (kind: Kind): KindTotals => {
    const rows = delivered.filter((order) => hasKind(order, kind));
    // ⚠️ By the day the order was PLACED: "do these orders actually deliver"
    // needs the failures too, and a failed order has no delivery date. An
    // upsell only shows on an order once it has delivered or failed.
    const placedKind = placed.filter((order) => hasKind(order, kind));
    return {
      orders: rows.length,
      rate: ratio(rows.length, delivered.length),
      revenue: sum(rows, (order) => revenueOf(order, kind)),
      profit: sum(rows, (order) => profitOf(order, kind)),
      bonus: sum(rows, (order) => bonusOf(order, kind)),
      placedDelivered: placedKind.filter((order) => order.status === "Delivered").length,
      placedFinished: placedKind.filter((order) => order.status === "Delivered" || order.status === "Failed").length
    };
  };
  return { handled: placed.length, delivered: delivered.length, both: kindTotals("both"), upsell: kindTotals("upsell"), cross: kindTotals("cross") };
};

type RepRow = Totals & { repId: string; name: string; detail: string; targetPct: number | null };
type Ranked = { row: RepRow; rate: number } | null;

/** Best and weakest Sales Rep at one kind, among reps with enough deliveries. */
const bestAndWeakest = (rows: RepRow[], kind: Kind): { best: Ranked; weakest: Ranked } => {
  const eligible = rows
    .filter((row) => row.repId !== OTHER_STAFF && row.delivered >= MIN_DELIVERED_TO_RANK && row[kind].rate !== null)
    .map((row) => ({ row, rate: row[kind].rate! }))
    .sort((a, b) => b.rate - a.rate || b.row[kind].orders - a.row[kind].orders);
  return {
    best: eligible[0] ?? null,
    weakest: eligible.length > 1 ? eligible[eligible.length - 1] : null
  };
};

// ── Scorecard ──────────────────────────────────────────────────────────────
type ScoreStat = { label: string; value: string; hint: string };

/**
 * One of the three cards at the top: Both (upsell + cross-sell together),
 * Upsell, Cross-sell. Same layout for all three so they read side by side.
 * The selected one is outlined - it is what everything below is showing.
 */
function ScoreCard({
  kind, icon: Icon, title, subtitle, current, previous, delivered, stats, footnote, best, weakest, selected, onSelect
}: {
  kind: Kind;
  icon: ComponentType<{ className?: string }>;
  title: string;
  subtitle: string;
  current: KindTotals;
  previous: KindTotals;
  delivered: number;
  stats: ScoreStat[];
  footnote: ReactNode;
  best: Ranked;
  weakest: Ranked;
  selected: boolean;
  onSelect: () => void;
}) {
  const accent = kind === "upsell"
    ? { ring: "border-emerald-200 dark:border-emerald-500/30", selected: "ring-2 ring-emerald-500", band: "bg-emerald-500", tile: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-200", text: "text-emerald-700 dark:text-emerald-200" }
    : kind === "cross"
      ? { ring: "border-indigo-200 dark:border-indigo-500/30", selected: "ring-2 ring-indigo-500", band: "bg-indigo-500", tile: "bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-200", text: "text-indigo-700 dark:text-indigo-200" }
      : { ring: "border-violet-200 dark:border-violet-500/30", selected: "ring-2 ring-violet-500", band: "bg-gradient-to-r from-emerald-500 to-indigo-500", tile: "bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-200", text: "text-violet-700 dark:text-violet-200" };
  return (
    <article className={`relative flex flex-col overflow-hidden rounded-2xl border bg-white shadow-sm transition-shadow dark:bg-slate-900 ${accent.ring} ${selected ? accent.selected : ""}`}>
      <span className={`absolute inset-x-0 top-0 h-1 ${accent.band}`} />
      <div className="flex-1 p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${accent.tile}`}><Icon className="h-5 w-5" /></span>
            <div className="min-w-0">
              <h2 className="m-0 text-base font-black text-gray-900 dark:text-slate-50">{title}</h2>
              <p className="m-0 text-xs text-gray-500 dark:text-slate-400">{subtitle}</p>
            </div>
          </div>
          {selected ? (
            <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-black ${accent.tile}`}>Showing below</span>
          ) : (
            <button type="button" onClick={onSelect}
              className={`!min-h-0 inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs font-bold hover:bg-gray-50 dark:hover:bg-slate-800 ${accent.text}`}>
              Show below <ArrowDown className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <div className="mt-5 grid grid-cols-2 gap-4">
          <div className="min-w-0">
            <p className="m-0 text-[11px] font-bold uppercase tracking-wider text-gray-400">Extra revenue</p>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
              <strong className="text-[22px] font-black leading-none text-gray-900 dark:text-slate-50">{money(current.revenue)}</strong>
              <DeltaPill value={changePct(current.revenue, previous.revenue)} />
            </div>
            <p className="m-0 mt-1.5 text-xs text-gray-500 dark:text-slate-400">{count(current.orders)} {current.orders === 1 ? "order" : "orders"}</p>
          </div>
          <div className="min-w-0">
            <p className="m-0 text-[11px] font-bold uppercase tracking-wider text-gray-400">{KIND_RATE[kind]}</p>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
              <strong className="text-[22px] font-black leading-none text-gray-900 dark:text-slate-50">{percent(current.rate)}</strong>
              <DeltaPill value={pointsChange(current.rate, previous.rate)} unit="pts" />
            </div>
            <p className="m-0 mt-1.5 text-xs text-gray-500 dark:text-slate-400">of {count(delivered)} delivered orders</p>
          </div>
        </div>

        <dl className="m-0 mt-5 grid grid-cols-2 gap-3 border-t border-gray-100 pt-4 sm:grid-cols-4 dark:border-slate-800">
          {stats.map((stat) => (
            <div key={stat.label} title={stat.hint} className="min-w-0">
              <dt className="truncate text-[11px] font-semibold text-gray-500 dark:text-slate-400">{stat.label}</dt>
              <dd className="m-0 mt-0.5 text-sm font-black text-gray-900 dark:text-slate-100">{stat.value}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-3 text-xs text-gray-500 dark:text-slate-400">{footnote}</div>
      </div>

      <div className="grid grid-cols-2 border-t border-gray-100 dark:border-slate-800">
        {[
          { label: "Best rate", entry: best, tone: "text-emerald-700 dark:text-emerald-200", icon: Trophy },
          { label: "Lowest rate", entry: weakest, tone: "text-rose-700 dark:text-rose-200", icon: AlertTriangle }
        ].map(({ label, entry, tone, icon: RowIcon }, index) => (
          <div key={label} className={`flex min-w-0 items-center gap-2 px-4 py-3 ${index === 0 ? "border-r border-gray-100 dark:border-slate-800" : ""}`}>
            <RowIcon className={`h-4 w-4 shrink-0 ${tone}`} />
            {entry ? (
              <>
                <Avatar name={entry.row.name} size="h-7 w-7 text-[10px]" />
                <div className="min-w-0">
                  <p className="m-0 text-[11px] font-semibold text-gray-500 dark:text-slate-400">{label}</p>
                  <p className="m-0 truncate text-sm font-bold text-gray-900 dark:text-slate-100" title={`${entry.row.name} · ${percent(entry.rate)} (${entry.row[kind].orders})`}>
                    {entry.row.name} <span className={tone}>{percent(entry.rate)}</span>
                  </p>
                </div>
              </>
            ) : (
              <p className="m-0 text-xs text-gray-400">{label}: not enough orders</p>
            )}
          </div>
        ))}
      </div>
    </article>
  );
}

export default function UpsellPerformancePage({
  orders, reps, log, logLoading, logError, moneyReady, window, onWindowChange, todayKey,
  refreshing, onRefresh, onBack, onOpenOrder
}: Props) {
  const [kind, setKind] = useState<Kind>("both");
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

  // Status labels differ by kind (target vs team average), so a status filter
  // from one kind means nothing in the next.
  useEffect(() => { setPerformanceFilter(new Set()); }, [kind]);

  const previousWindow = useMemo(() => shiftWindow(window, -windowSize(window)), [window]);
  // A sensible grouping for the range picked; the dropdown can still change it.
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
  const money0 = (value: number) => (moneyReady ? money(value) : "…");

  // ── Whole business (the strip and the two scorecards) ─────────────────
  const current = useMemo(() => totalsFor(orders, window), [orders, window]);
  const previous = useMemo(() => totalsFor(orders, previousWindow), [orders, previousWindow]);
  const deliveredInWindow = useMemo(
    () => orders.filter((order) => order.status === "Delivered" && inWindow(order.deliveredKey, window)),
    [orders, window]
  );

  // Offer rate: upsell only - the cross-sell side of the call log is not
  // filled in honestly (see the header comment).
  const callsInWindow = useMemo(() => (log?.attempts ?? []).filter((call) => call.eligible && inWindow(call.attemptedKey, window)), [log, window]);
  const upsellOfferRate = ratio(callsInWindow.filter((call) => call.upsell && call.upsell.response !== "waived_no_offer").length, callsInWindow.length);

  // ── Everything below the switch ───────────────────────────────────────
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
    if (productFilter.size === 0) return callsInWindow;
    return callsInWindow.filter((call) => productFilter.has(call.productId ?? `name:${call.productName.trim().toLowerCase()}`));
  }, [callsInWindow, productFilter]);
  const orderById = useMemo(() => new Map(orders.map((order) => [order.id, order])), [orders]);
  const targetByRep = useMemo(() => new Map((log?.targets ?? []).map((target) => [target.repId, target.targetPct])), [log]);

  // Every row has every kind; the switch only chooses which one to show.
  const repRows = useMemo<RepRow[]>(() => {
    const groups = new Map<string, UpsellPerfOrder[]>();
    const otherNames = new Set<string>();
    for (const order of scopedOrders) {
      if (!inWindow(order.createdKey, window) && !(order.status === "Delivered" && inWindow(order.deliveredKey, window))) continue;
      const rowId = rowIdFor(order.repId);
      if (rowId === OTHER_STAFF) otherNames.add(repName(order.repId));
      if (!groups.has(rowId)) groups.set(rowId, []);
    }
    for (const order of scopedOrders) groups.get(rowIdFor(order.repId))?.push(order);
    return [...groups.entries()].map(([repId, mine]) => ({
      repId,
      name: repId === OTHER_STAFF ? "Other staff" : repName(repId),
      detail: repId === OTHER_STAFF ? [...otherNames].sort().join(", ") : "",
      targetPct: repId === OTHER_STAFF ? null : targetByRep.get(repId) ?? null,
      ...totalsFor(mine, window)
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopedOrders, window, targetByRep, repName, salesRepIds]);

  // The team's rate per kind - the benchmark when a kind has no target of its
  // own. Every row, other staff included, so it is the same number as the
  // scorecard and the table's Total row (5.3% must not sit next to 5.4%).
  const teamRate = useMemo(() => {
    const team = repRows;
    const delivered = sum(team, (row) => row.delivered);
    return {
      both: ratio(sum(team, (row) => row.both.orders), delivered),
      upsell: ratio(sum(team, (row) => row.upsell.orders), delivered),
      cross: ratio(sum(team, (row) => row.cross.orders), delivered)
    } as Record<Kind, number | null>;
  }, [repRows]);
  const statusFor = (row: RepRow): PerformanceLabel | null => {
    if (row.repId === OTHER_STAFF) return null;
    return kind === "both"
      ? performanceFor(row.both.rate, row.targetPct, "target")
      : performanceFor(row[kind].rate, teamRate[kind] === null ? null : teamRate[kind]! * 100, "average");
  };
  const statusLabels = PERFORMANCE_LABELS[kind === "both" ? "target" : "average"];

  const ranked = useMemo(() => ({
    upsell: bestAndWeakest(repRows, "upsell"),
    cross: bestAndWeakest(repRows, "cross"),
    both: bestAndWeakest(repRows, "both")
  }), [repRows]);

  const visibleRepRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    const rows = repRows.filter((row) =>
      (!query || row.name.toLowerCase().includes(query))
      && (performanceFilter.size === 0 || (statusFor(row) !== null && performanceFilter.has(statusFor(row)!)))
    );
    // Best rate first for the kind on screen; other staff always last.
    return [
      ...rows.filter((row) => row.repId !== OTHER_STAFF)
        .sort((a, b) => (b[kind].rate ?? -1) - (a[kind].rate ?? -1) || b[kind].revenue - a[kind].revenue || a.name.localeCompare(b.name)),
      ...rows.filter((row) => row.repId === OTHER_STAFF)
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repRows, search, performanceFilter, kind, teamRate]);

  const tableTotals = useMemo(() => {
    const delivered = sum(visibleRepRows, (row) => row.delivered);
    const kindSum = (k: Kind) => ({
      orders: sum(visibleRepRows, (row) => row[k].orders),
      rate: ratio(sum(visibleRepRows, (row) => row[k].orders), delivered),
      revenue: sum(visibleRepRows, (row) => row[k].revenue),
      profit: sum(visibleRepRows, (row) => row[k].profit),
      bonus: sum(visibleRepRows, (row) => row[k].bonus)
    });
    return { handled: sum(visibleRepRows, (row) => row.handled), delivered, both: kindSum("both"), upsell: kindSum("upsell"), cross: kindSum("cross") };
  }, [visibleRepRows]);

  const repCards = useMemo(() => {
    const active = repRows.filter((row) => row.repId !== OTHER_STAFF && row.delivered > 0);
    const byProfit = [...active].sort((a, b) => b[kind].profit - a[kind].profit);
    const byBonus = [...active].sort((a, b) => b[kind].bonus - a[kind].bonus);
    if (kind === "both") {
      const withTarget = active.filter((row) => row.targetPct);
      const halves = withTarget.map((row) => row.targetPct! / 2);
      return {
        top: byProfit[0] ?? null,
        benchmarkTitle: "Reps Met Target",
        benchmarkCount: withTarget.filter((row) => (row.both.rate ?? 0) * 100 >= row.targetPct!).length,
        benchmarkSub: `Out of ${active.length} reps`,
        needsHelp: withTarget.filter((row) => (row.both.rate ?? 0) * 100 < row.targetPct! / 2).length,
        needsHelpSub: `Below ${halves.length > 0 && halves.every((value) => value === halves[0]) ? `${halves[0]}%` : "half their target"} conversion rate`,
        highestBonus: byBonus[0] ?? null,
        lowestBonus: byBonus.length > 0 ? byBonus[byBonus.length - 1] : null
      };
    }
    const average = teamRate[kind];
    return {
      top: byProfit[0] ?? null,
      benchmarkTitle: "Above Team Average",
      benchmarkCount: average === null ? 0 : active.filter((row) => (row[kind].rate ?? 0) >= average).length,
      benchmarkSub: `Team ${KIND_RATE[kind].toLowerCase()} ${percent(average)} · ${active.length} reps`,
      needsHelp: average === null ? 0 : active.filter((row) => (row[kind].rate ?? 0) < average / 2).length,
      needsHelpSub: `Below ${percent(average === null ? null : average / 2)} ${KIND_RATE[kind].toLowerCase()} (half the team's)`,
      highestBonus: byBonus[0] ?? null,
      lowestBonus: byBonus.length > 0 ? byBonus[byBonus.length - 1] : null
    };
  }, [repRows, kind, teamRate]);

  // ── Charts (follow the switch) ────────────────────────────────────────
  const trend = useMemo(() => {
    const chartWindow = { start: window.start, end: window.end < todayKey ? window.end : todayKey };
    const buckets: Array<{ label: string; start: string; end: string }> = [];
    if (trendGrain === "Daily") {
      for (let day = chartWindow.start; day <= chartWindow.end; day = shiftDay(day, 1)) buckets.push({ label: shortDay(day), start: day, end: day });
    } else if (trendGrain === "Weekly") {
      for (let start = sundayOf(chartWindow.start); start <= chartWindow.end; start = shiftDay(start, 7)) {
        const end = shiftDay(start, 6);
        buckets.push({ label: `${shortDay(start)} – ${shortDay(end)}`, start: start < chartWindow.start ? chartWindow.start : start, end: end > chartWindow.end ? chartWindow.end : end });
      }
    } else {
      for (let month = chartWindow.start.slice(0, 7); month <= chartWindow.end.slice(0, 7);) {
        const first = `${month}-01`;
        const next = new Date(`${first}T00:00:00Z`);
        next.setUTCMonth(next.getUTCMonth() + 1);
        const last = shiftDay(next.toISOString().slice(0, 10), -1);
        buckets.push({
          label: new Date(`${first}T12:00:00`).toLocaleDateString("en-GB", { month: "short", year: "numeric" }),
          start: first < chartWindow.start ? chartWindow.start : first,
          end: last > chartWindow.end ? chartWindow.end : last
        });
        month = next.toISOString().slice(0, 7);
      }
    }
    return buckets.map((bucket) => {
      const delivered = deliveredInWindow.filter((order) => productFilter.size === 0 || productFilter.has(order.productKey)).filter((order) => inWindow(order.deliveredKey, bucket));
      // No deliveries is "no rate", not 0% - a gap, not a dive to the floor.
      const rateOf = (k: Kind) => (delivered.length > 0 ? Math.round((delivered.filter((order) => hasKind(order, k)).length / delivered.length) * 1000) / 10 : null);
      return {
        label: bucket.label,
        upsellRevenue: Math.round(sum(delivered.filter((order) => order.hasUpsell), (order) => order.upsellRevenue)),
        crossRevenue: Math.round(sum(delivered.filter((order) => order.hasCrossSell), (order) => order.crossSellRevenue)),
        upsellRate: rateOf("upsell"),
        crossRate: rateOf("cross")
      };
    });
  }, [deliveredInWindow, trendGrain, window, todayKey, productFilter]);

  const kindDelivered = useMemo(
    () => deliveredInWindow.filter((order) => (productFilter.size === 0 || productFilter.has(order.productKey)) && hasKind(order, kind)),
    [deliveredInWindow, kind, productFilter]
  );

  // Upsell and "Both": by the product the customer ordered. Cross-sell: by
  // the extra product they added - that's the question for cross-sell.
  const byProduct = useMemo(() => {
    const groups = new Map<string, number>();
    const add = (name: string, value: number) => groups.set(name, (groups.get(name) ?? 0) + value);
    for (const order of kindDelivered) {
      if (kind === "cross") {
        const totalAddOnRevenue = sum(order.addOns, (addOn) => addOn.revenue);
        for (const addOn of order.addOns) {
          const share = totalAddOnRevenue > 0 ? addOn.revenue / totalAddOnRevenue : 1 / Math.max(1, order.addOns.length);
          add(addOn.name || "Unnamed product", productMetric === "Orders" ? 1 : productMetric === "Profit" ? order.crossSellProfit * share : addOn.revenue);
        }
      } else {
        add(order.productName || "Unnamed product", productMetric === "Orders" ? 1 : productMetric === "Profit" ? profitOf(order, kind) : revenueOf(order, kind));
      }
    }
    const rankedRows = [...groups.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
    const top = rankedRows.slice(0, 4);
    const rest = rankedRows.slice(4);
    if (rest.length > 0) top.push({ name: "Others", value: sum(rest, (row) => row.value) });
    const total = sum(top, (row) => row.value);
    return { rows: top.map((row) => ({ ...row, share: total > 0 ? row.value / total : 0 })), total };
  }, [kindDelivered, kind, productMetric]);

  const metricOf = (rows: UpsellPerfOrder[], k: Kind) =>
    packageMetric === "Orders" ? rows.length : packageMetric === "Profit" ? sum(rows, (order) => profitOf(order, k)) : sum(rows, (order) => revenueOf(order, k));
  const byPackage = useMemo(() => {
    let rows: Array<{ label: string; hint: string; color: string; value: number }>;
    if (kind === "cross") {
      const addOnCount = (order: UpsellPerfOrder) => Math.max(1, order.addOns.length);
      rows = [
        { label: "1 extra product", hint: "Orders with one cross-sell product", color: "bg-indigo-400", value: metricOf(kindDelivered.filter((order) => addOnCount(order) === 1), "cross") },
        { label: "2 extra products", hint: "Orders with two cross-sell products", color: "bg-indigo-500", value: metricOf(kindDelivered.filter((order) => addOnCount(order) === 2), "cross") },
        { label: "3+ extra products", hint: "Orders with three or more cross-sell products", color: "bg-indigo-700", value: metricOf(kindDelivered.filter((order) => addOnCount(order) >= 3), "cross") }
      ];
    } else {
      // Each order lands in exactly ONE bar, so the bars add up to the orders.
      const upsells = kindDelivered.filter((order) => order.hasUpsell);
      rows = [
        { label: "2 Pieces / Bulk", hint: "Moved up from 1 piece to 2 or more", color: "bg-emerald-500", value: metricOf(upsells.filter((order) => (order.upsellFromQty ?? 1) <= 1), kind) },
        { label: "Higher Tier Pack", hint: "Already on a pack of 2 or more, moved to a bigger one", color: "bg-emerald-700", value: metricOf(upsells.filter((order) => (order.upsellFromQty ?? 1) >= 2), kind) }
      ];
      if (kind === "both") {
        rows.push({ label: "Cross-sell only", hint: "Added another product without taking more pieces", color: "bg-indigo-500", value: metricOf(kindDelivered.filter((order) => !order.hasUpsell && order.hasCrossSell), kind) });
      }
    }
    const total = sum(rows, (row) => row.value);
    return rows.map((row) => ({ ...row, share: total > 0 ? row.value / total : 0 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kindDelivered, kind, packageMetric]);

  // Profit vs rate: each Sales Rep as a bubble, split at the team average.
  const matrix = useMemo(() => {
    const points = repRows
      .filter((row) => row.repId !== OTHER_STAFF && row.delivered > 0)
      .map((row) => ({ name: row.name, repId: row.repId, x: Math.round((row[kind].rate ?? 0) * 1000) / 10, y: Math.round(row[kind].profit), z: row.delivered }));
    if (points.length === 0) return null;
    const avgX = teamRate[kind] === null ? 0 : Math.round(teamRate[kind]! * 1000) / 10;
    const avgY = Math.round(sum(points, (point) => point.y) / points.length);
    const xMax = Math.ceil(Math.max(avgX * 2, ...points.map((point) => point.x)) * 1.15) || 10;
    const yMin = Math.min(0, ...points.map((point) => point.y));
    const yMax = Math.max(avgY * 2, ...points.map((point) => point.y)) * 1.15 || 1000;
    const zone = (point: { x: number; y: number }) =>
      point.x >= avgX ? (point.y >= avgY ? "#10b981" : "#0ea5e9") : (point.y >= avgY ? "#f59e0b" : "#f43f5e");
    return { points: points.map((point) => ({ ...point, color: zone(point) })), avgX, avgY, xMax, yMin, yMax };
  }, [repRows, kind, teamRate]);

  // ── Tabs ──────────────────────────────────────────────────────────────
  const productRows = useMemo(() => {
    const groups = new Map<string, { name: string; rows: UpsellPerfOrder[] }>();
    for (const order of scopedOrders) {
      if (order.status !== "Delivered" || !inWindow(order.deliveredKey, window)) continue;
      const group = groups.get(order.productKey) ?? { name: order.productName || "Unnamed product", rows: [] };
      group.rows.push(order);
      groups.set(order.productKey, group);
    }
    const query = search.trim().toLowerCase();
    const kindTotals = (rows: UpsellPerfOrder[], k: Kind) => {
      const mine = rows.filter((order) => hasKind(order, k));
      return { orders: mine.length, rate: ratio(mine.length, rows.length), revenue: sum(mine, (order) => revenueOf(order, k)), profit: sum(mine, (order) => profitOf(order, k)), bonus: sum(mine, (order) => bonusOf(order, k)) };
    };
    return [...groups.entries()].map(([key, group]) => ({
      key, name: group.name, delivered: group.rows.length,
      both: kindTotals(group.rows, "both"), upsell: kindTotals(group.rows, "upsell"), cross: kindTotals(group.rows, "cross")
    })).filter((row) => !query || row.name.toLowerCase().includes(query))
      .sort((a, b) => b[kind].revenue - a[kind].revenue || b.delivered - a.delivered);
  }, [scopedOrders, window, search, kind]);

  // Which products were cross-sold. An order with two add-ons counts once for
  // each product, so Orders here can add up to more than the cross-sell count.
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
        group.profit += order.upsellProfit;
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
      .filter((order) => order.status === "Delivered" && inWindow(order.deliveredKey, window) && hasKind(order, kind))
      .filter((order) => !repFilter || rowIdFor(order.repId) === repFilter)
      .filter((order) => !query || [order.id, order.customerName, order.productName, repName(order.repId)].some((value) => value.toLowerCase().includes(query)))
      .sort((a, b) => (b.deliveredKey ?? "").localeCompare(a.deliveredKey ?? "") || b.id.localeCompare(a.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopedOrders, window, repFilter, search, repName, salesRepIds, kind]);

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
    const rate = (rows: UpsellPerfOrder[]) => {
      const yes = rows.filter((order) => hasKind(order, kind)).length;
      return { delivered: rows.length, yes, rate: ratio(yes, rows.length) };
    };
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
    // split means the same thing in every branch's currency. Most orders share
    // a package price, so fall back to price points, or two bands.
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
  }, [scopedOrders, window, search, kind]);

  const exportTab = () => {
    const stamp = `${KIND_LABEL[kind].toLowerCase()}-${window.start}_to_${window.end}`;
    const kindCols = (k: Kind) => [`${KIND_LABEL[k]} orders`, `${KIND_RATE[k]}`, `${KIND_LABEL[k]} revenue`, `${KIND_LABEL[k]} profit`, `${KIND_LABEL[k]} bonus`];
    const kindVals = (t: { orders: number; rate: number | null; revenue: number; profit: number; bonus: number }) =>
      [t.orders, percent(t.rate), Math.round(t.revenue), Math.round(t.profit), Math.round(t.bonus)];
    const kinds: Kind[] = kind === "both" ? ["upsell", "cross"] : [kind];
    if (tab === "reps") {
      downloadCsv(`upsell-performance-reps-${stamp}.csv`,
        ["Sales rep", "Orders handled", "Delivered orders", ...kinds.flatMap(kindCols), "Target", "Status"],
        visibleRepRows.map((row) => [row.name, row.handled, row.delivered, ...kinds.flatMap((k) => kindVals(row[k])), row.targetPct ? `${row.targetPct}%` : "", statusFor(row) ?? ""]));
    } else if (tab === "products") {
      downloadCsv(`upsell-performance-products-${stamp}.csv`,
        ["Product", "Delivered orders", ...kinds.flatMap(kindCols)],
        productRows.map((row) => [row.name, row.delivered, ...kinds.flatMap((k) => kindVals(row[k]))]));
    } else if (tab === "orders") {
      downloadCsv(`upsell-performance-orders-${stamp}.csv`,
        ["Order", "Delivered", "Sales rep", "Customer", "Product", "Type", "What was added", "Upsell revenue", "Cross-sell revenue", "Profit", "Bonus"],
        orderRows.map((order) => [order.id, order.deliveredKey ?? "", repName(order.repId), order.customerName, order.productName, order.hasUpsell && order.hasCrossSell ? "Both" : order.hasCrossSell ? "Cross-sell" : "Upsell", order.description, Math.round(order.upsellRevenue), Math.round(order.crossSellRevenue), Math.round(profitOf(order, kind)), Math.round(bonusOf(order, kind))]));
    } else {
      downloadCsv(`upsell-performance-customers-${stamp}.csv`,
        ["Group", "Label", "Delivered orders", `${KIND_PLURAL[kind]}`, KIND_RATE[kind]],
        [
          ...(kind === "cross" ? [] : refusals.map((row) => ["Why customers said no to an upsell", row.label, row.value, "", percent(row.share)])),
          ...segments.buyers.map((row) => ["Buyer type", row.label, row.delivered, row.yes, percent(row.rate)]),
          ...segments.states.map((row) => ["State", row.label, row.delivered, row.yes, percent(row.rate)]),
          ...segments.sizes.map((row) => ["Order size", row.label, row.delivered, row.yes, percent(row.rate)])
        ]);
    }
  };

  const filterCount = productFilter.size + performanceFilter.size;
  const searchPlaceholder = tab === "reps" ? "Search sales rep..." : tab === "products" ? "Search product..." : tab === "orders" ? "Search order, customer or rep..." : "Search reason or state...";
  const drawerRow = repRows.find((row) => row.repId === drawerRepId) ?? null;
  const bonusShare = ratio(current.both.bonus, current.both.profit + current.both.bonus);
  const previousBonusShare = ratio(previous.both.bonus, previous.both.profit + previous.both.bonus);
  const kindTitle = kind === "both" ? "Upsell & Cross-sell" : KIND_LABEL[kind];

  // The three cards. Same four stats each, so they compare line for line;
  // the Both card swaps "Avg per order" for the bonus share of profit.
  const statsFor = (k: Kind): ScoreStat[] => {
    const t = current[k];
    const deliveryRate = ratio(t.placedDelivered, t.placedFinished);
    return [
      { label: "Profit", value: money0(t.profit), hint: "After product cost and rep bonus" },
      { label: "Rep bonus", value: money0(t.bonus), hint: "Bonus paid on these orders, from the bonus rules" },
      k === "both"
        ? { label: "Bonus share", value: moneyReady ? percent(bonusShare) : "…", hint: "Of the profit before bonuses, the part paid out as rep bonus" }
        : { label: "Avg per order", value: t.orders > 0 ? money(t.revenue / t.orders) : "—", hint: "Extra revenue on each order" },
      { label: "Delivered", value: percent(deliveryRate, 0), hint: `${t.placedDelivered} of ${t.placedFinished} such orders placed in this period delivered` }
    ];
  };
  const revenueSplit = ratio(current.upsell.revenue, current.upsell.revenue + current.cross.revenue);
  const bothFootnote = (
    <div>
      <div className="flex justify-between gap-2">
        <span><span className="font-bold text-emerald-700 dark:text-emerald-300">Upsell</span> {money(current.upsell.revenue)}</span>
        <span><span className="font-bold text-indigo-700 dark:text-indigo-300">Cross-sell</span> {money(current.cross.revenue)}</span>
      </div>
      <div className="mt-1.5 flex h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-slate-800">
        <span className="h-full bg-emerald-500" style={{ width: `${(revenueSplit ?? 0) * 100}%` }} />
        <span className="h-full flex-1 bg-indigo-400" />
      </div>
    </div>
  );

  const th = "whitespace-nowrap bg-gray-50 px-2.5 py-3 font-bold dark:bg-slate-800/60";
  const td = "px-2.5 py-3";
  const rowClass = "border-t border-gray-100 dark:border-slate-800 [&>td]:align-middle [&>td]:text-gray-800 dark:[&>td]:text-slate-200";
  const bestWorstTone = (k: Kind, row: RepRow) =>
    ranked[k].best?.row.repId === row.repId ? "font-black text-emerald-700 dark:text-emerald-300"
      : ranked[k].weakest?.row.repId === row.repId ? "font-black text-rose-600 dark:text-rose-300" : "";

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
              <p className="m-0 mt-1 text-sm text-gray-500 dark:text-slate-400">Track, compare and reward sales reps on upsells and cross-sells, side by side.</p>
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

      {/* ── One switch for the whole page ───────────────────────────── */}
      <div className="flex flex-col gap-3 rounded-2xl border border-gray-200 bg-white px-4 py-3 shadow-sm sm:flex-row sm:items-center sm:justify-between dark:border-slate-800 dark:bg-slate-900">
        <p className="m-0 text-sm text-gray-600 dark:text-slate-300">
          Showing <strong className="text-gray-900 dark:text-slate-50">{kind === "both" ? "upsell and cross-sell combined" : `${KIND_LABEL[kind].toLowerCase()} only`}</strong> in the charts, rep cards and tables below.
        </p>
        <div className="inline-flex rounded-xl bg-gray-100 p-1 dark:bg-slate-800" role="tablist" aria-label="Both, upsell or cross-sell">
          {KINDS.map((item) => (
            <button key={item} type="button" role="tab" aria-selected={kind === item} onClick={() => setKind(item)}
              className={`!min-h-0 rounded-lg px-4 py-1.5 text-sm font-bold transition-colors ${kind === item
                ? item === "upsell" ? "bg-emerald-600 text-white shadow-sm" : item === "cross" ? "bg-indigo-600 text-white shadow-sm" : "bg-violet-600 text-white shadow-sm"
                : "text-gray-600 hover:text-gray-900 dark:text-slate-300 dark:hover:text-white"}`}>
              {KIND_LABEL[item]}
            </button>
          ))}
        </div>
      </div>

      {/* ── Both | Upsell | Cross-sell ─────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <ScoreCard
          kind="both" icon={Layers} title="Both" subtitle="Upsell and cross-sell combined"
          current={current.both} previous={previous.both} delivered={current.delivered}
          stats={statsFor("both")} footnote={bothFootnote}
          best={ranked.both.best} weakest={ranked.both.weakest}
          selected={kind === "both"} onSelect={() => setKind("both")}
        />
        <ScoreCard
          kind="upsell" icon={TrendingUp} title="Upsell" subtitle="Customer took more pieces"
          current={current.upsell} previous={previous.upsell} delivered={current.delivered}
          stats={statsFor("upsell")}
          footnote={upsellOfferRate === null ? "Offer rate: no confirmation calls logged in this period." : `Offered on ${percent(upsellOfferRate, 0)} of confirmation calls.`}
          best={ranked.upsell.best} weakest={ranked.upsell.weakest}
          selected={kind === "upsell"} onSelect={() => setKind("upsell")}
        />
        <ScoreCard
          kind="cross" icon={PackagePlus} title="Cross-sell" subtitle="Customer added another product"
          current={current.cross} previous={previous.cross} delivered={current.delivered}
          stats={statsFor("cross")}
          footnote="Offer rate: reps don't log cross-sell offers yet."
          best={ranked.cross.best} weakest={ranked.cross.weakest}
          selected={kind === "cross"} onSelect={() => setKind("cross")}
        />
      </div>

      {/* ── Three charts ───────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between gap-2">
            <h2 className="m-0 text-base font-black text-gray-900 dark:text-slate-100">{kindTitle} Trend</h2>
            <SelectPill label="Trend grouping" value={trendGrain} options={["Daily", "Weekly", "Monthly"]} onChange={setTrendGrain} />
          </div>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600 dark:text-slate-400">
            {kind !== "cross" && <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: UPSELL_COLOR }} />Upsell revenue</span>}
            {kind !== "upsell" && <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: CROSS_COLOR }} />Cross-sell revenue</span>}
            {kind !== "cross" && <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-3" style={{ background: UPSELL_LINE }} />Upsell rate</span>}
            {kind !== "upsell" && <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-3" style={{ background: CROSS_LINE }} />Cross-sell rate</span>}
          </div>
          <div className="mt-3 h-56">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={trend} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                <XAxis dataKey="label" tick={<RangeTick />} height={34} tickLine={false} axisLine={false} interval={trend.length <= 6 ? 0 : "preserveStartEnd"} />
                <YAxis yAxisId="money" tickFormatter={(value) => shortMoney(Number(value))} tick={{ fontSize: 10, fill: "#6b7280" }} tickLine={false} axisLine={false} width={52} />
                <YAxis yAxisId="rate" orientation="right" tickFormatter={(value) => `${value}%`} tick={{ fontSize: 10, fill: "#6b7280" }} tickLine={false} axisLine={false} width={36} />
                <Tooltip formatter={(value: number, name: string) => name.endsWith("revenue") ? money(value) : `${value}%`} />
                {kind !== "cross" && <Bar yAxisId="money" dataKey="upsellRevenue" name="Upsell revenue" stackId="revenue" fill={UPSELL_COLOR} maxBarSize={26} radius={kind === "upsell" ? [3, 3, 0, 0] : undefined} />}
                {kind !== "upsell" && <Bar yAxisId="money" dataKey="crossRevenue" name="Cross-sell revenue" stackId="revenue" fill={CROSS_COLOR} maxBarSize={26} radius={[3, 3, 0, 0]} />}
                {kind !== "cross" && <Line yAxisId="rate" type="monotone" dataKey="upsellRate" name="Upsell rate" stroke={UPSELL_LINE} strokeWidth={2} dot={{ r: 3 }} />}
                {kind !== "upsell" && <Line yAxisId="rate" type="monotone" dataKey="crossRate" name="Cross-sell rate" stroke={CROSS_LINE} strokeWidth={2} dot={{ r: 3 }} />}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between gap-2">
            <h2 className="m-0 text-base font-black text-gray-900 dark:text-slate-100">{kind === "cross" ? "Cross-sell Products" : `${kindTitle} by Product`}</h2>
            <SelectPill label="By product measure" value={productMetric} options={["Revenue", "Profit", "Orders"]} onChange={setProductMetric} />
          </div>
          {kind === "cross" && <p className="m-0 mt-1 text-xs text-gray-500 dark:text-slate-400">The extra products customers added.</p>}
          {byProduct.rows.length === 0 ? (
            <p className="m-0 py-16 text-center text-sm text-gray-400">Nothing delivered in this period.</p>
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
                  <span className="mt-0.5 text-[10px] leading-tight text-gray-500 dark:text-slate-400">{kindTitle} {productMetric.toLowerCase()}</span>
                </div>
              </div>
              <ul className="m-0 w-full min-w-0 list-none space-y-2.5 p-0 text-[11px]">
                {byProduct.rows.map((row, index) => (
                  <li key={row.name} className="grid grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: DONUT_COLORS[index % DONUT_COLORS.length] }} />
                    <span className="leading-tight text-gray-700 dark:text-slate-300">{row.name}</span>
                    <span className="font-bold text-gray-900 dark:text-slate-100">{Math.round(row.share * 100)}%</span>
                    <span className="text-right text-gray-700 dark:text-slate-300">
                      {productMetric === "Orders" ? count(Math.round(row.value)) : productMetric === "Profit" ? money0(row.value) : money(row.value)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between gap-2">
            <h2 className="m-0 text-base font-black text-gray-900 dark:text-slate-100">{kind === "cross" ? "Cross-sells per Order" : `${kindTitle} by Package Type`}</h2>
            <SelectPill label="By package measure" value={packageMetric} options={["Orders", "Revenue", "Profit"]} onChange={setPackageMetric} />
          </div>
          <div className="mt-8 space-y-6">
            {byPackage.map((row) => (
              <div key={row.label} className="grid grid-cols-[minmax(110px,auto)_1fr_auto] items-center gap-3 text-sm" title={row.hint}>
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
                  <p className="m-0 mt-3 px-1 text-[10px] font-black uppercase tracking-wider text-gray-400">Status ({kind === "both" ? "vs target" : "vs team average"})</p>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {statusLabels.map((label) => (
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
                  <p className="m-0 text-sm text-gray-600 dark:text-slate-300">Top Performer</p>
                  {repCards.top ? (
                    <>
                      <p className="m-0 mt-1 flex items-center gap-1.5">
                        <Avatar name={repCards.top.name} size="h-6 w-6 text-[10px]" />
                        <strong className="truncate text-base font-black text-gray-900 dark:text-slate-50">{repCards.top.name}</strong>
                      </p>
                      <p className="m-0 mt-1 text-xs text-emerald-700 dark:text-emerald-200">{money0(repCards.top[kind].profit)} {kind === "both" ? "" : `${KIND_LABEL[kind].toLowerCase()} `}profit</p>
                    </>
                  ) : <p className="m-0 mt-1 text-xs text-gray-400">No deliveries yet</p>}
                </div>
              </article>
              <article className="flex gap-3 rounded-xl border border-sky-100 bg-sky-50/50 p-4 dark:border-sky-500/20 dark:bg-sky-500/5">
                <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-sky-100 text-sky-600 dark:bg-sky-500/20 dark:text-sky-200"><UsersRound className="h-5 w-5" /></span>
                <div>
                  <strong className="block text-xl font-black text-gray-900 dark:text-slate-50">{repCards.benchmarkCount}</strong>
                  <p className="m-0 text-sm text-gray-600 dark:text-slate-300">{repCards.benchmarkTitle}</p>
                  <p className="m-0 mt-1 text-xs text-gray-500 dark:text-slate-400">{repCards.benchmarkSub}</p>
                </div>
              </article>
              <article className="flex gap-3 rounded-xl border border-amber-100 bg-amber-50/50 p-4 dark:border-amber-500/20 dark:bg-amber-500/5">
                <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-600 dark:bg-amber-500/20 dark:text-amber-200"><AlertTriangle className="h-5 w-5" /></span>
                <div>
                  <strong className="block text-xl font-black text-gray-900 dark:text-slate-50">{repCards.needsHelp}</strong>
                  <p className="m-0 text-sm text-gray-600 dark:text-slate-300">Needs Improvement</p>
                  <p className="m-0 mt-1 text-xs text-gray-500 dark:text-slate-400">{repCards.needsHelpSub}</p>
                </div>
              </article>
              <article className="flex gap-3 rounded-xl border border-violet-100 bg-violet-50/50 p-4 dark:border-violet-500/20 dark:bg-violet-500/5">
                <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-violet-100 text-violet-600 dark:bg-violet-500/20 dark:text-violet-200"><HandCoins className="h-5 w-5" /></span>
                <div className="min-w-0">
                  <strong className="block text-xl font-black text-violet-700 dark:text-violet-200">{repCards.highestBonus ? money0(repCards.highestBonus[kind].bonus) : "—"}</strong>
                  <p className="m-0 text-sm text-gray-600 dark:text-slate-300">Highest Bonus Earned</p>
                  {repCards.highestBonus && <p className="m-0 mt-1 flex items-center gap-1.5 text-xs text-gray-600 dark:text-slate-300"><Avatar name={repCards.highestBonus.name} size="h-5 w-5 text-[9px]" />{repCards.highestBonus.name}</p>}
                </div>
              </article>
              <article className="flex gap-3 rounded-xl border border-rose-100 bg-rose-50/50 p-4 dark:border-rose-500/20 dark:bg-rose-500/5">
                <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-rose-100 text-rose-600 dark:bg-rose-500/20 dark:text-rose-200"><Target className="h-5 w-5" /></span>
                <div className="min-w-0">
                  <strong className="block text-xl font-black text-rose-600 dark:text-rose-200">{repCards.lowestBonus ? money0(repCards.lowestBonus[kind].bonus) : "—"}</strong>
                  <p className="m-0 text-sm text-gray-600 dark:text-slate-300">Lowest Bonus Earned</p>
                  {repCards.lowestBonus && <p className="m-0 mt-1 flex items-center gap-1.5 text-xs text-gray-600 dark:text-slate-300"><Avatar name={repCards.lowestBonus.name} size="h-5 w-5 text-[9px]" />{repCards.lowestBonus.name}</p>}
                </div>
              </article>
            </div>

            <div className="overflow-x-auto rounded-xl border border-gray-100 dark:border-slate-800">
              <table className="w-full !min-w-[900px] text-sm">
                <thead className="text-left text-xs font-bold text-gray-700 dark:text-slate-300">
                  {kind === "both" ? (
                    <>
                      {/* Grouped headings: upsell and cross-sell each own a block. */}
                      <tr>
                        <th className={th} colSpan={4} />
                        <th className={`${th} border-b-2 border-emerald-400 text-center text-emerald-700 dark:text-emerald-300`} colSpan={3}>Upsell</th>
                        <th className={`${th} border-b-2 border-indigo-400 text-center text-indigo-700 dark:text-indigo-300`} colSpan={3}>Cross-sell</th>
                        <th className={th} colSpan={4} />
                      </tr>
                      <tr>
                        {["#", "Sales Rep", "Orders Handled", "Delivered", "Orders", "Rate", `Revenue (${currencySymbol()})`, "Orders", "Rate", `Revenue (${currencySymbol()})`, `Bonus (${currencySymbol()})`, "Target", "Status", ""].map((header, index) => (
                          <th key={`${header}-${index}`} className={th}>{header}</th>
                        ))}
                      </tr>
                    </>
                  ) : (
                    <tr>
                      {["#", "Sales Rep", "Delivered", KIND_PLURAL[kind], KIND_RATE[kind], "vs Team", `Revenue (${currencySymbol()})`, `Profit (${currencySymbol()})`, `Bonus (${currencySymbol()})`, "Status", ""].map((header, index) => (
                        <th key={`${header}-${index}`} className={th}>{header}</th>
                      ))}
                    </tr>
                  )}
                </thead>
                <tbody>
                  {visibleRepRows.length === 0 ? (
                    <tr><td colSpan={14} className="!text-gray-400 px-4 py-10 text-center text-sm">No sales rep handled or delivered an order in this period.</td></tr>
                  ) : visibleRepRows.map((row, index) => {
                    const status = statusFor(row);
                    const menu = (
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
                    );
                    const nameCell = (
                      <td className={td}>
                        <span className="inline-flex items-center gap-2.5 whitespace-nowrap font-bold">
                          <Avatar name={row.name} />
                          <span>
                            {row.name}
                            {row.detail && <span className="block max-w-[160px] truncate text-[11px] font-medium text-gray-400" title={row.detail}>{row.detail}</span>}
                          </span>
                        </span>
                      </td>
                    );
                    const statusCell = (
                      <td className={td}>
                        {status
                          ? <span className={`inline-flex whitespace-nowrap rounded-md border px-2 py-1 text-xs font-bold ${PERFORMANCE_TONE[status]}`}>{status}</span>
                          : <span className="whitespace-nowrap text-xs text-gray-400">{row.repId === OTHER_STAFF ? "Not ranked" : row.delivered === 0 ? "No deliveries" : kind === "both" ? "No target" : "—"}</span>}
                      </td>
                    );
                    if (kind === "both") {
                      return (
                        <tr key={row.repId} onClick={() => { if (row.repId !== OTHER_STAFF) setDrawerRepId(row.repId); }} className={`cursor-pointer hover:bg-gray-50/70 dark:hover:bg-slate-800/40 ${rowClass}`}>
                          <td className={`${td} font-semibold`}>{index + 1}</td>
                          {nameCell}
                          <td className={td}>{count(row.handled)}</td>
                          <td className={td}>{count(row.delivered)}</td>
                          <td className={`${td} border-l border-gray-100 dark:border-slate-800`}>{count(row.upsell.orders)}</td>
                          <td className={td}><span className={bestWorstTone("upsell", row)} title={ranked.upsell.best?.row.repId === row.repId ? "Best upsell rate" : ranked.upsell.weakest?.row.repId === row.repId ? "Lowest upsell rate" : undefined}>{percent(row.upsell.rate)}</span></td>
                          <td className={`${td} whitespace-nowrap`}>{money(row.upsell.revenue)}</td>
                          <td className={`${td} border-l border-gray-100 dark:border-slate-800`}>{count(row.cross.orders)}</td>
                          <td className={td}><span className={bestWorstTone("cross", row)} title={ranked.cross.best?.row.repId === row.repId ? "Best cross-sell rate" : ranked.cross.weakest?.row.repId === row.repId ? "Lowest cross-sell rate" : undefined}>{percent(row.cross.rate)}</span></td>
                          <td className={`${td} whitespace-nowrap`}>{money(row.cross.revenue)}</td>
                          <td className={`${td} whitespace-nowrap border-l border-gray-100 dark:border-slate-800`}>{money0(row.both.bonus)}</td>
                          <td className={`${td} whitespace-nowrap`}>{row.targetPct ? `≥ ${row.targetPct}%` : "—"}</td>
                          {statusCell}
                          {menu}
                        </tr>
                      );
                    }
                    const rate = row[kind].rate;
                    const team = teamRate[kind];
                    const vsTeam = row.repId === OTHER_STAFF ? null : pointsChange(rate, team);
                    const barScale = Math.max(10, ...visibleRepRows.map((item) => (item[kind].rate ?? 0) * 100));
                    return (
                      <tr key={row.repId} onClick={() => { if (row.repId !== OTHER_STAFF) setDrawerRepId(row.repId); }} className={`cursor-pointer hover:bg-gray-50/70 dark:hover:bg-slate-800/40 ${rowClass}`}>
                        <td className={`${td} font-semibold`}>{index + 1}</td>
                        {nameCell}
                        <td className={td}>{count(row.delivered)}</td>
                        <td className={td}>{count(row[kind].orders)}</td>
                        <td className={td}>
                          <span className="flex items-center gap-2">
                            <span className={`w-11 ${bestWorstTone(kind, row)}`}>{percent(rate)}</span>
                            <span className="h-2.5 w-20 overflow-hidden rounded-full bg-gray-100 dark:bg-slate-800">
                              <span className={`block h-full rounded-full ${kind === "upsell" ? "bg-emerald-500" : "bg-indigo-500"}`} style={{ width: `${Math.min(100, ((rate ?? 0) * 100 / barScale) * 100)}%` }} />
                            </span>
                          </span>
                        </td>
                        <td className={`${td} whitespace-nowrap`}>
                          {vsTeam === null ? "—" : <span className={vsTeam >= 0 ? "font-bold text-emerald-700 dark:text-emerald-300" : "font-bold text-rose-600 dark:text-rose-300"}>{vsTeam >= 0 ? "+" : "−"}{Math.abs(vsTeam).toFixed(1)} pts</span>}
                        </td>
                        <td className={`${td} whitespace-nowrap`}>{money(row[kind].revenue)}</td>
                        <td className={`${td} whitespace-nowrap`}>{money0(row[kind].profit)}</td>
                        <td className={`${td} whitespace-nowrap`}>{money0(row[kind].bonus)}</td>
                        {statusCell}
                        {menu}
                      </tr>
                    );
                  })}
                </tbody>
                {visibleRepRows.length > 0 && (
                  <tfoot>
                    <tr className="border-t border-gray-200 dark:border-slate-700 [&>td]:align-middle [&>td]:font-black [&>td]:text-gray-900 dark:[&>td]:text-slate-100">
                      {kind === "both" ? (
                        <>
                          <td className={td} colSpan={2}>Total</td>
                          <td className={td}>{count(tableTotals.handled)}</td>
                          <td className={td}>{count(tableTotals.delivered)}</td>
                          <td className={`${td} border-l border-gray-100 dark:border-slate-800`}>{count(tableTotals.upsell.orders)}</td>
                          <td className={td}>{percent(tableTotals.upsell.rate)}</td>
                          <td className={`${td} whitespace-nowrap`}>{money(tableTotals.upsell.revenue)}</td>
                          <td className={`${td} border-l border-gray-100 dark:border-slate-800`}>{count(tableTotals.cross.orders)}</td>
                          <td className={td}>{percent(tableTotals.cross.rate)}</td>
                          <td className={`${td} whitespace-nowrap`}>{money(tableTotals.cross.revenue)}</td>
                          <td className={`${td} whitespace-nowrap border-l border-gray-100 dark:border-slate-800`}>{money0(tableTotals.both.bonus)}</td>
                          <td className={td}>-</td>
                          <td className={td}>-</td>
                          <td />
                        </>
                      ) : (
                        <>
                          <td className={td} colSpan={2}>Total</td>
                          <td className={td}>{count(tableTotals.delivered)}</td>
                          <td className={td}>{count(tableTotals[kind].orders)}</td>
                          <td className={td}>{percent(tableTotals[kind].rate)}</td>
                          <td className={td}>-</td>
                          <td className={`${td} whitespace-nowrap`}>{money(tableTotals[kind].revenue)}</td>
                          <td className={`${td} whitespace-nowrap`}>{money0(tableTotals[kind].profit)}</td>
                          <td className={`${td} whitespace-nowrap`}>{money0(tableTotals[kind].bonus)}</td>
                          <td className={td}>-</td>
                          <td />
                        </>
                      )}
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
            {kind === "both" && (
              <p className="m-0 text-xs text-gray-500 dark:text-slate-400">
                <span className="font-black text-emerald-700 dark:text-emerald-300">Green</span> marks the best rate in each column and <span className="font-black text-rose-600 dark:text-rose-300">red</span> the lowest (reps with {MIN_DELIVERED_TO_RANK}+ delivered orders). An order with both counts in each.
              </p>
            )}

            <section className="rounded-xl border border-gray-100 p-4 dark:border-slate-800">
              <h3 className="m-0 text-sm font-black text-gray-900 dark:text-slate-100">{kindTitle} Profit vs {KIND_RATE[kind]}</h3>
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
                        label={{ value: KIND_RATE[kind], position: "insideBottom", offset: -14, fontSize: 11, fill: "#6b7280" }} />
                      <YAxis type="number" dataKey="y" domain={[matrix.yMin, matrix.yMax]} tickFormatter={(value) => shortMoney(Number(value))} tick={{ fontSize: 10, fill: "#6b7280" }} width={56}
                        label={{ value: `${kindTitle} profit`, angle: -90, position: "insideLeft", offset: 4, fontSize: 11, fill: "#6b7280" }} />
                      <ZAxis type="number" dataKey="z" range={[90, 700]} />
                      <Tooltip cursor={{ strokeDasharray: "3 3" }} content={({ payload }) => {
                        const point = payload?.[0]?.payload as { name: string; x: number; y: number; z: number } | undefined;
                        if (!point) return null;
                        return (
                          <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs shadow-lg dark:border-slate-700 dark:bg-slate-900">
                            <p className="m-0 font-black text-gray-900 dark:text-slate-100">{point.name}</p>
                            <p className="m-0 mt-1 text-gray-600 dark:text-slate-300">{point.x}% {KIND_RATE[kind].toLowerCase()} · {money0(point.y)} profit</p>
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
                <thead className="text-left text-xs font-bold text-gray-700 dark:text-slate-300">
                  {kind === "both" ? (
                    <>
                      <tr>
                        <th className={th} colSpan={2} />
                        <th className={`${th} border-b-2 border-emerald-400 text-center text-emerald-700 dark:text-emerald-300`} colSpan={3}>Upsell</th>
                        <th className={`${th} border-b-2 border-indigo-400 text-center text-indigo-700 dark:text-indigo-300`} colSpan={3}>Cross-sell</th>
                        <th className={th} colSpan={2} />
                      </tr>
                      <tr>
                        {["Product", "Delivered", "Orders", "Rate", `Revenue (${currencySymbol()})`, "Orders", "Rate", `Revenue (${currencySymbol()})`, `Profit (${currencySymbol()})`, `Bonus (${currencySymbol()})`].map((header, index) => (
                          <th key={`${header}-${index}`} className={th}>{header}</th>
                        ))}
                      </tr>
                    </>
                  ) : (
                    <tr>
                      {["Product", "Delivered", KIND_PLURAL[kind], KIND_RATE[kind], `Revenue (${currencySymbol()})`, `Profit (${currencySymbol()})`, `Bonus (${currencySymbol()})`].map((header) => (
                        <th key={header} className={th}>{header}</th>
                      ))}
                    </tr>
                  )}
                </thead>
                <tbody>
                  {productRows.length === 0 ? (
                    <tr><td colSpan={10} className="px-4 py-10 text-center text-sm text-gray-400">No delivered orders in this period.</td></tr>
                  ) : productRows.map((row) => (
                    <tr key={row.key} className={rowClass}>
                      <td className={`${td} font-bold`}>{row.name}</td>
                      <td className={td}>{count(row.delivered)}</td>
                      {kind === "both" ? (
                        <>
                          <td className={`${td} border-l border-gray-100 dark:border-slate-800`}>{count(row.upsell.orders)}</td>
                          <td className={td}>{percent(row.upsell.rate)}</td>
                          <td className={`${td} whitespace-nowrap`}>{money(row.upsell.revenue)}</td>
                          <td className={`${td} border-l border-gray-100 dark:border-slate-800`}>{count(row.cross.orders)}</td>
                          <td className={td}>{percent(row.cross.rate)}</td>
                          <td className={`${td} whitespace-nowrap`}>{money(row.cross.revenue)}</td>
                          <td className={`${td} whitespace-nowrap border-l border-gray-100 dark:border-slate-800`}>{money0(row.both.profit)}</td>
                          <td className={`${td} whitespace-nowrap`}>{money0(row.both.bonus)}</td>
                        </>
                      ) : (
                        <>
                          <td className={td}>{count(row[kind].orders)}</td>
                          <td className={td}>{percent(row[kind].rate)}</td>
                          <td className={`${td} whitespace-nowrap`}>{money(row[kind].revenue)}</td>
                          <td className={`${td} whitespace-nowrap`}>{money0(row[kind].profit)}</td>
                          <td className={`${td} whitespace-nowrap`}>{money0(row[kind].bonus)}</td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {kind !== "upsell" && (
              <div>
                <h3 className="m-0 text-sm font-black text-gray-900 dark:text-slate-100">Cross-sell products</h3>
                <p className="m-0 mt-0.5 text-xs text-gray-500 dark:text-slate-400">The extra products reps added to orders delivered in this period.</p>
                <div className="mt-3 overflow-x-auto rounded-xl border border-gray-100 dark:border-slate-800">
                  <table className="w-full !min-w-[560px] text-sm">
                    <thead>
                      <tr className="text-left text-xs font-bold text-gray-700 dark:text-slate-300">
                        {["Cross-sell product", "Orders", `Revenue (${currencySymbol()})`, "Share of cross-sell revenue"].map((header) => (
                          <th key={header} className={th}>{header}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {addOnRows.length === 0 ? (
                        <tr><td colSpan={4} className="px-4 py-8 text-center text-sm text-gray-400">No cross-sells were delivered in this period.</td></tr>
                      ) : addOnRows.map((row) => (
                        <tr key={row.name} className={rowClass}>
                          <td className={`${td} font-bold`}>{row.name}</td>
                          <td className={td}>{count(row.orders)}</td>
                          <td className={`${td} whitespace-nowrap`}>{money(row.revenue)}</td>
                          <td className={td}>{percent(row.share)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {kind !== "cross" && (
              <div>
                <h3 className="m-0 text-sm font-black text-gray-900 dark:text-slate-100">Upgrade paths</h3>
                <p className="m-0 mt-0.5 text-xs text-gray-500 dark:text-slate-400">
                  Each upgrade the reps offered on a confirmation call in this period, followed to delivery.
                </p>
                <div className="mt-3 overflow-x-auto rounded-xl border border-gray-100 dark:border-slate-800">
                  <table className="w-full !min-w-[760px] text-sm">
                    <thead>
                      <tr className="text-left text-xs font-bold text-gray-700 dark:text-slate-300">
                        {["Product", "Upgrade", "Offered", "Customer said yes", "Delivered", "Delivered conversion", `Upsell profit (${currencySymbol()})`].map((header) => (
                          <th key={header} className={th}>{header}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {logLoading && !log ? (
                        <tr><td colSpan={7} className="px-4 py-8 text-center text-sm text-gray-400">Loading the call log…</td></tr>
                      ) : pathRows.length === 0 ? (
                        <tr><td colSpan={7} className="px-4 py-8 text-center text-sm text-gray-400">{logError || "No upgrades were offered on calls in this period."}</td></tr>
                      ) : pathRows.map((row) => (
                        <tr key={`${row.product}-${row.from}-${row.to}`} className={rowClass}>
                          <td className={`${td} font-bold`}>{row.product}</td>
                          <td className={`${td} whitespace-nowrap`}>{row.from} → {row.to} {row.to === 1 ? "piece" : "pieces"}</td>
                          <td className={td}>{count(row.offered)}</td>
                          <td className={td}>{count(row.accepted)}</td>
                          <td className={td}>{count(row.delivered)}</td>
                          <td className={td}>{percent(row.offered > 0 ? row.delivered / row.offered : null)}</td>
                          <td className={`${td} whitespace-nowrap`}>{money0(row.profit)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {tab === "orders" && (
          <div className="space-y-3 px-4 pb-4">
            {repFilter && (
              <p className="m-0 inline-flex items-center gap-2 rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-bold text-sky-700">
                Showing {repFilter === OTHER_STAFF ? "other staff" : `${repName(repFilter)}'s`} {KIND_PLURAL[kind].toLowerCase()}
                <button type="button" aria-label="Show every rep" onClick={() => setRepFilter(null)} className="!min-h-0"><X className="h-3.5 w-3.5" /></button>
              </p>
            )}
            <div className="overflow-x-auto rounded-xl border border-gray-100 dark:border-slate-800">
              <table className="w-full !min-w-[960px] text-sm">
                <thead>
                  <tr className="text-left text-xs font-bold text-gray-700 dark:text-slate-300">
                    {["Order", "Delivered", "Sales Rep", "Customer", "Product", "Type", "What was added", `Upsell (${currencySymbol()})`, `Cross-sell (${currencySymbol()})`, `Profit (${currencySymbol()})`, `Bonus (${currencySymbol()})`].map((header) => (
                      <th key={header} className={th}>{header}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {orderRows.length === 0 ? (
                    <tr><td colSpan={11} className="px-4 py-10 text-center text-sm text-gray-400">No {KIND_PLURAL[kind].toLowerCase()} were delivered in this period.</td></tr>
                  ) : orderRows.map((order) => (
                    <tr key={order.id} className={rowClass}>
                      <td className={td}>
                        <button type="button" onClick={() => onOpenOrder(order.id)} className="!min-h-0 font-black text-[#1F8FE0] hover:underline">#{order.id}</button>
                      </td>
                      <td className={`${td} whitespace-nowrap`}>{order.deliveredKey ? longDay(order.deliveredKey) : "—"}</td>
                      <td className={td}>{repName(order.repId)}</td>
                      <td className={td}>{order.customerName}</td>
                      <td className={td}>{order.productName}</td>
                      <td className={td}><TypePill order={order} /></td>
                      <td className={`${td} text-gray-600 dark:text-slate-400`}>{order.description}</td>
                      <td className={`${td} whitespace-nowrap`}>{order.hasUpsell ? money(order.upsellRevenue) : "—"}</td>
                      <td className={`${td} whitespace-nowrap`}>{order.hasCrossSell ? money(order.crossSellRevenue) : "—"}</td>
                      <td className={`${td} whitespace-nowrap`}>{money0(profitOf(order, kind))}</td>
                      <td className={`${td} whitespace-nowrap`}>{money0(bonusOf(order, kind))}</td>
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
              <h3 className="m-0 text-sm font-black text-gray-900 dark:text-slate-100">Why customers say no to an upsell</h3>
              {kind === "cross" ? (
                <p className="m-0 py-8 text-center text-sm text-gray-400">
                  Reps don't log cross-sell offers yet, so there are no cross-sell refusal reasons. These come from the upsell log.
                </p>
              ) : (
                <>
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
                </>
              )}
            </section>

            <section className="rounded-xl border border-gray-100 p-4 dark:border-slate-800">
              <h3 className="m-0 text-sm font-black text-gray-900 dark:text-slate-100">Who says yes</h3>
              <p className="m-0 mt-0.5 text-xs text-gray-500 dark:text-slate-400">
                Share of delivered orders that took {kind === "both" ? "an upsell or a cross-sell" : kind === "upsell" ? "an upsell" : "a cross-sell"}, by type of customer.
              </p>
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
                          <span className="h-3 overflow-hidden rounded-full bg-gray-100 dark:bg-slate-800"><span className={`block h-full rounded-full ${kind === "cross" ? "bg-indigo-500" : "bg-emerald-500"}`} style={{ width: `${Math.min(100, (row.rate ?? 0) * 100 * 4)}%` }} /></span>
                          <span className="min-w-[132px] text-right text-gray-700 dark:text-slate-300">{percent(row.rate)} · {count(row.yes)} of {count(row.delivered)}</span>
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
          teamRate={teamRate}
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

/**
 * One rep's detail, opened from the table's ⋮, the row or a bubble. Upsell and
 * cross-sell side by side against the team, then the UPSELL call funnel (the
 * only kind the call log records honestly).
 */
function RepDrawer({ row, teamRate, calls, orders, orderById, window, logLoading, logError, money0, onOpenOrder, onClose }: {
  row: RepRow;
  teamRate: Record<Kind, number | null>;
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
  const saidYes = calls.filter((call) => call.upsell?.response === "accepted" || Boolean(orderById.get(call.orderId)?.hasUpsell));
  const delivered = saidYes.filter((call) => {
    const order = orderById.get(call.orderId);
    return order?.status === "Delivered" && order.hasUpsell;
  });
  const stillOpen = calls.filter((call) => {
    const status = orderById.get(call.orderId)?.status;
    return status && !["Delivered", "Failed", "Cancelled"].includes(status);
  }).length;
  const steps = [
    { label: "Confirmation calls", value: calls.length },
    { label: "Upgrade offered", value: offered.length },
    { label: "Customer said yes", value: saidYes.length },
    { label: "Delivered with the upsell", value: delivered.length }
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

  const compare: Array<{ label: string; upsell: string; cross: string }> = [
    { label: "Orders", upsell: count(row.upsell.orders), cross: count(row.cross.orders) },
    { label: "Rate", upsell: percent(row.upsell.rate), cross: percent(row.cross.rate) },
    { label: "Team rate", upsell: percent(teamRate.upsell), cross: percent(teamRate.cross) },
    { label: "Revenue", upsell: money(row.upsell.revenue), cross: money(row.cross.revenue) },
    { label: "Profit", upsell: money0(row.upsell.profit), cross: money0(row.cross.profit) },
    { label: "Bonus", upsell: money0(row.upsell.bonus), cross: money0(row.cross.bonus) }
  ];

  return createPortal((
    <div className="fixed inset-0 z-[70] flex justify-end bg-slate-900/30" onClick={onClose}>
      <aside role="dialog" aria-label={`${row.name} upsell and cross-sell performance`} onClick={(event) => event.stopPropagation()}
        className="h-full w-full max-w-md overflow-y-auto bg-white shadow-2xl dark:bg-slate-900">
        <header className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-gray-100 bg-white px-5 py-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center gap-3">
            <Avatar name={row.name} size="h-11 w-11 text-sm" />
            <div>
              <h2 className="m-0 text-base font-black text-gray-900 dark:text-slate-50">{row.name}</h2>
              <p className="m-0 text-xs text-gray-500 dark:text-slate-400">{count(row.delivered)} delivered orders · {percent(row.both.rate)} took an upsell or cross-sell</p>
            </div>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="!min-h-0 rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 dark:hover:bg-slate-800"><X className="h-4 w-4" /></button>
        </header>

        <div className="space-y-6 px-5 py-5">
          <table className="w-full !min-w-0 overflow-hidden rounded-xl text-sm">
            <thead>
              <tr className="text-left text-xs">
                <th className="bg-gray-50 px-3 py-2 font-bold text-gray-500 dark:bg-slate-800/60" />
                <th className="bg-gray-50 px-3 py-2 font-black text-emerald-700 dark:bg-slate-800/60 dark:text-emerald-300">Upsell</th>
                <th className="bg-gray-50 px-3 py-2 font-black text-indigo-700 dark:bg-slate-800/60 dark:text-indigo-300">Cross-sell</th>
              </tr>
            </thead>
            <tbody>
              {compare.map((line) => (
                <tr key={line.label} className="border-t border-gray-100 dark:border-slate-800 [&>td]:align-middle">
                  <td className="px-3 py-2 !text-gray-500 dark:!text-slate-400">{line.label}</td>
                  <td className="px-3 py-2 font-bold !text-gray-900 dark:!text-slate-100">{line.upsell}</td>
                  <td className="px-3 py-2 font-bold !text-gray-900 dark:!text-slate-100">{line.cross}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <section>
            <h3 className="m-0 text-sm font-black text-gray-900 dark:text-slate-100">Upsell: from call to delivery</h3>
            <p className="m-0 mt-0.5 text-xs text-gray-500 dark:text-slate-400">The confirmation calls {row.name} logged in this period. Cross-sell offers aren't logged yet.</p>
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
                        <span className="block h-full rounded-full bg-emerald-500" style={{ width: `${steps[0].value > 0 ? (step.value / steps[0].value) * 100 : 0}%` }} />
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
            <h3 className="m-0 text-sm font-black text-gray-900 dark:text-slate-100">Upgrades {row.name} sells best</h3>
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
            <h3 className="m-0 text-sm font-black text-gray-900 dark:text-slate-100">Why their customers said no to an upsell</h3>
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
