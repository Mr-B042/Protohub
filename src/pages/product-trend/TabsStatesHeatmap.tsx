import { useCallback, useMemo, useState, type ReactNode } from "react";
import { AlertCircle, Banknote, BarChart3, CircleCheck, CirclePercent, Columns3, Download, Ellipsis, MapPin, Search, ShoppingCart, TrendingUp, Truck, Wallet } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ALL, MIN_RATE_SAMPLE, countBins, figuresFor, growthPct, isDelivered, stateLabel, stockBand, type StateRow } from "./product-trend-model";
import {
  Donut, InsightCard, KpiTile, NigeriaMap, Panel, Pill, ProductThumb, SERIES_COLORS, Segmented, SelectBox, Sparkline, countLegend, downloadCsv, nf, pct1, useClickAway,
  type MapBin, type MapDatum
} from "./parts";
import { NET_NOTE, ProductStatePanel, daysCover, td, th } from "./DetailPanels";
import { STATE_COUNT, heatColor, mapKey, netOf, rateOf, sparkOf, type TabCtx } from "./tab-context";

// State Breakdown and Product × State Heatmap (Bright's designs, 20 Oct 2026).

const rateLegend = (): MapBin[] => [
  { label: "70%+", color: "#15803d", test: (v) => v !== null && v >= 70 },
  { label: "60 – 69%", color: "#22c55e", test: (v) => v !== null && v >= 60 && v < 70 },
  { label: "50 – 59%", color: "#facc15", test: (v) => v !== null && v >= 50 && v < 60 },
  { label: "40 – 49%", color: "#fb923c", test: (v) => v !== null && v >= 40 && v < 50 },
  { label: "Below 40%", color: "#ef4444", test: (v) => v !== null && v > 0 && v < 40 },
  { label: "No orders", color: "#eef2f7", test: (v) => !v }
];
function moneyLegend(max: number, money: (v: number) => string): MapBin[] {
  const step = Math.max(1, Math.ceil(max / 5 / 10000) * 10000);
  const cuts = [4, 3, 2, 1].map((k) => k * step);
  const blues = ["#1d4ed8", "#3b82f6", "#60a5fa", "#93c5fd", "#bfdbfe"];
  return [
    { label: `${money(cuts[0])}+`, color: blues[0], test: (v) => v !== null && v >= cuts[0] },
    ...cuts.slice(1).map((cut, i) => ({ label: `${money(cut)}+`, color: blues[i + 1], test: (v: number | null) => v !== null && v >= cut && v < cuts[i] })),
    { label: `Below ${money(cuts[3])}`, color: blues[4], test: (v) => v !== null && v > 0 && v < cuts[3] },
    { label: "None / loss", color: "#eef2f7", test: (v) => !v || v <= 0 }
  ];
}

/** Map datum with the same hover figures everywhere. */
function stateDatum(value: number, row: StateRow | undefined, money: (v: number) => string, canSeeProfit: boolean): MapDatum {
  return {
    value,
    tooltip: row ? (
      <div className="space-y-0.5 text-gray-600 dark:text-slate-300">
        <div>Orders: <strong className="text-gray-900 dark:text-slate-100">{nf(row.now.orders)}</strong></div>
        <div>Delivered: <strong className="text-gray-900 dark:text-slate-100">{nf(row.now.delivered)}</strong></div>
        <div>Delivery rate: <strong className="text-gray-900 dark:text-slate-100">{pct1(row.now.rate)}</strong></div>
        {canSeeProfit && <div>Net profit: <strong className="text-gray-900 dark:text-slate-100">{money(row.now.net)}</strong></div>}
        <div>Stock with agents: <strong className="text-gray-900 dark:text-slate-100">{nf(row.stockWithAgents)}</strong></div>
        <div>Active agents: <strong className="text-gray-900 dark:text-slate-100">{nf(row.activeAgents)}</strong></div>
      </div>
    ) : null
  };
}

const stockStatusOf = (row: StateRow, days: number) => {
  const cover = daysCover(row.stockWithAgents, row.now.unitsDelivered, days);
  if (row.now.unitsDelivered === 0) return row.stockWithAgents > 0 ? { label: "No sales", tone: "gray" as const } : { label: "—", tone: "gray" as const };
  const band = stockBand(row.stockWithAgents, 0, cover);
  return band === "Critical" || band === "High" ? { label: "Low", tone: "red" as const } : band === "Medium" ? { label: "Medium", tone: "amber" as const } : { label: "Good", tone: "green" as const };
};

// ── State Breakdown ─────────────────────────────────────────────────────────

type TopMode = "orders" | "delivered" | "rate" | "net";
type StateSort = "orders" | "confirmed" | "delivered" | "rate" | "revenue" | "net" | "aov" | "agents";

export function StateBreakdownTab({ ctx, onShowState, filters }: { ctx: TabCtx; onShowState: (state: string) => void; filters?: ReactNode }) {
  const { model, money, canSeeProfit, days, from, to } = ctx;
  const rows = model.stateRows;
  const [mapMetric, setMapMetric] = useState<TopMode>("delivered");
  const [topMode, setTopMode] = useState<TopMode>("orders");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ key: StateSort; desc: boolean }>({ key: "orders", desc: true });
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [columnsOpen, setColumnsOpen] = useState(false);
  const closeColumns = useCallback(() => setColumnsOpen(false), []);
  const columnsRef = useClickAway<HTMLDivElement>(columnsOpen, closeColumns);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const closeMenu = useCallback(() => setMenuFor(null), []);
  const menuRef = useClickAway<HTMLDivElement>(menuFor !== null, closeMenu);

  const totals = figuresFor(model.orders, model.costs);
  const before = figuresFor(model.previous, model.previousCosts);
  const activeNow = rows.filter((r) => r.now.orders > 0).length;
  const activeBefore = new Set(model.previous.map((o) => o.state).filter(Boolean)).size;
  const spark = (fn: (b: typeof model.orders) => number) => sparkOf(model.orders, from, to, days, fn);

  // Map.
  const valueOf = (row: StateRow, mode: TopMode) => mode === "orders" ? row.now.orders : mode === "delivered" ? row.now.delivered : mode === "rate" ? row.now.rate : row.now.net;
  const mapData = useMemo(() => Object.fromEntries(rows.map((row) => [mapKey(row.state), stateDatum(valueOf(row, mapMetric), row, money, canSeeProfit)])), [rows, mapMetric, money, canSeeProfit]);
  const mapMax = Math.max(0, ...rows.map((row) => valueOf(row, mapMetric)));
  const legend = mapMetric === "rate" ? rateLegend() : mapMetric === "net" ? moneyLegend(mapMax, money) : countLegend(countBins(mapMax));
  const legendTitle = mapMetric === "orders" ? "Total Orders" : mapMetric === "delivered" ? "Delivered Orders" : mapMetric === "rate" ? "Delivery Rate" : "Net Profit";

  // Top states.
  const topRows = [...rows].filter((r) => topMode !== "rate" || r.now.orders >= MIN_RATE_SAMPLE).sort((a, b) => valueOf(b, topMode) - valueOf(a, topMode));
  const top9 = topRows.slice(0, 9);
  const rest = rows.filter((r) => !top9.includes(r));
  const restFig = figuresFor(model.orders.filter((o) => !top9.some((r) => r.state === o.state)), model.costs);
  const totalFor = (mode: TopMode) => mode === "orders" ? totals.orders : mode === "delivered" ? totals.delivered : mode === "net" ? rows.reduce((s, r) => s + Math.max(0, r.now.net), 0) : 100;
  const othersValue = topMode === "orders" ? restFig.orders : topMode === "delivered" ? restFig.delivered : topMode === "rate" ? restFig.rate : restFig.net;
  const topMax = Math.max(1, ...top9.map((r) => valueOf(r, topMode)), topMode === "rate" ? 100 : othersValue);
  const barColors = ["#1d4ed8", "#a855f7", "#facc15", "#22c55e", "#ef4444", "#f97316", "#3b82f6", "#3b82f6", "#a855f7"];

  // Delivery rate list.
  const rateRows = rows.filter((r) => r.now.orders >= MIN_RATE_SAMPLE).sort((a, b) => b.now.rate - a.now.rate).slice(0, 9);
  const rateRest = figuresFor(model.orders.filter((o) => !rateRows.some((r) => r.state === o.state)), model.costs);

  // Details table.
  const term = search.trim().toLowerCase();
  const sortValue = (row: StateRow): number => {
    switch (sort.key) {
      case "orders": return row.now.orders;
      case "confirmed": return row.now.confirmed;
      case "delivered": return row.now.delivered;
      case "rate": return row.now.orders >= MIN_RATE_SAMPLE ? row.now.rate : -1;
      case "revenue": return row.now.revenue;
      case "net": return row.now.net;
      case "aov": return row.now.aov;
      case "agents": return row.activeAgents;
    }
  };
  const tableRows = rows.filter((r) => !term || stateLabel(r.state).toLowerCase().includes(term)).sort((a, b) => (sort.desc ? sortValue(b) - sortValue(a) : sortValue(a) - sortValue(b)));
  const productName = (id: string) => ctx.products.find((p) => p.id === id)?.name ?? "—";
  const COLS = ["Confirmed Orders", "Delivered Revenue", ...(canSeeProfit ? ["Net Profit"] : []), "Avg. AOV", "Top Product", "Active Agents", "Stock Status", "Trend"];
  const show = (col: string) => !hidden.has(col);
  const head = (key: StateSort | null, label: string) => (
    <th className={th}>
      {key ? <button type="button" onClick={() => setSort((s) => ({ key, desc: s.key === key ? !s.desc : true }))} className="!min-h-0 whitespace-nowrap">{label} <span className={sort.key === key ? "text-[#1F8FE0]" : "text-gray-400"}>⇅</span></button> : <span className="whitespace-nowrap">{label}</span>}
    </th>
  );

  ctx.exportRef.current = () => downloadCsv(`state-performance-${from}-to-${to}.csv`, [
    ["State", "Total Orders", "Confirmed Orders", "Delivered Orders", "Delivery Rate %", "Delivered Revenue", ...(canSeeProfit ? ["Net Profit (shared costs by sales)"] : []), "Avg. AOV", "Top Product", "Active Agents", "Stock with Agents", "Stock Status"],
    ...tableRows.map((r) => [stateLabel(r.state), r.now.orders, r.now.confirmed, r.now.delivered, r.now.rate.toFixed(1), Math.round(r.now.revenue), ...(canSeeProfit ? [Math.round(r.now.net)] : []),
      Math.round(r.now.aov), r.topProducts[0] ? productName(r.topProducts[0].key) : "", r.activeAgents, r.stockWithAgents, stockStatusOf(r, days).label])
  ]);

  // Insights, each from the figures.
  const enough = rows.filter((r) => r.now.orders >= MIN_RATE_SAMPLE);
  const strongest = [...enough].sort((a, b) => b.now.delivered * b.now.rate - a.now.delivered * a.now.rate)[0];
  const shortest = [...rows].filter((r) => r.now.unitsDelivered > 0).map((r) => ({ r, cover: daysCover(r.stockWithAgents, r.now.unitsDelivered, days) ?? Infinity })).sort((a, b) => a.cover - b.cover)[0];
  const growing = [...rows].filter((r) => r.before.delivered >= 5).map((r) => ({ r, g: growthPct(r.now.delivered, r.before.delivered) ?? 0 })).sort((a, b) => b.g - a.g)[0];
  const weakest = [...enough].sort((a, b) => a.now.rate - b.now.rate)[0];
  const insights = [
    strongest && strongest.now.delivered > 0 && { Icon: BarChart3, tone: "bg-emerald-50 text-emerald-600", title: `${stateLabel(strongest.state)} is your strongest state`, text: `Highest delivered orders (${nf(strongest.now.delivered)}) at a ${pct1(strongest.now.rate)} delivery rate. Keep its stock topped up.`, state: strongest.state },
    shortest && shortest.cover < 14 && { Icon: Wallet, tone: "bg-amber-50 text-amber-600", title: `${stateLabel(shortest.r.state)} needs more stock`, text: `${nf(shortest.r.now.delivered)} deliveries but only ${nf(shortest.r.stockWithAgents)} units with agents - about ${shortest.cover.toFixed(0)} days at this pace.`, state: shortest.r.state },
    growing && growing.g > 0 && { Icon: TrendingUp, tone: "bg-blue-50 text-blue-600", title: `${stateLabel(growing.r.state)} is growing fast`, text: `Delivered orders up ${growing.g.toFixed(1)}% on the period before.`, state: growing.r.state },
    weakest && weakest !== strongest && weakest.now.rate < totals.rate - 5 && { Icon: AlertCircle, tone: "bg-rose-50 text-rose-600", title: `${stateLabel(weakest.state)} has a low delivery rate`, text: `Only ${pct1(weakest.now.rate)} delivered against ${pct1(totals.rate)} overall. Look at its agents and why orders failed.`, state: weakest.state }
  ].filter(Boolean) as Array<{ Icon: typeof BarChart3; tone: string; title: string; text: string; state: string }>;

  // Contribution to net profit.
  const profitRows = [...rows].filter((r) => r.now.net > 0).sort((a, b) => b.now.net - a.now.net);
  const profitTotal = profitRows.reduce((s, r) => s + r.now.net, 0);
  const slices = [...profitRows.slice(0, 5).map((r, i) => ({ label: stateLabel(r.state), value: r.now.net, color: SERIES_COLORS[i] })),
    ...(profitRows.length > 5 ? [{ label: "Others", value: profitRows.slice(5).reduce((s, r) => s + r.now.net, 0), color: "#94a3b8" }] : [])];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <KpiTile Icon={ShoppingCart} tone="bg-blue-50 text-blue-600" label="Total Orders" value={nf(totals.orders)} delta={growthPct(totals.orders, before.orders)} spark={spark((b) => b.length)} />
        <KpiTile Icon={Truck} tone="bg-emerald-50 text-emerald-600" label="Delivered Orders" value={nf(totals.delivered)} delta={growthPct(totals.delivered, before.delivered)} spark={spark((b) => b.filter(isDelivered).length)} />
        <KpiTile Icon={CirclePercent} tone="bg-emerald-50 text-emerald-600" label="Delivery Rate" value={pct1(totals.rate)} delta={before.orders > 0 ? totals.rate - before.rate : null} deltaPoints spark={spark(rateOf)} />
        <KpiTile Icon={Banknote} tone="bg-amber-50 text-amber-600" label="Delivered Revenue" value={money(totals.revenue)} delta={growthPct(totals.revenue, before.revenue)} spark={spark((b) => b.filter(isDelivered).reduce((s, o) => s + o.amount, 0))} />
        {canSeeProfit
          ? <KpiTile Icon={BarChart3} tone="bg-violet-50 text-violet-600" label="Net Profit (Delivered)" value={money(totals.net)} delta={before.net > 0 ? growthPct(totals.net, before.net) : null} spark={spark((b) => netOf(b, model.costs))} info="Same as Finance › Product Profitability: Direct Net Profit − Shared Opex." />
          : <KpiTile Icon={BarChart3} tone="bg-violet-50 text-violet-600" label="Delivered AOV" value={totals.delivered > 0 ? money(totals.aov) : "—"} delta={before.delivered > 0 && totals.delivered > 0 ? growthPct(totals.aov, before.aov) : null} />}
        <KpiTile Icon={MapPin} tone="bg-rose-50 text-rose-500" label="Active States" value={`${activeNow} / ${STATE_COUNT}`}
          foot={<span className="inline-flex items-center gap-1"><CircleCheck className="h-3 w-3 text-emerald-600" />{activeNow - activeBefore >= 0 ? `${activeNow - activeBefore} more` : `${activeBefore - activeNow} fewer`} than last period</span>} />
      </div>
      {filters}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.25fr_1fr_0.85fr]">
        <Panel title="Nigeria State Performance Map" info="States shaded by the chosen measure. Hover a state for all its figures; click it to see it in the table.">
          <div className="mb-3 flex items-center gap-2 text-[12.5px] text-gray-600"><span>Metric</span>
            <SelectBox label="Metric" className="w-48" value={mapMetric} onChange={setMapMetric}
              options={[{ value: "delivered", label: "Delivered Orders" }, { value: "orders", label: "Total Orders" }, { value: "rate", label: "Delivery Rate" }, ...(canSeeProfit ? [{ value: "net" as TopMode, label: "Net Profit" }] : [])]} />
          </div>
          <NigeriaMap data={mapData} zoomable legend={{ title: legendTitle, bins: legend }} formatValue={(v) => mapMetric === "rate" ? `${v.toFixed(0)}%` : mapMetric === "net" ? money(v) : nf(v)}
            onSelect={(name) => { const row = rows.find((r) => mapKey(r.state) === name); if (row) onShowState(row.state); }} />
        </Panel>

        <Panel title="Top States by Orders" action={<button type="button" onClick={() => document.getElementById("pt-state-details")?.scrollIntoView({ behavior: "smooth" })} className="!min-h-0 text-[12px] font-semibold text-[#1F8FE0]">View all</button>}>
          <Segmented small fill value={topMode} onChange={setTopMode} options={[{ value: "orders", label: "Total Orders" }, { value: "delivered", label: "Delivered Orders" }, { value: "rate", label: "Delivery Rate" }, ...(canSeeProfit ? [{ value: "net" as TopMode, label: "Net Profit" }] : [])]} />
          <table className="mt-2 w-full !min-w-0 border-separate border-spacing-0">
            <thead><tr><th className={th}>#</th><th className={th}>State</th><th className={th}>{topMode === "orders" ? "Total Orders" : topMode === "delivered" ? "Delivered" : topMode === "rate" ? "Rate" : "Net Profit"}</th><th className={th} /><th className={`${th} !text-right`}>{topMode === "rate" ? "" : "% of Total"}</th></tr></thead>
            <tbody>
              {top9.map((row, i) => {
                const v = valueOf(row, topMode);
                return (
                  <tr key={row.state} className="[&>td]:[color:inherit]">
                    <td className={`${td} !border-0 !py-1.5 font-bold text-[#1F8FE0]`}>{i + 1}</td>
                    <td className={`${td} !border-0 !py-1.5`}>{stateLabel(row.state)}</td>
                    <td className={`${td} !border-0 !py-1.5 font-semibold`}>{topMode === "rate" ? pct1(v) : topMode === "net" ? money(v) : nf(v)}</td>
                    <td className={`${td} !border-0 !py-1.5 w-[38%]`}><span className="block h-2 rounded-full bg-gray-100"><span className="block h-2 rounded-full" style={{ width: `${Math.max(0, (v / topMax) * 100)}%`, background: barColors[i] }} /></span></td>
                    <td className={`${td} !border-0 !py-1.5 text-right text-gray-600`}>{topMode === "rate" ? "" : `${(totalFor(topMode) > 0 ? (v / totalFor(topMode)) * 100 : 0).toFixed(1)}%`}</td>
                  </tr>
                );
              })}
              {rest.length > 0 && (
                <tr className="[&>td]:[color:inherit]">
                  <td className={`${td} !border-0 !py-1.5 font-bold text-gray-400`}>{top9.length + 1}</td>
                  <td className={`${td} !border-0 !py-1.5 text-gray-500`}>Others</td>
                  <td className={`${td} !border-0 !py-1.5 font-semibold`}>{topMode === "rate" ? pct1(othersValue) : topMode === "net" ? money(othersValue) : nf(othersValue)}</td>
                  <td className={`${td} !border-0 !py-1.5`}><span className="block h-2 rounded-full bg-gray-100"><span className="block h-2 rounded-full bg-gray-400" style={{ width: `${Math.max(0, (othersValue / topMax) * 100)}%` }} /></span></td>
                  <td className={`${td} !border-0 !py-1.5 text-right text-gray-600`}>{topMode === "rate" ? "" : `${(totalFor(topMode) > 0 ? (othersValue / totalFor(topMode)) * 100 : 0).toFixed(1)}%`}</td>
                </tr>
              )}
              {top9.length === 0 && <tr><td colSpan={5} className={`${td} !border-0 py-6 text-center text-gray-400`}>{topMode === "rate" ? `No state has ${MIN_RATE_SAMPLE}+ orders yet.` : "No orders."}</td></tr>}
            </tbody>
          </table>
        </Panel>

        <Panel title="Delivery Rate by State" info={`States with ${MIN_RATE_SAMPLE}+ orders.`} action={<button type="button" onClick={() => document.getElementById("pt-state-details")?.scrollIntoView({ behavior: "smooth" })} className="!min-h-0 text-[12px] font-semibold text-[#1F8FE0]">View all</button>}>
          <div className="mb-1 grid grid-cols-[20px_76px_1fr_44px] gap-2 border-b border-gray-100 pb-1.5 text-[11px] font-semibold text-gray-500"><span>#</span><span>State</span><span>Delivery Rate</span><span /></div>
          <ol className="m-0 list-none space-y-2 p-0">
            {rateRows.map((row, i) => (
              <li key={row.state} className="grid grid-cols-[20px_76px_1fr_44px] items-center gap-2 text-[12px]">
                <span className="font-bold text-amber-600">{i + 1}</span><span className="truncate">{stateLabel(row.state)}</span>
                <span className="h-2.5 rounded-sm bg-gray-100"><span className="block h-2.5 rounded-sm bg-emerald-600" style={{ width: `${row.now.rate}%` }} /></span>
                <span className="text-right font-semibold">{pct1(row.now.rate)}</span>
              </li>
            ))}
            {rateRows.length > 0 && rateRest.orders > 0 && (
              <li className="grid grid-cols-[20px_76px_1fr_44px] items-center gap-2 text-[12px]">
                <span className="font-bold text-gray-400">{rateRows.length + 1}</span><span className="text-gray-500">Others</span>
                <span className="h-2.5 rounded-sm bg-gray-100"><span className="block h-2.5 rounded-sm bg-emerald-600/60" style={{ width: `${rateRest.rate}%` }} /></span>
                <span className="text-right font-semibold">{pct1(rateRest.rate)}</span>
              </li>
            )}
            {rateRows.length === 0 && <li className="py-6 text-center text-[12px] text-gray-400">No state has {MIN_RATE_SAMPLE}+ orders yet.</li>}
          </ol>
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_340px]">
        <section id="pt-state-details" className="min-w-0 rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-slate-800">
          <div className="flex flex-col gap-2 px-4 pt-4 lg:flex-row lg:items-center lg:justify-between">
            <h3 className="m-0 text-[16px] font-black text-gray-900 dark:text-slate-50">State Performance Details</h3>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex h-9 w-48 items-center gap-2 rounded-lg border border-gray-200 px-3 dark:border-slate-700"><Search className="h-4 w-4 text-gray-400" /><span className="sr-only">Search states</span>
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search states..." className="!min-h-0 w-full bg-transparent text-[12.5px] outline-none" /></label>
              <div className="relative" ref={columnsRef}>
                <button type="button" onClick={() => setColumnsOpen((o) => !o)} className="!min-h-0 inline-flex h-9 items-center gap-1.5 rounded-lg border border-gray-200 px-3 text-[12.5px] font-semibold text-gray-700 dark:border-slate-700"><Columns3 className="h-4 w-4" /> Columns</button>
                {columnsOpen && (
                  <div className="absolute right-0 top-full z-30 mt-1 w-52 rounded-xl border border-gray-200 bg-white p-2 shadow-xl dark:border-slate-700 dark:bg-slate-900">
                    {COLS.map((col) => <label key={col} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[12.5px] hover:bg-gray-50"><input type="checkbox" checked={show(col)} onChange={() => setHidden((h) => { const n = new Set(h); if (n.has(col)) n.delete(col); else n.add(col); return n; })} />{col}</label>)}
                  </div>
                )}
              </div>
              <button type="button" onClick={() => ctx.exportRef.current()} className="!min-h-0 inline-flex h-9 items-center gap-1.5 rounded-lg border border-gray-200 px-3 text-[12.5px] font-semibold text-gray-700 dark:border-slate-700"><Download className="h-4 w-4" /> Export</button>
            </div>
          </div>
          <div className="mt-3 max-h-[560px] overflow-auto">
            <table className="w-full !min-w-[1060px] border-separate border-spacing-0">
              <thead><tr>
                <th className={th}>#</th><th className={th}>State</th>{head("orders", "Total Orders")}{show("Confirmed Orders") && head("confirmed", "Confirmed Orders")}{head("delivered", "Delivered Orders")}{head("rate", "Delivery Rate")}
                {show("Delivered Revenue") && head("revenue", "Delivered Revenue")}{canSeeProfit && show("Net Profit") && head("net", "Net Profit")}{show("Avg. AOV") && head("aov", "Avg. AOV")}
                {show("Top Product") && head(null, "Top Product")}{show("Active Agents") && head("agents", "Active Agents")}{show("Stock Status") && head(null, "Stock Status")}{show("Trend") && head(null, "Trend")}{head(null, "Actions")}
              </tr></thead>
              <tbody>
                {tableRows.length === 0 && <tr><td colSpan={14} className={`${td} py-10 text-center text-gray-500`}>{term ? "No state matches." : "No orders in this period."}</td></tr>}
                {tableRows.map((row, i) => {
                  const status = stockStatusOf(row, days);
                  const rateUp = row.before.orders > 0 ? row.now.rate - row.before.rate : null;
                  const stateOrders = model.orders.filter((o) => o.state === row.state);
                  return (
                    <tr key={row.state} className="hover:bg-gray-50/70 [&>td]:[color:inherit]">
                      <td className={td}>{i + 1}</td>
                      <td className={`${td} font-semibold`}>{stateLabel(row.state)}</td>
                      <td className={td}>{nf(row.now.orders)}</td>
                      {show("Confirmed Orders") && <td className={td} title="Orders that got past the call: Confirmed or later.">{nf(row.now.confirmed)}</td>}
                      <td className={td}>{nf(row.now.delivered)}</td>
                      <td className={td}><span className={`font-semibold ${rateUp === null ? "" : rateUp >= 0 ? "text-emerald-600" : "text-rose-600"}`}>{rateUp === null ? "" : rateUp >= 0 ? "↑ " : "↓ "}{pct1(row.now.rate)}</span></td>
                      {show("Delivered Revenue") && <td className={td}>{money(row.now.revenue)}</td>}
                      {canSeeProfit && show("Net Profit") && <td className={td} title={NET_NOTE}><span className={row.now.net < 0 ? "text-rose-600" : row.now.net >= row.before.net ? "text-emerald-700" : "text-rose-600"}>{row.now.net >= row.before.net ? "↑ " : "↓ "}{money(row.now.net)}</span></td>}
                      {show("Avg. AOV") && <td className={td}>{row.now.delivered > 0 ? money(row.now.aov) : "—"}</td>}
                      {show("Top Product") && <td className={`${td} max-w-[120px] truncate`}>{row.topProducts[0] ? productName(row.topProducts[0].key) : "—"}</td>}
                      {show("Active Agents") && <td className={td}>{nf(row.activeAgents)}</td>}
                      {show("Stock Status") && <td className={td} title={`${nf(row.stockWithAgents)} units with agents`}><Pill tone={status.tone}>{status.label}</Pill></td>}
                      {show("Trend") && <td className={td}><Sparkline values={sparkOf(stateOrders, from, to, days, (b) => b.length)} /></td>}
                      <td className={td}>
                        <div className="relative flex items-center gap-1" ref={menuFor === row.state ? menuRef : undefined}>
                          <button type="button" onClick={() => onShowState(row.state)} className="!min-h-0 rounded-md border border-blue-200 px-2.5 py-1 text-[11.5px] font-semibold text-[#1F8FE0] hover:bg-blue-50">View</button>
                          <button type="button" aria-label="More" onClick={() => setMenuFor(menuFor === row.state ? null : row.state)} className="!min-h-0 rounded-md border border-gray-200 px-1.5 py-1 text-gray-500"><Ellipsis className="h-3.5 w-3.5" /></button>
                          {menuFor === row.state && (
                            <div className="absolute right-0 top-full z-30 mt-1 w-48 rounded-xl border border-gray-200 bg-white p-1 text-[12px] shadow-xl dark:border-slate-700 dark:bg-slate-900">
                              <button type="button" onClick={() => { onShowState(row.state); setMenuFor(null); }} className="!min-h-0 block w-full rounded-lg px-3 py-2 text-left hover:bg-gray-50">Show only this state</button>
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
          {canSeeProfit && <p className="m-0 px-4 py-2.5 text-[11px] text-gray-500">Net profit: {NET_NOTE}</p>}
        </section>

        <div className="space-y-4">
          <Panel title="Key State Insights">
            <div className="space-y-2">
              {insights.length === 0 && <p className="m-0 py-4 text-center text-[12px] text-gray-400">Not enough orders for insights yet.</p>}
              {insights.map((item) => <InsightCard key={item.title} Icon={item.Icon} tone={item.tone} title={item.title} text={item.text} onView={() => onShowState(item.state)} />)}
            </div>
          </Panel>
          {canSeeProfit && (
            <Panel title="State Contribution to Net Profit" info="Each state's share of the period's positive net profit.">
              <div className="flex items-center gap-4">
                <Donut slices={slices} center={money(profitTotal).replace(/(\d)(\d{2}),\d{3},\d{3}$/, "$1.$2M")} sub="Net Profit" />
                <ul className="m-0 min-w-0 flex-1 list-none space-y-1.5 p-0">
                  {slices.map((slice) => (
                    <li key={slice.label} className="flex items-center justify-between gap-2 text-[11.5px]"><span className="flex min-w-0 items-center gap-1.5"><span className="h-2 w-2 shrink-0 rounded-full" style={{ background: slice.color }} /><span className="truncate">{slice.label}</span></span><span className="text-gray-600">{profitTotal > 0 ? ((slice.value / profitTotal) * 100).toFixed(1) : "0"}%</span></li>
                  ))}
                  {slices.length === 0 && <li className="text-[12px] text-gray-400">No profit in this period.</li>}
                </ul>
              </div>
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Product × State Heatmap ─────────────────────────────────────────────────

type HeatMetric = "delivered" | "orders" | "rate" | "net";

export function HeatmapTab({ ctx }: { ctx: TabCtx }) {
  const { model, products, money, canSeeProfit, days } = ctx;
  const [mapProduct, setMapProduct] = useState<string>(ctx.productId);
  const [metric, setMetric] = useState<HeatMetric>("delivered");
  const [search, setSearch] = useState("");
  const [onlyState, setOnlyState] = useState<string>(ALL);
  const [open, setOpen] = useState<{ productId: string; state: string } | null>(null);
  const [barMode, setBarMode] = useState<"delivered" | "rate" | "net">("delivered");
  const [focusProduct, setFocusProduct] = useState<string>("");
  const [compareStates, setCompareStates] = useState<string[] | null>(null);
  const [compareMetric, setCompareMetric] = useState<"delivered" | "orders" | "rate">("delivered");

  const valueOfFig = (f: ReturnType<typeof figuresFor>, m: HeatMetric) => m === "delivered" ? f.delivered : m === "orders" ? f.orders : m === "rate" ? f.rate : f.net;
  const fmt = (v: number, m: HeatMetric) => m === "rate" ? `${v.toFixed(0)}%` : m === "net" ? money(v) : nf(v);
  const metricLabel = (m: HeatMetric) => m === "delivered" ? "Delivered Orders" : m === "orders" ? "Total Orders" : m === "rate" ? "Delivery Rate" : "Net Profit";

  // Map.
  const mapOrders = mapProduct === ALL ? model.orders : model.orders.filter((o) => o.productId === mapProduct);
  const mapRows = useMemo(() => {
    const states = new Set(mapOrders.map((o) => o.state).filter(Boolean));
    return [...states].map((state) => ({ state, f: figuresFor(mapOrders.filter((o) => o.state === state), model.costs) }));
  }, [mapOrders, model.costs]);
  const mapData = Object.fromEntries(mapRows.map(({ state, f }) => [mapKey(state), {
    value: valueOfFig(f, metric),
    tooltip: <div className="space-y-0.5 text-gray-600"><div>Orders: <strong>{nf(f.orders)}</strong></div><div>Delivered: <strong>{nf(f.delivered)}</strong></div><div>Rate: <strong>{pct1(f.rate)}</strong></div></div>
  }]));
  const mapMax = Math.max(0, ...mapRows.map((r) => valueOfFig(r.f, metric)));
  const legend = metric === "rate" ? rateLegend() : metric === "net" ? moneyLegend(mapMax, money) : countLegend(countBins(mapMax));

  // Table: top 10 states + Others.
  const stateTotals = useMemo(() => {
    const counts = new Map<string, number>();
    for (const o of model.orders) if (o.state) counts.set(o.state, (counts.get(o.state) ?? 0) + (metric === "delivered" ? Number(isDelivered(o)) : 1));
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([s]) => s);
  }, [model.orders, metric]);
  const columns = onlyState === ALL ? stateTotals.slice(0, 10) : [onlyState];
  const cellFig = (productId: string, states: string[] | "others") => figuresFor(model.orders.filter((o) => o.productId === productId && (states === "others" ? !columns.includes(o.state) : states.includes(o.state))), model.costs);
  const term = search.trim().toLowerCase();
  const tableProducts = model.productRows.filter((r) => !term || r.product.name.toLowerCase().includes(term))
    .sort((a, b) => valueOfFig(b.now, metric) - valueOfFig(a.now, metric));
  const cells = tableProducts.map((r) => ({ row: r, values: columns.map((s) => valueOfFig(cellFig(r.product.id, [s]), metric)), others: valueOfFig(cellFig(r.product.id, "others"), metric) }));
  const cellMax = Math.max(1, ...cells.flatMap((c) => [...c.values, c.others]));
  const totalsRow = columns.map((s) => valueOfFig(figuresFor(model.orders.filter((o) => o.state === s), model.costs), metric));
  const othersTotal = valueOfFig(figuresFor(model.orders.filter((o) => !columns.includes(o.state)), model.costs), metric);
  const grand = valueOfFig(figuresFor(model.orders, model.costs), metric);

  ctx.exportRef.current = () => downloadCsv(`product-by-state-${metric}.csv`, [
    ["Product", "Total", ...columns.map(stateLabel), "Others"],
    ...cells.map((c) => [c.row.product.name, Math.round(valueOfFig(c.row.now, metric) * 10) / 10, ...c.values.map((v) => Math.round(v * 10) / 10), Math.round(c.others * 10) / 10]),
    ["State Total", Math.round(grand * 10) / 10, ...totalsRow.map((v) => Math.round(v * 10) / 10), Math.round(othersTotal * 10) / 10]
  ]);

  // Bottom: stacked bars by the three busiest states.
  const top3 = stateTotals.slice(0, 3);
  const stackColors = ["#1d4ed8", "#a855f7", "#facc15", "#cbd5e1"];
  const barRows = [...model.productRows].map((r) => {
    const parts = barMode === "rate" ? [] : [...top3.map((s) => valueOfFig(cellFig(r.product.id, [s]), barMode)), valueOfFig(figuresFor(model.orders.filter((o) => o.productId === r.product.id && !top3.includes(o.state)), model.costs), barMode)];
    return { r, total: valueOfFig(r.now, barMode), parts: parts.map((v) => Math.max(0, v)) };
  }).sort((a, b) => b.total - a.total).slice(0, 6);
  const barMax = Math.max(1, ...barRows.map((b) => (barMode === "rate" ? 100 : b.total)));

  // Top states for one product.
  const focus = focusProduct || model.productRows[0]?.product.id || "";
  const focusOrders = model.orders.filter((o) => o.productId === focus);
  const focusDelivered = focusOrders.filter(isDelivered);
  const focusStates = useMemo(() => {
    const counts = new Map<string, number>();
    for (const o of focusDelivered) if (o.state) counts.set(o.state, (counts.get(o.state) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [focusDelivered]);
  const focusTop = focusStates.slice(0, 9);
  const focusOthers = focusDelivered.length - focusTop.reduce((s, [, n]) => s + n, 0);
  const focusMax = Math.max(1, ...focusTop.map(([, n]) => n), focusOthers);

  // Product vs state comparison.
  const chosenStates = (compareStates ?? stateTotals.slice(0, 3)).slice(0, 5);
  const compareData = [...model.productRows].sort((a, b) => b.now.orders - a.now.orders).slice(0, 6).map((r) => {
    const row: Record<string, string | number> = { name: r.product.name };
    for (const s of chosenStates) row[s] = valueOfFig(cellFig(r.product.id, [s]), compareMetric);
    return row;
  });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[0.8fr_1.6fr]">
        <Panel title="Nigeria Product Demand Heatmap" info="Pick a product and a measure; hover a state for its figures.">
          <div className="mb-3 grid grid-cols-2 gap-3">
            <label className="text-[12px] text-gray-600">Select Product<SelectBox label="Product" className="mt-1" value={mapProduct} onChange={setMapProduct} options={[{ value: ALL, label: "All Products" }, ...model.productRows.map((r) => ({ value: r.product.id, label: r.product.name }))]} /></label>
            <label className="text-[12px] text-gray-600">View Metric<SelectBox label="Metric" className="mt-1" value={metric} onChange={setMetric} options={[{ value: "delivered", label: "Delivered Orders" }, { value: "orders", label: "Total Orders" }, { value: "rate", label: "Delivery Rate" }, ...(canSeeProfit ? [{ value: "net" as HeatMetric, label: "Net Profit" }] : [])]} /></label>
          </div>
          <NigeriaMap data={mapData} zoomable legend={{ title: metricLabel(metric), bins: legend }} formatValue={(v) => fmt(v, metric)} />
        </Panel>

        <section className="min-w-0 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-slate-800">
          <div className="mb-3 flex flex-col gap-2 2xl:flex-row 2xl:items-center 2xl:justify-between">
            <h3 className="m-0 text-[14px] font-bold text-gray-900 dark:text-slate-100">Product × State Performance ({metricLabel(metric)}) <span title="Darker green = higher, pink = lower, across the whole table. Click a square for the full picture." className="cursor-help text-[11px] font-normal text-gray-400">ⓘ</span></h3>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex h-9 w-44 items-center gap-2 rounded-lg border border-gray-200 px-3 dark:border-slate-700"><Search className="h-4 w-4 text-gray-400" /><span className="sr-only">Search products</span>
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search products..." className="!min-h-0 w-full bg-transparent text-[12.5px] outline-none" /></label>
              <SelectBox label="State" className="w-36" value={onlyState} onChange={setOnlyState} options={[{ value: ALL, label: "All States" }, ...stateTotals.map((s) => ({ value: s, label: stateLabel(s) }))]} />
              <button type="button" onClick={() => ctx.exportRef.current()} className="!min-h-0 inline-flex h-9 items-center gap-1.5 rounded-lg border border-gray-200 px-3 text-[12.5px] font-semibold text-gray-700 dark:border-slate-700"><Download className="h-4 w-4" /> Export</button>
            </div>
          </div>
          <div className="overflow-auto">
            <table className="w-full !min-w-0 border-separate border-spacing-[3px]">
              <thead><tr>
                <th className="!border-0 !p-1 text-left !text-[11px] !font-semibold !text-gray-500" colSpan={2}>Product</th>
                <th className="!border-0 !p-1 text-right !text-[11px] !font-semibold !text-gray-500">Total</th>
                {columns.map((s) => <th key={s} className="!border-0 !p-1 text-center !text-[11px] !font-semibold !text-gray-600"><span className="block max-w-[70px] truncate">{stateLabel(s)}</span></th>)}
                {onlyState === ALL && <th className="!border-0 !p-1 text-center !text-[11px] !font-semibold !text-gray-600">Others</th>}
              </tr></thead>
              <tbody>
                {cells.length === 0 && <tr><td colSpan={columns.length + 4} className="!border-0 py-10 text-center text-[12.5px] text-gray-500">No orders in this period.</td></tr>}
                {cells.map(({ row, values, others }) => (
                  <tr key={row.product.id} className="[&>td]:[color:inherit]">
                    <td className="!border-0 !p-1 w-9"><ProductThumb src={ctx.imageOf(row.product.id)} name={row.product.name} size={30} /></td>
                    <td className="!border-0 !p-1 text-[12px] font-semibold"><span className="block max-w-[150px] truncate" title={row.product.name}>{row.product.name}</span></td>
                    <td className="!border-0 !p-1 text-right text-[12.5px] font-bold">{fmt(valueOfFig(row.now, metric), metric)}</td>
                    {[...values, ...(onlyState === ALL ? [others] : [])].map((v, i) => {
                      const color = heatColor(metric === "rate" ? v / 100 : v / cellMax);
                      const state = i < columns.length ? columns[i] : null;
                      return (
                        <td key={i} className="!border-0 !p-0">
                          <button type="button" disabled={!state} onClick={() => state && setOpen({ productId: row.product.id, state })}
                            className="!min-h-0 h-9 w-full min-w-[46px] rounded-md text-[11.5px] font-semibold disabled:cursor-default" style={{ background: color.bg, color: color.fg }}>{fmt(v, metric)}</button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
                {cells.length > 0 && (
                  <tr className="[&>td]:[color:inherit]">
                    <td className="!border-0 !p-1 !pt-3 text-[12.5px] font-bold" colSpan={2}>State Total</td>
                    <td className="!border-0 !p-1 !pt-3 text-right text-[12.5px] font-bold">{fmt(grand, metric)}</td>
                    {totalsRow.map((v, i) => <td key={i} className="!border-0 !p-1 !pt-3 text-center text-[12.5px] font-bold">{fmt(v, metric)}</td>)}
                    {onlyState === ALL && <td className="!border-0 !p-1 !pt-3 text-center text-[12.5px] font-bold">{fmt(othersTotal, metric)}</td>}
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.15fr_0.95fr_1.1fr]">
        <Panel title="Top Products by Delivered Orders (Heatmap View)" info="Each bar split by the three busiest states.">
          <Segmented small fill value={barMode} onChange={setBarMode} options={[{ value: "delivered", label: "Delivered Orders" }, { value: "rate", label: "Delivery Rate" }, ...(canSeeProfit ? [{ value: "net" as const, label: "Net Profit" }] : [])]} />
          <table className="mt-2 w-full !min-w-0 border-separate border-spacing-0">
            <thead><tr><th className={th}>#</th><th className={th}>Product</th><th className={th}>Total</th><th className={th} /></tr></thead>
            <tbody>
              {barRows.map((b, i) => (
                <tr key={b.r.product.id} className="[&>td]:[color:inherit]">
                  <td className={`${td} !border-0`}>{i + 1}</td>
                  <td className={`${td} !border-0`}><span className="flex items-center gap-2"><ProductThumb src={ctx.imageOf(b.r.product.id)} name={b.r.product.name} size={28} /><span className="max-w-[140px] truncate">{b.r.product.name}</span></span></td>
                  <td className={`${td} !border-0 font-bold`}>{barMode === "rate" ? pct1(b.total) : barMode === "net" ? money(b.total) : nf(b.total)}</td>
                  <td className={`${td} !border-0 w-[42%]`}>
                    <span className="flex h-2.5 overflow-hidden rounded-full bg-gray-100">
                      {barMode === "rate"
                        ? <span className="h-full bg-emerald-600" style={{ width: `${b.total}%` }} />
                        : b.parts.map((v, k) => <span key={k} className="h-full" style={{ width: `${(v / barMax) * 100}%`, background: stackColors[k] }} />)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {barMode !== "rate" && (
            <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-gray-600">
              {[...top3.map(stateLabel), "Others"].map((label, i) => <span key={label} className="flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: stackColors[i] }} />{label}</span>)}
            </div>
          )}
        </Panel>

        <Panel title="Top States for Each Product">
          <label className="text-[12px] text-gray-600">Select Product<SelectBox label="Product" className="mt-1" value={focus} onChange={setFocusProduct} options={model.productRows.map((r) => ({ value: r.product.id, label: r.product.name }))} /></label>
          <table className="mt-2 w-full !min-w-0 border-separate border-spacing-0">
            <thead><tr><th className={th}>#</th><th className={th}>State</th><th className={th}>Delivered Orders</th><th className={`${th} !text-right`}>% of Product</th></tr></thead>
            <tbody>
              {focusTop.map(([state, n], i) => (
                <tr key={state} className="[&>td]:[color:inherit]">
                  <td className={`${td} !border-0 !py-1.5 font-bold text-amber-600`}>{i + 1}</td>
                  <td className={`${td} !border-0 !py-1.5`}>{stateLabel(state)}</td>
                  <td className={`${td} !border-0 !py-1.5`}><span className="flex items-center gap-2"><span className="block h-2.5 rounded-sm" style={{ width: `${(n / focusMax) * 90}px`, background: SERIES_COLORS[i % 5] }} /><span className="text-[11px] text-gray-500">{nf(n)}</span></span></td>
                  <td className={`${td} !border-0 !py-1.5 text-right`}>{pct1((n / Math.max(1, focusDelivered.length)) * 100)}</td>
                </tr>
              ))}
              {focusOthers > 0 && (
                <tr className="[&>td]:[color:inherit]"><td className={`${td} !border-0 !py-1.5 text-gray-400`}>{focusTop.length + 1}</td><td className={`${td} !border-0 !py-1.5 text-gray-500`}>Others</td>
                  <td className={`${td} !border-0 !py-1.5`}><span className="flex items-center gap-2"><span className="block h-2.5 rounded-sm bg-gray-400" style={{ width: `${(focusOthers / focusMax) * 90}px` }} /><span className="text-[11px] text-gray-500">{nf(focusOthers)}</span></span></td>
                  <td className={`${td} !border-0 !py-1.5 text-right`}>{pct1((focusOthers / Math.max(1, focusDelivered.length)) * 100)}</td></tr>
              )}
              {focusTop.length === 0 && <tr><td colSpan={4} className={`${td} !border-0 py-6 text-center text-gray-400`}>No deliveries for this product yet.</td></tr>}
            </tbody>
          </table>
        </Panel>

        <Panel title="Product vs State Comparison">
          <div className="mb-2 grid grid-cols-[1fr_auto] gap-2">
            <div>
              <div className="mb-1 text-[12px] text-gray-600">Select States (Max 5)</div>
              <div className="flex min-h-9 flex-wrap items-center gap-1 rounded-lg border border-gray-200 px-1.5 py-1 dark:border-slate-700">
                {chosenStates.map((s) => (
                  <span key={s} className="inline-flex items-center gap-1 rounded-md bg-gray-100 px-2 py-0.5 text-[11.5px] font-semibold dark:bg-slate-800">{stateLabel(s)}
                    <button type="button" aria-label={`Remove ${stateLabel(s)}`} onClick={() => setCompareStates(chosenStates.filter((x) => x !== s))} className="!min-h-0 text-gray-500">×</button></span>
                ))}
                {chosenStates.length < 5 && (
                  <select aria-label="Add a state" value="" onChange={(e) => e.target.value && setCompareStates([...chosenStates, e.target.value])} className="!min-h-0 h-6 min-w-0 flex-1 bg-transparent text-[11.5px] text-gray-500 outline-none">
                    <option value="">+ Add</option>
                    {stateTotals.filter((s) => !chosenStates.includes(s)).map((s) => <option key={s} value={s}>{stateLabel(s)}</option>)}
                  </select>
                )}
              </div>
            </div>
            <label className="text-[12px] text-gray-600">Metric<SelectBox label="Metric" className="mt-1 w-36" value={compareMetric} onChange={setCompareMetric} options={[{ value: "delivered", label: "Delivered Orders" }, { value: "orders", label: "Total Orders" }, { value: "rate", label: "Delivery Rate" }]} /></label>
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={compareData} margin={{ top: 6, right: 4, left: -18, bottom: 0 }} barGap={2}>
                <CartesianGrid stroke="#e5e7eb" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" interval={0} tick={{ fontSize: 10, fill: "#4b5563" }} tickFormatter={(name: string) => (name.length > 12 ? `${name.slice(0, 11)}…` : name)} height={36} />
                <YAxis tick={{ fontSize: 10, fill: "#6b7280" }} allowDecimals={false} tickFormatter={(v: number) => compareMetric === "rate" ? `${v}%` : String(v)} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} formatter={(v: any, name: any) => [compareMetric === "rate" ? `${Number(v).toFixed(1)}%` : nf(Number(v)), stateLabel(String(name))]} />
                <Legend formatter={(s: any) => <span className="text-[11px] text-gray-700">{stateLabel(String(s))}</span>} iconType="circle" iconSize={8} />
                {chosenStates.map((s, i) => <Bar key={s} dataKey={s} fill={SERIES_COLORS[i]} radius={[3, 3, 0, 0]} maxBarSize={14} isAnimationActive={false} />)}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>

      {open && (
        <ProductStatePanel productId={open.productId} state={open.state} orders={model.orders} costs={model.costs} products={products} hubs={ctx.hubs} agents={ctx.agents}
          canSeeProfit={canSeeProfit} money={money} days={days} onClose={() => setOpen(null)} />
      )}
    </div>
  );
}

