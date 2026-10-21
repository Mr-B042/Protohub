import { Fragment, useEffect, useMemo, useState } from "react";
import { ArrowRight, BarChart3, CircleDollarSign, Coins, MoreVertical, Percent, TrendingUp } from "lucide-react";
import { Bar, CartesianGrid, ComposedChart, Legend, Line, Tooltip, XAxis, YAxis, BarChart } from "recharts";
import { money } from "../lib/money-privacy";
import { upsellPerformanceApi, type UpsellPerformanceLog } from "../lib/api";
import { shiftDay } from "../lib/date-window";
import { Avatar, ProductThumb, useClickAway } from "./product-trend/parts";
import type { RepProductOrder } from "./RepProductPerformancePage";
import { Ring } from "./rpp-state-tab";
import { ChartCard, KpiCard, LowerToolbar, OTHERS_COLOR, RankBadge, SERIES, WaitingForDesign, change, nf, share, type RppCtx } from "./rpp-ui";
import { useCallback } from "react";

// ── Upsell & Cross-Sell tab (Bright's design, 21 Oct 2026) ──────────────────
// ⚠️ HOW IT COUNTS
// - An add-on sale = one upsell (more pieces of the same product), one
//   cross-sell line, or one extra item. One order can carry several.
// - Counted on the orders PLACED in the period (the rep records them on the
//   call). Add-on rate = add-on sales ÷ orders.
// - Money only from DELIVERED orders: revenue and profit of upsells and
//   cross-sells come from the Upsell & Cross-Sell Bonus tab's own calculation
//   (via addOnFor); extra items add their line amount (they carry no bonus and
//   that calculation does not cost them, so they add revenue but no profit).
// - Funnel "eligible" and "attempted" come from the reps' upsell call log.

const LOWER = ["Sales Rep Performance", "Product Performance", "State Performance", "Order Type Analysis", "Upgrade Funnel", "Add-on Combinations"] as const;
type Lower = (typeof LOWER)[number];

const addOnCount = (order: RepProductOrder) => (order.hasUpsell ? 1 : 0) + order.crossSells.length + order.extras.length;
const hasAddOn = (order: RepProductOrder) => addOnCount(order) > 0;

export default function RppUpsellTab({ ctx }: { ctx: RppCtx }) {
  const [lower, setLower] = useState<Lower>("Sales Rep Performance");
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"table" | "chart">("table");
  const [log, setLog] = useState<UpsellPerformanceLog | null | "error">(null);

  useEffect(() => {
    let cancelled = false;
    setLog(null);
    // Calls can happen a few days after the order: read a little past the end.
    upsellPerformanceApi.log(ctx.window.start, shiftDay(ctx.window.end, 7))
      .then((result) => { if (!cancelled) setLog(result); })
      .catch(() => { if (!cancelled) setLog("error"); });
    return () => { cancelled = true; };
  }, [ctx.window.start, ctx.window.end]);

  const money0 = useCallback((list: RepProductOrder[]) => {
    let revenue = 0, profit = 0;
    for (const order of list) {
      if (order.status !== "Delivered") continue;
      const addOn = ctx.addOnFor(order.id);
      revenue += (addOn?.revenue ?? 0) + order.extras.reduce((sum, line) => sum + line.amount, 0);
      profit += addOn?.profit ?? 0;
    }
    return { revenue, profit };
  }, [ctx]);

  const now = useMemo(() => {
    const sales = ctx.current.reduce((n, o) => n + addOnCount(o), 0);
    return { sales, orders: ctx.current.length, rate: share(sales, ctx.current.length), ...money0(ctx.current) };
  }, [ctx.current, money0]);
  const prev = useMemo(() => {
    const sales = ctx.before.reduce((n, o) => n + addOnCount(o), 0);
    return { sales, orders: ctx.before.length, rate: share(sales, ctx.before.length), ...money0(ctx.before) };
  }, [ctx.before, money0]);

  // Rate by day.
  const trend = useMemo(() => {
    const out: Array<{ label: string; orders: number; rate: number | null }> = [];
    for (let key = ctx.window.start; key <= ctx.window.end && key <= ctx.todayKey && out.length < 62; key = shiftDay(key, 1)) {
      const day = ctx.current.filter((o) => o.createdKey === key);
      const sales = day.reduce((n, o) => n + addOnCount(o), 0);
      out.push({ label: new Date(`${key}T00:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" }), orders: day.length, rate: day.length ? Math.round((sales / day.length) * 1000) / 10 : null });
    }
    return out;
  }, [ctx.current, ctx.window, ctx.todayKey]);

  // Add-on revenue by the product that was added (upsells: the order's product).
  const productRevenue = useMemo(() => {
    const map = new Map<string, { name: string; revenue: number }>();
    const put = (key: string, name: string, amount: number) => { if (amount <= 0) return; const row = map.get(key) ?? { name, revenue: 0 }; row.revenue += amount; map.set(key, row); };
    for (const order of ctx.current) {
      if (order.status !== "Delivered" || !hasAddOn(order)) continue;
      const addOn = ctx.addOnFor(order.id);
      put(order.productKey, order.productName, addOn?.upsellRevenue ?? 0);
      const crossTotal = order.crossSells.reduce((s, l) => s + l.amount, 0);
      for (const line of order.crossSells) put(line.productKey, line.name, crossTotal > 0 && addOn ? (addOn.crossSellRevenue * line.amount) / crossTotal : 0);
      for (const line of order.extras) put(line.productKey, line.name, line.amount);
    }
    return [...map].map(([key, row]) => ({ key, ...row })).sort((a, b) => b.revenue - a.revenue);
  }, [ctx]);
  const productBars = productRevenue.length > 6 ? [...productRevenue.slice(0, 5), { key: "__others", name: "Others", revenue: productRevenue.slice(5).reduce((s, p) => s + p.revenue, 0) }] : productRevenue;
  const types = useMemo(() => ({
    upgrades: ctx.current.filter((o) => o.hasUpsell).length,
    extras: ctx.current.reduce((n, o) => n + o.extras.length, 0),
    cross: ctx.current.reduce((n, o) => n + o.crossSells.length, 0)
  }), [ctx.current]);

  // Combinations: what the customer ended up with.
  const combos = useMemo(() => {
    const map = new Map<string, { label: string; orders: number; revenue: number }>();
    for (const order of ctx.current) {
      if (!hasAddOn(order)) continue;
      const main = `${shortName(order.productName)}${order.hasUpsell && order.upsellToQty ? ` (${order.upsellToQty}pcs)` : ""}`;
      const label = [main, ...order.crossSells.map((l) => shortName(l.name)), ...order.extras.map((l) => shortName(l.name))].join(" + ");
      const row = map.get(label) ?? { label, orders: 0, revenue: 0 };
      row.orders += 1;
      if (order.status === "Delivered") row.revenue += order.amount;
      map.set(label, row);
    }
    return [...map.values()].sort((a, b) => b.orders - a.orders || b.revenue - a.revenue).slice(0, 5);
  }, [ctx.current]);

  // Funnel from the call log, for the orders in view.
  const funnel = useMemo(() => {
    if (!log || log === "error") return null;
    const ids = new Set(ctx.current.map((o) => o.id));
    const calls = log.attempts.filter((call) => ids.has(call.orderId));
    const eligible = new Set(calls.filter((call) => call.eligible).map((call) => call.orderId));
    const attempted = new Set(calls.filter((call) => call.eligible && call.upsell && !["waived_no_offer", "not_appropriate"].includes(call.upsell.response)).map((call) => call.orderId));
    return { eligible: eligible.size, attempted: attempted.size };
  }, [log, ctx.current]);
  const successful = ctx.current.filter(hasAddOn).length;

  const repRows = useMemo(() => ctx.repIds.map((id) => {
    const list = ctx.current.filter((o) => (o.repId ?? "") === id);
    const addOnOrders = list.filter(hasAddOn);
    const m = money0(list);
    const deliveredAddOns = addOnOrders.filter((o) => o.status === "Delivered").length;
    const top = (pairs: Array<[string, string]>) => {
      const count = new Map<string, { name: string; n: number }>();
      for (const [key, name] of pairs) { const row = count.get(key) ?? { name, n: 0 }; row.n += 1; count.set(key, row); }
      const best = [...count].sort((a, b) => b[1].n - a[1].n)[0];
      return best ? { key: best[0], name: best[1].name } : null;
    };
    return {
      id, name: ctx.nameOfRep(id), orders: list.length, addOnOrders: addOnOrders.length,
      upsellOrders: list.filter((o) => o.hasUpsell).length, crossOrders: list.filter((o) => o.crossSells.length > 0).length,
      rate: share(addOnOrders.length, list.length), revenue: m.revenue, profit: m.profit,
      topUpsell: top(list.filter((o) => o.hasUpsell).map((o) => [o.productKey, o.productName] as [string, string])),
      topCross: top(list.flatMap((o) => o.crossSells.map((l) => [l.productKey, l.name] as [string, string]))),
      avg: deliveredAddOns > 0 ? m.revenue / deliveredAddOns : null, list: addOnOrders
    };
  }), [ctx, money0]);
  const needle = search.trim().toLowerCase();
  const shown = repRows.filter((row) => !needle || row.name.toLowerCase().includes(needle));
  const teamAddOnOrders = ctx.current.filter(hasAddOn);
  const teamDeliveredAddOns = teamAddOnOrders.filter((o) => o.status === "Delivered").length;
  const rateTone = (rate: number | null) => (rate === null ? "text-gray-400" : rate >= 10 ? "text-emerald-600" : rate >= 7 ? "text-amber-600" : "text-rose-600");
  const th = "px-1.5 py-2.5 text-[10.5px] font-medium leading-tight text-gray-500 dark:text-slate-400";
  const td = "px-1.5 py-2.5 text-center text-[12px] text-gray-800 dark:text-slate-200";
  const profitCell = (value: number, bold = false) => <td className={`${td} whitespace-nowrap ${bold ? "font-bold" : ""}`}>{ctx.canSeeProfit ? money(value) : "—"}</td>;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <KpiCard icon={<TrendingUp className="h-5 w-5" />} tone="bg-violet-100 text-violet-600" value={nf(now.sales)} label="Upsell & Cross-sell Sales" compare={ctx.compare} delta={change(now.sales, prev.sales)} />
        <KpiCard icon={<BarChart3 className="h-5 w-5" />} tone="bg-blue-100 text-blue-600" value={nf(now.orders)} label="Total Orders" compare={ctx.compare} delta={change(now.orders, prev.orders)} />
        <KpiCard icon={<Percent className="h-5 w-5" />} tone="bg-rose-100 text-rose-600" value={now.rate === null ? "—" : `${now.rate.toFixed(1)}%`} label="Upsell/Cross-sell Rate" compare={ctx.compare} delta={now.rate === null || prev.rate === null ? null : now.rate - prev.rate} points />
        <KpiCard icon={<CircleDollarSign className="h-5 w-5" />} tone="bg-emerald-100 text-emerald-600" value={money(now.revenue)} label="Additional Revenue" compare={ctx.compare} delta={change(now.revenue, prev.revenue)} />
        <KpiCard icon={<Coins className="h-5 w-5" />} tone="bg-amber-100 text-amber-600" value={ctx.canSeeProfit ? money(now.profit) : "—"} label="Net Profit (Add-ons)" compare={ctx.compare} delta={ctx.canSeeProfit ? change(now.profit, prev.profit) : undefined} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <ChartCard title="Upsell/Cross-sell Rate Trend" legend={[["#ddd6fe", "Total Orders"], ["#7c3aed", "Upsell/Cross-sell Rate"]]}>
          <ComposedChart data={trend} margin={{ top: 12, right: 0, left: -22, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eef0f4" />
            <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
            <YAxis yAxisId="orders" tick={{ fontSize: 10 }} allowDecimals={false} />
            <YAxis yAxisId="rate" orientation="right" tick={{ fontSize: 10 }} unit="%" />
            <Tooltip formatter={(value: number, name: string) => (name === "Rate" ? `${value}%` : value)} />
            <Bar yAxisId="orders" dataKey="orders" name="Orders" fill="#ddd6fe" radius={[3, 3, 0, 0]} />
            <Line yAxisId="rate" dataKey="rate" name="Rate" stroke="#7c3aed" strokeWidth={2} dot={{ r: 3 }} connectNulls />
          </ComposedChart>
        </ChartCard>
        <section className="min-w-0 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <h2 className="m-0 mb-4 text-[14.5px] font-bold text-gray-900 dark:text-slate-100">Add-on Revenue by Product</h2>
          {productBars.length === 0 ? <p className="m-0 text-[12.5px] text-gray-500">No delivered add-ons in this period.</p> : (
            <ul className="m-0 list-none space-y-3 p-0">
              {productBars.map((p, index) => (
                <li key={p.key} className="flex items-center gap-2.5">
                  <span className="w-28 shrink-0 truncate text-[12.5px] text-gray-700 dark:text-slate-300" title={p.name}>{p.name}</span>
                  <div className="h-3.5 min-w-0 flex-1 overflow-hidden rounded bg-gray-100 dark:bg-slate-800"><div className="h-full rounded" style={{ width: `${(p.revenue / Math.max(1, productBars[0].revenue)) * 100}%`, background: p.key === "__others" ? OTHERS_COLOR : SERIES[index % SERIES.length] }} /></div>
                  <span className="w-[78px] shrink-0 text-right text-[12px] font-semibold text-gray-900 dark:text-slate-100">{money(p.revenue)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="min-w-0 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <h2 className="m-0 mb-3 text-[14.5px] font-bold text-gray-900 dark:text-slate-100">Add-on Type Distribution</h2>
          <Ring center={nf(types.upgrades + types.extras + types.cross)} sub="Add-on Sales" slices={[
            { label: "Upgrades (Higher Package)", value: types.upgrades, color: "#3b82f6" },
            { label: "Additional Items", value: types.extras, color: "#8b5cf6" },
            { label: "Cross-sell (Different Product)", value: types.cross, color: "#22c55e" }
          ]} />
        </section>
      </div>

      <LowerToolbar tabs={LOWER} active={lower} onTab={setLower} search={search} onSearch={setSearch} placeholder="Search sales rep..." view={view} onView={setView} />

      {lower !== "Sales Rep Performance" ? <WaitingForDesign what={lower} /> : view === "chart" ? (
        <ChartCard title="Add-on orders by rep" height={340} legend={[["#3b82f6", "Upsell orders"], ["#22c55e", "Cross-sell orders"]]}>
          <BarChart data={shown.map((row) => ({ name: row.name, Upsell: row.upsellOrders, "Cross-sell": row.crossOrders }))} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eef0f4" />
            <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} /><YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
            <Tooltip /><Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="Upsell" fill="#3b82f6" radius={[4, 4, 0, 0]} /><Bar dataKey="Cross-sell" fill="#22c55e" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ChartCard>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1080px] border-collapse">
              <thead><tr className="border-b border-gray-200 dark:border-slate-700">
                {["#", "Sales Rep", "Total Orders", "Add-on Orders", "Upsell Orders", "Cross-sell Orders", "Add-on Rate", "Add-on Revenue", "Net Profit (Add-ons)", "Top Upsell Product", "Top Cross-sell Product", "Avg Add-on Value", "Actions"].map((label, index) => (
                  <th key={label} className={`${th} ${index === 1 || index === 9 || index === 10 ? "text-left" : ""}`}>{label}</th>
                ))}
              </tr></thead>
              <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                {shown.map((row, index) => (
                  <tr key={row.id} className="hover:bg-gray-50/70 dark:hover:bg-slate-800/40">
                    <td className={`${td} text-gray-500`}>{index + 1}</td>
                    <td className="px-2 py-2"><span className="flex items-center gap-2"><Avatar name={row.name} size={26} /><span className="max-w-[110px] text-[12px] font-semibold leading-tight text-gray-900 dark:text-slate-100">{row.name}</span></span></td>
                    <td className={td}>{row.orders}</td><td className={td}>{row.addOnOrders}</td><td className={td}>{row.upsellOrders}</td><td className={td}>{row.crossOrders}</td>
                    <td className={`px-1.5 py-2.5 text-center text-[12px] font-bold ${rateTone(row.rate)}`}>{row.rate === null ? "-" : `${row.rate.toFixed(1)}%`}</td>
                    <td className={`${td} whitespace-nowrap`}>{money(row.revenue)}</td>
                    {profitCell(row.profit)}
                    <td className="px-2 py-2">{row.topUpsell ? <ProductCell ctx={ctx} productKey={row.topUpsell.key} name={row.topUpsell.name} /> : <span className="text-[12px] text-gray-400">-</span>}</td>
                    <td className="px-2 py-2">{row.topCross ? <ProductCell ctx={ctx} productKey={row.topCross.key} name={row.topCross.name} /> : <span className="text-[12px] text-gray-400">-</span>}</td>
                    <td className={`${td} whitespace-nowrap`}>{row.avg === null ? "-" : money(row.avg)}</td>
                    <td className="px-2 text-center"><ListButton label={`${row.name}: add-on orders`} onClick={() => ctx.openList(`${row.name} · orders with add-ons`, `${row.list.length} orders · ${ctx.periodLabel}`, row.list)} /></td>
                  </tr>
                ))}
                <tr className="border-t-2 border-gray-200 font-bold dark:border-slate-700">
                  <td />
                  <td className="px-2 py-3 text-left text-[13px] font-bold text-gray-900 dark:text-slate-100">Team Total</td>
                  <td className={`${td} font-bold`}>{ctx.current.length}</td>
                  <td className={`${td} font-bold`}>{teamAddOnOrders.length}</td>
                  <td className={`${td} font-bold`}>{ctx.current.filter((o) => o.hasUpsell).length}</td>
                  <td className={`${td} font-bold`}>{ctx.current.filter((o) => o.crossSells.length > 0).length}</td>
                  <td className={`px-1.5 py-2.5 text-center text-[12px] font-bold ${rateTone(share(teamAddOnOrders.length, ctx.current.length))}`}>{share(teamAddOnOrders.length, ctx.current.length) === null ? "-" : `${share(teamAddOnOrders.length, ctx.current.length)!.toFixed(1)}%`}</td>
                  <td className={`${td} whitespace-nowrap font-bold`}>{money(now.revenue)}</td>
                  {profitCell(now.profit, true)}
                  <td className={`${td} text-gray-400`}>-</td><td className={`${td} text-gray-400`}>-</td>
                  <td className={`${td} whitespace-nowrap font-bold`}>{teamDeliveredAddOns > 0 ? money(now.revenue / teamDeliveredAddOns) : "-"}</td>
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {lower === "Sales Rep Performance" && (
        <div className="grid gap-4 lg:grid-cols-3">
          <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <h2 className="m-0 mb-3 text-[14px] font-bold text-gray-900 dark:text-slate-100">Top 5 Add-on Products (by Revenue)</h2>
            {productRevenue.length === 0 ? <p className="m-0 text-[12.5px] text-gray-500">No delivered add-ons in this period.</p> : (
              <ol className="m-0 list-none space-y-2 p-0">
                {productRevenue.slice(0, 5).map((p, index) => (
                  <li key={p.key} className="flex items-center gap-2 text-[12.5px]">
                    <RankBadge rank={index + 1} /><ProductThumb src={ctx.imageOf(p.key)} name={p.name} size={26} />
                    <span className="min-w-0 flex-1 truncate text-gray-800 dark:text-slate-200">{p.name}</span>
                    <span className="font-semibold text-gray-900 dark:text-slate-100">{money(p.revenue)}</span>
                    <span className="w-9 text-right text-[11px] text-gray-400">{Math.round(share(p.revenue, now.revenue) ?? 0)}%</span>
                  </li>
                ))}
              </ol>
            )}
          </section>
          <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <h2 className="m-0 mb-3 text-[14px] font-bold text-gray-900 dark:text-slate-100">Top 5 Add-on Combinations</h2>
            {combos.length === 0 ? <p className="m-0 text-[12.5px] text-gray-500">No add-ons in this period.</p> : (
              <ol className="m-0 list-none space-y-2 p-0">
                {combos.map((combo, index) => (
                  <li key={combo.label} className="flex items-center gap-2 text-[12.5px]">
                    <RankBadge rank={index + 1} />
                    <span className="min-w-0 flex-1 truncate text-gray-800 dark:text-slate-200" title={combo.label}>{combo.label}</span>
                    <span className="w-16 shrink-0 text-right text-[11px] text-gray-500">{combo.orders} order{combo.orders === 1 ? "" : "s"}</span>
                    <span className="w-[74px] shrink-0 text-right font-semibold text-gray-900 dark:text-slate-100">{money(combo.revenue)}</span>
                  </li>
                ))}
              </ol>
            )}
          </section>
          <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <h2 className="m-0 mb-3 text-[14px] font-bold text-gray-900 dark:text-slate-100">Add-on Funnel ({ctx.periodName})</h2>
            <div className="flex items-stretch gap-1.5">
              {[
                ["Total Orders", now.orders, "bg-blue-50 text-blue-700", "bg-blue-100"],
                ["Eligible for Add-on", funnel?.eligible ?? null, "bg-violet-50 text-violet-700", "bg-violet-100"],
                ["Add-on Attempted", funnel?.attempted ?? null, "bg-amber-50 text-amber-700", "bg-amber-100"],
                ["Successful Add-ons", successful, "bg-emerald-50 text-emerald-700", "bg-emerald-100"]
              ].map(([label, value, tone, foot], index) => (
                <Fragment key={label as string}>
                  {index > 0 && <ArrowRight className="mt-6 h-4 w-4 shrink-0 text-gray-400" />}
                  <div className={`flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl text-center ${tone}`}>
                    <div className="px-1 pt-2 text-[17px] font-black">{value === null ? "—" : nf(value as number)}</div>
                    <div className="flex-1 px-1 pb-2 text-[10.5px] leading-tight text-gray-600">{label as string}</div>
                    <div className={`py-1 text-[13px] font-black ${foot}`}>{value === null || !now.orders ? "—" : `${Math.round(((value as number) / now.orders) * 100)}%`}</div>
                  </div>
                </Fragment>
              ))}
            </div>
            {!funnel && <p className="m-0 mt-2 text-[11px] text-gray-500">{log === "error" ? "The call log could not be loaded." : log === null ? "Loading the call log…" : ""}</p>}
          </section>
        </div>
      )}
      <p className="m-0 text-[11.5px] text-gray-500 dark:text-slate-400">Orders placed {ctx.periodLabel}. An add-on sale = an upsell (more pieces), a cross-sell product or an extra item; rate = add-on sales ÷ orders. Revenue and profit come from delivered orders, using the Upsell &amp; Cross-Sell Bonus tab's calculation (extra items add revenue only). Eligible / attempted come from the reps' upsell call log.</p>
    </div>
  );
}

const shortName = (name: string) => name.replace(/\s+(Storage|Set|SET)\b/g, "").trim();

function ProductCell({ ctx, productKey, name }: { ctx: RppCtx; productKey: string; name: string }) {
  return <span className="flex items-center gap-2"><ProductThumb src={ctx.imageOf(productKey)} name={name} size={26} /><span className="max-w-[120px] text-[12px] leading-tight text-gray-800 dark:text-slate-200">{name}</span></span>;
}

function ListButton({ label, onClick }: { label: string; onClick: () => void }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const ref = useClickAway<HTMLDivElement>(open, close);
  return (
    <div className="relative inline-block" ref={ref}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-label={label} aria-haspopup="menu" aria-expanded={open} className="!min-h-0 inline-flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 dark:border-slate-700 dark:text-slate-300"><MoreVertical className="h-4 w-4" /></button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-30 mt-1 w-52 rounded-xl border border-gray-200 bg-white p-1.5 text-left text-[13px] shadow-xl dark:border-slate-700 dark:bg-slate-900">
          <button type="button" role="menuitem" onClick={() => { onClick(); setOpen(false); }} className="!min-h-0 block w-full rounded-lg px-3 py-2 text-left font-semibold text-gray-800 hover:bg-gray-50 dark:text-slate-100 dark:hover:bg-slate-800">View orders with add-ons</button>
        </div>
      )}
    </div>
  );
}
