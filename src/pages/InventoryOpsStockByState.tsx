// Stock by State - total stock and coverage per state.
//
// Uses the shared model so this page, Stock by Product and Restock Forecast
// cannot disagree about what "cover" means.
import { useMemo, useState } from "react";
import { AlertTriangle, Boxes, ClipboardList, MapPin, Search, Truck } from "lucide-react";
import type { OpsOrder, OpsProduct, OpsStateHub, OpsWaybill } from "./InventoryLogisticsOperationsPage";
import { buildStateRows, coverText, num, statusText, statusTone } from "./inventory-ops-model";

type Props = {
  products: OpsProduct[];
  stateHubs: OpsStateHub[];
  orders: OpsOrder[];
  waybills: OpsWaybill[];
  lookbackDays: number;
  criticalDays: number;
  watchDays: number;
  onOpenForecast?: () => void;
};

export default function InventoryOpsStockByState({
  products, stateHubs, orders, waybills, lookbackDays, criticalDays, watchDays, onOpenForecast
}: Props) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [lowOnly, setLowOnly] = useState(false);

  const rows = useMemo(
    () => buildStateRows(stateHubs, orders, waybills, lookbackDays, criticalDays, watchDays),
    [stateHubs, orders, waybills, lookbackDays, criticalDays, watchDays]
  );
  const nameById = useMemo(() => new Map(products.map((product) => [product.id, product.name])), [products]);

  const visible = rows.filter((row) => {
    if (search && !row.state.toLowerCase().includes(search.trim().toLowerCase())) return false;
    if (status !== "all" && row.status !== status) return false;
    if (lowOnly && (row.status === "Healthy" || row.status === "Watch")) return false;
    return true;
  });

  const totals = rows.reduce((acc, row) => ({
    stock: acc.stock + row.totalUnits,
    transit: acc.transit + row.inTransit,
    open: acc.open + row.openOrders,
    agents: acc.agents + row.agents,
    critical: acc.critical + (row.status === "Critical" ? 1 : 0),
    coverSum: acc.coverSum + (Number.isFinite(row.coverDays) ? row.coverDays : 0),
    coverCount: acc.coverCount + (Number.isFinite(row.coverDays) ? 1 : 0)
  }), { stock: 0, transit: 0, open: 0, agents: 0, critical: 0, coverSum: 0, coverCount: 0 });
  const avgCover = totals.coverCount > 0 ? Math.round((totals.coverSum / totals.coverCount) * 10) / 10 : 0;

  // Which products are held in the most states - the ones with real coverage.
  const productSpread = useMemo(() => {
    const spread = new Map<string, number>();
    for (const row of rows) {
      for (const [productId, units] of row.unitsByProductId) {
        if (units > 0) spread.set(productId, (spread.get(productId) ?? 0) + 1);
      }
    }
    return Array.from(spread).map(([productId, states]) => ({ name: nameById.get(productId) ?? productId, states }))
      .sort((a, b) => b.states - a.states).slice(0, 5);
  }, [rows, nameById]);

  const criticalStates = rows.filter((row) => row.status === "Critical").map((row) => row.state);
  const restockStates = rows.filter((row) => row.status === "Restock Soon").map((row) => row.state);

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
        <h1 className="m-0 text-2xl font-bold text-gray-950">Stock by State</h1>
        <p className="m-0 mt-0.5 text-sm text-gray-500">View total stock and coverage by state.</p>
      </header>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {card("Total States", num(rows.length), "Active states", MapPin, "bg-indigo-50 text-indigo-600")}
        {card("Total Stock (Units)", num(totals.stock), "Across all states", Boxes, "bg-emerald-50 text-emerald-600")}
        {card("In Transit", num(totals.transit), "Units on the way", Truck, "bg-violet-50 text-violet-600")}
        {card("Open Orders", num(totals.open), "Needing fulfillment", ClipboardList, "bg-amber-50 text-amber-600")}
        {card("Critical States", num(totals.critical), "Low stock alert", AlertTriangle, "bg-rose-50 text-rose-600")}
      </section>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <div className="flex flex-wrap items-center gap-3 border-b border-gray-100 px-4 py-3">
            <label className="flex min-w-[200px] flex-1 items-center gap-2 rounded-lg border border-gray-200 px-3 py-2">
              <Search className="h-4 w-4 shrink-0 text-gray-400" />
              <input className="!min-h-0 w-full border-0 p-0 text-sm outline-none" placeholder="Search state..."
                value={search} onChange={(event) => setSearch(event.target.value)} />
            </label>
            <select className="!min-h-0 rounded-lg border border-gray-200 px-3 py-2 text-sm" value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="all">All Status</option>
              <option value="Healthy">Healthy</option>
              <option value="Watch">Watch</option>
              <option value="Restock Soon">Restock Soon</option>
              <option value="Critical">Critical</option>
            </select>
            <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-gray-600">
              <input type="checkbox" className="!min-h-0 h-4 w-4 accent-[#1F8FE0]" checked={lowOnly} onChange={(event) => setLowOnly(event.target.checked)} />
              Low stock only
            </label>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-left text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/70 text-[10px] uppercase tracking-wider text-gray-500">
                  <th className="px-4 py-3">State</th>
                  <th className="px-3 py-3 text-right">Agents</th>
                  <th className="px-3 py-3 text-right">Total stock<span className="block normal-case text-gray-400">(units)</span></th>
                  <th className="px-3 py-3 text-right">Avg. daily sales</th>
                  <th className="px-3 py-3 text-right">Days cover</th>
                  <th className="px-3 py-3 text-right">In transit</th>
                  <th className="px-3 py-3 text-right">Open orders</th>
                  <th className="px-3 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {visible.length === 0 ? (
                  <tr><td colSpan={8} className="px-4 py-10 text-center text-sm italic text-gray-400">No state matches those filters.</td></tr>
                ) : visible.map((row) => (
                  <tr key={row.state} className="border-b border-gray-50">
                    <td className="px-4 py-3">
                      <span className="flex items-center gap-1.5 font-bold text-gray-900">
                        <MapPin className="h-3.5 w-3.5 shrink-0 text-gray-400" />{row.state}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-right text-gray-700">{row.agents}</td>
                    <td className="px-3 py-3 text-right font-bold text-gray-900">{num(row.totalUnits)}</td>
                    <td className="px-3 py-3 text-right text-gray-700">{row.dailySales}</td>
                    <td className={`px-3 py-3 text-right font-bold ${statusText(row.status)}`}>{coverText(row.coverDays)}</td>
                    <td className="px-3 py-3 text-right text-violet-700">{num(row.inTransit)}</td>
                    <td className="px-3 py-3 text-right text-orange-600">{num(row.openOrders)}</td>
                    <td className="px-3 py-3"><span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-bold ${statusTone(row.status)}`}>{row.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="m-0 border-t border-gray-100 px-4 py-3 text-xs text-gray-400">
            Showing {visible.length} of {rows.length} states · Days cover uses stock left after open orders are set aside.
          </p>
        </section>

        <aside className="space-y-4">
          <section className="rounded-xl border border-gray-200 bg-white p-4">
            <h2 className="m-0 text-sm font-bold text-gray-900">State Summary</h2>
            <dl className="mt-3 space-y-2 text-sm">
              {([
                ["Total Stock", num(totals.stock)],
                ["In Transit", num(totals.transit)],
                ["Agents", num(totals.agents)],
                ["Open Orders", num(totals.open)],
                ["States", num(rows.length)],
                ["Average Days Cover", `${avgCover} Days`]
              ] as Array<[string, string]>).map(([label, value]) => (
                <div key={label} className="flex items-center justify-between border-b border-gray-50 pb-1.5">
                  <dt className="text-gray-500">{label}</dt>
                  <dd className="m-0 font-bold text-gray-900">{value}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="rounded-xl border border-gray-200 bg-white p-4">
            <h2 className="m-0 text-sm font-bold text-gray-900">Top Products by State Availability</h2>
            {productSpread.length === 0 ? (
              <p className="m-0 mt-2 text-xs italic text-gray-400">No product is held in any state yet.</p>
            ) : (
              <ul className="m-0 mt-3 list-none space-y-2 p-0">
                {productSpread.map((entry) => (
                  <li key={entry.name} className="flex items-center justify-between text-sm">
                    <span className="min-w-0 truncate text-gray-700">{entry.name}</span>
                    <span className="shrink-0 font-bold text-gray-900">{entry.states} state{entry.states === 1 ? "" : "s"}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-xl border border-gray-200 bg-white p-4">
            <h2 className="m-0 text-sm font-bold text-gray-900">Alerts</h2>
            <ul className="m-0 mt-3 list-none space-y-2 p-0 text-sm">
              {criticalStates.length > 0 && (
                <li className="flex items-start gap-2 rounded-lg bg-rose-50 px-3 py-2 text-rose-800">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span><strong>{criticalStates.length} state{criticalStates.length === 1 ? "" : "s"} critically low</strong><br />{criticalStates.slice(0, 4).join(", ")}</span>
                </li>
              )}
              {restockStates.length > 0 && (
                <li className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-amber-800">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span><strong>{restockStates.length} state{restockStates.length === 1 ? "" : "s"} need restock soon</strong><br />{restockStates.slice(0, 4).join(", ")}</span>
                </li>
              )}
              {totals.transit > 0 && (
                <li className="flex items-start gap-2 rounded-lg bg-violet-50 px-3 py-2 text-violet-800">
                  <Truck className="mt-0.5 h-4 w-4 shrink-0" />
                  <span><strong>{num(totals.transit)} units in transit</strong><br />Already counted as incoming, not as available.</span>
                </li>
              )}
              {criticalStates.length === 0 && restockStates.length === 0 && totals.transit === 0 && (
                <li className="rounded-lg bg-emerald-50 px-3 py-2 text-emerald-800">Nothing needs attention right now.</li>
              )}
            </ul>
            {onOpenForecast && (
              <button className="!min-h-0 mt-3 w-full rounded-lg border border-[#1F8FE0] px-3 py-2 text-sm font-bold text-[#1F8FE0] hover:bg-blue-50" onClick={onOpenForecast}>
                View Restock Forecast →
              </button>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
