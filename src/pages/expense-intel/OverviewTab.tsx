import { useMemo, useState, type ReactNode } from "react";
import {
  Activity, BarChart3, CalendarClock, Coins, Download, Filter, Info, Layers, Percent, PieChart as PieIcon, Plus, RefreshCw, Search, Wallet, Zap
} from "lucide-react";
import { Bar as ChartBar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { TabProps } from "./context";
import { COST_GROUPS, daysCounted, labelOf, monthLabel, reconcile, share, type CostGroup, type EExpense } from "./model";
import { useAlerts, useMonthData, useProductRows } from "./data";
import { AlertRow, AlertsModal } from "./alerts";
import { CategoryPill, ExpenseDrawer, SourcePill, StatusPill, dateTime, useRowFacts } from "./rows";
import { Bar, C, Card, Donut, Empty, Kpi, LinkAction, Modal, btn, delta, downloadCsv, input, select, td, th } from "./ui";

export const GROUP_COLOR: Record<CostGroup, string> = {
  COGS: C.blue, Logistics: C.orange, Advertising: C.green, "Waybill & Shipping": C.purple, "Salaries & Incentives": C.pink, "Other Operating": C.grey
};
export const GROUP_LABEL: Record<CostGroup, string> = {
  COGS: "Cost of Goods (COGS)", Logistics: "Logistics (Delivery & Failed)", Advertising: "Advertising", "Waybill & Shipping": "Waybill & Shipping", "Salaries & Incentives": "Salaries & Incentives", "Other Operating": "Other Operating"
};
const compact = (v: number) => (Math.abs(v) >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : Math.abs(v) >= 1e3 ? `${Math.round(v / 1e3)}K` : String(Math.round(v)));

export default function OverviewTab(p: TabProps & { picker: ReactNode }) {
  const { ctx, period, state } = p;
  const d = useMonthData(p);
  const alerts = useAlerts(p, d);
  const products = useProductRows(p);
  const facts = useRowFacts(ctx);
  const [alertsOpen, setAlertsOpen] = useState<string | null | false>(false);
  const [howOpen, setHowOpen] = useState(false);
  const [drawer, setDrawer] = useState<EExpense | null>(null);
  const [q, setQ] = useState({ search: "", category: "", product: "", status: "" });

  const money = ctx.money;
  const days = daysCounted(period.month, ctx.today);
  const cdays = Number(period.cTo.slice(8));
  const margin = d.now.revenue ? (d.now.netProfit / d.now.revenue) * 100 : null;
  const cmargin = d.before.revenue ? (d.before.netProfit / d.before.revenue) * 100 : null;
  const ratio = d.now.revenue ? (d.business / d.now.revenue) * 100 : null;
  const cratio = d.before.revenue ? (d.cbusiness / d.before.revenue) * 100 : null;
  const series = (pick: (m: (typeof d.months)[number]) => number | null) => d.months.map(pick);
  const per100 = d.now.revenue ? {
    cogs: (d.now.cogs / d.now.revenue) * 100, logistics: (d.now.recognizedLogistics / d.now.revenue) * 100,
    opex: (d.now.operatingExpense / d.now.revenue) * 100, profit: (d.now.netProfit / d.now.revenue) * 100
  } : null;
  const listed = useMemo(() => ctx.mergeWaybills(d.exp), [ctx, d.exp]);
  const recon = reconcile(d.now, d.exp, d.exp.length, listed.length);
  const recent = useMemo(() => {
    const s = q.search.trim().toLowerCase();
    return [...listed].filter((e) => (!q.category || e.category === q.category) && (!q.product || e.productId === q.product) && (!q.status || e.checkStatus === q.status)
      && (!s || `${e.id} ${e.productName} ${e.description} ${facts(e).person}`.toLowerCase().includes(s)))
      .sort((a, b) => (b.createdAt ?? b.date).localeCompare(a.createdAt ?? a.date)).slice(0, 6);
  }, [listed, q, facts]);
  const categories = [...new Set(d.exp.map((e) => e.category))].sort();
  const top5 = products.slice(0, 5);
  const topMax = Math.max(1, ...top5.map((r) => r.totalCost));
  const groupTotal = d.groups.reduce((s, g) => s + g.amount, 0);

  const exportReport = () => downloadCsv(`expense-overview-${period.month}.csv`, [
    ["Expense & Cost Intelligence", monthLabel(period.month), `compared with ${monthLabel(period.compare)}`],
    [], ["Figure", monthLabel(period.month), monthLabel(period.compare)],
    ["Total recorded expenses", Math.round(d.recorded), Math.round(d.crecorded)],
    ["Total business costs", Math.round(d.business), Math.round(d.cbusiness)],
    ["Revenue (delivered)", Math.round(d.now.revenue), Math.round(d.before.revenue)],
    ["Net profit", Math.round(d.now.netProfit), Math.round(d.before.netProfit)],
    ["Net profit margin %", margin?.toFixed(1), cmargin?.toFixed(1)],
    [], ["Cost group", "Amount", "Share %"], ...d.groups.map((g) => [GROUP_LABEL[g.group], Math.round(g.amount), share(g.amount, groupTotal).toFixed(1)]),
    [], ["Product", "Total cost", "Revenue", "Net contribution"], ...products.map((r) => [r.name, Math.round(r.totalCost), Math.round(r.revenue), Math.round(r.contribution)])
  ]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {p.picker}
        <div className="flex flex-wrap gap-2">
          <button type="button" className={btn.outline} onClick={() => { ctx.refresh(); p.reload(); }}><RefreshCw className="h-4 w-4" />Refresh</button>
          <button type="button" className={btn.outline} onClick={exportReport}><Download className="h-4 w-4" />Export Report</button>
          <button type="button" className={btn.primary} onClick={ctx.onAddExpense}><Plus className="h-4 w-4" />Add Expense</button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 min-[1700px]:grid-cols-6">
        <Kpi icon={Layers} tone={C.blue} label="Total Recorded Expenses" value={money(d.recorded)} spark={series((m) => m.recorded)} d={delta(d.recorded, d.crecorded, { lowerIsBetter: true, label: period.cLabel, beforeText: money(d.crecorded) })} onClick={() => p.go("expenses")} />
        <Kpi icon={Wallet} tone={C.purple} label="Total Business Costs" value={money(d.business)} spark={series((m) => m.business)} d={delta(d.business, d.cbusiness, { lowerIsBetter: true, label: period.cLabel, beforeText: money(d.cbusiness) })} onClick={() => setHowOpen(true)} />
        <Kpi icon={BarChart3} tone={C.green} label="Net Profit" value={money(d.now.netProfit)} spark={series((m) => m.s.netProfit)} d={delta(d.now.netProfit, d.before.netProfit, { label: period.cLabel, beforeText: money(d.before.netProfit) })} onClick={() => setHowOpen(true)} />
        <Kpi icon={Percent} tone={C.sky} label="Net Profit Margin" value={margin === null ? "—" : `${margin.toFixed(1)}%`} spark={series((m) => (m.s.revenue ? (m.s.netProfit / m.s.revenue) * 100 : null))} d={delta(margin, cmargin, { points: true, label: period.cLabel, beforeText: cmargin === null ? undefined : `${cmargin.toFixed(1)}%` })} />
        <Kpi icon={CalendarClock} tone={C.teal} label="Avg. Daily Expenses" value={days ? money(d.recorded / days) : "—"} spark={series((m) => m.recorded / Math.max(1, daysCounted(m.m, ctx.today)))} d={delta(days ? d.recorded / days : null, cdays ? d.crecorded / cdays : null, { lowerIsBetter: true, label: period.cLabel, beforeText: cdays ? money(d.crecorded / cdays) : undefined })} />
        <Kpi icon={PieIcon} tone={C.indigo} label="Cost-to-Revenue Ratio" value={ratio === null ? "—" : `${ratio.toFixed(1)}%`} spark={series((m) => (m.s.revenue ? (m.business / m.s.revenue) * 100 : null))} d={delta(ratio, cratio, { points: true, lowerIsBetter: true, label: period.cLabel, beforeText: cratio === null ? undefined : `${cratio.toFixed(1)}%` })} />
      </div>
      {period.month === ctx.today.slice(0, 7) && <p className="m-0 text-[11.5px] text-gray-500">{monthLabel(period.month)} so far ({days} days), compared with the first {cdays} days of {monthLabel(period.compare)}.</p>}

      <div className="grid gap-3 lg:grid-cols-2 min-[1700px]:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <Card title="Financial Health Overview" action={<button type="button" className={btn.link} onClick={() => setHowOpen(true)}><Info className="h-3.5 w-3.5" />How this adds up</button>}>
          <div className="grid grid-cols-2 gap-2 rounded-xl border border-gray-100 p-2 min-[1700px]:grid-cols-4 dark:border-slate-800">
            {[
              { l: "Revenue", v: money(d.now.revenue), c: "text-emerald-600", I: Coins },
              { l: "Total Costs", v: money(d.business), c: "text-rose-600", I: Layers },
              { l: "Net Profit", v: money(d.now.netProfit), c: d.now.netProfit >= 0 ? "text-emerald-600" : "text-rose-600", I: BarChart3 },
              { l: "Profit Margin", v: margin === null ? "—" : `${margin.toFixed(1)}%`, c: "text-gray-900 dark:text-slate-50", I: Percent }
            ].map((x) => (
              <div key={x.l} className="flex min-w-0 items-center gap-2 px-1.5 py-1">
                <x.I className="h-5 w-5 shrink-0 text-gray-400" />
                <span className="min-w-0"><span className="block text-[11.5px] font-semibold text-gray-500">{x.l}</span><b className={`block truncate text-[15px] font-black ${x.c}`}>{x.v}</b></span>
              </div>
            ))}
          </div>
          <h4 className="m-0 mb-2 mt-4 text-[13.5px] font-extrabold text-gray-900 dark:text-slate-50">Where Every ₦100 of Revenue Goes</h4>
          {per100 ? (
            <>
              <div className="flex h-12 w-full overflow-hidden rounded-xl text-white">
                {[
                  { v: per100.cogs, c: C.blue }, { v: per100.logistics, c: C.orange }, { v: per100.opex, c: C.purple }, { v: Math.max(0, per100.profit), c: C.green }
                ].map((s, i) => s.v > 0 && (
                  <div key={i} className="flex min-w-0 flex-col items-center justify-center text-[11px] font-bold leading-tight" style={{ width: `${(s.v / Math.max(100, per100.cogs + per100.logistics + per100.opex + Math.max(0, per100.profit))) * 100}%`, background: s.c }}>
                    {s.v >= 6 && <><span>₦{s.v.toFixed(1)}</span><span className="opacity-90">{s.v.toFixed(1)}%</span></>}
                  </div>
                ))}
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-gray-700 dark:text-slate-300">
                {[["Cost of Goods (COGS)", C.blue], ["Logistics", C.orange], ["Operating Expenses", C.purple], ["Net Profit", C.green]].map(([l, c]) => <span key={l} className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: c }} />{l}</span>)}
              </div>
              {per100.profit < 0 && <p className="m-0 mt-1 text-[12px] font-semibold text-rose-600">Costs are above revenue: a loss of ₦{(-per100.profit).toFixed(1)} on every ₦100.</p>}
            </>
          ) : <Empty>No delivered revenue this month yet.</Empty>}
        </Card>

        <Card title="Expense Trend" sub="Last 6 months">
          <div className="h-[230px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={d.months.map((m) => ({ name: monthLabel(m.m, true), expenses: Math.round(m.recorded), profit: Math.round(m.s.netProfit) }))} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="#eef2f7" vertical={false} />
                <XAxis dataKey="name" tickLine={false} axisLine={false} fontSize={12} />
                <YAxis tickFormatter={(v) => `₦${compact(v)}`} tickLine={false} axisLine={false} fontSize={11} width={56} />
                <Tooltip formatter={(v: number, n) => [money(v), n === "expenses" ? "Total Expenses" : "Net Profit"]} />
                <Legend wrapperStyle={{ fontSize: 12 }} verticalAlign="top" height={24} formatter={(v) => (v === "expenses" ? "Total Expenses" : "Net Profit")} />
                <ChartBar dataKey="expenses" fill="#BFD3FF" radius={[6, 6, 0, 0]} barSize={34} />
                <Line dataKey="expenses" stroke={C.blue} strokeWidth={2} dot={{ r: 3 }} legendType="none" />
                <Line dataKey="profit" stroke={C.green} strokeWidth={2} dot={{ r: 3 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card title={<span className="flex items-center gap-1.5"><Zap className="h-4 w-4 text-amber-500" />Smart Cost Alerts {alerts.open.length > 0 && <span className="rounded-full bg-rose-500 px-1.5 text-[11px] text-white">{alerts.open.length}</span>}</span>} action={<LinkAction onClick={() => setAlertsOpen(null)}>View All</LinkAction>}>
          {alerts.open.length === 0 ? <p className="m-0 rounded-xl bg-emerald-50 px-3 py-3 text-[13px] font-semibold text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-200">No cost alerts this month.</p> : (
            <div className="space-y-2">{alerts.open.slice(0, 4).map((a) => <AlertRow key={a.key} a={a} assigned={alerts.actionOf(a.key)?.assignedToName} onOpen={() => setAlertsOpen(a.key)} />)}</div>
          )}
        </Card>
      </div>

      <div className="grid gap-3 lg:grid-cols-2 min-[1700px]:grid-cols-3">
        <Card title="Expense Breakdown by Category" action={<LinkAction onClick={() => p.go("breakdown")}>View Full Breakdown</LinkAction>}>
          <div className="flex flex-col items-stretch gap-4 min-[1700px]:flex-row min-[1700px]:items-center">
            <Donut data={d.groups.map((g) => ({ name: GROUP_LABEL[g.group], value: g.amount, color: GROUP_COLOR[g.group] }))} center={money(groupTotal)} sub="Total Business Costs" size={170} />
            <table className="!min-w-0 w-full min-w-0">
              <thead><tr><th className={th}>Category</th><th className={`${th} !text-right`}>Amount</th><th className={`${th} !text-right`}>Share</th></tr></thead>
              <tbody>{d.groups.map((g) => (
                <tr key={g.group}><td className={`${td} !py-1.5`}><span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: GROUP_COLOR[g.group] }} />{GROUP_LABEL[g.group]}</span></td>
                  <td className={`${td} !py-1.5 text-right font-semibold`}>{money(g.amount)}</td><td className={`${td} !py-1.5 text-right`}>{share(g.amount, groupTotal).toFixed(1)}%</td></tr>
              ))}</tbody>
            </table>
          </div>
        </Card>

        <Card title="Top 5 Products by Total Cost" action={<LinkAction onClick={() => p.go("product")}>View Details</LinkAction>}>
          {top5.length === 0 ? <Empty>No product costs this month.</Empty> : (
            <ul className="m-0 list-none space-y-2.5 p-0">
              {top5.map((r) => {
                const img = ctx.products.find((x) => x.id === r.productId)?.image;
                return (
                  <li key={r.productId} className="flex items-center gap-3">
                    {img ? <img src={img} alt="" className="h-9 w-9 shrink-0 rounded-lg object-cover" /> : <span className="h-9 w-9 shrink-0 rounded-lg bg-gray-100 dark:bg-slate-800" />}
                    <span className="min-w-0 flex-1"><span className="flex items-center justify-between gap-2"><b className="truncate text-[13px] text-gray-900 dark:text-slate-50">{r.name}</b><b className="shrink-0 text-[13px] text-gray-900 dark:text-slate-50">{money(r.totalCost)}</b></span><Bar value={r.totalCost} max={topMax} /></span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card title={`Budget Performance (${monthLabel(period.month).split(" ")[0]})`} action={<LinkAction onClick={() => p.go("budgets")}>Manage Budgets</LinkAction>}>
          {d.budgets.length === 0 ? <Empty>No budgets set for this month. <button type="button" className={btn.link} onClick={() => p.go("budgets")}>Set budgets</button></Empty> : (
            <table className="!min-w-0 w-full">
              <thead><tr><th className={th}>Category</th><th className={`${th} !text-right`}>Budget</th><th className={`${th} !text-right`}>Spent</th><th className={th}>Usage</th></tr></thead>
              <tbody>{d.budgets.slice(0, 6).map((b) => (
                <tr key={b.category}>
                  <td className={`${td} !py-1.5`}>{labelOf(b.category)}</td>
                  <td className={`${td} !py-1.5 text-right`}>{money(b.budget)}</td>
                  <td className={`${td} !py-1.5 text-right font-semibold`}>{money(b.spent)}</td>
                  <td className={`${td} !py-1.5`}><span className="flex items-center gap-2"><Bar value={b.spent} max={b.budget} color={b.status === "Over Budget" ? C.red : b.status === "At Risk" ? C.orange : C.green} /><span className="w-10 shrink-0 text-right text-[12px]">{b.usage === null ? "—" : `${Math.round(b.usage)}%`}</span></span></td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </Card>
      </div>

      <Card title="Recent Expenses" action={
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative"><Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-gray-400" /><input className={`${input} !pl-9 w-[260px]`} placeholder="Search expense (ID, product, agent, description)…" value={q.search} onChange={(e) => setQ({ ...q, search: e.target.value })} /></label>
          <select className={select} value={q.category} onChange={(e) => setQ({ ...q, category: e.target.value })}><option value="">All Categories</option>{categories.map((c) => <option key={c} value={c}>{labelOf(c)}</option>)}</select>
          <select className={select} value={q.product} onChange={(e) => setQ({ ...q, product: e.target.value })}><option value="">All Products</option>{ctx.products.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
          <select className={select} value={q.status} onChange={(e) => setQ({ ...q, status: e.target.value })}><option value="">All Status</option><option value="verified">Verified</option><option value="auto">Reconciled</option><option value="unchecked">Not checked</option></select>
          <button type="button" className={btn.outline} onClick={() => p.go("expenses")}><Filter className="h-4 w-4" />Filter</button>
        </div>
      }>
        {recent.length === 0 ? <Empty>No expenses match.</Empty> : (
          <div className="overflow-x-auto">
            <table className="w-full !min-w-[900px]">
              <thead><tr className="border-b border-gray-100 dark:border-slate-800">{["Date & Time", "Expense ID", "Category", "Product / Reference", "Amount", "Payment Source", "Description", "Status"].map((h) => <th key={h} className={`${th} ${h === "Amount" ? "!text-right" : ""}`}>{h}</th>)}</tr></thead>
              <tbody>{recent.map((e) => (
                <tr key={e.id} className="cursor-pointer border-b border-gray-50 hover:bg-gray-50 dark:border-slate-800 dark:hover:bg-slate-800/50" onClick={() => setDrawer(e)}>
                  <td className={`${td} whitespace-nowrap`}>{dateTime(e)}</td>
                  <td className={`${td} max-w-[150px] truncate font-mono text-[12px]`} title={e.id}>{e.id}</td>
                  <td className={td}><CategoryPill category={e.category} /></td>
                  <td className={td}>{e.productName || "—"}</td>
                  <td className={`${td} text-right font-bold`}>{money(e.amount)}</td>
                  <td className={td}><SourcePill source={facts(e).source} /></td>
                  <td className={`${td} max-w-[320px] truncate`} title={e.description}>{e.description}{e.partIds ? ` (${e.partIds.length} payments)` : ""}</td>
                  <td className={td}><StatusPill status={e.checkStatus} /></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </Card>

      {alertsOpen !== false && <AlertsModal p={p} open={alerts.open} closed={alerts.closed} actionOf={alerts.actionOf} startKey={alertsOpen} onClose={() => setAlertsOpen(false)} />}
      {drawer && <ExpenseDrawer ctx={ctx} row={drawer} onClose={() => setDrawer(null)} onChanged={() => { ctx.refresh(); setDrawer(null); }} />}
      {howOpen && (
        <Modal wide title="How these numbers add up" sub={`${monthLabel(period.month)}. Same rules as the Dashboard and Finance pages.`} onClose={() => setHowOpen(false)}>
          <table className="!min-w-0 w-full">
            <tbody>
              {[
                ["Recorded expense rows", recon.recorded, `${recon.rawRowCount} records`],
                ["   of which Delivery rows", recon.deliveryRows, "replaced by the orders' own delivery fees below (never counted twice)"],
                ["   of which all other rows", recon.otherRows, "ad spend, waybill, salaries, incentives, airtime, other…"],
                ["Cost of goods (delivered orders)", recon.cogs, "worked out per order: product, bundle, cross-sell, gifts"],
                ["Logistics (delivered orders' fees)", recon.logistics, ""],
                ["Sales & manager bonuses", recon.bonuses, "worked out from the bonus rules, not recorded as rows"],
                ["Total business costs", recon.business, "= COGS + logistics + other rows + bonuses"],
                ["Revenue (delivered orders)", d.now.revenue, ""],
                ["Net profit", d.now.netProfit, "= revenue − total business costs"]
              ].map(([l, v, n]) => (
                <tr key={String(l)} className="border-b border-gray-100 dark:border-slate-800">
                  <td className={`${td} whitespace-pre font-semibold`}>{l}</td><td className={`${td} text-right font-bold`}>{money(Number(v))}</td><td className={`${td} text-[12px] text-gray-500`}>{n}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {recon.deliveryNotCounted > 0 && <p className="m-0 mt-3 rounded-lg bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">{money(recon.deliveryNotCounted)} of Delivery rows are not in costs because the orders' own fees are counted instead. A bulk courier payment recorded only as a Delivery row would be left out: record it under its own category.</p>}
          {recon.mergedAway > 0 && <p className="m-0 mt-2 text-[12.5px] text-gray-600 dark:text-slate-300">The expense list shows {recon.listedLines} lines for {recon.rawRowCount} records: {recon.mergedAway} waybill payments are shown inside their week's waybill line. Every record still counts.</p>}
          <p className="m-0 mt-2 text-[12.5px] text-gray-600 dark:text-slate-300">Manager-wallet top-ups are money moved, not spent: only what the wallet paid out is an expense.</p>
        </Modal>
      )}
    </div>
  );
}

export { COST_GROUPS };
