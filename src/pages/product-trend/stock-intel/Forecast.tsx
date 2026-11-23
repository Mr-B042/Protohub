import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Boxes, CalendarDays, Flame, Home, Lightbulb, Target, Truck } from "lucide-react";
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { StockIntelStatus } from "../../../lib/api";
import { nf } from "../parts";
import {
  AgentCell, Card, CardHead, ColumnsMenu, CreatePlanButton, DaysChip, ExportButton, FigureCard, PlanButton, ProductSwitch, RestockPill, RowMenu, STATUS_ORDER,
  SearchBox, StatusPill, csv, one, place, productOptions, rowMenuItems, units, useHubGroups, type IntelCtx
} from "./shared";

const COLS = { product: "Product", stock: "Current Stock", avg: "7-Day Avg", days: "Days Left", lead: "Lead Time", safety: "Safety Stock", restock: "Recommended Restock Qty", status: "Stock Status" } as const;
type Col = keyof typeof COLS;
const shortDate = (key: string) => new Date(`${key}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const addDays = (key: string, n: number) => { const d = new Date(`${key}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

export function ForecastView({ ctx }: { ctx: IntelCtx }) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StockIntelStatus | "all">(ctx.statusFilter);
  useEffect(() => setStatus(ctx.statusFilter), [ctx.statusFilter]);
  const [cols, setCols] = useState<Record<Col, boolean>>({ product: true, stock: true, avg: true, days: true, lead: true, safety: true, restock: true, status: true });
  const { groups, shown, pick } = useHubGroups(ctx.rows);

  const listed = shown.map((row, i) => ({ row, list: groups[i] }))
    .filter(({ row }) => status === "all" || row.status === status)
    .filter(({ row }) => { const q = search.trim().toLowerCase(); return !q || `${row.agentName} ${row.hubName} ${row.state} ${place(row.state)} ${ctx.productName(row.productId)}`.toLowerCase().includes(q); })
    .sort((a, b) => STATUS_ORDER[a.row.status] - STATUS_ORDER[b.row.status] || (a.row.daysLeft ?? 999) - (b.row.daysLeft ?? 999));

  // Cards: agents bucketed by their most urgent product's days left.
  const worst = groups.map((list) => list.reduce((w, r) => ((r.daysLeft ?? 999) < (w.daysLeft ?? 999) ? r : w), list[0]));
  const restockOf = (locationId: string) => ctx.rows.filter((r) => r.locationId === locationId).reduce((s, r) => s + r.restock, 0);
  const bucket = (test: (d: number) => boolean) => { const list = worst.filter((r) => r.daysLeft !== null && test(r.daysLeft)); return { n: list.length, units: list.reduce((s, r) => s + restockOf(r.locationId), 0) }; };
  const urgent = bucket((d) => d <= 3), soon = bucket((d) => d > 3 && d < 7), healthy = worst.filter((r) => r.daysLeft === null || r.daysLeft >= 7).length;
  const totalNeed = ctx.rows.reduce((s, r) => s + r.restock, 0);
  const toRestock = new Set(ctx.rows.filter((r) => r.restock > 0).map((r) => r.locationId));

  // Chart: next 7 days - demand building up (bars) against stock left (line).
  const chart = useMemo(() => {
    const speed = ctx.rows.reduce((s, r) => s + r.speed, 0);
    const stock = ctx.rows.reduce((s, r) => s + r.usable + r.inTransit, 0);
    return Array.from({ length: 7 }, (_, i) => ({ day: shortDate(addDays(ctx.data.today, i + 1)), demand: Math.round(speed * (i + 1)), stock: Math.max(0, Math.round(stock - speed * (i + 1))) }));
  }, [ctx.rows, ctx.data.today]);

  // Bottom cards.
  const planned = ctx.rows.filter((r) => r.restock > 0);
  const after = planned.filter((r) => r.speed > 0).map((r) => (r.usable + r.inTransit + r.restock) / r.speed);
  const leadDays = planned.map((r) => r.leadDays);
  const sendToday = planned.some((r) => r.status === "Critical" || r.status === "Restock Soon");
  const top = [...planned].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || (a.daysLeft ?? 99) - (b.daysLeft ?? 99)).slice(0, 2);
  const atRisk = ctx.rows.reduce((s, r) => s + r.atRiskOrders, 0);

  const exportRows = () => csv("restock-forecast", [["Agent", "State", "Product", "Current stock", "7-day avg", "Days left", "Lead time (days)", "Lead time from", "Safety stock", "Restock", "Status", "Send from"],
    ...listed.map(({ row }) => [row.agentName, place(row.state), ctx.productName(row.productId), row.usable, one(row.speed), row.daysLeft === null ? "" : one(row.daysLeft), one(row.leadDays), row.leadSource, row.safetyUnits, row.restock, row.status, row.sources.filter((s) => s.units > 0).map((s) => `${s.label} (${s.units})`).join("; ") || row.primarySource])]);
  useEffect(() => { ctx.exportRef.current = exportRows; });

  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Card className="p-4">
          <CardHead title="Restock Forecast Overview" info="Days left = free stock ÷ units sold a day. Restock = 7 days of sales + safety stock − free stock − stock on the way." sub="Prediction using recent delivery rate, sales speed, current stock, and lead time." />
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <FigureCard Icon={Boxes} tone="text-[#1F8FE0]" bg="bg-blue-50/70 dark:bg-blue-500/10" label="Total Restock Need" value={units(totalNeed)} foot={`across ${toRestock.size} agent${toRestock.size === 1 ? "" : "s"}`} />
            <FigureCard Icon={AlertTriangle} tone="text-rose-500" bg="bg-rose-50/70 dark:bg-rose-500/10" label="Urgent (≤ 3 days)" value={`${urgent.n} agent${urgent.n === 1 ? "" : "s"}`} foot={<span className="text-[16px] font-black text-rose-600">{urgent.units > 0 ? units(urgent.units) : "–"}</span>} />
            <FigureCard Icon={Flame} tone="text-orange-500" bg="bg-orange-50/70 dark:bg-orange-500/10" label="Soon (4 – 6 days)" value={`${soon.n} agent${soon.n === 1 ? "" : "s"}`} foot={<span className="text-[16px] font-black text-orange-600">{soon.units > 0 ? units(soon.units) : "–"}</span>} />
            <FigureCard Icon={Home} tone="text-emerald-600" bg="bg-emerald-50/70 dark:bg-emerald-500/10" label="Healthy (≥ 7 days)" value={`${healthy} agent${healthy === 1 ? "" : "s"}`} foot={<span className="text-[16px] font-black text-emerald-600">–</span>} />
          </div>
        </Card>
        <Card className="p-4">
          <CardHead title={<span className="text-[14px]">Forecast vs Available Stock</span>} info="Next 7 days: units expected to sell (adding up) against the stock that would be left with no restock." />
          <div className="mt-1 h-[160px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chart} margin={{ top: 6, right: 6, left: -18, bottom: 0 }}>
                <CartesianGrid stroke="#eef2f7" vertical={false} />
                <XAxis dataKey="day" tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip formatter={(v: number, name: string) => [`${nf(v)} units`, name === "demand" ? "Forecast demand" : "Available stock"]} />
                <Legend verticalAlign="top" align="right" iconType="circle" wrapperStyle={{ fontSize: 11, top: -6 }} formatter={(v) => (v === "demand" ? "Forecast Demand" : "Available Stock")} />
                <Bar dataKey="demand" fill="#60a5fa" radius={[4, 4, 0, 0]} barSize={26} />
                <Line type="linear" dataKey="stock" stroke="#7c3aed" strokeWidth={2} dot={{ r: 3.5, fill: "#fff", stroke: "#7c3aed", strokeWidth: 2 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-gray-100 px-4 py-3 dark:border-slate-800">
          <div className="mr-auto"><CardHead title="Agent Restock Forecast & Recommendation" info="Lead time is set by the Owner, or measured from each agent's past waybills (dispatched → received), or 4 days when there are none." sub="When each agent will run out of stock and how many units to send." /></div>
          {status !== "all" && <button type="button" onClick={() => setStatus("all")} className="!min-h-0 h-8 rounded-full bg-blue-50 px-3 text-[12px] font-semibold text-[#1F8FE0]">Showing {status} ×</button>}
          <div className="w-full sm:w-[260px]"><SearchBox value={search} onChange={setSearch} placeholder="Search agent, state or product..." /></div>
          <ColumnsMenu labels={COLS} shown={cols} setShown={setCols} />
          <ExportButton onClick={exportRows} />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full !min-w-[1080px] text-[12.5px]">
            <thead>
              <tr className="border-b border-gray-100 text-left text-[11px] font-semibold text-gray-700 dark:border-slate-800 dark:text-slate-300">
                <th className="px-4 py-3">#</th><th>Agent / State</th>{cols.product && <th>Product</th>}
                {cols.stock && <th className="text-center">Current Stock</th>}{cols.avg && <th className="text-center">7-Day Avg<br />(Units/Day)</th>}{cols.days && <th className="text-center">Days Left</th>}
                {cols.lead && <th className="text-center">Lead Time</th>}{cols.safety && <th className="text-center">Safety Stock</th>}{cols.restock && <th className="text-center">Recommended<br />Restock Qty</th>}
                {cols.status && <th className="text-center">Stock Status</th>}<th className="pr-4 text-center">Action</th>
              </tr>
            </thead>
            <tbody>
              {listed.map(({ row, list }, i) => (
                <tr key={row.locationId} className="border-b border-gray-100 last:border-0 dark:border-slate-800">
                  <td className="px-4 py-2.5 text-gray-500">{i + 1}</td>
                  <td className="py-2 pr-3"><AgentCell row={row} /></td>
                  {cols.product && <td className="pr-3"><ProductSwitch value={row.productId} options={productOptions(list, ctx.productName)} onChange={(p) => pick(row.locationId, p)} /></td>}
                  {cols.stock && <td className="text-center text-[13px] font-semibold">{nf(row.usable)}</td>}
                  {cols.avg && <td className="text-center">{one(row.speed)}</td>}
                  {cols.days && <td className="text-center"><DaysChip row={row} /></td>}
                  {cols.lead && <td className="text-center" title={row.leadSource === "set" ? "Set by the Owner" : row.leadSource === "measured" ? "Measured from past waybills" : "Standard (no received waybills yet)"}>{one(row.leadDays)} days{row.leadSource !== "measured" && <span className="block text-[10px] text-gray-400">{row.leadSource === "set" ? "set" : "standard"}</span>}</td>}
                  {cols.safety && <td className="text-center">{nf(row.safetyUnits)}</td>}
                  {cols.restock && <td className="text-center"><RestockPill value={row.restock} /></td>}
                  {cols.status && <td className="text-center"><StatusPill status={row.status} /></td>}
                  <td className="pr-4"><div className="flex items-center justify-center gap-2"><PlanButton row={row} ctx={ctx} /><RowMenu items={rowMenuItems(row, ctx)} /></div></td>
                </tr>
              ))}
              {listed.length === 0 && <tr><td colSpan={11} className="py-10 text-center text-gray-500">No agents match.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)_minmax(0,1fr)]">
        <Card className="p-4">
          <CardHead Icon={Target} tone="bg-blue-50 text-[#1F8FE0]" title="Restock Summary" />
          <div className="mt-3 grid grid-cols-4 gap-2">
            {([["Total Agents", nf(groups.length)], ["Agents to Restock", nf(toRestock.size)], ["Total Units", nf(totalNeed)], ["Est. Coverage", after.length ? `≥ ${Math.floor(Math.min(...after))} days` : "—"]] as Array<[string, string]>).map(([k, v]) => (
              <div key={k}><div className="text-[11px] text-gray-600 dark:text-slate-400">{k}</div><div className="mt-1 text-[20px] font-black text-gray-900 dark:text-slate-50">{v}</div></div>
            ))}
          </div>
        </Card>
        <Card className="p-4">
          <CardHead Icon={Truck} tone="bg-blue-50 text-[#1F8FE0]" title="Next Restock Plan" />
          <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center">
            <dl className="m-0 flex-1 space-y-2 text-[12.5px]">
              {([[CalendarDays, "Recommended Send Date", planned.length === 0 ? "Nothing to send" : sendToday ? "Today" : "Within the week"],
                [Truck, "Expected Arrival", leadDays.length ? `In ${one(Math.min(...leadDays))}${Math.max(...leadDays) > Math.min(...leadDays) ? `–${one(Math.max(...leadDays))}` : ""} days` : "—"],
                [Boxes, "Coverage After Restock", after.length ? `${Math.floor(Math.min(...after))} – ${Math.ceil(Math.max(...after))} days` : "—"]] as Array<[typeof Truck, string, string]>).map(([Icon, k, v]) => (
                <div key={k} className="flex items-center gap-2"><Icon className="h-4 w-4 text-gray-500" /><dt className="text-gray-600 dark:text-slate-400">{k}:</dt><dd className="m-0 font-bold text-gray-900 dark:text-slate-100">{v}</dd></div>
              ))}
            </dl>
            <CreatePlanButton ctx={ctx} />
          </div>
        </Card>
        <Card className="p-4">
          <CardHead Icon={Lightbulb} tone="bg-violet-50 text-violet-600" title="Key Insight" />
          <p className="m-0 mt-2 text-[13px] leading-relaxed text-gray-700 dark:text-slate-300">
            {top.length === 0 ? "No agent needs stock right now: every one can last its lead time plus safety days." : <>
              {top.map((r) => r.agentName).join(" and ")} will run out in ~{one(Math.min(...top.map((r) => r.daysLeft ?? 0)))} days. Send {top.map((r) => units(r.restock)).join(" and ")}{top.length > 1 ? " respectively" : ""} to avoid stockouts{atRisk > 0 ? <> and lost sales (≈ {nf(atRisk)} order{atRisk === 1 ? "" : "s"})</> : null}.
            </>}
          </p>
        </Card>
      </div>
    </div>
  );
}

