import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis
} from "recharts";
import {
  AlertTriangle, ArrowDown, ArrowUp, BarChart3, CalendarDays, CheckCircle2, ChevronDown, ChevronRight,
  Columns3, Crosshair, Download, Link2, Megaphone, MoreHorizontal, Scale, ShoppingBag, ShoppingCart,
  Target, Truck, Users, Wallet
} from "lucide-react";
import {
  marketingSpendApi, type MarketingLeaderboardRow, type MarketingPerformance, type MarketingPerformanceFilters
} from "../lib/api";
// ⚠️ Shared formatters, NOT a local ₦ one. A private formatter ignores both the
// branch's currency and the topbar "hide money" toggle.
import { money } from "../lib/money-privacy";
import { LoadingState } from "../components/ui/loading-state";

/**
 * Marketing Performance Center — built to Bright's design, element by element:
 * six headline cards with "vs previous period", the seven-step funnel, the
 * order status donut, six cost cards ending in break-even headroom, the four
 * filters, and the media buyer leaderboard with Columns / Export / View Charts.
 *
 * ⚠️ THE STRUCTURE IS THE DESIGN; THE BLANKS ARE THE TRUTH. Where the design
 * shows a figure the data cannot support - ad spend per platform, mainly,
 * because Ad Spend is entered per product - the same cell says "Not recorded"
 * rather than printing a number nobody measured.
 */

type Period = "today" | "yesterday" | "week" | "month" | "last" | "year" | "custom";

// Local calendar keys. toISOString() would shift a late-evening date into
// tomorrow for anyone east of Greenwich - Lagos included.
const keyOf = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const addDays = (date: Date, days: number) => { const d = new Date(date); d.setDate(d.getDate() + days); return d; };

const rangeFor = (period: Exclude<Period, "custom">) => {
  const today = new Date();
  switch (period) {
    case "today": return { from: keyOf(today), to: keyOf(today) };
    case "yesterday": { const y = addDays(today, -1); return { from: keyOf(y), to: keyOf(y) }; }
    case "week": {
      // The week starts on Monday, the way the rest of the business counts it.
      const offset = (today.getDay() + 6) % 7;
      return { from: keyOf(addDays(today, -offset)), to: keyOf(today) };
    }
    case "month": return { from: keyOf(new Date(today.getFullYear(), today.getMonth(), 1)), to: keyOf(today) };
    case "last": return {
      from: keyOf(new Date(today.getFullYear(), today.getMonth() - 1, 1)),
      to: keyOf(new Date(today.getFullYear(), today.getMonth(), 0))
    };
    case "year": return { from: keyOf(new Date(today.getFullYear(), 0, 1)), to: keyOf(today) };
  }
};

const PERIODS: Array<{ key: Period; label: string }> = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "week", label: "This Week" },
  { key: "month", label: "This Month" },
  { key: "last", label: "Last Month" },
  { key: "year", label: "This Year" },
  { key: "custom", label: "Custom" }
];

const prettyDay = (key: string) =>
  new Date(`${key}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

/** The one rule this page lives by: unknown is shown, never drawn as zero. */
const NOT_RECORDED = "Not recorded";
const asMoney = (value: number | null) => (value === null ? NOT_RECORDED : money(value));
const asCount = (value: number | null) => (value === null ? "—" : value.toLocaleString("en-NG"));
const asPercent = (value: number | null) => (value === null ? "—" : `${(value * 100).toFixed(1)}%`);
const asMultiple = (value: number | null) => (value === null ? "—" : `${value.toFixed(2)}x`);

/**
 * "vs previous period". Green when the change is good for the business, red
 * when it is bad - lower ad spend and lower cost per order are good; lower
 * revenue is not. The arrow shows the direction, the colour shows the meaning.
 */
function Delta({ value, lowerIsBetter = false }: { value: number | null; lowerIsBetter?: boolean }) {
  if (value === null) return <p className="m-0 mt-1 text-[11px] font-medium text-gray-400">no earlier period to compare</p>;
  const good = lowerIsBetter ? value <= 0 : value >= 0;
  const Arrow = value >= 0 ? ArrowUp : ArrowDown;
  return (
    <div className="mt-1">
      <span className={`inline-flex items-center gap-1 text-sm font-bold ${good ? "text-emerald-600" : "text-rose-600"}`}>
        <Arrow className="h-3.5 w-3.5" />{value >= 0 ? "+" : ""}{(value * 100).toFixed(1)}%
      </span>
      <p className="m-0 text-[11px] font-medium text-gray-400">vs previous period</p>
    </div>
  );
}

const TONES = {
  blue: "bg-blue-50 text-blue-600",
  indigo: "bg-indigo-50 text-indigo-600",
  amber: "bg-amber-50 text-amber-600",
  orange: "bg-orange-50 text-orange-600",
  green: "bg-emerald-50 text-emerald-600",
  purple: "bg-purple-50 text-purple-600",
  rose: "bg-rose-50 text-rose-600",
  teal: "bg-teal-50 text-teal-600"
} as const;
type Tone = keyof typeof TONES;

function StatCard({ icon: Icon, tone, title, value, children }: {
  icon: typeof Megaphone; tone: Tone; title: string; value: string; children?: React.ReactNode;
}) {
  return (
    <article className="flex gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${TONES[tone]}`}>
        <Icon className="h-5 w-5" />
      </span>
      <div className="min-w-0">
        <h2 className="m-0 text-[13px] font-semibold text-gray-600 dark:text-slate-300">{title}</h2>
        <strong className={`mt-1 block text-2xl font-black leading-tight ${value === NOT_RECORDED ? "text-gray-400" : "text-gray-900 dark:text-slate-100"}`}>
          {value}
        </strong>
        {children}
      </div>
    </article>
  );
}

function RateLine({ value, label }: { value: string; label: string }) {
  return (
    <div className="mt-1">
      <span className="text-sm font-bold text-emerald-600">{value}</span>
      <p className="m-0 text-[11px] font-medium text-gray-400">{label}</p>
    </div>
  );
}

// ── Leaderboard ─────────────────────────────────────────────────────────────

type ColumnKey =
  | "orders" | "confirmed" | "delivered" | "deliveryRate" | "adSpend" | "cpdo"
  | "aov" | "revenue" | "netProfit" | "margin" | "roas" | "status";

const COLUMNS: Array<{ key: ColumnKey; label: string }> = [
  { key: "orders", label: "Orders" },
  { key: "confirmed", label: "Confirmed" },
  { key: "delivered", label: "Delivered" },
  { key: "deliveryRate", label: "Delivery %" },
  { key: "adSpend", label: "Ad Spend" },
  { key: "cpdo", label: "CPDO" },
  { key: "aov", label: "AOV (Del)" },
  { key: "revenue", label: "Revenue (Del)" },
  { key: "netProfit", label: "Net Profit" },
  { key: "margin", label: "Margin" },
  { key: "roas", label: "ROAS" },
  { key: "status", label: "Status" }
];

const STATUS_PILL: Record<MarketingLeaderboardRow["status"], { label: string; className: string }> = {
  profitable: { label: "Profitable", className: "bg-emerald-50 text-emerald-700" },
  losing: { label: "Losing money", className: "bg-rose-50 text-rose-700" },
  high_value: { label: "High Value", className: "bg-blue-50 text-blue-700" },
  check_tag: { label: "Check Tag", className: "bg-amber-50 text-amber-700" },
  // ⚠️ Not in the design, and deliberately so: the design assumed spend per
  // platform exists. It does not, so this says why the row cannot be judged.
  spend_unknown: { label: "Spend not split", className: "bg-gray-100 text-gray-600" }
};

function PlatformBadge({ row }: { row: MarketingLeaderboardRow }) {
  const key = row.key.toLowerCase();
  const base = "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[11px] font-black";
  if (row.kind === "unattributed") return <span className={`${base} bg-indigo-100 text-indigo-500`}><MoreHorizontal className="h-4 w-4" /></span>;
  if (key.includes("facebook") || key === "fb") return <span className={`${base} bg-[#1877F2] text-white`}>Fb</span>;
  if (key.includes("instagram") || key === "ig") return <span className={`${base} bg-gradient-to-br from-fuchsia-500 via-pink-500 to-amber-400 text-white`}>ig</span>;
  if (key.includes("tiktok")) return <span className={`${base} bg-black text-white`}>tt</span>;
  if (key.includes("google")) return <span className={`${base} border border-gray-200 bg-white text-[#4285F4]`}>G</span>;
  if (key.includes("audience") || key === "an") return <span className={`${base} bg-blue-100 text-blue-700`}>AN</span>;
  if (key.includes("thread") || key === "th") return <span className={`${base} bg-black text-white`}>@</span>;
  if (key === "website") return <span className={`${base} bg-emerald-500 text-white`}><Link2 className="h-4 w-4" /></span>;
  return <span className={`${base} bg-gray-100 text-gray-600`}>{row.label.slice(0, 2)}</span>;
}

function RankBadge({ rank }: { rank: number }) {
  const tone = rank === 1 ? "bg-amber-400 text-white" : rank === 2 ? "bg-gray-300 text-gray-700"
    : rank === 3 ? "bg-orange-300 text-white" : "bg-gray-50 text-gray-500";
  return <span className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold ${tone}`}>{rank}</span>;
}

const csvCell = (value: string | number) => {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

// ── Page ────────────────────────────────────────────────────────────────────

export type MarketingPerformancePageProps = {
  canEnterSpend: boolean;
  onEnterSpend: () => void;
};

export default function MarketingPerformancePage({ canEnterSpend, onEnterSpend }: MarketingPerformancePageProps) {
  const [period, setPeriod] = useState<Period>("month");
  const [custom, setCustom] = useState(() => rangeFor("month"));
  const [showRange, setShowRange] = useState(false);
  const [filters, setFilters] = useState<MarketingPerformanceFilters>({});
  const [view, setView] = useState<MarketingPerformance | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [hidden, setHidden] = useState<Set<ColumnKey>>(new Set());
  const [menu, setMenu] = useState<"columns" | "export" | null>(null);
  const [showCharts, setShowCharts] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const range = period === "custom" ? custom : rangeFor(period);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    marketingSpendApi.performance(range.from, range.to, filters)
      .then((data) => { if (!cancelled) setView(data); })
      .catch(() => { if (!cancelled) setFailed(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [range.from, range.to, filters.productId, filters.campaign, filters.source, filters.mediaBuyer]);

  // Close the Columns / Export menus on an outside click.
  useEffect(() => {
    if (!menu) return;
    const close = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenu(null);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menu]);

  const t = view?.totals;
  const d = view?.deltas;
  const shown = (key: ColumnKey) => !hidden.has(key);

  const statusSlices = useMemo(() => {
    if (!t) return [];
    return [
      { name: "Delivered", value: t.delivered, fill: "#16a34a" },
      { name: "Confirmed (Pending)", value: t.confirmedPending, fill: "#3b82f6" },
      { name: "Failed/Cancelled", value: t.lost, fill: "#fbbf24" },
      // ⚠️ A FOURTH SLICE THE DESIGN DOES NOT HAVE. Orders still waiting to be
      // confirmed belong to none of the three, and leaving them out would make
      // the slices stop adding up to the total in the middle.
      { name: "Awaiting confirmation", value: t.awaitingConfirmation, fill: "#cbd5e1" }
    ].filter((slice) => slice.value > 0);
  }, [t]);

  const exportCsv = () => {
    if (!view) return;
    const header = ["Rank", "Media buyer", "Campaigns", "Products", ...COLUMNS.map((c) => c.label)];
    const lines = view.leaderboard.map((row, i) => [
      i + 1, row.label, row.campaigns, row.products,
      row.ordersPlaced, row.confirmed, row.delivered, asPercent(row.deliveryRate),
      row.adSpend ?? NOT_RECORDED, row.costPerDeliveredOrder ?? NOT_RECORDED,
      row.deliveredAov === null ? "" : Math.round(row.deliveredAov), row.deliveredRevenue,
      row.netProfit ?? NOT_RECORDED, asPercent(row.margin), asMultiple(row.roas), STATUS_PILL[row.status].label
    ].map(csvCell).join(","));
    const blob = new Blob([[header.map(csvCell).join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `media-buyer-leaderboard-${range.from}-to-${range.to}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    setMenu(null);
  };

  const options = view?.options;
  const spendMissing = !!t && t.adSpend === null && !t.spendNotSplittable;
  const partialSpend = !!t && t.adSpend !== null && t.periodDays > 0 && t.daysWithoutSpend / t.periodDays >= 0.25;

  const funnel = t ? [
    { label: "Ad Spend", icon: Megaphone, tone: "bg-blue-50 text-blue-700", value: asMoney(t.adSpend),
      rate: t.adSpend === null ? "" : "100%", sub: "" },
    { label: "Leads / Checkout", icon: Users, tone: "bg-indigo-50 text-indigo-700", value: asCount(t.leads),
      rate: "", sub: `CPL: ${asMoney(t.costPerLead)}` },
    { label: "Orders Placed", icon: ShoppingCart, tone: "bg-amber-50 text-amber-700", value: asCount(t.ordersPlaced),
      rate: asPercent(t.leadToOrderRate), sub: `CPO: ${asMoney(t.costPerOrder)}` },
    { label: "Confirmed", icon: CheckCircle2, tone: "bg-orange-50 text-orange-700", value: asCount(t.confirmed),
      rate: asPercent(t.confirmationRate), sub: `Cost/Confirmed: ${asMoney(t.costPerConfirmed)}` },
    { label: "Delivered", icon: Truck, tone: "bg-emerald-50 text-emerald-700", value: asCount(t.delivered),
      rate: asPercent(t.deliveryRateOfConfirmed), sub: `CPDO: ${asMoney(t.costPerDeliveredOrder)}` },
    { label: "Revenue", icon: Wallet, tone: "bg-green-50 text-green-700", value: money(t.deliveredRevenue),
      rate: "", sub: `AOV: ${asMoney(t.deliveredAov)}` },
    { label: "Net Profit", icon: BarChart3, tone: "bg-purple-50 text-purple-700", value: asMoney(t.trueNetProfit),
      rate: "", sub: t.profitMargin === null ? "margin not known" : `${asPercent(t.profitMargin)} margin` }
  ] : [];

  const selectClass = "!min-h-0 h-10 rounded-lg border border-gray-200 bg-white pl-3 pr-8 text-sm text-gray-700 outline-none focus:border-[#1F8FE0] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200";

  return (
    <div className="space-y-5">
      {/* Title */}
      <header className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="m-0 flex items-center gap-1 text-xs font-medium text-gray-400">
            Marketing <ChevronRight className="h-3 w-3" /> <span className="text-gray-600">Performance Center</span>
          </p>
          <h1 className="m-0 mt-1 text-3xl font-black tracking-tight text-gray-900 dark:text-slate-100">Marketing Performance Center</h1>
          <p className="m-0 mt-1 text-sm text-gray-500">
            Track every stage from ad spend to profit. See which media buyer, campaign and product is actually making money.
          </p>
        </div>
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowRange((open) => !open)}
            className="!min-h-0 inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
          >
            <CalendarDays className="h-4 w-4 text-gray-400" />
            {prettyDay(range.from)} – {prettyDay(range.to)}
            <ChevronDown className="h-4 w-4 text-gray-400" />
          </button>
          {showRange && (
            <div className="absolute right-0 z-20 mt-2 flex items-center gap-2 rounded-xl border border-gray-200 bg-white p-3 shadow-lg dark:border-slate-700 dark:bg-slate-900">
              <input type="date" value={range.from} max={range.to}
                onChange={(e) => { setCustom({ from: e.target.value, to: range.to }); setPeriod("custom"); }}
                className="!min-h-0 rounded-md border border-gray-200 px-2 py-1 text-sm" />
              <span className="text-xs text-gray-400">to</span>
              <input type="date" value={range.to} min={range.from}
                onChange={(e) => { setCustom({ from: range.from, to: e.target.value }); setPeriod("custom"); }}
                className="!min-h-0 rounded-md border border-gray-200 px-2 py-1 text-sm" />
            </div>
          )}
        </div>
      </header>

      {/* Period + four filters */}
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex flex-wrap rounded-xl border border-gray-200 bg-white p-1 dark:border-slate-700 dark:bg-slate-900">
          {PERIODS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => {
                if (key === "custom") { setCustom(range); setShowRange(true); }
                setPeriod(key);
              }}
              className={`!min-h-0 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                period === key ? "bg-[#1F8FE0] text-white shadow-sm" : "text-gray-600 hover:bg-gray-50 dark:text-slate-300"}`}
            >{label}</button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
          <select aria-label="Product" className={selectClass} value={filters.productId ?? ""}
            onChange={(e) => setFilters((f) => ({ ...f, productId: e.target.value || undefined }))}>
            <option value="">All Products</option>
            {options?.products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <select aria-label="Media buyer" className={selectClass} value={filters.mediaBuyer ?? ""}
            onChange={(e) => setFilters((f) => ({ ...f, mediaBuyer: e.target.value || undefined }))}>
            <option value="">All Media Buyers ({options?.mediaBuyers.length ?? 0})</option>
            {options?.mediaBuyers.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
          <select aria-label="Campaign" className={selectClass} value={filters.campaign ?? ""}
            onChange={(e) => setFilters((f) => ({ ...f, campaign: e.target.value || undefined }))}>
            <option value="">All Campaigns</option>
            {options?.campaigns.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select aria-label="Source" className={selectClass} value={filters.source ?? ""}
            onChange={(e) => setFilters((f) => ({ ...f, source: e.target.value || undefined }))}>
            <option value="">All Sources</option>
            {options?.sources.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>

      {!view && loading && <LoadingState label="Working out marketing performance…" />}

      {failed && !loading && (
        <p className="m-0 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-900">
          Could not load these figures. Try the period again in a moment.
        </p>
      )}

      {t && d && view && (
        <div className={`space-y-5 transition-opacity ${loading ? "opacity-60" : ""}`}>
          {/* ⚠️ Honest notes. Each only appears when it applies, and each says
              WHY a figure is blank, so a blank reads as a question nobody has
              answered rather than as a broken page. */}
          {spendMissing && (
            <section className="rounded-xl border border-amber-300 bg-amber-50 p-4">
              <h2 className="m-0 flex items-center gap-2 text-sm font-black text-amber-900">
                <AlertTriangle className="h-4 w-4" />No ad spend recorded for this period
              </h2>
              <p className="m-0 mt-1 text-[13px] leading-5 text-amber-900">
                Orders, revenue and delivery are real. Anything that needs the cost of the ads — cost per order,
                return on ad spend, true profit — says "Not recorded" rather than showing a zero that would read as
                free advertising.
              </p>
              {canEnterSpend && (
                <button type="button" onClick={onEnterSpend}
                  className="!min-h-0 mt-3 inline-flex items-center gap-2 rounded-lg bg-amber-600 px-3 py-2 text-xs font-bold text-white hover:bg-amber-700">
                  Record what you spent
                </button>
              )}
            </section>
          )}
          {t.spendNotSplittable && (
            <p className="m-0 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-[13px] font-semibold leading-5 text-blue-900">
              Ad spend is entered per product, not per platform, campaign or media buyer — so it can't be shown for
              this filter, and the figures that need it say "Not recorded". Choose a product instead to see its spend.
            </p>
          )}
          {partialSpend && (
            <p className="m-0 rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3 text-[13px] font-semibold leading-5 text-amber-900">
              Spend is recorded on only {t.periodDays - t.daysWithoutSpend} of {t.periodDays} days in this period, so
              cost and return figures will look better than reality until the rest is entered.
            </p>
          )}

          {/* Six headline cards, in the design's order */}
          <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
            <StatCard icon={Megaphone} tone="blue" title="Ad Spend" value={asMoney(t.adSpend)}>
              <Delta value={d.adSpend} lowerIsBetter />
            </StatCard>
            <StatCard icon={ShoppingCart} tone="blue" title="Orders Placed" value={asCount(t.ordersPlaced)}>
              <Delta value={d.ordersPlaced} />
            </StatCard>
            <StatCard icon={CheckCircle2} tone="amber" title="Confirmed Orders" value={asCount(t.confirmed)}>
              <RateLine value={asPercent(t.confirmationRate)} label="confirmation rate" />
            </StatCard>
            <StatCard icon={Truck} tone="green" title="Delivered Orders" value={asCount(t.delivered)}>
              <RateLine value={asPercent(t.deliveryRateOfConfirmed)} label="delivery rate" />
            </StatCard>
            <StatCard icon={Wallet} tone="green" title="Delivered Revenue" value={money(t.deliveredRevenue)}>
              <Delta value={d.deliveredRevenue} />
            </StatCard>
            <StatCard icon={BarChart3} tone="purple" title="True Net Profit" value={asMoney(t.trueNetProfit)}>
              <RateLine value={asPercent(t.profitMargin)} label="profit margin" />
            </StatCard>
          </section>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            {/* Funnel */}
            <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 xl:col-span-2">
              <h2 className="m-0 text-lg font-black text-gray-900 dark:text-slate-100">Marketing Funnel</h2>
              <p className="m-0 mt-0.5 text-sm text-gray-500">From ad spend to profit - overall performance</p>
              <div className="mt-4 flex items-stretch gap-1 overflow-x-auto pb-1">
                {funnel.map((step, index) => (
                  <div key={step.label} className="flex items-center gap-1">
                    <div className={`flex min-w-[118px] flex-col items-center rounded-xl px-2 py-3 text-center ${step.tone}`}>
                      <p className="m-0 text-[11px] font-bold">{step.label}</p>
                      <step.icon className="mt-2 h-5 w-5" />
                      <p className={`m-0 mt-2 text-lg font-black ${step.value === NOT_RECORDED ? "text-sm text-gray-400" : "text-gray-900"}`}>{step.value}</p>
                      {step.rate && <p className="m-0 mt-0.5 text-[11px] font-bold">{step.rate}</p>}
                      {step.sub && <p className="m-0 mt-1 text-[10px] font-medium text-gray-600">{step.sub}</p>}
                    </div>
                    {index < funnel.length - 1 && <ChevronRight className="h-4 w-4 shrink-0 text-blue-400" />}
                  </div>
                ))}
              </div>
            </section>

            {/* Order status */}
            <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <h2 className="m-0 text-lg font-black text-gray-900 dark:text-slate-100">Order Status Breakdown</h2>
              {statusSlices.length === 0 ? (
                <p className="m-0 mt-6 text-sm text-gray-500">No orders in this period.</p>
              ) : (
                <div className="mt-3 flex flex-col items-center gap-4 sm:flex-row">
                  <div className="relative h-44 w-44 shrink-0">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={statusSlices} dataKey="value" nameKey="name" innerRadius={52} outerRadius={82} paddingAngle={1} stroke="none">
                          {statusSlices.map((slice) => <Cell key={slice.name} fill={slice.fill} />)}
                        </Pie>
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                      <span className="text-2xl font-black text-gray-900 dark:text-slate-100">{t.ordersPlaced}</span>
                      <span className="text-[11px] text-gray-500">Total Orders</span>
                    </div>
                  </div>
                  <ul className="m-0 w-full list-none space-y-3 p-0">
                    {statusSlices.map((slice) => (
                      <li key={slice.name} className="flex items-start gap-2.5">
                        <span className="mt-0.5 h-4 w-4 shrink-0 rounded" style={{ background: slice.fill }} />
                        <span>
                          <span className="block text-[13px] text-gray-700 dark:text-slate-300">{slice.name}</span>
                          <span className="block text-[13px] text-gray-500">
                            <strong className="font-bold text-gray-900 dark:text-slate-100">{slice.value}</strong>{" "}
                            ({((slice.value / t.ordersPlaced) * 100).toFixed(1)}%)
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          </div>

          {/* Six cost cards */}
          <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
            <StatCard icon={Target} tone="rose" title="Cost Per Order (CPO)" value={asMoney(t.costPerOrder)}>
              <Delta value={d.costPerOrder} lowerIsBetter />
            </StatCard>
            <StatCard icon={Truck} tone="green" title="Cost Per Delivered Order (CPDO)" value={asMoney(t.costPerDeliveredOrder)}>
              <Delta value={d.costPerDeliveredOrder} lowerIsBetter />
            </StatCard>
            <StatCard icon={ShoppingCart} tone="blue" title="Placed AOV" value={asMoney(t.placedAov)}>
              <Delta value={d.placedAov} />
            </StatCard>
            <StatCard icon={ShoppingBag} tone="purple" title="Delivered AOV" value={asMoney(t.deliveredAov)}>
              <Delta value={d.deliveredAov} />
            </StatCard>
            <StatCard icon={Crosshair} tone="teal" title="Delivered ROAS" value={t.roas === null ? NOT_RECORDED : asMultiple(t.roas)}>
              <Delta value={d.roas} />
            </StatCard>
            <StatCard icon={Scale} tone="orange" title="Break-even CPDO" value={asMoney(t.breakEvenCostPerDelivered)}>
              <p className="m-0 mt-1 text-[11px] font-medium text-gray-500">Current: {asMoney(t.costPerDeliveredOrder)}</p>
              {t.breakEvenHeadroom !== null && (
                <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[11px] font-bold ${
                  t.breakEvenHeadroom >= 0 ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>
                  {t.breakEvenHeadroom >= 0 ? "+" : ""}{(t.breakEvenHeadroom * 100).toFixed(1)}% headroom
                </span>
              )}
            </StatCard>
          </section>

          {/* Leaderboard */}
          <section className="rounded-xl border border-gray-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="flex flex-col gap-3 border-b border-gray-100 px-5 py-4 lg:flex-row lg:items-center lg:justify-between dark:border-slate-800">
              <div>
                <h2 className="m-0 text-lg font-black text-gray-900 dark:text-slate-100">Media Buyer Leaderboard</h2>
                <p className="m-0 mt-0.5 text-sm text-gray-500">
                  Ranked by delivered revenue. Profit is after ads, products and delivery wherever the ad spend is known.
                </p>
              </div>
              <div ref={menuRef} className="relative flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => setMenu(menu === "columns" ? null : "columns")}
                  className="!min-h-0 inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
                  <Columns3 className="h-4 w-4" />Columns
                </button>
                <button type="button" onClick={() => setMenu(menu === "export" ? null : "export")}
                  className="!min-h-0 inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
                  <Download className="h-4 w-4" />Export<ChevronDown className="h-3.5 w-3.5" />
                </button>
                <button type="button" onClick={() => setShowCharts((open) => !open)}
                  className="!min-h-0 inline-flex items-center gap-2 rounded-lg bg-[#1F8FE0] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1560a8]">
                  <BarChart3 className="h-4 w-4" />{showCharts ? "Hide Charts" : "View Charts"}
                </button>

                {menu === "columns" && (
                  <div className="absolute right-0 top-full z-20 mt-2 w-52 rounded-xl border border-gray-200 bg-white p-2 shadow-lg dark:border-slate-700 dark:bg-slate-900">
                    {COLUMNS.map((column) => (
                      <label key={column.key} className="!mb-0 flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-gray-50">
                        <input type="checkbox" checked={shown(column.key)} className="h-3.5 w-3.5 accent-[#1F8FE0]"
                          onChange={() => setHidden((current) => {
                            const next = new Set(current);
                            if (next.has(column.key)) next.delete(column.key); else next.add(column.key);
                            return next;
                          })} />
                        {column.label}
                      </label>
                    ))}
                  </div>
                )}
                {menu === "export" && (
                  <div className="absolute right-24 top-full z-20 mt-2 w-44 rounded-xl border border-gray-200 bg-white p-2 shadow-lg dark:border-slate-700 dark:bg-slate-900">
                    <button type="button" onClick={exportCsv}
                      className="!min-h-0 w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-gray-50">
                      Download CSV
                    </button>
                  </div>
                )}
              </div>
            </div>

            {showCharts && view.leaderboard.length > 0 && (
              <div className="h-64 border-b border-gray-100 px-5 py-4 dark:border-slate-800">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={view.leaderboard.map((row) => ({
                    name: row.label, Revenue: row.deliveredRevenue, "Net Profit": row.netProfit ?? 0
                  }))}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#6b7280" }} tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: "#6b7280" }} tickLine={false} axisLine={false}
                      tickFormatter={(v: number) => (v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : v >= 1000 ? `${Math.round(v / 1000)}K` : String(v))} />
                    <Tooltip formatter={(value: number) => money(value)} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="Revenue" fill="#1F8FE0" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="Net Profit" fill="#16a34a" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full min-w-[1100px] text-sm">
                <thead>
                  <tr className="bg-gray-50/80 text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:bg-slate-800/60">
                    <th className="px-4 py-3 text-left">#</th>
                    <th className="px-4 py-3 text-left">Media Buyer</th>
                    {COLUMNS.filter((c) => shown(c.key)).map((c) => (
                      <th key={c.key} className={`px-3 py-3 ${c.key === "status" ? "text-center" : "text-right"}`}>{c.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {view.leaderboard.length === 0 && (
                    <tr><td colSpan={14} className="px-4 py-8 text-center text-sm text-gray-500">No orders in this period.</td></tr>
                  )}
                  {view.leaderboard.map((row, index) => (
                    <tr key={row.key} className="border-t border-gray-100 dark:border-slate-800">
                      <td className="px-4 py-3"><RankBadge rank={index + 1} /></td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <PlatformBadge row={row} />
                          <div className="min-w-0">
                            <p className="m-0 font-bold text-gray-900 dark:text-slate-100">{row.label}</p>
                            <p className="m-0 text-[11px] text-gray-400">
                              {row.kind === "unattributed" ? "-" : `${row.campaigns} campaign${row.campaigns === 1 ? "" : "s"} · ${row.products} product${row.products === 1 ? "" : "s"}`}
                            </p>
                          </div>
                        </div>
                      </td>
                      {shown("orders") && <td className="px-3 py-3 text-right tabular-nums">{row.ordersPlaced}</td>}
                      {shown("confirmed") && (
                        <td className="px-3 py-3 text-right tabular-nums">
                          {row.confirmed}
                          <span className="block text-[11px] text-gray-400">{asPercent(row.confirmationRate)}</span>
                        </td>
                      )}
                      {shown("delivered") && <td className="px-3 py-3 text-right tabular-nums">{row.delivered}</td>}
                      {shown("deliveryRate") && <td className="px-3 py-3 text-right tabular-nums">{asPercent(row.deliveryRate)}</td>}
                      {shown("adSpend") && (
                        <td className={`px-3 py-3 text-right tabular-nums ${row.adSpend === null ? "text-gray-400" : ""}`}>{asMoney(row.adSpend)}</td>
                      )}
                      {shown("cpdo") && (
                        <td className={`px-3 py-3 text-right tabular-nums ${row.costPerDeliveredOrder === null ? "text-gray-400" : ""}`}>{asMoney(row.costPerDeliveredOrder)}</td>
                      )}
                      {shown("aov") && <td className="px-3 py-3 text-right tabular-nums">{asMoney(row.deliveredAov)}</td>}
                      {shown("revenue") && <td className="px-3 py-3 text-right tabular-nums font-semibold">{money(row.deliveredRevenue)}</td>}
                      {shown("netProfit") && (
                        <td className={`px-3 py-3 text-right tabular-nums font-black ${
                          row.netProfit === null ? "font-normal text-gray-400" : row.netProfit >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                          {asMoney(row.netProfit)}
                        </td>
                      )}
                      {shown("margin") && (
                        <td className={`px-3 py-3 text-right tabular-nums ${row.margin === null ? "text-gray-400" : row.margin >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                          {asPercent(row.margin)}
                        </td>
                      )}
                      {shown("roas") && <td className="px-3 py-3 text-right tabular-nums">{asMultiple(row.roas)}</td>}
                      {shown("status") && (
                        <td className="px-3 py-3 text-center">
                          <span className={`inline-block rounded-md px-2.5 py-1 text-[11px] font-bold ${STATUS_PILL[row.status].className}`}>
                            {STATUS_PILL[row.status].label}
                          </span>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
