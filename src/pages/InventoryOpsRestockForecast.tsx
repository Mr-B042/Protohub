// Restock Forecast - what runs out, when, and how much to send.
//
// Priority is driven by the SHORTEST STATE, not by network cover. A product can
// look comfortable nationally while one state is already empty, and that state
// is the one that loses the order - which is exactly what happened to 5-in-1
// Corner Racks in FCT Abuja while the network still showed stock.
//
// "Est. units needed (14 days)" is demand for the next fortnight minus what is
// available now, so it is the gap to close, not the total to hold.
import { useMemo, useState } from "react";
import { AlertTriangle, ArrowDownWideNarrow, Boxes, CalendarDays, CheckCircle2, Download, MapPin, Package, Search } from "lucide-react";
import type { OpsOrder, OpsProduct, OpsStateHub, OpsWaybill } from "./InventoryLogisticsOperationsPage";
import { buildProductRows, buildStateRows, coverText, downloadCsv, num, runRateText, statusText } from "./inventory-ops-model";

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

type Priority = "Critical" | "High" | "Medium" | "Healthy" | "No Data";

export default function InventoryOpsRestockForecast({
  products, stateHubs, orders, waybills, lookbackDays, criticalDays, watchDays, onOpenTransfers
}: Props) {
  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [atRiskOnly, setAtRiskOnly] = useState(false);
  const [windowDays, setWindowDays] = useState(lookbackDays);

  const stateRows = useMemo(
    () => buildStateRows(stateHubs, orders, waybills, windowDays, criticalDays, watchDays),
    [stateHubs, orders, waybills, windowDays, criticalDays, watchDays]
  );
  const rows = useMemo(
    () => buildProductRows(products, stateRows, orders, windowDays, criticalDays, watchDays, waybills),
    [products, stateRows, orders, windowDays, criticalDays, watchDays, waybills]
  );

  // Urgency reads off whichever runs out first - the state, or the network.
  const priorityOf = (row: typeof rows[number]): Priority => {
    const shortest = row.shortestState?.coverDays ?? row.coverDays;
    const days = Math.min(shortest, row.coverDays);
    if (row.dailySales <= 0) return "No Data";
    if (days <= criticalDays) return "Critical";
    if (days <= watchDays) return "High";
    if (days <= watchDays * 2) return "Medium";
    return "Healthy";
  };
  const priorityTone = (priority: Priority) =>
    priority === "Critical" ? "bg-rose-50 text-rose-700"
      : priority === "High" ? "bg-orange-50 text-orange-700"
        : priority === "Medium" ? "bg-amber-50 text-amber-700"
          : priority === "No Data" ? "bg-gray-100 text-gray-600"
            : "bg-emerald-50 text-emerald-700";

  const enriched = rows.map((row) => ({ ...row, priority: priorityOf(row) }));
  const scoped = enriched.filter((row) => {
    if (stateFilter !== "all" && row.shortestState?.state !== stateFilter) return false;
    if (categoryFilter !== "all" && row.category !== categoryFilter) return false;
    return true;
  });
  const visible = scoped.filter((row) => {
    if (search && !row.name.toLowerCase().includes(search.trim().toLowerCase())) return false;
    if (atRiskOnly && row.priority !== "Critical" && row.priority !== "High") return false;
    return true;
  });

  const atRisk = scoped.filter((row) => row.priority === "Critical").length;
  const low = scoped.filter((row) => row.priority === "High").length;
  const medium = scoped.filter((row) => row.priority === "Medium").length;
  const healthy = scoped.filter((row) => row.priority === "Healthy").length;
  const noData = scoped.filter((row) => row.priority === "No Data").length;
  const unitsNeeded = scoped.reduce((sum, row) => sum + row.unitsNeeded14d, 0);

  // Which states need the most, summed across every product short there.
  const statesNeeding = useMemo(() => {
    const need = new Map<string, { products: number; units: number }>();
    for (const row of scoped) {
      for (const shortage of row.stateNeeds14d) {
        const bucket = need.get(shortage.state) ?? { products: 0, units: 0 };
        bucket.products += 1;
        bucket.units += shortage.units;
        need.set(shortage.state, bucket);
      }
    }
    return Array.from(need.entries())
      .map(([state, value]) => ({ state, ...value }))
      .sort((a, b) => b.units - a.units)
      .slice(0, 5);
  }, [scoped]);

  const states = Array.from(new Set(enriched.map((row) => row.shortestState?.state).filter(Boolean) as string[])).sort();
  const categories = Array.from(new Set(enriched.map((row) => row.category))).sort();
  const donut = [
    { label: `Critical (≤ ${criticalDays} days)`, value: atRisk, tone: "bg-rose-500" },
    { label: `High (${criticalDays}-${watchDays} days)`, value: low, tone: "bg-orange-500" },
    { label: `Medium (${watchDays}-${watchDays * 2} days)`, value: medium, tone: "bg-amber-400" },
    { label: "Healthy", value: healthy, tone: "bg-emerald-500" },
    { label: "No demand data", value: noData, tone: "bg-gray-300" }
  ];
  const donutTotal = donut.reduce((sum, band) => sum + band.value, 0) || 1;

  const card = (label: string, value: string, foot: string, Icon: typeof Boxes, tint: string) => (
    <article className="rounded-xl border border-gray-200 bg-white px-4 py-4">
      <span className={`flex h-9 w-9 items-center justify-center rounded-lg ${tint}`}><Icon className="h-4 w-4" /></span>
      <span className="mt-2 block text-[11px] text-gray-400">{label}</span>
      <strong className="block text-2xl font-black leading-tight text-gray-900">{value}</strong>
      <span className="block text-[11px] text-gray-400">{foot}</span>
    </article>
  );

  // A flat sparkline for a product that has never sold would imply a trend
  // where there is none, so those render as a dash instead.
  const sparkline = (series: number[]) => {
    const max = Math.max(...series, 1);
    if (series.every((value) => value === 0)) return <span className="text-xs text-gray-300">No sales</span>;
    return (
      <span className="flex h-5 items-end gap-0.5">
        {series.map((value, index) => (
          <span key={index} className="w-1 rounded-sm bg-[#1F8FE0]/70" style={{ height: `${Math.max(8, (value / max) * 100)}%` }} />
        ))}
      </span>
    );
  };

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div><h1 className="m-0 text-2xl font-bold text-gray-950">Restock Forecast</h1>
        <p className="m-0 mt-0.5 text-sm text-gray-500">Forecast from {windowDays}-day delivered demand, reserved stock and incoming shipments.</p></div>
        <div className="flex flex-wrap items-center gap-2">
        <label className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-bold text-gray-700">
          <CalendarDays className="h-4 w-4 text-blue-600" />
          <select className="!min-h-0 border-0 bg-transparent p-0 outline-none" value={windowDays} onChange={(event) => setWindowDays(Number(event.target.value))}>
            <option value={7}>Last 7 days</option><option value={14}>Last 14 days</option><option value={30}>Last 30 days</option>
          </select>
        </label>
        <button className="!min-h-0 inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-bold text-gray-700"
          onClick={() => downloadCsv("restock-forecast.csv", visible.map((row) => ({ Product: row.name, Category: row.category, Stock: row.totalStock, Reserved: row.reserved, Available: row.available, "Daily sales": runRateText(row.dailySales), "Overall cover": coverText(row.coverDays), "Shortest state": row.shortestState?.state ?? "-", "Shortest cover": row.shortestState ? coverText(row.shortestState.coverDays) : "-", "Units needed 14d": row.unitsNeeded14d, Priority: row.priority })))}>
          <Download className="h-4 w-4" /> Export
        </button>
        </div>
      </header>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {card("Total Products", num(scoped.length), categoryFilter === "all" ? "Across network" : "In selected category", Package, "bg-indigo-50 text-indigo-600")}
        {card(`At Risk (≤ ${criticalDays} days)`, num(atRisk), "Products", AlertTriangle, "bg-rose-50 text-rose-600")}
        {card(`Low (${criticalDays}-${watchDays} days)`, num(low), "Products", ArrowDownWideNarrow, "bg-orange-50 text-orange-600")}
        {card("Healthy", num(healthy), noData > 0 ? `${noData} without demand data` : "Products", CheckCircle2, "bg-emerald-50 text-emerald-600")}
        {card("States With Forecast", num(states.length), "With a shortest state", MapPin, "bg-sky-50 text-sky-600")}
        {card("Est. Units Needed", num(unitsNeeded), "Next 14 days", Boxes, "bg-violet-50 text-violet-600")}
      </section>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <div className="flex flex-wrap items-center gap-3 border-b border-gray-100 px-4 py-3">
            <label className="flex min-w-[200px] flex-1 items-center gap-2 rounded-lg border border-gray-200 px-3 py-2">
              <Search className="h-4 w-4 shrink-0 text-gray-400" />
              <input className="!min-h-0 w-full border-0 p-0 text-sm outline-none" placeholder="Search product..."
                value={search} onChange={(event) => setSearch(event.target.value)} />
            </label>
            <select className="!min-h-0 rounded-lg border border-gray-200 px-3 py-2 text-sm" value={stateFilter} onChange={(event) => setStateFilter(event.target.value)}>
              <option value="all">All States</option>
              {states.map((state) => <option key={state} value={state}>{state}</option>)}
            </select>
            <select className="!min-h-0 rounded-lg border border-gray-200 px-3 py-2 text-sm" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
              <option value="all">All Categories</option>{categories.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
            <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-gray-600">
              <input type="checkbox" className="!min-h-0 h-4 w-4 accent-[#1F8FE0]" checked={atRiskOnly} onChange={(event) => setAtRiskOnly(event.target.checked)} />
              Show only at risk
            </label>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/70 text-[10px] uppercase tracking-wider text-gray-500">
                  <th className="px-4 py-3">Product</th>
                  <th className="px-3 py-3">Category</th>
                  <th className="px-3 py-3 text-right">Total stock</th>
                  <th className="px-3 py-3 text-right">Avg. daily sales</th>
                  <th className="px-3 py-3 text-right">Cover overall</th>
                  <th className="px-3 py-3">Shortest state</th>
                  <th className="px-3 py-3">Trend</th>
                  <th className="px-3 py-3 text-right">Est. units<span className="block normal-case text-gray-400">(14 days)</span></th>
                  <th className="px-3 py-3">Priority</th>
                  <th className="px-3 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {visible.length === 0 ? (
                  <tr><td colSpan={10} className="px-4 py-10 text-center text-sm italic text-gray-400">No product matches those filters.</td></tr>
                ) : visible.map((row) => (
                  <tr key={row.id} className="border-b border-gray-50">
                    <td className="px-4 py-3 font-bold text-gray-900">{row.name}</td>
                    <td className="px-3 py-3 text-gray-500">{row.category}</td>
                    <td className="px-3 py-3 text-right font-bold text-gray-900">{num(row.totalStock)}</td>
                    <td className="px-3 py-3 text-right text-gray-700">{runRateText(row.dailySales)}</td>
                    <td className={`px-3 py-3 text-right font-bold ${statusText(row.status)}`}>{coverText(row.coverDays)}</td>
                    <td className="px-3 py-3">
                      {row.shortestState ? (
                        <span className="text-[12px]">
                          <strong className="text-orange-600">{coverText(row.shortestState.coverDays)}</strong>
                          <span className="text-gray-400"> ({row.shortestState.state})</span>
                        </span>
                      ) : <span className="text-xs text-gray-300">-</span>}
                    </td>
                    <td className="px-3 py-3">{sparkline(row.trend)}</td>
                    <td className="px-3 py-3 text-right font-bold text-gray-900">{num(row.unitsNeeded14d)}</td>
                    <td className="px-3 py-3"><span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-bold ${priorityTone(row.priority)}`}>{row.priority}</span></td>
                    <td className="px-3 py-3 text-right">
                      {onOpenTransfers && row.unitsNeeded14d > 0 ? (
                        <button type="button" className="!min-h-0 rounded-lg border border-blue-200 px-2.5 py-1.5 text-xs font-bold text-blue-700 hover:bg-blue-50" onClick={onOpenTransfers}>View plan</button>
                      ) : <span className="text-xs text-gray-300">-</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="m-0 border-t border-gray-100 px-4 py-3 text-xs text-gray-400">
            Showing {visible.length} of {enriched.length} products · Priority follows the state that runs out first. Purchase need subtracts units already in transit to prevent duplicate replenishment.
          </p>
        </section>

        <aside className="space-y-4">
          <section className="rounded-xl border border-gray-200 bg-white p-4">
            <h2 className="m-0 text-sm font-bold text-gray-900">Forecast Summary <span className="font-normal text-gray-400">(next 14 days)</span></h2>
            <ul className="m-0 mt-3 list-none space-y-2 p-0">
              {donut.map((band) => (
                <li key={band.label} className="flex items-center gap-2 text-[12px]">
                  <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${band.tone}`} />
                  <span className="min-w-0 flex-1 truncate text-gray-600">{band.label}</span>
                  <span className="shrink-0 font-bold text-gray-900">{band.value}</span>
                  <span className="w-9 shrink-0 text-right text-gray-400">{Math.round((band.value / donutTotal) * 100)}%</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-xl border border-gray-200 bg-white p-4">
            <h2 className="m-0 text-sm font-bold text-gray-900">Top States Needing Stock</h2>
            {statesNeeding.length === 0 ? (
              <p className="m-0 mt-2 text-xs italic text-gray-400">Nothing is short in the next 14 days.</p>
            ) : (
              <table className="mt-3 w-full text-left text-[12px]">
                <thead><tr className="text-[10px] uppercase tracking-wider text-gray-400"><th className="pb-1">State</th><th className="pb-1 text-right">At risk</th><th className="pb-1 text-right">Units</th></tr></thead>
                <tbody>
                  {statesNeeding.map((entry) => (
                    <tr key={entry.state} className="border-t border-gray-50">
                      <td className="py-1.5 text-gray-700">{entry.state}</td>
                      <td className="py-1.5 text-right text-gray-600">{entry.products}</td>
                      <td className="py-1.5 text-right font-bold text-gray-900">{num(entry.units)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className="rounded-xl border border-gray-200 bg-white p-4">
            <h2 className="m-0 text-sm font-bold text-gray-900">Insights</h2>
            <ul className="m-0 mt-3 list-none space-y-2 p-0 text-[12px]">
              {enriched.filter((row) => row.priority === "Critical" && row.shortestState).slice(0, 3).map((row) => (
                <li key={row.id} className="flex items-start gap-2 rounded-lg bg-rose-50 px-3 py-2 text-rose-800">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    <strong>{row.name}</strong> in {row.shortestState!.state} runs out in about {coverText(row.shortestState!.coverDays)} days at the current rate.
                  </span>
                </li>
              ))}
              {statesNeeding[0] && (
                <li className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-amber-800">
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{statesNeeding[0].state} needs the most: {num(statesNeeding[0].units)} units across {statesNeeding[0].products} product{statesNeeding[0].products === 1 ? "" : "s"}. One shipment clears the biggest share.</span>
                </li>
              )}
              {atRisk === 0 && low === 0 && (
                <li className="rounded-lg bg-emerald-50 px-3 py-2 text-emerald-800">Nothing is forecast to run out in the next {watchDays} days.</li>
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
