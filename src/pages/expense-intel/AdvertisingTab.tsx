import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Download, Layers, Loader2, Megaphone, Percent, Plus, RefreshCw, Search, ShoppingCart, Sparkles, Target, TrendingUp } from "lucide-react";
import { Bar as ChartBar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { trackingHubApi, type HubAdSpend } from "../../lib/api";
import type { TabProps } from "./context";
import { adTotals, lastMonths, monthEnd, monthLabel, monthStart, pctChange, platformSplit, share, sum } from "./model";
import { useMonthData, useProductRows } from "./data";
import { C, Card, Donut, Empty, Kpi, Pill, SERIES, btn, delta, downloadCsv, input, select, td, th } from "./ui";

const compact = (v: number) => (Math.abs(v) >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : Math.abs(v) >= 1e3 ? `${Math.round(v / 1e3)}K` : String(Math.round(v)));
const addDays = (day: string, n: number) => { const d = new Date(`${day}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

export default function AdvertisingTab(p: TabProps & { picker: ReactNode }) {
  const { ctx, period } = p;
  const money = ctx.money;
  const d = useMonthData(p);
  const products = useProductRows(p);
  const now = adTotals(ctx.orders, d.exp, period.from, period.to);
  const before = adTotals(ctx.orders, d.cexp, period.cFrom, period.cTo);
  const [hub, setHub] = useState<HubAdSpend | null>(null);
  const [hubError, setHubError] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [cq, setCq] = useState({ search: "", platform: "" });
  const [all, setAll] = useState(false);

  const to = period.to > ctx.today ? ctx.today : period.to;
  const load = () => {
    setHub(null); setHubError("");
    const len = Math.round((Date.parse(to) - Date.parse(period.from)) / 86400000) + 1;
    trackingHubApi.adSpend({ from: period.from, to, compareFrom: addDays(period.from, -len), compareTo: addDays(period.from, -1), view: "campaign", chartDays: 7, platform: "all" })
      .then(setHub).catch((e: Error) => setHubError(e.message || "Could not load campaigns."));
  };
  useEffect(load, [period.from, to]); // eslint-disable-line react-hooks/exhaustive-deps

  const trend = useMemo(() => lastMonths(period.month, 6).map((m) => {
    const from = monthStart(m), t2 = monthEnd(m);
    const x = adTotals(ctx.orders, p.expensesIn(from, t2), from, t2);
    return { name: monthLabel(m, true), spend: Math.round(x.spend), placed: x.placed, delivered: x.delivered, cpp: x.cpp, rate: x.placed ? (x.delivered / x.placed) * 100 : null };
  }), [ctx.orders, p, period.month]);

  const adProducts = products.filter((r) => r.advertising > 0 || r.placed > 0).sort((a, b) => b.advertising - a.advertising);
  const byProduct = (() => {
    const list = adProducts.filter((r) => r.advertising > 0).map((r, i) => ({ name: r.name, value: r.advertising, color: SERIES[i % SERIES.length] }));
    const linked = sum(list, (x) => x.value);
    if (now.spend - linked > 1) list.push({ name: "No product", value: now.spend - linked, color: C.grey });
    return list;
  })();
  const platforms = platformSplit(d.exp.filter((e) => e.category === "Ad Spend"));

  const insights: Array<{ I: typeof CheckCircle2; tone: string; text: string }> = [];
  const cppChange = now.cpp !== null && before.cpp !== null ? pctChange(now.cpp, before.cpp) : null;
  if (cppChange !== null) insights.push({ I: cppChange <= 0 ? CheckCircle2 : AlertTriangle, tone: cppChange <= 0 ? "text-emerald-600" : "text-amber-500", text: `Cost per placed order ${cppChange <= 0 ? "improved" : "rose"} by ${Math.abs(cppChange).toFixed(1)}% (${money(before.cpp!)} → ${money(now.cpp!)}).` });
  const rNow = now.placed ? (now.delivered / now.placed) * 100 : null, rBefore = before.placed ? (before.delivered / before.placed) * 100 : null;
  if (rNow !== null && rBefore !== null) insights.push({ I: TrendingUp, tone: rNow >= rBefore ? "text-emerald-600" : "text-rose-600", text: `Delivered per placed order: ${rBefore.toFixed(1)}% → ${rNow.toFixed(1)}%.` });
  const withCpp = adProducts.filter((r) => r.cpp !== null && r.placed >= 10);
  const worst = [...withCpp].sort((a, b) => (b.cpp ?? 0) - (a.cpp ?? 0))[0];
  if (worst) insights.push({ I: AlertTriangle, tone: "text-amber-500", text: `${worst.name} has the highest ad cost per order (${money(worst.cpp!)})${worst.breakEvenCpp !== null ? `; its break-even is ${money(worst.breakEvenCpp)}` : ""}.` });
  const roasOf = (r: (typeof adProducts)[number]) => (r.advertising ? r.revenue / r.advertising : null);
  const best = [...adProducts].filter((r) => roasOf(r) !== null && r.delivered >= 5).sort((a, b) => (roasOf(b) ?? 0) - (roasOf(a) ?? 0))[0];
  if (best) insights.push({ I: Target, tone: "text-rose-500", text: `Best return: ${best.name} (${roasOf(best)!.toFixed(2)}× delivered revenue per ₦1 of ads).` });

  const campaigns = (hub?.rows ?? []).filter((r) => (!cq.platform || r.platform === cq.platform) && (!cq.search.trim() || `${r.campaignName ?? r.name} ${r.campaignId ?? ""} ${r.products.map((x) => x.name).join(" ")}`.toLowerCase().includes(cq.search.trim().toLowerCase())))
    .sort((a, b) => b.spend - a.spend);
  const statusOf = (r: (typeof adProducts)[number]) => r.cpp === null ? <span className="text-gray-400">—</span> : r.breakEvenCpp === null ? <Pill tone="grey">No break-even yet</Pill> : r.cpp <= r.breakEvenCpp ? <Pill tone="green">Profitable</Pill> : <Pill tone="amber">Review</Pill>;

  const sync = async () => {
    setSyncing(true);
    try { const r = await trackingHubApi.syncAdSpend({ from: period.from, to }); ctx.toast(r.message || "Ad spend synced."); ctx.refresh(); load(); }
    catch (e: any) { ctx.toast(e?.message ?? "Could not sync."); } finally { setSyncing(false); }
  };
  const exportCsv = () => downloadCsv(`advertising-${period.month}.csv`, [
    ["Product", "Ad spend", "Placed", "Delivered", "DR %", "CPP", "Cost per delivered", "ROAS", "Break-even CPP"],
    ...adProducts.map((r) => [r.name, Math.round(r.advertising), r.placed, r.delivered, r.deliveryRate?.toFixed(1), r.cpp === null ? "" : Math.round(r.cpp), r.costPerDelivered === null ? "" : Math.round(r.costPerDelivered), roasOf(r)?.toFixed(2), r.breakEvenCpp === null ? "" : Math.round(r.breakEvenCpp)]),
    [], ["Campaign", "Platform", "Product", "Ad spend", "Placed", "Delivered", "CPP", "Cost per delivered", "ROAS"],
    ...campaigns.map((r) => [r.campaignName ?? r.name, r.platform ?? "", r.products.map((x) => x.name).join(" + "), Math.round(r.spend), r.orders, r.delivered, r.cpa === null ? "" : Math.round(r.cpa), r.cpdo === null ? "" : Math.round(r.cpdo), r.roas?.toFixed(2)])
  ]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="m-0 text-[22px] font-black text-gray-900 dark:text-slate-50">Advertising Costs</h2>
          <p className="m-0 text-[13px] text-gray-500 dark:text-slate-400">Ad spend, cost per result and return by product, campaign and platform.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={syncing} className={btn.outline} onClick={() => void sync()}>{syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}Sync Ad Spend</button>
          <button type="button" className={btn.outline} onClick={exportCsv}><Download className="h-4 w-4" />Export</button>
          <button type="button" className={btn.primary} onClick={ctx.onAddExpense}><Plus className="h-4 w-4" />Add Ad Expense</button>
        </div>
      </div>
      {p.picker}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 min-[1700px]:grid-cols-6">
        <Kpi icon={Megaphone} tone={C.purple} label="Total Ad Spend" value={money(now.spend)} spark={trend.map((x) => x.spend)} d={delta(now.spend, before.spend, { lowerIsBetter: true, label: period.cLabel, beforeText: money(before.spend) })} />
        <Kpi icon={ShoppingCart} tone={C.blue} label="Placed Orders" value={String(now.placed)} spark={trend.map((x) => x.placed)} d={delta(now.placed, before.placed, { label: period.cLabel, beforeText: String(before.placed) })} />
        <Kpi icon={CheckCircle2} tone={C.green} label="Delivered Orders" value={String(now.delivered)} spark={trend.map((x) => x.delivered)} d={delta(now.delivered, before.delivered, { label: period.cLabel, beforeText: String(before.delivered) })} />
        <Kpi icon={Layers} tone={C.indigo} label="Cost per Placed Order (CPP)" value={now.cpp === null ? "—" : money(now.cpp)} spark={trend.map((x) => x.cpp)} d={delta(now.cpp, before.cpp, { lowerIsBetter: true, label: period.cLabel, beforeText: before.cpp === null ? undefined : money(before.cpp) })} />
        <Kpi icon={Target} tone={C.pink} label="Cost per Delivered Order" value={now.costPerDelivered === null ? "—" : money(now.costPerDelivered)} d={delta(now.costPerDelivered, before.costPerDelivered, { lowerIsBetter: true, label: period.cLabel, beforeText: before.costPerDelivered === null ? undefined : money(before.costPerDelivered) })} />
        <Kpi icon={Percent} tone={C.sky} label="ROAS" value={now.roas === null ? "—" : `${now.roas.toFixed(2)}x`} sub={before.roas === null ? "Delivered revenue ÷ ad spend" : `${period.cLabel}: ${before.roas.toFixed(2)}x`} />
      </div>
      <p className="m-0 text-[11.5px] text-gray-500">Ad spend is what was booked under Ad Spend (Meta and TikTok fill it in by themselves). Orders are all orders placed in the month; campaign rows below use the campaign each order came from.</p>

      <div className="grid gap-3 lg:grid-cols-2 min-[1700px]:grid-cols-[minmax(0,1.2fr)_minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <Card title="Ad Spend vs Orders Trend" sub="Last 6 months">
          <div className="h-[240px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={trend} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="#eef2f7" vertical={false} />
                <XAxis dataKey="name" tickLine={false} axisLine={false} fontSize={12} />
                <YAxis yAxisId="m" tickFormatter={(v) => `₦${compact(v)}`} tickLine={false} axisLine={false} fontSize={11} width={52} />
                <YAxis yAxisId="n" orientation="right" tickLine={false} axisLine={false} fontSize={11} width={36} />
                <Tooltip formatter={(v: number, k) => (k === "spend" ? [money(v), "Ad Spend"] : [v, k === "placed" ? "Placed Orders" : "Delivered Orders"])} />
                <Legend wrapperStyle={{ fontSize: 12 }} verticalAlign="top" height={28} formatter={(v) => (v === "spend" ? "Ad Spend" : v === "placed" ? "Placed Orders" : "Delivered Orders")} />
                <ChartBar yAxisId="m" dataKey="spend" fill="#BFD3FF" radius={[6, 6, 0, 0]} barSize={30} />
                <Line yAxisId="n" dataKey="placed" stroke={C.purple} strokeWidth={2} dot={{ r: 3 }} />
                <Line yAxisId="n" dataKey="delivered" stroke={C.green} strokeWidth={2} dot={{ r: 3 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card title="Ad Spend by Product">
          {byProduct.length === 0 ? <Empty>No ad spend booked this month.</Empty> : (
            <div className="flex flex-col items-stretch gap-3 min-[1700px]:flex-row min-[1700px]:items-center">
              <Donut data={byProduct} center={money(now.spend)} sub="Total Ad Spend" size={170} />
              <ul className="m-0 w-full list-none space-y-1.5 p-0">{byProduct.map((x) => <li key={x.name} className="flex items-center justify-between gap-2 text-[12.5px]"><span className="inline-flex min-w-0 items-center gap-1.5 text-gray-800 dark:text-slate-200"><span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: x.color }} /><span className="truncate">{x.name}</span></span><span className="shrink-0"><b className="text-gray-900 dark:text-slate-100">{money(x.value)}</b> <span className="text-gray-500">{share(x.value, now.spend).toFixed(1)}%</span></span></li>)}</ul>
            </div>
          )}
        </Card>
        <Card title={<span className="flex items-center gap-1.5"><Sparkles className="h-4 w-4 text-emerald-500" />Advertising Insights</span>} className="!bg-emerald-50/30 dark:!bg-emerald-500/5">
          {insights.length === 0 ? <Empty>Not enough data yet.</Empty> : <ul className="m-0 list-none space-y-2.5 p-0">{insights.map((x, i) => <li key={i} className="flex items-start gap-2 text-[12.5px] text-gray-800 dark:text-slate-200"><x.I className={`mt-0.5 h-4 w-4 shrink-0 ${x.tone}`} />{x.text}</li>)}</ul>}
        </Card>
      </div>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Card title="Product Ad Performance" sub="Status: Profitable when the ad cost per placed order is at or under the product's break-even">
          {adProducts.length === 0 ? <Empty>No product ads this month.</Empty> : (
            <div className="overflow-x-auto"><table className="w-full !min-w-[760px]">
              <thead><tr className="border-b border-gray-100 dark:border-slate-800">{["Product", "Ad Spend", "Placed", "Delivered", "DR", "CPP", "Cost/Delivered", "ROAS", "Status"].map((h) => <th key={h} className={`${th} ${h !== "Product" && h !== "Status" ? "!text-right" : ""}`}>{h}</th>)}</tr></thead>
              <tbody>{adProducts.map((r) => { const im = ctx.products.find((x) => x.id === r.productId)?.image; return (
                <tr key={r.productId} className="border-b border-gray-50 dark:border-slate-800">
                  <td className={td}><span className="flex items-center gap-2">{im ? <img src={im} alt="" className="h-7 w-7 rounded-md object-cover" /> : <span className="h-7 w-7 rounded-md bg-gray-100" />}{r.name}</span></td>
                  <td className={`${td} text-right font-semibold`}>{money(r.advertising)}</td><td className={`${td} text-right`}>{r.placed}</td><td className={`${td} text-right`}>{r.delivered}</td>
                  <td className={`${td} text-right`}>{r.deliveryRate === null ? "—" : `${r.deliveryRate.toFixed(1)}%`}</td>
                  <td className={`${td} text-right`}>{r.cpp === null ? "—" : money(r.cpp)}</td><td className={`${td} text-right`}>{r.costPerDelivered === null ? "—" : money(r.costPerDelivered)}</td>
                  <td className={`${td} text-right`}>{roasOf(r) === null ? "—" : `${roasOf(r)!.toFixed(2)}x`}</td><td className={td}>{statusOf(r)}</td>
                </tr>
              ); })}</tbody>
            </table></div>
          )}
        </Card>
        <Card title="Ad Spend by Platform">
          {platforms.length === 0 ? <Empty>No ad spend booked this month.</Empty> : (
            <div className="flex flex-col items-stretch gap-3 min-[1700px]:flex-row min-[1700px]:items-center">
              <Donut data={platforms.map((x, i) => ({ name: x.platform, value: x.amount, color: [C.blue, C.pink, C.orange, C.grey][i % 4] }))} center={money(now.spend)} sub="Total Ad Spend" size={160} />
              <ul className="m-0 w-full list-none space-y-2 p-0">{platforms.map((x, i) => <li key={x.platform} className="flex items-center justify-between gap-2 text-[12.5px]"><span className="inline-flex items-center gap-1.5 text-gray-800 dark:text-slate-200"><span className="h-2.5 w-2.5 rounded-full" style={{ background: [C.blue, C.pink, C.orange, C.grey][i % 4] }} />{x.platform}</span><span><b className="text-gray-900 dark:text-slate-100">{money(x.amount)}</b> <span className="text-gray-500">{x.share.toFixed(1)}%</span></span></li>)}</ul>
            </div>
          )}
          <p className="m-0 mt-2 text-[11.5px] text-gray-500">Meta reports Facebook and Instagram together, so they show as one.</p>
        </Card>
      </div>

      <Card title="Ad Campaigns (Top Performing)" action={
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative"><Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-gray-400" /><input className={`${input} !pl-9 w-[240px]`} placeholder="Search campaign name, ID or product…" value={cq.search} onChange={(e) => setCq({ ...cq, search: e.target.value })} /></label>
          <select className={select} value={cq.platform} onChange={(e) => setCq({ ...cq, platform: e.target.value })}><option value="">All Platforms</option><option value="meta">Meta</option><option value="tiktok">TikTok</option></select>
          <button type="button" className={btn.link} onClick={() => setAll(!all)}>{all ? "Show top 10" : "View All Campaigns"} →</button>
        </div>
      }>
        {hubError ? <Empty>{hubError}</Empty> : !hub ? <p className="m-0 flex items-center gap-2 text-[13px] text-gray-500"><Loader2 className="h-4 w-4 animate-spin" />Loading campaigns…</p> : campaigns.length === 0 ? <Empty>No campaigns spent in this month.</Empty> : (
          <div className="overflow-x-auto"><table className="w-full !min-w-[900px]">
            <thead><tr className="border-b border-gray-100 dark:border-slate-800">{["Campaign Name", "Platform", "Product", "Ad Spend", "Placed Orders", "Delivered Orders", "DR", "CPP", "Cost/Delivered", "ROAS"].map((h) => <th key={h} className={`${th} ${["Ad Spend", "Placed Orders", "Delivered Orders", "DR", "CPP", "Cost/Delivered", "ROAS"].includes(h) ? "!text-right" : ""}`}>{h}</th>)}</tr></thead>
            <tbody>{(all ? campaigns : campaigns.slice(0, 10)).map((r) => (
              <tr key={r.id} className="border-b border-gray-50 dark:border-slate-800">
                <td className={`${td} max-w-[260px] truncate font-semibold`} title={r.campaignName ?? r.name}>{r.campaignName ?? r.name}</td>
                <td className={td}>{r.platform === "tiktok" ? "TikTok" : "Meta"}</td>
                <td className={`${td} max-w-[200px] truncate`}>{r.products.map((x) => x.name).join(" + ") || "—"}</td>
                <td className={`${td} text-right font-bold`}>{money(r.spend)}</td><td className={`${td} text-right`}>{r.orders}</td><td className={`${td} text-right`}>{r.delivered}</td>
                <td className={`${td} text-right`}>{r.orders ? `${((r.delivered / r.orders) * 100).toFixed(1)}%` : "—"}</td>
                <td className={`${td} text-right`}>{r.cpa === null ? "—" : money(r.cpa)}</td><td className={`${td} text-right`}>{r.cpdo === null ? "—" : money(r.cpdo)}</td>
                <td className={`${td} text-right`}>{r.roas === null ? "—" : `${r.roas.toFixed(2)}x`}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
        <p className="m-0 mt-2 text-[11.5px] text-gray-500">For turn-off / scale decisions on each campaign, see Tracking Hub › Ad Spend › Campaign decisions.</p>
      </Card>
    </div>
  );
}
