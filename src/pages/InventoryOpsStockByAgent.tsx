// Stock by Agent - what each agent hub is holding, and what it is worth.
//
// Stock value is quantity x the product's SELLING price, matching the design's
// "At selling price". That is exposure, not cost - it is what the company would
// lose if a hub's stock walked, which is the number worth watching on a page
// about who is holding what.
import { useMemo, useState } from "react";
import { AlertTriangle, ArrowLeftRight, Boxes, CalendarDays, ClipboardCheck, Download, History, MessageCircle, PackageSearch, Search, Truck, UserCog, UserRound, Wallet } from "lucide-react";
import type { InventoryOperationsAction, OpsDiscrepancy, OpsOrder, OpsProduct, OpsStateHub, OpsWaybill } from "./InventoryLogisticsOperationsPage";
import { CLOSED_ORDER_STATES, downloadCsv, inventoryLinesForOrder, isInTransitWaybill, isInsideWindow, money, norm, num, orderEventDate, statusFor, statusTone, waybillInventoryLines, type StockStatus } from "./inventory-ops-model";

type Props = {
  products: OpsProduct[];
  stateHubs: OpsStateHub[];
  orders: OpsOrder[];
  waybills: OpsWaybill[];
  discrepancies: OpsDiscrepancy[];
  lookbackDays: number;
  criticalDays: number;
  watchDays: number;
  canManage: boolean;
  onAction: (action: InventoryOperationsAction) => void;
  onOpenAgent?: (agentId: string) => void;
  onEditAgent?: (agentId: string) => void;
  onViewAgentHistory?: (agentId: string) => void;
};

type AgentRow = {
  key: string;
  agentId: string;
  locationId: string;
  name: string;
  phone: string;
  state: string;
  city: string;
  active: boolean;
  joinedAt: string;
  lastCountAt: string;
  productCount: number;
  total: number;
  reserved: number;
  available: number;
  inTransit: number;
  dailySales: number;
  coverDays: number;
  value: number;
  status: StockStatus;
  lines: Array<{ name: string; units: number }>;
};

export default function InventoryOpsStockByAgent({
  products, stateHubs, orders, waybills, discrepancies, lookbackDays, criticalDays, watchDays,
  canManage, onAction, onOpenAgent, onEditAgent, onViewAgentHistory
}: Props) {
  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [lowOnly, setLowOnly] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [windowDays, setWindowDays] = useState(lookbackDays);

  const rows = useMemo<AgentRow[]>(() => {
    const priceById = new Map(products.map((product) => [product.id, Math.max(0, product.sellingPrice ?? 0)]));
    const nameById = new Map(products.map((product) => [product.id, product.name]));
    const allowedIds = categoryFilter === "all"
      ? null
      : new Set(products.filter((product) => (product.category ?? "Uncategorised") === categoryFilter).map((product) => product.id));
    const hubCountByAgent = new Map<string, number>();
    for (const hub of stateHubs) {
      if (hub.agentId) hubCountByAgent.set(hub.agentId, (hubCountByAgent.get(hub.agentId) ?? 0) + 1);
    }

    const openByAgent = new Map<string, number>();
    const deliveredByAgent = new Map<string, number>();
    for (const order of orders) {
      if (!order.assignedAgentId) continue;
      const assignmentKey = order.assignedAgentLocationId || order.assignedAgentId;
      const orderLines = inventoryLinesForOrder(order).filter((line) => !allowedIds || allowedIds.has(line.productId));
      const units = orderLines.reduce((sum, line) => sum + line.quantity, 0);
      if (units <= 0) continue;
      const orderStatus = norm(order.status);
      if (orderStatus === "delivered" && isInsideWindow(orderEventDate(order), windowDays)) {
        deliveredByAgent.set(assignmentKey, (deliveredByAgent.get(assignmentKey) ?? 0) + units);
      } else if (!CLOSED_ORDER_STATES.has(orderStatus)) {
        openByAgent.set(assignmentKey, (openByAgent.get(assignmentKey) ?? 0) + units);
      }
    }
    const transitByAgent = new Map<string, number>();
    for (const waybill of waybills) {
      if (!isInTransitWaybill(waybill)) continue;
      const to = waybill.toAgentLocationId || waybill.toAgentId || norm(waybill.toAgentName || waybill.to);
      if (!to) continue;
      const units = waybillInventoryLines(waybill)
        .filter((item) => !allowedIds || (!!item.productId && allowedIds.has(item.productId)))
        .reduce((sum, item) => sum + item.quantity, 0);
      if (units <= 0) continue;
      transitByAgent.set(to, (transitByAgent.get(to) ?? 0) + units);
    }

    return stateHubs.map((hub) => {
      const visibleStocks = hub.stocks.filter((stock) => !allowedIds || allowedIds.has(stock.productId));
      const total = visibleStocks.reduce((sum, stock) => sum + Math.max(0, stock.quantity), 0);
      const agentKey = hub.agentId || "";
      const assignmentKey = hub.locationId || agentKey;
      // Older orders may only carry the agent ID. It is safe to attach those
      // reservations to a hub only when that agent has exactly one location;
      // otherwise guessing a location would make the wrong stock look held.
      const agentFallback = agentKey && hubCountByAgent.get(agentKey) === 1 ? agentKey : "";
      const reserved = (assignmentKey ? openByAgent.get(assignmentKey) ?? 0 : 0)
        + (agentFallback && agentFallback !== assignmentKey ? openByAgent.get(agentFallback) ?? 0 : 0);
      const available = Math.max(0, total - reserved);
      const deliveredUnits = (assignmentKey ? deliveredByAgent.get(assignmentKey) ?? 0 : 0)
        + (agentFallback && agentFallback !== assignmentKey ? deliveredByAgent.get(agentFallback) ?? 0 : 0);
      const dailySales = deliveredUnits / Math.max(1, windowDays);
      const coverDays = dailySales > 0 ? available / dailySales : Number.POSITIVE_INFINITY;
      const value = visibleStocks.reduce((sum, stock) =>
        sum + Math.max(0, stock.quantity) * (priceById.get(stock.productId) ?? 0), 0);
      const lines = visibleStocks
        .filter((stock) => stock.quantity > 0)
        .map((stock) => ({ name: nameById.get(stock.productId) ?? stock.productId, units: Math.max(0, stock.quantity) }))
        .sort((a, b) => b.units - a.units);
      const status: StockStatus = total === 0 && reserved > 0 ? "Critical"
        : statusFor(coverDays, dailySales > 0, criticalDays, watchDays);
      const transitKey = hub.locationId || agentKey || norm(hub.agentName);
      const incoming = (transitByAgent.get(transitKey) ?? 0)
        + (agentFallback && agentFallback !== transitKey ? transitByAgent.get(agentFallback) ?? 0 : 0);
      return {
        key: hub.locationId ?? `${hub.agentId ?? hub.agentName}::${hub.state}::${hub.city ?? ""}`,
        agentId: hub.agentId ?? "",
        locationId: hub.locationId ?? "",
        name: hub.agentName,
        phone: hub.agentPhone ?? "",
        state: hub.state,
        city: hub.city ?? "",
        active: hub.active !== false,
        joinedAt: hub.joinedAt ?? "",
        lastCountAt: hub.lastCountAt ?? "",
        productCount: lines.length,
        total, reserved, available,
        inTransit: incoming || transitByAgent.get(norm(hub.agentName)) || 0,
        dailySales,
        coverDays,
        value, status, lines
      };
    }).sort((a, b) => b.total - a.total);
  }, [products, stateHubs, orders, waybills, windowDays, criticalDays, watchDays, categoryFilter]);

  const states = Array.from(new Set(rows.map((row) => row.state))).sort();
  const categories = Array.from(new Set(products.map((product) => product.category ?? "Uncategorised"))).sort();
  const visible = rows.filter((row) => {
    const needle = search.trim().toLowerCase();
    if (needle && !`${row.name} ${row.state} ${row.city}`.toLowerCase().includes(needle)) return false;
    if (stateFilter !== "all" && row.state !== stateFilter) return false;
    if (statusFilter !== "all" && row.status !== statusFilter) return false;
    if (lowOnly && row.status !== "Critical" && row.status !== "Restock Soon") return false;
    return true;
  });
  const selected = rows.find((row) => row.key === selectedKey) ?? null;

  const displayDate = (value: string) => {
    const date = value ? new Date(value) : null;
    return date && Number.isFinite(date.getTime())
      ? date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
      : "Never";
  };
  const nextCountDate = (value: string) => {
    const date = value ? new Date(value) : null;
    if (!date || !Number.isFinite(date.getTime())) return "Start a stock count";
    date.setDate(date.getDate() + 7);
    return displayDate(date.toISOString());
  };
  const messageSelectedAgent = () => {
    if (!selected?.phone) return;
    const raw = selected.phone.replace(/\D/g, "");
    const phone = raw.startsWith("0") ? `234${raw.slice(1)}` : raw;
    window.open(`https://wa.me/${phone}`, "_blank", "noopener,noreferrer");
  };

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
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div><h1 className="m-0 text-2xl font-bold text-gray-950">Stock by Agent</h1>
        <p className="m-0 mt-0.5 text-sm text-gray-500">Exact assigned reservations and {windowDays}-day delivered demand by agent hub.</p></div>
        <div className="flex flex-wrap items-center gap-2">
        <label className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-bold text-gray-700"><CalendarDays className="h-4 w-4 text-blue-600" /><select className="!min-h-0 border-0 bg-transparent p-0 outline-none" value={windowDays} onChange={(event) => setWindowDays(Number(event.target.value))}><option value={7}>Last 7 days</option><option value={14}>Last 14 days</option><option value={30}>Last 30 days</option></select></label>
        <button className="!min-h-0 inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-bold text-gray-700"
          onClick={() => downloadCsv("stock-by-agent.csv", visible.map((row) => ({ Agent: row.name, State: row.state, Area: row.city, Products: row.productCount, Stock: row.total, Available: row.available, Reserved: row.reserved, "In transit": row.inTransit, "Daily sales": Math.round(row.dailySales * 10) / 10, "Days cover": Number.isFinite(row.coverDays) ? Math.round(row.coverDays * 10) / 10 : "-", Value: row.value, Status: row.status })))}>
          <Download className="h-4 w-4" /> Export
        </button>
        </div>
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
            <select className="!min-h-0 rounded-lg border border-gray-200 px-3 py-2 text-sm" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
              <option value="all">All Categories</option>{categories.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
            <select className="!min-h-0 rounded-lg border border-gray-200 px-3 py-2 text-sm" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="all">All Status</option><option>Healthy</option><option>Watch</option><option>Restock Soon</option><option>Critical</option><option>No Data</option>
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
            Showing {visible.length} of {rows.length} agent hubs · Reserved includes only orders explicitly assigned to that agent. Unassigned state demand stays at state/network level.
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
                    ["Status", selected.active ? "Active" : "Inactive"],
                    ["Joined on", displayDate(selected.joinedAt)],
                    ["Products held", String(selected.productCount)],
                    ["Total stock", num(selected.total)],
                    ["Available", num(selected.available)],
                    ["Avg. daily sales", `${Math.round(selected.dailySales * 10) / 10}`],
                    ["Days cover", Number.isFinite(selected.coverDays) ? `${Math.round(selected.coverDays * 10) / 10} days` : "No recent assigned sales"],
                    ["Stock value", money(selected.value)]
                  ] as Array<[string, string]>).map(([label, value]) => (
                    <div key={label} className="flex items-center justify-between gap-3 border-b border-gray-50 pb-1.5">
                      <dt className="shrink-0 text-gray-500">{label}</dt>
                      <dd className="m-0 min-w-0 truncate text-right font-bold text-gray-900">{value}</dd>
                    </div>
                  ))}
                </dl>
                {selected.agentId && onOpenAgent ? (
                  <button type="button" className="!min-h-0 mt-3 w-full rounded-lg border border-blue-200 px-3 py-2 text-sm font-bold text-blue-700 hover:bg-blue-50" onClick={() => onOpenAgent(selected.agentId)}>
                    View agent profile
                  </button>
                ) : null}
              </section>
              <section className="rounded-xl border border-gray-200 bg-white p-4">
                <h2 className="m-0 text-sm font-bold text-gray-900">Stock Count Schedule</h2>
                <dl className="mt-3 space-y-2 text-sm">
                  <div className="flex items-center justify-between gap-3"><dt className="text-gray-500">Last stock count</dt><dd className="m-0 text-right font-bold text-gray-900">{displayDate(selected.lastCountAt)}</dd></div>
                  <div className="flex items-center justify-between gap-3"><dt className="text-gray-500">Next count due</dt><dd className="m-0 text-right font-bold text-gray-900">{nextCountDate(selected.lastCountAt)}</dd></div>
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
              <section className="rounded-xl border border-gray-200 bg-white p-4">
                <h2 className="m-0 text-sm font-bold text-gray-900">Quick Actions</h2>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {([
                    ["Transfer Stock", ArrowLeftRight, () => onAction("create-transfer"), canManage],
                    ["Request Stock", PackageSearch, () => onAction("recommended-transfers"), canManage],
                    ["Stock Count", ClipboardCheck, () => onAction("create-count"), canManage],
                    ["View History", History, () => selected.agentId && onViewAgentHistory ? onViewAgentHistory(selected.agentId) : onAction("movements"), true],
                    ["Update Info", UserCog, () => selected.agentId && onEditAgent?.(selected.agentId), canManage && Boolean(selected.agentId && onEditAgent)],
                    ["Message Agent", MessageCircle, messageSelectedAgent, Boolean(selected.phone)],
                  ] as Array<[string, typeof ArrowLeftRight, () => void, boolean]>).map(([label, Icon, action, enabled]) => (
                    <button key={label} type="button" disabled={!enabled} onClick={action}
                      className="!min-h-0 flex min-h-[72px] flex-col items-center justify-center gap-1 rounded-lg border border-gray-200 px-2 py-2 text-center text-xs font-bold text-gray-700 hover:border-blue-200 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-40">
                      <Icon className="h-4 w-4 text-blue-600" />
                      <span>{label}</span>
                    </button>
                  ))}
                </div>
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
