// Product Availability - "where else do we already have this product, who has
// it, and how much is genuinely sellable?"
//
// A different question from State Inventory, which asks what one state holds.
// This one is product-first, because the decision it feeds is a marketing one:
// can we push this product in these places without moving a single box.
import { useEffect, useMemo, useState } from "react";
import {
  Boxes, ChevronDown, ChevronRight, Download, Info, MapPin, Package, Search, Users, X
} from "lucide-react";
import type { OpsOrder, OpsProduct, OpsStateHub, OpsWaybill } from "./InventoryLogisticsOperationsPage";
import { canonicalStateKey, downloadCsv, norm, num } from "./inventory-ops-model";
import {
  buildAvailabilityCells, crossSellRows, productRows, stateRowsFor,
  type AvailabilityCell, type Opportunity, type PendingDeductionLine
} from "./product-availability-model";
import { deliveredStockReconciliationApi } from "../lib/api";

type Props = {
  products: OpsProduct[];
  stateHubs: OpsStateHub[];
  orders: OpsOrder[];
  waybills: OpsWaybill[];
  onOpenAgent?: (agentId: string) => void;
};

type Tab = "Products" | "States" | "Cross-sell Opportunities";
const TABS: Tab[] = ["Products", "States", "Cross-sell Opportunities"];
const PAGE_SIZE = 10;

const chip = (value: Opportunity) =>
  value === "High" ? "bg-emerald-100 text-emerald-700"
    : value === "Medium" ? "bg-amber-100 text-amber-700"
      : "bg-gray-100 text-gray-600";

/** The rule, stated once, shown everywhere it applies. */
function SellableNote({ children }: { children?: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900">
      <Info className="mt-0.5 h-4 w-4 shrink-0" />
      <span>
        <b>Only available (sellable) stock is shown.</b> Reserved, pending deductions, damaged and in-transit stock are excluded.
        {children}
      </span>
    </div>
  );
}

function Metric({ label, value, helper }: { label: string; value: string; helper?: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2.5">
      <p className="m-0 text-[11px] text-gray-500">{label}</p>
      <p className="m-0 mt-0.5 text-xl font-black text-gray-900">{value}</p>
      {helper && <p className="m-0 text-[10px] text-gray-400">{helper}</p>}
    </div>
  );
}

export default function InventoryOpsProductAvailability({
  products, stateHubs, orders, waybills, onOpenAgent
}: Props) {
  const [tab, setTab] = useState<Tab>("Products");
  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [multiAgentOnly, setMultiAgentOnly] = useState(false);
  const [page, setPage] = useState(1);

  const [detailProductId, setDetailProductId] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<"By State" | "By Agent" | "Details">("By State");
  const [openStateKeys, setOpenStateKeys] = useState<Set<string>>(new Set());
  const [agentsModal, setAgentsModal] = useState<{ productId: string; stateKey: string } | null>(null);
  const [agentDetail, setAgentDetail] = useState<{ productId: string; locationId: string } | null>(null);
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [openCrossSell, setOpenCrossSell] = useState<string | null>(null);

  // ⚠️ PENDING DEDUCTIONS COME FROM THE RECONCILIATION QUEUE, and without them
  // this page would count stock that has already been delivered - the single
  // biggest way "sellable" could lie. If the endpoint refuses (role, or the
  // feature not reachable) the page still works and says so, rather than
  // silently overstating every figure.
  const [pendingLines, setPendingLines] = useState<PendingDeductionLine[]>([]);
  const [pendingError, setPendingError] = useState("");
  useEffect(() => {
    let cancelled = false;
    deliveredStockReconciliationApi.list()
      .then((result) => {
        if (cancelled) return;
        setPendingLines((result.rows ?? []).map((row) => ({
          agentLocationId: row.agentLocationId,
          productId: row.productId,
          quantity: row.quantity,
          status: row.status
        })));
      })
      .catch(() => { if (!cancelled) setPendingError("Pending deductions could not be loaded, so available stock may read high until the delivered-stock queue is reachable."); });
    return () => { cancelled = true; };
  }, []);

  const cells = useMemo(
    () => buildAvailabilityCells(products, stateHubs, orders, waybills, pendingLines),
    [products, stateHubs, orders, waybills, pendingLines]
  );

  const allStates = useMemo(() => {
    const seen = new Map<string, string>();
    for (const cell of cells) seen.set(canonicalStateKey(cell.state) || norm(cell.state), cell.state);
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [cells]);
  const allCategories = useMemo(
    () => [...new Set(cells.map((cell) => cell.category))].sort(),
    [cells]
  );

  const scopedCells = useMemo(() => cells.filter((cell) => {
    if (stateFilter !== "all" && (canonicalStateKey(cell.state) || norm(cell.state)) !== stateFilter) return false;
    if (categoryFilter !== "all" && cell.category !== categoryFilter) return false;
    return true;
  }), [cells, stateFilter, categoryFilter]);

  const rows = useMemo(() => productRows(scopedCells), [scopedCells]);
  const visibleRows = useMemo(() => {
    const query = norm(search);
    return rows.filter((row) => {
      if (query && !norm(row.productName).includes(query)) return false;
      if (multiAgentOnly && row.agents < 2) return false;
      return true;
    });
  }, [rows, search, multiAgentOnly]);
  useEffect(() => { setPage(1); }, [search, stateFilter, categoryFilter, multiAgentOnly, tab]);
  const pageCount = Math.max(1, Math.ceil(visibleRows.length / PAGE_SIZE));
  const pageRows = visibleRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const states = useMemo(() => stateRowsFor(scopedCells), [scopedCells]);
  const crossSell = useMemo(() => crossSellRows(scopedCells), [scopedCells]);

  const selected = selectedProductId ?? detailProductId;
  const selectedRow = rows.find((row) => row.productId === selected) ?? null;
  const cellsForSelected = useMemo(
    () => (selected ? scopedCells.filter((cell) => cell.productId === selected) : []),
    [scopedCells, selected]
  );
  const statesForSelected = useMemo(() => {
    const byState = new Map<string, { key: string; state: string; agents: AvailabilityCell[]; available: number; openOrders: number }>();
    for (const cell of cellsForSelected) {
      const key = canonicalStateKey(cell.state) || norm(cell.state);
      const found = byState.get(key);
      if (found) { found.agents.push(cell); found.available += cell.available; found.openOrders += cell.openOrders; }
      else byState.set(key, { key, state: cell.state, agents: [cell], available: cell.available, openOrders: cell.openOrders });
    }
    return [...byState.values()]
      .map((group) => ({ ...group, agents: [...group.agents].sort((a, b) => b.available - a.available) }))
      .sort((a, b) => b.available - a.available || a.state.localeCompare(b.state));
  }, [cellsForSelected]);

  const agentsModalGroup = agentsModal
    ? statesForSelected.find((group) => group.key === agentsModal.stateKey) ?? null
    : null;
  const agentDetailCell = agentDetail
    ? cells.find((cell) => cell.productId === agentDetail.productId && cell.locationId === agentDetail.locationId) ?? null
    : null;

  const toggleState = (key: string) => setOpenStateKeys((current) => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  return (
    <div className="space-y-4 text-gray-900">
      <header>
        <h1 className="m-0 text-2xl font-black tracking-tight">Product Availability</h1>
        <p className="m-0 mt-1 text-sm text-gray-500">
          See which products are available across multiple states and agents. Use this to plan marketing, transfers and cross-selling.
        </p>
      </header>

      {pendingError && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs font-semibold text-amber-900">{pendingError}</div>
      )}

      <div className="rounded-xl border border-gray-200 bg-white">
        <div className="flex flex-wrap items-center gap-1 border-b border-gray-100 px-3 pt-2">
          {TABS.map((option) => (
            <button key={option} type="button" onClick={() => setTab(option)}
              className={`!min-h-0 border-b-2 px-4 py-2.5 text-sm font-bold transition-colors ${
                tab === option ? "border-blue-600 text-blue-700" : "border-transparent text-gray-500 hover:text-gray-800"}`}>
              {option}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2 p-3">
          <div className="relative min-w-[200px] flex-1">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
            <input value={search} onChange={(event) => setSearch(event.target.value)}
              placeholder={tab === "Products" ? "Search product…" : tab === "States" ? "Search state…" : "Search agent…"}
              className="w-full rounded-lg border border-gray-200 py-2 pl-9 pr-3 text-sm" />
          </div>
          <select value={stateFilter} onChange={(event) => setStateFilter(event.target.value)}
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm">
            <option value="all">All States</option>
            {allStates.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
          <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm">
            <option value="all">All Categories</option>
            {allCategories.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
          {tab === "Products" && (
            <label className="inline-flex items-center gap-2 text-sm text-gray-600">
              <input type="checkbox" checked={multiAgentOnly} onChange={(event) => setMultiAgentOnly(event.target.checked)} />
              Show products in 2+ agents
            </label>
          )}
          <button type="button"
            className="!min-h-0 ml-auto inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50"
            onClick={() => {
              if (tab === "Products") downloadCsv("product-availability.csv", visibleRows.map((row) => ({ Product: row.productName, Category: row.category, States: row.states, Agents: row.agents, "Available (sellable)": row.available, Reserved: row.reserved, "Pending deduction": row.pendingDeduction, Incoming: row.incoming, "Open orders": row.openOrders, Opportunity: row.opportunity })));
              else if (tab === "States") downloadCsv("availability-by-state.csv", states.map((row) => ({ State: row.state, Products: row.products, Agents: row.agents, "Available (sellable)": row.available, "Open orders": row.openOrders })));
              else downloadCsv("cross-sell-opportunities.csv", crossSell.map((row) => ({ Agent: row.agentName, State: row.state, Area: row.city, "Products available": row.products, "Total units": row.available, Potential: row.potential })));
            }}>
            <Download className="h-4 w-4" /> Export
          </button>
        </div>
      </div>

      {tab === "Products" && (
        <div className="grid gap-4 xl:grid-cols-[1.7fr_1fr]">
          <section className="overflow-hidden rounded-xl border border-gray-200 bg-white">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="bg-gray-50 text-[11px] uppercase text-gray-500">
                  <tr>
                    <th className="px-4 py-3">Product</th>
                    <th className="px-3 py-3 text-right">States</th>
                    <th className="px-3 py-3 text-right">Agents</th>
                    <th className="px-3 py-3 text-right">Total Available<span className="block normal-case text-gray-400">(units)</span></th>
                    <th className="px-3 py-3 text-right">Open Orders</th>
                    <th className="px-3 py-3">Opportunity</th>
                    <th className="px-3 py-3">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.length === 0 ? (
                    <tr><td colSpan={7} className="px-4 py-10 text-center text-sm italic text-gray-400">No product matches those filters.</td></tr>
                  ) : pageRows.map((row) => (
                    <tr key={row.productId}
                      className={`cursor-pointer border-b border-gray-50 ${selectedProductId === row.productId ? "bg-blue-50/40" : "hover:bg-gray-50/60"}`}
                      onClick={() => setSelectedProductId(row.productId)}>
                      <td className="px-4 py-3">
                        <span className="flex items-center gap-2">
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-500"><Package className="h-4 w-4" /></span>
                          <span className="min-w-0">
                            <strong className="block truncate text-gray-900">{row.productName}</strong>
                            <small className="text-gray-400">{row.category}</small>
                          </span>
                        </span>
                      </td>
                      <td className="px-3 py-3 text-right text-gray-700">{row.states}</td>
                      <td className="px-3 py-3 text-right text-gray-700">{row.agents}</td>
                      <td className="px-3 py-3 text-right font-bold text-gray-900">{num(row.available)}</td>
                      <td className="px-3 py-3 text-right text-orange-600">{num(row.openOrders)}</td>
                      <td className="px-3 py-3"><span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-bold ${chip(row.opportunity)}`}>{row.opportunity}</span></td>
                      <td className="px-3 py-3">
                        <button type="button"
                          className="!min-h-0 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-bold text-blue-700 hover:bg-blue-100"
                          onClick={(event) => { event.stopPropagation(); setDetailProductId(row.productId); setSelectedProductId(row.productId); setDetailTab("By State"); setOpenStateKeys(new Set()); }}>
                          View
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 px-4 py-3 text-xs text-gray-500">
              <span>Showing {pageRows.length} of {visibleRows.length} products</span>
              <span className="flex items-center gap-1">
                <button type="button" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}
                  className="!min-h-0 rounded border border-gray-200 px-2 py-1 disabled:opacity-40">Prev</button>
                <span className="px-2">Page {page} of {pageCount}</span>
                <button type="button" disabled={page >= pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))}
                  className="!min-h-0 rounded border border-gray-200 px-2 py-1 disabled:opacity-40">Next</button>
              </span>
            </div>
          </section>

          <aside className="h-fit space-y-3 rounded-xl border border-gray-200 bg-white p-4">
            {!selectedRow ? (
              <p className="m-0 text-sm italic text-gray-400">Select a product to see where it is held.</p>
            ) : (
              <>
                <div className="flex items-start gap-3">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-500"><Package className="h-5 w-5" /></span>
                  <div className="min-w-0">
                    <h2 className="m-0 truncate text-base font-black text-gray-950">{selectedRow.productName}</h2>
                    <p className="m-0 text-xs text-gray-500">{selectedRow.category}</p>
                  </div>
                </div>
                <div className="grid grid-cols-4 gap-2">
                  <Metric label="States" value={String(selectedRow.states)} />
                  <Metric label="Agents" value={String(selectedRow.agents)} />
                  <Metric label="Available" value={num(selectedRow.available)} />
                  <Metric label="Open" value={num(selectedRow.openOrders)} />
                </div>
                <div className="overflow-hidden rounded-lg border border-gray-200">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-gray-50 text-[10px] uppercase text-gray-500">
                      <tr><th className="px-3 py-2">State</th><th className="px-2 py-2 text-right">Agents</th><th className="px-2 py-2 text-right">Available</th><th className="px-2 py-2" /></tr>
                    </thead>
                    <tbody>
                      {statesForSelected.map((group) => (
                        <tr key={group.key} className="border-b border-gray-50">
                          <td className="px-3 py-2 font-semibold text-gray-800">{group.state}</td>
                          <td className="px-2 py-2 text-right text-gray-600">{group.agents.length}</td>
                          <td className="px-2 py-2 text-right font-bold text-gray-900">{num(group.available)}</td>
                          <td className="px-2 py-2 text-right">
                            <button type="button" className="!min-h-0 rounded border border-blue-200 px-2 py-1 text-[11px] font-bold text-blue-700 hover:bg-blue-50"
                              onClick={() => { setDetailProductId(selectedRow.productId); setAgentsModal({ productId: selectedRow.productId, stateKey: group.key }); }}>
                              View agents
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <SellableNote />
              </>
            )}
          </aside>
        </div>
      )}

      {tab === "States" && (
        <section className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-left text-sm">
              <thead className="bg-gray-50 text-[11px] uppercase text-gray-500">
                <tr><th className="px-4 py-3">State</th><th className="px-3 py-3 text-right">Products</th><th className="px-3 py-3 text-right">Agents</th><th className="px-3 py-3 text-right">Available (units)</th><th className="px-3 py-3 text-right">Open Orders</th></tr>
              </thead>
              <tbody>
                {states.filter((row) => !norm(search) || norm(row.state).includes(norm(search))).map((row) => (
                  <tr key={row.key} className="border-b border-gray-50">
                    <td className="px-4 py-3"><span className="flex items-center gap-1.5 font-bold text-gray-900"><MapPin className="h-3.5 w-3.5 text-gray-400" />{row.state}</span></td>
                    <td className="px-3 py-3 text-right text-gray-700">{row.products}</td>
                    <td className="px-3 py-3 text-right text-gray-700">{row.agents}</td>
                    <td className="px-3 py-3 text-right font-bold text-gray-900">{num(row.available)}</td>
                    <td className="px-3 py-3 text-right text-orange-600">{num(row.openOrders)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="p-3"><SellableNote /></div>
        </section>
      )}

      {tab === "Cross-sell Opportunities" && (
        <section className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <div className="border-b border-gray-100 p-3 text-xs text-gray-500">
            Agents already holding two or more sellable products. Anything listed here can ride along with a delivery that agent is already making — no transfer, no inter-state movement.
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-left text-sm">
              <thead className="bg-gray-50 text-[11px] uppercase text-gray-500">
                <tr><th className="px-4 py-3">Agent</th><th className="px-3 py-3">State</th><th className="px-3 py-3 text-right">Products Available</th><th className="px-3 py-3 text-right">Total Units</th><th className="px-3 py-3">Cross-sell Potential</th><th className="px-3 py-3" /></tr>
              </thead>
              <tbody>
                {crossSell.filter((row) => !norm(search) || norm(row.agentName).includes(norm(search))).flatMap((row) => [
                  <tr key={row.locationId || row.agentId}
                    className={`cursor-pointer border-b border-gray-50 ${openCrossSell === (row.locationId || row.agentId) ? "bg-blue-50/40" : "hover:bg-gray-50/60"}`}
                    onClick={() => setOpenCrossSell(openCrossSell === (row.locationId || row.agentId) ? null : (row.locationId || row.agentId))}>
                    <td className="px-4 py-3">
                      <strong className="text-gray-900">{row.agentName}</strong>
                      {row.city && <small className="ml-1 text-gray-400">· {row.city}</small>}
                    </td>
                    <td className="px-3 py-3 text-gray-600">{row.state}</td>
                    <td className="px-3 py-3 text-right font-bold text-gray-900">{row.products}</td>
                    <td className="px-3 py-3 text-right text-gray-700">{num(row.available)}</td>
                    <td className="px-3 py-3"><span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-bold ${chip(row.potential)}`}>{row.potential}</span></td>
                    <td className="px-3 py-3 text-right text-gray-400">
                      {openCrossSell === (row.locationId || row.agentId) ? <ChevronDown className="inline h-4 w-4" /> : <ChevronRight className="inline h-4 w-4" />}
                    </td>
                  </tr>,
                  openCrossSell === (row.locationId || row.agentId) ? (
                    <tr key={`${row.locationId || row.agentId}-lines`} className="border-b border-gray-100 bg-blue-50/20">
                      <td colSpan={6} className="px-4 py-3">
                        <ul className="m-0 grid list-none gap-1.5 p-0 sm:grid-cols-2 xl:grid-cols-3">
                          {row.lines.map((line) => (
                            <li key={line.productId} className="flex items-center justify-between gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs">
                              <span className="min-w-0 truncate text-gray-700">{line.productName}</span>
                              <b className="shrink-0 text-gray-900">{num(line.available)}</b>
                            </li>
                          ))}
                        </ul>
                      </td>
                    </tr>
                  ) : null
                ])}
              </tbody>
            </table>
          </div>
          <div className="p-3"><SellableNote /></div>
        </section>
      )}

      {/* ── View: full product distribution ─────────────────────────────── */}
      {detailProductId && selectedRow && !agentsModal && !agentDetail && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/55 p-3"
          onMouseDown={(event) => { if (event.currentTarget === event.target) setDetailProductId(null); }}>
          <div className="max-h-[94vh] w-full max-w-4xl overflow-y-auto rounded-xl bg-white shadow-2xl">
            <div className="flex items-start justify-between p-5">
              <div>
                <h2 className="m-0 text-xl font-black">Product Availability Details</h2>
                <p className="m-0 text-sm text-gray-500">See where this product is available, by state and agent.</p>
              </div>
              <button type="button" onClick={() => setDetailProductId(null)} className="!min-h-0 rounded-lg p-2 text-gray-500 hover:bg-gray-100"><X className="h-5 w-5" /></button>
            </div>
            <div className="mx-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-200 p-4">
              <div className="flex items-center gap-3">
                <span className="flex h-12 w-12 items-center justify-center rounded-lg bg-gray-100 text-gray-500"><Package className="h-5 w-5" /></span>
                <div>
                  <p className="m-0 text-lg font-black">{selectedRow.productName}</p>
                  <p className="m-0 text-xs text-gray-500">{selectedRow.category}</p>
                </div>
              </div>
              <div className="grid grid-cols-4 gap-2">
                <Metric label="States" value={String(selectedRow.states)} />
                <Metric label="Agents" value={String(selectedRow.agents)} />
                <Metric label="Available units" value={num(selectedRow.available)} />
                <Metric label="Open orders" value={num(selectedRow.openOrders)} />
              </div>
            </div>
            <div className="mt-4 flex gap-1 border-b border-gray-100 px-5">
              {(["By State", "By Agent", "Details"] as const).map((option) => (
                <button key={option} type="button" onClick={() => setDetailTab(option)}
                  className={`!min-h-0 border-b-2 px-4 py-2.5 text-sm font-bold ${detailTab === option ? "border-blue-600 text-blue-700" : "border-transparent text-gray-500"}`}>
                  {option}
                </button>
              ))}
            </div>

            <div className="p-5">
              {detailTab === "By State" && (
                <table className="w-full text-left text-sm">
                  <thead className="bg-gray-50 text-[10px] uppercase text-gray-500">
                    <tr><th className="px-3 py-2" /><th className="px-3 py-2">State</th><th className="px-2 py-2 text-right">Agents</th><th className="px-2 py-2 text-right">Total Available</th><th className="px-2 py-2 text-right">Open Orders</th><th className="px-2 py-2" /></tr>
                  </thead>
                  <tbody>
                    {statesForSelected.flatMap((group) => [
                      <tr key={group.key} className="cursor-pointer border-b border-gray-50 hover:bg-gray-50/60" onClick={() => toggleState(group.key)}>
                        <td className="px-3 py-2.5 text-gray-400">{openStateKeys.has(group.key) ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</td>
                        <td className="px-3 py-2.5 font-bold text-gray-900">{group.state}</td>
                        <td className="px-2 py-2.5 text-right text-gray-700">{group.agents.length}</td>
                        <td className="px-2 py-2.5 text-right font-bold text-gray-900">{num(group.available)}</td>
                        <td className="px-2 py-2.5 text-right text-orange-600">{num(group.openOrders)}</td>
                        <td className="px-2 py-2.5 text-right">
                          <button type="button" className="!min-h-0 rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1 text-[11px] font-bold text-blue-700"
                            onClick={(event) => { event.stopPropagation(); setAgentsModal({ productId: selectedRow.productId, stateKey: group.key }); }}>
                            View agents
                          </button>
                        </td>
                      </tr>,
                      openStateKeys.has(group.key) ? (
                        <tr key={`${group.key}-agents`} className="border-b border-gray-100 bg-gray-50/60">
                          <td colSpan={6} className="px-6 py-3">
                            <table className="w-full text-left text-xs">
                              <thead className="text-[10px] uppercase text-gray-500">
                                <tr><th className="py-1">Agent / Location</th><th className="py-1 text-right">Available Units</th><th className="py-1 text-right">Open Orders</th><th className="py-1">Status</th><th className="py-1" /></tr>
                              </thead>
                              <tbody>
                                {group.agents.map((cell) => (
                                  <tr key={cell.locationId || cell.agentId} className="border-t border-gray-100">
                                    <td className="py-1.5 text-gray-800">{cell.agentName}{cell.city && <span className="text-gray-400"> · {cell.city}</span>}</td>
                                    <td className="py-1.5 text-right font-bold text-gray-900">{num(cell.available)}</td>
                                    <td className="py-1.5 text-right text-gray-600">{num(cell.openOrders)}</td>
                                    <td className="py-1.5"><span className={`inline-flex items-center gap-1 ${cell.active ? "text-emerald-700" : "text-gray-400"}`}><span className={`h-1.5 w-1.5 rounded-full ${cell.active ? "bg-emerald-500" : "bg-gray-300"}`} />{cell.active ? "Active" : "Inactive"}</span></td>
                                    <td className="py-1.5 text-right">
                                      <button type="button" className="!min-h-0 text-[11px] font-bold text-blue-700 hover:underline"
                                        onClick={() => setAgentDetail({ productId: selectedRow.productId, locationId: cell.locationId })}>
                                        View agent
                                      </button>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      ) : null
                    ])}
                  </tbody>
                </table>
              )}

              {detailTab === "By Agent" && (
                <table className="w-full text-left text-sm">
                  <thead className="bg-gray-50 text-[10px] uppercase text-gray-500">
                    <tr><th className="px-3 py-2">Agent / Location</th><th className="px-3 py-2">State</th><th className="px-2 py-2 text-right">Available</th><th className="px-2 py-2 text-right">Reserved</th><th className="px-2 py-2 text-right">Pending</th><th className="px-2 py-2 text-right">Incoming</th></tr>
                  </thead>
                  <tbody>
                    {[...cellsForSelected].sort((a, b) => b.available - a.available).map((cell) => (
                      <tr key={cell.locationId || cell.agentId} className="border-b border-gray-50">
                        <td className="px-3 py-2.5 font-semibold text-gray-800">{cell.agentName}{cell.city && <span className="font-normal text-gray-400"> · {cell.city}</span>}</td>
                        <td className="px-3 py-2.5 text-gray-600">{cell.state}</td>
                        <td className="px-2 py-2.5 text-right font-bold text-gray-900">{num(cell.available)}</td>
                        <td className="px-2 py-2.5 text-right text-orange-600">{num(cell.reserved)}</td>
                        <td className="px-2 py-2.5 text-right text-rose-600">{num(cell.pendingDeduction)}</td>
                        <td className="px-2 py-2.5 text-right text-violet-700">{num(cell.incoming)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {detailTab === "Details" && (
                <dl className="m-0 grid gap-2 sm:grid-cols-2">
                  {([
                    ["On hand across network", num(selectedRow.onHand)],
                    ["Available (sellable)", num(selectedRow.available)],
                    ["Reserved by open orders", num(selectedRow.reserved)],
                    ["Delivered, awaiting reconciliation", num(selectedRow.pendingDeduction)],
                    ["In transit (not sellable)", num(selectedRow.incoming)],
                    ["Open orders", num(selectedRow.openOrders)],
                    ["States with sellable stock", String(selectedRow.states)],
                    ["Agents holding it", String(selectedRow.agents)]
                  ] as Array<[string, string]>).map(([label, value]) => (
                    <div key={label} className="flex items-center justify-between rounded-lg border border-gray-200 px-3 py-2 text-sm">
                      <dt className="text-gray-500">{label}</dt><dd className="m-0 font-bold text-gray-900">{value}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>
            <div className="flex items-center justify-between gap-3 border-t border-gray-100 p-5">
              <SellableNote />
              <button type="button" onClick={() => setDetailProductId(null)} className="!min-h-0 shrink-0 rounded-lg border border-gray-300 px-5 py-2 text-sm font-bold">Close</button>
            </div>
          </div>
        </div>
      )}

      {/* ── View agents: one state, one product ─────────────────────────── */}
      {agentsModal && agentsModalGroup && selectedRow && !agentDetail && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/55 p-3"
          onMouseDown={(event) => { if (event.currentTarget === event.target) setAgentsModal(null); }}>
          <div className="max-h-[94vh] w-full max-w-4xl overflow-y-auto rounded-xl bg-white shadow-2xl">
            <div className="flex items-start justify-between p-5">
              <div>
                <h2 className="m-0 text-xl font-black">Agents in {agentsModalGroup.state} — {selectedRow.productName}</h2>
                <p className="m-0 text-sm text-gray-500">All agents in {agentsModalGroup.state} holding {selectedRow.productName} and their available stock.</p>
              </div>
              <button type="button" onClick={() => setAgentsModal(null)} className="!min-h-0 rounded-lg p-2 text-gray-500 hover:bg-gray-100"><X className="h-5 w-5" /></button>
            </div>
            <div className="mx-5 grid gap-2 sm:grid-cols-4">
              <Metric label="Total Available Units" value={num(agentsModalGroup.available)} helper={`Across ${agentsModalGroup.agents.length} agents`} />
              <Metric label="Agents" value={String(agentsModalGroup.agents.length)} helper="Holding this product" />
              <Metric label="Open Orders" value={num(agentsModalGroup.openOrders)} helper="From this state" />
              <Metric label="State Share" value={`${selectedRow.available > 0 ? Math.round((agentsModalGroup.available / selectedRow.available) * 1000) / 10 : 0}%`} helper={`of ${num(selectedRow.available)} units`} />
            </div>
            <div className="p-5">
              <table className="w-full text-left text-sm">
                <thead className="bg-gray-50 text-[10px] uppercase text-gray-500">
                  <tr><th className="px-3 py-2">Agent / Location</th><th className="px-2 py-2">Status</th><th className="px-2 py-2 text-right">Available</th><th className="px-2 py-2 text-right">Reserved</th><th className="px-2 py-2 text-right">Pending</th><th className="px-2 py-2 text-right">Incoming</th><th className="px-2 py-2 text-right">Open</th><th className="px-2 py-2" /></tr>
                </thead>
                <tbody>
                  {agentsModalGroup.agents.map((cell) => (
                    <tr key={cell.locationId || cell.agentId} className="border-b border-gray-50">
                      <td className="px-3 py-2.5"><strong className="text-gray-900">{cell.agentName}</strong><small className="block text-gray-400">{[cell.city, cell.state].filter(Boolean).join(", ")}</small></td>
                      <td className="px-2 py-2.5"><span className={`inline-flex items-center gap-1 text-xs ${cell.active ? "text-emerald-700" : "text-gray-400"}`}><span className={`h-1.5 w-1.5 rounded-full ${cell.active ? "bg-emerald-500" : "bg-gray-300"}`} />{cell.active ? "Active" : "Inactive"}</span></td>
                      <td className="px-2 py-2.5 text-right font-bold text-gray-900">{num(cell.available)}</td>
                      <td className="px-2 py-2.5 text-right text-orange-600">{num(cell.reserved)}</td>
                      <td className="px-2 py-2.5 text-right text-rose-600">{num(cell.pendingDeduction)}</td>
                      <td className="px-2 py-2.5 text-right text-violet-700">{num(cell.incoming)}</td>
                      <td className="px-2 py-2.5 text-right text-gray-600">{num(cell.openOrders)}</td>
                      <td className="px-2 py-2.5 text-right">
                        <button type="button" className="!min-h-0 rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1 text-[11px] font-bold text-blue-700"
                          onClick={() => setAgentDetail({ productId: selectedRow.productId, locationId: cell.locationId })}>
                          View Details
                        </button>
                      </td>
                    </tr>
                  ))}
                  <tr className="bg-gray-50 font-bold">
                    <td className="px-3 py-2.5">Total</td><td />
                    <td className="px-2 py-2.5 text-right">{num(agentsModalGroup.available)}</td>
                    <td className="px-2 py-2.5 text-right">{num(agentsModalGroup.agents.reduce((sum, cell) => sum + cell.reserved, 0))}</td>
                    <td className="px-2 py-2.5 text-right">{num(agentsModalGroup.agents.reduce((sum, cell) => sum + cell.pendingDeduction, 0))}</td>
                    <td className="px-2 py-2.5 text-right">{num(agentsModalGroup.agents.reduce((sum, cell) => sum + cell.incoming, 0))}</td>
                    <td className="px-2 py-2.5 text-right">{num(agentsModalGroup.openOrders)}</td><td />
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between gap-3 border-t border-gray-100 p-5">
              <SellableNote />
              <button type="button" onClick={() => setAgentsModal(null)} className="!min-h-0 shrink-0 rounded-lg border border-gray-300 px-5 py-2 text-sm font-bold">Close</button>
            </div>
          </div>
        </div>
      )}

      {/* ── View Details: one agent, one product ────────────────────────── */}
      {agentDetail && agentDetailCell && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/55 p-3"
          onMouseDown={(event) => { if (event.currentTarget === event.target) setAgentDetail(null); }}>
          <div className="max-h-[94vh] w-full max-w-3xl overflow-y-auto rounded-xl bg-white shadow-2xl">
            <div className="flex items-start justify-between p-5">
              <div>
                <h2 className="m-0 text-xl font-black">Agent Stock Details</h2>
                <p className="m-0 text-sm text-gray-500">Full stock position for this agent and product.</p>
              </div>
              <button type="button" onClick={() => setAgentDetail(null)} className="!min-h-0 rounded-lg p-2 text-gray-500 hover:bg-gray-100"><X className="h-5 w-5" /></button>
            </div>
            <div className="mx-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-200 p-4">
              <div>
                <p className="m-0 text-base font-black text-gray-900">{agentDetailCell.agentName}</p>
                <p className="m-0 flex items-center gap-1 text-xs text-gray-500"><MapPin className="h-3 w-3" />{[agentDetailCell.city, agentDetailCell.state].filter(Boolean).join(", ")}</p>
              </div>
              {onOpenAgent && agentDetailCell.agentId && (
                <button type="button" onClick={() => onOpenAgent(agentDetailCell.agentId)}
                  className="!min-h-0 inline-flex items-center gap-2 rounded-lg border border-blue-200 px-3 py-2 text-sm font-bold text-blue-700 hover:bg-blue-50">
                  <Users className="h-4 w-4" /> View All Products
                </button>
              )}
            </div>
            <div className="grid gap-2 p-5 sm:grid-cols-4">
              <Metric label="Available Units" value={num(agentDetailCell.available)} helper="Sellable now" />
              <Metric label="Reserved Units" value={num(agentDetailCell.reserved)} helper="On open orders" />
              <Metric label="Pending Deduction" value={num(agentDetailCell.pendingDeduction)} helper="Delivered, not reconciled" />
              <Metric label="Incoming Units" value={num(agentDetailCell.incoming)} helper="In transit" />
            </div>
            <div className="px-5 pb-5">
              <div className="rounded-lg border border-gray-200 p-4">
                <h3 className="m-0 text-sm font-bold text-gray-900">Stock Summary — {agentDetailCell.productName}</h3>
                <dl className="m-0 mt-3 space-y-1.5 text-sm">
                  {([
                    ["On hand (counted)", num(agentDetailCell.onHand)],
                    ["Less reserved", `-${num(agentDetailCell.reserved)}`],
                    ["Less pending deduction", `-${num(agentDetailCell.pendingDeduction)}`],
                    ["Available (sellable)", num(agentDetailCell.available)],
                    ["Open orders", num(agentDetailCell.openOrders)]
                  ] as Array<[string, string]>).map(([label, value], index) => (
                    <div key={label} className={`flex items-center justify-between border-b border-gray-50 pb-1.5 ${index === 3 ? "font-black text-gray-900" : "text-gray-600"}`}>
                      <dt>{label}</dt><dd className="m-0">{value}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            </div>
            <div className="flex items-center justify-between gap-3 border-t border-gray-100 p-5">
              <SellableNote />
              <button type="button" onClick={() => setAgentDetail(null)} className="!min-h-0 shrink-0 rounded-lg border border-gray-300 px-5 py-2 text-sm font-bold">Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
