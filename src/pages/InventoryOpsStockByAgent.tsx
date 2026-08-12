// Stock by Agent - what each agent hub is holding, and what it is worth.
//
// Stock value is quantity x the product's SELLING price, matching the design's
// "At selling price". That is exposure, not cost - it is what the company would
// lose if a hub's stock walked, which is the number worth watching on a page
// about who is holding what.
import { useMemo, useState } from "react";
import { AlertTriangle, Boxes, Search, Truck, UserRound, Wallet } from "lucide-react";
import type { OpsDiscrepancy, OpsOrder, OpsProduct, OpsStateHub, OpsWaybill } from "./InventoryLogisticsOperationsPage";
import { CLOSED_ORDER_STATES, money, norm, num, statusTone, type StockStatus } from "./inventory-ops-model";

type Props = {
  products: OpsProduct[];
  stateHubs: OpsStateHub[];
  orders: OpsOrder[];
  waybills: OpsWaybill[];
  discrepancies: OpsDiscrepancy[];
  criticalDays: number;
  watchDays: number;
};

type AgentRow = {
  key: string;
  name: string;
  phone: string;
  state: string;
  city: string;
  productCount: number;
  total: number;
  reserved: number;
  available: number;
  inTransit: number;
  value: number;
  status: StockStatus;
  lines: Array<{ name: string; units: number }>;
};

export default function InventoryOpsStockByAgent({
  products, stateHubs, orders, waybills, discrepancies, criticalDays, watchDays
}: Props) {
  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState("all");
  const [lowOnly, setLowOnly] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const rows = useMemo<AgentRow[]>(() => {
    const priceById = new Map(products.map((product) => [product.id, Math.max(0, product.sellingPrice ?? 0)]));
    const nameById = new Map(products.map((product) => [product.id, product.name]));

    // Open order units in that agent's state, apportioned by the hub's share of
    // the state's stock. Orders carry a state, not an agent, until dispatch.
    const stateStock = new Map<string, number>();
    for (const hub of stateHubs) {
      const units = hub.stocks.reduce((sum, stock) => sum + Math.max(0, stock.quantity), 0);
      stateStock.set(hub.state, (stateStock.get(hub.state) ?? 0) + units);
    }
    const openByState = new Map<string, number>();
    for (const order of orders) {
      const state = String(order.state ?? "").trim();
      if (!state || CLOSED_ORDER_STATES.has(norm(order.status))) continue;
      openByState.set(state, (openByState.get(state) ?? 0) + Math.max(0, order.quantity));
    }
    const transitByAgent = new Map<string, number>();
    for (const waybill of waybills) {
      if (norm(waybill.status) !== "in transit") continue;
      const to = String(waybill.to ?? "").trim();
      if (!to) continue;
      const units = waybill.items?.length
        ? waybill.items.reduce((sum, item) => sum + Math.max(0, item.quantity), 0)
        : Math.max(0, waybill.quantity);
      transitByAgent.set(to, (transitByAgent.get(to) ?? 0) + units);
    }

    return stateHubs.map((hub) => {
      const total = hub.stocks.reduce((sum, stock) => sum + Math.max(0, stock.quantity), 0);
      const share = (stateStock.get(hub.state) ?? 0) > 0 ? total / (stateStock.get(hub.state) ?? 1) : 0;
      const reserved = Math.round((openByState.get(hub.state) ?? 0) * share);
      const available = Math.max(0, total - reserved);
      const value = hub.stocks.reduce((sum, stock) =>
        sum + Math.max(0, stock.quantity) * (priceById.get(stock.productId) ?? 0), 0);
      const lines = hub.stocks
        .filter((stock) => stock.quantity > 0)
        .map((stock) => ({ name: nameById.get(stock.productId) ?? stock.productId, units: Math.max(0, stock.quantity) }))
        .sort((a, b) => b.units - a.units);
      // No sales history per hub, so status reads off cover of committed work
      // rather than a run rate: can this hub serve what its state already owes?
      const status: StockStatus = total === 0 ? "Critical"
        : available <= 0 ? "Critical"
          : available < reserved ? "Restock Soon"
            : available < reserved * 2 ? "Watch" : "Healthy";
      return {
        key: `${hub.agentId ?? hub.agentName}::${hub.state}`,
        name: hub.agentName,
        phone: hub.agentPhone ?? "",
        state: hub.state,
        city: hub.city ?? "",
        productCount: lines.length,
        total, reserved, available,
        inTransit: transitByAgent.get(hub.state) ?? 0,
        value, status, lines
      };
    }).sort((a, b) => b.total - a.total);
  }, [products, stateHubs, orders, waybills, criticalDays, watchDays]);

  const states = Array.from(new Set(rows.map((row) => row.state))).sort();
  const visible = rows.filter((row) => {
    const needle = search.trim().toLowerCase();
    if (needle && !`${row.name} ${row.state} ${row.city}`.toLowerCase().includes(needle)) return false;
    if (stateFilter !== "all" && row.state !== stateFilter) return false;
    if (lowOnly && (row.status === "Healthy" || row.status === "Watch")) return false;
    return true;
  });
  const selected = rows.find((row) => row.key === selectedKey) ?? null;

  const totals = rows.reduce((acc, row) => ({
    agents: acc.agents + 1,
    units: acc.units + row.total,
    value: acc.value + row.value,
    transit: acc.transit + row.inTransit
  }), { agents: 0, units: 0, value: 0, transit: 0 });
  const openDiscrepancies = discrepancies.filter((row) => norm(row.status) !== "resolved").length;

  const card = (label: string, value: string, foot: string, Icon: typeof Boxes, tint: string) => (
    <article className="rounded-xl border border-gray-200 bg-white px-4 py-4">
      <span className={`flex h-9 w-9 items-center justify-center rounded-lg ${tint}`}><Icon className="h-4 w-4" /></span>
      <span className="mt-2 block text-[11px] text-gray-400">{label}</span>
      <strong className="block text-2xl font-black leading-tight text-gray-900">{value}</strong>
      <span className="block text-[11px] text-gray-400">{foot}</span>
    </article>
  );

  return (
    <div className="space-y-5">
      <header>
        <h1 className="m-0 text-2xl font-bold text-gray-950">Stock by Agent</h1>
        <p className="m-0 mt-0.5 text-sm text-gray-500">View and manage stock held by all agents across the network.</p>
      </header>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {card("Total Agent Hubs", num(totals.agents), "Holding stock", UserRound, "bg-indigo-50 text-indigo-600")}
        {card("Total Stock (Units)", num(totals.units), "With all agents", Boxes, "bg-emerald-50 text-emerald-600")}
        {card("Total Stock Value", money(totals.value), "At selling price", Wallet, "bg-violet-50 text-violet-600")}
        {card("Incoming to Agents", num(totals.transit), "Units in transit", Truck, "bg-amber-50 text-amber-600")}
        {card("Discrepancies", num(openDiscrepancies), "Agents with issues", AlertTriangle, "bg-rose-50 text-rose-600")}
      </section>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <div className="flex flex-wrap items-center gap-3 border-b border-gray-100 px-4 py-3">
            <label className="flex min-w-[200px] flex-1 items-center gap-2 rounded-lg border border-gray-200 px-3 py-2">
              <Search className="h-4 w-4 shrink-0 text-gray-400" />
              <input className="!min-h-0 w-full border-0 p-0 text-sm outline-none" placeholder="Search agent name, state..."
                value={search} onChange={(event) => setSearch(event.target.value)} />
            </label>
            <select className="!min-h-0 rounded-lg border border-gray-200 px-3 py-2 text-sm" value={stateFilter} onChange={(event) => setStateFilter(event.target.value)}>
              <option value="all">All States</option>
              {states.map((state) => <option key={state} value={state}>{state}</option>)}
            </select>
            <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-gray-600">
              <input type="checkbox" className="!min-h-0 h-4 w-4 accent-[#1F8FE0]" checked={lowOnly} onChange={(event) => setLowOnly(event.target.checked)} />
              Low stock only
            </label>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/70 text-[10px] uppercase tracking-wider text-gray-500">
                  <th className="px-4 py-3">Agent / Contact</th>
                  <th className="px-3 py-3">State / Area</th>
                  <th className="px-3 py-3 text-right">Products</th>
                  <th className="px-3 py-3 text-right">Total stock</th>
                  <th className="px-3 py-3 text-right">Available</th>
                  <th className="px-3 py-3 text-right">Reserved</th>
                  <th className="px-3 py-3 text-right">In transit</th>
                  <th className="px-3 py-3 text-right">Stock value</th>
                  <th className="px-3 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {visible.length === 0 ? (
                  <tr><td colSpan={9} className="px-4 py-10 text-center text-sm italic text-gray-400">No agent matches those filters.</td></tr>
                ) : visible.map((row) => (
                  <tr key={row.key} className={`cursor-pointer border-b border-gray-50 ${selectedKey === row.key ? "bg-blue-50/40" : ""}`}
                    onClick={() => setSelectedKey(selectedKey === row.key ? null : row.key)}>
                    <td className="px-4 py-3">
                      <span className="block font-bold text-gray-900">{row.name}</span>
                      <span className="block text-[11px] text-gray-400">{row.phone || "No phone on file"}</span>
                    </td>
                    <td className="px-3 py-3">
                      <span className="block text-gray-700">{row.state}</span>
                      <span className="block text-[11px] text-gray-400">{row.city || "-"}</span>
                    </td>
                    <td className="px-3 py-3 text-right text-gray-700">{row.productCount}</td>
                    <td className="px-3 py-3 text-right font-bold text-gray-900">{num(row.total)}</td>
                    <td className="px-3 py-3 text-right font-semibold text-emerald-700">{num(row.available)}</td>
                    <td className="px-3 py-3 text-right text-orange-600">{num(row.reserved)}</td>
                    <td className="px-3 py-3 text-right text-violet-700">{num(row.inTransit)}</td>
                    <td className="px-3 py-3 text-right font-semibold text-gray-900">{money(row.value)}</td>
                    <td className="px-3 py-3"><span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-bold ${statusTone(row.status)}`}>{row.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="m-0 border-t border-gray-100 px-4 py-3 text-xs text-gray-400">
            Showing {visible.length} of {rows.length} agent hubs · Reserved is the hub&apos;s share of its state&apos;s open orders, since an order names a state, not an agent, until dispatch.
          </p>
        </section>

        <aside className="h-fit space-y-4">
          {selected ? (
            <>
              <section className="rounded-xl border border-gray-200 bg-white p-4">
                <h2 className="m-0 text-sm font-bold text-gray-900">Agent Summary</h2>
                <dl className="mt-3 space-y-2 text-sm">
                  {([
                    ["Agent Name", selected.name],
                    ["State / Area", `${selected.state}${selected.city ? ` · ${selected.city}` : ""}`],
                    ["Phone", selected.phone || "Not on file"],
                    ["Products held", String(selected.productCount)],
                    ["Total stock", num(selected.total)],
                    ["Available", num(selected.available)],
                    ["Stock value", money(selected.value)]
                  ] as Array<[string, string]>).map(([label, value]) => (
                    <div key={label} className="flex items-center justify-between gap-3 border-b border-gray-50 pb-1.5">
                      <dt className="shrink-0 text-gray-500">{label}</dt>
                      <dd className="m-0 min-w-0 truncate text-right font-bold text-gray-900">{value}</dd>
                    </div>
                  ))}
                </dl>
              </section>
              <section className="rounded-xl border border-gray-200 bg-white p-4">
                <h2 className="m-0 text-sm font-bold text-gray-900">Stock by Product</h2>
                {selected.lines.length === 0 ? (
                  <p className="m-0 mt-2 text-xs italic text-gray-400">This hub is holding nothing.</p>
                ) : (
                  <ul className="m-0 mt-3 list-none space-y-2 p-0">
                    {selected.lines.slice(0, 8).map((line) => (
                      <li key={line.name} className="flex items-center justify-between gap-3 text-sm">
                        <span className="min-w-0 truncate text-gray-700">{line.name}</span>
                        <span className="shrink-0 font-bold text-gray-900">{num(line.units)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          ) : (
            <section className="rounded-xl border border-dashed border-gray-200 bg-white p-6 text-center">
              <p className="m-0 text-sm text-gray-400">Pick an agent to see what they are holding.</p>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
