// Stock by Product - the network position of every product in one table.
//
// Built on the SAME inputs the operations dashboard already receives, so the
// two can never disagree about how much stock exists. Nothing here refetches.
//
// The one number that needed a decision is Available. A unit promised to a
// confirmed-but-undelivered order is held, not available - counting it is how a
// state reads "we have stock" while its orders sit unfulfillable. So:
//
//   Available = Warehouse + Agents - Reserved
//
// with Reserved being open order demand, and In Transit shown alongside rather
// than inside it, because it cannot be sold from today.
import { useMemo, useState } from "react";
import { Box, CalendarDays, ChevronRight, Download, Search, X } from "lucide-react";
import type { OpsOrder, OpsProduct, OpsStateHub, OpsWaybill } from "./InventoryLogisticsOperationsPage";
import { buildProductRows, buildStateRows, coverText, downloadCsv, runRateText, type ProductRow } from "./inventory-ops-model";

type Props = {
  products: OpsProduct[];
  stateHubs: OpsStateHub[];
  orders: OpsOrder[];
  waybills: OpsWaybill[];
  /** Days of sales history behind the daily-sales figure. */
  lookbackDays: number;
  /** Owner's own thresholds, so this page and Smart Stock agree. */
  criticalDays: number;
  watchDays: number;
  onOpenProduct?: (productId: string) => void;
};

const num = (value: number) => Math.max(0, Math.round(value)).toLocaleString("en-NG");
type Row = ProductRow & {
  total: number;
  byState: Array<{ state: string; units: number; available: number; dailySales: number; coverDays: number }>;
  reorderPoint: number;
};

export default function InventoryOpsStockByProduct({
  products, stateHubs, orders, waybills, lookbackDays, criticalDays, watchDays, onOpenProduct
}: Props) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [category, setCategory] = useState("all");
  const [lowOnly, setLowOnly] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [windowDays, setWindowDays] = useState(lookbackDays);

  const rows = useMemo<Row[]>(() => {
    const stateRows = buildStateRows(stateHubs, orders, waybills, windowDays, criticalDays, watchDays);
    const modelRows = buildProductRows(products, stateRows, orders, windowDays, criticalDays, watchDays, waybills);
    const productById = new Map(products.map((product) => [product.id, product]));
    return modelRows.map((row) => ({
      ...row,
      total: row.totalStock,
      reorderPoint: productById.get(row.id)?.reorderPoint ?? 0,
      byState: stateRows.map((state) => {
        const units = state.unitsByProductId.get(row.id) ?? 0;
        const reserved = state.openUnitsByProductId.get(row.id) ?? 0;
        const available = Math.max(0, units - reserved);
        const dailySales = state.dailySalesByProductId.get(row.id) ?? 0;
        return { state: state.state, units, available, dailySales, coverDays: dailySales > 0 ? available / dailySales : Number.POSITIVE_INFINITY };
      }).filter((entry) => entry.units > 0 || entry.dailySales > 0).sort((a, b) => b.units - a.units)
    }));
  }, [products, stateHubs, orders, waybills, windowDays, criticalDays, watchDays]);

  const categories = Array.from(new Set(rows.map((row) => row.category))).sort();

  const visible = rows.filter((row) => {
    if (search && !row.name.toLowerCase().includes(search.trim().toLowerCase())) return false;
    if (category !== "all" && row.category !== category) return false;
    if (status !== "all" && row.status !== status) return false;
    if (lowOnly && row.status !== "Critical" && row.status !== "Restock Soon") return false;
    return true;
  });

  const selected = rows.find((row) => row.id === selectedId) ?? null;
  const totals = rows.reduce((acc, row) => ({
    products: acc.products + 1,
    total: acc.total + row.total,
    warehouse: acc.warehouse + row.warehouse,
    agents: acc.agents + row.agents,
    inTransit: acc.inTransit + row.inTransit,
    coverSum: acc.coverSum + (Number.isFinite(row.coverDays) ? row.coverDays : 0),
    coverCount: acc.coverCount + (Number.isFinite(row.coverDays) ? 1 : 0)
  }), { products: 0, total: 0, warehouse: 0, agents: 0, inTransit: 0, coverSum: 0, coverCount: 0 });
  const avgCover = totals.coverCount > 0 ? Math.round((totals.coverSum / totals.coverCount) * 10) / 10 : 0;
  const pct = (part: number) => (totals.total > 0 ? `${Math.round((part / totals.total) * 1000) / 10}% of total` : "-");
  const cover = coverText;

  const tone = (rowStatus: Row["status"]) =>
    rowStatus === "Critical" ? "bg-rose-50 text-rose-700"
      : rowStatus === "Restock Soon" ? "bg-orange-50 text-orange-700"
        : rowStatus === "Watch" ? "bg-amber-50 text-amber-700"
          : rowStatus === "No Data" ? "bg-gray-100 text-gray-600"
            : "bg-emerald-50 text-emerald-700";
  const coverTone = (rowStatus: Row["status"]) =>
    rowStatus === "Critical" ? "text-rose-600"
      : rowStatus === "Restock Soon" ? "text-orange-600"
        : rowStatus === "Watch" ? "text-amber-600"
          : rowStatus === "No Data" ? "text-gray-500" : "text-emerald-600";

  const card = (label: string, value: string, foot: string, tint: string) => (
    <article className="rounded-xl border border-gray-200 bg-white px-4 py-4">
      <span className={`flex h-9 w-9 items-center justify-center rounded-lg ${tint}`}><Box className="h-4 w-4" /></span>
      <span className="mt-2 block text-[11px] text-gray-400">{label}</span>
      <strong className="block text-2xl font-black leading-tight text-gray-900">{value}</strong>
      <span className="block text-[11px] text-gray-400">{foot}</span>
    </article>
  );

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div><h1 className="m-0 text-2xl font-bold text-gray-950">Stock by Product</h1>
        <p className="m-0 mt-0.5 text-sm text-gray-500">Live physical stock, committed orders and {windowDays}-day delivered demand.</p></div>
        <div className="flex flex-wrap items-center gap-2">
        <label className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-bold text-gray-700">
          <CalendarDays className="h-4 w-4 text-blue-600" />
          <select className="!min-h-0 border-0 bg-transparent p-0 outline-none" value={windowDays} onChange={(event) => setWindowDays(Number(event.target.value))}>
            <option value={7}>Last 7 days</option><option value={14}>Last 14 days</option><option value={30}>Last 30 days</option>
          </select>
        </label>
        <button className="!min-h-0 inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-bold text-gray-700"
          onClick={() => downloadCsv("stock-by-product.csv", visible.map((row) => ({ Product: row.name, Category: row.category, Total: row.total, Warehouse: row.warehouse, Agents: row.agents, "In transit": row.inTransit, Reserved: row.reserved, Available: row.available, "Daily sales": runRateText(row.dailySales), "Days cover": cover(row.coverDays), Status: row.status })))}>
          <Download className="h-4 w-4" /> Export
        </button>
        </div>
      </header>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {card("Total Products", num(totals.products), "Active products", "bg-indigo-50 text-indigo-600")}
        {card("Total Stock (Units)", num(totals.total), "Across network", "bg-emerald-50 text-emerald-600")}
        {card("Warehouse Stock", num(totals.warehouse), pct(totals.warehouse), "bg-sky-50 text-sky-600")}
        {card("Agent-held Stock", num(totals.agents), pct(totals.agents), "bg-amber-50 text-amber-600")}
        {card("In Transit", num(totals.inTransit), pct(totals.inTransit), "bg-violet-50 text-violet-600")}
        {card("Avg. Stock Cover", `${avgCover} Days`, "Network average", "bg-blue-50 text-blue-600")}
      </section>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <div className="flex flex-wrap items-center gap-3 border-b border-gray-100 px-4 py-3">
            <label className="flex min-w-[200px] flex-1 items-center gap-2 rounded-lg border border-gray-200 px-3 py-2">
              <Search className="h-4 w-4 shrink-0 text-gray-400" />
              <input className="!min-h-0 w-full border-0 p-0 text-sm outline-none" placeholder="Search product..."
                value={search} onChange={(event) => setSearch(event.target.value)} />
            </label>
            <select className="!min-h-0 rounded-lg border border-gray-200 px-3 py-2 text-sm" value={category} onChange={(event) => setCategory(event.target.value)}>
              <option value="all">All Categories</option>
              {categories.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
            <select className="!min-h-0 rounded-lg border border-gray-200 px-3 py-2 text-sm" value={status} onChange={(event) => setStatus(event.target.value)}>
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
            <table className="w-full min-w-[880px] text-left text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/70 text-[10px] uppercase tracking-wider text-gray-500">
                  <th className="px-4 py-3">Product</th>
                  <th className="px-3 py-3">Category</th>
                  <th className="px-3 py-3 text-right">Total stock<span className="block normal-case text-gray-400">(units)</span></th>
                  <th className="px-3 py-3 text-right">Warehouse</th>
                  <th className="px-3 py-3 text-right">Agents</th>
                  <th className="px-3 py-3 text-right">In transit</th>
                  <th className="px-3 py-3 text-right">Reserved</th>
                  <th className="px-3 py-3 text-right">Available</th>
                  <th className="px-3 py-3 text-right">Cover<span className="block normal-case text-gray-400">(days)</span></th>
                  <th className="px-3 py-3">Status</th>
                  <th className="px-3 py-3" />
                </tr>
              </thead>
              <tbody>
                {visible.length === 0 ? (
                  <tr><td colSpan={11} className="px-4 py-10 text-center text-sm italic text-gray-400">No product matches those filters.</td></tr>
                ) : visible.map((row) => (
                  <tr key={row.id} className={`border-b border-gray-50 ${selectedId === row.id ? "bg-blue-50/40" : ""}`}>
                    <td className="px-4 py-3 font-bold text-gray-900">{row.name}</td>
                    <td className="px-3 py-3 text-gray-500">{row.category}</td>
                    <td className="px-3 py-3 text-right font-bold text-gray-900">{num(row.total)}</td>
                    <td className="px-3 py-3 text-right text-sky-700">{num(row.warehouse)}</td>
                    <td className="px-3 py-3 text-right text-amber-700">{num(row.agents)}</td>
                    <td className="px-3 py-3 text-right text-violet-700">{num(row.inTransit)}</td>
                    <td className="px-3 py-3 text-right text-orange-600">{num(row.reserved)}</td>
                    <td className="px-3 py-3 text-right font-semibold text-emerald-700">{num(row.available)}</td>
                    <td className={`px-3 py-3 text-right font-bold ${coverTone(row.status)}`}>{cover(row.coverDays)}</td>
                    <td className="px-3 py-3"><span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-bold ${tone(row.status)}`}>{row.status}</span></td>
                    <td className="px-3 py-3">
                      <button className="!min-h-0 rounded p-1 text-gray-400 hover:bg-gray-100" aria-label={`Open ${row.name}`}
                        onClick={() => setSelectedId(selectedId === row.id ? null : row.id)}>
                        <ChevronRight className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="m-0 border-t border-gray-100 px-4 py-3 text-xs text-gray-400">
            Showing {visible.length} of {rows.length} products · Package components, add-ons and gifts are included in reserved demand. In transit is not sellable yet.
          </p>
        </section>

        {selected && (
          <aside className="h-fit rounded-xl border border-gray-200 bg-white p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h2 className="m-0 truncate text-base font-bold text-gray-900">{selected.name}</h2>
                <span className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[11px] font-bold ${tone(selected.status)}`}>{selected.status}</span>
              </div>
              <button className="!min-h-0 rounded p-1 text-gray-400 hover:bg-gray-100" onClick={() => setSelectedId(null)} aria-label="Close">
                <X className="h-4 w-4" />
              </button>
            </div>
            <dl className="mt-4 space-y-2 text-sm">
              {([
                ["Total stock", num(selected.total)],
                ["Warehouse", num(selected.warehouse)],
                ["Agent-held", num(selected.agents)],
                ["In transit", num(selected.inTransit)],
                ["Reserved", num(selected.reserved)],
                ["Available", num(selected.available)],
                ["Avg. daily sales", runRateText(selected.dailySales)],
                ["Stock cover", Number.isFinite(selected.coverDays) ? `${selected.coverDays} days` : "No sales in window"],
                ["Reorder point", num(selected.reorderPoint)]
              ] as Array<[string, string]>).map(([label, value]) => (
                <div key={label} className="flex items-center justify-between border-b border-gray-50 pb-1.5">
                  <dt className="text-gray-500">{label}</dt>
                  <dd className="m-0 font-bold text-gray-900">{value}</dd>
                </div>
              ))}
            </dl>
            <h3 className="m-0 mt-4 text-sm font-bold text-gray-900">Top states by availability</h3>
            {selected.byState.length === 0 ? (
              <p className="m-0 mt-2 text-xs italic text-gray-400">No agent hub is holding this product.</p>
            ) : (
              <ul className="m-0 mt-2 list-none space-y-1.5 p-0">
                {selected.byState.slice(0, 5).map((entry) => (
                  <li key={entry.state} className="flex items-center justify-between text-sm">
                    <span className="text-gray-600">{entry.state}</span>
                    <span className="text-right"><strong className="block text-gray-900">{num(entry.available)} available</strong><small className="text-gray-400">{Number.isFinite(entry.coverDays) ? `${Math.round(entry.coverDays * 10) / 10} days` : "no recent sales"}</small></span>
                  </li>
                ))}
              </ul>
            )}
            {onOpenProduct && (
              <button className="!min-h-0 mt-4 w-full rounded-lg bg-[#1F8FE0] px-3 py-2 text-sm font-bold text-white hover:bg-[#1560a8]"
                onClick={() => onOpenProduct(selected.id)}>
                View product activity
              </button>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}
