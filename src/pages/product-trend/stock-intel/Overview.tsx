import { useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, Boxes, CalendarDays, ChevronRight, Flame, Home, MapPin, Network, Pencil, Users, Warehouse } from "lucide-react";
import type { StockIntelRow, StockIntelStatus } from "../../../lib/api";
import { SidePanel, nf } from "../parts";
import { IntelMap, type Callout } from "./IntelMap";
import { buildRouteGroups, type RouteGroup } from "./network-model";
import { SoldSection } from "./Sold";
import {
  AgentCell, Card, CardHead, DaysChip, HouseIcon, MiniBars, STATUS_ORDER, STATUS_TONE, daysText, hubPlace, one, place, units, useHubGroups, type IntelCtx
} from "./shared";

export const STATUS_TEXT: Record<StockIntelStatus, string> = { Critical: "#dc2626", "Restock Soon": "#ea580c", Watch: "#ca8a04", Healthy: "#16a34a" };
const NO_STOCK = "#cbd5e1";
const RAMP = ["#dbeafe", "#bfdbfe", "#93c5fd", "#60a5fa", "#3b82f6", "#1d4ed8"];

type MapMetric = "status" | "stock" | "delivered" | "orders" | "coverage" | "risk";
const METRICS: Array<{ value: MapMetric; label: string }> = [
  { value: "status", label: "Stockout risk" }, { value: "stock", label: "Available stock" }, { value: "coverage", label: "Stock coverage" },
  { value: "delivered", label: "Delivered units" }, { value: "orders", label: "Orders" }, { value: "risk", label: "Orders at risk" }
];

export type StateFigure = { state: string; status: StockIntelStatus | "No Stock"; usable: number; days: number | null; delivered: number; risk: number; speed: number; orders: number };

export function stateFigures(ctx: IntelCtx): StateFigure[] {
  const states = new Set(ctx.data.hubs.map((h) => h.state));
  const orders = new Map(ctx.data.outcomes.map((o) => [o.state, o.orders]));
  return [...states].map((state) => {
    const rows = ctx.rows.filter((r) => r.state === state);
    const usable = rows.reduce((s, r) => s + r.usable, 0);
    const speed = rows.reduce((s, r) => s + r.speed, 0);
    const onShelf = rows.reduce((s, r) => s + r.onShelf + r.inTransit, 0);
    const worst = rows.reduce<StockIntelStatus | null>((w, r) => (w === null || STATUS_ORDER[r.status] < STATUS_ORDER[w] ? r.status : w), null);
    const sold = rows.filter((r) => r.daysLeft !== null);
    return {
      state, status: onShelf <= 0 && rows.every((r) => r.reserved === 0 && r.speed === 0) ? "No Stock" : worst ?? "No Stock",
      usable, speed, days: sold.length ? Math.min(...sold.map((r) => r.daysLeft!)) : null,
      delivered: rows.reduce((s, r) => s + r.delivered, 0), risk: rows.reduce((s, r) => s + r.atRiskOrders, 0), orders: orders.get(state) ?? 0
    };
  });
}

export function OverviewView({ ctx }: { ctx: IntelCtx }) {
  const [metric, setMetric] = useState<MapMetric>("status");
  const [stateOpen, setStateOpen] = useState<string | null>(null);
  const figures = useMemo(() => stateFigures(ctx), [ctx]);
  const { shown } = useHubGroups(ctx.rows);
  const network = useMemo(() => buildRouteGroups(ctx.data, ctx.rows), [ctx.data, ctx.rows]);

  const valueOf = (f: StateFigure) => metric === "stock" ? f.usable : metric === "delivered" ? f.delivered : metric === "orders" ? f.orders : metric === "risk" ? f.risk : metric === "coverage" ? (f.days ?? 0) : 0;
  const max = Math.max(1, ...figures.map(valueOf));
  const fills: Record<string, string> = {};
  for (const f of figures) {
    if (metric === "status") fills[f.state] = f.status === "No Stock" ? NO_STOCK : STATUS_TONE[f.status].fill;
    else { const v = valueOf(f); fills[f.state] = v > 0 ? RAMP[Math.min(RAMP.length - 1, Math.floor((v / max) * (RAMP.length - 1)))] : "#eef2f7"; }
  }
  const callouts: Callout[] = (metric === "status"
    ? [...figures].filter((f) => f.status !== "No Stock").sort((a, b) => STATUS_ORDER[a.status as StockIntelStatus] - STATUS_ORDER[b.status as StockIntelStatus] || b.usable - a.usable)
    : [...figures].sort((a, b) => valueOf(b) - valueOf(a)).filter((f) => valueOf(f) > 0)
  ).slice(0, 7).map((f) => ({
    state: f.state, color: metric === "status" ? STATUS_TEXT[f.status as StockIntelStatus] : "#1d4ed8",
    lines: metric === "status" ? [place(f.state) + (ctx.data.hubs.filter((h) => h.state === f.state).length > 0 && network.groups.some((g) => g.state === f.state && g.kind !== "direct") ? " (Hub)" : ""), units(f.usable), f.days === null ? "No sales" : daysText(f.days)]
      : [place(f.state), metric === "coverage" ? daysText(valueOf(f)) : nf(valueOf(f))]
  }));
  const counts = (["Healthy", "Watch", "Restock Soon", "Critical", "No Stock"] as const).map((s) => ({ s, n: figures.filter((f) => f.status === s).length }));
  const legend: Record<string, [string, string]> = {
    Healthy: ["Healthy", "enough"], Watch: ["Watch", "getting low"], "Restock Soon": ["Restock Soon", "send now"], Critical: ["Critical", "runs out first"], "No Stock": ["No Stock", ""]
  };

  const attention = shown.filter((r) => r.status !== "Healthy");
  const forecast = shown.slice(0, 5);

  return (
    <div className="space-y-4">
      <SoldSection ctx={ctx} />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <Card className="p-4">
          <CardHead Icon={Boxes} title="Nigeria Stock Heatmap" info="Each state takes the colour of its most urgent agent. Click a state for its agents." sub={metric === "status" ? "Available stock coverage across states (selected product)" : `${METRICS.find((m) => m.value === metric)!.label} by state (selected product)`}
            action={<select aria-label="Show on map" value={metric} onChange={(e) => setMetric(e.target.value as MapMetric)} className="!min-h-0 h-8 rounded-lg border border-gray-200 bg-white px-2 text-[12px] dark:border-slate-700 dark:bg-slate-900">{METRICS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}</select>} />
          <div className="mt-2 flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="min-w-0 flex-1"><IntelMap fills={fills} callouts={callouts} onSelect={setStateOpen} label="Stock by state" /></div>
            {metric === "status" && (
              <div className="w-full shrink-0 space-y-2.5 rounded-xl border border-gray-200 p-3 lg:w-[220px] dark:border-slate-700">
                {counts.map(({ s, n }) => (
                  <div key={s} className="flex items-center gap-2 text-[12px]">
                    <span className="h-3 w-3 rounded-full" style={{ background: s === "No Stock" ? NO_STOCK : STATUS_TONE[s].fill }} />
                    <span className="flex-1"><b className="text-gray-900 dark:text-slate-100">{legend[s][0]}</b>{legend[s][1] && <span className="text-gray-500"> ({legend[s][1]})</span>}</span>
                    <span className="text-gray-600">{n} state{n === 1 ? "" : "s"}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>
        <Card className="p-4">
          <CardHead Icon={CalendarDays} title="Distribution Network" info="From the supply routes. The Owner can change them." sub="Your stock flow, hubs, and fallback routes"
            action={<button type="button" onClick={() => ctx.setView("network")} className="!min-h-0 inline-flex items-center text-[12.5px] font-semibold text-[#1F8FE0]">View <ChevronRight className="h-4 w-4" /></button>} />
          <NetworkFlow groups={network.groups.filter((g) => g.kind !== "direct").slice(0, 3)} compact />
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Card className="p-4">
          <CardHead Icon={AlertTriangle} tone="bg-rose-50 text-rose-500" title={`Agents Needing Attention (${attention.length})`} sub="Agents with low stock or high stockout risk"
            action={<button type="button" onClick={() => ctx.setView("forecast")} className="!min-h-0 inline-flex items-center text-[12.5px] font-semibold text-[#1F8FE0]">View All <ChevronRight className="h-4 w-4" /></button>} />
          {attention.length === 0 ? <p className="m-0 py-10 text-center text-[13px] text-gray-500">Every agent has enough stock for its lead time.</p> : (
            <div className="mt-3 grid gap-3 sm:grid-cols-2 2xl:grid-cols-4">
              {attention.slice(0, 4).map((row) => <AttentionCard key={row.key} row={row} ctx={ctx} />)}
            </div>
          )}
        </Card>
        <Card className="flex flex-col p-4">
          <CardHead Icon={CalendarDays} title={<>Restock Forecast <span className="text-[13px] font-semibold text-gray-500">(Next 7 Days)</span></>} sub="Recommended replenishment by agent" />
          <div className="mt-2 flex-1 overflow-x-auto">
            <table className="w-full !min-w-0 text-[12.5px]">
              <thead><tr className="text-left text-[11px] font-semibold text-gray-500"><th className="py-2 pr-2">#</th><th>Agent / State</th><th className="text-center">Current Stock</th><th className="text-center">7-Day Avg</th><th className="text-center">Days Left</th><th className="text-center">Restock Qty</th></tr></thead>
              <tbody>
                {forecast.map((row, i) => (
                  <tr key={row.key} className="cursor-pointer border-t border-gray-100 hover:bg-gray-50 dark:border-slate-800 dark:hover:bg-slate-800/50" onClick={() => ctx.openHub(row.locationId)}>
                    <td className="py-2.5 pr-2 text-gray-500">{i + 1}</td>
                    <td className="font-semibold text-gray-900 dark:text-slate-100">{row.agentName}</td>
                    <td className="text-center">{nf(row.usable)}</td><td className="text-center">{one(row.speed)}</td>
                    <td className="text-center">{row.daysLeft === null ? "—" : one(row.daysLeft)}</td>
                    <td className="text-center">{row.restock > 0 ? <span className="inline-flex items-center gap-1.5 font-bold" style={{ color: STATUS_TEXT[row.status] }}><span className={`h-2.5 w-2.5 rounded-full ${STATUS_TONE[row.status].dot}`} />{nf(row.restock)}</span> : <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />–</span>}</td>
                  </tr>
                ))}
                {forecast.length === 0 && <tr><td colSpan={6} className="py-8 text-center text-gray-500">No agent stock or sales yet.</td></tr>}
              </tbody>
            </table>
          </div>
          <button type="button" onClick={() => ctx.setView("forecast")} className="!min-h-0 mt-3 h-10 w-full rounded-xl border border-blue-200 text-[13px] font-semibold text-[#1F8FE0] hover:bg-blue-50">View Full Forecast</button>
        </Card>
      </div>

      {stateOpen && <StatePanel state={stateOpen} ctx={ctx} groups={network.groups} onClose={() => setStateOpen(null)} />}
    </div>
  );
}

function AttentionCard({ row, ctx }: { row: StockIntelRow; ctx: IntelCtx }) {
  const tone = STATUS_TONE[row.status];
  return (
    <div className="flex flex-col rounded-xl border border-gray-200 p-3 dark:border-slate-700">
      <div className="flex items-start gap-2">
        <HouseIcon seed={row.status + row.locationId} size={30} />
        <div className="min-w-0 flex-1">
          <div className="line-clamp-2 text-[13px] font-bold leading-tight text-gray-900 dark:text-slate-100">{row.agentName}</div>
          <div className="flex items-center gap-0.5 truncate text-[11px] text-gray-500"><MapPin className="h-3 w-3 shrink-0" />{hubPlace(row)}</div>
        </div>
        <span className={`shrink-0 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold ${tone.pill}`}>{row.status}</span>
      </div>
      <div className="mt-0.5 truncate text-[11px] text-gray-500">{ctx.productName(row.productId)}</div>
      <dl className="mt-2 space-y-1.5 text-[11.5px]">
        {([
          ["Available Stock", units(row.usable)], ["7-Day Delivered", units(row.delivered)],
          ["Delivery Streak", <span key="s" className="inline-flex items-center gap-0.5"><Flame className="h-3 w-3 text-orange-500" />{row.streak} days</span>],
          ["Est. Stock Remaining", daysText(row.daysLeft)]
        ] as Array<[string, React.ReactNode]>).map(([k, v]) => <div key={k} className="flex justify-between gap-2"><dt className="text-gray-500">{k}</dt><dd className="m-0 font-bold text-gray-900 dark:text-slate-100">{v}</dd></div>)}
      </dl>
      <div className={`mt-2 flex justify-between rounded-md px-2 py-1.5 text-[11.5px] font-semibold ${tone.soft}`}><span>Recommended Restock</span><span style={{ color: STATUS_TEXT[row.status] }}>{units(row.restock)}</span></div>
      <div className="mt-2"><MiniBars values={row.daily.slice(-7)} color={tone.fill} /></div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button type="button" onClick={() => ctx.openHub(row.locationId)} className="!min-h-0 h-9 rounded-lg border border-gray-200 text-[12px] font-semibold text-gray-800 hover:bg-gray-50 dark:border-slate-700 dark:text-slate-100">View Agent</button>
        <button type="button" onClick={() => ctx.openPlan(row)} className="!min-h-0 h-9 rounded-lg bg-[#1F8FE0] text-[12px] font-semibold text-white hover:bg-[#1a7dc4]">Plan Restock</button>
      </div>
    </div>
  );
}

/** Main Warehouse → hubs → the places they restock (Overview + Distribution Network). */
export function NetworkFlow({ groups, compact = false, other = [], onEdit }: { groups: RouteGroup[]; compact?: boolean; other?: string[]; onEdit?: () => void }) {
  const lines = other.length > 0 ? [...groups, null] : groups;
  if (groups.length === 0) return <p className="m-0 py-10 text-center text-[13px] text-gray-500">No supply routes yet — everything is restocked from the main warehouse.{onEdit && <> <button type="button" onClick={onEdit} className="!min-h-0 font-semibold text-[#1F8FE0]">Set routes</button></>}</p>;
  return (
    <div className="mt-3 grid grid-cols-[minmax(92px,0.8fr)_22px_minmax(120px,1.1fr)_28px_minmax(110px,1fr)] items-center gap-y-2.5">
      <div className="row-span-full flex h-full items-center" style={{ gridRow: `1 / span ${lines.length}` }}>
        <div className="flex w-full flex-col items-center justify-center rounded-xl bg-[#1F8FE0] px-2 py-4 text-center text-white shadow-md">
          <Warehouse className="h-6 w-6" /><div className="mt-1 text-[12.5px] font-bold leading-tight">Main Warehouse</div><div className="text-[11px] opacity-90">(Inbound Stock)</div>
        </div>
      </div>
      {lines.map((g, i) => (
        <div key={g?.key ?? "other"} className="contents">
          <div className="relative h-full" style={{ gridColumn: 2, gridRow: i + 1 }}>
            <span className="absolute left-0 top-1/2 h-px w-full bg-[#1F8FE0]" />
            <span className={`absolute left-0 w-px bg-[#1F8FE0] ${i === 0 ? "top-1/2 bottom-[-6px]" : i === lines.length - 1 ? "top-[-6px] bottom-1/2" : "-top-1.5 -bottom-1.5"}`} />
          </div>
          <div className="flex items-center gap-2 rounded-xl border border-gray-200 px-2.5 py-2 dark:border-slate-700"
            style={g ? { gridColumn: 3, gridRow: i + 1, borderColor: `${g.color}55`, background: `${g.color}12` } : { gridColumn: 3, gridRow: i + 1 }}>
            <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white" style={{ background: g?.color ?? "#94a3b8" }}>{g?.kind === "direct" ? <MapPin className="h-4 w-4" /> : <Home className="h-4 w-4" />}</span>
            <div className="min-w-0 leading-tight">
              <div className="truncate text-[12.5px] font-bold text-gray-900 dark:text-slate-100">{g ? g.title : "Other states"}</div>
              <div className="truncate text-[11px] text-gray-600 dark:text-slate-400">{g ? `(${g.role})` : "(Direct)"}{!compact && g && <> · {units(g.stock)}</>}</div>
            </div>
          </div>
          <div style={{ gridColumn: 4, gridRow: i + 1 }} className="flex justify-center text-gray-500"><ArrowRight className="h-4 w-4" /></div>
          <div style={{ gridColumn: 5, gridRow: i + 1 }} className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50/60 px-2.5 py-2 dark:border-emerald-500/30 dark:bg-emerald-500/10">
            <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white text-emerald-600 dark:bg-white/10">{g && g.serves.length > 3 ? <Users className="h-4 w-4" /> : <MapPin className="h-4 w-4" />}</span>
            <span className="min-w-0 text-[11.5px] font-medium leading-tight text-gray-800 dark:text-slate-200">{g ? g.servesLabel : other.map(place).join(", ")}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function StatePanel({ state, ctx, groups, onClose }: { state: string; ctx: IntelCtx; groups: RouteGroup[]; onClose: () => void }) {
  const hubs = ctx.data.hubs.filter((h) => h.state === state);
  const supply = ctx.data.routes.filter((r) => r.productId === null && r.destState === state).sort((a, b) => a.priority - b.priority);
  const supplyText = supply.length === 0 ? "Main warehouse" : supply.map((r, i) => `${r.sourceState ? `${place(r.sourceState)} hub` : "Main warehouse"}${i > 0 ? " (fallback)" : ""}`).join(" → ");
  const feeds = groups.find((g) => g.state === state && g.kind !== "direct");
  return (
    <SidePanel title={place(state)} subtitle={<span className="inline-flex items-center gap-1"><Network className="h-3.5 w-3.5" /> Primary supply hub: {supplyText}</span>} onClose={onClose}>
      {feeds && <p className="mb-3 rounded-lg bg-blue-50 px-3 py-2 text-[12px] text-blue-800 dark:bg-blue-500/10 dark:text-blue-200">This state is a supply hub: it restocks {feeds.servesLabel}.</p>}
      {hubs.length === 0 && <p className="text-[13px] text-gray-500">No agent covers {place(state)} yet.</p>}
      {hubs.map((hub) => {
        const rows = ctx.rows.filter((r) => r.locationId === hub.locationId);
        return (
          <div key={hub.locationId} className="mb-3 rounded-xl border border-gray-200 p-3 dark:border-slate-700">
            <div className="flex items-center justify-between gap-2"><AgentCell row={hub} />{ctx.canEdit && <button type="button" title="Lead time & safety stock" onClick={() => ctx.openSettings(hub.locationId)} className="!min-h-0 rounded p-1 text-gray-400 hover:bg-gray-100"><Pencil className="h-3.5 w-3.5" /></button>}</div>
            {rows.length === 0 ? <p className="m-0 mt-2 text-[12px] text-gray-500">No stock, sales or open orders.</p> : (
              <table className="mt-2 w-full !min-w-0 text-[12px]">
                <thead><tr className="text-left text-[10.5px] text-gray-500"><th>Product</th><th className="text-right">Stock</th><th className="text-right">A day</th><th className="text-right">Days</th><th className="text-right">Send</th></tr></thead>
                <tbody>{rows.map((r) => (
                  <tr key={r.key} className="border-t border-gray-100 dark:border-slate-800"><td className="py-1.5 pr-2">{ctx.productName(r.productId)}</td><td className="text-right">{nf(r.usable)}</td><td className="text-right">{one(r.speed)}</td><td className="text-right"><DaysChip row={r} /></td><td className="text-right font-bold">{r.restock > 0 ? nf(r.restock) : "–"}</td></tr>
                ))}</tbody>
              </table>
            )}
            <button type="button" onClick={() => ctx.openHub(hub.locationId)} className="!min-h-0 mt-2 text-[12px] font-semibold text-[#1F8FE0]">View agent</button>
          </div>
        );
      })}
    </SidePanel>
  );
}
