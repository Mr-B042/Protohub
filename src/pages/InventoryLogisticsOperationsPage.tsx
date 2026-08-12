import { useMemo, useState } from "react";
import InventoryOpsStockByProduct from "./InventoryOpsStockByProduct";
import {
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  BarChart3,
  Box,
  Boxes,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  Filter,
  MapPin,
  PackageCheck,
  RefreshCw,
  Search,
  ShieldCheck,
  Truck,
  Users,
  Warehouse,
  WalletCards,
} from "lucide-react";

export type InventoryOperationsAction =
  | "dashboard"
  | "stock-products"
  | "stock-states"
  | "stock-agents"
  | "coverage"
  | "forecast"
  | "recommended-transfers"
  | "transfers"
  | "dispatch"
  | "waybills"
  | "shipments"
  | "receiving"
  | "carriers"
  | "expenses"
  | "movements"
  | "counts"
  | "discrepancies"
  | "alerts"
  | "reports"
  | "settings"
  | "create-transfer"
  | "create-waybill"
  | "create-count"
  | "create-expense";

export type OpsProduct = {
  id: string;
  name: string;
  warehouseStock: number;
  agentStock: number;
  reorderPoint: number;
};

export type OpsStateHub = {
  state: string;
  agentName: string;
  stocks: Array<{ productId: string; quantity: number }>;
};

export type OpsOrder = {
  productId?: string;
  productName?: string;
  state?: string;
  location?: string;
  quantity: number;
  status?: string;
  createdAt?: string;
};

export type OpsWaybill = {
  id: string;
  productName: string;
  quantity: number;
  items?: Array<{ productName: string; quantity: number }>;
  fee: number;
  carrier: string;
  from: string;
  to: string;
  dateSent: string;
  dateReceived?: string;
  status: string;
};

export type OpsExpense = { type: string; amount: number; date: string };
export type OpsDiscrepancy = {
  id: string;
  productName: string;
  agentName: string;
  variance: number;
  status: string;
};

type Props = {
  /** Which sub-page to render. The sidebar already tracks this; before now it
   *  was only styling the nav while every section fell back to the dashboard. */
  section?: InventoryOperationsAction;
  lookbackDays?: number;
  criticalDays?: number;
  watchDays?: number;
  products: OpsProduct[];
  stateHubs: OpsStateHub[];
  orders: OpsOrder[];
  waybills: OpsWaybill[];
  expenses: OpsExpense[];
  discrepancies: OpsDiscrepancy[];
  activeAgentCount: number;
  canManage: boolean;
  onAction: (action: InventoryOperationsAction) => void;
};

const money = (value: number) => `₦${Math.round(value).toLocaleString("en-NG")}`;
const number = (value: number) => Math.max(0, Math.round(value)).toLocaleString("en-NG");
const normalized = (value: string | undefined) => String(value ?? "").trim().toLowerCase();
const validDate = (value: string | undefined) => {
  const date = value ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? date : null;
};

const WORKFLOW_STEPS: Array<{ label: string; icon: typeof BarChart3 }> = [
  { label: "Demand Detected", icon: BarChart3 },
  { label: "Check Stock", icon: Search },
  { label: "Plan Movement", icon: ClipboardCheck },
  { label: "Assign Carrier", icon: Truck },
  { label: "Create Waybill", icon: Box },
  { label: "Pickup", icon: PackageCheck },
  { label: "In Transit", icon: RefreshCw },
  { label: "Receive & Confirm", icon: CheckCircle2 },
  { label: "Reconcile", icon: BadgeCheck },
];
const dayDiff = (later: Date, earlier: Date) => Math.max(0, (later.getTime() - earlier.getTime()) / 86_400_000);

const stockStatus = (days: number) => {
  if (days < 1) return { label: "Critical", tone: "rose" as const };
  if (days < 3) return { label: "Restock Soon", tone: "orange" as const };
  if (days < 7) return { label: "Watch", tone: "amber" as const };
  return { label: "Healthy", tone: "emerald" as const };
};

const statusClasses = {
  rose: "bg-rose-50 text-rose-700 border-rose-200",
  orange: "bg-orange-50 text-orange-700 border-orange-200",
  amber: "bg-amber-50 text-amber-700 border-amber-200",
  emerald: "bg-emerald-50 text-emerald-700 border-emerald-200",
  blue: "bg-blue-50 text-blue-700 border-blue-200",
  violet: "bg-violet-50 text-violet-700 border-violet-200",
  gray: "bg-gray-50 text-gray-600 border-gray-200",
};

function StatusPill({ label, tone }: { label: string; tone: keyof typeof statusClasses }) {
  return <span className={`inline-flex items-center rounded-full border px-2 py-1 text-[11px] font-bold ${statusClasses[tone]}`}>{label}</span>;
}

function EmptyRow({ columns, text }: { columns: number; text: string }) {
  return <tr><td colSpan={columns} className="px-4 py-8 text-center text-sm text-gray-400">{text}</td></tr>;
}

export function InventoryLogisticsOperationsPage({
  section = "dashboard",
  lookbackDays = 7,
  criticalDays = 3,
  watchDays = 7,
  products,
  stateHubs,
  orders,
  waybills,
  expenses,
  discrepancies,
  activeAgentCount,
  canManage,
  onAction,
}: Props) {
  const [showFilters, setShowFilters] = useState(false);
  const [riskFilter, setRiskFilter] = useState<"all" | "risk" | "transit">("all");
  // Sub-pages render in place. Hooks above must run first, so this returns
  // after them rather than before - a section switch must never change how many
  // hooks this component calls.
  const [query, setQuery] = useState("");

  const model = useMemo(() => {
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 86_400_000);
    const activeOrders = orders.filter((order) => !["cancelled", "failed"].includes(normalized(order.status)));
    const weeklyOrders = activeOrders.filter((order) => {
      const date = validDate(order.createdAt);
      return date ? date >= weekAgo && date <= now : false;
    });
    const weeklyDemandByProduct = new Map<string, number>();
    weeklyOrders.forEach((order) => {
      const key = order.productId || normalized(order.productName);
      weeklyDemandByProduct.set(key, (weeklyDemandByProduct.get(key) ?? 0) + Math.max(1, order.quantity));
    });

    const productRows = products.map((product) => {
      const totalStock = Math.max(0, product.warehouseStock) + Math.max(0, product.agentStock);
      const weeklyDemand = weeklyDemandByProduct.get(product.id) ?? weeklyDemandByProduct.get(normalized(product.name)) ?? 0;
      const dailyDemand = weeklyDemand / 7;
      const coverDays = dailyDemand > 0 ? totalStock / dailyDemand : totalStock > 0 ? 30 : 0;
      return { ...product, totalStock, weeklyDemand, coverDays, status: stockStatus(coverDays) };
    }).sort((a, b) => b.totalStock - a.totalStock);

    const stateMap = new Map<string, { state: string; agents: Set<string>; stock: number; byProduct: Map<string, number> }>();
    stateHubs.forEach((hub) => {
      const state = hub.state.trim() || "Unassigned";
      const key = normalized(state);
      const current = stateMap.get(key) ?? { state, agents: new Set<string>(), stock: 0, byProduct: new Map<string, number>() };
      current.agents.add(hub.agentName);
      hub.stocks.forEach((stock) => {
        const qty = Math.max(0, stock.quantity);
        current.stock += qty;
        current.byProduct.set(stock.productId, (current.byProduct.get(stock.productId) ?? 0) + qty);
      });
      stateMap.set(key, current);
    });
    const stateRows = Array.from(stateMap.values()).map((row) => {
      const weeklyDemand = weeklyOrders
        .filter((order) => normalized(order.state || order.location) === normalized(row.state))
        .reduce((sum, order) => sum + Math.max(1, order.quantity), 0);
      const coverDays = weeklyDemand > 0 ? row.stock / (weeklyDemand / 7) : row.stock > 0 ? 30 : 0;
      const risks = productRows
        .filter((product) => {
          const stateQty = row.byProduct.get(product.id) ?? 0;
          const stateDemand = weeklyOrders
            .filter((order) => normalized(order.state || order.location) === normalized(row.state) && (order.productId === product.id || normalized(order.productName) === normalized(product.name)))
            .reduce((sum, order) => sum + Math.max(1, order.quantity), 0);
          return stateDemand > 0 && stateQty / (stateDemand / 7) < 3;
        })
        .map((product) => product.name);
      return { ...row, agents: Array.from(row.agents), weeklyDemand, coverDays, risks, status: stockStatus(coverDays) };
    }).sort((a, b) => a.coverDays - b.coverDays || a.stock - b.stock);

    const totalStock = productRows.reduce((sum, row) => sum + row.totalStock, 0);
    const warehouseStock = productRows.reduce((sum, row) => sum + Math.max(0, row.warehouseStock), 0);
    const agentStock = productRows.reduce((sum, row) => sum + Math.max(0, row.agentStock), 0);
    const weeklyDemand = productRows.reduce((sum, row) => sum + row.weeklyDemand, 0);
    const overallCover = weeklyDemand > 0 ? totalStock / (weeklyDemand / 7) : totalStock > 0 ? 30 : 0;
    const inTransit = waybills.filter((waybill) => normalized(waybill.status) === "in transit");
    const receivedThisWeek = waybills.filter((waybill) => {
      const received = validDate(waybill.dateReceived);
      return normalized(waybill.status) === "received" && received && received >= weekAgo;
    });
    const shipmentsThisWeek = waybills.filter((waybill) => {
      const sent = validDate(waybill.dateSent);
      return sent && sent >= weekAgo;
    });
    const inTransitUnits = inTransit.reduce((sum, row) => sum + Math.max(0, row.quantity), 0);
    const awaitingDispatch = waybills.filter((row) => ["pending", "awaiting dispatch", "assigned"].includes(normalized(row.status)));
    const logisticsSpend = expenses
      .filter((expense) => {
        const date = validDate(expense.date);
        return date && date >= weekAgo && /waybill|delivery|clearing|shipping|logistics/i.test(expense.type);
      })
      .reduce((sum, expense) => sum + Math.max(0, expense.amount), 0);
    const completedTransitDays = receivedThisWeek.flatMap((row) => {
      const sent = validDate(row.dateSent);
      const received = validDate(row.dateReceived);
      return sent && received ? [dayDiff(received, sent)] : [];
    });
    const averageTransitDays = completedTransitDays.length > 0
      ? completedTransitDays.reduce((sum, value) => sum + value, 0) / completedTransitDays.length
      : 0;
    const onTime = completedTransitDays.length > 0
      ? Math.round((completedTransitDays.filter((days) => days <= 3).length / completedTransitDays.length) * 100)
      : 0;
    const delayed = inTransit.filter((row) => {
      const sent = validDate(row.dateSent);
      return sent ? dayDiff(now, sent) > 3 : false;
    });
    const criticalStates = stateRows.filter((row) => row.coverDays < 3);

    const health = productRows.reduce((acc, row) => {
      const key = row.status.label;
      acc[key] = (acc[key] ?? 0) + row.totalStock;
      return acc;
    }, {} as Record<string, number>);

    return {
      now,
      productRows,
      stateRows,
      totalStock,
      warehouseStock,
      agentStock,
      overallCover,
      inTransit,
      inTransitUnits,
      awaitingDispatch,
      logisticsSpend,
      shipmentsThisWeek,
      receivedThisWeek,
      averageTransitDays,
      onTime,
      delayed,
      criticalStates,
      health,
    };
  }, [products, stateHubs, orders, waybills, expenses]);

  const healthRows = [
    { label: "Healthy", helper: "7+ days", value: model.health.Healthy ?? 0, color: "#10b981" },
    { label: "Watch", helper: "3-7 days", value: model.health.Watch ?? 0, color: "#f59e0b" },
    { label: "Restock Soon", helper: "1-3 days", value: model.health["Restock Soon"] ?? 0, color: "#f97316" },
    { label: "Critical", helper: "<1 day", value: model.health.Critical ?? 0, color: "#ef4444" },
  ];
  let turn = 0;
  const donutStops = healthRows.map((row) => {
    const start = turn;
    turn += model.totalStock > 0 ? (row.value / model.totalStock) * 100 : 0;
    return `${row.color} ${start}% ${turn}%`;
  }).join(", ");
  const weekLabel = `${new Date(model.now.getTime() - 6 * 86_400_000).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })} - ${model.now.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}`;
  const productCount = products.filter((product) => product.warehouseStock + product.agentStock > 0).length;
  const q = normalized(query);
  const topProducts = model.productRows.filter((row) => !q || normalized(row.name).includes(q)).slice(0, 5);
  const visibleStates = model.stateRows.filter((row) => riskFilter !== "risk" || row.coverDays < 3).slice(0, 5);
  const visibleWaybills = (riskFilter === "transit" ? model.inTransit : waybills)
    .filter((row) => !q || normalized(`${row.id} ${row.productName} ${row.carrier} ${row.from} ${row.to}`).includes(q))
    .slice(0, 5);
  const openDiscrepancies = discrepancies.filter((row) => normalized(row.status) === "discrepancy");
  const primaryRisk = model.criticalStates[0];
  const primaryProductRisk = model.productRows.find((row) => row.coverDays < 3);
  const primaryDelayed = model.delayed[0];
  const primaryDiscrepancy = openDiscrepancies[0];

  const metrics = [
    { label: "Total Stock in Network", value: number(model.totalStock), helper: `Across ${model.stateRows.length} states`, icon: Boxes, tone: "blue" },
    { label: "Warehouse Stock", value: number(model.warehouseStock), helper: `${productCount} products`, icon: Warehouse, tone: "emerald" },
    { label: "Stock with Agents", value: number(model.agentStock), helper: `${activeAgentCount} active agents`, icon: Users, tone: "teal" },
    { label: "In Transit", value: number(model.inTransitUnits), helper: `${model.inTransit.length} shipments`, icon: Truck, tone: "orange" },
    { label: "Awaiting Dispatch", value: number(model.awaitingDispatch.length), helper: "Transfers", icon: Clock3, tone: "violet" },
    { label: "Critical (< 3 Days)", value: number(model.criticalStates.length), helper: "States at risk", icon: AlertTriangle, tone: "rose" },
    { label: "Overall Coverage", value: `${model.overallCover.toFixed(1)} Days`, helper: "Average stock cover", icon: ShieldCheck, tone: "blue" },
    { label: "Logistics Spend", value: money(model.logisticsSpend), helper: "This week", icon: WalletCards, tone: "amber" },
  ] as const;

  if (section === "stock-products") {
    return (
      <InventoryOpsStockByProduct
        products={products}
        stateHubs={stateHubs}
        orders={orders}
        waybills={waybills}
        lookbackDays={lookbackDays}
        criticalDays={criticalDays}
        watchDays={watchDays}
      />
    );
  }

  return (
    <div className="space-y-5 pb-8 text-gray-900" data-testid="inventory-logistics-operations-page">
      <header className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-950">Inventory &amp; Logistics Operations</h1>
          <p className="mt-1 text-sm text-gray-500">Unified view of inventory, movements, shipments and stock performance.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700 shadow-sm">
            <CalendarDays className="h-4 w-4 text-blue-600" /> {weekLabel}
          </div>
          <button type="button" onClick={() => setShowFilters((value) => !value)} className="!min-h-0 inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700 shadow-sm hover:bg-gray-50">
            <Filter className="h-4 w-4" /> Filters
          </button>
        </div>
      </header>

      {showFilters && (
        <section className="flex flex-col gap-3 rounded-lg border border-blue-100 bg-blue-50/50 p-3 sm:flex-row sm:items-center" aria-label="Operations filters">
          <label className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search product, waybill, carrier or state" className="w-full rounded-lg border border-gray-200 bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-blue-400" />
          </label>
          <div className="inline-flex rounded-lg border border-gray-200 bg-white p-1">
            {([['all', 'All operations'], ['risk', 'Stock at risk'], ['transit', 'In transit']] as const).map(([key, label]) => (
              <button key={key} type="button" onClick={() => setRiskFilter(key)} className={`!min-h-0 rounded-md px-3 py-1.5 text-xs font-bold ${riskFilter === key ? "bg-blue-600 text-white" : "text-gray-600 hover:bg-gray-50"}`}>{label}</button>
            ))}
          </div>
        </section>
      )}

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4 2xl:grid-cols-8" aria-label="Inventory operations summary">
        {metrics.map((metric) => {
          const Icon = metric.icon;
          const iconTone = metric.tone === "rose" ? "bg-rose-50 text-rose-600" : metric.tone === "orange" ? "bg-orange-50 text-orange-600" : metric.tone === "violet" ? "bg-violet-50 text-violet-600" : metric.tone === "amber" ? "bg-amber-50 text-amber-600" : metric.tone === "emerald" ? "bg-emerald-50 text-emerald-600" : metric.tone === "teal" ? "bg-teal-50 text-teal-600" : "bg-blue-50 text-blue-600";
          return (
            <article key={metric.label} className="min-w-0 rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
              <span className={`mb-3 inline-flex h-9 w-9 items-center justify-center rounded-lg ${iconTone}`}><Icon className="h-5 w-5" /></span>
              <p className="text-[11px] font-semibold leading-4 text-gray-500">{metric.label}</p>
              <strong className="mt-1 block break-words text-xl font-black text-gray-950">{metric.value}</strong>
              <span className="mt-1 block text-[11px] text-gray-400">{metric.helper}</span>
            </article>
          );
        })}
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.05fr_1.15fr_1.25fr]">
        <article className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-bold">Stock Health by Status <span className="font-normal text-gray-400">(Units)</span></h2>
          <div className="mt-5 grid grid-cols-[130px_1fr] items-center gap-4">
            <div className="relative h-28 w-28 rounded-full" style={{ background: model.totalStock > 0 ? `conic-gradient(${donutStops})` : "#e5e7eb" }}>
              <div className="absolute inset-[18px] flex flex-col items-center justify-center rounded-full bg-white">
                <strong className="text-xl">{number(model.totalStock)}</strong><span className="text-[10px] text-gray-400">Total Units</span>
              </div>
            </div>
            <div className="divide-y divide-gray-100">
              {healthRows.map((row) => <div key={row.label} className="flex items-center justify-between gap-3 py-2 text-xs"><span className="flex min-w-0 items-center gap-2"><i className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: row.color }} /><span className="truncate">{row.label} <span className="text-gray-400">({row.helper})</span></span></span><b>{number(row.value)}</b></div>)}
            </div>
          </div>
          <button type="button" onClick={() => onAction("forecast")} className="!min-h-0 mt-4 inline-flex items-center gap-1 text-xs font-bold text-blue-600 hover:underline">View full breakdown <ArrowRight className="h-3.5 w-3.5" /></button>
        </article>

        <article className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3"><h2 className="text-sm font-bold">Top Products <span className="font-normal text-gray-400">by Units in Network</span></h2><button type="button" onClick={() => onAction("stock-products")} className="!min-h-0 text-xs font-bold text-blue-600 hover:underline">View all products →</button></div>
          <div className="overflow-x-auto"><table className="w-full min-w-[470px] text-xs"><thead className="bg-gray-50 text-left text-[10px] text-gray-500"><tr><th className="px-4 py-2">PRODUCT</th><th className="px-3 py-2">TOTAL STOCK</th><th className="px-3 py-2">COVER</th><th className="px-3 py-2">STATUS</th></tr></thead><tbody className="divide-y divide-gray-100">{topProducts.length === 0 ? <EmptyRow columns={4} text="No stock products found." /> : topProducts.map((row) => <tr key={row.id}><td className="px-4 py-3 font-semibold">{row.name}</td><td className="px-3 py-3 font-bold">{number(row.totalStock)}</td><td className="px-3 py-3">{row.coverDays.toFixed(1)} days</td><td className="px-3 py-3"><StatusPill label={row.status.label} tone={row.status.tone} /></td></tr>)}</tbody></table></div>
        </article>

        <article className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between"><h2 className="text-sm font-bold">Logistics Performance <span className="font-normal text-gray-400">(This Week)</span></h2><button type="button" onClick={() => onAction("reports")} className="!min-h-0 text-xs font-bold text-blue-600 hover:underline">View full performance →</button></div>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {[
              ["Shipments", number(model.shipmentsThisWeek.length), "Sent this week"],
              ["Delivered", number(model.receivedThisWeek.length), "Received this week"],
              ["On-time Delivery", `${model.onTime}%`, model.receivedThisWeek.length ? "Within 3 days" : "No completed trips"],
              ["Avg. Pickup Time", "Not captured", "Start capturing pickup"],
              ["Avg. Transit Time", `${model.averageTransitDays.toFixed(1)} Days`, model.receivedThisWeek.length ? "Actual completed trips" : "No completed trips"],
              ["Logistics Spend", money(model.logisticsSpend), "Recorded this week"],
            ].map(([label, value, helper]) => <div key={label} className="min-w-0 rounded-lg border border-gray-100 bg-gray-50 p-3"><span className="text-[10px] font-semibold text-gray-500">{label}</span><strong className="mt-1 block break-words text-base text-gray-950">{value}</strong><small className="mt-1 block text-[10px] text-gray-400">{helper}</small></div>)}
          </div>
        </article>
      </section>

      <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <div><h2 className="text-sm font-bold">What needs your attention today?</h2><p className="mt-1 text-xs text-gray-400">Recommended actions based on stock levels, demand, shipment status and reconciliation.</p></div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
          <article className="rounded-lg border border-rose-200 bg-rose-50 p-3"><StatusPill label="Critical" tone="rose" /><h3 className="mt-3 text-sm font-bold">{primaryRisk?.state ?? "No critical state"}</h3><p className="mt-1 text-xs text-gray-600">{primaryProductRisk?.name ?? "Stock coverage is currently healthy"}</p><p className="mt-2 text-xs font-semibold text-rose-700">{primaryRisk ? `${primaryRisk.coverDays.toFixed(1)} days cover left` : "No urgent transfer needed"}</p><button disabled={!canManage || !primaryRisk} type="button" onClick={() => onAction("create-transfer")} className="!min-h-0 mt-3 w-full rounded-md border border-rose-200 bg-white px-2 py-1.5 text-xs font-bold text-rose-700 disabled:opacity-40">Create Transfer</button></article>
          <article className="rounded-lg border border-amber-200 bg-amber-50 p-3"><StatusPill label="Internal Transfer" tone="amber" /><h3 className="mt-3 text-sm font-bold">Balance agent stock</h3><p className="mt-1 text-xs text-gray-600">Move stock from stronger coverage to the weakest state hub.</p><p className="mt-2 text-xs font-semibold text-amber-700">{model.criticalStates.length} states need review</p><button disabled={!canManage} type="button" onClick={() => onAction("transfers")} className="!min-h-0 mt-3 w-full rounded-md border border-amber-200 bg-white px-2 py-1.5 text-xs font-bold text-amber-700 disabled:opacity-40">Transfer Now</button></article>
          <article className="rounded-lg border border-orange-200 bg-orange-50 p-3"><StatusPill label="State Replenish" tone="orange" /><h3 className="mt-3 text-sm font-bold">Warehouse → {primaryRisk?.state ?? "State"}</h3><p className="mt-1 text-xs text-gray-600">{model.warehouseStock > 0 ? `${number(model.warehouseStock)} warehouse units available` : "Warehouse stock needs replenishment"}</p><p className="mt-2 text-xs font-semibold text-orange-700">Assign stock and carrier</p><button disabled={!canManage} type="button" onClick={() => onAction("create-waybill")} className="!min-h-0 mt-3 w-full rounded-md border border-orange-200 bg-white px-2 py-1.5 text-xs font-bold text-orange-700 disabled:opacity-40">Assign Carrier</button></article>
          <article className="rounded-lg border border-rose-200 bg-rose-50 p-3"><StatusPill label="Delayed Shipment" tone="rose" /><h3 className="mt-3 text-sm font-bold">{primaryDelayed?.id ?? "No delayed shipment"}</h3><p className="mt-1 text-xs text-gray-600">{primaryDelayed ? `${primaryDelayed.carrier} · ${primaryDelayed.to}` : "All active shipments are within target"}</p><p className="mt-2 text-xs font-semibold text-rose-700">{primaryDelayed ? `Sent ${primaryDelayed.dateSent}` : "No overdue route"}</p><button type="button" onClick={() => onAction("shipments")} className="!min-h-0 mt-3 w-full rounded-md border border-rose-200 bg-white px-2 py-1.5 text-xs font-bold text-rose-700">Review Shipment</button></article>
          <article className="rounded-lg border border-violet-200 bg-violet-50 p-3"><StatusPill label="Discrepancy" tone="violet" /><h3 className="mt-3 text-sm font-bold">{primaryDiscrepancy?.agentName ?? "No open discrepancy"}</h3><p className="mt-1 text-xs text-gray-600">{primaryDiscrepancy?.productName ?? "Counts reconcile correctly"}</p><p className="mt-2 text-xs font-semibold text-violet-700">{primaryDiscrepancy ? `${Math.abs(primaryDiscrepancy.variance)} units difference` : "No missing units"}</p><button type="button" onClick={() => onAction("discrepancies")} className="!min-h-0 mt-3 w-full rounded-md border border-violet-200 bg-white px-2 py-1.5 text-xs font-bold text-violet-700">Resolve</button></article>
          <button type="button" onClick={() => onAction("alerts")} className="!min-h-0 flex min-h-[190px] flex-col items-center justify-center rounded-lg border border-dashed border-blue-300 bg-blue-50/40 p-3 text-center text-sm font-bold text-blue-700"><AlertTriangle className="mb-3 h-6 w-6" />View all alerts<span className="mt-2 text-xs font-normal text-blue-500">See all inventory and logistics alerts</span><ArrowRight className="mt-3 h-5 w-5" /></button>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-3">
        <article className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm"><div className="flex items-center justify-between border-b border-gray-100 px-4 py-3"><h2 className="text-sm font-bold">Low Stock States</h2><button type="button" onClick={() => onAction("stock-states")} className="!min-h-0 text-xs font-bold text-blue-600">View all states →</button></div><div className="overflow-x-auto"><table className="w-full min-w-[470px] text-xs"><thead className="bg-gray-50 text-left text-[10px] text-gray-500"><tr><th className="px-4 py-2">STATE</th><th className="px-3 py-2">PRODUCTS AT RISK</th><th className="px-3 py-2">DAYS COVER</th><th className="px-3 py-2">STATUS</th></tr></thead><tbody className="divide-y divide-gray-100">{visibleStates.length === 0 ? <EmptyRow columns={4} text="No state hubs have stock data yet." /> : visibleStates.map((row) => <tr key={row.state}><td className="px-4 py-3"><span className="inline-flex items-center gap-1.5 font-semibold"><MapPin className="h-3.5 w-3.5 text-gray-400" />{row.state}</span></td><td className="px-3 py-3">{row.risks.length}</td><td className="px-3 py-3">{row.coverDays.toFixed(1)}</td><td className="px-3 py-3"><StatusPill label={row.status.label} tone={row.status.tone} /></td></tr>)}</tbody></table></div></article>

        <article className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm"><div className="flex items-center justify-between border-b border-gray-100 px-4 py-3"><h2 className="text-sm font-bold">Recent Transfers</h2><button type="button" onClick={() => onAction("transfers")} className="!min-h-0 text-xs font-bold text-blue-600">View all transfers →</button></div><div className="overflow-x-auto"><table className="w-full min-w-[500px] text-xs"><thead className="bg-gray-50 text-left text-[10px] text-gray-500"><tr><th className="px-4 py-2">TRANSFER ID</th><th className="px-3 py-2">FROM</th><th className="px-3 py-2">TO</th><th className="px-3 py-2">UNITS</th><th className="px-3 py-2">STATUS</th></tr></thead><tbody className="divide-y divide-gray-100">{visibleWaybills.length === 0 ? <EmptyRow columns={5} text="No transfers recorded yet." /> : visibleWaybills.map((row) => <tr key={row.id}><td className="px-4 py-3 font-bold text-blue-600">{row.id}</td><td className="px-3 py-3">{row.from}</td><td className="px-3 py-3">{row.to}</td><td className="px-3 py-3 font-semibold">{number(row.quantity)}</td><td className="px-3 py-3"><StatusPill label={row.status} tone={normalized(row.status) === "received" ? "emerald" : normalized(row.status) === "in transit" ? "blue" : "gray"} /></td></tr>)}</tbody></table></div></article>

        <article className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm"><div className="flex items-center justify-between border-b border-gray-100 px-4 py-3"><h2 className="text-sm font-bold">Active Shipments</h2><button type="button" onClick={() => onAction("shipments")} className="!min-h-0 text-xs font-bold text-blue-600">View all shipments →</button></div><div className="overflow-x-auto"><table className="w-full min-w-[500px] text-xs"><thead className="bg-gray-50 text-left text-[10px] text-gray-500"><tr><th className="px-4 py-2">WAYBILL</th><th className="px-3 py-2">CARRIER</th><th className="px-3 py-2">ROUTE</th><th className="px-3 py-2">TARGET</th><th className="px-3 py-2">STATUS</th></tr></thead><tbody className="divide-y divide-gray-100">{model.inTransit.length === 0 ? <EmptyRow columns={5} text="No shipments are currently in transit." /> : model.inTransit.slice(0, 5).map((row) => { const sent = validDate(row.dateSent); const target = sent ? new Date(sent.getTime() + 3 * 86_400_000).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }) : "-"; return <tr key={row.id}><td className="px-4 py-3 font-bold text-blue-600">{row.id}</td><td className="px-3 py-3">{row.carrier || "Unassigned"}</td><td className="px-3 py-3">{row.from} → {row.to}</td><td className="px-3 py-3">{target}</td><td className="px-3 py-3"><StatusPill label="In Transit" tone="blue" /></td></tr>; })}</tbody></table></div></article>
      </section>

      <section className="rounded-lg border border-blue-100 bg-blue-50/40 p-4 shadow-sm">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="min-w-0 flex-1"><h2 className="text-sm font-bold">Operations Workflow <span className="font-normal text-gray-500">(End-to-End)</span></h2><div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-5 xl:grid-cols-9">{WORKFLOW_STEPS.map(({ label, icon: Icon }, index) => <div key={label} className="relative flex min-w-0 flex-col items-center text-center"><span className="flex h-9 w-9 items-center justify-center rounded-lg border border-blue-100 bg-white text-blue-700"><Icon className="h-4 w-4" /></span><span className="mt-2 text-[10px] font-bold leading-4 text-gray-700">{label}</span>{index < WORKFLOW_STEPS.length - 1 && <ArrowRight className="absolute -right-2 top-3 hidden h-3 w-3 text-blue-300 xl:block" />}</div>)}</div></div>
          <div className="border-t border-blue-100 pt-4 text-xs text-gray-500 xl:w-48 xl:border-l xl:border-t-0 xl:pl-4 xl:pt-0"><p>Data uses live operational records and updates as movements are completed.</p><button type="button" onClick={() => onAction("reports")} className="!min-h-0 mt-3 inline-flex items-center gap-1 font-bold text-blue-600">Learn about workflow <ArrowRight className="h-3.5 w-3.5" /></button></div>
        </div>
      </section>
    </div>
  );
}
