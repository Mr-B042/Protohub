import { useMemo, useState, type ReactNode } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  MIN_RATE_SAMPLE, buildAgentRows, buildStateRows, figuresFor, growthPct, isDelivered, seriesOver, stateLabel,
  type CostBook, type Figures, type TrendAgent, type TrendHub, type TrendOrder, type TrendProduct
} from "./product-trend-model";
import { Delta, ProductThumb, SERIES_COLORS, Segmented, SidePanel, nf, pct1 } from "./parts";

// Detail side panels: a product (the View button) and a product in one state.

type Money = (value: number) => string;
export const th = "sticky top-0 z-10 !border-b !border-gray-200 bg-gray-50 !px-2.5 !py-2.5 text-left !text-[11px] !font-semibold !text-gray-600 dark:!border-slate-800 dark:bg-slate-900 dark:!text-slate-300";
export const td = "!border-b !border-gray-100 !px-2.5 !py-2 align-middle text-[12px] dark:!border-slate-800";
export const NET_NOTE = "States and agents have no costs of their own (ads are not tracked by state), so each delivered order carries its product's running costs in proportion to its sales.";
export const daysCover = (stock: number, unitsDelivered: number, days: number) => (unitsDelivered > 0 ? stock / (unitsDelivered / days) : null);

export function ProductStatePanel({ productId, state, orders, costs, products, hubs, agents, canSeeProfit, money, days, onClose }: {
  productId: string; state: string; orders: TrendOrder[]; costs: CostBook; products: TrendProduct[]; hubs: TrendHub[]; agents: TrendAgent[];
  canSeeProfit: boolean; money: Money; days: number; onClose: () => void;
}) {
  const product = products.find((p) => p.id === productId);
  const mine = orders.filter((o) => o.productId === productId && o.state === state);
  const productAll = orders.filter((o) => o.productId === productId);
  const f = figuresFor(mine, costs);
  const productF = figuresFor(productAll, costs);
  const stateHubs = hubs.filter((hub) => hub.state === state);
  const stock = stateHubs.reduce((sum, hub) => sum + hub.stocks.filter((s) => s.productId === productId).reduce((t, s) => t + Math.max(0, s.quantity), 0), 0);
  const cover = daysCover(stock, f.unitsDelivered, days);
  const agentRows = buildAgentRows({ orders: mine, previousOrders: [], costs, previousCosts: costs, hubs: stateHubs, agents, productId });
  const holders = stateHubs.filter((hub) => hub.stocks.some((s) => s.productId === productId && s.quantity > 0) && !agentRows.some((row) => row.agentId === hub.agentId));

  // Plain advice, each with the figures behind it.
  const advice: string[] = [];
  if (f.orders === 0) advice.push("No orders for this product here in the period.");
  else {
    if (cover !== null && cover < 7) advice.push(`Increase stock: ${nf(stock)} units with agents covers about ${cover.toFixed(1)} days at the period's pace (${(f.unitsDelivered / days).toFixed(1)} units delivered a day).`);
    else if (cover !== null && cover > 45) advice.push(`Stock looks high: ${nf(stock)} units covers about ${Math.round(cover)} days. Consider moving some to a busier state.`);
    else if (cover !== null) advice.push(`Keep stock as it is: ${nf(stock)} units covers about ${Math.round(cover)} days.`);
    else if (stock === 0) advice.push("Nothing delivered yet and no stock with agents here: send stock only if orders keep coming.");
    if (f.orders >= MIN_RATE_SAMPLE && productF.orders >= MIN_RATE_SAMPLE && f.rate < productF.rate - 10)
      advice.push(`Check deliveries: ${pct1(f.rate)} delivered here against ${pct1(productF.rate)} for this product everywhere. Look at the agents below and why orders failed.`);
    if (f.orders >= MIN_RATE_SAMPLE && f.rate > productF.rate + 10) advice.push(`Strong state: ${pct1(f.rate)} delivered against ${pct1(productF.rate)} overall.`);
    if (canSeeProfit && f.delivered > 0 && f.net < 0) advice.push(`Losing money here: net ${money(f.net)} after costs. Review ads and delivery fees.`);
  }

  const stat = (label: string, value: ReactNode) => <div className="rounded-xl bg-gray-50 p-3 dark:bg-slate-900"><div className="text-[11px] text-gray-500">{label}</div><div className="mt-0.5 text-[15px] font-bold">{value}</div></div>;
  return (
    <SidePanel title={`${product?.name ?? "Product"} · ${stateLabel(state)}`} subtitle={`${days} day${days === 1 ? "" : "s"} · orders placed in the period`} onClose={onClose}>
      <h3 className="m-0 mb-2 text-[13px] font-bold text-gray-700 dark:text-slate-200">Demand</h3>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {stat("Orders", nf(f.orders))}{stat("A day", (f.orders / days).toFixed(1))}{stat("A week", ((f.orders / days) * 7).toFixed(1))}{stat("Units ordered", nf(f.units))}
      </div>
      <h3 className="m-0 mb-2 mt-4 text-[13px] font-bold text-gray-700 dark:text-slate-200">Delivery</h3>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {stat("Delivered", nf(f.delivered))}{stat("Delivery rate", pct1(f.rate))}{stat("Failed", nf(f.failed))}{stat("Cancelled", nf(f.cancelled))}
      </div>
      {canSeeProfit && (
        <>
          <h3 className="m-0 mb-2 mt-4 text-[13px] font-bold text-gray-700 dark:text-slate-200">Money (delivered orders)</h3>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {stat("Revenue", money(f.revenue))}{stat("Product cost", money(f.cogs))}{stat("Delivery fees", money(f.logistics))}
            {stat("Running costs (share)", money(f.runningCosts))}{stat("Net profit", <span className={f.net < 0 ? "text-rose-600" : ""}>{money(f.net)}</span>)}{stat("Per delivered order", f.delivered > 0 ? money(f.net / f.delivered) : "—")}
          </div>
          <p className="m-0 mt-1 text-[11px] text-gray-400">{NET_NOTE}</p>
        </>
      )}
      <h3 className="m-0 mb-2 mt-4 text-[13px] font-bold text-gray-700 dark:text-slate-200">Stock</h3>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {stat("With agents here", nf(stock))}{stat("Units delivered", nf(f.unitsDelivered))}{stat("Days it covers", cover === null ? "—" : cover > 365 ? "365+" : cover.toFixed(1))}
      </div>
      <h3 className="m-0 mb-2 mt-4 text-[13px] font-bold text-gray-700 dark:text-slate-200">Agents</h3>
      <div className="overflow-auto rounded-xl border border-gray-200 dark:border-slate-800">
        <table className="w-full !min-w-0 border-separate border-spacing-0">
          <thead><tr>{["Agent", "Orders", "Delivered", "Rate", "Still open", "Stock held"].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
          <tbody>
            {agentRows.length === 0 && holders.length === 0 && <tr><td colSpan={6} className={`${td} py-6 text-center text-gray-500`}>No agent handled this product here.</td></tr>}
            {agentRows.map((row) => (
              <tr key={row.agentId} className="[&>td]:[color:inherit]">
                <td className={`${td} font-semibold`}>{row.name}</td><td className={td}>{nf(row.now.orders)}</td><td className={td}>{nf(row.now.delivered)}</td>
                <td className={td}>{pct1(row.now.rate)}</td><td className={td}>{nf(row.now.open)}</td><td className={td}>{nf(row.stockHeld)}</td>
              </tr>
            ))}
            {holders.map((hub) => (
              <tr key={`h-${hub.agentId}`} className="[&>td]:[color:inherit]">
                <td className={`${td} font-semibold`}>{hub.agentName}</td><td className={td} colSpan={4}><span className="text-gray-500">No orders here in the period</span></td>
                <td className={td}>{nf(hub.stocks.filter((s) => s.productId === productId).reduce((t, s) => t + s.quantity, 0))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h3 className="m-0 mb-2 mt-4 text-[13px] font-bold text-gray-700 dark:text-slate-200">What the figures say</h3>
      <ul className="m-0 list-disc space-y-1 pl-5 text-[13px] text-gray-700 dark:text-slate-200">{advice.map((line) => <li key={line}>{line}</li>)}</ul>
    </SidePanel>
  );
}


// ── Product details (the View button) ──────────────────────────────────────

export function ProductDetailPanel({ productId, products, orders, previous, costs, previousCosts, hubs, agents, canSeeProfit, canSeeMoney = true, money, imageOf, from, to, onClose }: {
  productId: string; products: TrendProduct[]; orders: TrendOrder[]; previous: TrendOrder[]; costs: CostBook; previousCosts: CostBook; hubs: TrendHub[]; agents: TrendAgent[];
  canSeeProfit: boolean; canSeeMoney?: boolean; money: Money; imageOf: (productId: string) => string | null; from: string; to: string; onClose: () => void;
}) {
  const [view, setView] = useState<"states" | "agents" | "trend">("states");
  const product = products.find((p) => p.id === productId);
  const mine = orders.filter((o) => o.productId === productId);
  const before = previous.filter((o) => o.productId === productId);
  const now: Figures = figuresFor(mine, costs);
  const was: Figures = figuresFor(before, previousCosts);
  const days = Math.round((new Date(`${to}T12:00:00Z`).getTime() - new Date(`${from}T12:00:00Z`).getTime()) / 86_400_000) + 1;
  const stateRows = buildStateRows({ orders: mine, previousOrders: before, costs, previousCosts, hubs, productId });
  const agentRows = buildAgentRows({ orders: mine, previousOrders: before, costs, previousCosts, hubs, agents, productId });
  const stockTotal = hubs.reduce((sum, hub) => sum + hub.stocks.filter((s) => s.productId === productId).reduce((t, s) => t + Math.max(0, s.quantity), 0), 0);
  const trend = useMemo(() => seriesOver({ orders: mine, delivered: mine.filter(isDelivered) }, from, to, days > 62 ? "weekly" : "daily", "orders"), [mine, from, to, days]);
  const kpi = (label: string, value: ReactNode, delta?: ReactNode) => (
    <div className="rounded-xl border border-gray-200 p-3 dark:border-slate-800"><div className="text-[11px] text-gray-500">{label}</div><div className="mt-0.5 text-[16px] font-black">{value}</div>{delta}</div>
  );
  return (
    <SidePanel title={<span className="flex items-center gap-3"><ProductThumb src={imageOf(productId)} name={product?.name ?? "?"} size={36} />{product?.name ?? "Product"}</span>}
      subtitle={`${product?.sku ? `SKU ${product.sku} · ` : ""}${product?.active ? "Active" : "Inactive"}`} onClose={onClose}>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {kpi("Orders", nf(now.orders), <Delta value={growthPct(now.orders, was.orders)} />)}
        {kpi("Delivered", nf(now.delivered), <Delta value={growthPct(now.delivered, was.delivered)} />)}
        {kpi("Delivery rate", pct1(now.rate), <Delta value={was.orders > 0 ? now.rate - was.rate : null} points />)}
        {kpi("Units delivered", nf(now.unitsDelivered))}
        {canSeeMoney && kpi("Delivered AOV", now.delivered > 0 ? money(now.aov) : "—")}
        {canSeeProfit && kpi("Net profit", <span className={now.net < 0 ? "text-rose-600" : ""}>{money(now.net)}</span>, <Delta value={was.net > 0 ? growthPct(now.net, was.net) : null} />)}
        {canSeeProfit && kpi("Per delivered order", now.delivered > 0 ? money(now.net / now.delivered) : "—")}
        {kpi("Stock with agents", nf(stockTotal), <span className="text-[11px] text-gray-500">{now.unitsDelivered > 0 ? `≈ ${Math.round(stockTotal / (now.unitsDelivered / days))} days` : "no deliveries yet"}</span>)}
      </div>
      <div className="mt-4"><Segmented value={view} onChange={setView} options={[{ value: "states", label: "States" }, { value: "agents", label: "Agents" }, { value: "trend", label: "Trend" }]} /></div>
      {view === "states" && (
        <div className="mt-3 overflow-auto rounded-xl border border-gray-200 dark:border-slate-800">
          <table className="w-full !min-w-0 border-separate border-spacing-0">
            <thead><tr>{["State", "Orders", "Delivered", "Rate", ...(canSeeProfit ? ["Net profit"] : []), "Stock with agents", "Days it covers"].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
            <tbody>
              {stateRows.length === 0 && <tr><td colSpan={7} className={`${td} py-6 text-center text-gray-500`}>No orders in this period.</td></tr>}
              {stateRows.map((row) => {
                const cover = daysCover(row.stockWithAgents, row.now.unitsDelivered, days);
                return (
                  <tr key={row.state} className="[&>td]:[color:inherit]">
                    <td className={`${td} font-semibold`}>{stateLabel(row.state)}</td><td className={td}>{nf(row.now.orders)}</td><td className={td}>{nf(row.now.delivered)}</td>
                    <td className={td}><span className={row.now.orders < MIN_RATE_SAMPLE ? "text-gray-400" : ""}>{pct1(row.now.rate)}</span></td>
                    {canSeeProfit && <td className={`${td} ${row.now.net < 0 ? "text-rose-600" : ""}`}>{money(row.now.net)}</td>}
                    <td className={td}>{nf(row.stockWithAgents)}</td>
                    <td className={td}><span className={cover !== null && cover < 7 ? "font-semibold text-rose-600" : ""}>{cover === null ? "—" : cover > 365 ? "365+" : cover.toFixed(1)}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {view === "agents" && (
        <div className="mt-3 overflow-auto rounded-xl border border-gray-200 dark:border-slate-800">
          <table className="w-full !min-w-0 border-separate border-spacing-0">
            <thead><tr>{["Agent", "State(s)", "Orders", "Delivered", "Rate", "Still open", "Stock held"].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
            <tbody>
              {agentRows.length === 0 && <tr><td colSpan={7} className={`${td} py-6 text-center text-gray-500`}>No orders with an agent in this period.</td></tr>}
              {agentRows.map((row) => (
                <tr key={row.agentId} className="[&>td]:[color:inherit]">
                  <td className={`${td} font-semibold`}>{row.name}</td><td className={`${td} text-gray-600`}>{row.states.map(stateLabel).join(", ")}</td>
                  <td className={td}>{nf(row.now.orders)}</td><td className={td}>{nf(row.now.delivered)}</td>
                  <td className={td}><span className={row.now.orders < MIN_RATE_SAMPLE ? "text-gray-400" : ""}>{pct1(row.now.rate)}</span></td>
                  <td className={td}>{nf(row.now.open)}</td><td className={td}>{nf(row.stockHeld)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {view === "trend" && (
        <div className="mt-3 h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={trend} margin={{ top: 6, right: 8, left: -10, bottom: 0 }}>
              <CartesianGrid stroke="#e5e7eb" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="key" tick={{ fontSize: 10, fill: "#6b7280" }} tickFormatter={(key: string) => new Date(`${key}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short" })} minTickGap={18} />
              <YAxis tick={{ fontSize: 10, fill: "#6b7280" }} width={32} allowDecimals={false} />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} formatter={(value: any, name: any) => [value, name === "orders" ? "Orders" : "Delivered"]} />
              <Legend formatter={(id: any) => <span className="text-[12px] text-gray-700 dark:text-slate-300">{id === "orders" ? "Orders placed" : "Of those, delivered"}</span>} iconType="circle" iconSize={8} />
              <Line dataKey="orders" type="monotone" stroke={SERIES_COLORS[0]} strokeWidth={2} dot={false} isAnimationActive={false} />
              <Line dataKey="delivered" type="monotone" stroke={SERIES_COLORS[3]} strokeWidth={2} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </SidePanel>
  );
}
