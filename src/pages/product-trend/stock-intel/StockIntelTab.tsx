import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AlertTriangle, ArrowDownToLine, ArrowLeftRight, ArrowUpFromLine, BarChart3, Boxes, CalendarDays, CheckCircle2, ChevronDown, Clock3, Download, Flame, Loader2, Network, RotateCw, Truck
} from "lucide-react";
import { stockIntelApi, type StockIntelData, type StockIntelRow, type StockIntelStatus } from "../../../lib/api";
import { Delta, nf, useClickAway } from "../parts";
import type { TransferRequest } from "../tab-context";
import { ForecastView } from "./Forecast";
import { MovementsView, movementFigures } from "./Movements";
import { NetworkView } from "./Network";
import { OverviewView } from "./Overview";
import { StreaksView } from "./Streaks";
import { HubPanel, PlanAllModal, PlanModal, RoutesModal, SettingsModal, one, type IntelCtx, type View } from "./shared";

// ── Product Trend › Stock Intelligence (Bright's brief + 5 designs, 23 Nov 2026)
// Every figure comes from the server (GET /api/stock-intel, worked out in
// backend/src/lib/stock-intel-model.ts) so this tab and the stock alerts can
// never disagree. It recommends only: every "Plan Restock" opens the normal
// Create Waybill form.

const VIEWS: Array<{ key: View; label: string; Icon: typeof Boxes }> = [
  { key: "overview", label: "Overview", Icon: Boxes },
  { key: "streaks", label: "Delivery Streaks", Icon: Flame },
  { key: "forecast", label: "Restock Forecast", Icon: CalendarDays },
  { key: "network", label: "Distribution Network", Icon: Network },
  { key: "movements", label: "Stock Movements", Icon: ArrowLeftRight }
];
const WINDOWS = [7, 14, 28];
const longDate = (key: string) => new Date(`${key}T12:00:00Z`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
const shift = (key: string, n: number) => { const d = new Date(`${key}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const lagosToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Lagos" });

/** ?tab=stock-intel&view=network in the page link (stock alerts) opens that view. */
export const linkedView = (): View | null => {
  const match = window.location.hash.match(/[?&]view=([a-z]+)/);
  const view = match?.[1] as View | undefined;
  return view && VIEWS.some((v) => v.key === view) ? view : null;
};

export function StockIntelTab({ tabBar, products, canCreateTransfer, onCreateTransfer }: {
  tabBar: ReactNode;
  products: Array<{ id: string; name: string }>;
  canCreateTransfer: boolean;
  onCreateTransfer?: (request: TransferRequest) => void;
}) {
  const [view, setViewState] = useState<View>(() => linkedView() ?? "overview");
  const [statusFilter, setStatusFilter] = useState<StockIntelStatus | "all">("all");
  const [windowDays, setWindowDays] = useState(7);
  const [productId, setProductId] = useState<string>("all");
  const [data, setData] = useState<StockIntelData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);
  const [hubOpen, setHubOpen] = useState<string | null>(null);
  const [plan, setPlan] = useState<StockIntelRow | null>(null);
  const [planAll, setPlanAll] = useState(false);
  const [settingsFor, setSettingsFor] = useState<string | null>(null);
  const [routesOpen, setRoutesOpen] = useState(false);
  const [rangeOpen, setRangeOpen] = useState(false);
  const closeRange = useCallback(() => setRangeOpen(false), []);
  const rangeRef = useClickAway<HTMLDivElement>(rangeOpen, closeRange);
  const exportRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError("");
    stockIntelApi.load({ windowDays, productId: productId === "all" ? null : productId })
      .then((result) => { if (!cancelled) setData(result); })
      .catch((err: any) => { if (!cancelled) setError(err?.message ?? "Could not load the stock figures."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [windowDays, productId, tick]);
  useEffect(() => {
    const onHash = () => { const v = linkedView(); if (v) setViewState(v); };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const names = useMemo(() => new Map([...(data?.products ?? []), ...products].map((p) => [p.id, p.name])), [data, products]);
  const ctx: IntelCtx | null = data ? {
    data, rows: data.result.rows, productName: (id) => names.get(id) ?? "Product", windowDays: data.windowDays,
    canCreateTransfer, onCreateTransfer, canEdit: data.canEdit, statusFilter,
    setView: (next, status = "all") => { setViewState(next); setStatusFilter(status); window.scrollTo({ top: 0, behavior: "smooth" }); },
    openHub: setHubOpen, openPlan: (row) => { setPlanAll(false); setPlan(row); }, openPlanAll: () => setPlanAll(true),
    openSettings: setSettingsFor, openRoutes: () => setRoutesOpen(true), reload: () => setTick((n) => n + 1), exportRef
  } : null;

  const today = data?.today ?? lagosToday();
  const rangeLabel = `${longDate(shift(today, -(windowDays - 1)))} – ${longDate(today)}`;

  return (
    <div className="space-y-4">
      <header className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#1F8FE0] text-white shadow-md"><Boxes className="h-5 w-5" /></span>
          <div>
            <h1 className="m-0 text-[26px] font-black tracking-tight text-gray-900 dark:text-slate-50">Stock Intelligence &amp; Restock Forecasting</h1>
            <p className="m-0 mt-0.5 max-w-4xl text-[13px] text-gray-500 dark:text-slate-400">Monitor agent stock, delivery streaks, state demand, and predict stockouts. Know where to restock before sales are affected.</p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2 lg:flex-nowrap">
          <div className="relative" ref={rangeRef}>
            <button type="button" onClick={() => setRangeOpen((o) => !o)} title="Sales speed and streaks are read over this period"
              className="!min-h-0 inline-flex h-10 items-center gap-2 whitespace-nowrap rounded-lg border border-gray-200 bg-white px-3 text-[13px] font-medium text-gray-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
              <CalendarDays className="h-4 w-4 text-gray-500" />{rangeLabel}<ChevronDown className="h-4 w-4 text-gray-400" />
            </button>
            {rangeOpen && (
              <div className="absolute right-0 top-full z-40 mt-1 w-48 rounded-xl border border-gray-200 bg-white p-1 shadow-xl dark:border-slate-700 dark:bg-slate-900">
                {WINDOWS.map((w) => <button key={w} type="button" onClick={() => { setWindowDays(w); setRangeOpen(false); }} className={`!min-h-0 block w-full rounded-lg px-3 py-2 text-left text-[12.5px] hover:bg-gray-50 dark:hover:bg-slate-800 ${w === windowDays ? "font-bold text-[#1F8FE0]" : ""}`}>Last {w} days</button>)}
              </div>
            )}
          </div>
          <label className="relative">
            <span className="sr-only">Product</span>
            <select value={productId} onChange={(e) => setProductId(e.target.value)} className="!min-h-0 h-10 w-[180px] appearance-none truncate rounded-lg border border-gray-200 bg-white pl-3 pr-8 text-[13px] font-semibold text-gray-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
              <option value="all">All Products</option>
              {(data?.products ?? products).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
          </label>
          <button type="button" onClick={() => exportRef.current()} disabled={!ctx} className="!min-h-0 inline-flex h-10 items-center gap-2 rounded-lg bg-[#1F8FE0] px-4 text-[13px] font-semibold text-white shadow-sm hover:bg-[#1a7dc4] disabled:opacity-40"><Download className="h-4 w-4" /> Export</button>
        </div>
      </header>

      {view === "movements" ? <MovementKpis ctx={ctx} /> : <MainKpis ctx={ctx} />}

      {tabBar}

      <nav className="grid grid-cols-2 gap-1 rounded-xl border border-gray-200 bg-white p-1 shadow-sm sm:grid-cols-5 dark:border-slate-800 dark:bg-slate-900" role="tablist" aria-label="Stock Intelligence views">
        {VIEWS.map(({ key, label, Icon }) => (
          <button key={key} type="button" role="tab" aria-selected={view === key} onClick={() => ctx ? ctx.setView(key) : setViewState(key)}
            className={`!min-h-0 inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-[13.5px] font-semibold transition-colors ${view === key ? "bg-[#1F8FE0] text-white shadow-sm" : "text-gray-800 hover:bg-gray-50 dark:text-slate-200 dark:hover:bg-slate-800"}`}>
            <Icon className="h-4 w-4" />{label}
          </button>
        ))}
      </nav>

      {error && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-100">
          <span>{error}</span>
          <button type="button" onClick={() => setTick((n) => n + 1)} className="!min-h-0 rounded-lg border border-rose-300 bg-white px-3 py-1.5 font-semibold text-rose-700">Try again</button>
        </div>
      )}
      {!ctx ? (
        <div className="space-y-3 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          {loading && <div className="flex items-center gap-2 text-[13px] text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Working out stock, sales speed and lead times…</div>}
          {[0, 1, 2, 3].map((i) => <div key={i} className="h-12 animate-pulse rounded-lg bg-gray-100 dark:bg-slate-800" />)}
        </div>
      ) : (
        <>
          {view === "overview" && <OverviewView ctx={ctx} />}
          {view === "streaks" && <StreaksView ctx={ctx} />}
          {view === "forecast" && <ForecastView ctx={ctx} />}
          {view === "network" && <NetworkView ctx={ctx} />}
          {view === "movements" && <MovementsView ctx={ctx} />}
          <p className="m-0 flex items-center gap-1.5 text-[11.5px] text-gray-400">
            Sales speed over the last {ctx.windowDays} days · free stock = on the shelf − damaged − missing − promised to open orders · lead time measured from each agent's past waybills unless the Owner set one.
            <button type="button" onClick={() => setTick((n) => n + 1)} className="!min-h-0 inline-flex items-center gap-1 font-semibold text-[#1F8FE0]">{loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCw className="h-3 w-3" />} Refresh</button>
          </p>
          {hubOpen && <HubPanel locationId={hubOpen} ctx={ctx} onClose={() => setHubOpen(null)} />}
          {plan && <PlanModal row={plan} ctx={ctx} onClose={() => setPlan(null)} />}
          {planAll && <PlanAllModal ctx={ctx} onClose={() => setPlanAll(false)} />}
          {settingsFor && <SettingsModal locationId={settingsFor} ctx={ctx} onClose={() => setSettingsFor(null)} />}
          {routesOpen && <RoutesModal ctx={ctx} onClose={() => setRoutesOpen(false)} />}
        </>
      )}
    </div>
  );
}

function Kpi({ Icon, tone, bg, label, value, foot, onClick, info }: { Icon: typeof Boxes; tone: string; bg: string; label: string; value: ReactNode | null; foot?: ReactNode; onClick?: () => void; info?: string }) {
  return (
    <button type="button" onClick={onClick} disabled={!onClick} title={info}
      className={`!min-h-0 flex items-start gap-3 rounded-2xl border border-gray-200 p-3.5 text-left shadow-sm transition hover:shadow-md disabled:cursor-default disabled:hover:shadow-sm dark:border-slate-800 ${bg}`}>
      <span className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white ${tone} shadow-sm dark:bg-white/5`}><Icon className="h-5 w-5" /></span>
      <span className="min-w-0 flex-1">
        <span className="block text-[12px] font-semibold text-gray-700 dark:text-slate-300">{label}</span>
        {value === null ? <span className="mt-1.5 block h-6 w-20 animate-pulse rounded bg-gray-100 dark:bg-slate-800" />
          : <span className="mt-0.5 block truncate text-[21px] font-black tracking-tight text-gray-900 dark:text-slate-50">{value}</span>}
        {foot && <span className="mt-0.5 block truncate text-[11.5px] text-gray-500 dark:text-slate-400">{foot}</span>}
      </span>
    </button>
  );
}
const small = (text: string) => <span className="text-[15px] font-bold">{text}</span>;

function MainKpis({ ctx }: { ctx: IntelCtx | null }) {
  const rows = ctx?.rows ?? [];
  const hubsWith = (test: (r: StockIntelRow) => boolean) => new Set(rows.filter(test).map((r) => r.locationId)).size;
  const usable = rows.reduce((s, r) => s + r.usable, 0), speed = rows.reduce((s, r) => s + r.speed, 0);
  const byHub = new Map<string, { name: string; units: number }>();
  for (const r of rows) { const e = byHub.get(r.locationId) ?? { name: r.agentName, units: 0 }; e.units += r.delivered; byHub.set(r.locationId, e); }
  const fastest = [...byHub.values()].sort((a, b) => b.units - a.units)[0];
  const restock = rows.reduce((s, r) => s + r.restock, 0);
  const atRisk = rows.reduce((s, r) => s + r.atRiskOrders, 0);
  const critical = hubsWith((r) => r.status === "Critical");
  const v = (x: ReactNode) => (ctx ? x : null);
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      <Kpi Icon={Boxes} tone="text-[#1F8FE0]" bg="bg-white dark:bg-slate-900" label="Available Stock" value={v(<>{nf(usable)} {small("units")}</>)} foot={`free to sell across ${hubsWith((r) => r.usable > 0)} agents`} onClick={ctx ? () => ctx.setView("network") : undefined} />
      <Kpi Icon={AlertTriangle} tone="text-rose-500" bg="bg-rose-50/50 dark:bg-rose-500/5" label="Critical Stock" value={v(<>{critical} {small(critical === 1 ? "agent" : "agents")}</>)} foot="Run out before a restock can arrive" onClick={ctx ? () => ctx.setView("forecast", "Critical") : undefined} />
      <Kpi Icon={Clock3} tone="text-emerald-600" bg="bg-emerald-50/50 dark:bg-emerald-500/5" label="Stock Coverage" value={v(speed > 0 ? <>{one(usable / speed)} {small("days")}</> : "—")} foot={`at ${one(speed)} units sold a day`} onClick={ctx ? () => ctx.setView("network") : undefined} />
      <Kpi Icon={Flame} tone="text-orange-500" bg="bg-orange-50/50 dark:bg-orange-500/5" label="Fastest Selling Agent" value={v(fastest && fastest.units > 0 ? fastest.name : "—")} foot={fastest && fastest.units > 0 ? `${nf(fastest.units)} delivered (${ctx?.windowDays ?? 7} days)` : "No deliveries yet"} onClick={ctx ? () => ctx.setView("streaks") : undefined} />
      <Kpi Icon={Truck} tone="text-violet-600" bg="bg-violet-50/50 dark:bg-violet-500/5" label="Restock Required" value={v(<>{nf(restock)} {small("units")}</>)} foot={`Across ${hubsWith((r) => r.restock > 0)} agents`} onClick={ctx ? () => ctx.setView("forecast") : undefined} />
      <Kpi Icon={BarChart3} tone="text-[#1F8FE0]" bg="bg-white dark:bg-slate-900" label="At-Risk Orders" value={v(<>{nf(atRisk)} {small(atRisk === 1 ? "order" : "orders")}</>)} foot="May not be fulfilled (stockout)"
        info="Orders expected between an agent running out and a restock sent today arriving, plus open orders the shelf cannot cover." onClick={ctx ? () => ctx.setView("forecast") : undefined} />
    </div>
  );
}

function MovementKpis({ ctx }: { ctx: IntelCtx | null }) {
  const f = ctx ? movementFigures(ctx) : null;
  const v = (x: ReactNode) => (f ? x : null);
  const vs = (d: number | null | undefined) => (f ? <><Delta value={d ?? null} /> <span>vs previous period</span></> : null);
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      <Kpi Icon={Truck} tone="text-[#1F8FE0]" bg="bg-white dark:bg-slate-900" label="Total Movements" value={v(<>{nf(f?.now.total ?? 0)} {small("units")}</>)} foot={vs(f?.deltas.total)} />
      <Kpi Icon={ArrowDownToLine} tone="text-emerald-600" bg="bg-emerald-50/50 dark:bg-emerald-500/5" label="Inbound (Received)" value={v(<>{nf(f?.now.inboundReceived ?? 0)} {small("units")}</>)} foot={vs(f?.deltas.inbound)} />
      <Kpi Icon={ArrowUpFromLine} tone="text-violet-600" bg="bg-violet-50/50 dark:bg-violet-500/5" label="Outbound (Sent)" value={v(<>{nf(f?.now.outboundSent ?? 0)} {small("units")}</>)} foot={vs(f?.deltas.outbound)} />
      <Kpi Icon={Truck} tone="text-orange-500" bg="bg-orange-50/50 dark:bg-orange-500/5" label="In Transit" value={v(<>{nf(f?.now.inTransit ?? 0)} {small("units")}</>)} foot={f ? `(${f.transitWaybills} waybill${f.transitWaybills === 1 ? "" : "s"})` : undefined} />
      <Kpi Icon={CheckCircle2} tone="text-emerald-600" bg="bg-emerald-50/50 dark:bg-emerald-500/5" label="Received & Updated" value={v(<>{nf(f?.now.received ?? 0)} {small("units")}</>)} foot={f?.receiptRate != null ? `${Math.round(f.receiptRate)}% receipt rate` : "No receipts yet"} />
      <Kpi Icon={AlertTriangle} tone="text-rose-500" bg="bg-rose-50/50 dark:bg-rose-500/5" label="Discrepancy" value={v(<>{nf(f?.now.discrepancy ?? 0)} {small("units")}</>)} foot={f ? `(${f.discrepancyWaybills} waybill${f.discrepancyWaybills === 1 ? "" : "s"})` : undefined} />
    </div>
  );
}

