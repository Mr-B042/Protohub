import { useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, BarChart3, CheckCircle2, Download, FileBarChart, Layers, Percent, Plus, ShoppingCart, Target, TrendingUp, XCircle } from "lucide-react";
import { Area, Bar as ChartBar, BarChart, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { TabProps } from "./context";
import { lastMonths, monthEnd, monthLabel, monthStart, productRows, share, sum, type ProductRow } from "./model";
import { useProductRows } from "./data";
import { C, Card, Empty, Kpi, Modal, Pill, btn, delta, downloadCsv, select, td, th } from "./ui";

const compact = (v: number) => (Math.abs(v) >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : Math.abs(v) >= 1e3 ? `${Math.round(v / 1e3)}K` : String(Math.round(v)));
export function ProductStatus({ s }: { s: ProductRow["status"] }) {
  if (s === "Profitable") return <Pill tone="green" icon={CheckCircle2}>Profitable</Pill>;
  if (s === "Low Margin") return <Pill tone="amber" icon={AlertTriangle}>Low Margin</Pill>;
  if (s === "Losing Money") return <Pill tone="red" icon={XCircle}>Losing Money</Pill>;
  return <Pill tone="grey">No Sales</Pill>;
}

export default function ProductCostTab(p: TabProps & { picker: ReactNode }) {
  const { ctx, period } = p;
  const money = ctx.money;
  const rows = useProductRows(p);
  const before = useProductRows(p, period.cFrom, period.cTo);
  const [pick, setPick] = useState("");
  const [reportOpen, setReportOpen] = useState(false);
  const chosen = rows.find((r) => r.productId === pick) ?? rows[0] ?? null;
  const months = useMemo(() => lastMonths(period.month, 6).map((m) => {
    const from = monthStart(m), to = monthEnd(m);
    const list = productRows(ctx.orders, p.expensesIn(from, to), from, to, ctx.profit, new Map(ctx.products.map((x) => [x.id, x.name])));
    return { m, list, revenue: sum(list, (r) => r.revenue), cost: sum(list, (r) => r.totalCost), contribution: sum(list, (r) => r.contribution) };
  }), [ctx, p, period.month]);

  const tot = (list: ProductRow[]) => {
    const revenue = sum(list, (r) => r.revenue), cost = sum(list, (r) => r.totalCost), ads = sum(list, (r) => r.advertising), delivered = sum(list, (r) => r.delivered);
    return { revenue, cost, contribution: revenue - cost, margin: revenue ? ((revenue - cost) / revenue) * 100 : null, adPerDelivered: delivered && ads ? ads / delivered : null };
  };
  const n = tot(rows), b = tot(before);
  const chosenTrend = chosen ? months.map((m) => { const r = m.list.find((x) => x.productId === chosen.productId); return { name: monthLabel(m.m, true), revenue: Math.round(r?.revenue ?? 0), cost: Math.round(r?.totalCost ?? 0), contribution: Math.round(r?.contribution ?? 0) }; }) : [];
  const parts = chosen ? [
    { l: "Cost of Goods Sold (COGS)", v: chosen.cogs, c: C.purple }, { l: "Advertising", v: chosen.advertising, c: C.blue }, { l: "Logistics (Delivery)", v: chosen.logistics, c: C.orange },
    { l: "Waybill & Shipping", v: chosen.waybill, c: C.pink }, { l: "Sales Incentives & Bonuses", v: chosen.incentives, c: C.indigo }, { l: "Other Operating Cost", v: chosen.other, c: C.grey }
  ] : [];
  const img = chosen ? ctx.products.find((x) => x.id === chosen.productId)?.image : null;

  const exportCsv = (list = rows) => downloadCsv(`product-profitability-${period.month}.csv`, [
    ["Product", "Revenue", "Total cost", "Net contribution", "Margin %", "Status", "COGS", "Advertising", "Logistics", "Waybill", "Incentives", "Other", "Placed", "Delivered", "Delivery rate %", "AOV", "Ad cost per placed order", "Ad cost per delivered order", "Break-even ad cost per order", "Profit per delivered order", "Failed delivery cost"],
    ...list.map((r) => [r.name, Math.round(r.revenue), Math.round(r.totalCost), Math.round(r.contribution), r.margin?.toFixed(1), r.status, Math.round(r.cogs), Math.round(r.advertising), Math.round(r.logistics), Math.round(r.waybill), Math.round(r.incentives), Math.round(r.other), r.placed, r.delivered, r.deliveryRate?.toFixed(1), r.aov === null ? "" : Math.round(r.aov), r.cpp === null ? "" : Math.round(r.cpp), r.costPerDelivered === null ? "" : Math.round(r.costPerDelivered), r.breakEvenCpp === null ? "" : Math.round(r.breakEvenCpp), r.profitPerDelivered === null ? "" : Math.round(r.profitPerDelivered), Math.round(r.failedCost)])
  ]);
  const metric = (I: typeof ShoppingCart, l: string, v: string, tone: string) => (
    <div className="flex items-center gap-3 rounded-xl bg-gray-50 p-3 dark:bg-slate-800/60">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full" style={{ background: `${tone}1A`, color: tone }}><I className="h-5 w-5" /></span>
      <span className="min-w-0"><span className="block text-[11.5px] font-semibold text-gray-500">{l}</span><b className="block text-[17px] font-black text-gray-900 dark:text-slate-50">{v}</b></span>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="m-0 text-[22px] font-black text-gray-900 dark:text-slate-50">Product Cost Intelligence</h2>
          <p className="m-0 text-[13px] text-gray-500 dark:text-slate-400">The true cost, profit and unit numbers of each product.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={btn.outline} onClick={() => setReportOpen(true)}><FileBarChart className="h-4 w-4" />Product Profitability Report</button>
          <button type="button" className={btn.outline} onClick={() => exportCsv()}><Download className="h-4 w-4" />Export</button>
          <button type="button" className={btn.primary} onClick={ctx.onAddExpense}><Plus className="h-4 w-4" />Add Expense</button>
        </div>
      </div>
      {p.picker}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <Kpi icon={Layers} tone={C.blue} label="Total Revenue" value={money(n.revenue)} spark={months.map((m) => m.revenue)} d={delta(n.revenue, b.revenue, { label: period.cLabel })} />
        <Kpi icon={Layers} tone={C.pink} label="Total Product Cost" value={money(n.cost)} spark={months.map((m) => m.cost)} d={delta(n.cost, b.cost, { lowerIsBetter: true, label: period.cLabel })} />
        <Kpi icon={BarChart3} tone={C.green} label="Net Contribution" value={money(n.contribution)} spark={months.map((m) => m.contribution)} d={delta(n.contribution, b.contribution, { label: period.cLabel })} />
        <Kpi icon={Percent} tone={C.purple} label="Product Margin" value={n.margin === null ? "—" : `${n.margin.toFixed(1)}%`} d={delta(n.margin, b.margin, { points: true, label: period.cLabel })} />
        <Kpi icon={ShoppingCart} tone={C.sky} label="Avg. Ad Cost per Delivered Order" value={n.adPerDelivered === null ? "—" : money(n.adPerDelivered)} d={delta(n.adPerDelivered, b.adPerDelivered, { lowerIsBetter: true, label: period.cLabel })} />
      </div>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card title="Product Profitability Overview" sub="Net contribution = revenue − COGS − logistics − the product's own ads, waybill, bonuses and other costs. Shared overheads are not shared out.">
          {rows.length === 0 ? <Empty>No product sales or costs this month.</Empty> : (
            <div className="overflow-x-auto">
              <table className="w-full !min-w-[640px]">
                <thead><tr className="border-b border-gray-100 dark:border-slate-800">{["Product", "Revenue", "Total Cost", "Net Contribution", "Margin", "Status"].map((h) => <th key={h} className={`${th} ${["Revenue", "Total Cost", "Net Contribution", "Margin"].includes(h) ? "!text-right" : ""}`}>{h}</th>)}</tr></thead>
                <tbody>{rows.map((r) => { const im = ctx.products.find((x) => x.id === r.productId)?.image; return (
                  <tr key={r.productId} onClick={() => setPick(r.productId)} className={`cursor-pointer border-b border-gray-50 hover:bg-gray-50 dark:border-slate-800 dark:hover:bg-slate-800/50 ${chosen?.productId === r.productId ? "bg-blue-50/40 dark:bg-blue-500/10" : ""}`}>
                    <td className={td}><span className="flex items-center gap-2">{im ? <img src={im} alt="" className="h-8 w-8 rounded-lg object-cover" /> : <span className="h-8 w-8 rounded-lg bg-gray-100 dark:bg-slate-800" />}<b className="text-gray-900 dark:text-slate-50">{r.name}</b></span></td>
                    <td className={`${td} text-right`}>{money(r.revenue)}</td>
                    <td className={`${td} text-right`}>{money(r.totalCost)}</td>
                    <td className={`${td} text-right font-bold ${r.contribution >= 0 ? "!text-emerald-600" : "!text-rose-600"}`}>{money(r.contribution)}</td>
                    <td className={`${td} text-right`}>{r.margin === null ? "—" : `${r.margin.toFixed(1)}%`}</td>
                    <td className={td}><ProductStatus s={r.status} /></td>
                  </tr>
                ); })}</tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title="Revenue vs Cost vs Net Contribution" sub="Last 6 months, all products">
          <div className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={months.map((m) => ({ name: monthLabel(m.m, true), revenue: Math.round(m.revenue), cost: Math.round(m.cost), contribution: Math.round(m.contribution) }))} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="#eef2f7" vertical={false} />
                <XAxis dataKey="name" tickLine={false} axisLine={false} fontSize={12} />
                <YAxis tickFormatter={(v) => `₦${compact(v)}`} tickLine={false} axisLine={false} fontSize={11} width={56} />
                <Tooltip formatter={(v: number, k) => [money(v), k === "revenue" ? "Revenue" : k === "cost" ? "Total Cost" : "Net Contribution"]} />
                <Legend wrapperStyle={{ fontSize: 12 }} verticalAlign="top" height={28} formatter={(v) => (v === "revenue" ? "Revenue" : v === "cost" ? "Total Cost" : "Net Contribution")} />
                <ChartBar dataKey="revenue" fill={C.blue} radius={[5, 5, 0, 0]} />
                <ChartBar dataKey="cost" fill={C.pink} radius={[5, 5, 0, 0]} />
                <ChartBar dataKey="contribution" fill={C.green} radius={[5, 5, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      {chosen && (
        <div className="grid gap-3 lg:grid-cols-2 min-[1700px]:grid-cols-3">
          <Card title="Product Cost Breakdown" action={<select className={select} value={chosen.productId} onChange={(e) => setPick(e.target.value)} aria-label="Product">{rows.map((r) => <option key={r.productId} value={r.productId}>{r.name}</option>)}</select>}>
            <div className="flex flex-col gap-3 min-[1700px]:flex-row">
              {img ? <img src={img} alt="" className="h-40 w-full rounded-xl object-cover sm:h-auto sm:w-32" /> : null}
              <table className="!min-w-0 w-full">
                <thead><tr><th className={th}>Cost Component</th><th className={`${th} !text-right`}>Amount</th><th className={`${th} !text-right`}>% of Revenue</th></tr></thead>
                <tbody>
                  {parts.map((x) => <tr key={x.l}><td className={`${td} !py-1.5`}><span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: x.c }} />{x.l}</span></td><td className={`${td} !py-1.5 text-right font-semibold`}>{money(x.v)}</td><td className={`${td} !py-1.5 text-right`}>{chosen.revenue ? `${share(x.v, chosen.revenue).toFixed(1)}%` : "—"}</td></tr>)}
                  <tr className="bg-violet-50/60 dark:bg-violet-500/10"><td className={`${td} font-black`}>Total Cost</td><td className={`${td} text-right font-black`}>{money(chosen.totalCost)}</td><td className={`${td} text-right font-black`}>{chosen.revenue ? `${share(chosen.totalCost, chosen.revenue).toFixed(1)}%` : "—"}</td></tr>
                </tbody>
              </table>
            </div>
          </Card>

          <Card title="Key Product Metrics" sub={`${chosen.name} · ${chosen.placed} placed, ${chosen.delivered} delivered`}>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {metric(ShoppingCart, "Ad Cost per Placed Order", chosen.cpp === null ? "—" : money(chosen.cpp), C.blue)}
              {metric(CheckCircle2, "Ad Cost per Delivered Order", chosen.costPerDelivered === null ? "—" : money(chosen.costPerDelivered), C.green)}
              {metric(TrendingUp, "Delivery Rate", chosen.deliveryRate === null ? "—" : `${chosen.deliveryRate.toFixed(1)}%`, C.green)}
              {metric(Layers, "Average Order Value", chosen.aov === null ? "—" : money(chosen.aov), C.purple)}
              {metric(Target, "Break-even Ad Cost per Order", chosen.breakEvenCpp === null ? "—" : money(chosen.breakEvenCpp), C.red)}
              {metric(BarChart3, "Profit per Delivered Order", chosen.profitPerDelivered === null ? "—" : money(chosen.profitPerDelivered), C.green)}
            </div>
            {chosen.failedCost > 0 && <p className="m-0 mt-2 text-[12px] text-gray-600">Failed delivery fees: {money(chosen.failedCost)}.</p>}
          </Card>

          <Card title="Product Performance Trend" action={<select className={select} value={chosen.productId} onChange={(e) => setPick(e.target.value)} aria-label="Product for trend">{rows.map((r) => <option key={r.productId} value={r.productId}>{r.name}</option>)}</select>}>
            <div className="h-[250px]">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chosenTrend} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="#eef2f7" vertical={false} />
                  <XAxis dataKey="name" tickLine={false} axisLine={false} fontSize={12} />
                  <YAxis tickFormatter={(v) => `₦${compact(v)}`} tickLine={false} axisLine={false} fontSize={11} width={56} />
                  <Tooltip formatter={(v: number, k) => [money(v), k === "revenue" ? "Revenue" : k === "cost" ? "Total Cost" : "Net Contribution"]} />
                  <Legend wrapperStyle={{ fontSize: 12 }} verticalAlign="top" height={28} formatter={(v) => (v === "revenue" ? "Revenue" : v === "cost" ? "Total Cost" : "Net Contribution")} />
                  <Area dataKey="revenue" stroke={C.blue} fill={C.blue} fillOpacity={0.12} strokeWidth={2} dot={{ r: 3 }} />
                  <Line dataKey="cost" stroke={C.pink} strokeWidth={2} dot={{ r: 3 }} />
                  <Line dataKey="contribution" stroke={C.green} strokeWidth={2} dot={{ r: 3 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>
      )}

      {reportOpen && (
        <Modal wide title="Product Profitability Report" sub={`${monthLabel(period.month)} · every product's unit numbers`} onClose={() => setReportOpen(false)} footer={<button type="button" className={btn.primary} onClick={() => exportCsv()}><Download className="h-4 w-4" />Download CSV</button>}>
          <div className="overflow-x-auto">
            <table className="w-full !min-w-[760px]">
              <thead><tr className="border-b border-gray-100">{["Product", "Delivered", "Delivery rate", "AOV", "Ad cost / placed", "Break-even", "Profit / delivered", "Status"].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
              <tbody>{rows.map((r) => (
                <tr key={r.productId} className="border-b border-gray-50">
                  <td className={`${td} font-semibold`}>{r.name}</td><td className={td}>{r.delivered}</td><td className={td}>{r.deliveryRate === null ? "—" : `${r.deliveryRate.toFixed(1)}%`}</td>
                  <td className={td}>{r.aov === null ? "—" : money(r.aov)}</td><td className={td}>{r.cpp === null ? "—" : money(r.cpp)}</td>
                  <td className={td}>{r.breakEvenCpp === null ? "—" : money(r.breakEvenCpp)}</td>
                  <td className={`${td} font-bold ${r.profitPerDelivered !== null && r.profitPerDelivered < 0 ? "!text-rose-600" : ""}`}>{r.profitPerDelivered === null ? "—" : money(r.profitPerDelivered)}</td>
                  <td className={td}><ProductStatus s={r.status} /></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <p className="m-0 mt-2 text-[12px] text-gray-500">Break-even ad cost per order = what a delivered order leaves after product and delivery cost × the share of orders delivered. Spend more than this per placed order and the product loses money on ads.</p>
        </Modal>
      )}
    </div>
  );
}
