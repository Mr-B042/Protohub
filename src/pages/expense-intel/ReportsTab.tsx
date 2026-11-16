import { useMemo, useState, type ReactNode } from "react";
import { BarChart3, CalendarClock, CheckCircle2, Download, Eye, FileText, Layers, LineChart as LineIcon, Megaphone, Package, Percent, Sparkles, Target, Trash2, Truck, AlertTriangle, ShoppingCart } from "lucide-react";
import { Bar as ChartBar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { expenseIntelApi } from "../../lib/api";
import type { TabProps } from "./context";
import { addMonths, adTotals, forecast, inRange, labelOf, logisticsBy, monthLabel, pctChange, share, sum } from "./model";
import { useMonthData, useProductRows } from "./data";
import { GROUP_COLOR, GROUP_LABEL } from "./OverviewTab";
import { C, Card, Donut, Empty, Field, Kpi, Modal, Pill, btn, delta, downloadCsv, input, select, td, th } from "./ui";

const compact = (v: number) => (Math.abs(v) >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : Math.abs(v) >= 1e3 ? `${Math.round(v / 1e3)}K` : String(Math.round(v)));
type Table = { title: string; head: string[]; rows: Array<Array<string | number>> };

export default function ReportsTab(p: TabProps & { picker: ReactNode }) {
  const { ctx, period, state } = p;
  const money = ctx.money;
  const d = useMonthData(p);
  const products = useProductRows(p);
  const [view, setView] = useState<Table | null>(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [insightsOpen, setInsightsOpen] = useState(false);

  const ad = adTotals(ctx.orders, d.exp, period.from, period.to), cad = adTotals(ctx.orders, d.cexp, period.cFrom, period.cTo);
  const direct = d.now.cogs + d.now.recognizedLogistics, cdirect = d.before.cogs + d.before.recognizedLogistics;
  const margin = d.now.revenue ? (d.now.netProfit / d.now.revenue) * 100 : null, cmargin = d.before.revenue ? (d.before.netProfit / d.before.revenue) * 100 : null;

  // Forecast from finished months only (a month still running would pull the line down).
  const thisMonth = ctx.today.slice(0, 7);
  const done = d.months.filter((m) => m.m < thisMonth);
  const fc = useMemo(() => {
    const deliveredOf = (m: (typeof d.months)[number]) => ctx.orders.filter((o) => o.status === "Delivered" && inRange(o.deliveredKey, m.from, m.to)).length;
    const cost = forecast(done.map((m) => m.business), 3), ads = forecast(done.map((m) => sum(m.rows.filter((e) => e.category === "Ad Spend"), (e) => e.amount)), 3);
    const del = forecast(done.map(deliveredOf), 3), rev = forecast(done.map((m) => m.s.revenue), 3);
    const last3 = done.slice(-3);
    const tot = (xs: Array<number | null>) => (xs.every((x) => x !== null) ? sum(xs as number[], (x) => x) : null);
    const pc = tot(cost), pa = tot(ads), pd = tot(del), pr = tot(rev);
    const lc = sum(last3, (m) => m.business), la = sum(last3, (m) => sum(m.rows.filter((e) => e.category === "Ad Spend"), (e) => e.amount)), ld = sum(last3, deliveredOf), lr = sum(last3, (m) => m.s.revenue), lp = sum(last3, (m) => m.s.netProfit);
    const pp = pr !== null && pc !== null ? pr - pc : null;
    return { cost, pc, pa, pd, pp, pm: pp !== null && pr ? (pp / pr) * 100 : null, lc, la, ld, lp, lm: lr ? (lp / lr) * 100 : null, enough: done.length >= 3 };
  }, [done, ctx.orders]);
  const firstF = addMonths(done.length ? done[done.length - 1].m : period.month, 1);
  const chart = [
    ...d.months.map((m) => ({ name: monthLabel(m.m, true), total: Math.round(m.business), forecast: null as number | null })),
    ...fc.cost.map((v, i) => ({ name: `${monthLabel(addMonths(firstF, i), true)} (F)`, total: null as number | null, forecast: v === null ? null : Math.round(v) }))
  ];
  const groupTotal = sum(d.groups, (g) => g.amount);

  const reports: Array<{ key: string; I: typeof FileText; c: string; t: string; s: string; table: () => Table; schedule?: string }> = [
    { key: "expenses", I: FileText, c: C.blue, t: "Expense Report", s: "All business expenses by category for the month.", schedule: "expenses",
      table: () => ({ title: "Expense Report", head: ["Category", "Amount", "Records", "Share %"], rows: [...new Set(d.exp.map((e) => e.category))].map((c) => { const r = d.exp.filter((e) => e.category === c); return [labelOf(c), Math.round(sum(r, (e) => e.amount)), r.length, share(sum(r, (e) => e.amount), d.recorded).toFixed(1)]; }).sort((a, b) => Number(b[1]) - Number(a[1])) }) },
    { key: "cogs", I: Layers, c: C.purple, t: "Cost of Goods Sold (COGS) Report", s: "Product cost of delivered orders, by product.",
      table: () => ({ title: "COGS Report", head: ["Product", "Delivered", "COGS", "Revenue", "COGS % of revenue"], rows: products.map((r) => [r.name, r.delivered, Math.round(r.cogs), Math.round(r.revenue), r.revenue ? share(r.cogs, r.revenue).toFixed(1) : "—"]) }) },
    { key: "logistics", I: Truck, c: C.orange, t: "Logistics Cost Report", s: "Delivery, failed delivery and waybill cost by state.",
      table: () => ({ title: "Logistics Cost Report", head: ["State", "Orders", "Delivered", "Delivery rate %", "Total cost", "Avg cost"], rows: logisticsBy(ctx.orders, period.from, period.to, (o) => o.state || "Unknown").rows.map((r) => [r.key, r.orders, r.delivered, r.deliveryRate?.toFixed(1) ?? "—", Math.round(r.totalCost), r.avgCost === null ? "—" : Math.round(r.avgCost)]) }) },
    { key: "advertising", I: Megaphone, c: C.red, t: "Advertising Report", s: "Ad spend, cost per order and return by product.", schedule: "advertising",
      table: () => ({ title: "Advertising Report", head: ["Product", "Ad spend", "Placed", "Delivered", "CPP", "Cost per delivered", "ROAS"], rows: products.filter((r) => r.advertising > 0).map((r) => [r.name, Math.round(r.advertising), r.placed, r.delivered, r.cpp === null ? "—" : Math.round(r.cpp), r.costPerDelivered === null ? "—" : Math.round(r.costPerDelivered), r.advertising ? (r.revenue / r.advertising).toFixed(2) : "—"]) }) },
    { key: "budget", I: Target, c: C.blue, t: "Budget vs Actual Report", s: "Budget use, what is left and over-budget items.", schedule: "budget",
      table: () => ({ title: "Budget vs Actual", head: ["Category", "Budget", "Spent", "Remaining", "Used %", "Status"], rows: d.budgets.map((b) => [labelOf(b.category), b.budget, Math.round(b.spent), Math.round(b.remaining), b.usage?.toFixed(1) ?? "—", b.status]) }) },
    { key: "pl", I: BarChart3, c: C.green, t: "Profit & Loss (P&L) Report", s: "Revenue, costs, net profit and margin (same as Finance).",
      table: () => ({ title: "Profit & Loss", head: ["Line", monthLabel(period.month), monthLabel(period.compare)], rows: [
        ["Revenue (delivered)", Math.round(d.now.revenue), Math.round(d.before.revenue)], ["Cost of goods", Math.round(d.now.cogs), Math.round(d.before.cogs)],
        ["Logistics", Math.round(d.now.recognizedLogistics), Math.round(d.before.recognizedLogistics)], ["Gross profit", Math.round(d.now.grossProfit), Math.round(d.before.grossProfit)],
        ["Recorded operating expenses", Math.round(d.now.recordedOperatingExpense), Math.round(d.before.recordedOperatingExpense)], ["Sales & manager bonuses", Math.round(d.now.totalBonusExpense), Math.round(d.before.totalBonusExpense)],
        ["Net profit", Math.round(d.now.netProfit), Math.round(d.before.netProfit)], ["Net margin %", margin?.toFixed(1) ?? "—", cmargin?.toFixed(1) ?? "—"]
      ] }) }
  ];
  const download = (t: Table) => downloadCsv(`${t.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${period.month}.csv`, [[t.title, monthLabel(period.month)], t.head, ...t.rows]);

  const insights: Array<{ good: boolean; text: string }> = [];
  const ch = pctChange(d.business, d.cbusiness);
  if (ch !== null) insights.push({ good: ch <= 0, text: `Total costs ${ch <= 0 ? "fell" : "rose"} ${Math.abs(ch).toFixed(1)}% compared with ${monthLabel(period.compare)}.` });
  const adBudget = d.budgets.find((b) => b.category === "Ad Spend");
  if (adBudget && adBudget.usage !== null) insights.push({ good: adBudget.usage <= 100, text: `Ad spend is ${adBudget.usage <= 100 ? "within" : "over"} budget (${adBudget.usage.toFixed(1)}% used).` });
  if (margin !== null && cmargin !== null) insights.push({ good: margin >= cmargin, text: `Net margin ${margin >= cmargin ? "improved" : "fell"} from ${cmargin.toFixed(1)}% to ${margin.toFixed(1)}%.` });
  if (fc.pp !== null && fc.lp) { const g = pctChange(fc.pp, fc.lp); if (g !== null) insights.push({ good: g >= 0, text: `The forecast shows ${g >= 0 ? `${g.toFixed(1)}% more` : `${Math.abs(g).toFixed(1)}% less`} profit over the next 3 months than the last 3.` }); }
  const losing = products.filter((r) => r.status === "Losing Money");
  if (losing.length) insights.push({ good: false, text: `${losing.map((r) => r.name).join(", ")} ${losing.length === 1 ? "is" : "are"} losing money this month.` });
  const chip = (now: number | null, before: number, lowerIsBetter = false) => {
    if (now === null || !before) return null;
    const v = ((now - before) / Math.abs(before)) * 100;
    const good = lowerIsBetter ? v <= 0 : v >= 0;
    return <Pill tone={good ? "green" : "red"}>{v >= 0 ? "↑" : "↓"} {Math.abs(v).toFixed(1)}%</Pill>;
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="m-0 text-[22px] font-black text-gray-900 dark:text-slate-50">Reports &amp; Forecasts</h2>
          <p className="m-0 text-[13px] text-gray-500 dark:text-slate-400">Financial reports, trends and a forecast of the next three months.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={btn.outline} onClick={() => reports.forEach((r) => download(r.table()))}><Download className="h-4 w-4" />Export</button>
          <button type="button" className={btn.primary} onClick={() => setScheduleOpen(true)}><CalendarClock className="h-4 w-4" />Schedule Report</button>
        </div>
      </div>
      {p.picker}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <Kpi icon={Layers} tone={C.blue} label="Total Expenses" value={money(d.business)} spark={d.months.map((m) => m.business)} sub="All business costs" d={delta(d.business, d.cbusiness, { lowerIsBetter: true, label: period.cLabel, beforeText: money(d.cbusiness) })} />
        <Kpi icon={ShoppingCart} tone={C.green} label="Total Cost (COGS + Logistics)" value={money(direct)} d={delta(direct, cdirect, { lowerIsBetter: true, label: period.cLabel, beforeText: money(cdirect) })} />
        <Kpi icon={Megaphone} tone={C.purple} label="Total Ad Spend" value={money(ad.spend)} d={delta(ad.spend, cad.spend, { lowerIsBetter: true, label: period.cLabel, beforeText: money(cad.spend) })} />
        <Kpi icon={BarChart3} tone={C.green} label="Net Profit" value={money(d.now.netProfit)} spark={d.months.map((m) => m.s.netProfit)} d={delta(d.now.netProfit, d.before.netProfit, { label: period.cLabel, beforeText: money(d.before.netProfit) })} />
        <Kpi icon={Percent} tone={C.purple} label="Profit Margin" value={margin === null ? "—" : `${margin.toFixed(1)}%`} d={delta(margin, cmargin, { points: true, label: period.cLabel, beforeText: cmargin === null ? undefined : `${cmargin.toFixed(1)}%` })} />
      </div>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card title={<span className="flex items-center gap-2"><LineIcon className="h-5 w-5 text-[#2F6BFF]" />Expense Trend &amp; Forecast</span>}>
          <div className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chart} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="#eef2f7" vertical={false} />
                <XAxis dataKey="name" tickLine={false} axisLine={false} fontSize={11} />
                <YAxis tickFormatter={(v) => `₦${compact(v)}`} tickLine={false} axisLine={false} fontSize={11} width={56} />
                <Tooltip formatter={(v: number, k) => [money(v), k === "total" ? "Total Expenses" : "Forecast"]} />
                <Legend wrapperStyle={{ fontSize: 12 }} verticalAlign="top" height={28} formatter={(v) => (v === "total" ? "Total Expenses" : "Forecast (Next 3 Months)")} />
                <ChartBar dataKey="total" fill="#93B5FF" radius={[6, 6, 0, 0]} barSize={30} />
                <ChartBar dataKey="forecast" fill="#D8C8FF" radius={[6, 6, 0, 0]} barSize={30} />
                <Line dataKey="total" stroke={C.blue} strokeWidth={2} dot={{ r: 3 }} legendType="none" connectNulls />
                <Line dataKey="forecast" stroke={C.purple} strokeWidth={2} strokeDasharray="5 4" dot={{ r: 3 }} legendType="none" connectNulls />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card title={<span className="flex items-center gap-2"><Sparkles className="h-5 w-5 text-violet-500" />Forecast Summary</span>} action={<Pill tone="purple">Next 3 months ({monthLabel(firstF, true)} – {monthLabel(addMonths(firstF, 2), true)})</Pill>}>
          {!fc.enough ? <Empty>Needs at least 3 finished months to forecast.</Empty> : (
            <ul className="m-0 list-none p-0">
              {[
                { I: Package, l: "Projected Total Cost", v: fc.pc === null ? "—" : money(fc.pc), c: chip(fc.pc, fc.lc, true) },
                { I: Megaphone, l: "Projected Ad Spend", v: fc.pa === null ? "—" : money(fc.pa), c: chip(fc.pa, fc.la, true) },
                { I: Truck, l: "Projected Deliveries", v: fc.pd === null ? "—" : `${Math.round(fc.pd).toLocaleString("en-NG")} orders`, c: chip(fc.pd, fc.ld) },
                { I: BarChart3, l: "Projected Net Profit", v: fc.pp === null ? "—" : money(fc.pp), c: chip(fc.pp, fc.lp) },
                { I: Percent, l: "Projected Profit Margin", v: fc.pm === null ? "—" : `${fc.pm.toFixed(1)}%`, c: fc.pm !== null && fc.lm !== null ? <Pill tone={fc.pm >= fc.lm ? "green" : "red"}>{fc.pm >= fc.lm ? "↑" : "↓"} {Math.abs(fc.pm - fc.lm).toFixed(1)}pp</Pill> : null }
              ].map((x) => (
                <li key={x.l} className="flex items-center gap-3 border-b border-gray-100 py-2.5 last:border-0 dark:border-slate-800">
                  <x.I className="h-4 w-4 shrink-0 text-violet-500" /><span className="flex-1 text-[13px] text-gray-700 dark:text-slate-300">{x.l}</span><b className="text-[14px] text-gray-900 dark:text-slate-50">{x.v}</b><span className="w-20 text-right">{x.c}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="m-0 mt-1 text-[11.5px] text-gray-500">Straight line through the last finished months; changes compare with the last 3 months. Net profit here = revenue − total costs, before the weekly bonus rules re-run.</p>
        </Card>
      </div>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <Card title="Reports" sub="View, download or schedule detailed reports.">
          <ul className="m-0 list-none p-0">
            {reports.map((r) => (
              <li key={r.key} className="flex items-center gap-3 border-b border-gray-100 py-2.5 last:border-0 dark:border-slate-800">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" style={{ background: `${r.c}1A`, color: r.c }}><r.I className="h-5 w-5" /></span>
                <span className="min-w-0 flex-1"><b className="block text-[13.5px] text-gray-900 dark:text-slate-50">{r.t}</b><span className="block text-[12px] text-gray-500">{r.s}</span></span>
                <button type="button" className={`${btn.outline} !h-9`} onClick={() => setView(r.table())}><Eye className="h-4 w-4" />View</button>
                <button type="button" aria-label={`Download ${r.t}`} className={`${btn.outline} !h-9 !px-2.5`} onClick={() => download(r.table())}><Download className="h-4 w-4" /></button>
              </li>
            ))}
          </ul>
          {state.schedules.length > 0 && (
            <div className="mt-3 rounded-xl bg-gray-50 p-3 dark:bg-slate-800/60">
              <b className="text-[12.5px] text-gray-800 dark:text-slate-200">Scheduled emails</b>
              <ul className="m-0 mt-1 list-none space-y-1 p-0">{state.schedules.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 text-[12.5px] text-gray-700 dark:text-slate-300">
                  <span>{reports.find((r) => r.schedule === s.report)?.t ?? s.report} · {s.frequency} to {s.emails.join(", ")}{s.lastSentAt ? ` · last sent ${new Date(s.lastSentAt).toLocaleDateString("en-GB")}` : ""}</span>
                  <button type="button" aria-label="Stop" className={btn.icon} onClick={() => { if (window.confirm("Stop this scheduled email?")) void expenseIntelApi.deleteSchedule(s.id).then(p.reload).catch((e: any) => ctx.toast(e?.message ?? "Could not stop.")); }}><Trash2 className="h-4 w-4" /></button>
                </li>
              ))}</ul>
            </div>
          )}
        </Card>

        <div className="space-y-3">
          <Card title="Top Cost Drivers (This Period)">
            <div className="flex flex-col items-stretch gap-3 min-[1700px]:flex-row min-[1700px]:items-center">
              <Donut data={d.groups.map((g) => ({ name: GROUP_LABEL[g.group], value: g.amount, color: GROUP_COLOR[g.group] }))} center={money(groupTotal)} sub="Total Expenses" size={160} />
              <table className="!min-w-0 w-full"><thead><tr><th className={th}>Category</th><th className={`${th} !text-right`}>Amount</th><th className={`${th} !text-right`}>% of Total</th></tr></thead>
                <tbody>{[...d.groups].sort((a, b) => b.amount - a.amount).map((g) => <tr key={g.group}><td className={`${td} !py-1.5`}><span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: GROUP_COLOR[g.group] }} />{GROUP_LABEL[g.group]}</span></td><td className={`${td} !py-1.5 text-right font-semibold`}>{money(g.amount)}</td><td className={`${td} !py-1.5 text-right`}>{share(g.amount, groupTotal).toFixed(1)}%</td></tr>)}</tbody>
              </table>
            </div>
          </Card>
          <Card title="Key Insights & Recommendations" action={insights.length > 3 ? <button type="button" className={btn.link} onClick={() => setInsightsOpen(true)}>View Full Analysis →</button> : undefined} className="!bg-emerald-50/30 dark:!bg-emerald-500/5">
            {insights.length === 0 ? <Empty>Not enough data yet.</Empty> : <ul className="m-0 list-none space-y-2 p-0">{insights.slice(0, 3).map((x, i) => <li key={i} className="flex items-start gap-2 text-[13px] text-gray-800 dark:text-slate-200">{x.good ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />}{x.text}</li>)}</ul>}
          </Card>
        </div>
      </div>

      {view && (
        <Modal wide title={view.title} sub={monthLabel(period.month)} onClose={() => setView(null)} footer={<button type="button" className={btn.primary} onClick={() => download(view)}><Download className="h-4 w-4" />Download CSV</button>}>
          {view.rows.length === 0 ? <Empty>Nothing for this month.</Empty> : (
            <div className="overflow-x-auto"><table className="!min-w-0 w-full">
              <thead><tr className="border-b border-gray-100">{view.head.map((h, i) => <th key={h} className={`${th} ${i ? "!text-right" : ""}`}>{h}</th>)}</tr></thead>
              <tbody>{view.rows.map((r, i) => <tr key={i} className="border-b border-gray-50">{r.map((c, k) => <td key={k} className={`${td} ${k ? "text-right" : "font-semibold"}`}>{typeof c === "number" && Math.abs(c) >= 1000 ? money(c) : c}</td>)}</tr>)}</tbody>
            </table></div>
          )}
        </Modal>
      )}
      {insightsOpen && <Modal title="Key Insights & Recommendations" onClose={() => setInsightsOpen(false)}><ul className="m-0 list-none space-y-2 p-0">{insights.map((x, i) => <li key={i} className="flex items-start gap-2 text-[13px] text-gray-800 dark:text-slate-200">{x.good ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />}{x.text}</li>)}</ul></Modal>}
      {scheduleOpen && <ScheduleModal p={p} onClose={() => setScheduleOpen(false)} />}
    </div>
  );
}

function ScheduleModal({ p, onClose }: { p: TabProps; onClose: () => void }) {
  const [d, setD] = useState({ report: "expenses", frequency: "monthly" as "weekly" | "monthly", emails: "" });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const emails = d.emails.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);
    if (!emails.length || emails.some((x) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x))) { p.ctx.toast("Type one or more email addresses."); return; }
    setBusy(true);
    try { await expenseIntelApi.createSchedule({ report: d.report, frequency: d.frequency, emails }); p.ctx.toast("Report scheduled."); p.reload(); onClose(); }
    catch (e: any) { p.ctx.toast(e?.message ?? "Could not schedule."); } finally { setBusy(false); }
  };
  return (
    <Modal title="Schedule Report" sub="Emailed at 7:30am: weekly on Mondays for last week, monthly on the 1st for last month." onClose={onClose}
      footer={<><button type="button" className={btn.outline} onClick={onClose}>Cancel</button><button type="button" disabled={busy} className={btn.primary} onClick={() => void save()}>Schedule</button></>}>
      <div className="space-y-3">
        <Field label="Report"><select className={input} value={d.report} onChange={(e) => setD({ ...d, report: e.target.value })}><option value="expenses">Expense Report</option><option value="budget">Budget vs Actual Report</option><option value="advertising">Advertising Report</option></select></Field>
        <Field label="How often"><select className={select + " w-full"} value={d.frequency} onChange={(e) => setD({ ...d, frequency: e.target.value as "weekly" | "monthly" })}><option value="monthly">Monthly</option><option value="weekly">Weekly</option></select></Field>
        <Field label="Send to" hint="Up to 5 addresses, separated by commas."><input className={input} value={d.emails} onChange={(e) => setD({ ...d, emails: e.target.value })} placeholder="name@example.com" /></Field>
        <p className="m-0 text-[12px] text-gray-500">Profit reports (COGS, P&amp;L, logistics) need the full order history and are downloaded from this page instead.</p>
      </div>
    </Modal>
  );
}
