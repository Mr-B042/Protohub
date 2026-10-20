import { useCallback, useMemo, useState, type ReactNode } from "react";
import {
  AlertCircle, Banknote, BarChart3, CircleAlert, CirclePercent, Clock3, Columns3, Download, Ellipsis, Lightbulb, Package, Plus, Search, ShoppingCart, TrendingUp, Truck, Users, X
} from "lucide-react";
import { Area, AreaChart, Bar, CartesianGrid, ComposedChart, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  AGENT_STATUSES, ALL, MIN_RATE_SAMPLE, buildAgentRows, countBins, figuresFor, growthPct, isDelivered, seriesOver, stateLabel, agentStatusOf, bucketKeys, bucketOf,
  type AgentRow, type AgentStatusKey, type Granularity, type TrendOrder
} from "./product-trend-model";
import { Avatar, Delta, Donut, InsightCard, KpiTile, NigeriaMap, Panel, Pill, ProductThumb, SERIES_COLORS, Segmented, SelectBox, SidePanel, countLegend, downloadCsv, nf, pct1, useClickAway } from "./parts";
import { NET_NOTE, td, th } from "./DetailPanels";
import { mapKey, netOf, rateOf, rateTone, sparkOf, type TabCtx } from "./tab-context";

// Agent Performance and Trends Over Time (Bright's designs, 20 Oct 2026).

const statusInfo = (key: AgentStatusKey) => key === "new"
  ? { label: "Too few orders", tone: "gray" as const, color: "#94a3b8" }
  : (() => {
    const s = AGENT_STATUSES.find((x) => x.key === key)!;
    const tone = key === "top" || key === "strong" ? "green" : key === "potential" ? "blue" : key === "watch" ? "amber" : "red";
    return { label: s.label, tone: tone as "green" | "blue" | "amber" | "red", color: s.color };
  })();
const STATUS_HINT = `By delivery rate: Top Performer 70%+, High Potential 66%+, Strong 62%+, Watch 57%+, Needs Support 50%+, Low Performance below 50%. Agents with fewer than ${MIN_RATE_SAMPLE} orders are not judged.`;
const dayLabel = (key: string, grain: Granularity) => grain === "monthly"
  ? new Date(`${key}T12:00:00Z`).toLocaleDateString("en-GB", { month: "short" })
  : new Date(`${key}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const shortMoney = (v: number) => Math.abs(v) >= 1e6 ? `₦${(v / 1e6).toFixed(1)}M` : Math.abs(v) >= 1e3 ? `₦${Math.round(v / 1e3)}k` : `₦${Math.round(v)}`;

// ── Agent Performance ───────────────────────────────────────────────────────

type AgentSort = "orders" | "delivered" | "rate" | "time" | "failed" | "fees" | "net" | "stock" | "pending";

export function AgentPerformanceTab({ ctx, filters }: { ctx: TabCtx; filters?: ReactNode }) {
  const { model, money, canSeeProfit, from, to, days, hubs, agents } = ctx;
  const withAgent = model.orders.filter((o) => o.agentId);
  const withAgentBefore = model.previous.filter((o) => o.agentId);
  const rows = useMemo(() => buildAgentRows({ orders: model.orders, previousOrders: model.previous, costs: model.costs, previousCosts: model.previousCosts, hubs, agents, productId: ctx.productId }),
    [model, hubs, agents, ctx.productId]);
  const [trendAgent, setTrendAgent] = useState<string>(ALL);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ key: AgentSort; desc: boolean }>({ key: "delivered", desc: true });
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [columnsOpen, setColumnsOpen] = useState(false);
  const closeColumns = useCallback(() => setColumnsOpen(false), []);
  const columnsRef = useClickAway<HTMLDivElement>(columnsOpen, closeColumns);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const closeMenu = useCallback(() => setMenuFor(null), []);
  const menuRef = useClickAway<HTMLDivElement>(menuFor !== null, closeMenu);
  const [viewing, setViewing] = useState<string | null>(null);

  const now = figuresFor(withAgent, model.costs);
  const before = figuresFor(withAgentBefore, model.previousCosts);
  const activeNow = new Set(withAgent.map((o) => o.agentId)).size;
  const activeBefore = new Set(withAgentBefore.map((o) => o.agentId)).size;
  const failRate = now.orders > 0 ? (now.failed / now.orders) * 100 : 0;
  const failRateBefore = before.orders > 0 ? (before.failed / before.orders) * 100 : 0;
  const spark = (fn: (b: TrendOrder[]) => number) => sparkOf(withAgent, from, to, days, fn);

  // Map: delivered orders by state (orders that had an agent).
  const byState = new Map<string, TrendOrder[]>();
  for (const o of withAgent) if (o.state) { const l = byState.get(o.state); if (l) l.push(o); else byState.set(o.state, [o]); }
  const mapData = Object.fromEntries([...byState].map(([state, list]) => {
    const f = figuresFor(list, model.costs);
    const agentsHere = new Set(list.map((o) => o.agentId)).size;
    return [mapKey(state), { value: f.delivered, tooltip: <div className="space-y-0.5 text-gray-600"><div>Delivered: <strong>{nf(f.delivered)}</strong></div><div>Rate: <strong>{pct1(f.rate)}</strong></div><div>Agents: <strong>{agentsHere}</strong></div></div> }];
  }));
  const mapMax = Math.max(0, ...Object.values(mapData).map((d) => d.value));

  // Top agents.
  const ranked = [...rows].sort((a, b) => b.now.delivered - a.now.delivered);
  const top9 = ranked.slice(0, 9);
  const others = figuresFor(withAgent.filter((o) => !top9.some((r) => r.agentId === o.agentId)), model.costs);
  const topMax = Math.max(1, ...top9.map((r) => r.now.delivered), others.delivered);

  // Trend chart.
  const grain: Granularity = days > 62 ? "weekly" : "daily";
  const trendOrders = trendAgent === ALL ? withAgent : withAgent.filter((o) => o.agentId === trendAgent);
  const trendData = useMemo(() => {
    const groups = new Map<string, TrendOrder[]>();
    for (const o of trendOrders) { const k = bucketOf(o.createdKey, grain); const l = groups.get(k); if (l) l.push(o); else groups.set(k, [o]); }
    return bucketKeys(from, to, grain).map((key) => { const list = groups.get(key) ?? []; return { key, orders: list.length, delivered: list.filter(isDelivered).length, rate: list.length > 0 ? rateOf(list) : null }; });
  }, [trendOrders, from, to, grain]);

  // Table.
  const term = search.trim().toLowerCase();
  const sortValue = (r: AgentRow): number => {
    switch (sort.key) {
      case "orders": return r.now.orders;
      case "delivered": return r.now.delivered;
      case "rate": return r.now.orders >= MIN_RATE_SAMPLE ? r.now.rate : -1;
      case "time": return r.now.avgDeliveryDays ?? 999;
      case "failed": return r.now.failed;
      case "fees": return r.now.logistics;
      case "net": return r.now.net;
      case "stock": return r.stockHeld;
      case "pending": return r.now.open;
    }
  };
  const tableRows = rows.filter((r) => !term || r.name.toLowerCase().includes(term) || r.states.some((s) => stateLabel(s).toLowerCase().includes(term)))
    .sort((a, b) => (sort.desc ? sortValue(b) - sortValue(a) : sortValue(a) - sortValue(b)));
  const COLS = ["Avg. Delivery Time", "Failed Deliveries", "Cancelled Rate", "Delivery Expenses", ...(canSeeProfit ? ["Net Profit (Delivered)"] : []), "Inventory Held", "Pending Deliveries", "Status"];
  const show = (c: string) => !hidden.has(c);
  const head = (key: AgentSort | null, label: string, title?: string) => (
    <th className={th} title={title}>{key ? <button type="button" onClick={() => setSort((s) => ({ key, desc: s.key === key ? !s.desc : true }))} className="!min-h-0 whitespace-nowrap">{label} <span className={sort.key === key ? "text-[#1F8FE0]" : "text-gray-400"}>⇅</span></button> : <span className="whitespace-nowrap">{label}</span>}</th>
  );

  ctx.exportRef.current = () => downloadCsv(`agent-performance-${from}-to-${to}.csv`, [
    ["Agent", "State", "Orders Assigned", "Delivered Orders", "Delivery Rate %", "Avg. Delivery Time (days)", "Failed Deliveries", "Cancelled Rate %", "Delivery Expenses", ...(canSeeProfit ? ["Net Profit (Delivered)"] : []), "Inventory Held", "Pending Deliveries", "Status"],
    ...tableRows.map((r) => [r.name, r.states.map(stateLabel).join("; "), r.now.orders, r.now.delivered, r.now.rate.toFixed(1), r.now.avgDeliveryDays?.toFixed(1) ?? "", r.now.failed,
      (r.now.orders > 0 ? (r.now.cancelled / r.now.orders) * 100 : 0).toFixed(1), Math.round(r.now.logistics), ...(canSeeProfit ? [Math.round(r.now.net)] : []), r.stockHeld, r.now.open, statusInfo(agentStatusOf(r.now)).label])
  ]);

  // Distribution.
  const counts = new Map<AgentStatusKey, number>();
  for (const r of rows) counts.set(agentStatusOf(r.now), (counts.get(agentStatusOf(r.now)) ?? 0) + 1);
  const dist = [...AGENT_STATUSES.map((s) => s.key as AgentStatusKey), "new" as AgentStatusKey].map((key) => ({ key, ...statusInfo(key), value: counts.get(key) ?? 0 })).filter((d) => d.value > 0 || d.key !== "new");

  // Delivery rate by agent.
  const rateRows = rows.filter((r) => r.now.orders >= MIN_RATE_SAMPLE).sort((a, b) => b.now.rate - a.now.rate).slice(0, 9);

  // Insights.
  const best = [...rows].filter((r) => r.now.orders >= MIN_RATE_SAMPLE).sort((a, b) => b.now.delivered * b.now.rate - a.now.delivered * a.now.rate)[0];
  const decline = [...rows].filter((r) => r.now.orders >= MIN_RATE_SAMPLE && r.before.orders >= MIN_RATE_SAMPLE).map((r) => ({ r, d: r.now.rate - r.before.rate })).sort((a, b) => a.d - b.d)[0];
  const growth = [...rows].filter((r) => r.before.delivered >= 5).map((r) => ({ r, g: growthPct(r.now.delivered, r.before.delivered) ?? 0 })).sort((a, b) => b.g - a.g)[0];
  const attention = [...rows].filter((r) => r.now.orders >= MIN_RATE_SAMPLE).sort((a, b) => a.now.rate - b.now.rate)[0];
  const insights = [
    best && best.now.delivered > 0 && { Icon: BarChart3, tone: "bg-emerald-50 text-emerald-600", title: `${best.name} - Strong Performance`, text: `Highest delivered orders (${nf(best.now.delivered)}) with ${pct1(best.now.rate)} delivery rate. Consider giving more stock.`, foot: `${nf(best.now.delivered)} delivered · ${pct1(best.now.rate)} rate`, id: best.agentId },
    decline && decline.d < -3 && { Icon: Lightbulb, tone: "bg-amber-50 text-amber-600", title: `${stateLabel(decline.r.states[0] ?? "")} - Delivery Rate Decline`, text: `${decline.r.name}'s delivery rate dropped by ${Math.abs(decline.d).toFixed(1)} points on the period before. Review failed deliveries.`, foot: `${nf(decline.r.now.failed)} failed · ${pct1(decline.r.now.orders > 0 ? (decline.r.now.failed / decline.r.now.orders) * 100 : 0)} failed rate`, id: decline.r.agentId },
    growth && growth.g > 0 && { Icon: TrendingUp, tone: "bg-blue-50 text-blue-600", title: `${stateLabel(growth.r.states[0] ?? "")} - Growing Potential`, text: `${growth.r.name} shows growth (+${growth.g.toFixed(0)}% delivered) with ${pct1(growth.r.now.rate)} delivery rate.`, foot: `${nf(growth.r.now.delivered)} delivered · +${growth.g.toFixed(0)}% growth`, id: growth.r.agentId },
    attention && attention !== best && attention.now.rate < 55 && { Icon: AlertCircle, tone: "bg-rose-50 text-rose-600", title: `${stateLabel(attention.states[0] ?? "")} - Needs Attention`, text: `${attention.name} has a low delivery rate (${pct1(attention.now.rate)}) with ${nf(attention.now.failed)} failed. Investigate before acting.`, foot: `${nf(attention.now.failed)} failed deliveries`, id: attention.agentId }
  ].filter(Boolean) as Array<{ Icon: typeof BarChart3; tone: string; title: string; text: string; foot: string; id: string }>;

  const viewRow = viewing ? rows.find((r) => r.agentId === viewing) : null;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <KpiTile Icon={ShoppingCart} tone="bg-blue-50 text-blue-600" label="Total Orders Assigned" value={nf(now.orders)} delta={growthPct(now.orders, before.orders)} spark={spark((b) => b.length)} />
        <KpiTile Icon={Truck} tone="bg-emerald-50 text-emerald-600" label="Total Delivered Orders" value={nf(now.delivered)} delta={growthPct(now.delivered, before.delivered)} spark={spark((b) => b.filter(isDelivered).length)} />
        <KpiTile Icon={CirclePercent} tone="bg-emerald-50 text-emerald-600" label="Overall Delivery Rate" value={pct1(now.rate)} delta={before.orders > 0 ? now.rate - before.rate : null} deltaPoints spark={spark(rateOf)} />
        <KpiTile Icon={Users} tone="bg-blue-50 text-blue-600" label="Active Agents" value={nf(activeNow)} delta={growthPct(activeNow, activeBefore)} spark={spark((b) => new Set(b.map((o) => o.agentId)).size)} />
        <KpiTile Icon={Clock3} tone="bg-rose-50 text-rose-500" label="Avg. Delivery Time" value={now.avgDeliveryDays === null ? "—" : `${now.avgDeliveryDays.toFixed(1)} days`}
          delta={now.avgDeliveryDays !== null && before.avgDeliveryDays ? growthPct(now.avgDeliveryDays, before.avgDeliveryDays) : null} info="Days from the order to its delivery, for orders delivered. Lower is better." />
        <KpiTile Icon={CircleAlert} tone="bg-rose-50 text-rose-500" label="Failed Delivery Rate" value={pct1(failRate)} delta={before.orders > 0 ? failRate - failRateBefore : null} deltaPoints spark={spark((b) => b.length > 0 ? (b.filter((o) => o.status === "Failed").length / b.length) * 100 : 0)} sparkColor="#dc2626" />
      </div>
      {filters}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_1fr_1.05fr]">
        <Panel title="Agent Performance by State" info="Delivered orders that had a delivery agent, by state.">
          <NigeriaMap data={mapData} zoomable legend={{ title: "Delivered Orders", bins: countLegend(countBins(mapMax)) }} />
        </Panel>

        <Panel title="Top Agents by Delivered Orders" action={<button type="button" onClick={() => document.getElementById("pt-agent-details")?.scrollIntoView({ behavior: "smooth" })} className="!min-h-0 text-[12px] font-semibold text-[#1F8FE0]">View all</button>}>
          <table className="w-full !min-w-0 border-separate border-spacing-0">
            <thead><tr><th className={th}>#</th><th className={th}>Agent</th><th className={th}>State</th><th className={th}>Delivered Orders</th><th className={th} /><th className={`${th} !text-right`}>Delivery Rate</th></tr></thead>
            <tbody>
              {top9.map((r, i) => (
                <tr key={r.agentId} className="[&>td]:[color:inherit]">
                  <td className={`${td} !border-0 !py-1.5`}>{i + 1}</td>
                  <td className={`${td} !border-0 !py-1.5`}><span className="flex items-center gap-1.5"><Avatar name={r.name} size={20} /><span className="max-w-[110px] truncate">{r.name}</span></span></td>
                  <td className={`${td} !border-0 !py-1.5 max-w-[80px] truncate text-gray-600`}>{stateLabel(r.states[0] ?? "")}</td>
                  <td className={`${td} !border-0 !py-1.5 font-semibold`}>{nf(r.now.delivered)}</td>
                  <td className={`${td} !border-0 !py-1.5 w-[22%]`}><span className="block h-2 rounded-sm bg-gray-100"><span className="block h-2 rounded-sm" style={{ width: `${(r.now.delivered / topMax) * 100}%`, background: rateTone(r.now.rate) }} /></span></td>
                  <td className={`${td} !border-0 !py-1.5 text-right`}>{pct1(r.now.rate)}</td>
                </tr>
              ))}
              {ranked.length > 9 && (
                <tr className="[&>td]:[color:inherit]">
                  <td className={`${td} !border-0 !py-1.5 text-gray-400`}>10</td><td className={`${td} !border-0 !py-1.5 text-gray-500`}>Others</td><td className={`${td} !border-0 !py-1.5 text-gray-500`}>Multiple</td>
                  <td className={`${td} !border-0 !py-1.5 font-semibold`}>{nf(others.delivered)}</td>
                  <td className={`${td} !border-0 !py-1.5`}><span className="block h-2 rounded-sm bg-gray-100"><span className="block h-2 rounded-sm bg-gray-400" style={{ width: `${(others.delivered / topMax) * 100}%` }} /></span></td>
                  <td className={`${td} !border-0 !py-1.5 text-right`}>{pct1(others.rate)}</td>
                </tr>
              )}
              {top9.length === 0 && <tr><td colSpan={6} className={`${td} !border-0 py-6 text-center text-gray-400`}>No orders with an agent in this period.</td></tr>}
            </tbody>
          </table>
        </Panel>

        <Panel title="Delivery Agent Performance Trends" action={<SelectBox label="Agent" className="w-36" value={trendAgent} onChange={setTrendAgent} options={[{ value: ALL, label: "All Agents" }, ...ranked.map((r) => ({ value: r.agentId, label: r.name }))]} />}>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={trendData} margin={{ top: 6, right: 0, left: -18, bottom: 0 }}>
                <CartesianGrid stroke="#e5e7eb" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="key" tick={{ fontSize: 10, fill: "#6b7280" }} tickFormatter={(k: string) => dayLabel(k, grain)} minTickGap={16} />
                <YAxis yAxisId="n" tick={{ fontSize: 10, fill: "#6b7280" }} allowDecimals={false} />
                <YAxis yAxisId="r" orientation="right" domain={[0, 100]} tick={{ fontSize: 10, fill: "#6b7280" }} tickFormatter={(v: number) => `${v}%`} width={36} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} labelFormatter={(k: any) => dayLabel(String(k), grain)} formatter={(v: any, name: any) => [name === "rate" ? (v === null ? "—" : `${Number(v).toFixed(1)}%`) : v, name === "orders" ? "Orders Assigned" : name === "delivered" ? "Delivered Orders" : "Delivery Rate (%)"]} />
                <Legend verticalAlign="top" formatter={(name: any) => <span className="text-[11px] text-gray-600">{name === "orders" ? "Orders Assigned" : name === "delivered" ? "Delivered Orders" : "Delivery Rate (%)"}</span>} iconType="circle" iconSize={7} />
                <Bar yAxisId="n" dataKey="orders" fill="#1d4ed8" radius={[2, 2, 0, 0]} maxBarSize={8} isAnimationActive={false} />
                <Bar yAxisId="n" dataKey="delivered" fill="#16a34a" radius={[2, 2, 0, 0]} maxBarSize={8} isAnimationActive={false} />
                <Line yAxisId="r" dataKey="rate" stroke="#a21caf" strokeWidth={2} dot={{ r: 2 }} connectNulls={false} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>

      <section id="pt-agent-details" className="rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-slate-800">
        <div className="flex flex-col gap-2 px-4 pt-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h3 className="m-0 text-[16px] font-black text-gray-900 dark:text-slate-50">Delivery Agent Performance (Detailed) <span title={STATUS_HINT} className="cursor-help text-[11px] font-normal text-gray-400">ⓘ</span></h3>
            <p className="m-0 mt-0.5 text-[12px] text-gray-500">Performance metrics for each agent, including orders, deliveries, profitability and inventory status.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex h-9 w-48 items-center gap-2 rounded-lg border border-gray-200 px-3 dark:border-slate-700"><Search className="h-4 w-4 text-gray-400" /><span className="sr-only">Search agents</span>
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search agents..." className="!min-h-0 w-full bg-transparent text-[12.5px] outline-none" /></label>
            <div className="relative" ref={columnsRef}>
              <button type="button" onClick={() => setColumnsOpen((o) => !o)} className="!min-h-0 inline-flex h-9 items-center gap-1.5 rounded-lg border border-gray-200 px-3 text-[12.5px] font-semibold text-gray-700 dark:border-slate-700"><Columns3 className="h-4 w-4" /> Columns</button>
              {columnsOpen && (
                <div className="absolute right-0 top-full z-30 mt-1 w-56 rounded-xl border border-gray-200 bg-white p-2 shadow-xl dark:border-slate-700 dark:bg-slate-900">
                  {COLS.map((c) => <label key={c} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[12.5px] hover:bg-gray-50"><input type="checkbox" checked={show(c)} onChange={() => setHidden((h) => { const n = new Set(h); if (n.has(c)) n.delete(c); else n.add(c); return n; })} />{c}</label>)}
                </div>
              )}
            </div>
            <button type="button" onClick={() => ctx.exportRef.current()} className="!min-h-0 inline-flex h-9 items-center gap-1.5 rounded-lg border border-gray-200 px-3 text-[12.5px] font-semibold text-gray-700 dark:border-slate-700"><Download className="h-4 w-4" /> Export</button>
          </div>
        </div>
        <div className="mt-3 max-h-[560px] overflow-auto">
          <table className="w-full !min-w-[1240px] border-separate border-spacing-0">
            <thead><tr>
              <th className={th}>#</th><th className={th}>Agent</th><th className={th}>State</th>{head("orders", "Orders Assigned")}{head("delivered", "Delivered Orders")}{head("rate", "Delivery Rate")}
              {show("Avg. Delivery Time") && head("time", "Avg. Delivery Time")}{show("Failed Deliveries") && head("failed", "Failed Deliveries")}
              {show("Cancelled Rate") && head(null, "Cancelled Rate", "Cancelled after the order reached the agent. The app does not record returns separately.")}
              {show("Delivery Expenses") && head("fees", "Delivery Expenses")}{canSeeProfit && show("Net Profit (Delivered)") && head("net", "Net Profit (Delivered)", NET_NOTE)}
              {show("Inventory Held") && head("stock", "Inventory Held")}{show("Pending Deliveries") && head("pending", "Pending Deliveries")}{show("Status") && head(null, "Status", STATUS_HINT)}{head(null, "Actions")}
            </tr></thead>
            <tbody>
              {tableRows.length === 0 && <tr><td colSpan={15} className={`${td} py-10 text-center text-gray-500`}>{term ? "No agent matches." : "No orders with an agent in this period."}</td></tr>}
              {tableRows.map((r, i) => {
                const status = statusInfo(agentStatusOf(r.now));
                const rateChange = r.before.orders > 0 && r.now.orders > 0 ? r.now.rate - r.before.rate : null;
                return (
                  <tr key={r.agentId} className="hover:bg-gray-50/70 [&>td]:[color:inherit]">
                    <td className={td}>{i + 1}</td>
                    <td className={td}><span className="flex items-center gap-2"><Avatar name={r.name} /><span className="max-w-[140px] truncate font-semibold">{r.name}</span></span></td>
                    <td className={`${td} max-w-[100px] truncate text-gray-600`}>{r.states.length > 1 ? `${stateLabel(r.states[0])} +${r.states.length - 1}` : stateLabel(r.states[0] ?? "")}</td>
                    <td className={td}>{nf(r.now.orders)}</td>
                    <td className={td}>{nf(r.now.delivered)}</td>
                    <td className={td}><div className={`font-semibold ${r.now.orders < MIN_RATE_SAMPLE ? "text-gray-400" : ""}`}>{pct1(r.now.rate)}</div><Delta value={rateChange} points /></td>
                    {show("Avg. Delivery Time") && <td className={td}>{r.now.avgDeliveryDays === null ? "—" : `${r.now.avgDeliveryDays.toFixed(1)} days`}</td>}
                    {show("Failed Deliveries") && <td className={td}>{nf(r.now.failed)} ({pct1(r.now.orders > 0 ? (r.now.failed / r.now.orders) * 100 : 0)})</td>}
                    {show("Cancelled Rate") && <td className={`${td} text-rose-600`}>{pct1(r.now.orders > 0 ? (r.now.cancelled / r.now.orders) * 100 : 0)}</td>}
                    {show("Delivery Expenses") && <td className={td}>{money(r.now.logistics)}</td>}
                    {canSeeProfit && show("Net Profit (Delivered)") && <td className={`${td} ${r.now.net < 0 ? "text-rose-600" : ""}`}>{money(r.now.net)}</td>}
                    {show("Inventory Held") && <td className={td}>{nf(r.stockHeld)}</td>}
                    {show("Pending Deliveries") && <td className={td}>{nf(r.now.open)}</td>}
                    {show("Status") && <td className={td}><Pill tone={status.tone}>{status.label}</Pill></td>}
                    <td className={td}>
                      <div className="relative flex items-center gap-1" ref={menuFor === r.agentId ? menuRef : undefined}>
                        <button type="button" onClick={() => setViewing(r.agentId)} className="!min-h-0 rounded-md border border-blue-200 px-2.5 py-1 text-[11.5px] font-semibold text-[#1F8FE0] hover:bg-blue-50">View</button>
                        <button type="button" aria-label="More" onClick={() => setMenuFor(menuFor === r.agentId ? null : r.agentId)} className="!min-h-0 rounded-md border border-gray-200 px-1.5 py-1 text-gray-500"><Ellipsis className="h-3.5 w-3.5" /></button>
                        {menuFor === r.agentId && (
                          <div className="absolute right-0 top-full z-30 mt-1 w-48 rounded-xl border border-gray-200 bg-white p-1 text-[12px] shadow-xl dark:border-slate-700 dark:bg-slate-900">
                            <button type="button" onClick={() => { ctx.onOnlyAgent(r.agentId); setMenuFor(null); }} className="!min-h-0 block w-full rounded-lg px-3 py-2 text-left hover:bg-gray-50">Show only this agent</button>
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[0.95fr_0.95fr_1.5fr]">
        <Panel title="Agent Performance Distribution" info={STATUS_HINT}>
          <div className="flex items-center gap-4">
            <Donut slices={dist.map((d) => ({ label: d.label, value: d.value, color: d.color }))} center={nf(rows.length)} sub="Agents" />
            <ul className="m-0 min-w-0 flex-1 list-none space-y-1.5 p-0">
              {dist.map((d) => (
                <li key={d.key} className="flex items-center justify-between gap-2 text-[11.5px]"><span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: d.color }} />{d.label}</span>
                  <span className="text-gray-600"><strong className="text-gray-900">{d.value}</strong> ({rows.length > 0 ? ((d.value / rows.length) * 100).toFixed(1) : "0"}%)</span></li>
              ))}
            </ul>
          </div>
        </Panel>
        <Panel title="Delivery Rate by Agent (Top 10)" info={`Agents with ${MIN_RATE_SAMPLE}+ orders.`} action={<button type="button" onClick={() => document.getElementById("pt-agent-details")?.scrollIntoView({ behavior: "smooth" })} className="!min-h-0 text-[12px] font-semibold text-[#1F8FE0]">View all</button>}>
          <ol className="m-0 list-none space-y-1.5 p-0">
            {rateRows.map((r, i) => (
              <li key={r.agentId} className="grid grid-cols-[16px_96px_1fr_42px] items-center gap-2 text-[11.5px]">
                <span className="font-bold text-amber-600">{i + 1}</span><span className="truncate">{r.name}</span>
                <span className="h-2 rounded-sm bg-gray-100"><span className="block h-2 rounded-sm bg-emerald-600" style={{ width: `${r.now.rate}%` }} /></span>
                <span className="text-right">{pct1(r.now.rate)}</span>
              </li>
            ))}
            {rateRows.length === 0 && <li className="py-6 text-center text-[12px] text-gray-400">No agent has {MIN_RATE_SAMPLE}+ orders yet.</li>}
          </ol>
        </Panel>
        <Panel title="Key Agent Insights">
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {insights.length === 0 && <p className="m-0 py-4 text-center text-[12px] text-gray-400">Not enough orders for insights yet.</p>}
            {insights.map((item) => <InsightCard key={item.title} Icon={item.Icon} tone={item.tone} title={item.title} text={item.text} foot={item.foot} onView={() => setViewing(item.id)} />)}
          </div>
        </Panel>
      </div>

      {viewRow && (
        <SidePanel title={<span className="flex items-center gap-2"><Avatar name={viewRow.name} size={32} />{viewRow.name}</span>} subtitle={viewRow.states.map(stateLabel).join(", ")} onClose={() => setViewing(null)}>
          <AgentDetail ctx={ctx} row={viewRow} />
        </SidePanel>
      )}
    </div>
  );
}

function AgentDetail({ ctx, row }: { ctx: TabCtx; row: AgentRow }) {
  const mine = ctx.model.orders.filter((o) => o.agentId === row.agentId);
  const byProduct = ctx.model.productRows.map((p) => ({ p, f: figuresFor(mine.filter((o) => o.productId === p.product.id), ctx.model.costs) })).filter((x) => x.f.orders > 0).sort((a, b) => b.f.orders - a.f.orders);
  const status = statusInfo(agentStatusOf(row.now));
  const stat = (label: string, value: ReactNode) => <div className="rounded-xl bg-gray-50 p-3 dark:bg-slate-900"><div className="text-[11px] text-gray-500">{label}</div><div className="mt-0.5 text-[15px] font-bold">{value}</div></div>;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {stat("Orders", nf(row.now.orders))}{stat("Delivered", nf(row.now.delivered))}{stat("Delivery rate", pct1(row.now.rate))}{stat("Status", <Pill tone={status.tone}>{status.label}</Pill>)}
        {stat("Avg. delivery time", row.now.avgDeliveryDays === null ? "—" : `${row.now.avgDeliveryDays.toFixed(1)} days`)}{stat("Failed", nf(row.now.failed))}{stat("Pending", nf(row.now.open))}{stat("Stock held", nf(row.stockHeld))}
      </div>
      {row.vsPeers !== null && <p className="m-0 text-[12.5px] text-gray-700">Against the other agents in {stateLabel(row.peerState ?? "")}: <Delta value={row.vsPeers} points /></p>}
      <div className="overflow-auto rounded-xl border border-gray-200 dark:border-slate-800">
        <table className="w-full !min-w-0 border-separate border-spacing-0">
          <thead><tr>{["Product", "Orders", "Delivered", "Rate", "Pending"].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
          <tbody>{byProduct.map(({ p, f }) => (
            <tr key={p.product.id} className="[&>td]:[color:inherit]"><td className={`${td} font-semibold`}>{p.product.name}</td><td className={td}>{nf(f.orders)}</td><td className={td}>{nf(f.delivered)}</td><td className={td}>{pct1(f.rate)}</td><td className={td}>{nf(f.open)}</td></tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  );
}

// ── Trends Over Time ────────────────────────────────────────────────────────

type Series = "all" | "orders" | "delivered" | "rate" | "net";
type ChartKind = "line" | "area" | "bar";
type GrowthMode = "orders" | "delivered" | "revenue" | "net";

export function TrendsOverTimeTab({ ctx, filters }: { ctx: TabCtx; filters?: ReactNode }) {
  const { model, money, canSeeProfit, from, to, days, products } = ctx;
  const [mainGrain, setMainGrain] = useState<Granularity>(ctx.grain);
  const [series, setSeries] = useState<Series>("all");
  const [kind, setKind] = useState<ChartKind>("line");
  const [compareMetric, setCompareMetric] = useState<string>(ctx.metric === "orders" ? "orders" : "delivered");
  const [compareGrain, setCompareGrain] = useState<Granularity>(ctx.grain);
  const [picked, setPicked] = useState<string[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [comboGrain, setComboGrain] = useState<Granularity>("weekly");
  const [rateGrain, setRateGrain] = useState<Granularity>(ctx.grain);
  const [moneyGrain, setMoneyGrain] = useState<Granularity>(ctx.grain);
  const [growthMode, setGrowthMode] = useState<GrowthMode>("orders");

  const now = figuresFor(model.orders, model.costs);
  const before = figuresFor(model.previous, model.previousCosts);
  const spark = (fn: (b: TrendOrder[]) => number) => sparkOf(model.orders, from, to, days, fn);

  const bucketed = (grain: Granularity, list: TrendOrder[] = model.orders) => {
    const groups = new Map<string, TrendOrder[]>();
    for (const o of list) { const k = bucketOf(o.createdKey, grain); const l = groups.get(k); if (l) l.push(o); else groups.set(k, [o]); }
    return bucketKeys(from, to, grain).map((key) => ({ key, list: groups.get(key) ?? [] }));
  };

  const mainData = useMemo(() => bucketed(mainGrain).map(({ key, list }) => ({
    key, orders: list.length, delivered: list.filter(isDelivered).length, rate: list.length > 0 ? rateOf(list) : null, net: netOf(list, model.costs)
  })), [model, mainGrain, from, to]); // eslint-disable-line react-hooks/exhaustive-deps

  const ranked = [...model.productRows].sort((a, b) => b.now.orders - a.now.orders);
  const chosen = (picked ?? ranked.slice(0, 3).map((r) => r.product.id)).filter((id) => ranked.some((r) => r.product.id === id)).slice(0, 5);
  const compareData = useMemo(() => {
    const s: Record<string, TrendOrder[]> = {};
    for (const id of chosen) s[id] = model.orders.filter((o) => o.productId === id);
    return seriesOver(s, from, to, compareGrain, compareMetric as never);
  }, [chosen.join(","), model.orders, from, to, compareGrain, compareMetric]); // eslint-disable-line react-hooks/exhaustive-deps

  const comboData = useMemo(() => bucketed(comboGrain).map(({ key, list }) => ({ key, orders: list.length, delivered: list.filter(isDelivered).length, net: netOf(list, model.costs) })), [model, comboGrain, from, to]); // eslint-disable-line react-hooks/exhaustive-deps

  const topStates = model.stateRows.slice(0, 3).map((r) => r.state);
  const rateData = useMemo(() => bucketed(rateGrain).map(({ key, list }) => {
    const row: Record<string, string | number | null> = { key, overall: list.length > 0 ? rateOf(list) : null };
    for (const s of topStates) { const l = list.filter((o) => o.state === s); row[s] = l.length > 0 ? rateOf(l) : null; }
    return row;
  }), [model, rateGrain, from, to, topStates.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  const moneyData = useMemo(() => bucketed(moneyGrain).map(({ key, list }) => ({ key, revenue: list.filter(isDelivered).reduce((s, o) => s + o.amount, 0), net: netOf(list, model.costs) })), [model, moneyGrain, from, to]); // eslint-disable-line react-hooks/exhaustive-deps

  // Growth tables.
  const growthValue = (f: ReturnType<typeof figuresFor>) => growthMode === "orders" ? f.orders : growthMode === "delivered" ? f.delivered : growthMode === "revenue" ? f.revenue : f.net;
  const productGrowth = ranked.map((r) => ({ r, cur: growthValue(r.now), prev: growthValue(r.before) })).sort((a, b) => b.cur - a.cur).slice(0, 5);
  const stateGrowth = model.stateRows.filter((r) => r.before.orders >= 5).map((r) => ({ r, cur: r.now.orders, prev: r.before.orders, g: growthPct(r.now.orders, r.before.orders) ?? 0 })).sort((a, b) => b.g - a.g).slice(0, 8);
  const fmtGrowth = (v: number) => growthMode === "revenue" || growthMode === "net" ? money(v) : nf(v);

  // Insights.
  const fastState = stateGrowth[0];
  const steady = ranked.filter((r) => r.before.delivered >= 5).map((r) => ({ r, g: growthPct(r.now.delivered, r.before.delivered) ?? 0 })).sort((a, b) => b.g - a.g)[0];
  const drop = ranked.filter((r) => r.now.orders >= MIN_RATE_SAMPLE && r.before.orders >= MIN_RATE_SAMPLE).map((r) => ({ r, d: r.now.rate - r.before.rate })).sort((a, b) => a.d - b.d)[0];
  const profitState = canSeeProfit ? model.stateRows.filter((r) => r.before.net > 0).map((r) => ({ r, g: growthPct(r.now.net, r.before.net) ?? 0 })).sort((a, b) => b.g - a.g)[0] : undefined;
  const insights = [
    fastState && fastState.g > 0 && { Icon: BarChart3, tone: "bg-emerald-50 text-emerald-600", title: `${stateLabel(fastState.r.state)} is growing fast`, text: `Orders increased by ${fastState.g.toFixed(1)}% compared to the previous period.` },
    steady && steady.g > 0 && { Icon: TrendingUp, tone: "bg-blue-50 text-blue-600", title: `${steady.r.product.name} has consistent growth`, text: `Delivered orders up ${steady.g.toFixed(1)}% on the previous period.` },
    drop && drop.d < -3 && { Icon: AlertCircle, tone: "bg-rose-50 text-rose-600", title: `${drop.r.product.name} delivery rate dropped`, text: `Delivery rate down ${Math.abs(drop.d).toFixed(1)} points on the previous period.` },
    profitState && profitState.g > 0 && { Icon: Lightbulb, tone: "bg-amber-50 text-amber-600", title: `${stateLabel(profitState.r.state)} shows strong profit growth`, text: `Net profit up ${profitState.g.toFixed(1)}% on the previous period.` }
  ].filter(Boolean) as Array<{ Icon: typeof BarChart3; tone: string; title: string; text: string }>;

  ctx.exportRef.current = () => downloadCsv(`trends-${from}-to-${to}.csv`, [
    ["Period", "Total Orders", "Delivered Orders", "Delivery Rate %", ...(canSeeProfit ? ["Net Profit"] : [])],
    ...mainData.map((r) => [String(r.key), r.orders, r.delivered, r.rate === null ? "" : r.rate.toFixed(1), ...(canSeeProfit ? [Math.round(r.net)] : [])])
  ]);

  const grainSelect = (value: Granularity, onChange: (g: Granularity) => void) => <SelectBox label="Grouping" className="w-24" value={value} onChange={onChange} options={[{ value: "daily", label: "Daily" }, { value: "weekly", label: "Weekly" }, { value: "monthly", label: "Monthly" }]} />;
  const xTick = (grain: Granularity) => (k: string) => grain === "weekly" ? `${dayLabel(k, "daily")}` : dayLabel(k, grain);
  const legendText = (label: string) => <span className="text-[11px] text-gray-600 dark:text-slate-300">{label}</span>;
  const mainLabels: Record<string, string> = { orders: "Total Orders", delivered: "Delivered Orders", rate: "Delivery Rate (%)", net: "Net Profit (₦)" };
  const showSeries = (s: Exclude<Series, "all">) => (series === "all" || series === s) && (s !== "net" || canSeeProfit);
  
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <KpiTile Icon={ShoppingCart} tone="bg-blue-50 text-blue-600" label="Total Orders" value={nf(now.orders)} delta={growthPct(now.orders, before.orders)} spark={spark((b) => b.length)} />
        <KpiTile Icon={Truck} tone="bg-emerald-50 text-emerald-600" label="Delivered Orders" value={nf(now.delivered)} delta={growthPct(now.delivered, before.delivered)} spark={spark((b) => b.filter(isDelivered).length)} />
        <KpiTile Icon={CirclePercent} tone="bg-emerald-50 text-emerald-600" label="Delivery Rate" value={pct1(now.rate)} delta={before.orders > 0 ? now.rate - before.rate : null} deltaPoints spark={spark(rateOf)} sparkColor="#a21caf" />
        <KpiTile Icon={Banknote} tone="bg-orange-50 text-orange-500" label="Delivered Revenue" value={money(now.revenue)} delta={growthPct(now.revenue, before.revenue)} spark={spark((b) => b.filter(isDelivered).reduce((s, o) => s + o.amount, 0))} />
        {canSeeProfit
          ? <KpiTile Icon={BarChart3} tone="bg-violet-50 text-violet-600" label="Net Profit (Delivered)" value={money(now.net)} delta={before.net > 0 ? growthPct(now.net, before.net) : null} spark={spark((b) => netOf(b, model.costs))} sparkColor="#a21caf" />
          : <KpiTile Icon={BarChart3} tone="bg-violet-50 text-violet-600" label="Delivered AOV" value={now.delivered > 0 ? money(now.aov) : "—"} delta={before.delivered > 0 && now.delivered > 0 ? growthPct(now.aov, before.aov) : null} />}
        <KpiTile Icon={Package} tone="bg-amber-50 text-amber-500" label="Units Delivered" value={nf(now.unitsDelivered)} delta={growthPct(now.unitsDelivered, before.unitsDelivered)} spark={spark((b) => b.filter(isDelivered).reduce((s, o) => s + o.units, 0))} sparkColor="#dc2626" />
      </div>
      {filters}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.2fr_1fr]">
        <Panel title={<span>Trends Over Time<span className="block text-[12px] font-normal text-gray-500">View how your business is performing over time.</span></span>}
          action={<div className="flex flex-wrap gap-2">
            <SelectBox label="Show" className="w-40" value={series} onChange={setSeries} options={[{ value: "all", label: "All measures" }, { value: "orders", label: "Total Orders" }, { value: "delivered", label: "Delivered Orders" }, { value: "rate", label: "Delivery Rate" }, ...(canSeeProfit ? [{ value: "net" as Series, label: "Net Profit" }] : [])]} />
            {grainSelect(mainGrain, setMainGrain)}
            <SelectBox label="Chart type" className="w-32" value={kind} onChange={setKind} options={[{ value: "line", label: "Line Chart" }, { value: "area", label: "Area Chart" }, { value: "bar", label: "Bar Chart" }]} />
          </div>}>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={mainData} margin={{ top: 6, right: 0, left: -12, bottom: 0 }}>
                <CartesianGrid stroke="#e5e7eb" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="key" tick={{ fontSize: 10, fill: "#6b7280" }} tickFormatter={xTick(mainGrain)} minTickGap={18} />
                <YAxis yAxisId="n" tick={{ fontSize: 10, fill: "#6b7280" }} allowDecimals={false} />
                <YAxis yAxisId="r" orientation="right" domain={[0, 100]} tick={{ fontSize: 10, fill: "#6b7280" }} tickFormatter={(v: number) => `${v}%`} width={38} />
                <YAxis yAxisId="m" hide />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} labelFormatter={(k: any) => dayLabel(String(k), "daily")} formatter={(v: any, name: any) => [v === null ? "—" : name === "rate" ? `${Number(v).toFixed(1)}%` : name === "net" ? money(Number(v)) : nf(Number(v)), mainLabels[String(name)]]} />
                <Legend verticalAlign="top" formatter={(name: any) => legendText(mainLabels[String(name)])} iconType="circle" iconSize={7} />
                {(["orders", "delivered"] as const).filter(showSeries).map((k) => kind === "bar"
                  ? <Bar key={k} yAxisId="n" dataKey={k} fill={k === "orders" ? "#1d4ed8" : "#16a34a"} maxBarSize={10} isAnimationActive={false} />
                  : kind === "area"
                    ? <Area key={k} yAxisId="n" dataKey={k} type="monotone" stroke={k === "orders" ? "#1d4ed8" : "#16a34a"} fill={k === "orders" ? "#1d4ed8" : "#16a34a"} fillOpacity={0.12} strokeWidth={2} isAnimationActive={false} />
                    : <Line key={k} yAxisId="n" dataKey={k} type="monotone" stroke={k === "orders" ? "#1d4ed8" : "#16a34a"} strokeWidth={2} dot={{ r: 2 }} isAnimationActive={false} />)}
                {showSeries("rate") && <Line yAxisId="r" dataKey="rate" type="monotone" stroke="#a21caf" strokeWidth={2} dot={{ r: 2 }} connectNulls={false} isAnimationActive={false} />}
                {showSeries("net") && <Line yAxisId="m" dataKey="net" type="monotone" stroke="#d97706" strokeWidth={2} dot={{ r: 2 }} isAnimationActive={false} />}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel title={<span>Compare Products (Trends)<span className="block text-[12px] font-normal text-gray-500">Select up to 5 products to compare their performance over time.</span></span>}
          action={<div className="flex items-center gap-2"><span className="text-[12px] text-gray-500">Metric:</span>
            <SelectBox label="Metric" className="w-40" value={compareMetric} onChange={setCompareMetric} options={[{ value: "delivered", label: "Delivered Orders" }, { value: "orders", label: "Total Orders" }, { value: "rate", label: "Delivery Rate" }, { value: "revenue", label: "Delivered Revenue" }, { value: "unitsDelivered", label: "Units Delivered" }]} />
            {grainSelect(compareGrain, setCompareGrain)}</div>}>
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            {chosen.map((id, i) => {
              const name = products.find((p) => p.id === id)?.name ?? id;
              return <span key={id} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11.5px] font-semibold text-white" style={{ background: SERIES_COLORS[i] }}>{name}
                <button type="button" aria-label={`Remove ${name}`} onClick={() => setPicked(chosen.filter((x) => x !== id))} className="!min-h-0"><X className="h-3 w-3" /></button></span>;
            })}
            {chosen.length < 5 && (adding ? (
              <select autoFocus aria-label="Add a product" value="" onBlur={() => setAdding(false)} onChange={(e) => { if (e.target.value) setPicked([...chosen, e.target.value]); setAdding(false); }} className="!min-h-0 h-7 rounded-md border border-gray-200 px-2 text-[12px]">
                <option value="">Pick a product</option>
                {ranked.filter((r) => !chosen.includes(r.product.id)).map((r) => <option key={r.product.id} value={r.product.id}>{r.product.name}</option>)}
              </select>
            ) : <button type="button" onClick={() => setAdding(true)} className="!min-h-0 inline-flex items-center gap-1 rounded-md border border-blue-300 px-2 py-1 text-[11.5px] font-semibold text-[#1F8FE0]"><Plus className="h-3 w-3" /> Add Product</button>)}
          </div>
          <div className="h-60">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={compareData} margin={{ top: 6, right: 6, left: -16, bottom: 0 }}>
                <CartesianGrid stroke="#e5e7eb" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="key" tick={{ fontSize: 10, fill: "#6b7280" }} tickFormatter={xTick(compareGrain)} minTickGap={18} />
                <YAxis tick={{ fontSize: 10, fill: "#6b7280" }} tickFormatter={(v: number) => compareMetric === "rate" ? `${v}%` : compareMetric === "revenue" ? shortMoney(v) : String(v)} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} labelFormatter={(k: any) => dayLabel(String(k), "daily")} formatter={(v: any, id: any) => [v === null ? "—" : compareMetric === "rate" ? `${Number(v).toFixed(1)}%` : compareMetric === "revenue" ? money(Number(v)) : nf(Number(v)), products.find((p) => p.id === id)?.name ?? id]} />
                <Legend verticalAlign="top" formatter={(id: any) => legendText(products.find((p) => p.id === id)?.name ?? String(id))} iconType="circle" iconSize={7} />
                {chosen.map((id, i) => <Line key={id} dataKey={id} type="monotone" stroke={SERIES_COLORS[i]} strokeWidth={2} dot={{ r: 2 }} connectNulls={false} isAnimationActive={false} />)}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Panel title="Orders, Deliveries & Profitability Trend" action={grainSelect(comboGrain, setComboGrain)}>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={comboData} margin={{ top: 6, right: 0, left: -16, bottom: 0 }}>
                <CartesianGrid stroke="#e5e7eb" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="key" tick={{ fontSize: 10, fill: "#6b7280" }} tickFormatter={xTick(comboGrain)} minTickGap={10} />
                <YAxis yAxisId="n" tick={{ fontSize: 10, fill: "#6b7280" }} allowDecimals={false} />
                {canSeeProfit && <YAxis yAxisId="m" orientation="right" tick={{ fontSize: 10, fill: "#6b7280" }} tickFormatter={shortMoney} width={44} />}
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} labelFormatter={(k: any) => `From ${dayLabel(String(k), "daily")}`} formatter={(v: any, name: any) => [name === "net" ? money(Number(v)) : nf(Number(v)), name === "orders" ? "Orders" : name === "delivered" ? "Delivered Orders" : "Net Profit (₦)"]} />
                <Legend verticalAlign="top" formatter={(name: any) => legendText(name === "orders" ? "Orders" : name === "delivered" ? "Delivered Orders" : "Net Profit (₦)")} iconType="circle" iconSize={7} />
                <Bar yAxisId="n" dataKey="orders" fill="#1d4ed8" radius={[3, 3, 0, 0]} maxBarSize={22} isAnimationActive={false} />
                <Bar yAxisId="n" dataKey="delivered" fill="#16a34a" radius={[3, 3, 0, 0]} maxBarSize={22} isAnimationActive={false} />
                {canSeeProfit && <Line yAxisId="m" dataKey="net" stroke="#a21caf" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        <Panel title="Delivery Rate Trend" info="Overall and the three busiest states." action={grainSelect(rateGrain, setRateGrain)}>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={rateData} margin={{ top: 6, right: 6, left: -16, bottom: 0 }}>
                <CartesianGrid stroke="#e5e7eb" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="key" tick={{ fontSize: 10, fill: "#6b7280" }} tickFormatter={xTick(rateGrain)} minTickGap={16} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: "#6b7280" }} tickFormatter={(v: number) => `${v}%`} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} formatter={(v: any, name: any) => [v === null ? "—" : `${Number(v).toFixed(1)}%`, name === "overall" ? "Overall DR" : stateLabel(String(name))]} />
                <Legend verticalAlign="top" formatter={(name: any) => legendText(name === "overall" ? "Overall DR" : stateLabel(String(name)))} iconType="circle" iconSize={7} />
                <Line dataKey="overall" stroke="#1d4ed8" strokeWidth={2.5} dot={false} connectNulls={false} isAnimationActive={false} />
                {topStates.map((s, i) => <Line key={s} dataKey={s} stroke={SERIES_COLORS[i + 1]} strokeWidth={1.5} dot={false} connectNulls={false} isAnimationActive={false} />)}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        <Panel title={canSeeProfit ? "Revenue & Net Profit Trend" : "Revenue Trend"} action={grainSelect(moneyGrain, setMoneyGrain)}>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={moneyData} margin={{ top: 6, right: 6, left: -4, bottom: 0 }}>
                <CartesianGrid stroke="#e5e7eb" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="key" tick={{ fontSize: 10, fill: "#6b7280" }} tickFormatter={xTick(moneyGrain)} minTickGap={16} />
                <YAxis tick={{ fontSize: 10, fill: "#6b7280" }} tickFormatter={shortMoney} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} formatter={(v: any, name: any) => [money(Number(v)), name === "revenue" ? "Delivered Revenue" : "Net Profit"]} />
                <Legend verticalAlign="top" formatter={(name: any) => legendText(name === "revenue" ? "Delivered Revenue" : "Net Profit")} iconType="circle" iconSize={7} />
                <Area dataKey="revenue" type="monotone" stroke="#1d4ed8" fill="#1d4ed8" fillOpacity={0.15} strokeWidth={2} isAnimationActive={false} />
                {canSeeProfit && <Area dataKey="net" type="monotone" stroke="#16a34a" fill="#16a34a" fillOpacity={0.15} strokeWidth={2} isAnimationActive={false} />}
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Panel title="Top Products by Growth">
          <Segmented small fill value={growthMode} onChange={setGrowthMode} options={[{ value: "orders", label: "Orders" }, { value: "delivered", label: "Delivered Orders" }, { value: "revenue", label: "Revenue" }, ...(canSeeProfit ? [{ value: "net" as GrowthMode, label: "Net Profit" }] : [])]} />
          <table className="mt-2 w-full !min-w-0 border-separate border-spacing-0">
            <thead><tr><th className={th}>#</th><th className={th}>Product</th><th className={th}>Current Period</th><th className={th}>Previous Period</th><th className={th}>Growth</th></tr></thead>
            <tbody>{productGrowth.map(({ r, cur, prev }, i) => (
              <tr key={r.product.id} className="[&>td]:[color:inherit]">
                <td className={td}>{i + 1}</td>
                <td className={td}><span className="flex items-center gap-2"><ProductThumb src={ctx.imageOf(r.product.id)} name={r.product.name} size={24} /><span className="max-w-[96px] truncate" title={r.product.name}>{r.product.name}</span></span></td>
                <td className={td}>{fmtGrowth(cur)}</td><td className={td}>{fmtGrowth(prev)}</td><td className={td}><Delta value={prev > 0 ? growthPct(cur, prev) : null} /></td>
              </tr>
            ))}</tbody>
          </table>
        </Panel>
        <Panel title="Top States by Growth" info="Orders, states with 5+ orders in the period before.">
          <table className="w-full !min-w-0 border-separate border-spacing-0">
            <thead><tr><th className={th}>#</th><th className={th}>State</th><th className={th}>Current Period</th><th className={th}>Previous Period</th><th className={th}>Growth</th></tr></thead>
            <tbody>
              {stateGrowth.map(({ r, cur, prev, g }, i) => (
                <tr key={r.state} className="[&>td]:[color:inherit]"><td className={td}><span className="inline-flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold text-white" style={{ background: SERIES_COLORS[i % 5] }}>{i + 1}</span></td>
                  <td className={td}>{stateLabel(r.state)}</td><td className={td}>{nf(cur)}</td><td className={td}>{nf(prev)}</td><td className={td}><Delta value={g} /></td></tr>
              ))}
              {stateGrowth.length === 0 && <tr><td colSpan={5} className={`${td} py-6 text-center text-gray-400`}>Not enough orders in the period before.</td></tr>}
            </tbody>
          </table>
        </Panel>
        <Panel title="Key Trend Insights">
          <div className="space-y-2">
            {insights.length === 0 && <p className="m-0 py-4 text-center text-[12px] text-gray-400">Not enough orders for insights yet.</p>}
            {insights.map((item) => <InsightCard key={item.title} Icon={item.Icon} tone={item.tone} title={item.title} text={item.text} />)}
          </div>
        </Panel>
      </div>
    </div>
  );
}
