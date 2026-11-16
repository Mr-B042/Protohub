import { useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Download, Percent, Plus, ShoppingCart, Sparkles, Tag, TrendingDown, TrendingUp, Truck, XCircle } from "lucide-react";
import { Area, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from "recharts";
import type { TabProps } from "./context";
import { inRange, lastMonths, logisticsBy, logisticsTotals, monthEnd, monthLabel, monthStart, pctChange, share, sum, type LogisticsRow } from "./model";
import { useMonthData } from "./data";
import { C, Card, Donut, Empty, Kpi, Modal, Pill, SERIES, btn, delta, downloadCsv, td, th } from "./ui";

const compact = (v: number) => (Math.abs(v) >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : Math.abs(v) >= 1e3 ? `${Math.round(v / 1e3)}K` : String(Math.round(v)));
const StatusTag = ({ s }: { s: LogisticsRow["status"] }) => s === "Efficient" ? <Pill tone="green" icon={CheckCircle2}>Efficient</Pill> : s === "Good" ? <Pill tone="green">Good</Pill> : s === "Review" ? <Pill tone="amber" icon={AlertTriangle}>Review</Pill> : <span className="text-gray-400">—</span>;

export default function LogisticsTab(p: TabProps & { picker: ReactNode }) {
  const { ctx, period } = p;
  const money = ctx.money;
  const d = useMonthData(p);
  const [detail, setDetail] = useState<"state" | "agent" | null>(null);
  const t = d.log, b = d.clog;
  const revenue = d.now.revenue, crevenue = d.before.revenue;
  const states = useMemo(() => logisticsBy(ctx.orders, period.from, period.to, (o) => o.state || "Unknown"), [ctx.orders, period]);
  const agents = useMemo(() => logisticsBy(ctx.orders, period.from, period.to, (o) => o.agentName || "No agent"), [ctx.orders, period]);
  const statesBefore = useMemo(() => new Map(logisticsBy(ctx.orders, period.cFrom, period.cTo, (o) => o.state || "Unknown").rows.map((r) => [r.key, r])), [ctx.orders, period]);
  const cohort = (from: string, to: string) => { const placed = ctx.orders.filter((o) => inRange(o.createdKey, from, to)); return placed.length ? (placed.filter((o) => o.status === "Delivered").length / placed.length) * 100 : null; };
  const rate = cohort(period.from, period.to), crate = cohort(period.cFrom, period.cTo);

  const trend = useMemo(() => lastMonths(period.month, 6).map((m) => {
    const from = monthStart(m), to = monthEnd(m);
    const x = logisticsTotals(ctx.orders, p.expensesIn(from, to), from, to);
    return { name: monthLabel(m, true), total: Math.round(x.total), successful: Math.round(x.successful), failed: Math.round(x.failedCost), waybill: Math.round(x.waybill) };
  }), [ctx.orders, p, period.month]);

  const products = useMemo(() => {
    const ids = new Set(ctx.orders.filter((o) => o.productId && (inRange(o.createdKey, period.from, period.to) || inRange(o.deliveredKey, period.from, period.to))).map((o) => o.productId!));
    return [...ids].map((id) => {
      const placed = ctx.orders.filter((o) => o.productId === id && inRange(o.createdKey, period.from, period.to));
      const delivered = ctx.orders.filter((o) => o.productId === id && o.status === "Delivered" && inRange(o.deliveredKey, period.from, period.to));
      const waybill = sum(d.exp.filter((e) => e.productId === id && (e.category === "Waybill" || e.category === "Clearing & Shipping")), (e) => e.amount);
      const cost = sum(delivered, (o) => o.logistics) + sum(placed.filter((o) => o.status === "Failed"), (o) => o.logistics) + waybill;
      return {
        id, name: ctx.products.find((x) => x.id === id)?.name ?? placed[0]?.productName ?? "Product", orders: placed.length, delivered: delivered.length,
        rate: placed.length ? (placed.filter((o) => o.status === "Delivered").length / placed.length) * 100 : null, cost, perDelivery: delivered.length ? cost / delivered.length : null
      };
    }).sort((a, b2) => b2.cost - a.cost);
  }, [ctx, period, d.exp]);

  const insights: Array<{ I: typeof CheckCircle2; tone: string; text: ReactNode }> = [];
  if (rate !== null) insights.push({ I: CheckCircle2, tone: "text-emerald-600", text: <>Delivery rate: <b>{rate.toFixed(1)}%</b>{crate !== null && <span className={rate >= crate ? "text-emerald-600" : "text-rose-600"}> {rate >= crate ? "↑" : "↓"} {Math.abs(rate - crate).toFixed(1)}pp vs {period.cLabel}</span>}</> });
  for (const r of states.rows) { const old = statesBefore.get(r.key); if (old && r.delivered >= 10 && old.delivered >= 10 && r.avgCost !== null && old.avgCost !== null && Math.abs(r.avgCost - old.avgCost) >= 1000) insights.push({ I: r.avgCost > old.avgCost ? TrendingUp : TrendingDown, tone: r.avgCost > old.avgCost ? "text-rose-600" : "text-emerald-600", text: <>Avg. delivery cost in {r.key} {r.avgCost > old.avgCost ? "rose" : "fell"} by <b>{money(Math.abs(r.avgCost - old.avgCost))}</b>.</> }); }
  const wb = pctChange(t.waybill, b.waybill);
  if (wb !== null && Math.abs(wb) >= 10) insights.push({ I: wb > 0 ? AlertTriangle : TrendingDown, tone: wb > 0 ? "text-amber-500" : "text-emerald-600", text: <>Waybill cost is {Math.abs(Math.round(wb))}% {wb > 0 ? "higher" : "lower"} than {period.cLabel}.</> });
  const fc = t.failedCost - b.failedCost;
  if (b.failedCost > 0 && fc !== 0) insights.push({ I: fc < 0 ? TrendingDown : TrendingUp, tone: fc < 0 ? "text-emerald-600" : "text-rose-600", text: <>Failed delivery cost {fc < 0 ? "reduced" : "rose"} by {money(Math.abs(fc))} ({Math.abs(Math.round((fc / b.failedCost) * 100))}%).</> });
  if (t.failedCount > 0) insights.push({ I: XCircle, tone: "text-gray-500", text: <>{t.failedCount} failed orders; agents charged a fee on {ctx.orders.filter((o) => o.status === "Failed" && inRange(o.createdKey, period.from, period.to) && o.logistics > 0).length} of them.</> });

  const types = [
    { name: "Successful Delivery", value: t.successful, color: C.blue }, { name: "Failed Delivery", value: t.failedCost, color: C.pink },
    { name: "Waybill / Shipping", value: t.waybill, color: C.purple }, { name: "Other delivery payments", value: t.otherDelivery, color: C.grey }
  ];
  const exportCsv = () => downloadCsv(`logistics-${period.month}.csv`, [
    ["Type", "Amount"], ...types.map((x) => [x.name, Math.round(x.value)]), [],
    ["State", "Orders", "Delivered", "Delivery rate %", "Total cost", "Avg cost", "Status"], ...states.rows.map((r) => [r.key, r.orders, r.delivered, r.deliveryRate?.toFixed(1), Math.round(r.totalCost), r.avgCost === null ? "" : Math.round(r.avgCost), r.status]), [],
    ["Agent", "Orders", "Delivered", "Delivery rate %", "Total cost", "Avg cost", "Status"], ...agents.rows.map((r) => [r.key, r.orders, r.delivered, r.deliveryRate?.toFixed(1), Math.round(r.totalCost), r.avgCost === null ? "" : Math.round(r.avgCost), r.status]), [],
    ["Product", "Orders", "Delivered", "Delivery rate %", "Logistics cost", "Cost per delivery"], ...products.map((r) => [r.name, r.orders, r.delivered, r.rate?.toFixed(1), Math.round(r.cost), r.perDelivery === null ? "" : Math.round(r.perDelivery)])
  ]);

  const table = (rows: LogisticsRow[], label: string, limit?: number) => {
    const list = limit ? rows.slice(0, limit) : rows;
    const tot = { orders: sum(rows, (r) => r.orders), delivered: sum(rows, (r) => r.delivered), cost: sum(rows, (r) => r.totalCost) };
    return (
      <div className="overflow-x-auto">
        <table className="w-full !min-w-[560px]">
          <thead><tr className="border-b border-gray-100 dark:border-slate-800">{[label, "Orders", "Delivered", "Delivery Rate", "Total Cost", "Avg. Cost", "Status"].map((h) => <th key={h} className={`${th} ${h !== label && h !== "Status" ? "!text-right" : ""}`}>{h}</th>)}</tr></thead>
          <tbody>
            {list.map((r) => <tr key={r.key} className="border-b border-gray-50 dark:border-slate-800"><td className={`${td} font-semibold`}>{r.key}</td><td className={`${td} text-right`}>{r.orders}</td><td className={`${td} text-right`}>{r.delivered}</td><td className={`${td} text-right`}>{r.deliveryRate === null ? "—" : `${r.deliveryRate.toFixed(1)}%`}</td><td className={`${td} text-right`}>{money(r.totalCost)}</td><td className={`${td} text-right`}>{r.avgCost === null ? "—" : money(r.avgCost)}</td><td className={td}><StatusTag s={r.status} /></td></tr>)}
            <tr className="bg-violet-50/50 dark:bg-violet-500/10"><td className={`${td} font-black`}>Total</td><td className={`${td} text-right font-black`}>{tot.orders}</td><td className={`${td} text-right font-black`}>{tot.delivered}</td><td className={`${td} text-right font-black`}>{tot.orders ? `${((ctx.orders.filter((o) => o.status === "Delivered" && inRange(o.createdKey, period.from, period.to)).length / tot.orders) * 100).toFixed(1)}%` : "—"}</td><td className={`${td} text-right font-black`}>{money(tot.cost)}</td><td className={`${td} text-right font-black`}>{tot.delivered ? money(sum(rows, (r) => (r.avgCost ?? 0) * r.delivered) / tot.delivered) : "—"}</td><td className={td} /></tr>
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="m-0 text-[22px] font-black text-gray-900 dark:text-slate-50">Logistics Costs</h2>
          <p className="m-0 text-[13px] text-gray-500 dark:text-slate-400">Delivery, failed delivery and waybill costs by state, agent and product.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={btn.outline} onClick={exportCsv}><Download className="h-4 w-4" />Export</button>
          <button type="button" className={btn.primary} onClick={ctx.onAddExpense}><Plus className="h-4 w-4" />Add Logistics Expense</button>
        </div>
      </div>
      {p.picker}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 min-[1700px]:grid-cols-6">
        <Kpi icon={Truck} tone={C.blue} label="Total Logistics Cost" value={money(t.total)} spark={trend.map((x) => x.total)} d={delta(t.total, b.total, { lowerIsBetter: true, label: period.cLabel, beforeText: money(b.total) })} />
        <Kpi icon={CheckCircle2} tone={C.green} label="Successful Delivery Cost" value={money(t.successful)} spark={trend.map((x) => x.successful)} d={delta(t.successful, b.successful, { lowerIsBetter: true, label: period.cLabel })} />
        <Kpi icon={XCircle} tone={C.red} label="Failed Delivery Cost" value={money(t.failedCost)} spark={trend.map((x) => x.failed)} d={delta(t.failedCost, b.failedCost, { lowerIsBetter: true, label: period.cLabel })} />
        <Kpi icon={Tag} tone={C.purple} label="Waybill Cost" value={money(t.waybill)} spark={trend.map((x) => x.waybill)} d={delta(t.waybill, b.waybill, { lowerIsBetter: true, label: period.cLabel })} />
        <Kpi icon={ShoppingCart} tone={C.sky} label="Avg. Cost per Delivery" value={t.avgPerDelivery === null ? "—" : money(t.avgPerDelivery)} d={delta(t.avgPerDelivery, b.avgPerDelivery, { lowerIsBetter: true, label: period.cLabel })} />
        <Kpi icon={Percent} tone={C.indigo} label="Logistics as % of Revenue" value={revenue ? `${share(t.total, revenue).toFixed(1)}%` : "—"} d={delta(revenue ? share(t.total, revenue) : null, crevenue ? share(b.total, crevenue) : null, { points: true, lowerIsBetter: true, label: period.cLabel })} />
      </div>

      <div className="grid gap-3 lg:grid-cols-2 min-[1700px]:grid-cols-[minmax(0,1.2fr)_minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <Card title="Logistics Cost Trend" sub="Last 6 months">
          <div className="h-[230px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={trend} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="#eef2f7" vertical={false} />
                <XAxis dataKey="name" tickLine={false} axisLine={false} fontSize={12} />
                <YAxis tickFormatter={(v) => `₦${compact(v)}`} tickLine={false} axisLine={false} fontSize={11} width={52} />
                <Tooltip formatter={(v: number, k) => [money(v), ({ total: "Total Logistics", successful: "Successful Delivery", failed: "Failed Delivery", waybill: "Waybill" } as Record<string, string>)[String(k)]]} />
                <Legend wrapperStyle={{ fontSize: 12 }} verticalAlign="top" height={28} formatter={(v) => ({ total: "Total Logistics", successful: "Successful Delivery", failed: "Failed Delivery", waybill: "Waybill" } as Record<string, string>)[v]} />
                <Area dataKey="total" stroke={C.blue} fill={C.blue} fillOpacity={0.12} strokeWidth={2} dot={{ r: 3 }} />
                <Line dataKey="successful" stroke={C.green} strokeWidth={2} dot={{ r: 3 }} />
                <Line dataKey="failed" stroke={C.pink} strokeWidth={2} dot={{ r: 3 }} />
                <Line dataKey="waybill" stroke={C.purple} strokeWidth={2} dot={{ r: 3 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card title="Logistics Cost by Type">
          <div className="flex flex-col items-stretch gap-3 min-[1700px]:flex-row min-[1700px]:items-center">
            <Donut data={types} center={money(t.total)} sub="Total Logistics" size={170} />
            <ul className="m-0 w-full list-none space-y-2 p-0">{types.map((x) => <li key={x.name} className="flex items-center justify-between gap-2 text-[12.5px]"><span className="inline-flex items-center gap-1.5 text-gray-800 dark:text-slate-200"><span className="h-2.5 w-2.5 rounded-full" style={{ background: x.color }} />{x.name}</span><span className="text-right"><b className="text-gray-900 dark:text-slate-100">{money(x.value)}</b> <span className="text-gray-500">{share(x.value, t.total).toFixed(1)}%</span></span></li>)}</ul>
          </div>
          {t.otherDelivery > 0 && <p className="m-0 mt-2 text-[11.5px] text-gray-500">Other delivery payments: Delivery expenses not tied to an order (e.g. paid from the wallet). Profit counts the orders' own fees instead, so these are listed, not added to profit.</p>}
        </Card>
        <Card title={<span className="flex items-center gap-1.5"><Sparkles className="h-4 w-4 text-emerald-500" />Logistics Insights</span>} className="!bg-emerald-50/30 dark:!bg-emerald-500/5">
          {insights.length === 0 ? <Empty>Nothing stands out this month.</Empty> : <ul className="m-0 list-none space-y-2.5 p-0">{insights.slice(0, 5).map((x, i) => <li key={i} className="flex items-start gap-2 text-[12.5px] text-gray-800 dark:text-slate-200"><x.I className={`mt-0.5 h-4 w-4 shrink-0 ${x.tone}`} /><span>{x.text}</span></li>)}</ul>}
        </Card>
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        <Card title="Logistics by State" action={<button type="button" className={btn.link} onClick={() => setDetail("state")}>View Details →</button>}>{states.rows.length ? table(states.rows, "State", 6) : <Empty>No orders this month.</Empty>}</Card>
        <Card title="Logistics by Agent" action={<button type="button" className={btn.link} onClick={() => setDetail("agent")}>View Details →</button>}>{agents.rows.length ? table(agents.rows, "Agent / Partner", 6) : <Empty>No orders this month.</Empty>}</Card>
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        <Card title="Logistics Cost by Product" sub="Delivered and failed fees plus the product's waybill">
          {products.length === 0 ? <Empty>No orders this month.</Empty> : (
            <div className="overflow-x-auto"><table className="w-full !min-w-[520px]">
              <thead><tr className="border-b border-gray-100 dark:border-slate-800">{["Product", "Orders", "Delivered", "DR", "Logistics Cost", "Cost per Delivery"].map((h) => <th key={h} className={`${th} ${h !== "Product" ? "!text-right" : ""}`}>{h}</th>)}</tr></thead>
              <tbody>{products.map((r) => { const im = ctx.products.find((x) => x.id === r.id)?.image; return (
                <tr key={r.id} className="border-b border-gray-50 dark:border-slate-800"><td className={td}><span className="flex items-center gap-2">{im ? <img src={im} alt="" className="h-7 w-7 rounded-md object-cover" /> : <span className="h-7 w-7 rounded-md bg-gray-100" />}{r.name}</span></td><td className={`${td} text-right`}>{r.orders}</td><td className={`${td} text-right`}>{r.delivered}</td><td className={`${td} text-right`}>{r.rate === null ? "—" : `${r.rate.toFixed(1)}%`}</td><td className={`${td} text-right font-semibold`}>{money(r.cost)}</td><td className={`${td} text-right`}>{r.perDelivery === null ? "—" : money(r.perDelivery)}</td></tr>
              ); })}</tbody>
            </table></div>
          )}
        </Card>
        <Card title="Delivery Rate & Logistics Cost Correlation" sub="Each dot is a product: bigger = more orders">
          {products.filter((r) => r.rate !== null && r.perDelivery !== null).length === 0 ? <Empty>Not enough deliveries yet.</Empty> : (
            <div className="flex flex-col gap-3 lg:flex-row">
              <div className="h-[230px] min-w-0 flex-1">
                <ResponsiveContainer width="100%" height="100%">
                  <ScatterChart margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
                    <CartesianGrid stroke="#eef2f7" />
                    <XAxis type="number" dataKey="x" name="Cost per delivery" tickFormatter={(v) => `₦${compact(v)}`} fontSize={11} />
                    <YAxis type="number" dataKey="y" name="Delivery rate" unit="%" fontSize={11} width={44} domain={["auto", "auto"]} />
                    <ZAxis type="number" dataKey="z" range={[60, 400]} />
                    <Tooltip formatter={(v: number, n) => (n === "Delivery rate" ? `${v.toFixed(1)}%` : n === "Cost per delivery" ? money(v) : v)} />
                    {products.filter((r) => r.rate !== null && r.perDelivery !== null).map((r, i) => <Scatter key={r.id} name={r.name} data={[{ x: r.perDelivery, y: r.rate, z: r.orders }]} fill={SERIES[i % SERIES.length]} />)}
                  </ScatterChart>
                </ResponsiveContainer>
              </div>
              <ul className="m-0 list-none space-y-1.5 p-0 text-[12px] lg:w-56">{products.filter((r) => r.rate !== null && r.perDelivery !== null).map((r, i) => <li key={r.id} className="flex items-center justify-between gap-2"><span className="inline-flex min-w-0 items-center gap-1.5 text-gray-800 dark:text-slate-200"><span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: SERIES[i % SERIES.length] }} /><span className="truncate">{r.name}</span></span><span className="shrink-0 text-gray-500">DR {r.rate!.toFixed(1)}% · {money(r.perDelivery!)}</span></li>)}</ul>
            </div>
          )}
        </Card>
      </div>

      {detail && <Modal wide title={detail === "state" ? "Logistics by State" : "Logistics by Agent"} sub={`${monthLabel(period.month)}. Status compares each with the month's average delivery rate and cost.`} onClose={() => setDetail(null)}>{table(detail === "state" ? states.rows : agents.rows, detail === "state" ? "State" : "Agent / Partner")}</Modal>}
    </div>
  );
}
