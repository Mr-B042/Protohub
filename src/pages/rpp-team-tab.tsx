import { useCallback, useMemo, useState } from "react";
import { MoreVertical } from "lucide-react";
import { Bar, BarChart, CartesianGrid, LabelList, Legend, Tooltip, XAxis, YAxis } from "recharts";
import { money, shortMoney } from "../lib/money-privacy";
import { Avatar, useClickAway } from "./product-trend/parts";
import { rateTone } from "./RepProductPerformancePage";
import { ChartCard, LowerToolbar, RankBadge, SERIES, WaitingForDesign, nf, share, type RppCtx } from "./rpp-ui";

// ── Team Performance tab (Bright's design, 21 Oct 2026) ─────────────────────
// Upsells / cross-sells are counted on the orders PLACED in the period (the
// rep records them on the call); their money (AOV lift) comes from the ones
// delivered, through the Upsell & Cross-Sell Bonus tab's own calculation.

const LOWER = ["Sales Rep Summary", "Product Performance by Rep", "Upsell & Cross-Sell Performance", "Call & Conversion Metrics", "State Performance by Rep"] as const;
type Lower = (typeof LOWER)[number];
const MIN = 5;

type RepRow = {
  id: string; name: string; placed: number; confirmed: number; pending: number; cancelled: number; failed: number; delivered: number;
  revenue: number; net: number; bonus: number; upsells: number; crossSells: number; addOnRevenue: number; originalDelivered: number;
};

export default function RppTeamTab({ ctx }: { ctx: RppCtx }) {
  const [lower, setLower] = useState<Lower>("Sales Rep Summary");
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"table" | "chart">("table");

  const rows = useMemo<RepRow[]>(() => ctx.repIds.map((id) => {
    const list = ctx.current.filter((order) => (order.repId ?? "") === id);
    const f = ctx.funnelOf(list);
    const delivered = list.filter((order) => order.status === "Delivered");
    let addOnRevenue = 0, originalDelivered = 0;
    for (const order of delivered) { addOnRevenue += ctx.addOnFor(order.id)?.revenue ?? 0; originalDelivered += order.originalValue; }
    return {
      id, name: ctx.nameOfRep(id), placed: f.placed, confirmed: f.confirmed, pending: f.pending, cancelled: f.cancelled, failed: f.failed, delivered: f.delivered,
      revenue: f.revenue, net: f.net, bonus: ctx.bonusFor(delivered.map((order) => order.id)),
      upsells: list.filter((order) => order.hasUpsell).length, crossSells: list.filter((order) => order.crossSells.length > 0).length,
      addOnRevenue, originalDelivered
    };
  }), [ctx]);
  const team = useMemo<RepRow>(() => rows.reduce((t, r) => ({
    ...t, placed: t.placed + r.placed, confirmed: t.confirmed + r.confirmed, pending: t.pending + r.pending, cancelled: t.cancelled + r.cancelled, failed: t.failed + r.failed,
    delivered: t.delivered + r.delivered, revenue: t.revenue + r.revenue, net: t.net + r.net, bonus: t.bonus + r.bonus, upsells: t.upsells + r.upsells,
    crossSells: t.crossSells + r.crossSells, addOnRevenue: t.addOnRevenue + r.addOnRevenue, originalDelivered: t.originalDelivered + r.originalDelivered
  }), { id: "team", name: "Team Total", placed: 0, confirmed: 0, pending: 0, cancelled: 0, failed: 0, delivered: 0, revenue: 0, net: 0, bonus: 0, upsells: 0, crossSells: 0, addOnRevenue: 0, originalDelivered: 0 }), [rows]);

  const rateOf = (row: RepRow) => share(row.delivered, row.placed);
  const chartData = rows.map((row) => ({ name: row.name.split(" ")[0], full: row.name, placed: row.placed, delivered: row.delivered, revenue: Math.round(row.revenue), net: Math.round(row.net), rate: Math.round(rateOf(row) ?? 0) }));
  const needle = search.trim().toLowerCase();
  const shown = rows.filter((row) => !needle || row.name.toLowerCase().includes(needle));
  const ranked = (score: (row: RepRow) => number, eligible: (row: RepRow) => boolean = () => true) => [...rows].filter(eligible).sort((a, b) => score(b) - score(a)).slice(0, 3);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-3">
        <ChartCard title={`Orders by Sales Rep (${ctx.periodName})`} legend={[["#c4b5fd", "Placed Orders"], ["#7c3aed", "Delivered Orders"]]}>
          <BarChart data={chartData} margin={{ top: 18, right: 4, left: -22, bottom: 0 }} barGap={2}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eef0f4" />
            <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} />
            <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
            <Tooltip labelFormatter={(_, payload) => payload?.[0]?.payload?.full ?? ""} />
            <Bar dataKey="placed" name="Placed" fill="#c4b5fd" radius={[3, 3, 0, 0]}><LabelList dataKey="placed" position="top" fontSize={10} /></Bar>
            <Bar dataKey="delivered" name="Delivered" fill="#7c3aed" radius={[3, 3, 0, 0]}><LabelList dataKey="delivered" position="top" fontSize={10} /></Bar>
          </BarChart>
        </ChartCard>
        <section className="min-w-0 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <h2 className="m-0 mb-4 text-[14.5px] font-bold text-gray-900 dark:text-slate-100">Delivery Rate by Sales Rep</h2>
          <ul className="m-0 list-none space-y-4 p-0">
            {rows.map((row, index) => (
              <li key={row.id} className="flex items-center gap-3">
                <span className="w-28 shrink-0 truncate text-[12.5px] text-gray-700 dark:text-slate-300" title={row.name}>{row.name}</span>
                <div className="h-3 min-w-0 flex-1 overflow-hidden rounded-full bg-gray-100 dark:bg-slate-800"><div className="h-full rounded-full" style={{ width: `${rateOf(row) ?? 0}%`, background: SERIES[index % SERIES.length] }} /></div>
                <span className="w-10 shrink-0 text-right text-[13px] font-bold text-gray-900 dark:text-slate-100">{rateOf(row) === null ? "-" : `${Math.round(rateOf(row)!)}%`}</span>
              </li>
            ))}
          </ul>
        </section>
        <ChartCard title="Revenue & Net Profit by Sales Rep" legend={[["#3b82f6", "Revenue (Delivered)"], ...(ctx.canSeeProfit ? [["#22c55e", "Net Profit"] as [string, string]] : [])]}>
          <BarChart data={chartData} margin={{ top: 18, right: 4, left: -4, bottom: 0 }} barGap={3}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eef0f4" />
            <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} />
            <YAxis tick={{ fontSize: 10 }} tickFormatter={(value: number) => shortMoney(value)} />
            <Tooltip formatter={(value: number) => money(value)} labelFormatter={(_, payload) => payload?.[0]?.payload?.full ?? ""} />
            <Bar dataKey="revenue" name="Revenue" fill="#3b82f6" radius={[3, 3, 0, 0]}><LabelList dataKey="revenue" position="top" fontSize={9} formatter={(value: number) => (value ? shortMoney(value) : "")} /></Bar>
            {ctx.canSeeProfit && <Bar dataKey="net" name="Net profit" fill="#22c55e" radius={[3, 3, 0, 0]}><LabelList dataKey="net" position="top" fontSize={9} formatter={(value: number) => (value ? shortMoney(value) : "")} /></Bar>}
          </BarChart>
        </ChartCard>
      </div>

      <LowerToolbar tabs={LOWER} active={lower} onTab={setLower} search={search} onSearch={setSearch} placeholder="Search sales rep..." view={view} onView={setView} />

      {lower !== "Sales Rep Summary" ? <WaitingForDesign what={lower} /> : view === "chart" ? (
        <ChartCard title="Delivered orders and add-ons by rep" height={340} legend={[["#7c3aed", "Delivered"], ["#22c55e", "Upsells"], ["#f59e0b", "Cross-sells"]]}>
          <BarChart data={shown.map((row) => ({ name: row.name, Delivered: row.delivered, Upsells: row.upsells, "Cross-sells": row.crossSells }))} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eef0f4" />
            <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} />
            <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
            <Tooltip /><Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="Delivered" fill="#7c3aed" radius={[4, 4, 0, 0]} />
            <Bar dataKey="Upsells" fill="#22c55e" radius={[4, 4, 0, 0]} />
            <Bar dataKey="Cross-sells" fill="#f59e0b" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ChartCard>
      ) : (
        <SummaryTable rows={shown} team={team} ctx={ctx} />
      )}

      {lower === "Sales Rep Summary" && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Performers title="Top Performers (Delivery Rate)" rows={ranked((row) => rateOf(row) ?? 0, (row) => row.placed >= MIN)}
            value={(row) => <span className={`font-bold ${rateTone(rateOf(row), row.placed, ctx.target)}`}>{Math.round(rateOf(row) ?? 0)}%</span>} sub={(row) => `${row.delivered} delivered`} empty={`No rep has ${MIN} or more orders yet.`} />
          <Performers title="Top Performers (Revenue)" rows={ranked((row) => row.revenue, (row) => row.revenue > 0)} value={(row) => <span className="font-bold text-gray-900 dark:text-slate-100">{money(row.revenue)}</span>} />
          <Performers title="Top Performers (Upsell & Cross-Sell)" rows={ranked((row) => row.upsells + row.crossSells, (row) => row.upsells + row.crossSells > 0)}
            value={(row) => <span className="font-bold text-amber-600">{row.upsells + row.crossSells}</span>} sub={(row) => `add-ons (${Math.round(share(row.upsells + row.crossSells, row.placed) ?? 0)}%)`} empty="No add-ons in this period." />
        </div>
      )}
      <p className="m-0 text-[11.5px] text-gray-500 dark:text-slate-400">Orders placed {ctx.periodLabel}. Confirmed = got past the call; pending = still new. Upsells and cross-sells are counted on those orders. AOV lift = add-on revenue on delivered orders ÷ what those customers first ordered. {ctx.canSeeProfit ? "Net profit uses Finance's rule." : "Net profit is shown to the Owner and Admins."}</p>
    </div>
  );
}

function SummaryTable({ rows, team, ctx }: { rows: RepRow[]; team: RepRow; ctx: RppCtx }) {
  const th = "px-1.5 py-2.5 text-[10.5px] font-medium leading-tight text-gray-500 dark:text-slate-400";
  const td = "px-1.5 py-2.5 text-center text-[12px] text-gray-800 dark:text-slate-200";
  const line = (row: RepRow, total = false) => {
    const rate = share(row.delivered, row.placed);
    const b = total ? "font-bold" : "";
    return (
      <>
        <td className={`${td} ${b}`}>{nf(row.placed)}</td>
        <td className={`${td} ${b}`}>{nf(row.confirmed)}</td>
        <td className={`${td} ${b}`}>{nf(row.pending)}</td>
        <td className={`${td} font-bold ${row.cancelled > 0 ? "!text-rose-600" : ""}`}>{nf(row.cancelled)}</td>
        <td className={`${td} ${b}`}>{nf(row.failed)}</td>
        <td className={`${td} ${b}`}>{nf(row.delivered)}</td>
        <td className={`px-1.5 py-2.5 text-center text-[12px] font-bold ${rateTone(rate, row.placed, ctx.target)}`}>{rate === null ? "-" : `${Math.round(rate)}%`}</td>
        <td className={`${td} whitespace-nowrap ${b}`}>{row.delivered > 0 ? money(row.revenue / row.delivered) : "-"}</td>
        <td className={`${td} whitespace-nowrap ${b}`}>{money(row.revenue)}</td>
        <td className={`px-1.5 py-2.5 text-center text-[12px] font-bold whitespace-nowrap ${ctx.canSeeProfit ? (row.net < 0 ? "text-rose-600" : "text-emerald-600") : "text-gray-400"}`}>{ctx.canSeeProfit ? (row.net < 0 ? `-${money(-row.net)}` : money(row.net)) : "—"}</td>
        <td className={`${td} whitespace-nowrap font-semibold`}>{money(row.bonus)}</td>
        <td className={`${td} ${b}`}>{row.upsells}</td>
        <td className={`${td} ${b}`}>{row.crossSells}</td>
        <td className={`${td} font-bold`}>{row.upsells + row.crossSells}</td>
        <td className={`${td} ${b}`}>{row.originalDelivered > 0 ? `${Math.round((row.addOnRevenue / row.originalDelivered) * 100)}%` : "-"}</td>
      </>
    );
  };
  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1100px] border-collapse">
          <thead><tr className="border-b border-gray-200 dark:border-slate-700">
            {["#", "Sales Rep", "Placed Orders", "Confirmed Orders", "Pending Orders", "Cancelled Orders", "Failed Orders", "Delivered Orders", "Delivery Rate", "Delivered AOV", "Revenue (Delivered)", "Net Profit", "Rep Bonus", "Upsells", "Cross-sells", "Total Add-ons", "AOV Lift", "Actions"].map((label, index) => (
              <th key={label} className={`${th} ${index === 1 ? "text-left" : ""}`}>{label}</th>
            ))}
          </tr></thead>
          <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
            {rows.length === 0 && <tr><td colSpan={18} className="px-4 py-8 text-center text-[13px] text-gray-500">No sales rep matches your search.</td></tr>}
            {rows.map((row, index) => (
              <tr key={row.id} className="hover:bg-gray-50/70 dark:hover:bg-slate-800/40">
                <td className={`${td} text-gray-500`}>{index + 1}</td>
                <td className="px-2 py-2"><span className="flex items-center gap-2"><Avatar name={row.name} size={26} /><span className="max-w-[110px] text-[12px] font-semibold leading-tight text-gray-900 dark:text-slate-100">{row.name}</span></span></td>
                {line(row)}
                <td className="px-2 text-center"><RowActions name={row.name} ctx={ctx} repId={row.id} /></td>
              </tr>
            ))}
            <tr className="border-t-2 border-gray-200 dark:border-slate-700">
              <td />
              <td className="px-2 py-3 text-left text-[13px] font-bold text-gray-900 dark:text-slate-100">Team Total</td>
              {line(team, true)}
              <td />
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RowActions({ name, ctx, repId }: { name: string; ctx: RppCtx; repId: string }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const ref = useClickAway<HTMLDivElement>(open, close);
  const list = ctx.current.filter((order) => (order.repId ?? "") === repId);
  const items: Array<[string, typeof list]> = [
    ["All orders", list],
    ["Delivered orders", list.filter((order) => order.status === "Delivered")],
    ["Cancelled and failed orders", list.filter((order) => order.status === "Cancelled" || order.status === "Failed")],
    ["Orders with an upsell or cross-sell", list.filter((order) => order.hasUpsell || order.crossSells.length > 0)]
  ];
  return (
    <div className="relative inline-block" ref={ref}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-label={`Actions for ${name}`} aria-haspopup="menu" aria-expanded={open}
        className="!min-h-0 inline-flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 dark:border-slate-700 dark:text-slate-300"><MoreVertical className="h-4 w-4" /></button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-30 mt-1 w-60 rounded-xl border border-gray-200 bg-white p-1.5 text-left text-[13px] shadow-xl dark:border-slate-700 dark:bg-slate-900">
          {items.map(([label, orders]) => (
            <button key={label} type="button" role="menuitem" onClick={() => { ctx.openList(`${name} · ${label}`, `${orders.length} order${orders.length === 1 ? "" : "s"} · ${ctx.periodLabel}`, orders); setOpen(false); }}
              className="!min-h-0 flex w-full items-center justify-between rounded-lg px-3 py-2 text-left font-semibold text-gray-800 hover:bg-gray-50 dark:text-slate-100 dark:hover:bg-slate-800">{label}<span className="text-[11px] font-normal text-gray-400">{orders.length}</span></button>
          ))}
        </div>
      )}
    </div>
  );
}

function Performers({ title, rows, value, sub, empty = "No data for this period." }: { title: string; rows: RepRow[]; value: (row: RepRow) => React.ReactNode; sub?: (row: RepRow) => string; empty?: string }) {
  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <h2 className="m-0 mb-3 text-[14px] font-bold text-gray-900 dark:text-slate-100">{title}</h2>
      {rows.length === 0 ? <p className="m-0 text-[12.5px] text-gray-500">{empty}</p> : (
        <ol className="m-0 list-none space-y-2.5 p-0">
          {rows.map((row, index) => (
            <li key={row.id} className="flex items-center gap-2.5 text-[13px]">
              <RankBadge rank={index + 1} /><Avatar name={row.name} size={26} />
              <span className="min-w-0 flex-1 truncate font-semibold text-gray-900 dark:text-slate-100">{row.name}</span>
              <span className="shrink-0">{value(row)}</span>
              {sub && <span className="w-28 shrink-0 text-[12px] text-gray-500">{sub(row)}</span>}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
