import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  Activity, AlertTriangle, ArrowRight, ArrowUp, CalendarDays, Check, CheckCircle2, ChevronDown, ChevronRight, Copy, Database, FileText,
  Globe, Infinity as InfinityIcon, Link2, Monitor, MoreHorizontal, Plus, RefreshCw, Search, Server, Settings as SettingsIcon, ShoppingCart, X, XCircle
} from "lucide-react";
import { buildEmbedSnippet } from "../lib/embed-snippet";
import {
  trackingHubApi, type HubDataSource, type HubIssue, type HubKpis, type HubLedgerDetail, type HubLedgerRow, type HubLink,
  type HubOverview, type HubProfile, type HubReconciliation, type HubSettings, type HubStrategy, type HubWebsite
} from "../lib/api";

/**
 * Tracking Hub (Bright, 2 Oct 2026): one place for ad conversion tracking.
 * Overview is built to Bright's image; the other tabs hold the working parts:
 * data sources (Meta datasets + profiles), websites, tracking links (with the
 * embed code and go-live checklist), the purchase event ledger,
 * reconciliation against Meta's own numbers, diagnostics and settings.
 * Owner only (it holds the Meta tokens).
 */

type Tab = "overview" | "sources" | "websites" | "links" | "ledger" | "reconciliation" | "diagnostics" | "settings";
const TABS: Array<{ key: Tab; label: string; icon: typeof Monitor }> = [
  { key: "overview", label: "Overview", icon: Monitor },
  { key: "sources", label: "Data Sources", icon: Database },
  { key: "websites", label: "Websites", icon: Globe },
  { key: "links", label: "Tracking Links", icon: Link2 },
  { key: "ledger", label: "Event Ledger", icon: FileText },
  { key: "reconciliation", label: "Reconciliation", icon: RefreshCw },
  { key: "diagnostics", label: "Diagnostics", icon: Activity },
  { key: "settings", label: "Settings", icon: SettingsIcon }
];

const lagosToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Lagos" });
const shift = (key: string, days: number) => { const [y, m, d] = key.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10); };
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
const longDay = (key: string) => new Date(`${key}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const shortDay = (key: string) => new Date(`${key}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "Africa/Lagos" });
const ago = (iso: string | null) => {
  if (!iso) return "";
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
};
const naira = (value: number, currency = "NGN") => `${currency === "NGN" ? "₦" : ""}${Math.round(value).toLocaleString("en-NG")}`;
const nf = (value: number) => Math.round(value).toLocaleString("en-NG");
const pctChange = (now: number, before: number) => (before > 0 ? Math.round(((now - before) / before) * 100) : now > 0 ? 100 : 0);
const STRATEGY_LABEL: Record<string, string> = { browser_capi: "Browser + CAPI", capi_only: "CAPI only", landing_page: "Thank-you page Pixel", off: "Off" };

const PRESETS = [
  { key: "today", label: "Today", range: () => { const t = lagosToday(); return { from: t, to: t }; } },
  { key: "yesterday", label: "Yesterday", range: () => { const y = shift(lagosToday(), -1); return { from: y, to: y }; } },
  { key: "7d", label: "Last 7 days", range: () => ({ from: shift(lagosToday(), -6), to: lagosToday() }) },
  { key: "30d", label: "Last 30 days", range: () => ({ from: shift(lagosToday(), -29), to: lagosToday() }) }
];

// ---------------------------------------------------------------- pieces

function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-xl border border-gray-200 bg-white dark:border-slate-800 dark:bg-slate-900 ${className}`}>{children}</section>;
}

function StatusPill({ tone, children }: { tone: "green" | "orange" | "red" | "blue" | "gray"; children: ReactNode }) {
  const tones = { green: "bg-emerald-50 text-emerald-700", orange: "bg-amber-50 text-amber-700", red: "bg-rose-50 text-rose-700", blue: "bg-blue-50 text-blue-700", gray: "bg-gray-100 text-gray-600" };
  const dots = { green: "bg-emerald-500", orange: "bg-amber-500", red: "bg-rose-500", blue: "bg-blue-500", gray: "bg-gray-400" };
  return <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${tones[tone]}`}><span className={`h-1.5 w-1.5 rounded-full ${dots[tone]}`} />{children}</span>;
}

const sourceTone = (source: HubDataSource): ["green" | "orange" | "red" | "gray", string] =>
  source.health === "healthy" ? ["green", "Healthy"] : source.health === "testing" ? ["orange", "Testing"] : source.health === "error" ? ["red", "Error"] : source.health === "no_token" ? ["red", "No token"] : ["gray", "Not tested"];

const LEDGER_TONE: Record<string, "green" | "blue" | "orange" | "red" | "gray"> = {
  deduped: "green", server_only: "blue", browser_only: "orange", capi_failed: "red", test: "blue", not_tracked: "red", page_pixel: "gray"
};

function MetaIcon() {
  return <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-blue-600 text-white"><InfinityIcon className="h-4 w-4" /></span>;
}
function WordPressIcon() {
  return <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-slate-700 text-[11px] font-black text-slate-700 dark:border-slate-300 dark:text-slate-300">W</span>;
}
function CheckDot({ ok = true }: { ok?: boolean | null }) {
  return ok
    ? <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-white"><Check className="h-3 w-3" strokeWidth={3} /></span>
    : <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-gray-200 text-white dark:bg-slate-700"><Check className="h-3 w-3" strokeWidth={3} /></span>;
}

function Modal({ title, subtitle, onClose, children, wide }: { title: string; subtitle?: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4" onClick={onClose}>
      <div className={`mt-10 w-full ${wide ? "max-w-4xl" : "max-w-xl"} rounded-2xl bg-white shadow-xl dark:bg-slate-900`} onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b border-gray-100 px-6 py-4 dark:border-slate-800">
          <div><h3 className="m-0 text-lg font-black text-gray-900 dark:text-slate-100">{title}</h3>{subtitle ? <p className="m-0 mt-0.5 text-[13px] text-gray-500">{subtitle}</p> : null}</div>
          <button type="button" aria-label="Close" onClick={onClose} className="!min-h-0 rounded p-1 text-gray-500 hover:bg-gray-100"><X className="h-5 w-5" /></button>
        </div>
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  );
}

const input = "mt-1 h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-900";
const labelCls = "block text-[12px] font-bold text-gray-700 dark:text-slate-300";
const darkButton = "!min-h-0 inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3.5 py-2 text-[13px] font-bold text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900";
const lightButton = "!min-h-0 inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-[12px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200";

function ActionMenu({ items }: { items: Array<{ label: string; onClick: () => void; danger?: boolean }> }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative inline-block">
      <button type="button" aria-label="More" onClick={() => setOpen((value) => !value)} className="!min-h-0 rounded p-1 text-gray-500 hover:bg-gray-100 dark:hover:bg-slate-800"><MoreHorizontal className="h-4 w-4" /></button>
      {open ? (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-1 w-48 rounded-lg border border-gray-200 bg-white p-1 shadow-lg dark:border-slate-700 dark:bg-slate-900">
            {items.map((item) => (
              <button key={item.label} type="button" onClick={() => { setOpen(false); item.onClick(); }} className={`!min-h-0 block w-full rounded-md px-3 py-2 text-left text-[13px] font-semibold hover:bg-gray-50 dark:hover:bg-slate-800 ${item.danger ? "text-rose-700" : "text-gray-700 dark:text-slate-200"}`}>{item.label}</button>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- page

export default function TrackingHubPage({ onToast, renderMetaDefaults }: { onToast: (message: string) => void; renderMetaDefaults?: () => ReactNode }) {
  const [tab, setTab] = useState<Tab>("overview");
  const [preset, setPreset] = useState("today");
  const [range, setRange] = useState(PRESETS[0].range());
  const [rangeOpen, setRangeOpen] = useState(false);
  const [compare, setCompare] = useState<"previous" | "none">("previous");
  const [creatingLink, setCreatingLink] = useState(0);
  const [ledgerFilter, setLedgerFilter] = useState<{ status?: string; orderIds?: string[] }>({});
  const length = daysBetween(range.from, range.to);
  const comparePeriod = { compareFrom: shift(range.from, -length), compareTo: shift(range.from, -1) };
  const compareLabel = preset === "today" ? "vs. yesterday" : preset === "yesterday" ? "vs. day before" : "vs. previous period";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="m-0 text-[28px] font-black tracking-tight text-gray-900 dark:text-slate-50">Tracking Hub</h1>
          <p className="m-0 mt-1 text-[15px] text-gray-500 dark:text-slate-400">Centralized tracking for all ads, websites, forms and conversion events.</p>
        </div>
        <div className="flex flex-wrap items-stretch gap-3">
          <div className="relative">
            <button type="button" onClick={() => setRangeOpen((value) => !value)} className="!min-h-0 flex h-full items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-left dark:border-slate-700 dark:bg-slate-900">
              <CalendarDays className="h-5 w-5 text-gray-500" />
              <span>
                <span className="block text-[12px] font-semibold text-gray-500">{PRESETS.find((item) => item.key === preset)?.label ?? "Custom"}</span>
                <span className="block text-[13px] font-semibold text-gray-800 dark:text-slate-200">{longDay(range.from)} – {longDay(range.to)}</span>
              </span>
            </button>
            {rangeOpen ? (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setRangeOpen(false)} />
                <div className="absolute right-0 z-20 mt-2 w-72 rounded-xl border border-gray-200 bg-white p-3 shadow-lg dark:border-slate-700 dark:bg-slate-900">
                  <div className="grid grid-cols-2 gap-1.5">
                    {PRESETS.map((item) => (
                      <button key={item.key} type="button" onClick={() => { setPreset(item.key); setRange(item.range()); setRangeOpen(false); }}
                        className={`!min-h-0 rounded-lg px-3 py-2 text-[13px] font-semibold ${preset === item.key ? "bg-blue-600 text-white" : "bg-gray-50 text-gray-700 hover:bg-gray-100 dark:bg-slate-800 dark:text-slate-200"}`}>{item.label}</button>
                    ))}
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-[12px]">
                    <label>From<input type="date" value={range.from} max={range.to} onChange={(event) => { setPreset("custom"); setRange((value) => ({ ...value, from: event.target.value })); }} className={input} /></label>
                    <label>To<input type="date" value={range.to} min={range.from} max={lagosToday()} onChange={(event) => { setPreset("custom"); setRange((value) => ({ ...value, to: event.target.value })); }} className={input} /></label>
                  </div>
                </div>
              </>
            ) : null}
          </div>
          <label className="relative flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-2.5 dark:border-slate-700 dark:bg-slate-900">
            <span>
              <span className="block text-[12px] font-semibold text-gray-500">Compare</span>
              <select value={compare} onChange={(event) => setCompare(event.target.value as "previous" | "none")} className="!min-h-0 appearance-none bg-transparent pr-6 text-[13px] font-semibold text-gray-800 outline-none dark:text-slate-200">
                <option value="previous">Previous period</option>
                <option value="none">No comparison</option>
              </select>
            </span>
            <ChevronDown className="pointer-events-none absolute right-3 h-4 w-4 text-gray-500" />
          </label>
          <button type="button" onClick={() => { setTab("links"); setCreatingLink((value) => value + 1); }} className="!min-h-0 inline-flex items-center gap-2 rounded-xl bg-slate-900 px-5 py-3 text-[15px] font-bold text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900">
            <Plus className="h-5 w-5" /> Create Tracking Link
          </button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white px-2 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex min-w-max gap-1">
          {TABS.map((item) => (
            <button key={item.key} type="button" onClick={() => setTab(item.key)}
              className={`!min-h-0 inline-flex items-center gap-2 border-b-2 px-4 py-3.5 text-[14px] font-semibold transition-colors ${tab === item.key ? "border-blue-600 text-blue-600" : "border-transparent text-gray-600 hover:text-gray-900 dark:text-slate-300"}`}>
              <item.icon className="h-4 w-4" /> {item.label}
            </button>
          ))}
        </div>
      </div>

      {tab === "overview" ? <OverviewTab range={range} compare={compare} comparePeriod={comparePeriod} compareLabel={compareLabel} onTab={setTab} onToast={onToast}
        onOpenLedger={(filter) => { setLedgerFilter(filter); setTab("ledger"); }} /> : null}
      {tab === "sources" ? <DataSourcesTab onToast={onToast} /> : null}
      {tab === "websites" ? <WebsitesTab onToast={onToast} /> : null}
      {tab === "links" ? <LinksTab onToast={onToast} createSignal={creatingLink} /> : null}
      {tab === "ledger" ? <LedgerTab range={range} initial={ledgerFilter} /> : null}
      {tab === "reconciliation" ? <ReconciliationTab range={range} onToast={onToast} /> : null}
      {tab === "diagnostics" ? <DiagnosticsTab onTab={setTab} onOpenLedger={(filter) => { setLedgerFilter(filter); setTab("ledger"); }} /> : null}
      {tab === "settings" ? <SettingsTab onToast={onToast} renderMetaDefaults={renderMetaDefaults} /> : null}
    </div>
  );
}

// ---------------------------------------------------------------- overview

function KpiCard({ icon: Icon, tone, label, value, delta, sub }: { icon: typeof Monitor; tone: string; label: string; value: string; delta?: number | null; sub: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-3.5 py-4 dark:border-slate-800 dark:bg-slate-900">
      <span className={`inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${tone}`}><Icon className="h-6 w-6" /></span>
      <div className="min-w-0 flex-1">
        <span className="block text-[13px] font-semibold leading-tight text-gray-600 dark:text-slate-400">{label}</span>
        <div className="mt-1.5 flex items-center gap-2">
          <strong className="text-[24px] font-black leading-none text-gray-900 dark:text-slate-50">{value}</strong>
          <span className="min-w-0 leading-tight">
            {delta !== undefined && delta !== null ? <span className={`flex items-center gap-0.5 whitespace-nowrap text-[12px] font-bold ${delta >= 0 ? "text-emerald-600" : "text-rose-600"}`}><ArrowUp className={`h-3 w-3 ${delta < 0 ? "rotate-180" : ""}`} />{Math.abs(delta)}%</span> : null}
            <span className="block whitespace-nowrap text-[10.5px] text-gray-400">{sub}</span>
          </span>
        </div>
      </div>
    </div>
  );
}

function HealthRing({ score }: { score: number }) {
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const color = score >= 90 ? "#16a34a" : score >= 70 ? "#f59e0b" : "#e11d48";
  return (
    <div className="relative h-[120px] w-[120px] shrink-0">
      <svg viewBox="0 0 140 140" className="h-full w-full -rotate-90">
        <circle cx="70" cy="70" r={radius} fill="none" stroke="#e5e7eb" strokeWidth="12" />
        <circle cx="70" cy="70" r={radius} fill="none" stroke={color} strokeWidth="12" strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - Math.min(100, score) / 100)} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <strong className="text-[22px] font-black text-gray-900 dark:text-slate-50">{score.toFixed(1)}%</strong>
        <span className="text-[13px] font-bold" style={{ color }}>{score >= 90 ? "Healthy" : score >= 70 ? "Needs work" : "Unhealthy"}</span>
      </div>
    </div>
  );
}

const ISSUE_TONE: Record<HubIssue["severity"], string> = { red: "bg-rose-600", orange: "bg-orange-500", yellow: "bg-amber-400" };

function OverviewTab({ range, compare, comparePeriod, compareLabel, onTab, onToast, onOpenLedger }: {
  range: { from: string; to: string }; compare: "previous" | "none"; comparePeriod: { compareFrom: string; compareTo: string }; compareLabel: string;
  onTab: (tab: Tab) => void; onToast: (message: string) => void; onOpenLedger: (filter: { status?: string; orderIds?: string[] }) => void;
}) {
  const [data, setData] = useState<HubOverview | null>(null);
  const [error, setError] = useState("");
  const [chartDays, setChartDays] = useState(7);
  useEffect(() => {
    let cancelled = false;
    setError("");
    trackingHubApi.overview({ ...range, ...comparePeriod, chartDays }).then((result) => { if (!cancelled) setData(result); }).catch((err: any) => { if (!cancelled) setError(err?.message ?? "Could not load the Tracking Hub."); });
    return () => { cancelled = true; };
  }, [range.from, range.to, chartDays]);

  if (error && !data) return <Card className="p-6 text-sm font-semibold text-rose-700">{error}</Card>;
  if (!data) return <Card className="p-10 text-center text-sm text-gray-500">Loading the Tracking Hub…</Card>;
  const k = data.kpis;
  const p = data.previous;
  const delta = (now: number, before: number) => (compare === "none" ? null : pctChange(now, before));
  const items = Object.fromEntries(data.health.items.map((item) => [item.key, item]));
  const healthRows = [
    { title: `${items.sources?.total ?? 0} Data Sources`, sub: `${items.sources?.healthy ?? 0} Healthy`, ok: (items.sources?.healthy ?? 0) === (items.sources?.total ?? 0) && (items.sources?.total ?? 0) > 0 },
    { title: `${items.websites?.total ?? 0} Websites`, sub: `${items.websites?.healthy ?? 0} Healthy`, ok: (items.websites?.healthy ?? 0) === (items.websites?.total ?? 0) && (items.websites?.total ?? 0) > 0 },
    { title: `${items.links?.total ?? 0} Tracking Links`, sub: `${items.links?.healthy ?? 0} Healthy`, ok: (items.links?.healthy ?? 0) === (items.links?.total ?? 0) && (items.links?.total ?? 0) > 0 },
    { title: "Event Deduplication", sub: items.dedup?.detail ?? "", ok: (items.dedup?.healthy ?? 0) > 0 },
    { title: "CAPI Connection", sub: items.capi?.detail ?? "", ok: (items.capi?.healthy ?? 0) > 0 }
  ];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        <KpiCard icon={ShoppingCart} tone="bg-rose-50 text-rose-600" label="Protohub Orders" value={nf(k.orders)} delta={delta(k.orders, p.orders)} sub={compareLabel} />
        <KpiCard icon={Activity} tone="bg-blue-50 text-blue-600" label="Purchase Events" value={nf(k.purchaseEvents)} delta={delta(k.purchaseEvents, p.purchaseEvents)} sub="all sources" />
        <KpiCard icon={Monitor} tone="bg-emerald-50 text-emerald-600" label="Browser Events (Pixel)" value={nf(k.browserEvents)} delta={delta(k.browserEvents, p.browserEvents)} sub={`${k.browserPct}% of orders`} />
        <KpiCard icon={Server} tone="bg-blue-50 text-blue-600" label="Server Events (CAPI)" value={nf(k.serverEvents)} delta={delta(k.serverEvents, p.serverEvents)} sub={`${k.serverPct}% of orders`} />
        <KpiCard icon={Link2} tone="bg-emerald-50 text-emerald-600" label="Deduplicated Events" value={nf(k.deduped)} sub={`${k.dedupRate}% match rate`} />
        <KpiCard icon={AlertTriangle} tone="bg-rose-50 text-rose-600" label="Unmatched Events" value={nf(k.unmatched)} sub={`${k.unmatchedPct}% of orders`} />
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,2.15fr)_minmax(0,1fr)_minmax(0,0.78fr)]">
        <Card className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="m-0 text-[17px] font-black text-gray-900 dark:text-slate-100">Orders vs Purchase Events</h2>
            <select value={chartDays} onChange={(event) => setChartDays(Number(event.target.value))} className="!min-h-0 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-[13px] dark:border-slate-700 dark:bg-slate-900">
              <option value={7}>Last 7 days</option><option value={14}>Last 14 days</option><option value={30}>Last 30 days</option>
            </select>
          </div>
          <div className="mt-2 flex flex-wrap gap-5 text-[12px] text-gray-600">
            <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-blue-600" />Protohub Orders</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-blue-300" />Browser Events</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />Server Events</span>
          </div>
          <div className="mt-3 h-[210px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.chart.map((row) => ({ ...row, label: shortDay(row.day) }))} barGap={2} barCategoryGap="22%">
                <CartesianGrid vertical={false} stroke="#eef0f3" />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "#6b7280" }} />
                <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "#6b7280" }} width={32} allowDecimals={false} />
                <Tooltip cursor={{ fill: "rgba(148,163,184,0.12)" }} />
                <Bar dataKey="orders" name="Protohub Orders" fill="#2563eb" radius={[3, 3, 0, 0]} />
                <Bar dataKey="browser" name="Browser Events" fill="#93c5fd" radius={[3, 3, 0, 0]} />
                <Bar dataKey="server" name="Server Events" fill="#4ade80" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="p-5">
          <h2 className="m-0 text-[17px] font-black text-gray-900 dark:text-slate-100">Tracking Health</h2>
          <div className="mt-4 flex items-center gap-3">
            <HealthRing score={data.health.score} />
            <ul className="m-0 flex-1 list-none divide-y divide-gray-100 p-0 dark:divide-slate-800">
              {healthRows.map((row) => (
                <li key={row.title} className="flex items-center gap-2.5 py-2">
                  {row.ok ? <CheckCircle2 className="h-5 w-5 shrink-0 fill-emerald-500 text-white" /> : <AlertTriangle className="h-5 w-5 shrink-0 text-amber-500" />}
                  <span className="min-w-0"><span className="block whitespace-nowrap text-[12.5px] font-semibold text-gray-800 dark:text-slate-200">{row.title}</span><span className="block whitespace-nowrap text-[11px] text-gray-400">{row.sub}</span></span>
                </li>
              ))}
            </ul>
          </div>
          <button type="button" onClick={() => onTab("diagnostics")} className="!min-h-0 mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-gray-50 px-3 py-2.5 text-[13px] font-semibold text-gray-700 hover:bg-gray-100 dark:bg-slate-800 dark:text-slate-200">View Diagnostics <ArrowRight className="h-4 w-4" /></button>
        </Card>

        <Card className="p-5">
          <div className="flex items-center justify-between gap-2">
            <h2 className="m-0 text-[17px] font-black text-gray-900 dark:text-slate-100">Attribution Capture</h2>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[12px] font-semibold text-emerald-700"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />Active</span>
          </div>
          <p className="m-0 mt-1 text-[13px] text-gray-500">We capture and store all campaign data automatically.</p>
          <ul className="m-0 mt-3 list-none space-y-2.5 p-0">
            {data.attribution.fields.map((field) => (
              <li key={field.key} className="flex items-center gap-2.5 text-[14px] text-gray-800 dark:text-slate-200" title={data.attribution.orders ? `Captured on ${field.pct}% of ${data.attribution.orders} ad orders in this period` : "No ad orders in this period"}>
                {field.pct >= 50 || data.attribution.orders === 0 ? <CheckCircle2 className="h-5 w-5 shrink-0 fill-emerald-500 text-white" /> : field.pct > 0 ? <AlertTriangle className="h-5 w-5 shrink-0 text-amber-500" /> : <XCircle className="h-5 w-5 shrink-0 fill-rose-500 text-white" />}
                {field.label}
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <Card className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="m-0 text-[17px] font-black text-gray-900 dark:text-slate-100">Data Sources (Meta Datasets)</h2>
            <div className="flex gap-2"><button type="button" className={lightButton} onClick={() => onTab("sources")}>View all</button><button type="button" className={darkButton} onClick={() => onTab("sources")}><Plus className="h-4 w-4" /> Connect Dataset</button></div>
          </div>
          <div className="mt-3 overflow-x-auto">
            <table className="!min-w-0 w-full whitespace-nowrap text-left text-[12px] [&_td]:!px-1.5 [&_th]:!px-1.5 [&_th]:!py-2 [&_th]:!text-[12px] [&_th]:!font-semibold">
              <thead><tr className="text-[12px] text-gray-500"><th className="py-2 font-semibold">Name</th><th className="py-2 font-semibold">Business Account</th><th className="py-2 font-semibold">Pixel ID</th><th className="py-2 font-semibold">CAPI</th><th className="py-2 font-semibold">Events (7d)</th><th className="py-2 font-semibold">Status</th><th /></tr></thead>
              <tbody>
                {data.dataSources.map((source) => {
                  const [tone, text] = sourceTone(source);
                  return (
                    <tr key={source.id} className="border-t border-gray-100 text-gray-800 dark:border-slate-800 dark:text-slate-200 [&>td]:[color:inherit]">
                      <td className="py-2.5"><span className="flex items-center gap-2 font-semibold"><MetaIcon />{source.name}{source.isMain ? <span className="rounded-md bg-blue-50 px-1.5 py-0.5 text-[11px] font-semibold text-blue-700">Main</span> : null}</span></td>
                      <td className="max-w-[104px] truncate py-2.5 text-gray-600" title={source.businessName}>{source.businessName || "—"}</td>
                      <td className="py-2.5 text-[12px] text-gray-600">{source.pixelId}</td>
                      <td className="py-2.5"><CheckDot ok={source.hasToken} /></td>
                      <td className="py-2.5 text-gray-600" title={source.eventsFromMeta ? "From Meta" : "Sent by Protohub (refresh in Data Sources for Meta's count)"}>{nf(source.events7d ?? source.sentByProtohub7d)}</td>
                      <td className="py-2.5"><StatusPill tone={tone}>{text}</StatusPill></td>
                      <td className="py-2.5 text-right"><ActionMenu items={[{ label: "Open in Data Sources", onClick: () => onTab("sources") }]} /></td>
                    </tr>
                  );
                })}
                {data.dataSources.length === 0 ? <tr><td colSpan={7} className="py-6 text-center text-gray-500">No dataset connected yet. <button type="button" className="!min-h-0 font-bold text-blue-600" onClick={() => onTab("sources")}>Connect one</button></td></tr> : null}
              </tbody>
            </table>
          </div>
        </Card>

        <Card className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="m-0 text-[17px] font-black text-gray-900 dark:text-slate-100">Websites</h2>
            <div className="flex gap-2"><button type="button" className={lightButton} onClick={() => onTab("websites")}>View all</button><button type="button" className={darkButton} onClick={() => onTab("websites")}><Plus className="h-4 w-4" /> Add Website</button></div>
          </div>
          <div className="mt-3 overflow-x-auto">
            <table className="!min-w-0 w-full whitespace-nowrap text-left text-[12px] [&_td]:!px-1.5 [&_th]:!px-1.5 [&_th]:!py-2 [&_th]:!text-[12px] [&_th]:!font-semibold">
              <thead><tr className="text-[12px] text-gray-500"><th className="py-2 font-semibold">Domain</th><th className="py-2 font-semibold">Platform</th><th className="py-2 font-semibold">Data Source</th><th className="py-2 font-semibold">Forms</th><th className="py-2 font-semibold">Status</th><th /></tr></thead>
              <tbody>
                {data.websites.map((site) => (
                  <tr key={site.id} className="border-t border-gray-100 text-gray-800 dark:border-slate-800 dark:text-slate-200 [&>td]:[color:inherit]">
                    <td className="py-2.5"><span className="flex items-center gap-2"><WordPressIcon />{site.domain}</span></td>
                    <td className="py-2.5 text-gray-600">{site.platform}</td>
                    <td className="py-2.5 text-gray-600">{site.dataSourceName ?? "—"}</td>
                    <td className="py-2.5 text-gray-600">{site.forms}</td>
                    <td className="py-2.5" title={site.problems.join(" · ")}><StatusPill tone={site.status === "healthy" ? "green" : "orange"}>{site.status === "healthy" ? "Healthy" : "Warning"}</StatusPill></td>
                    <td className="py-2.5 text-right"><ActionMenu items={[{ label: "Open in Websites", onClick: () => onTab("websites") }]} /></td>
                  </tr>
                ))}
                {data.websites.length === 0 ? <tr><td colSpan={6} className="py-6 text-center text-gray-500">No website added yet. <button type="button" className="!min-h-0 font-bold text-blue-600" onClick={() => onTab("websites")}>Add one</button></td></tr> : null}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.65fr)_minmax(0,0.75fr)]">
        <Card className="p-5">
          <div className="flex items-center justify-between gap-2">
            <h2 className="m-0 text-[17px] font-black text-gray-900 dark:text-slate-100">Recent Purchase Events</h2>
            <button type="button" className={lightButton} onClick={() => onOpenLedger({})}>View all</button>
          </div>
          <div className="mt-3 overflow-x-auto">
            <table className="!min-w-0 w-full whitespace-nowrap text-left text-[12px] [&_td]:!px-1.5 [&_th]:!px-1.5 [&_th]:!py-2 [&_th]:!text-[12px] [&_th]:!font-semibold">
              <thead><tr className="text-[12px] text-gray-500">
                {["Order ID", "Product", "Website", "Source", "Campaign / Ad", "Value", "Browser", "CAPI", "Status", "Time"].map((head) => <th key={head} className="py-2 font-semibold">{head}</th>)}
              </tr></thead>
              <tbody>
                {data.recent.map((row) => (
                  <tr key={row.orderId} className="border-t border-gray-100 text-gray-800 dark:border-slate-800 dark:text-slate-200 [&>td]:[color:inherit]">
                    <td className="py-2.5 font-bold">{row.orderId}</td>
                    <td className="max-w-[86px] truncate py-2.5 text-gray-600" title={row.product}>{row.product}</td>
                    <td className="max-w-[104px] truncate py-2.5 text-gray-600" title={row.website ?? ""}>{row.website ?? "—"}</td>
                    <td className="py-2.5 text-gray-600">{row.source ?? "—"}</td>
                    <td className="py-2.5 text-gray-600" title={row.campaignId ? `Campaign ${row.campaignId}${row.adId ? ` · Ad ${row.adId}` : ""}` : ""}>{row.campaignId ? `${row.campaignId.slice(0, 9)}${row.adId ? ` / Ad ${row.adId.slice(-2)}` : ""}` : "—"}</td>
                    <td className="py-2.5 text-gray-600">{naira(row.value, row.currency)}</td>
                    <td className="py-2.5"><CheckDot ok={row.browser} /></td>
                    <td className="py-2.5"><CheckDot ok={row.serverStatus === "sent" || row.serverStatus === "dry_run"} /></td>
                    <td className="py-2.5"><StatusPill tone={LEDGER_TONE[row.status]}>{row.statusLabel}</StatusPill></td>
                    <td className="py-2.5 text-gray-600">{timeOf(row.createdAt)}</td>
                  </tr>
                ))}
                {data.recent.length === 0 ? <tr><td colSpan={10} className="py-6 text-center text-gray-500">No form orders in this period.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </Card>

        <Card className="p-5">
          <div className="flex items-center justify-between gap-2">
            <h2 className="m-0 flex items-center gap-2 text-[17px] font-black text-gray-900 dark:text-slate-100">Needs Attention {data.issueCount > 0 ? <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-bold text-rose-600"><span className="h-1.5 w-1.5 rounded-full bg-rose-500" />{data.issueCount} issue{data.issueCount === 1 ? "" : "s"}</span> : null}</h2>
            <button type="button" className={lightButton} onClick={() => onTab("diagnostics")}>View all</button>
          </div>
          <ul className="m-0 mt-3 list-none divide-y divide-gray-100 p-0 dark:divide-slate-800">
            {data.attention.map((issue, index) => (
              <li key={index}>
                <button type="button" onClick={() => (issue.orderIds?.length ? onOpenLedger({ orderIds: issue.orderIds }) : onTab(issue.tab as Tab))} className="!min-h-0 flex w-full items-center gap-3 py-2.5 text-left">
                  <span className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md ${ISSUE_TONE[issue.severity]} text-white`}><AlertTriangle className="h-3 w-3" /></span>
                  <span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-bold text-gray-900 dark:text-slate-100">{issue.title}</span><span className="block truncate text-[11px] text-gray-500">{issue.detail}</span></span>
                  {issue.at ? <span className="shrink-0 text-[11px] text-gray-400">{ago(issue.at)}</span> : null}
                  <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" />
                </button>
              </li>
            ))}
            {data.attention.length === 0 ? <li className="py-6 text-center text-[13px] text-gray-500"><CheckCircle2 className="mx-auto mb-1 h-6 w-6 fill-emerald-500 text-white" />Nothing needs attention.</li> : null}
          </ul>
        </Card>
      </div>
    </div>
  );
}

// ------------------------------------------------------------ data sources

function DataSourcesTab({ onToast }: { onToast: (message: string) => void }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof trackingHubApi.dataSources>> | null>(null);
  const [editing, setEditing] = useState<HubDataSource | "new" | null>(null);
  const [profileEditing, setProfileEditing] = useState<HubProfile | "new" | null>(null);
  const [detail, setDetail] = useState<HubDataSource | null>(null);
  const load = () => trackingHubApi.dataSources().then(setData).catch((err: any) => onToast(err?.message ?? "Could not load."));
  useEffect(() => { void load(); }, []);
  if (!data) return <Card className="p-10 text-center text-sm text-gray-500">Loading…</Card>;
  const sourceName = (id: string | null) => data.dataSources.find((row) => row.id === id)?.name ?? "—";
  const siteName = (id: string | null) => data.websites.find((row) => row.id === id)?.domain ?? "—";
  return (
    <div className="space-y-5">
      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div><h2 className="m-0 text-[17px] font-black text-gray-900 dark:text-slate-100">Data Sources (Meta Datasets)</h2><p className="m-0 mt-0.5 text-[13px] text-gray-500">Enter each Pixel and its token once. Tokens stay on the server and never go into the WordPress code.</p></div>
          <button type="button" className={darkButton} onClick={() => setEditing("new")}><Plus className="h-4 w-4" /> Connect Meta Dataset</button>
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="!min-w-[760px] w-full text-left text-[13px]">
            <thead><tr className="text-[12px] text-gray-500"><th className="py-2 font-semibold">Business / Account</th><th className="py-2 font-semibold">Dataset / Pixel</th><th className="py-2 font-semibold">Ad accounts</th><th className="py-2 font-semibold">CAPI</th><th className="py-2 font-semibold">Events (7d)</th><th className="py-2 font-semibold">Status</th><th /></tr></thead>
            <tbody>
              {data.dataSources.map((source) => {
                const [tone, text] = sourceTone(source);
                return (
                  <tr key={source.id} className="cursor-pointer border-t border-gray-100 text-gray-800 hover:bg-gray-50 dark:border-slate-800 dark:text-slate-200 dark:hover:bg-slate-800/40 [&>td]:[color:inherit]" onClick={() => setDetail(source)}>
                    <td className="py-2.5 text-gray-600">{source.businessName || "—"}</td>
                    <td className="py-2.5"><span className="flex items-center gap-2 font-semibold"><MetaIcon />{source.name}{source.isMain ? <span className="rounded-md bg-blue-50 px-1.5 py-0.5 text-[11px] text-blue-700">Main</span> : null}</span><span className="ml-8 font-mono text-[11px] text-gray-500">{source.pixelId}</span></td>
                    <td className="py-2.5 text-gray-600">{source.adAccountIds.length ? source.adAccountIds.map((id) => `act_${id}`).join(", ") : "—"}</td>
                    <td className="py-2.5"><CheckDot ok={source.hasToken} /></td>
                    <td className="py-2.5 text-gray-600">{source.events7d !== null ? nf(source.events7d) : <span title="Sent by Protohub">{nf(source.sentByProtohub7d)}*</span>}</td>
                    <td className="py-2.5"><StatusPill tone={tone}>{text}</StatusPill></td>
                    <td className="py-2.5 text-right" onClick={(event) => event.stopPropagation()}>
                      <ActionMenu items={[
                        { label: "Edit", onClick: () => setEditing(source) },
                        { label: "Test connection", onClick: async () => { try { const r = await trackingHubApi.testDataSource(source.id); onToast(r.ok ? r.message : `${r.human?.title ?? r.message}`); await load(); } catch (err: any) { onToast(err?.message ?? "Test failed."); } } },
                        { label: "Delete", danger: true, onClick: async () => { if (!window.confirm(`Delete ${source.name}? Links using it stop sending server events.`)) return; await trackingHubApi.deleteDataSource(source.id); await load(); } }
                      ]} />
                    </td>
                  </tr>
                );
              })}
              {data.dataSources.length === 0 ? <tr><td colSpan={7} className="py-8 text-center text-gray-500">No dataset connected yet.</td></tr> : null}
            </tbody>
          </table>
          {data.dataSources.some((row) => row.events7d === null) ? <p className="m-0 mt-2 text-[11px] text-gray-400">* Sent by Protohub. Open a dataset and press "Refresh from Meta" for Meta's own count.</p> : null}
        </div>
      </Card>

      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div><h2 className="m-0 text-[17px] font-black text-gray-900 dark:text-slate-100">Tracking Profiles</h2><p className="m-0 mt-0.5 text-[13px] text-gray-500">"Household products — Meta": a data source, default website and purchase strategy, chosen once per form instead of Pixel IDs.</p></div>
          <button type="button" className={lightButton} onClick={() => setProfileEditing("new")}><Plus className="h-4 w-4" /> New profile</button>
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {data.profiles.map((profile) => (
            <button key={profile.id} type="button" onClick={() => setProfileEditing(profile)} className="!min-h-0 rounded-xl border border-gray-200 p-4 text-left hover:border-blue-300 dark:border-slate-700">
              <span className="flex items-center justify-between gap-2"><strong className="text-[14px] text-gray-900 dark:text-slate-100">{profile.name}</strong><StatusPill tone={profile.status === "production" ? "green" : "orange"}>{profile.status === "production" ? "Production" : "Testing"}</StatusPill></span>
              <span className="mt-2 block text-[12px] text-gray-600">Dataset: {sourceName(profile.dataSourceId)}</span>
              <span className="block text-[12px] text-gray-600">Website: {siteName(profile.defaultWebsiteId)}</span>
              <span className="block text-[12px] text-gray-600">Strategy: {STRATEGY_LABEL[profile.strategy]}</span>
              {profile.adAccountLabel ? <span className="block text-[12px] text-gray-600">Ad account: {profile.adAccountLabel}</span> : null}
            </button>
          ))}
          {data.profiles.length === 0 ? <p className="m-0 text-[13px] text-gray-500">No profile yet.</p> : null}
        </div>
      </Card>

      {editing ? <DataSourceForm source={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); onToast("Data source saved."); await load(); }} /> : null}
      {profileEditing ? <ProfileForm profile={profileEditing === "new" ? null : profileEditing} sources={data.dataSources} websites={data.websites} onClose={() => setProfileEditing(null)} onSaved={async () => { setProfileEditing(null); onToast("Profile saved."); await load(); }} /> : null}
      {detail ? <DataSourceDetail source={detail} onClose={() => setDetail(null)} onToast={onToast} onChanged={async () => { await load(); }} /> : null}
    </div>
  );
}

function DataSourceForm({ source, onClose, onSaved }: { source: HubDataSource | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const [form, setForm] = useState({
    name: source?.name ?? "", businessName: source?.businessName ?? "", pixelId: source?.pixelId ?? "", accessToken: "",
    adAccounts: (source?.adAccountIds ?? []).join(", "), testEventCode: source?.testEventCode ?? "", isMain: source?.isMain ?? false, status: source?.status ?? "production"
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = async () => {
    setBusy(true);
    setError("");
    try {
      await trackingHubApi.saveDataSource(source?.id ?? null, {
        name: form.name, businessName: form.businessName, pixelId: form.pixelId.trim(), accessToken: form.accessToken.trim() || undefined,
        adAccountIds: form.adAccounts.split(/[\s,]+/).map((value) => value.trim()).filter(Boolean), testEventCode: form.testEventCode.trim(), isMain: form.isMain, status: form.status
      });
      await onSaved();
    } catch (err: any) {
      setError(err?.message ?? "Could not save.");
      setBusy(false);
    }
  };
  return (
    <Modal title={source ? `Edit ${source.name}` : "Connect Meta Dataset"} subtitle="From Meta Events Manager → Data Sources, and Business Settings → System Users." onClose={onClose}>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={labelCls}>Name<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Household Pixel" className={input} /></label>
        <label className={labelCls}>Business / account<input value={form.businessName} onChange={(e) => setForm({ ...form, businessName: e.target.value })} placeholder="Protools Household" className={input} /></label>
        <label className={labelCls}>Dataset / Pixel ID<input value={form.pixelId} onChange={(e) => setForm({ ...form, pixelId: e.target.value })} placeholder="985124764502331" className={`${input} font-mono`} /></label>
        <label className={labelCls}>Test Event Code (optional)<input value={form.testEventCode} onChange={(e) => setForm({ ...form, testEventCode: e.target.value })} placeholder="TEST12345" className={`${input} font-mono`} /></label>
        <label className={`${labelCls} sm:col-span-2`}>Access token (System User, with ads_read)<input type="password" autoComplete="off" value={form.accessToken} onChange={(e) => setForm({ ...form, accessToken: e.target.value })} placeholder={source?.hasToken ? "Token saved — paste to replace" : "Paste from Meta Business Settings"} className={`${input} font-mono`} /></label>
        <label className={`${labelCls} sm:col-span-2`}>Ad account IDs (for Reconciliation)<input value={form.adAccounts} onChange={(e) => setForm({ ...form, adAccounts: e.target.value })} placeholder="act_1234567890, act_9876543210" className={`${input} font-mono`} /></label>
        <label className={labelCls}>Status<select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as HubDataSource["status"] })} className={input}><option value="production">Production</option><option value="testing">Testing (sends to Test Events)</option><option value="paused">Paused</option></select></label>
        <label className="flex items-center gap-2 pt-6 text-[13px] font-semibold text-gray-700"><input type="checkbox" checked={form.isMain} onChange={(e) => setForm({ ...form, isMain: e.target.checked })} /> Main dataset</label>
      </div>
      {error ? <p className="m-0 mt-3 text-[13px] font-semibold text-rose-700">{error}</p> : null}
      <div className="mt-4 flex justify-end gap-2"><button type="button" className={lightButton} onClick={onClose}>Cancel</button><button type="button" className={darkButton} disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : "Save"}</button></div>
    </Modal>
  );
}

function ProfileForm({ profile, sources, websites, onClose, onSaved }: { profile: HubProfile | null; sources: HubDataSource[]; websites: Array<{ id: string; domain: string }>; onClose: () => void; onSaved: () => Promise<void> }) {
  const [form, setForm] = useState({ name: profile?.name ?? "", dataSourceId: profile?.dataSourceId ?? "", defaultWebsiteId: profile?.defaultWebsiteId ?? "", strategy: profile?.strategy ?? "browser_capi", adAccountLabel: profile?.adAccountLabel ?? "", status: profile?.status ?? "production" });
  const [error, setError] = useState("");
  return (
    <Modal title={profile ? `Edit ${profile.name}` : "New tracking profile"} onClose={onClose}>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={`${labelCls} sm:col-span-2`}>Name<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Household products — Meta" className={input} /></label>
        <label className={labelCls}>Dataset<select value={form.dataSourceId} onChange={(e) => setForm({ ...form, dataSourceId: e.target.value })} className={input}><option value="">Choose…</option>{sources.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
        <label className={labelCls}>Default website<select value={form.defaultWebsiteId} onChange={(e) => setForm({ ...form, defaultWebsiteId: e.target.value })} className={input}><option value="">None</option>{websites.map((row) => <option key={row.id} value={row.id}>{row.domain}</option>)}</select></label>
        <label className={labelCls}>Purchase strategy<select value={form.strategy} onChange={(e) => setForm({ ...form, strategy: e.target.value as HubStrategy })} className={input}><option value="browser_capi">Browser + CAPI</option><option value="capi_only">CAPI only</option><option value="landing_page">Thank-you page Pixel</option></select></label>
        <label className={labelCls}>Ad account (label)<input value={form.adAccountLabel} onChange={(e) => setForm({ ...form, adAccountLabel: e.target.value })} placeholder="Household Ads" className={input} /></label>
        <label className={labelCls}>Status<select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as HubProfile["status"] })} className={input}><option value="production">Production</option><option value="testing">Testing</option></select></label>
      </div>
      {error ? <p className="m-0 mt-3 text-[13px] font-semibold text-rose-700">{error}</p> : null}
      <div className="mt-4 flex justify-between gap-2">
        {profile ? <button type="button" className={`${lightButton} !text-rose-700`} onClick={async () => { if (!window.confirm("Delete this profile?")) return; await trackingHubApi.deleteProfile(profile.id); await onSaved(); }}>Delete</button> : <span />}
        <span className="flex gap-2"><button type="button" className={lightButton} onClick={onClose}>Cancel</button>
          <button type="button" className={darkButton} onClick={async () => { try { await trackingHubApi.saveProfile(profile?.id ?? null, { ...form, dataSourceId: form.dataSourceId || null, defaultWebsiteId: form.defaultWebsiteId || null }); await onSaved(); } catch (err: any) { setError(err?.message ?? "Could not save."); } }}>Save</button></span>
      </div>
    </Modal>
  );
}

function DataSourceDetail({ source, onClose, onToast, onChanged }: { source: HubDataSource; onClose: () => void; onToast: (message: string) => void; onChanged: () => Promise<void> }) {
  const [busy, setBusy] = useState("");
  const [current, setCurrent] = useState(source);
  const [test, setTest] = useState<Awaited<ReturnType<typeof trackingHubApi.testDataSource>> | null>(null);
  const [tone, text] = sourceTone(current);
  const counts = current.metaStats?.counts ?? {};
  return (
    <Modal title={current.name.toUpperCase()} subtitle={current.businessName} onClose={onClose}>
      <dl className="m-0 grid grid-cols-[150px_1fr] gap-y-2 text-[13px]">
        <dt className="text-gray-500">Meta Dataset ID</dt><dd className="m-0 font-mono">{current.pixelId}</dd>
        <dt className="text-gray-500">Business</dt><dd className="m-0">{current.businessName || "—"}</dd>
        <dt className="text-gray-500">Connection</dt><dd className="m-0"><StatusPill tone={tone}>{text}</StatusPill></dd>
        <dt className="text-gray-500">Conversions API</dt><dd className="m-0">{current.hasToken ? "Token saved" : "No token"}</dd>
        <dt className="text-gray-500">Last check</dt><dd className="m-0">{current.lastCheckAt ? `${ago(current.lastCheckAt)} — ${current.lastCheckMessage ?? ""}` : "Never"}</dd>
        {test?.lastFiredAt ? <><dt className="text-gray-500">Last event in Meta</dt><dd className="m-0">{ago(test.lastFiredAt)}</dd></> : null}
      </dl>
      <div className="mt-4 rounded-lg border border-gray-200 p-3 dark:border-slate-700">
        <p className="m-0 text-[11px] font-black uppercase tracking-wide text-gray-500">Events (Meta, last 7 days)</p>
        {Object.keys(counts).length === 0 ? <p className="m-0 mt-1 text-[13px] text-gray-500">Not loaded yet.</p> : (
          <ul className="m-0 mt-1 list-none space-y-0.5 p-0 text-[13px]">{Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([name, count]) => <li key={name} className="flex justify-between"><span>{name}</span><strong>{nf(count)}</strong></li>)}</ul>
        )}
        {current.metaStatsAt ? <p className="m-0 mt-1 text-[11px] text-gray-400">Loaded {ago(current.metaStatsAt)}</p> : null}
      </div>
      <p className="m-0 mt-3 text-[12px] text-gray-500">Event Match Quality is shown in Meta Events Manager → this dataset → Overview.</p>
      {test && !test.ok && test.human ? <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-[13px] text-rose-800"><strong className="block">{test.human.title}</strong>{test.human.action}</div> : null}
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <button type="button" className={lightButton} disabled={Boolean(busy)} onClick={async () => {
          setBusy("refresh");
          try { const r = await trackingHubApi.refreshDataSource(current.id); setCurrent({ ...current, metaStats: r.metaStats, metaStatsAt: new Date().toISOString() }); await onChanged(); } catch (err: any) { onToast(err?.message ?? "Could not read Meta."); } finally { setBusy(""); }
        }}><RefreshCw className="h-3.5 w-3.5" /> {busy === "refresh" ? "Loading…" : "Refresh from Meta"}</button>
        <button type="button" className={darkButton} disabled={Boolean(busy)} onClick={async () => {
          setBusy("test");
          try { const r = await trackingHubApi.testDataSource(current.id); setTest(r); setCurrent({ ...current, lastCheckOk: r.ok, lastCheckAt: new Date().toISOString(), lastCheckMessage: r.message, health: r.ok ? (current.status === "testing" ? "testing" : "healthy") : "error" }); onToast(r.ok ? r.message : r.human?.title ?? r.message); await onChanged(); } catch (err: any) { onToast(err?.message ?? "Test failed."); } finally { setBusy(""); }
        }}>{busy === "test" ? "Testing…" : "Test Connection"}</button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- websites

function WebsitesTab({ onToast }: { onToast: (message: string) => void }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof trackingHubApi.websites>> | null>(null);
  const [editing, setEditing] = useState<HubWebsite | { domain: string } | null>(null);
  const [detail, setDetail] = useState<HubWebsite | null>(null);
  const load = () => trackingHubApi.websites().then(setData).catch((err: any) => onToast(err?.message ?? "Could not load."));
  useEffect(() => { void load(); }, []);
  if (!data) return <Card className="p-10 text-center text-sm text-gray-500">Loading…</Card>;
  return (
    <div className="space-y-5">
      {data.detected.length > 0 ? (
        <Card className="border-blue-200 bg-blue-50/50 p-4">
          <p className="m-0 text-[13px] font-bold text-blue-900">Found in your orders (last 30 days), not added yet:</p>
          <div className="mt-2 flex flex-wrap gap-2">{data.detected.map((row) => <button key={row.domain} type="button" className={lightButton} onClick={() => setEditing({ domain: row.domain })}><Plus className="h-3.5 w-3.5" />{row.domain} · {row.orders30d} orders</button>)}</div>
        </Card>
      ) : null}
      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div><h2 className="m-0 text-[17px] font-black text-gray-900 dark:text-slate-100">Websites</h2><p className="m-0 mt-0.5 text-[13px] text-gray-500">Which data source each site should use, and whether its browser Pixel is reporting.</p></div>
          <button type="button" className={darkButton} onClick={() => setEditing({ domain: "" })}><Plus className="h-4 w-4" /> Add Website</button>
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="!min-w-[720px] w-full text-left text-[13px]">
            <thead><tr className="text-[12px] text-gray-500"><th className="py-2 font-semibold">Website</th><th className="py-2 font-semibold">Platform</th><th className="py-2 font-semibold">Data Source</th><th className="py-2 font-semibold">Forms</th><th className="py-2 font-semibold">Orders (7d)</th><th className="py-2 font-semibold">Health</th><th /></tr></thead>
            <tbody>
              {data.websites.map((site) => (
                <tr key={site.id} className="cursor-pointer border-t border-gray-100 text-gray-800 hover:bg-gray-50 dark:border-slate-800 dark:text-slate-200 dark:hover:bg-slate-800/40 [&>td]:[color:inherit]" onClick={() => setDetail(site)}>
                  <td className="py-2.5"><span className="flex items-center gap-2"><WordPressIcon />{site.domain}</span></td>
                  <td className="py-2.5 text-gray-600">{site.platform}</td>
                  <td className="py-2.5 text-gray-600">{site.dataSourceName ?? "—"}</td>
                  <td className="py-2.5 text-gray-600">{site.forms}</td>
                  <td className="py-2.5 text-gray-600">{site.orders7d}</td>
                  <td className="py-2.5" title={site.problems.join(" · ")}><StatusPill tone={site.status === "healthy" ? "green" : "orange"}>{site.status === "healthy" ? "Healthy" : "Review"}</StatusPill></td>
                  <td className="py-2.5 text-right" onClick={(event) => event.stopPropagation()}><ActionMenu items={[{ label: "Edit", onClick: () => setEditing(site) }, { label: "Delete", danger: true, onClick: async () => { if (!window.confirm(`Delete ${site.domain}?`)) return; await trackingHubApi.deleteWebsite(site.id); await load(); } }]} /></td>
                </tr>
              ))}
              {data.websites.length === 0 ? <tr><td colSpan={7} className="py-8 text-center text-gray-500">No website added yet.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </Card>
      {editing ? <WebsiteForm site={editing} sources={data.dataSources} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); onToast("Website saved."); await load(); }} /> : null}
      {detail ? (
        <Modal title="Website Details" subtitle={detail.domain} onClose={() => setDetail(null)}>
          <dl className="m-0 grid grid-cols-[170px_1fr] gap-y-2 text-[13px]">
            <dt className="text-gray-500">Domain</dt><dd className="m-0">{detail.domain}</dd>
            <dt className="text-gray-500">Platform</dt><dd className="m-0">{detail.platform}</dd>
            <dt className="text-gray-500">Default Data Source</dt><dd className="m-0">{detail.dataSourceName ?? "—"}</dd>
            <dt className="text-gray-500">Protohub External Forms</dt><dd className="m-0">{detail.forms} active</dd>
            <dt className="text-gray-500">Landing Pages</dt><dd className="m-0">{detail.landingPages.length} detected{detail.landingPages.length ? `: ${detail.landingPages.slice(0, 6).join(", ")}` : ""}</dd>
            <dt className="text-gray-500">Browser Pixel</dt><dd className="m-0">{detail.lastBrowserEvent ? <StatusPill tone="green">Detected</StatusPill> : <StatusPill tone="orange">Not reported yet</StatusPill>}</dd>
            <dt className="text-gray-500">Duplicate Pixel</dt><dd className="m-0">{detail.duplicatePixel ? <StatusPill tone="red">More than one Pixel on the page</StatusPill> : "✓ None detected"}</dd>
            <dt className="text-gray-500">Last event</dt><dd className="m-0">{detail.lastBrowserEvent ? ago(detail.lastBrowserEvent) : "—"}</dd>
          </dl>
          {detail.problems.length ? <ul className="m-0 mt-3 list-disc pl-5 text-[13px] text-amber-800">{detail.problems.map((problem) => <li key={problem}>{problem}</li>)}</ul> : null}
        </Modal>
      ) : null}
    </div>
  );
}

function WebsiteForm({ site, sources, onClose, onSaved }: { site: HubWebsite | { domain: string }; sources: Array<{ id: string; name: string }>; onClose: () => void; onSaved: () => Promise<void> }) {
  const existing = "id" in site ? site : null;
  const [form, setForm] = useState({ domain: site.domain, platform: existing?.platform ?? "WordPress", dataSourceId: existing?.dataSourceId ?? "", notes: existing?.notes ?? "" });
  const [error, setError] = useState("");
  return (
    <Modal title={existing ? `Edit ${existing.domain}` : "Add Website"} onClose={onClose}>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={`${labelCls} sm:col-span-2`}>Domain<input value={form.domain} onChange={(e) => setForm({ ...form, domain: e.target.value })} placeholder="brightpathhubs.com" className={input} /></label>
        <label className={labelCls}>Platform<select value={form.platform} onChange={(e) => setForm({ ...form, platform: e.target.value })} className={input}><option>WordPress</option><option>Shopify</option><option>Custom</option><option>Other</option></select></label>
        <label className={labelCls}>Default data source<select value={form.dataSourceId} onChange={(e) => setForm({ ...form, dataSourceId: e.target.value })} className={input}><option value="">Choose…</option>{sources.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
        <label className={`${labelCls} sm:col-span-2`}>Notes<input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className={input} /></label>
      </div>
      {error ? <p className="m-0 mt-3 text-[13px] font-semibold text-rose-700">{error}</p> : null}
      <div className="mt-4 flex justify-end gap-2"><button type="button" className={lightButton} onClick={onClose}>Cancel</button>
        <button type="button" className={darkButton} onClick={async () => { try { await trackingHubApi.saveWebsite(existing?.id ?? null, { ...form, dataSourceId: form.dataSourceId || null, notes: form.notes || null }); await onSaved(); } catch (err: any) { setError(err?.message ?? "Could not save."); } }}>Save</button></div>
    </Modal>
  );
}

// ----------------------------------------------------------- tracking links

const ATTRIBUTION_LIST = ["fbclid", "fbp", "fbc", "campaign_id", "adset_id", "ad_id", "utm_source", "utm_campaign", "utm_content"];

function embedUrlFor(link: HubLink) {
  const params = new URLSearchParams();
  if (link.productId) params.set("product", link.productId);
  if (link.redirectUrl) params.set("redirect_url", link.redirectUrl);
  if (link.strategy !== "landing_page" && link.strategy !== "off") {
    params.set("tracking_mode", link.strategy === "capi_only" ? "protohub" : "hybrid");
    if (link.pixelId) params.set("meta_pixel_id", link.pixelId);
    params.set("meta_tracking_key", link.trackingKey);
    if (link.testEventCode) { params.set("meta_test", "1"); params.set("meta_test_event_code", link.testEventCode); }
  } else {
    params.set("meta_tracking_key", link.trackingKey);
  }
  params.set("embed_label", link.formLabel || link.label);
  return `${window.location.origin}${window.location.pathname}#/order-form/embed?${params.toString()}`;
}

function LinksTab({ onToast, createSignal }: { onToast: (message: string) => void; createSignal: number }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof trackingHubApi.links>> | null>(null);
  const [filters, setFilters] = useState({ q: "", productId: "", websiteId: "", dataSourceId: "" });
  const [open, setOpen] = useState<HubLink | "new" | null>(null);
  const load = () => trackingHubApi.links().then(setData).catch((err: any) => onToast(err?.message ?? "Could not load."));
  useEffect(() => { void load(); }, []);
  useEffect(() => { if (createSignal > 0) setOpen("new"); }, [createSignal]);
  const rows = useMemo(() => (data?.links ?? []).filter((link) =>
    (!filters.q || `${link.label} ${link.landingPageUrl} ${link.productName ?? ""}`.toLowerCase().includes(filters.q.toLowerCase()))
    && (!filters.productId || link.productId === filters.productId)
    && (!filters.websiteId || link.websiteId === filters.websiteId)
    && (!filters.dataSourceId || link.dataSourceId === filters.dataSourceId)), [data, filters]);
  if (!data) return <Card className="p-10 text-center text-sm text-gray-500">Loading…</Card>;
  const current = open === "new" ? null : open ? data.links.find((link) => link.id === open.id) ?? open : null;
  return (
    <div className="space-y-5">
      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div><h2 className="m-0 text-[17px] font-black text-gray-900 dark:text-slate-100">Tracking Links</h2><p className="m-0 mt-0.5 text-[13px] text-gray-500">Landing page + form + data source = one tracking configuration. Campaigns are captured automatically from the ad's URL parameters.</p></div>
          <button type="button" className={darkButton} onClick={() => setOpen("new")}><Plus className="h-4 w-4" /> Create Tracking Link</button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <label className="relative"><Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" /><input value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} placeholder="Search" className="h-9 rounded-lg border border-gray-200 pl-8 pr-3 text-[13px] dark:border-slate-700 dark:bg-slate-900" /></label>
          <select value={filters.productId} onChange={(e) => setFilters({ ...filters, productId: e.target.value })} className="!min-h-0 h-9 rounded-lg border border-gray-200 px-2 text-[13px] dark:border-slate-700 dark:bg-slate-900"><option value="">Product</option>{data.products.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select>
          <select value={filters.websiteId} onChange={(e) => setFilters({ ...filters, websiteId: e.target.value })} className="!min-h-0 h-9 rounded-lg border border-gray-200 px-2 text-[13px] dark:border-slate-700 dark:bg-slate-900"><option value="">Website</option>{data.websites.map((row) => <option key={row.id} value={row.id}>{row.domain}</option>)}</select>
          <select value={filters.dataSourceId} onChange={(e) => setFilters({ ...filters, dataSourceId: e.target.value })} className="!min-h-0 h-9 rounded-lg border border-gray-200 px-2 text-[13px] dark:border-slate-700 dark:bg-slate-900"><option value="">Data Source</option>{data.dataSources.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select>
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="!min-w-[760px] w-full text-left text-[13px]">
            <thead><tr className="text-[12px] text-gray-500"><th className="py-2 font-semibold">Landing Page</th><th className="py-2 font-semibold">Product</th><th className="py-2 font-semibold">Pixel</th><th className="py-2 font-semibold">Strategy</th><th className="py-2 font-semibold">Orders (30d)</th><th className="py-2 font-semibold">Health</th></tr></thead>
            <tbody>
              {rows.map((link) => (
                <tr key={link.id} className="cursor-pointer border-t border-gray-100 text-gray-800 hover:bg-gray-50 dark:border-slate-800 dark:text-slate-200 dark:hover:bg-slate-800/40 [&>td]:[color:inherit]" onClick={() => setOpen(link)}>
                  <td className="py-2.5"><strong className="block">{link.landingPath ?? link.label}</strong><span className="text-[11px] text-gray-500">{link.websiteDomain ?? link.label}</span></td>
                  <td className="py-2.5 text-gray-600">{link.productName ?? "—"}</td>
                  <td className="py-2.5 text-gray-600">{link.dataSourceName ?? "—"}</td>
                  <td className="py-2.5 text-gray-600">{STRATEGY_LABEL[link.strategy]}</td>
                  <td className="py-2.5 text-gray-600">{link.orders30d}</td>
                  <td className="py-2.5" title={link.problems.join(" · ")}><StatusPill tone={link.healthy ? "green" : "orange"}>{link.healthy ? "Healthy" : link.problems[0] ?? "Review"}</StatusPill></td>
                </tr>
              ))}
              {rows.length === 0 ? <tr><td colSpan={6} className="py-8 text-center text-gray-500">No tracking link yet.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </Card>
      {open ? <LinkEditor link={current} meta={data} onClose={() => setOpen(null)} onToast={onToast} onSaved={async () => { await load(); }} /> : null}
    </div>
  );
}

function LinkEditor({ link, meta, onClose, onToast, onSaved }: { link: HubLink | null; meta: Awaited<ReturnType<typeof trackingHubApi.links>>; onClose: () => void; onToast: (message: string) => void; onSaved: () => Promise<void> }) {
  const [form, setForm] = useState({
    label: link?.label ?? "", productId: link?.productId ?? "", websiteId: link?.websiteId ?? "", profileId: link?.profileId ?? "",
    dataSourceId: link?.dataSourceId ?? "", strategy: (link?.strategy && link.strategy !== "off" ? link.strategy : meta.defaultStrategy) as HubStrategy,
    landingPageUrl: link?.landingPageUrl ?? "", redirectUrl: link?.redirectUrl ?? "", formLabel: link?.formLabel ?? "", active: link?.active ?? true
  });
  const [checklist, setChecklist] = useState({ thankYouPixelRemoved: Boolean(link?.checklist?.thankYouPixelRemoved), testEventSeen: Boolean(link?.checklist?.testEventSeen) });
  const [saved, setSaved] = useState<HubLink | null>(link);
  const [error, setError] = useState("");
  const applyProfile = (profileId: string) => {
    const profile = meta.profiles.find((row) => row.id === profileId);
    setForm((current) => ({ ...current, profileId, dataSourceId: profile?.dataSourceId ?? current.dataSourceId, websiteId: profile?.defaultWebsiteId ?? current.websiteId, strategy: profile?.strategy ?? current.strategy }));
  };
  const save = async () => {
    setError("");
    try {
      const result = await trackingHubApi.saveLink(saved?.id ?? null, { ...form, productId: form.productId || null, websiteId: form.websiteId || null, profileId: form.profileId || null, dataSourceId: form.dataSourceId || null });
      await onSaved();
      const fresh = (await trackingHubApi.links()).links.find((row) => row.id === result.id) ?? null;
      setSaved(fresh);
      onToast("Tracking link saved.");
    } catch (err: any) {
      setError(err?.message ?? "Could not save.");
    }
  };
  const code = saved ? buildEmbedSnippet(embedUrlFor(saved), `${saved.productName ?? saved.label} Order Form`) : "";
  const needsChecklist = form.strategy !== "landing_page";
  return (
    <Modal title={saved ? (saved.productName ?? saved.label).toUpperCase() : "Create Tracking Link"} subtitle={saved ? saved.label : "One link per landing page and form."} onClose={onClose} wide>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={`${labelCls} sm:col-span-2`}>Name<input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="Shelf — brightpathhubs.com/shelf" className={input} /></label>
            <label className={labelCls}>Product<select value={form.productId} onChange={(e) => setForm({ ...form, productId: e.target.value })} className={input}><option value="">Choose…</option>{meta.products.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
            <label className={labelCls}>Tracking profile<select value={form.profileId} onChange={(e) => applyProfile(e.target.value)} className={input}><option value="">None</option>{meta.profiles.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
            <label className={labelCls}>Website<select value={form.websiteId} onChange={(e) => setForm({ ...form, websiteId: e.target.value })} className={input}><option value="">Choose…</option>{meta.websites.map((row) => <option key={row.id} value={row.id}>{row.domain}</option>)}</select></label>
            <label className={labelCls}>Meta data source<select value={form.dataSourceId} onChange={(e) => setForm({ ...form, dataSourceId: e.target.value })} className={input}><option value="">From profile / website</option>{meta.dataSources.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
            <label className={labelCls}>Landing page URL<input value={form.landingPageUrl} onChange={(e) => setForm({ ...form, landingPageUrl: e.target.value })} placeholder="https://brightpathhubs.com/shelf/" className={input} /></label>
            <label className={labelCls}>Thank-you page URL<input value={form.redirectUrl} onChange={(e) => setForm({ ...form, redirectUrl: e.target.value })} placeholder="https://brightpathhubs.com/order-success/" className={input} /></label>
            <label className={labelCls}>Form name<input value={form.formLabel} onChange={(e) => setForm({ ...form, formLabel: e.target.value })} placeholder="Shelf External Form V4" className={input} /></label>
            <label className={labelCls}>Purchase strategy<select value={form.strategy} onChange={(e) => setForm({ ...form, strategy: e.target.value as HubStrategy })} className={input}><option value="browser_capi">Browser + CAPI (Protohub fires Purchase)</option><option value="capi_only">CAPI only</option><option value="landing_page">Thank-you page Pixel (Protohub sends nothing)</option></select></label>
          </div>
          {error ? <p className="m-0 text-[13px] font-semibold text-rose-700">{error}</p> : null}
          <div className="flex justify-between gap-2">
            {saved ? <button type="button" className={`${lightButton} !text-rose-700`} onClick={async () => { if (!window.confirm("Delete this link? Pages using its code keep working but lose server tracking.")) return; await trackingHubApi.deleteLink(saved.id); await onSaved(); onClose(); }}>Delete</button> : <span />}
            <button type="button" className={darkButton} onClick={() => void save()}>{saved ? "Save changes" : "Create link"}</button>
          </div>

          {saved ? (
            <div className="space-y-3 border-t border-gray-100 pt-4 dark:border-slate-800">
              {needsChecklist ? (
                <div className={`rounded-xl border p-4 ${checklist.thankYouPixelRemoved && checklist.testEventSeen ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}>
                  <p className="m-0 text-[13px] font-black text-gray-900">Go-live checklist</p>
                  <p className="m-0 mt-0.5 text-[12px] text-gray-600">Protohub now fires Purchase. Do both before the code goes on the live page, or orders count twice.</p>
                  <label className="mt-2 flex items-start gap-2 text-[13px]"><input type="checkbox" checked={checklist.thankYouPixelRemoved} onChange={(e) => setChecklist({ ...checklist, thankYouPixelRemoved: e.target.checked })} className="mt-0.5" />I removed the Purchase Pixel code from the thank-you page{saved.redirectUrl ? ` (${saved.redirectUrl})` : ""}.</label>
                  <label className="mt-1 flex items-start gap-2 text-[13px]"><input type="checkbox" checked={checklist.testEventSeen} onChange={(e) => setChecklist({ ...checklist, testEventSeen: e.target.checked })} className="mt-0.5" />I placed a test order and saw ONE Purchase (browser + server) in Meta Test Events.</label>
                  <button type="button" className={`${lightButton} mt-2`} onClick={async () => { try { await trackingHubApi.saveChecklist(saved.id, checklist); await onSaved(); onToast("Checklist saved."); } catch (err: any) { onToast(err?.message ?? "Could not save."); } }}>Save checklist</button>
                  {saved.checklist?.confirmedAt ? <p className="m-0 mt-1 text-[11px] text-gray-500">Last confirmed by {saved.checklist.confirmedBy ?? "—"}, {ago(saved.checklist.confirmedAt)}</p> : null}
                </div>
              ) : null}
              <div>
                <div className="flex items-center justify-between"><p className="m-0 text-[13px] font-black text-gray-900 dark:text-slate-100">Embed code for the landing page</p>
                  <button type="button" className={lightButton} onClick={() => { void navigator.clipboard?.writeText(code); onToast("Embed code copied."); }}><Copy className="h-3.5 w-3.5" /> Copy</button></div>
                <pre className="mt-2 max-h-56 overflow-auto rounded-lg bg-slate-900 p-3 text-[11px] leading-relaxed text-slate-100">{code}</pre>
                <p className="m-0 mt-1 text-[11px] text-gray-500">No token is in this code. It passes the ad ids into the form, fires the browser Pixel with the order id, reports it to Protohub, then opens the thank-you page.</p>
              </div>
            </div>
          ) : null}
        </div>
        <aside className="space-y-3">
          <div className="rounded-xl border border-gray-200 p-4 dark:border-slate-700">
            <p className="m-0 text-[12px] font-black uppercase tracking-wide text-gray-500">Attribution Capture</p>
            <ul className="m-0 mt-2 list-none space-y-1 p-0 text-[13px]">{ATTRIBUTION_LIST.map((item) => <li key={item} className="flex items-center gap-2"><Check className="h-3.5 w-3.5 text-emerald-600" />{item}</li>)}</ul>
          </div>
          {saved ? (
            <div className="rounded-xl border border-gray-200 p-4 text-[12px] dark:border-slate-700">
              <p className="m-0 font-black uppercase tracking-wide text-gray-500">This link</p>
              <p className="m-0 mt-1">Strategy: <strong>{STRATEGY_LABEL[saved.strategy]}</strong></p>
              <p className="m-0">Data source: <strong>{saved.dataSourceName ?? "—"}</strong></p>
              <p className="m-0">Orders (30d): <strong>{saved.orders30d}</strong></p>
              <p className="m-0 break-all text-gray-500">Key: {saved.trackingKey}</p>
              {saved.problems.length ? <ul className="m-0 mt-2 list-disc pl-4 text-amber-800">{saved.problems.map((problem) => <li key={problem}>{problem}</li>)}</ul> : <p className="m-0 mt-2 font-semibold text-emerald-700">✓ Healthy</p>}
            </div>
          ) : null}
        </aside>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------- ledger

function LedgerTab({ range, initial }: { range: { from: string; to: string }; initial: { status?: string; orderIds?: string[] } }) {
  const [status, setStatus] = useState(initial.status ?? "");
  const [q, setQ] = useState("");
  const [only, setOnly] = useState<string[] | null>(initial.orderIds ?? null);
  const [data, setData] = useState<Awaited<ReturnType<typeof trackingHubApi.ledger>> | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    trackingHubApi.ledger({ ...range, status, q }).then((result) => { if (!cancelled) setData(result); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [range.from, range.to, status, q]);
  const rows = (data?.rows ?? []).filter((row) => !only || only.includes(row.orderId));
  return (
    <div className="space-y-4">
      {data ? <LedgerKpis kpis={data.kpis} /> : null}
      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="m-0 text-[17px] font-black text-gray-900 dark:text-slate-100">Purchase Event Ledger</h2>
          <div className="flex flex-wrap gap-2">
            <label className="relative"><Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Order, product, campaign…" className="h-9 rounded-lg border border-gray-200 pl-8 pr-3 text-[13px] dark:border-slate-700 dark:bg-slate-900" /></label>
            <select value={status} onChange={(e) => setStatus(e.target.value)} className="!min-h-0 h-9 rounded-lg border border-gray-200 px-2 text-[13px] dark:border-slate-700 dark:bg-slate-900">
              <option value="">All statuses</option><option value="deduped">Deduped</option><option value="server_only">Server only</option><option value="browser_only">Browser only</option><option value="capi_failed">CAPI failed</option><option value="test">Test</option><option value="not_tracked">Not tracked</option><option value="page_pixel">Thank-you page</option>
            </select>
            {only ? <button type="button" className={lightButton} onClick={() => setOnly(null)}>Showing {only.length} affected · show all</button> : null}
          </div>
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="!min-w-[900px] w-full text-left text-[13px]">
            <thead><tr className="text-[12px] text-gray-500">{["Order", "Product", "Source", "Event ID", "Browser", "CAPI", "Status", "Value", "Time"].map((head) => <th key={head} className="py-2 font-semibold">{head}</th>)}</tr></thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.orderId} className="cursor-pointer border-t border-gray-100 text-gray-800 hover:bg-gray-50 dark:border-slate-800 dark:text-slate-200 dark:hover:bg-slate-800/40 [&>td]:[color:inherit]" onClick={() => setDetail(row.orderId)}>
                  <td className="py-2.5 font-bold">{row.orderId}</td>
                  <td className="py-2.5 text-gray-600">{row.product}</td>
                  <td className="py-2.5 text-gray-600">{row.source ?? "—"}</td>
                  <td className="py-2.5 font-mono text-[12px] text-gray-600">{row.eventId ?? "—"}</td>
                  <td className="py-2.5">{row.browser ? <Check className="h-4 w-4 text-emerald-600" /> : <X className="h-4 w-4 text-gray-400" />}</td>
                  <td className="py-2.5">{row.serverStatus === "sent" || row.serverStatus === "dry_run" ? <Check className="h-4 w-4 text-emerald-600" /> : row.serverStatus ? <AlertTriangle className="h-4 w-4 text-rose-600" /> : <X className="h-4 w-4 text-gray-400" />}</td>
                  <td className="py-2.5"><StatusPill tone={LEDGER_TONE[row.status]}>{row.statusLabel}</StatusPill></td>
                  <td className="py-2.5 text-gray-600">{naira(row.value, row.currency)}</td>
                  <td className="py-2.5 text-gray-600">{shortDay(row.createdAt.slice(0, 10))} {timeOf(row.createdAt)}</td>
                </tr>
              ))}
              {data && rows.length === 0 ? <tr><td colSpan={9} className="py-8 text-center text-gray-500">No form orders match.</td></tr> : null}
            </tbody>
          </table>
          {data && data.total > data.rows.length ? <p className="m-0 mt-2 text-[12px] text-gray-500">Showing the latest {data.rows.length} of {data.total}. Narrow the dates to see the rest.</p> : null}
        </div>
      </Card>
      {detail ? <LedgerDetailModal orderId={detail} onClose={() => setDetail(null)} /> : null}
    </div>
  );
}

function LedgerKpis({ kpis }: { kpis: HubKpis }) {
  const cells = [["Orders", kpis.orders], ["Purchase events", kpis.purchaseEvents], ["Browser", kpis.browserEvents], ["Server (CAPI)", kpis.serverEvents], ["Deduplicated", kpis.deduped], ["Unmatched", kpis.unmatched]] as const;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
      {cells.map(([label, value]) => <Card key={label} className="px-4 py-3"><span className="block text-[12px] font-semibold text-gray-500">{label}</span><strong className="text-xl font-black text-gray-900 dark:text-slate-100">{nf(value)}</strong></Card>)}
    </div>
  );
}

function LedgerDetailModal({ orderId, onClose }: { orderId: string; onClose: () => void }) {
  const [data, setData] = useState<HubLedgerDetail | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { trackingHubApi.ledgerDetail(orderId).then(setData).catch((err: any) => setError(err?.message ?? "Could not load.")); }, [orderId]);
  const row = (label: string, value: ReactNode) => <><dt className="text-gray-500">{label}</dt><dd className="m-0 break-all">{value ?? "—"}</dd></>;
  return (
    <Modal title={`ORDER ${orderId}`} subtitle="Complete tracking trail" onClose={onClose}>
      {error ? <p className="m-0 text-sm text-rose-700">{error}</p> : !data ? <p className="m-0 text-sm text-gray-500">Loading…</p> : (
        <>
          <dl className="m-0 grid grid-cols-[150px_1fr] gap-y-1.5 text-[13px]">
            {row("Order created", `${shortDay(data.createdAt.slice(0, 10))} ${timeOf(data.createdAt)}`)}
            {row("Product", data.product)}
            {row("Value", naira(data.value, data.currency))}
            {row("Landing page", data.landingPage)}
            {row("Campaign ID", data.campaignId)}
            {row("Ad Set ID", data.adsetId)}
            {row("Ad ID", data.adId)}
            {row("fbclid", data.fbclid ? `${data.fbclid.slice(0, 24)}…` : null)}
            {row("_fbp", data.fbp)}
            {row("_fbc", data.fbc ? `${data.fbc.slice(0, 32)}…` : null)}
            {row("UTM", [data.utm.source, data.utm.campaign].filter(Boolean).join(" / ") || null)}
            {row("Device", data.device.deviceType)}
            {row("Tracking", STRATEGY_LABEL[data.trackingMode === "hybrid" ? "browser_capi" : data.trackingMode === "protohub" ? "capi_only" : "landing_page"])}
            {row("Browser Purchase", data.browserEvent ? `${timeOf(data.browserEvent.firedAt)} ✓ (${data.browserEvent.pixelsOnPage.length} Pixel${data.browserEvent.pixelsOnPage.length === 1 ? "" : "s"} on page)` : "Not reported")}
            {row("CAPI Purchase", data.serverEvent ? `${timeOf(data.serverEvent.sentAt)} ${data.serverEvent.status === "sent" ? "✓" : data.serverEvent.status}${data.serverEvent.test ? " (test)" : ""}` : "Not sent")}
            {row("Event ID", data.eventId)}
            {row("Delivered event", data.deliveredEvent ? `${data.deliveredEvent.metaEventName} · ${data.deliveredEvent.status}` : data.deliveredDate ? "Not sent" : "Not delivered yet")}
          </dl>
          <div className={`mt-4 rounded-lg px-3 py-2 text-[14px] font-black ${LEDGER_TONE[data.status] === "green" ? "bg-emerald-50 text-emerald-800" : LEDGER_TONE[data.status] === "red" ? "bg-rose-50 text-rose-800" : "bg-gray-50 text-gray-800"}`}>Final status: {data.statusLabel.toUpperCase()}</div>
          {data.serverEvent?.human ? <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-[13px] text-rose-800"><strong className="block">{data.serverEvent.human.title}</strong>{data.serverEvent.human.action}</div> : null}
        </>
      )}
    </Modal>
  );
}

// ------------------------------------------------------------ reconciliation

function ReconciliationTab({ range, onToast }: { range: { from: string; to: string }; onToast: (message: string) => void }) {
  const [data, setData] = useState<HubReconciliation | null>(null);
  const [busy, setBusy] = useState(false);
  const [why, setWhy] = useState<HubReconciliation["campaigns"][number] | null>(null);
  const load = () => trackingHubApi.reconciliation(range).then(setData).catch((err: any) => onToast(err?.message ?? "Could not load."));
  useEffect(() => { void load(); }, [range.from, range.to]);
  const refresh = async () => {
    setBusy(true);
    try {
      const result = await trackingHubApi.refreshReconciliation(range);
      const failed = result.report.filter((row) => !row.ok);
      onToast(failed.length ? `${failed[0].source}: ${failed[0].message}` : `Loaded Meta's numbers for ${result.report.length} ad account${result.report.length === 1 ? "" : "s"}.`);
      await load();
    } catch (err: any) {
      onToast(err?.message ?? "Could not read Meta.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="m-0 text-[17px] font-black text-gray-900 dark:text-slate-100">Meta vs Protohub · {range.from === range.to ? longDay(range.from) : `${longDay(range.from)} – ${longDay(range.to)}`}</h2>
            <p className="m-0 mt-0.5 text-[13px] text-gray-500">Protohub orders carry the campaign id; Meta applies its own attribution. A difference starts an investigation — it is not automatically a Pixel error.</p>
          </div>
          <button type="button" className={darkButton} disabled={busy} onClick={() => void refresh()}><RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} /> {busy ? "Reading Meta…" : "Refresh from Meta"}</button>
        </div>
        {data?.lastFetched ? <p className="m-0 mt-1 text-[11px] text-gray-400">Meta's numbers loaded {ago(data.lastFetched)}</p> : data ? <p className="m-0 mt-1 text-[12px] text-amber-700">{data.sources.some((row) => row.hasToken && row.adAccounts > 0) ? "Press Refresh from Meta to load Meta's purchases." : "Add a token and ad account IDs to a data source to load Meta's purchases."}</p> : null}
        <div className="mt-3 overflow-x-auto">
          <table className="!min-w-[700px] w-full text-left text-[13px]">
            <thead><tr className="text-[12px] text-gray-500"><th className="py-2 font-semibold">Campaign</th><th className="py-2 font-semibold">Protohub</th><th className="py-2 font-semibold">Meta</th><th className="py-2 font-semibold">Difference</th><th /></tr></thead>
            <tbody>
              {(data?.campaigns ?? []).map((row) => (
                <tr key={row.campaignId} className="cursor-pointer border-t border-gray-100 text-gray-800 hover:bg-gray-50 dark:border-slate-800 dark:text-slate-200 dark:hover:bg-slate-800/40 [&>td]:[color:inherit]" onClick={() => setWhy(row)}>
                  <td className="py-2.5"><strong className="block">{row.campaignName || row.campaignId}</strong>{row.campaignName ? <span className="font-mono text-[11px] text-gray-500">{row.campaignId}</span> : null}</td>
                  <td className="py-2.5">{row.protohubOrders}</td>
                  <td className="py-2.5">{row.metaPurchases ?? "—"}</td>
                  <td className="py-2.5 font-bold">{row.difference === null ? "—" : `${row.difference > 0 ? "+" : ""}${row.difference}`}</td>
                  <td className="py-2.5">{row.verdict.tone === "ok" ? <CheckCircle2 className="h-5 w-5 fill-emerald-500 text-white" /> : row.verdict.tone === "warn" ? <span className="inline-block h-3 w-3 rounded-full bg-rose-500" /> : <span className="text-[12px] text-gray-400">?</span>}</td>
                </tr>
              ))}
              {data && data.campaigns.length === 0 ? <tr><td colSpan={5} className="py-8 text-center text-gray-500">No campaigns in this period.</td></tr> : null}
            </tbody>
          </table>
          {data && data.noCampaign > 0 ? <p className="m-0 mt-2 text-[12px] text-gray-500">{data.noCampaign} order{data.noCampaign === 1 ? "" : "s"} carried no campaign id (direct, organic or lost parameters).</p> : null}
        </div>
      </Card>
      {why ? (
        <Modal title="Why are these different?" subtitle={why.campaignName || why.campaignId} onClose={() => setWhy(null)}>
          <dl className="m-0 grid grid-cols-[1fr_auto] gap-y-1.5 text-[14px]">
            <dt>Protohub orders</dt><dd className="m-0 font-bold">{why.protohubOrders}</dd>
            <dt>Unique Protohub Purchase events</dt><dd className="m-0 font-bold">{why.purchaseEvents}</dd>
            <dt>Successfully sent to Meta</dt><dd className="m-0 font-bold">{why.sentToMeta}</dd>
            <dt>Duplicate events</dt><dd className="m-0 font-bold">{why.duplicates}</dd>
            <dt>Meta attributed purchases</dt><dd className="m-0 font-bold">{why.metaPurchases ?? "—"}</dd>
          </dl>
          <div className={`mt-4 rounded-lg p-3 text-[13px] ${why.verdict.tone === "ok" ? "bg-emerald-50 text-emerald-900" : why.verdict.tone === "warn" ? "bg-amber-50 text-amber-900" : "bg-gray-50 text-gray-800"}`}>
            <strong className="block">Conclusion:</strong>{why.verdict.conclusion}
            <strong className="mt-2 block">Likely area:</strong>{why.verdict.likely}
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- diagnostics

function DiagnosticsTab({ onTab, onOpenLedger }: { onTab: (tab: Tab) => void; onOpenLedger: (filter: { orderIds?: string[] }) => void }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof trackingHubApi.diagnostics>> | null>(null);
  useEffect(() => { trackingHubApi.diagnostics().then(setData).catch(() => undefined); }, []);
  if (!data) return <Card className="p-10 text-center text-sm text-gray-500">Running diagnostics…</Card>;
  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
      <Card className="p-5">
        <h2 className="m-0 text-[17px] font-black text-gray-900 dark:text-slate-100">Tracking Health</h2>
        <div className="mt-3 flex justify-center"><HealthRing score={data.score} /></div>
        <ul className="m-0 mt-4 list-none space-y-2 p-0 text-[13px]">
          {data.checks.map((check) => <li key={check.text} className="flex items-center gap-2">{check.ok ? <CheckCircle2 className="h-4 w-4 fill-emerald-500 text-white" /> : <AlertTriangle className="h-4 w-4 text-amber-500" />}{check.text}</li>)}
        </ul>
        <ul className="m-0 mt-4 list-none space-y-1 border-t border-gray-100 p-0 pt-3 text-[12px] text-gray-600 dark:border-slate-800">
          {data.items.map((item) => <li key={item.key} className="flex justify-between"><span>{item.label}</span><span>{item.key === "dedup" || item.key === "capi" ? item.detail : `${item.healthy}/${item.total} healthy`}</span></li>)}
        </ul>
      </Card>
      <Card className="p-5">
        <h2 className="m-0 text-[17px] font-black text-gray-900 dark:text-slate-100">Issues {data.issues.length ? <span className="ml-1 rounded-full bg-rose-50 px-2 py-0.5 text-[12px] text-rose-600">{data.issues.length}</span> : null}</h2>
        <ul className="m-0 mt-3 list-none space-y-3 p-0">
          {data.issues.map((issue, index) => (
            <li key={index} className="flex gap-3 rounded-xl border border-gray-200 p-4 dark:border-slate-700">
              <span className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md ${ISSUE_TONE[issue.severity]} text-white`}><AlertTriangle className="h-3 w-3" /></span>
              <div className="min-w-0 flex-1">
                <p className="m-0 text-[14px] font-black text-gray-900 dark:text-slate-100">{issue.title}</p>
                <p className="m-0 mt-0.5 text-[13px] text-gray-600 dark:text-slate-300">{issue.detail}</p>
                <p className="m-0 mt-1 text-[12px] text-gray-500">{issue.action}</p>
                <div className="mt-2 flex gap-2">
                  {issue.orderIds?.length ? <button type="button" className={lightButton} onClick={() => onOpenLedger({ orderIds: issue.orderIds })}>View affected orders</button> : null}
                  <button type="button" className={lightButton} onClick={() => onTab(issue.tab as Tab)}>{issue.tab === "sources" ? "Open Data Sources" : issue.tab === "websites" ? "Open Websites" : issue.tab === "links" ? "Open Tracking Links" : issue.tab === "reconciliation" ? "Open Reconciliation" : issue.tab === "settings" ? "Open Settings" : "Open"}</button>
                </div>
              </div>
              {issue.at ? <span className="shrink-0 text-[11px] text-gray-400">{ago(issue.at)}</span> : null}
            </li>
          ))}
          {data.issues.length === 0 ? <li className="py-8 text-center text-[14px] text-gray-500"><CheckCircle2 className="mx-auto mb-2 h-8 w-8 fill-emerald-500 text-white" />No issues found.</li> : null}
        </ul>
      </Card>
    </div>
  );
}

// ------------------------------------------------------------------ settings

function SettingsTab({ onToast, renderMetaDefaults }: { onToast: (message: string) => void; renderMetaDefaults?: () => ReactNode }) {
  const [settings, setSettings] = useState<HubSettings | null>(null);
  useEffect(() => { trackingHubApi.settings().then((result) => setSettings(result.settings)).catch(() => undefined); }, []);
  if (!settings) return <Card className="p-10 text-center text-sm text-gray-500">Loading…</Card>;
  return (
    <div className="space-y-5">
      <Card className="p-5">
        <h2 className="m-0 text-[17px] font-black text-gray-900 dark:text-slate-100">Purchase Tracking Rule</h2>
        <dl className="m-0 mt-3 grid max-w-2xl grid-cols-[200px_1fr] gap-y-2 text-[14px]">
          <dt className="text-gray-500">When</dt><dd className="m-0 font-semibold">Order created successfully</dd>
          <dt className="text-gray-500">Send (default for new links)</dt>
          <dd className="m-0"><select value={settings.defaultStrategy} onChange={(e) => setSettings({ ...settings, defaultStrategy: e.target.value as HubStrategy })} className="!min-h-0 rounded-lg border border-gray-200 px-2 py-1.5 text-[13px] dark:border-slate-700 dark:bg-slate-900"><option value="browser_capi">✓ Meta Browser Purchase + ✓ Meta CAPI Purchase</option><option value="capi_only">✓ Meta CAPI Purchase only</option><option value="landing_page">Thank-you page Pixel (Protohub sends nothing)</option></select></dd>
          <dt className="text-gray-500">Event ID</dt><dd className="m-0 font-semibold">Protohub Order ID</dd>
          <dt className="text-gray-500">Value</dt><dd className="m-0 font-semibold">Order Total</dd>
          <dt className="text-gray-500">Currency</dt><dd className="m-0 font-semibold">The order's currency (NGN)</dd>
          <dt className="text-gray-500">Duplicate Protection</dt><dd className="m-0 font-semibold">STRICT — one Purchase per order, ever</dd>
          <dt className="text-gray-500">Redirect</dt><dd className="m-0 font-semibold">After the Pixel has fired</dd>
        </dl>
        <p className="m-0 mt-3 text-[12px] text-gray-500">Existing links keep their own strategy; change each one in Tracking Links. New links start with the go-live checklist.</p>
      </Card>
      <Card className="p-5">
        <h2 className="m-0 text-[17px] font-black text-gray-900 dark:text-slate-100">Meta ad URL parameters</h2>
        <p className="m-0 mt-0.5 text-[13px] text-gray-500">Paste into every ad (Ad → Tracking → URL parameters). Then 300 campaigns need no setup in Protohub: each order tells us its campaign, ad set and ad.</p>
        <textarea rows={3} value={settings.urlParameters} onChange={(e) => setSettings({ ...settings, urlParameters: e.target.value })} className="mt-2 w-full rounded-lg border border-gray-200 p-3 font-mono text-[12px] dark:border-slate-700 dark:bg-slate-900" />
        <div className="mt-2 flex gap-2">
          <button type="button" className={lightButton} onClick={() => { void navigator.clipboard?.writeText(settings.urlParameters); onToast("URL parameters copied."); }}><Copy className="h-3.5 w-3.5" /> Copy</button>
          <button type="button" className={darkButton} onClick={async () => { try { const result = await trackingHubApi.saveSettings(settings); setSettings(result.settings); onToast("Settings saved."); } catch (err: any) { onToast(err?.message ?? "Could not save."); } }}>Save Rule</button>
        </div>
      </Card>
      {renderMetaDefaults ? renderMetaDefaults() : null}
    </div>
  );
}
