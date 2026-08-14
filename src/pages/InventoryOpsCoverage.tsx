// State / Order Coverage - order demand against stock cover, per state.
//
// The design puts a Nigeria choropleth in the right column. Rendering a real
// map needs a mapping library and boundary data, which is a dependency
// decision rather than a layout one - so that slot carries the same legend and
// the state counts behind it. Every band is clickable, which the map was not.
import { useMemo, useState } from "react";
import { AlertTriangle, Boxes, Calendar, CalendarDays, Download, Eye, MapPin, Rocket, Search, TrendingUp } from "lucide-react";
import type { OpsOrder, OpsProduct, OpsStateHub, OpsWaybill } from "./InventoryLogisticsOperationsPage";
import { buildStateRows, coverText, downloadCsv, num, runRateText, statusText, statusTone, type StockStatus } from "./inventory-ops-model";

type Props = {
  products: OpsProduct[];
  stateHubs: OpsStateHub[];
  orders: OpsOrder[];
  waybills: OpsWaybill[];
  lookbackDays: number;
  criticalDays: number;
  watchDays: number;
  onOpenTransfers?: () => void;
};

export default function InventoryOpsCoverage({
  products, stateHubs, orders, waybills, lookbackDays, criticalDays, watchDays, onOpenTransfers
}: Props) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"all" | StockStatus>("all");
  const [category, setCategory] = useState("all");
  const [lowOnly, setLowOnly] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [windowDays, setWindowDays] = useState(lookbackDays);

  const categories = useMemo(() => Array.from(new Set(products.map((product) => product.category ?? "Uncategorised"))).sort(), [products]);
  const includedProductIds = useMemo(() => category === "all"
    ? undefined
    : new Set(products.filter((product) => (product.category ?? "Uncategorised") === category).map((product) => product.id)), [products, category]);

  const rows = useMemo(
    () => buildStateRows(stateHubs, orders, waybills, windowDays, criticalDays, watchDays, includedProductIds),
    [stateHubs, orders, waybills, windowDays, criticalDays, watchDays, includedProductIds]
  );
  const nameById = useMemo(() => new Map(products.map((product) => [product.id, product.name])), [products]);

  // The products each state is thinnest on - what a restock should carry.
  const lowProductsFor = (row: typeof rows[number]) =>
    Array.from(new Set([...row.unitsByProductId.keys(), ...row.dailySalesByProductId.keys()]))
      .map((productId) => {
        const units = Math.max(0, (row.unitsByProductId.get(productId) ?? 0) - (row.openUnitsByProductId.get(productId) ?? 0));
        const daily = row.dailySalesByProductId.get(productId) ?? 0;
        return { name: nameById.get(productId) ?? productId, units, cover: daily > 0 ? units / daily : Number.POSITIVE_INFINITY };
      })
      .filter((entry) => Number.isFinite(entry.cover) && entry.cover <= watchDays * 1.5)
      .sort((a, b) => a.cover - b.cover)
      .slice(0, 2);

  const visible = rows.filter((row) => {
    if (search && !row.state.toLowerCase().includes(search.trim().toLowerCase())) return false;
    if (status !== "all" && row.status !== status) return false;
    if (lowOnly && row.status !== "Critical" && row.status !== "Restock Soon") return false;
    return true;
  }).sort((a, b) => b.openOrders - a.openOrders);
  const selected = rows.find((row) => row.key === selectedKey) ?? null;

  const withStock = rows.filter((row) => row.totalUnits > 0).length;
  const needRestock = rows.filter((row) => row.status === "Critical" || row.status === "Restock Soon").length;
  const totalOrders = rows.reduce((sum, row) => sum + row.openOrders, 0);
  const coverRows = rows.filter((row) => Number.isFinite(row.coverDays));
  const avgCover = coverRows.length > 0
    ? Math.round((coverRows.reduce((sum, row) => sum + row.coverDays, 0) / coverRows.length) * 10) / 10
    : 0;
  const avgOrders = rows.length > 0 ? totalOrders / rows.length : 0;
  const highDemand = rows.filter((row) => row.openOrders > avgOrders && row.openOrders > 0).length;

  const bands: Array<{ label: string; test: (row: typeof rows[number]) => boolean; dot: string; status?: StockStatus }> = [
    { label: `Healthy (${watchDays * 1.5}+ days)`, test: (row) => row.status === "Healthy", dot: "bg-emerald-500", status: "Healthy" },
    { label: `Watch (${watchDays}-${watchDays * 1.5} days)`, test: (row) => row.status === "Watch", dot: "bg-amber-400", status: "Watch" },
    { label: `Restock soon (${criticalDays}-${watchDays} days)`, test: (row) => row.status === "Restock Soon", dot: "bg-orange-500", status: "Restock Soon" },
    { label: `Critical (under ${criticalDays} days)`, test: (row) => row.status === "Critical", dot: "bg-rose-500", status: "Critical" },
    { label: "No sales recorded", test: (row) => row.status === "No Data", dot: "bg-gray-300", status: "No Data" }
  ];

  const topByOrders = [...rows].sort((a, b) => b.openOrders - a.openOrders).slice(0, 5);
  const maxOrders = topByOrders[0]?.openOrders ?? 0;
  const topShare = totalOrders > 0
    ? Math.round((topByOrders.slice(0, 2).reduce((sum, row) => sum + row.openOrders, 0) / totalOrders) * 100)
    : 0;
  const criticalNames = rows.filter((row) => row.status === "Critical").map((row) => row.state);

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
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div><h1 className="m-0 text-2xl font-bold text-gray-950">State / Order Coverage</h1>
        <p className="m-0 mt-0.5 text-sm text-gray-500">Track committed order demand against sellable stock and {windowDays}-day delivered demand.</p></div>
        <div className="flex flex-wrap items-center gap-2">
        <label className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-bold text-gray-700">
          <CalendarDays className="h-4 w-4 text-blue-600" />
          <select className="!min-h-0 border-0 bg-transparent p-0 outline-none" value={windowDays} onChange={(event) => setWindowDays(Number(event.target.value))}>
            <option value={7}>Last 7 days</option><option value={14}>Last 14 days</option><option value={30}>Last 30 days</option>
          </select>
        </label>
        <button className="!min-h-0 inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-bold text-gray-700"
          onClick={() => downloadCsv("state-order-coverage.csv", visible.map((row) => ({ State: row.state, "Open orders": row.openOrders, "Open units": row.openUnits, Stock: row.totalUnits, Available: row.available, "Daily sales": runRateText(row.dailySales), "Days cover": coverText(row.coverDays), "In transit": row.inTransit, Status: row.status })))}>
          <Download className="h-4 w-4" /> Export
        </button>
        </div>
      </header>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {card("Total States", num(rows.length), "Covered states", MapPin, "bg-indigo-50 text-indigo-600")}
        {card("States with Stock", num(withStock), rows.length > 0 ? `${Math.round((withStock / rows.length) * 1000) / 10}% of states` : "-", Boxes, "bg-emerald-50 text-emerald-600")}
        {card("States Needing Restock", num(needRestock), "Low or out of stock", AlertTriangle, "bg-rose-50 text-rose-600")}
        {card("Avg. Days of Cover", `${avgCover} Days`, "Network average", Calendar, "bg-amber-50 text-amber-600")}
        {card("Open Orders", num(totalOrders), "Across all states", TrendingUp, "bg-sky-50 text-sky-600")}
        {card("High Demand States", num(highDemand), "Above average orders", Rocket, "bg-violet-50 text-violet-600")}
      </section>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <div className="flex flex-wrap items-center gap-3 border-b border-gray-100 px-4 py-3">
            <label className="flex min-w-[200px] flex-1 items-center gap-2 rounded-lg border border-gray-200 px-3 py-2">
              <Search className="h-4 w-4 shrink-0 text-gray-400" />
              <input className="!min-h-0 w-full border-0 p-0 text-sm outline-none" placeholder="Search state..."
                value={search} onChange={(event) => setSearch(event.target.value)} />
            </label>
            <select className="!min-h-0 rounded-lg border border-gray-200 px-3 py-2 text-sm" value={category} onChange={(event) => setCategory(event.target.value)}>
              <option value="all">All Categories</option>{categories.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
            <select className="!min-h-0 rounded-lg border border-gray-200 px-3 py-2 text-sm" value={status} onChange={(event) => setStatus(event.target.value as typeof status)}>
              <option value="all">All Status</option>
              <option value="Healthy">Healthy</option>
              <option value="Watch">Watch</option>
              <option value="Restock Soon">Restock Soon</option>
              <option value="Critical">Critical</option>
              <option value="No Data">No Data</option>
            </select>
            <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-gray-600">
              <input type="checkbox" className="!min-h-0 h-4 w-4 accent-[#1F8FE0]" checked={lowOnly} onChange={(event) => setLowOnly(event.target.checked)} />
              Low stock only
            </label>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[850px] text-left text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/70 text-[10px] uppercase tracking-wider text-gray-500">
                  <th className="px-4 py-3">State</th>
                  <th className="px-3 py-3 text-right">Open orders</th>
                  <th className="px-3 py-3 text-right">Stock cover<span className="block normal-case text-gray-400">(days)</span></th>
                  <th className="px-3 py-3">Status</th>
                  <th className="px-3 py-3">Top low stock products</th>
                  <th className="px-3 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {visible.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-10 text-center text-sm italic text-gray-400">No state matches those filters.</td></tr>
                ) : visible.map((row) => {
                  const low = lowProductsFor(row);
                  return (
                    <tr key={row.state} className="border-b border-gray-50">
                      <td className="px-4 py-3">
                        <span className="flex items-center gap-1.5 font-bold text-gray-900">
                          <MapPin className="h-3.5 w-3.5 shrink-0 text-gray-400" />{row.state}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-right font-bold text-gray-900">{num(row.openOrders)}</td>
                      <td className={`px-3 py-3 text-right font-bold ${statusText(row.status)}`}>{coverText(row.coverDays)}</td>
                      <td className="px-3 py-3"><span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-bold ${statusTone(row.status)}`}>{row.status}</span></td>
                      <td className="px-3 py-3">
                        {low.length === 0 ? <span className="text-xs text-gray-300">Nothing thin</span> : (
                          <span className="flex flex-wrap gap-2">
                            {low.map((entry) => (
                              <span key={entry.name} className="rounded bg-gray-50 px-2 py-0.5 text-[11px] text-gray-600">
                                {entry.name} · <strong className={entry.units === 0 ? "text-rose-600" : "text-orange-600"}>{entry.units}</strong>
                              </span>
                            ))}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-right">
                        <button type="button" className="!min-h-0 inline-flex items-center gap-1 rounded-lg border border-blue-200 px-2.5 py-1.5 text-xs font-bold text-blue-700 hover:bg-blue-50"
                          onClick={() => setSelectedKey(selectedKey === row.key ? null : row.key)}>
                          <Eye className="h-3.5 w-3.5" /> Details
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="m-0 border-t border-gray-100 px-4 py-3 text-xs text-gray-400">
            Showing {visible.length} of {rows.length} states · Open orders are placed and not yet delivered, cancelled or failed.
          </p>
        </section>

        <aside className="space-y-4">
          {selected && (
            <section className="rounded-xl border border-blue-200 bg-blue-50/30 p-4">
              <div className="flex items-start justify-between gap-3">
                <div><p className="m-0 text-[10px] font-bold uppercase tracking-wider text-blue-600">Coverage detail</p><h2 className="m-0 mt-1 text-base font-black text-gray-950">{selected.state}</h2></div>
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${statusTone(selected.status)}`}>{selected.status}</span>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
                {([
                  ["Physical stock", num(selected.totalUnits)],
                  ["Open demand", `${num(selected.openOrders)} orders / ${num(selected.openUnits)} units`],
                  ["Sellable now", num(selected.available)],
                  ["Incoming", num(selected.inTransit)],
                  ["Daily run rate", runRateText(selected.dailySales)],
                  ["Days cover", Number.isFinite(selected.coverDays) ? coverText(selected.coverDays) : "No demand data"]
                ] as Array<[string, string]>).map(([label, value]) => (
                  <div key={label} className="rounded-lg border border-white bg-white/80 px-2.5 py-2"><dt className="text-gray-400">{label}</dt><dd className="m-0 mt-0.5 font-bold text-gray-900">{value}</dd></div>
                ))}
              </dl>
              <h3 className="m-0 mt-4 text-xs font-bold uppercase tracking-wider text-gray-500">Most urgent products</h3>
              {lowProductsFor(selected).length === 0 ? <p className="m-0 mt-2 text-xs italic text-gray-400">No product has enough demand history to forecast a shortage.</p> : (
                <ul className="m-0 mt-2 list-none space-y-2 p-0">
                  {lowProductsFor(selected).map((entry) => <li key={entry.name} className="flex items-center justify-between rounded-lg bg-white px-3 py-2 text-xs"><span className="text-gray-700">{entry.name}</span><strong className="text-rose-600">{entry.units} available</strong></li>)}
                </ul>
              )}
            </section>
          )}
          <section className="rounded-xl border border-gray-200 bg-white p-4">
            <h2 className="m-0 text-sm font-bold text-gray-900">Coverage Overview</h2>
            <p className="m-0 mt-0.5 text-[11px] text-gray-400">Click a band to filter the table.</p>
            <ul className="m-0 mt-3 list-none space-y-1.5 p-0">
              {bands.map((band) => {
                const count = rows.filter(band.test).length;
                const share = rows.length > 0 ? Math.round((count / rows.length) * 100) : 0;
                return (
                  <li key={band.label}>
                    <button
                      className={`!min-h-0 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors ${band.status && status === band.status ? "bg-gray-100" : "hover:bg-gray-50"}`}
                      onClick={() => setStatus(band.status && status !== band.status ? band.status : "all")}
                      disabled={!band.status}
                    >
                      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${band.dot}`} />
                      <span className="min-w-0 flex-1 truncate text-[12px] text-gray-600">{band.label}</span>
                      <span className="shrink-0 text-[12px] font-bold text-gray-900">{count}</span>
                      <span className="w-9 shrink-0 text-right text-[11px] text-gray-400">{share}%</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="rounded-xl border border-gray-200 bg-white p-4">
            <h2 className="m-0 text-sm font-bold text-gray-900">Top 5 States by Orders</h2>
            <ul className="m-0 mt-3 list-none space-y-2 p-0">
              {topByOrders.length === 0 ? <li className="text-xs italic text-gray-400">No open orders.</li> : topByOrders.map((row, index) => (
                <li key={row.state} className="flex items-center gap-2 text-sm">
                  <span className="w-4 shrink-0 text-[11px] font-bold text-gray-400">{index + 1}</span>
                  <span className="w-20 shrink-0 truncate text-gray-700">{row.state}</span>
                  <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-gray-100">
                    <span className="block h-full rounded-full bg-[#1F8FE0]" style={{ width: `${maxOrders > 0 ? (row.openOrders / maxOrders) * 100 : 0}%` }} />
                  </span>
                  <span className="w-7 shrink-0 text-right font-bold text-gray-900">{row.openOrders}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-xl border border-gray-200 bg-white p-4">
            <h2 className="m-0 text-sm font-bold text-gray-900">Insights</h2>
            <ul className="m-0 mt-3 list-none space-y-2 p-0 text-[12px]">
              {topByOrders.length >= 2 && (
                <li className="flex items-start gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-emerald-800">
                  <TrendingUp className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{topByOrders[0].state} and {topByOrders[1].state} are driving {topShare}% of open orders.</span>
                </li>
              )}
              {needRestock > 0 && (
                <li className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-amber-800">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{needRestock} state{needRestock === 1 ? "" : "s"} are low on stock and need restocking.</span>
                </li>
              )}
              {criticalNames.length > 0 && (
                <li className="flex items-start gap-2 rounded-lg bg-rose-50 px-3 py-2 text-rose-800">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{criticalNames.slice(0, 4).join(", ")} {criticalNames.length === 1 ? "is" : "are"} critically low.</span>
                </li>
              )}
              {needRestock === 0 && criticalNames.length === 0 && (
                <li className="rounded-lg bg-emerald-50 px-3 py-2 text-emerald-800">Every state can cover its open orders.</li>
              )}
            </ul>
            {onOpenTransfers && (
              <button className="!min-h-0 mt-3 w-full rounded-lg bg-[#1F8FE0] px-3 py-2 text-sm font-bold text-white hover:bg-[#1560a8]" onClick={onOpenTransfers}>
                View Recommended Transfers →
              </button>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
