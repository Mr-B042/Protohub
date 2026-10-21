import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Info, MoreVertical, ShieldAlert, Star } from "lucide-react";
import { CartesianGrid, Legend, Line, LineChart, Tooltip, XAxis, YAxis } from "recharts";
import { money, shortMoney } from "../lib/money-privacy";
import { shiftDay } from "../lib/date-window";
import { Avatar, ProductThumb } from "./product-trend/parts";
import { rateTone } from "./RepProductPerformancePage";
import type { RepProductOrder } from "./RepProductPerformancePage";
import { Ring } from "./rpp-state-tab";
import { ChartCard, LowerToolbar, MiniBars, MiniSelect, OTHERS_COLOR, RankBadge, SERIES, StateIcon, WaitingForDesign, change, nf, share, type RppCtx } from "./rpp-ui";

// ── Product Trends tab (Bright's design, 21 Oct 2026) ───────────────────────
// Orders PLACED in the period, by product. The design has both "Total Orders"
// and "Placed Orders"; elsewhere on this page "placed" means every order, so
// the second column is shown as "Confirmed Orders" (got past the call).

const LOWER = ["Product Trends Table", "Product Forecast", "Seasonal Trends", "New vs Returning Customers"] as const;
type Lower = (typeof LOWER)[number];
const MIN = 5;

type ProductRow = { key: string; name: string; orders: RepProductOrder[]; placed: number; confirmed: number; delivered: number; revenue: number; net: number; prevPlaced: number };

export default function RppTrendsTab({ ctx }: { ctx: RppCtx }) {
  const [lower, setLower] = useState<Lower>("Product Trends Table");
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"table" | "chart">("table");
  const [allTop, setAllTop] = useState(false);

  const products = useMemo<ProductRow[]>(() => {
    const map = new Map<string, RepProductOrder[]>();
    for (const order of ctx.current) { const list = map.get(order.productKey); if (list) list.push(order); else map.set(order.productKey, [order]); }
    const prev = new Map<string, number>();
    for (const order of ctx.before) prev.set(order.productKey, (prev.get(order.productKey) ?? 0) + 1);
    return [...map].map(([key, orders]) => {
      const f = ctx.funnelOf(orders);
      return { key, name: orders[0].productName || ctx.productName(key), orders, placed: f.placed, confirmed: f.confirmed, delivered: f.delivered, revenue: f.revenue, net: f.net, prevPlaced: prev.get(key) ?? 0 };
    }).sort((a, b) => b.delivered - a.delivered || b.revenue - a.revenue);
  }, [ctx]);
  const [pick, setPick] = useState<string>("");
  const picked = products.find((p) => p.key === pick) ?? products[0];
  const top5 = products.slice(0, 5);
  const totalRevenue = products.reduce((s, p) => s + p.revenue, 0);
  const rate = (row: { placed: number; delivered: number }) => share(row.delivered, row.placed);
  const days = useMemo(() => {
    const out: string[] = [];
    for (let key = ctx.window.start; key <= ctx.window.end && key <= ctx.todayKey && out.length < 62; key = shiftDay(key, 1)) out.push(key);
    return out;
  }, [ctx.window, ctx.todayKey]);
  const perDay = (orders: RepProductOrder[]) => days.map((day) => orders.filter((o) => o.createdKey === day).length);
  const lineData = days.map((day, index) => {
    const entry: Record<string, string | number> = { label: new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" }) };
    for (const p of top5) entry[p.key] = perDay(p.orders)[index];
    return entry;
  });
  const revenueSlices = (() => {
    const sorted = [...products].sort((a, b) => b.revenue - a.revenue).filter((p) => p.revenue > 0);
    const head = sorted.slice(0, 5).map((p, index) => ({ label: p.name, value: p.revenue, color: SERIES[index % SERIES.length], extra: money(p.revenue) }));
    const rest = sorted.slice(5).reduce((s, p) => s + p.revenue, 0);
    return rest > 0 ? [...head, { label: "Others", value: rest, color: OTHERS_COLOR, extra: money(rest) }] : head;
  })();

  const insights = useMemo(() => {
    const out: Array<{ icon: "up" | "star" | "down" | "shield"; title: string; text: string }> = [];
    const moving = products.filter((p) => p.prevPlaced >= 3);
    const growing = [...moving].sort((a, b) => (change(b.placed, b.prevPlaced) ?? 0) - (change(a.placed, a.prevPlaced) ?? 0))[0];
    if (growing && (change(growing.placed, growing.prevPlaced) ?? 0) > 0) out.push({ icon: "up", title: `${growing.name} is growing`, text: `Orders increased by ${Math.round(change(growing.placed, growing.prevPlaced)!)}% ${ctx.compare.replace(/^vs /, "compared to ")}.` });
    const aov = [...products].filter((p) => p.delivered >= 2).sort((a, b) => b.revenue / b.delivered - a.revenue / a.delivered)[0];
    if (aov) out.push({ icon: "star", title: `${aov.name} has highest AOV`, text: `Delivered AOV of ${money(aov.revenue / aov.delivered)}. Good for upsell opportunities.` });
    const declining = [...moving].sort((a, b) => (change(a.placed, a.prevPlaced) ?? 0) - (change(b.placed, b.prevPlaced) ?? 0))[0];
    if (declining && (change(declining.placed, declining.prevPlaced) ?? 0) < 0) out.push({ icon: "down", title: `${declining.name} is declining`, text: `Orders decreased by ${Math.abs(Math.round(change(declining.placed, declining.prevPlaced)!))}%. Review ad creatives and pricing.` });
    const judged = products.filter((p) => p.placed >= MIN);
    const lowest = judged.length > 1 ? [...judged].sort((a, b) => (rate(a) ?? 0) - (rate(b) ?? 0))[0] : undefined;
    if (lowest) out.push({ icon: "shield", title: `${lowest.name} has lowest DR`, text: `Only ${Math.round(rate(lowest) ?? 0)}% delivery rate. Check state performance and customer objections.` });
    return out;
  }, [products, ctx.compare]);

  const topOf = (orders: RepProductOrder[], key: (o: RepProductOrder) => string) => {
    const count = new Map<string, number>();
    for (const o of orders) { const k = key(o); if (k) count.set(k, (count.get(k) ?? 0) + 1); }
    return [...count].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
  };
  const needle = search.trim().toLowerCase();
  const shown = products.filter((p) => !needle || p.name.toLowerCase().includes(needle));
  const th = "px-1.5 py-2.5 text-[10.5px] font-medium leading-tight text-gray-500 dark:text-slate-400";
  const td = "px-1.5 py-2.5 text-center text-[12px] text-gray-800 dark:text-slate-200";
  const net = (value: number) => <td className={`px-1.5 py-2.5 text-center text-[12px] font-bold whitespace-nowrap ${ctx.canSeeProfit ? (value < 0 ? "text-rose-600" : "text-emerald-600") : "text-gray-400"}`}>{ctx.canSeeProfit ? (value < 0 ? `-${money(-value)}` : money(value)) : "—"}</td>;
  const dr = (placed: number, delivered: number) => <td className={`px-1.5 py-2.5 text-center text-[12px] font-bold ${rateTone(share(delivered, placed), placed, ctx.target)}`}>{placed ? `${Math.round((delivered / placed) * 100)}%` : "-"}</td>;

  // The three-across cards are narrow: smaller type so every column shows (as in the design).
  const ths = "px-1 py-2 text-[10px] font-medium leading-tight text-gray-500 dark:text-slate-400";
  const tds = "px-1 py-2 text-center text-[11px] text-gray-800 dark:text-slate-200";
  const netc = (value: number) => <td className={`px-1 py-2 text-center text-[11px] font-bold whitespace-nowrap ${ctx.canSeeProfit ? (value < 0 ? "text-rose-600" : "text-emerald-600") : "text-gray-400"}`}>{ctx.canSeeProfit ? (value < 0 ? `-${money(-value)}` : money(value)) : "—"}</td>;
  const drc = (placed: number, delivered: number) => <td className={`px-1 py-2 text-center text-[11px] font-bold ${rateTone(share(delivered, placed), placed, ctx.target)}`}>{placed ? `${Math.round((delivered / placed) * 100)}%` : "-"}</td>;

  // Breakdowns for the picked product.
  const stateRows = picked ? groupBy(picked.orders, (o) => o.state || "No state").map(([name, orders]) => ({ name, orders, ...ctx.funnelOf(orders) })).sort((a, b) => b.delivered - a.delivered || b.placed - a.placed).slice(0, 5) : [];
  const repRows = picked ? groupBy(picked.orders, (o) => o.repId ?? "").map(([id, orders]) => ({ id, orders, ...ctx.funnelOf(orders) })).sort((a, b) => b.delivered - a.delivered || b.placed - a.placed).slice(0, 5) : [];
  const productOptions = products.map((p) => ({ value: p.key, label: p.name }));

  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-3">
        <section className="min-w-0 rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between gap-2 px-4 pt-4">
            <h2 className="m-0 flex items-center gap-1.5 text-[14.5px] font-bold text-gray-900 dark:text-slate-100">Top Performing Products <span title="Ranked by delivered orders in the period"><Info className="h-3.5 w-3.5 text-gray-400" /></span></h2>
            {products.length > 5 && <button type="button" onClick={() => setAllTop((o) => !o)} className="!min-h-0 rounded-lg border border-indigo-100 bg-indigo-50 px-3 py-1 text-[12px] font-semibold text-indigo-700 dark:border-indigo-500/20 dark:bg-indigo-500/10 dark:text-indigo-300">{allTop ? "Show Less" : "View All"}</button>}
          </div>
          <div className="mt-2 max-h-[330px] overflow-auto px-2 pb-2">
            <table className="w-full !min-w-0 border-collapse">
              <thead><tr className="border-b border-gray-200 dark:border-slate-700">{["#", "Product", "Delivered Orders", "Revenue (Delivered)", "Delivery Rate", "Net Profit"].map((label, i) => <th key={label} className={`${ths} ${i === 1 ? "text-left" : ""}`}>{label}</th>)}</tr></thead>
              <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                {(allTop ? products : top5).map((p, index) => (
                  <tr key={p.key}>
                    <td className="px-1 py-2 text-center"><RankBadge rank={index + 1} /></td>
                    <td className="px-1.5 py-2"><span className="flex items-center gap-2"><ProductThumb src={ctx.imageOf(p.key)} name={p.name} size={22} /><span className="max-w-[92px] text-[11px] font-semibold leading-tight text-gray-900 dark:text-slate-100">{p.name}</span></span></td>
                    <td className={tds}>{p.delivered}</td>
                    <td className={`${tds} whitespace-nowrap`}>{money(p.revenue)}</td>
                    {drc(p.placed, p.delivered)}
                    {netc(p.net)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <ChartCard title="Product Trend (Orders)" height={250} legend={top5.map((p, i) => [SERIES[i % SERIES.length], p.name] as [string, string])}>
          <LineChart data={lineData} margin={{ top: 8, right: 8, left: -22, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eef0f4" />
            <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
            <Tooltip formatter={(value: number, name: string) => [value, top5.find((p) => p.key === name)?.name ?? name]} />
            {top5.map((p, i) => <Line key={p.key} dataKey={p.key} stroke={SERIES[i % SERIES.length]} strokeWidth={2} dot={{ r: 2.5 }} />)}
          </LineChart>
        </ChartCard>
        <section className="min-w-0 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <h2 className="m-0 mb-3 text-[14.5px] font-bold text-gray-900 dark:text-slate-100">Revenue Share by Product</h2>
          <Ring slices={revenueSlices} center={shortMoney(totalRevenue)} sub="Revenue" />
        </section>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <section className="min-w-0 rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4"><h2 className="m-0 text-[14px] font-bold text-gray-900 dark:text-slate-100">Top States by Product (Delivered Orders)</h2>
            <MiniSelect label="Product" value={picked?.key ?? ""} onChange={setPick} options={productOptions} className="w-[160px]" /></div>
          <div className="mt-2 overflow-x-auto px-2 pb-2">
            <table className="w-full !min-w-0 border-collapse">
              <thead><tr className="border-b border-gray-200 dark:border-slate-700">{["#", "State", "Delivered Orders", "Delivery Rate", "Revenue", "Net Profit"].map((label, i) => <th key={label} className={`${ths} ${i === 1 ? "text-left" : ""}`}>{label}</th>)}</tr></thead>
              <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                {stateRows.map((row, index) => (
                  <tr key={row.name}><td className={`${tds} text-gray-500`}>{index + 1}</td>
                    <td className="px-1.5 py-2"><span className="flex items-center gap-2 text-[12px] font-semibold text-gray-900 dark:text-slate-100"><StateIcon name={row.name} size={22} />{row.name}</span></td>
                    <td className={tds}>{row.delivered}</td>{drc(row.placed, row.delivered)}<td className={`${tds} whitespace-nowrap`}>{money(row.revenue)}</td>{netc(row.net)}</tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section className="min-w-0 rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4"><h2 className="m-0 text-[14px] font-bold text-gray-900 dark:text-slate-100">Product Performance by Sales Rep</h2>
            <MiniSelect label="Product" value={picked?.key ?? ""} onChange={setPick} options={productOptions} className="w-[160px]" /></div>
          <div className="mt-2 overflow-x-auto px-2 pb-2">
            <table className="w-full !min-w-0 border-collapse">
              <thead><tr className="border-b border-gray-200 dark:border-slate-700">{["#", "Sales Rep", "Placed", "Delivered", "DR %", "Revenue", "Net Profit"].map((label, i) => <th key={label} className={`${ths} ${i === 1 ? "text-left" : ""}`}>{label}</th>)}</tr></thead>
              <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                {repRows.map((row, index) => (
                  <tr key={row.id}><td className={`${tds} text-gray-500`}>{index + 1}</td>
                    <td className="px-1.5 py-2"><span className="flex items-center gap-2 text-[12px] font-semibold text-gray-900 dark:text-slate-100"><Avatar name={ctx.nameOfRep(row.id)} size={24} />{ctx.nameOfRep(row.id)}</span></td>
                    <td className={tds}>{row.placed}</td><td className={tds}>{row.delivered}</td>{drc(row.placed, row.delivered)}<td className={`${tds} whitespace-nowrap`}>{money(row.revenue)}</td>{netc(row.net)}</tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section className="min-w-0 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <h2 className="m-0 mb-3 text-[14px] font-bold text-gray-900 dark:text-slate-100">Product Trends Insights</h2>
          {insights.length === 0 ? <p className="m-0 text-[12.5px] text-gray-500">Nothing stands out for these filters yet.</p> : (
            <ul className="m-0 list-none space-y-3 p-0">
              {insights.map((item) => (
                <li key={item.title} className="flex gap-2.5">
                  <span className="mt-0.5 shrink-0">{item.icon === "up" ? <ArrowUp className="h-4 w-4 text-emerald-600" /> : item.icon === "down" ? <ArrowDown className="h-4 w-4 text-rose-600" /> : item.icon === "star" ? <Star className="h-4 w-4 fill-amber-400 text-amber-500" /> : <ShieldAlert className="h-4 w-4 text-indigo-600" />}</span>
                  <div className="min-w-0"><div className="text-[12.5px] font-bold text-gray-900 dark:text-slate-100">{item.title}</div><div className="text-[12px] leading-snug text-gray-600 dark:text-slate-400">{item.text}</div></div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <LowerToolbar tabs={LOWER} active={lower} onTab={setLower} search={search} onSearch={setSearch} placeholder="Search product..." view={view} onView={setView} />
      {lower !== "Product Trends Table" ? <WaitingForDesign what={lower} /> : view === "chart" ? (
        <ChartCard title="Orders by day, per product" height={340}>
          <LineChart data={days.map((day, index) => { const e: Record<string, string | number> = { label: day.slice(5) }; for (const p of shown.slice(0, 8)) e[p.key] = perDay(p.orders)[index]; return e; })} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eef0f4" /><XAxis dataKey="label" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
            <Tooltip formatter={(value: number, name: string) => [value, products.find((p) => p.key === name)?.name ?? name]} />
            <Legend formatter={(value: string) => products.find((p) => p.key === value)?.name ?? value} wrapperStyle={{ fontSize: 12 }} />
            {shown.slice(0, 8).map((p, i) => <Line key={p.key} dataKey={p.key} stroke={[...SERIES, "#ef4444", "#14b8a6", "#ec4899"][i]} strokeWidth={2} dot={false} />)}
          </LineChart>
        </ChartCard>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1100px] border-collapse">
              <thead><tr className="border-b border-gray-200 dark:border-slate-700">
                {["#", "Product", "Total Orders", "Confirmed Orders", "Delivered Orders", "DR %", "Delivered AOV", "Revenue (Delivered)", "Net Profit", "Top State", "Top Sales Rep", "Trend", "Actions"].map((label, i) => <th key={label} className={`${th} ${i === 1 || i === 9 || i === 10 ? "text-left" : ""}`}>{label}</th>)}
              </tr></thead>
              <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                {shown.length === 0 && <tr><td colSpan={13} className="px-4 py-8 text-center text-[13px] text-gray-500">No product matches your search.</td></tr>}
                {shown.map((p, index) => {
                  const topState = topOf(p.orders, (o) => o.state);
                  const topRep = topOf(p.orders, (o) => o.repId ?? "");
                  return (
                    <tr key={p.key} className="hover:bg-gray-50/70 dark:hover:bg-slate-800/40">
                      <td className={`${td} text-gray-500`}>{index + 1}</td>
                      <td className="px-2 py-2"><span className="flex items-center gap-2"><ProductThumb src={ctx.imageOf(p.key)} name={p.name} size={26} /><span className="max-w-[140px] text-[12px] font-semibold leading-tight text-gray-900 dark:text-slate-100">{p.name}</span></span></td>
                      <td className={td}>{p.placed}</td><td className={td}>{p.confirmed}</td><td className={td}>{p.delivered}</td>{dr(p.placed, p.delivered)}
                      <td className={`${td} whitespace-nowrap`}>{p.delivered ? money(p.revenue / p.delivered) : "-"}</td><td className={`${td} whitespace-nowrap`}>{money(p.revenue)}</td>{net(p.net)}
                      <td className="px-2 py-2">{topState ? <span className="flex items-center gap-1.5 text-[12px] text-gray-800 dark:text-slate-200"><StateIcon name={topState} size={20} />{topState}</span> : "-"}</td>
                      <td className="px-2 py-2"><span className="flex items-center gap-1.5 text-[12px] text-gray-800 dark:text-slate-200"><Avatar name={ctx.nameOfRep(topRep)} size={22} />{ctx.nameOfRep(topRep)}</span></td>
                      <td className="px-2 py-2 text-center"><MiniBars values={perDay(p.orders).slice(-14)} /></td>
                      <td className="px-2 text-center"><button type="button" aria-label={`${p.name}: show the orders`} onClick={() => ctx.openList(`${p.name} · orders`, `${p.placed} orders · ${ctx.periodLabel}`, p.orders)} className="!min-h-0 inline-flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 dark:border-slate-700 dark:text-slate-300"><MoreVertical className="h-4 w-4" /></button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <p className="m-0 text-[11.5px] text-gray-500 dark:text-slate-400">Orders placed {ctx.periodLabel}. Confirmed = got past the call. Growing / declining compare orders with the period before (products with at least 3 orders then). Trend bars = orders per day (green rising, amber flat, red falling). {nf(products.length)} products.</p>
    </div>
  );
}

function groupBy(orders: RepProductOrder[], key: (o: RepProductOrder) => string): Array<[string, RepProductOrder[]]> {
  const map = new Map<string, RepProductOrder[]>();
  for (const o of orders) { const k = key(o); const list = map.get(k); if (list) list.push(o); else map.set(k, [o]); }
  return [...map];
}
