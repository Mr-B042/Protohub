// State & Agent Replenishment Intelligence.
//
// The question this page answers is NOT "which state has stock" - the other
// four stock pages already answer that. It is:
//
//   Does the AGENT responsible for a ready customer have the units, and if not,
//   can another agent in that same state cover it before we ship anything in?
//
// Two ideas carry the whole screen, and both live in state-replenishment-model:
//
//   1. Stock sits with an agent, not a state. A state row is the sum of its
//      hubs plus "can they cover each other?", never a netted total.
//   2. Raw orders are not demand. Only Ready and Rescheduled - a rep-confirmed
//      customer or a real date - count as Actionable, and only Actionable moves
//      stock. Every other order is displayed and never acted on.
import { Fragment, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, ArrowLeftRight, ChevronDown, ChevronRight, CircleHelp, Download,
  FileText, Loader2, MapPin, Package, PackageCheck, Search, ShoppingCart,
  SlidersHorizontal, Sparkles, TrendingUp, Truck, Users, X
} from "lucide-react";
import type { OpsOrder, OpsProduct, OpsStateHub, OpsWaybill } from "./InventoryLogisticsOperationsPage";
import { downloadCsv, num } from "./inventory-ops-model";
import { naira } from "../lib/money-privacy";
import { NIGERIA_ZONES, type NigeriaZone } from "../lib/nigeria";
import { stateReplenishmentNotesApi, type StateReplenishmentNote } from "../lib/api";
import {
  AGENT_STATUS_TONE, DEMAND_TIER_META, DEMAND_TIER_ORDER, PRIORITY_TONE,
  buildProductReplenishmentRows, buildStateReplenishmentRows, donorsFor,
  internalDonorsFor, priorityRank, receivingPlanFor,
  type AgentPosition, type DemandTier, type ProductPosition, type ReplenishmentOrder,
  type ReplenishmentPriority, type StateReplenishmentRow
} from "./state-replenishment-model";

export type ReplenishmentTransferRequest = {
  productId?: string;
  quantity: number;
  toState?: string;
  toAgentId?: string;
  toAgentLocationId?: string;
  fromAgentId?: string;
  fromAgentLocationId?: string;
};

type Props = {
  products: OpsProduct[];
  stateHubs: OpsStateHub[];
  orders: OpsOrder[];
  waybills: OpsWaybill[];
  lookbackDays: number;
  canManage: boolean;
  onCreateTransfer?: (request: ReplenishmentTransferRequest) => void;
  onOpenOrders?: (search: string) => void;
  onOpenAgent?: (agentId: string) => void;
};

type Tab = "state" | "agent" | "product" | "forecast";
type SortKey = "priority" | "shortage" | "ready" | "stock" | "state";
type InlineTab = "agents" | "open" | "ready" | "transfer";
type ModalTab = "agents" | "orders" | "transfer" | "performance" | "notes";

const TABS: Array<{ key: Tab; label: string }> = [
  { key: "state", label: "State View" },
  { key: "agent", label: "Agent View" },
  { key: "product", label: "Product View" },
  { key: "forecast", label: "Demand Forecast" }
];

const PRIORITIES: ReplenishmentPriority[] = ["Critical", "High", "Medium", "Low", "Healthy"];

const RECOMMENDATION_TONE: Record<StateReplenishmentRow["recommendation"], string> = {
  "Replenish State": "text-rose-600",
  "Rebalance Agents": "text-orange-600",
  "Watch Demand": "text-amber-600",
  "No Action": "text-gray-400"
};

const signed = (value: number) => (value > 0 ? `+${num(value)}` : value < 0 ? `−${num(Math.abs(value))}` : "0");
const signedTone = (value: number) =>
  value < 0 ? "bg-rose-50 text-rose-700" : value > 0 ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-600";

const shortDate = (iso?: string) => {
  if (!iso) return "";
  const date = new Date(iso);
  return Number.isFinite(date.getTime())
    ? date.toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" })
    : "";
};
const dayAndDate = (iso?: string) => {
  if (!iso) return "";
  const date = new Date(iso);
  return Number.isFinite(date.getTime())
    ? date.toLocaleDateString("en-NG", { weekday: "short", day: "numeric", month: "short" })
    : "";
};
const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("") || "?";

/** The order's own readiness line - a date when a rep set one, else the label. */
const readinessLine = (order: ReplenishmentOrder) =>
  order.scheduledDate ? dayAndDate(order.scheduledDate) : order.tier === "very_high" ? "Ready now" : order.statusLabel;

function Donut({ slices, total, caption }: { slices: Array<{ value: number; color: string }>; total: number; caption: string }) {
  // Hand-drawn rather than pulled from a chart library: it is five numbers on
  // one ring, and the pages around this one deliberately carry no chart
  // dependency.
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  return (
    <svg viewBox="0 0 140 140" className="h-36 w-36 shrink-0" role="img" aria-label={`${total} ${caption}`}>
      <circle cx="70" cy="70" r={radius} fill="none" stroke="#f1f5f9" strokeWidth="18" />
      {total > 0 && slices.filter((slice) => slice.value > 0).map((slice, index) => {
        const length = (slice.value / total) * circumference;
        const dash = `${length} ${circumference - length}`;
        const element = (
          <circle key={index} cx="70" cy="70" r={radius} fill="none" stroke={slice.color} strokeWidth="18"
            strokeDasharray={dash} strokeDashoffset={-offset} transform="rotate(-90 70 70)" />
        );
        offset += length;
        return element;
      })}
      <text x="70" y="66" textAnchor="middle" className="fill-gray-900 text-[22px] font-black">{num(total)}</text>
      <text x="70" y="84" textAnchor="middle" className="fill-gray-400 text-[10px] font-semibold">{caption}</text>
    </svg>
  );
}

const TIER_HEX: Record<DemandTier, string> = {
  very_high: "#f43f5e", high: "#fb7185", medium: "#fbbf24",
  low: "#fde047", very_low: "#cbd5e1", none: "#1f2937"
};

function Kpi({ label, value, foot, Icon, tint }: {
  label: string; value: string; foot: string; Icon: typeof Package; tint: string;
}) {
  return (
    <article className="rounded-xl border border-gray-200 bg-white px-4 py-4">
      <div className="flex items-start gap-3">
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${tint}`}><Icon className="h-4 w-4" /></span>
        <div className="min-w-0">
          <span className="block text-[11px] font-semibold text-gray-500">{label}</span>
          <strong className="mt-0.5 block text-3xl font-black leading-none text-gray-900">{value}</strong>
          <span className="mt-1 block text-[11px] text-gray-400">{foot}</span>
        </div>
      </div>
    </article>
  );
}

function StatCard({ label, value, foot, Icon, tint }: {
  label: string; value: string; foot: string; Icon: typeof Package; tint: string;
}) {
  return (
    <article className="rounded-xl border border-gray-200 bg-white px-3 py-3">
      <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${tint}`}><Icon className="h-4 w-4" /></span>
      <span className="mt-2 block text-[11px] font-semibold text-gray-500">{label}</span>
      <strong className="block text-2xl font-black leading-tight text-gray-900">{value}</strong>
      <span className="block text-[10px] text-gray-400">{foot}</span>
    </article>
  );
}

export default function InventoryOpsStateReplenishment({
  products, stateHubs, orders, waybills, lookbackDays, canManage,
  onCreateTransfer, onOpenOrders, onOpenAgent
}: Props) {
  const [tab, setTab] = useState<Tab>("state");
  const [search, setSearch] = useState("");
  const [productFilter, setProductFilter] = useState("all");
  const [zoneFilter, setZoneFilter] = useState<"all" | NigeriaZone>("all");
  const [priorityFilter, setPriorityFilter] = useState<"all" | ReplenishmentPriority>("all");
  const [sortBy, setSortBy] = useState<SortKey>("priority");
  const [actionOnly, setActionOnly] = useState(true);
  const [dense, setDense] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [inlineTab, setInlineTab] = useState<InlineTab>("agents");
  const [modalKey, setModalKey] = useState<string | null>(null);
  const [modalTab, setModalTab] = useState<ModalTab>("agents");
  const [modalProductId, setModalProductId] = useState<string>("");
  const [horizonDays, setHorizonDays] = useState(14);

  const [notes, setNotes] = useState<StateReplenishmentNote[]>([]);
  const [notesLoaded, setNotesLoaded] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteError, setNoteError] = useState("");

  // Notes are the only stored part of this page, so they are the only thing it
  // fetches - once, on mount. A failure is shown inside the Notes tab rather
  // than as a page banner: the intelligence above it is all derived and stays
  // correct whether or not this call succeeded.
  useEffect(() => {
    let cancelled = false;
    stateReplenishmentNotesApi.list()
      .then((data) => { if (!cancelled) setNotes(data.notes ?? []); })
      .catch((cause: any) => { if (!cancelled) setNoteError(cause?.message ?? "Could not load notes."); })
      .finally(() => { if (!cancelled) setNotesLoaded(true); });
    return () => { cancelled = true; };
  }, []);

  const productIds = useMemo(
    () => (productFilter === "all" ? undefined : new Set([productFilter])),
    [productFilter]
  );
  const rows = useMemo(
    () => buildStateReplenishmentRows(products, stateHubs, orders, waybills, { productIds, lookbackDays }),
    [products, stateHubs, orders, waybills, productIds, lookbackDays]
  );
  const productRows = useMemo(() => buildProductReplenishmentRows(rows), [rows]);

  const scoped = useMemo(() => rows.filter((row) => {
    if (zoneFilter !== "all" && row.zone !== zoneFilter) return false;
    if (priorityFilter !== "all" && row.priority !== priorityFilter) return false;
    return true;
  }), [rows, zoneFilter, priorityFilter]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    const filtered = scoped.filter((row) => {
      if (term && !row.state.toLowerCase().includes(term)) return false;
      if (actionOnly && row.recommendation === "No Action") return false;
      return true;
    });
    const sorters: Record<SortKey, (a: StateReplenishmentRow, b: StateReplenishmentRow) => number> = {
      priority: (a, b) => priorityRank(a.priority) - priorityRank(b.priority) || b.sendUnits - a.sendUnits,
      shortage: (a, b) => b.deficit - a.deficit || priorityRank(a.priority) - priorityRank(b.priority),
      ready: (a, b) => b.readyOrders - a.readyOrders || b.deficit - a.deficit,
      stock: (a, b) => a.sellable - b.sellable || b.deficit - a.deficit,
      state: (a, b) => a.state.localeCompare(b.state)
    };
    return [...filtered].sort(sorters[sortBy]);
  }, [scoped, search, actionOnly, sortBy]);

  const agentRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return scoped
      .flatMap((row) => row.agents)
      .filter((agent) => !term || agent.name.toLowerCase().includes(term) || agent.state.toLowerCase().includes(term))
      .filter((agent) => !actionOnly || agent.deficit > 0 || agent.surplus > 0)
      .sort((a, b) => a.position - b.position || b.readyOrders - a.readyOrders || a.name.localeCompare(b.name));
  }, [scoped, search, actionOnly]);

  const visibleProductRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return productRows
      .filter((row) => !term || row.productName.toLowerCase().includes(term))
      .filter((row) => !actionOnly || row.deficit > 0);
  }, [productRows, search, actionOnly]);

  const totals = useMemo(() => ({
    statesNeeding: scoped.filter((row) => row.recommendation === "Replenish State").length,
    statesRebalancing: scoped.filter((row) => row.recommendation === "Rebalance Agents").length,
    agentShortages: scoped.reduce((sum, row) => sum + row.agentShortages, 0),
    statesAffected: scoped.filter((row) => row.agentShortages > 0).length,
    readyOrders: scoped.reduce((sum, row) => sum + row.readyOrders, 0),
    agentsWithReady: scoped.reduce((sum, row) => sum + row.agents.filter((agent) => agent.readyOrders > 0).length, 0),
    unitsRecommended: scoped.reduce((sum, row) => sum + row.sendUnits + row.rebalanceUnits, 0),
    atRiskRevenue: scoped.reduce((sum, row) => sum + row.atRiskRevenue, 0)
  }), [scoped]);

  const selected = selectedKey ? rows.find((row) => row.key === selectedKey) ?? null : null;
  const modalRow = modalKey ? rows.find((row) => row.key === modalKey) ?? null : null;

  // The modal's product picker defaults to whatever this state is shortest on,
  // because that is the decision the Inventory Manager opened it to make.
  const modalProduct = useMemo(() => {
    if (!modalRow) return null;
    const chosen = modalRow.byProduct.find((entry) => entry.productId === modalProductId);
    return chosen ?? modalRow.byProduct[0] ?? null;
  }, [modalRow, modalProductId]);

  const openState = (key: string) => {
    setSelectedKey(key);
    setInlineTab("agents");
  };
  const openModal = (row: StateReplenishmentRow) => {
    setModalKey(row.key);
    setModalTab("agents");
    setModalProductId(row.byProduct[0]?.productId ?? "");
    setNoteDraft("");
    setNoteError("");
  };
  const toggleExpanded = (key: string) => setExpanded((current) => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const resetFilters = () => {
    setProductFilter("all");
    setZoneFilter("all");
    setPriorityFilter("all");
    setSearch("");
    setActionOnly(true);
  };

  const notesFor = (row: StateReplenishmentRow | null) =>
    row ? notes.filter((note) => note.stateKey === row.key) : [];

  const addNote = async () => {
    if (!modalRow || noteSaving) return;
    const body = noteDraft.trim();
    if (!body) { setNoteError("Write the note first."); return; }
    setNoteSaving(true);
    setNoteError("");
    try {
      const created = await stateReplenishmentNotesApi.create({
        stateKey: modalRow.key,
        stateLabel: modalRow.state,
        productId: modalProduct?.productId ?? null,
        productName: modalProduct?.productName ?? "",
        body
      });
      setNotes((current) => [created.note, ...current]);
      setNoteDraft("");
    } catch (cause: any) {
      setNoteError(cause?.message ?? "Could not save that note.");
    } finally {
      setNoteSaving(false);
    }
  };

  const exportStates = () => downloadCsv("state-replenishment.csv", visible.map((row) => ({
    State: row.state, Zone: row.zone ?? "-", Agents: row.agentCount,
    "Sellable stock": row.sellable, "Open orders": row.openOrders, "Ready orders": row.readyOrders,
    "Ready units": row.readyUnits, "Agent shortages": row.agentShortages, "State position": row.position,
    "Units to send": row.sendUnits, "Units to rebalance": row.rebalanceUnits,
    "In transit": row.inTransit, Recommendation: row.recommendation, Priority: row.priority,
    "Revenue at risk": row.atRiskRevenue
  })));
  const exportAgents = () => downloadCsv("agent-positions.csv", agentRows.map((agent) => ({
    Agent: agent.name, State: agent.state, Area: agent.area, Phone: agent.phone,
    "Sellable stock": agent.sellable, Reserved: agent.reserved, "Open orders": agent.openOrders,
    "Ready orders": agent.readyOrders, "Ready units": agent.readyUnits,
    Position: agent.position, "Short by": agent.deficit, "Can spare": agent.surplus, Status: agent.status
  })));

  const rowPad = dense ? "px-3 py-2" : "px-3 py-3";
  const headCell = "px-3 py-3 text-[10px] font-bold uppercase tracking-wider text-gray-500";

  // ── Recommendation sentence ────────────────────────────────────────────────
  // One place, so the table cell, the inline panel and the modal cannot each
  // describe the same position differently.
  const recommendationText = (row: StateReplenishmentRow) => {
    if (row.recommendation === "Replenish State") return `Send ${num(row.sendUnits)} unit${row.sendUnits === 1 ? "" : "s"}`;
    if (row.recommendation === "Rebalance Agents") return "Rebalance agents";
    if (row.recommendation === "Watch Demand") return "Watch demand";
    return "No action";
  };
  const recommendationDetail = (row: StateReplenishmentRow) => {
    if (row.recommendation === "Replenish State") {
      const target = receivingPlanFor(row, modalProductIdFor(row))[0];
      return target ? `to ${target.agent.name}` : "to state agent";
    }
    if (row.recommendation === "Rebalance Agents") return "within state";
    if (row.recommendation === "Watch Demand") return "too few ready";
    return "";
  };
  function modalProductIdFor(row: StateReplenishmentRow) {
    return productFilter === "all" ? null : (row.byProduct.find((entry) => entry.productId === productFilter)?.productId ?? null);
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="m-0 text-2xl font-bold text-gray-950">State &amp; Agent Replenishment Intelligence</h1>
          <p className="m-0 mt-0.5 text-sm text-gray-500">
            Know which agents need stock, which states require replenishment, and which customers are ready for delivery.
          </p>
        </div>
        <button type="button" onClick={() => setShowHelp((value) => !value)}
          className="!min-h-0 inline-flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-xs font-bold text-blue-700 hover:bg-blue-100">
          <CircleHelp className="h-4 w-4" /> How it works
        </button>
      </header>

      {showHelp && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm leading-relaxed text-blue-900">
          <p className="m-0"><strong>Stock lives with an agent, not with a state.</strong> A state can hold enough units in
            total and still fail its customers, because the units sit with the agent who has no orders. Every number here is
            built agent by agent, then added up.</p>
          <p className="m-0 mt-2"><strong>Only Ready and Rescheduled orders move stock.</strong> A customer a rep confirmed,
            or one with a real delivery date, is <em>actionable demand</em>. Call Back, Not Answering and the rest are shown
            beside it and never trigger a transfer - that is what stops stock crossing Nigeria for someone who never answers.</p>
          <p className="m-0 mt-2"><strong>Three different answers, not one.</strong> <em>Replenish State</em> means the agents
            together cannot cover their ready customers. <em>Rebalance Agents</em> means the state has enough, but it is with
            the wrong agent. <em>Watch Demand</em> means orders exceed stock but too few are ready to justify moving anything.</p>
          <p className="m-0 mt-2 text-[12px] text-blue-800">
            Units to send = per-agent shortfall, minus what other agents in the state can spare, minus what is already in transit.
            Nothing here changes stock on its own - each action opens the transfer for you to confirm.
          </p>
        </div>
      )}

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="States Needing Replenishment" value={num(totals.statesNeeding)}
          foot={`${num(totals.statesRebalancing)} more can rebalance internally`}
          Icon={Package} tint="bg-rose-50 text-rose-600" />
        <Kpi label="Agents with Stock Shortage" value={num(totals.agentShortages)}
          foot={`${num(totals.statesAffected)} state${totals.statesAffected === 1 ? "" : "s"} affected`}
          Icon={Users} tint="bg-orange-50 text-orange-600" />
        <Kpi label="Actionable Orders (Ready)" value={num(totals.readyOrders)}
          foot={`Across ${num(totals.agentsWithReady)} agent${totals.agentsWithReady === 1 ? "" : "s"}`}
          Icon={ShoppingCart} tint="bg-emerald-50 text-emerald-600" />
        <Kpi label="Units Recommended" value={num(totals.unitsRecommended)}
          foot={`${naira(totals.atRiskRevenue)} of ready orders at risk`}
          Icon={TrendingUp} tint="bg-violet-50 text-violet-600" />
      </section>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
        <div className="min-w-0 space-y-4">
          <section className="overflow-hidden rounded-xl border border-gray-200 bg-white">
            <div className="flex flex-wrap items-center gap-1 border-b border-gray-100 px-3">
              {TABS.map((entry) => (
                <button key={entry.key} type="button" onClick={() => setTab(entry.key)}
                  className={`!min-h-0 border-b-2 px-4 py-3 text-sm font-bold transition-colors ${
                    tab === entry.key ? "border-[#1F8FE0] text-[#1F8FE0]" : "border-transparent text-gray-500 hover:text-gray-800"}`}>
                  {entry.label}
                </button>
              ))}
              <div className="relative ml-auto py-2">
                <button type="button" onClick={() => setExportOpen((value) => !value)}
                  className="!min-h-0 inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50">
                  <Download className="h-4 w-4" /> Export <ChevronDown className="h-3.5 w-3.5" />
                </button>
                {exportOpen && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setExportOpen(false)} />
                    <div className="absolute right-0 z-20 mt-1 w-56 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg">
                      <button type="button" onClick={() => { exportStates(); setExportOpen(false); }}
                        className="!min-h-0 block w-full px-3 py-2.5 text-left text-sm font-semibold text-gray-700 hover:bg-gray-50">
                        States in view (CSV)
                      </button>
                      <button type="button" onClick={() => { exportAgents(); setExportOpen(false); }}
                        className="!min-h-0 block w-full border-t border-gray-100 px-3 py-2.5 text-left text-sm font-semibold text-gray-700 hover:bg-gray-50">
                        Agent positions (CSV)
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 px-3 py-3">
              <label className="flex min-w-[180px] flex-1 items-center gap-2 rounded-lg border border-gray-200 px-3 py-2">
                <Search className="h-4 w-4 shrink-0 text-gray-400" />
                <input className="!min-h-0 w-full border-0 p-0 text-sm outline-none"
                  placeholder={tab === "product" ? "Search product..." : tab === "agent" ? "Search agent..." : "Search state..."}
                  value={search} onChange={(event) => setSearch(event.target.value)} />
              </label>
              {/* Bound to the same state as the Filters panel on the right, so the
                  two controls for one filter can never disagree. */}
              <select className="!min-h-0 rounded-lg border border-gray-200 px-3 py-2 text-sm" value={productFilter}
                onChange={(event) => setProductFilter(event.target.value)}>
                <option value="all">All Products</option>
                {products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
              </select>
              <select className="!min-h-0 rounded-lg border border-gray-200 px-3 py-2 text-sm" value={zoneFilter}
                onChange={(event) => setZoneFilter(event.target.value as "all" | NigeriaZone)}>
                <option value="all">All Zones</option>
                {NIGERIA_ZONES.map((zone) => <option key={zone} value={zone}>{zone}</option>)}
              </select>
              <select className="!min-h-0 rounded-lg border border-gray-200 px-3 py-2 text-sm" value={priorityFilter}
                onChange={(event) => setPriorityFilter(event.target.value as "all" | ReplenishmentPriority)}>
                <option value="all">Stock Status</option>
                {PRIORITIES.map((entry) => <option key={entry} value={entry}>{entry}</option>)}
              </select>
              <label className="ml-auto flex items-center gap-2 text-sm font-semibold text-gray-600">
                <span className="hidden sm:inline">Sort by</span>
                <select className="!min-h-0 rounded-lg border border-gray-200 px-3 py-2 text-sm" value={sortBy}
                  onChange={(event) => setSortBy(event.target.value as SortKey)}>
                  <option value="priority">Priority (High to Low)</option>
                  <option value="shortage">Biggest shortage</option>
                  <option value="ready">Most ready orders</option>
                  <option value="stock">Least stock</option>
                  <option value="state">State (A-Z)</option>
                </select>
              </label>
              <button type="button" onClick={() => setDense((value) => !value)} title={dense ? "Comfortable rows" : "Compact rows"}
                className={`!min-h-0 rounded-lg border px-2.5 py-2 ${dense ? "border-blue-200 bg-blue-50 text-blue-700" : "border-gray-200 text-gray-500 hover:bg-gray-50"}`}>
                <SlidersHorizontal className="h-4 w-4" />
              </button>
            </div>

            {tab === "state" && (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[980px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50/70">
                      <th className={`${headCell} w-10`}>#</th>
                      <th className={`${headCell} w-8`} />
                      <th className={headCell}>State</th>
                      <th className={`${headCell} text-right`}>Agents</th>
                      <th className={`${headCell} text-right`}>Sellable<span className="block normal-case text-gray-400">(Total)</span></th>
                      <th className={`${headCell} text-right`}>Open<span className="block normal-case text-gray-400">Orders</span></th>
                      <th className={`${headCell} text-right`} title="Ready + Rescheduled only - the orders that justify moving stock.">
                        Ready<span className="block normal-case text-gray-400">Orders</span>
                      </th>
                      <th className={`${headCell} text-right`}>Agent<span className="block normal-case text-gray-400">Shortages</span></th>
                      <th className={`${headCell} text-right`}>State<span className="block normal-case text-gray-400">Position</span></th>
                      <th className={headCell}>Priority</th>
                      <th className={headCell}>Recommendation</th>
                      <th className={`${headCell} text-right`}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.length === 0 ? (
                      <tr><td colSpan={12} className="px-4 py-12 text-center text-sm italic text-gray-400">
                        {actionOnly ? "Nothing needs replenishment or rebalancing right now." : "No state matches those filters."}
                      </td></tr>
                    ) : visible.map((row, index) => (
                      <Fragment key={row.key}>
                        <tr className={`border-b border-gray-50 ${selectedKey === row.key ? "bg-blue-50/40" : "hover:bg-gray-50/60"}`}>
                          <td className={`${rowPad} text-gray-400`}>{index + 1}</td>
                          <td className={rowPad}>
                            <button type="button" onClick={() => toggleExpanded(row.key)} aria-label="Show products"
                              className="!min-h-0 rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700">
                              {expanded.has(row.key) ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                            </button>
                          </td>
                          <td className={rowPad}>
                            <button type="button" onClick={() => openState(row.key)} className="!min-h-0 block text-left">
                              <strong className="block font-bold text-gray-900">{row.state}</strong>
                              <span className="block text-[11px] text-gray-400">{row.zone ?? "Unzoned"}</span>
                            </button>
                          </td>
                          <td className={`${rowPad} text-right text-gray-700`}>{num(row.agentCount)}</td>
                          <td className={`${rowPad} text-right`}>
                            <span className={`inline-flex min-w-9 justify-center rounded-md px-2 py-1 text-xs font-bold ${
                              row.deficit > 0 ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700"}`}>{num(row.sellable)}</span>
                          </td>
                          <td className={`${rowPad} text-right text-gray-700`}>{num(row.openOrders)}</td>
                          <td className={`${rowPad} text-right`}>
                            <span className={`inline-flex min-w-9 justify-center rounded-md px-2 py-1 text-xs font-bold ${
                              row.readyOrders > row.sellable ? "bg-rose-50 text-rose-700"
                                : row.readyOrders > 0 ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-500"}`}>{num(row.readyOrders)}</span>
                          </td>
                          <td className={`${rowPad} text-right`}>
                            <span className={`inline-flex min-w-9 justify-center rounded-md px-2 py-1 text-xs font-bold ${
                              row.agentShortages > 0 ? "bg-rose-50 text-rose-700" : "bg-gray-100 text-gray-500"}`}>{num(row.agentShortages)}</span>
                          </td>
                          <td className={`${rowPad} text-right`}>
                            <span className={`inline-flex min-w-9 justify-center rounded-md px-2 py-1 text-xs font-bold ${signedTone(row.position)}`}>{signed(row.position)}</span>
                          </td>
                          <td className={rowPad}>
                            <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-bold ${PRIORITY_TONE[row.priority]}`}>{row.priority}</span>
                          </td>
                          <td className={rowPad}>
                            <strong className={`block text-[12px] font-bold ${RECOMMENDATION_TONE[row.recommendation]}`}>{recommendationText(row)}</strong>
                            {recommendationDetail(row) && <span className="block text-[11px] text-gray-400">({recommendationDetail(row)})</span>}
                          </td>
                          <td className={`${rowPad} text-right`}>
                            <button type="button" onClick={() => openModal(row)}
                              className="!min-h-0 rounded-lg border border-blue-200 bg-white px-3 py-1.5 text-xs font-bold text-blue-700 hover:bg-blue-50">View</button>
                          </td>
                        </tr>
                        {expanded.has(row.key) && (
                          <tr className="border-b border-gray-100 bg-gray-50/70">
                            <td colSpan={12} className="px-10 py-3">
                              <p className="m-0 mb-2 text-[10px] font-bold uppercase tracking-wider text-gray-500">Per product in {row.state}</p>
                              <table className="w-full text-left text-xs">
                                <thead className="text-[10px] uppercase tracking-wider text-gray-400">
                                  <tr>
                                    <th className="pb-1.5">Product</th>
                                    <th className="pb-1.5 text-right">Sellable</th>
                                    <th className="pb-1.5 text-right">Committed</th>
                                    <th className="pb-1.5 text-right">Ready units</th>
                                    <th className="pb-1.5 text-right">In transit</th>
                                    <th className="pb-1.5 text-right">Short by</th>
                                    <th className="pb-1.5 text-right">Can spare</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {row.byProduct.length === 0 ? (
                                    <tr><td colSpan={7} className="py-2 italic text-gray-400">No stock or open orders in this state.</td></tr>
                                  ) : row.byProduct.map((entry) => (
                                    <tr key={entry.productId} className="border-t border-gray-200/70">
                                      <td className="py-1.5 font-semibold text-gray-800">{entry.productName}</td>
                                      <td className="py-1.5 text-right text-gray-700">{num(entry.sellable)}</td>
                                      <td className="py-1.5 text-right text-gray-500">{num(entry.reserved)}</td>
                                      <td className="py-1.5 text-right font-bold text-gray-900">{num(entry.readyUnits)}</td>
                                      <td className="py-1.5 text-right text-blue-600">{entry.inTransit > 0 ? num(entry.inTransit) : "-"}</td>
                                      <td className={`py-1.5 text-right font-bold ${entry.deficit > 0 ? "text-rose-600" : "text-gray-300"}`}>{entry.deficit > 0 ? num(entry.deficit) : "-"}</td>
                                      <td className={`py-1.5 text-right ${entry.surplus > 0 ? "text-emerald-600" : "text-gray-300"}`}>{entry.surplus > 0 ? num(entry.surplus) : "-"}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {tab === "agent" && (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[900px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50/70">
                      <th className={`${headCell} w-10`}>#</th>
                      <th className={headCell}>Agent</th>
                      <th className={headCell}>State / Area</th>
                      <th className={`${headCell} text-right`}>Sellable</th>
                      <th className={`${headCell} text-right`}>Reserved</th>
                      <th className={`${headCell} text-right`}>Open</th>
                      <th className={`${headCell} text-right`}>Ready</th>
                      <th className={`${headCell} text-right`}>Position</th>
                      <th className={`${headCell} text-right`}>Can spare</th>
                      <th className={headCell}>Status</th>
                      <th className={`${headCell} text-right`}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {agentRows.length === 0 ? (
                      <tr><td colSpan={11} className="px-4 py-12 text-center text-sm italic text-gray-400">No agent is short or holding spare stock right now.</td></tr>
                    ) : agentRows.map((agent, index) => (
                      <tr key={`${agent.stateKey}-${agent.key}`} className="border-b border-gray-50 hover:bg-gray-50/60">
                        <td className={`${rowPad} text-gray-400`}>{index + 1}</td>
                        <td className={rowPad}>
                          <strong className="block font-bold text-gray-900">{agent.name}</strong>
                          {agent.phone && <span className="block text-[11px] text-gray-400">{agent.phone}</span>}
                        </td>
                        <td className={rowPad}>
                          <span className="block text-gray-700">{agent.state}</span>
                          {agent.area && <span className="block text-[11px] text-gray-400">{agent.area}</span>}
                        </td>
                        <td className={`${rowPad} text-right`}>
                          <span className={`inline-flex min-w-9 justify-center rounded-md px-2 py-1 text-xs font-bold ${agent.sellable === 0 ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700"}`}>{num(agent.sellable)}</span>
                        </td>
                        <td className={`${rowPad} text-right text-gray-500`}>{num(agent.reserved)}</td>
                        <td className={`${rowPad} text-right text-gray-700`}>{num(agent.openOrders)}</td>
                        <td className={`${rowPad} text-right font-bold text-gray-900`}>{num(agent.readyOrders)}</td>
                        <td className={`${rowPad} text-right`}>
                          <span className={`inline-flex min-w-9 justify-center rounded-md px-2 py-1 text-xs font-bold ${signedTone(agent.position)}`}>{signed(agent.position)}</span>
                        </td>
                        <td className={`${rowPad} text-right ${agent.surplus > 0 ? "font-bold text-emerald-600" : "text-gray-300"}`}>{agent.surplus > 0 ? num(agent.surplus) : "-"}</td>
                        <td className={rowPad}>
                          <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-bold ${AGENT_STATUS_TONE[agent.status]}`}>{agent.status}</span>
                        </td>
                        <td className={`${rowPad} text-right`}>
                          <button type="button" onClick={() => { openState(agent.stateKey); setInlineTab("agents"); }}
                            className="!min-h-0 rounded-lg border border-blue-200 bg-white px-3 py-1.5 text-xs font-bold text-blue-700 hover:bg-blue-50">Open state</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {tab === "product" && (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[900px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50/70">
                      <th className={`${headCell} w-10`}>#</th>
                      <th className={headCell}>Product</th>
                      <th className={`${headCell} text-right`}>Sellable</th>
                      <th className={`${headCell} text-right`}>Committed</th>
                      <th className={`${headCell} text-right`}>Ready units</th>
                      <th className={`${headCell} text-right`}>In transit</th>
                      <th className={`${headCell} text-right`}>Agents short</th>
                      <th className={`${headCell} text-right`}>Total shortage</th>
                      <th className={headCell}>States short</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleProductRows.length === 0 ? (
                      <tr><td colSpan={9} className="px-4 py-12 text-center text-sm italic text-gray-400">No product is short against ready demand.</td></tr>
                    ) : visibleProductRows.map((row, index) => (
                      <tr key={row.productId} className="border-b border-gray-50 hover:bg-gray-50/60">
                        <td className={`${rowPad} text-gray-400`}>{index + 1}</td>
                        <td className={`${rowPad} font-bold text-gray-900`}>{row.productName}</td>
                        <td className={`${rowPad} text-right text-gray-700`}>{num(row.sellable)}</td>
                        <td className={`${rowPad} text-right text-gray-500`}>{num(row.openUnits)}</td>
                        <td className={`${rowPad} text-right font-bold text-gray-900`}>{num(row.readyUnits)}</td>
                        <td className={`${rowPad} text-right ${row.inTransit > 0 ? "text-blue-600" : "text-gray-300"}`}>{row.inTransit > 0 ? num(row.inTransit) : "-"}</td>
                        <td className={`${rowPad} text-right ${row.agentsShort > 0 ? "font-bold text-rose-600" : "text-gray-300"}`}>{row.agentsShort > 0 ? num(row.agentsShort) : "-"}</td>
                        <td className={`${rowPad} text-right`}>
                          <span className={`inline-flex min-w-9 justify-center rounded-md px-2 py-1 text-xs font-bold ${row.deficit > 0 ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700"}`}>{num(row.deficit)}</span>
                        </td>
                        <td className={rowPad}>
                          {row.statesShort.length === 0 ? <span className="text-xs text-gray-300">-</span> : (
                            <span className="flex flex-wrap gap-1">
                              {row.statesShort.slice(0, 3).map((entry) => (
                                <span key={entry.state} className="rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-700">
                                  {entry.state} · {num(entry.units)}
                                </span>
                              ))}
                              {row.statesShort.length > 3 && <span className="text-[11px] text-gray-400">+{row.statesShort.length - 3} more</span>}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {tab === "forecast" && (
              <div>
                <div className="flex flex-wrap items-center gap-3 border-b border-gray-100 bg-gray-50/60 px-4 py-3">
                  <p className="m-0 text-[12px] text-gray-600">
                    Ready demand is today. This adds what the last {lookbackDays} days of <strong>delivered</strong> orders
                    say the next{" "}
                    <select className="!min-h-0 rounded-md border border-gray-200 bg-white px-2 py-1 text-[12px] font-bold"
                      value={horizonDays} onChange={(event) => setHorizonDays(Number(event.target.value))}>
                      <option value={7}>7 days</option><option value={14}>14 days</option><option value={30}>30 days</option>
                    </select>{" "}
                    will ask for on top.
                  </p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[920px] text-left text-sm">
                    <thead>
                      <tr className="border-b border-gray-100 bg-gray-50/70">
                        <th className={`${headCell} w-10`}>#</th>
                        <th className={headCell}>State</th>
                        <th className={`${headCell} text-right`}>Sellable</th>
                        <th className={`${headCell} text-right`}>In transit</th>
                        <th className={`${headCell} text-right`}>Ready now</th>
                        <th className={`${headCell} text-right`}>Run rate<span className="block normal-case text-gray-400">units / day</span></th>
                        <th className={`${headCell} text-right`}>Cover<span className="block normal-case text-gray-400">days</span></th>
                        <th className={`${headCell} text-right`}>Forecast demand<span className="block normal-case text-gray-400">{horizonDays} days</span></th>
                        <th className={`${headCell} text-right`}>Units to hold</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visible.length === 0 ? (
                        <tr><td colSpan={9} className="px-4 py-12 text-center text-sm italic text-gray-400">No state matches those filters.</td></tr>
                      ) : visible.map((row, index) => {
                        const forecast = Math.ceil(row.dailySales * horizonDays);
                        const cover = row.dailySales > 0 ? Math.max(0, row.sellable - row.readyUnits) / row.dailySales : Number.POSITIVE_INFINITY;
                        // Ready demand and forecast demand are different people:
                        // one is waiting now, the other has not ordered yet. They
                        // add rather than override, and transit is netted off once.
                        const hold = Math.max(0, row.deficit + forecast - row.surplus - row.inTransit);
                        return (
                          <tr key={row.key} className="border-b border-gray-50 hover:bg-gray-50/60">
                            <td className={`${rowPad} text-gray-400`}>{index + 1}</td>
                            <td className={rowPad}>
                              <strong className="block font-bold text-gray-900">{row.state}</strong>
                              <span className="block text-[11px] text-gray-400">{row.zone ?? "Unzoned"}</span>
                            </td>
                            <td className={`${rowPad} text-right text-gray-700`}>{num(row.sellable)}</td>
                            <td className={`${rowPad} text-right ${row.inTransit > 0 ? "text-blue-600" : "text-gray-300"}`}>{row.inTransit > 0 ? num(row.inTransit) : "-"}</td>
                            <td className={`${rowPad} text-right font-bold text-gray-900`}>{num(row.readyUnits)}</td>
                            <td className={`${rowPad} text-right text-gray-700`}>{Math.round(row.dailySales * 10) / 10}</td>
                            <td className={`${rowPad} text-right font-bold ${
                              !Number.isFinite(cover) ? "text-gray-300" : cover <= 3 ? "text-rose-600" : cover <= 7 ? "text-orange-600" : "text-emerald-600"}`}>
                              {Number.isFinite(cover) ? Math.round(cover * 10) / 10 : "-"}
                            </td>
                            <td className={`${rowPad} text-right text-gray-700`}>{num(forecast)}</td>
                            <td className={`${rowPad} text-right`}>
                              <span className={`inline-flex min-w-9 justify-center rounded-md px-2 py-1 text-xs font-bold ${hold > 0 ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700"}`}>{num(hold)}</span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="m-0 border-t border-gray-100 px-4 py-3 text-xs text-gray-400">
                  Run rate counts delivered orders only, so states with no delivery history show no cover rather than a
                  flattering one. This tab forecasts; it never triggers a transfer on its own.
                </p>
              </div>
            )}

            <p className="m-0 border-t border-gray-100 px-4 py-3 text-xs text-gray-400">
              {tab === "state" && `Showing ${visible.length} of ${rows.length} states · `}
              {tab === "agent" && `Showing ${agentRows.length} agent hubs · `}
              {tab === "product" && `Showing ${visibleProductRows.length} of ${productRows.length} products · `}
              Ready orders are Ready and Rescheduled only. Open orders include every status that has not closed.
            </p>
          </section>

          {selected && (
            <StateDetailPanel
              row={selected}
              tab={inlineTab}
              rows={rows}
              productFilter={productFilter === "all" ? null : productFilter}
              canManage={canManage}
              dense={dense}
              onTab={setInlineTab}
              onClose={() => setSelectedKey(null)}
              onCreateTransfer={onCreateTransfer}
              onOpenOrders={onOpenOrders}
              onOpenAgent={onOpenAgent}
            />
          )}
        </div>

        <aside className="space-y-4">
          <section className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="flex items-center justify-between">
              <h2 className="m-0 inline-flex items-center gap-2 text-sm font-bold text-gray-900"><SlidersHorizontal className="h-4 w-4 text-gray-400" /> Filters</h2>
              <button type="button" onClick={resetFilters} className="!min-h-0 text-xs font-bold text-blue-600 hover:underline">Reset</button>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold text-gray-500">Product</span>
                <select className="!min-h-0 w-full rounded-lg border border-gray-200 px-2 py-2 text-sm" value={productFilter}
                  onChange={(event) => setProductFilter(event.target.value)}>
                  <option value="all">All Products</option>
                  {products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold text-gray-500">Status</span>
                <select className="!min-h-0 w-full rounded-lg border border-gray-200 px-2 py-2 text-sm" value={priorityFilter}
                  onChange={(event) => setPriorityFilter(event.target.value as "all" | ReplenishmentPriority)}>
                  <option value="all">All Statuses</option>
                  {PRIORITIES.map((entry) => <option key={entry} value={entry}>{entry}</option>)}
                </select>
              </label>
              <label className="col-span-2 block">
                <span className="mb-1 block text-[11px] font-semibold text-gray-500">Zone</span>
                <select className="!min-h-0 w-full rounded-lg border border-gray-200 px-2 py-2 text-sm" value={zoneFilter}
                  onChange={(event) => setZoneFilter(event.target.value as "all" | NigeriaZone)}>
                  <option value="all">All Zones</option>
                  {NIGERIA_ZONES.map((zone) => <option key={zone} value={zone}>{zone}</option>)}
                </select>
              </label>
            </div>
            <div className="mt-3 flex items-center justify-between gap-2 border-t border-gray-100 pt-3">
              <span className="text-[12px] font-semibold text-gray-600">Show states with action only</span>
              <button type="button" role="switch" aria-checked={actionOnly} onClick={() => setActionOnly((value) => !value)}
                className={`relative h-6 w-11 shrink-0 !min-h-0 rounded-full p-0 transition-colors ${actionOnly ? "bg-[#1F8FE0]" : "bg-gray-200"}`}>
                <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${actionOnly ? "left-5" : "left-0.5"}`} />
              </button>
            </div>
          </section>

          <section className="rounded-xl border border-gray-200 bg-white p-4">
            <h2 className="m-0 text-sm font-bold text-gray-900">Demand Confidence Guide</h2>
            <p className="m-0 mt-1 text-[11px] leading-relaxed text-gray-400">
              Protohub's own order statuses, ranked by how likely the customer is to actually take delivery.
            </p>
            <ul className="m-0 mt-3 list-none space-y-1.5 p-0">
              {([
                ["Ready", "very_high"], ["Rescheduled", "high"], ["Pending", "medium"], ["Call Back", "medium"],
                ["Follow Up", "low"], ["Not Ready", "low"], ["Not Answering", "very_low"], ["Number Busy", "very_low"],
                ["Switched Off", "very_low"], ["Not Available", "very_low"], ["Cancelled", "none"]
              ] as Array<[string, DemandTier]>).map(([label, tier]) => (
                <li key={label} className="flex items-center gap-2 text-[12px]">
                  <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${DEMAND_TIER_META[tier].dot}`} />
                  <span className="min-w-0 flex-1 truncate text-gray-600">{label}</span>
                  <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold ${DEMAND_TIER_META[tier].chip}`}>{DEMAND_TIER_META[tier].label}</span>
                </li>
              ))}
            </ul>
            <p className="m-0 mt-3 border-t border-gray-100 pt-2 text-[11px] leading-relaxed text-gray-500">
              Only <strong className="text-gray-700">Ready</strong> and <strong className="text-gray-700">Rescheduled</strong> count as
              actionable demand. Everything below is shown, never shipped against.
            </p>
          </section>

          <section className="rounded-xl border border-blue-200 bg-blue-50 p-4">
            <div className="flex items-start gap-2.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-blue-600"><PackageCheck className="h-4 w-4" /></span>
              <div>
                <h2 className="m-0 text-sm font-bold text-blue-900">Stock moves by agent</h2>
                <p className="m-0 mt-1 text-[12px] leading-relaxed text-blue-800">
                  We operate through state agents. Stock is sent to a specific agent, not to a state - so a state total that
                  looks healthy can still have an agent who cannot deliver.
                </p>
              </div>
            </div>
          </section>
        </aside>
      </div>

      {modalRow && (
        <StateModal
          row={modalRow}
          rows={rows}
          product={modalProduct}
          onProduct={setModalProductId}
          tab={modalTab}
          onTab={setModalTab}
          onClose={() => setModalKey(null)}
          canManage={canManage}
          notes={notesFor(modalRow)}
          notesLoaded={notesLoaded}
          noteDraft={noteDraft}
          onNoteDraft={setNoteDraft}
          noteSaving={noteSaving}
          noteError={noteError}
          onAddNote={addNote}
          onCreateTransfer={onCreateTransfer}
          onOpenOrders={onOpenOrders}
          lookbackDays={lookbackDays}
        />
      )}
    </div>
  );
}

// ── Shared pieces ────────────────────────────────────────────────────────────

function AgentTable({ agents, dense, canManage, productId, onSend, onOrders, onOpenAgent }: {
  agents: AgentPosition[];
  dense: boolean;
  canManage: boolean;
  productId: string | null;
  onSend?: (agent: AgentPosition, units: number) => void;
  onOrders?: (agent: AgentPosition) => void;
  onOpenAgent?: (agentId: string) => void;
}) {
  const pad = dense ? "px-3 py-2" : "px-3 py-2.5";
  const unitsFor = (agent: AgentPosition) => productId
    ? (agent.byProduct.find((entry) => entry.productId === productId)?.deficit ?? 0)
    : agent.deficit;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[820px] text-left text-sm">
        <thead>
          <tr className="border-b border-gray-100 bg-gray-50/70 text-[10px] font-bold uppercase tracking-wider text-gray-500">
            <th className="px-3 py-2.5 w-10">#</th>
            <th className="px-3 py-2.5">Agent</th>
            <th className="px-3 py-2.5">Area</th>
            <th className="px-3 py-2.5 text-right" title="Physical units on hand, less defective and missing.">Sellable Stock</th>
            <th className="px-3 py-2.5 text-right" title="Units committed to open orders of any confidence.">Reserved</th>
            <th className="px-3 py-2.5 text-right">Open Orders</th>
            <th className="px-3 py-2.5 text-right">Ready Orders</th>
            <th className="px-3 py-2.5 text-right">Position</th>
            <th className="px-3 py-2.5">Status</th>
            <th className="px-3 py-2.5 text-right">Action</th>
          </tr>
        </thead>
        <tbody>
          {agents.length === 0 ? (
            <tr><td colSpan={10} className="px-4 py-8 text-center text-sm italic text-gray-400">No agent hub is registered in this state yet.</td></tr>
          ) : agents.map((agent, index) => {
            const units = unitsFor(agent);
            return (
              <tr key={agent.key} className="border-b border-gray-50">
                <td className={`${pad} text-gray-400`}>{index + 1}</td>
                <td className={pad}>
                  {agent.agentId && onOpenAgent ? (
                    <button type="button" onClick={() => onOpenAgent(agent.agentId!)} className="!min-h-0 block text-left font-bold text-blue-700 hover:underline">{agent.name}</button>
                  ) : <strong className="block font-bold text-gray-900">{agent.name}</strong>}
                  {agent.phone && <span className="block text-[11px] text-gray-400">{agent.phone}</span>}
                </td>
                <td className={`${pad} text-gray-600`}>{agent.area || "-"}</td>
                <td className={`${pad} text-right`}>
                  <span className={`inline-flex min-w-9 justify-center rounded-md px-2 py-1 text-xs font-bold ${agent.sellable === 0 ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700"}`}>{num(agent.sellable)}</span>
                </td>
                <td className={`${pad} text-right text-gray-500`}>{num(agent.reserved)}</td>
                <td className={`${pad} text-right text-gray-700`}>{num(agent.openOrders)}</td>
                <td className={`${pad} text-right`}>
                  <span className={`inline-flex min-w-9 justify-center rounded-md px-2 py-1 text-xs font-bold ${
                    agent.readyOrders > 0 && agent.deficit > 0 ? "bg-amber-50 text-amber-700"
                      : agent.readyOrders > 0 ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-500"}`}>{num(agent.readyOrders)}</span>
                </td>
                <td className={`${pad} text-right`}>
                  <span className={`inline-flex min-w-9 justify-center rounded-md px-2 py-1 text-xs font-bold ${signedTone(agent.position)}`}>{signed(agent.position)}</span>
                </td>
                <td className={pad}>
                  <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-bold ${AGENT_STATUS_TONE[agent.status]}`}>{agent.status}</span>
                </td>
                <td className={`${pad} text-right`}>
                  {units > 0 && canManage && onSend ? (
                    <button type="button" onClick={() => onSend(agent, units)}
                      className="!min-h-0 rounded-lg border border-blue-200 bg-white px-3 py-1.5 text-xs font-bold text-blue-700 hover:bg-blue-50">
                      Send Stock
                    </button>
                  ) : onOrders ? (
                    <button type="button" onClick={() => onOrders(agent)}
                      className="!min-h-0 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-bold text-gray-600 hover:bg-gray-50">
                      View Orders
                    </button>
                  ) : <span className="text-xs text-gray-300">-</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function OrderTable({ orders, showNote }: { orders: ReplenishmentOrder[]; showNote?: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[820px] text-left text-sm">
        <thead>
          <tr className="border-b border-gray-100 bg-gray-50/70 text-[10px] font-bold uppercase tracking-wider text-gray-500">
            <th className="px-3 py-2.5">Order</th>
            <th className="px-3 py-2.5">Customer</th>
            <th className="px-3 py-2.5">Phone</th>
            <th className="px-3 py-2.5">Agent</th>
            <th className="px-3 py-2.5 text-right">Qty</th>
            <th className="px-3 py-2.5">Status</th>
            <th className="px-3 py-2.5">Confidence</th>
            <th className="px-3 py-2.5">Order date</th>
            {showNote && <th className="px-3 py-2.5">Notes</th>}
          </tr>
        </thead>
        <tbody>
          {orders.length === 0 ? (
            <tr><td colSpan={showNote ? 9 : 8} className="px-4 py-8 text-center text-sm italic text-gray-400">No orders here.</td></tr>
          ) : orders.map((order) => (
            <tr key={order.id || `${order.customer}-${order.createdAt}`} className="border-b border-gray-50">
              <td className="px-3 py-2.5 font-semibold text-gray-500">{order.id || "-"}</td>
              <td className="px-3 py-2.5 font-bold text-gray-900">{order.customer}</td>
              <td className="px-3 py-2.5 text-gray-600">{order.phone || "-"}</td>
              <td className="px-3 py-2.5 text-gray-600">{order.agentName}</td>
              <td className="px-3 py-2.5 text-right font-bold text-gray-900">{num(order.quantity)}</td>
              <td className="px-3 py-2.5">
                <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-bold ${DEMAND_TIER_META[order.tier].chip}`}>{order.statusLabel}</span>
              </td>
              <td className="px-3 py-2.5">
                <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-gray-600">
                  <span className={`h-2 w-2 rounded-full ${DEMAND_TIER_META[order.tier].dot}`} />
                  {DEMAND_TIER_META[order.tier].label}
                </span>
              </td>
              <td className="px-3 py-2.5 text-gray-500">{shortDate(order.createdAt) || "-"}</td>
              {showNote && <td className="px-3 py-2.5 text-gray-500">{order.note || "-"}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TransferOptions({ row, rows, productId, canManage, onCreateTransfer }: {
  row: StateReplenishmentRow;
  rows: StateReplenishmentRow[];
  productId: string | null;
  canManage: boolean;
  onCreateTransfer?: (request: ReplenishmentTransferRequest) => void;
}) {
  const internal = internalDonorsFor(row, productId);
  const external = donorsFor(rows, row.key, productId, row.zone).slice(0, 8);
  const receiving = receivingPlanFor(row, productId);
  const need = receiving.reduce((sum, entry) => sum + entry.units, 0);

  return (
    <div className="space-y-4 p-4">
      {/* ⚠️ INSIDE THE STATE FIRST. Shipping into a state that already holds the
          units, just with the wrong agent, is the expensive mistake this page
          exists to prevent - so the internal option is offered above the
          interstate one, never below it. */}
      <section className="rounded-xl border border-gray-200">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-4 py-3">
          <div>
            <h3 className="m-0 text-sm font-bold text-gray-900">Inside {row.state} first</h3>
            <p className="m-0 text-[11px] text-gray-500">Agents here holding stock free of every open order.</p>
          </div>
          <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${row.rebalanceUnits > 0 ? "bg-orange-50 text-orange-700" : "bg-gray-100 text-gray-500"}`}>
            {row.rebalanceUnits > 0 ? `${num(row.rebalanceUnits)} unit${row.rebalanceUnits === 1 ? "" : "s"} coverable internally` : "Nothing to spare"}
          </span>
        </div>
        {internal.length === 0 ? (
          <p className="m-0 px-4 py-6 text-center text-sm italic text-gray-400">No agent in {row.state} has spare stock.</p>
        ) : (
          <ul className="m-0 list-none divide-y divide-gray-50 p-0">
            {internal.map((donor) => (
              <li key={donor.agent.key} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-50 text-[11px] font-black text-emerald-700">{initials(donor.agent.name)}</span>
                <span className="min-w-0 flex-1">
                  <strong className="block text-sm font-bold text-gray-900">{donor.agent.name}</strong>
                  <span className="block text-[11px] text-gray-500">{donor.agent.area || row.state} · {num(donor.units)} spare · {num(donor.agent.readyOrders)} ready of its own</span>
                </span>
                {canManage && onCreateTransfer && receiving[0] && (
                  <button type="button"
                    onClick={() => onCreateTransfer({
                      productId: productId ?? undefined,
                      quantity: Math.min(donor.units, receiving[0].units),
                      toState: row.state,
                      toAgentId: receiving[0].agent.agentId,
                      toAgentLocationId: receiving[0].agent.locationId,
                      fromAgentId: donor.agent.agentId,
                      fromAgentLocationId: donor.agent.locationId
                    })}
                    className="!min-h-0 inline-flex items-center gap-1.5 rounded-lg border border-orange-200 bg-orange-50 px-3 py-1.5 text-xs font-bold text-orange-700 hover:bg-orange-100">
                    <ArrowLeftRight className="h-3.5 w-3.5" /> Move {num(Math.min(donor.units, receiving[0].units))} to {receiving[0].agent.name}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-xl border border-gray-200">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-4 py-3">
          <div>
            <h3 className="m-0 text-sm font-bold text-gray-900">Nearest excess stock elsewhere</h3>
            <p className="m-0 text-[11px] text-gray-500">Same zone first - a suggestion about distance, never a routing rule.</p>
          </div>
          <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${row.sendUnits > 0 ? "bg-rose-50 text-rose-700" : "bg-gray-100 text-gray-500"}`}>
            {row.sendUnits > 0 ? `${num(row.sendUnits)} still needed` : "Nothing needed from outside"}
          </span>
        </div>
        {external.length === 0 ? (
          <p className="m-0 px-4 py-6 text-center text-sm italic text-gray-400">No other agent in the network has spare stock of this product.</p>
        ) : (
          <ul className="m-0 list-none divide-y divide-gray-50 p-0">
            {external.map((donor) => (
              <li key={`${donor.agent.stateKey}-${donor.agent.key}`} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-50 text-[11px] font-black text-blue-700">{initials(donor.agent.name)}</span>
                <span className="min-w-0 flex-1">
                  <strong className="block text-sm font-bold text-gray-900">{donor.agent.name}</strong>
                  <span className="block text-[11px] text-gray-500">
                    {donor.agent.state}{donor.agent.area ? ` · ${donor.agent.area}` : ""} · {num(donor.units)} available
                    {donor.sameZone && <span className="ml-1.5 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">Same zone</span>}
                  </span>
                </span>
                {canManage && onCreateTransfer && (
                  <button type="button"
                    onClick={() => onCreateTransfer({
                      productId: productId ?? undefined,
                      quantity: Math.min(donor.units, need > 0 ? need : donor.units),
                      toState: row.state,
                      toAgentId: receiving[0]?.agent.agentId,
                      toAgentLocationId: receiving[0]?.agent.locationId,
                      fromAgentId: donor.agent.agentId,
                      fromAgentLocationId: donor.agent.locationId
                    })}
                    className="!min-h-0 inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-bold text-blue-700 hover:bg-blue-100">
                    <Truck className="h-3.5 w-3.5" /> Create transfer
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

// ── Inline drill-down under the table ────────────────────────────────────────

function StateDetailPanel({
  row, tab, rows, productFilter, canManage, dense, onTab, onClose, onCreateTransfer, onOpenOrders, onOpenAgent
}: {
  row: StateReplenishmentRow;
  tab: InlineTab;
  rows: StateReplenishmentRow[];
  productFilter: string | null;
  canManage: boolean;
  dense: boolean;
  onTab: (tab: InlineTab) => void;
  onClose: () => void;
  onCreateTransfer?: (request: ReplenishmentTransferRequest) => void;
  onOpenOrders?: (search: string) => void;
  onOpenAgent?: (agentId: string) => void;
}) {
  const ready = row.orders.filter((order) => order.actionable);
  const receiving = receivingPlanFor(row, productFilter);
  const tabs: Array<{ key: InlineTab; label: string }> = [
    { key: "agents", label: `Agents (${row.agentCount})` },
    { key: "open", label: `Open Orders (${row.openOrders})` },
    { key: "ready", label: `Ready Orders (${row.readyOrders})` },
    { key: "transfer", label: "Transfer Options" }
  ];

  return (
    <section className="overflow-hidden rounded-xl border border-gray-200 bg-white">
      <div className="flex flex-wrap items-start justify-between gap-3 p-4">
        <div className="flex items-center gap-3">
          <span className={`flex h-11 w-11 items-center justify-center rounded-xl ${row.deficit > 0 ? "bg-rose-50 text-rose-600" : "bg-emerald-50 text-emerald-600"}`}>
            {row.deficit > 0 ? <AlertTriangle className="h-5 w-5" /> : <PackageCheck className="h-5 w-5" />}
          </span>
          <div>
            <h2 className="m-0 flex flex-wrap items-center gap-2 text-xl font-black text-gray-950">
              {row.state}
              <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${PRIORITY_TONE[row.priority]}`}>{row.priority}</span>
            </h2>
            <p className="m-0 text-[12px] text-gray-500">
              {num(row.agentCount)} agent{row.agentCount === 1 ? "" : "s"} · {num(row.sellable)} sellable unit{row.sellable === 1 ? "" : "s"} ·{" "}
              {num(row.readyOrders)} ready order{row.readyOrders === 1 ? "" : "s"} · {row.deficit > 0 ? `${num(row.deficit)}-unit shortage` : "no shortage"}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {row.deficit > 0 && (
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5">
              <AlertTriangle className="h-5 w-5 shrink-0 text-rose-600" />
              <div>
                <strong className="block text-[13px] font-black text-rose-800">{num(row.deficit)}-unit shortage</strong>
                <span className="block text-[11px] text-rose-700">
                  {num(row.readyOrders)} ready customer{row.readyOrders === 1 ? "" : "s"} competing for {num(row.sellable)} sellable unit{row.sellable === 1 ? "" : "s"}
                </span>
              </div>
              {canManage && onCreateTransfer && receiving[0] ? (
                <button type="button"
                  onClick={() => onCreateTransfer({
                    productId: productFilter ?? undefined,
                    quantity: row.sendUnits > 0 ? row.sendUnits : row.deficit,
                    toState: row.state,
                    toAgentId: receiving[0].agent.agentId,
                    toAgentLocationId: receiving[0].agent.locationId
                  })}
                  className="!min-h-0 inline-flex items-center gap-2 rounded-lg bg-rose-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-rose-700">
                  <Truck className="h-4 w-4" /> Send Stock to Agent
                </button>
              ) : row.agentCount === 0 ? (
                <span className="rounded-lg bg-white px-3 py-2 text-[11px] font-bold text-rose-800">
                  No agent covers {row.state} yet - assign one before stock can be sent.
                </span>
              ) : null}
            </div>
          )}
          <button type="button" onClick={onClose} className="!min-h-0 rounded-lg p-2 text-gray-400 hover:bg-gray-100"><X className="h-5 w-5" /></button>
        </div>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-gray-100 px-3">
        {tabs.map((entry) => (
          <button key={entry.key} type="button" onClick={() => onTab(entry.key)}
            className={`!min-h-0 border-b-2 px-4 py-2.5 text-sm font-bold transition-colors ${
              tab === entry.key ? "border-[#1F8FE0] text-[#1F8FE0]" : "border-transparent text-gray-500 hover:text-gray-800"}`}>
            {entry.label}
          </button>
        ))}
      </div>

      {tab === "agents" && (
        <AgentTable
          agents={row.agents} dense={dense} canManage={canManage} productId={productFilter}
          onOpenAgent={onOpenAgent}
          onSend={(agent, units) => onCreateTransfer?.({
            productId: productFilter ?? undefined,
            quantity: units,
            toState: row.state,
            toAgentId: agent.agentId,
            toAgentLocationId: agent.locationId
          })}
          onOrders={(agent) => onOpenOrders?.(agent.name)}
        />
      )}
      {tab === "open" && <OrderTable orders={row.orders} showNote />}
      {tab === "ready" && <OrderTable orders={ready} showNote />}
      {tab === "transfer" && <TransferOptions row={row} rows={rows} productId={productFilter} canManage={canManage} onCreateTransfer={onCreateTransfer} />}
    </section>
  );
}

// ── Full state modal ─────────────────────────────────────────────────────────

function StateModal({
  row, rows, product, onProduct, tab, onTab, onClose, canManage, notes, notesLoaded,
  noteDraft, onNoteDraft, noteSaving, noteError, onAddNote, onCreateTransfer, onOpenOrders, lookbackDays
}: {
  row: StateReplenishmentRow;
  rows: StateReplenishmentRow[];
  product: ProductPosition | null;
  onProduct: (productId: string) => void;
  tab: ModalTab;
  onTab: (tab: ModalTab) => void;
  onClose: () => void;
  canManage: boolean;
  notes: StateReplenishmentNote[];
  notesLoaded: boolean;
  noteDraft: string;
  onNoteDraft: (value: string) => void;
  noteSaving: boolean;
  noteError: string;
  onAddNote: () => void;
  onCreateTransfer?: (request: ReplenishmentTransferRequest) => void;
  onOpenOrders?: (search: string) => void;
  lookbackDays: number;
}) {
  const productId = product?.productId ?? null;
  const receiving = receivingPlanFor(row, productId);
  const target = receiving[0];
  const sendUnits = product ? Math.max(0, product.deficit - product.surplus - product.inTransit) : row.sendUnits;
  const ready = row.orders.filter((order) => order.actionable);
  const recent = [...row.orders].sort((a, b) => Date.parse(b.createdAt ?? "") - Date.parse(a.createdAt ?? "")).slice(0, 8);

  const tabs: Array<{ key: ModalTab; label: string }> = [
    { key: "agents", label: "Agent Breakdown" },
    { key: "orders", label: "Orders in State" },
    { key: "transfer", label: "Transfer Options" },
    { key: "performance", label: "State Performance" },
    { key: "notes", label: `Notes (${notes.length})` }
  ];

  const slices = DEMAND_TIER_ORDER
    .map((tier) => ({ tier, value: row.tierCounts[tier] ?? 0 }))
    .filter((entry) => entry.value > 0)
    .map((entry) => ({ value: entry.value, color: TIER_HEX[entry.tier] }));

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/55 p-3"
      onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
      <div className="max-h-[94vh] w-full max-w-5xl overflow-y-auto rounded-xl bg-white shadow-2xl">
        <div className="flex flex-wrap items-start justify-between gap-3 px-6 py-5">
          <div className="flex items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600"><MapPin className="h-5 w-5" /></span>
            <div>
              <h2 className="m-0 flex flex-wrap items-center gap-2 text-2xl font-black text-gray-950">
                {row.state} State
                <span className={`rounded-full border px-2.5 py-1 text-[11px] font-bold ${PRIORITY_TONE[row.priority]}`}>
                  {row.recommendation === "Replenish State" ? "Needs Stock"
                    : row.recommendation === "Rebalance Agents" ? "Rebalance"
                      : row.recommendation === "Watch Demand" ? "Watch" : "Healthy"}
                </span>
              </h2>
              <p className="m-0 mt-0.5 text-sm text-gray-500">View full details of stock, agents, orders and recommendations for {row.state}.</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold text-gray-500">Product</span>
              <select className="!min-h-0 w-56 rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold" value={productId ?? ""}
                onChange={(event) => onProduct(event.target.value)}>
                {row.byProduct.length === 0 && <option value="">No products here</option>}
                {row.byProduct.map((entry) => <option key={entry.productId} value={entry.productId}>{entry.productName}</option>)}
              </select>
            </label>
            <button type="button" onClick={onClose} className="!min-h-0 mt-5 rounded-lg p-2 text-gray-400 hover:bg-gray-100"><X className="h-5 w-5" /></button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 px-6 pb-5 md:grid-cols-3 xl:grid-cols-5">
          <StatCard label="Total Sellable Stock" value={num(product?.sellable ?? row.sellable)}
            foot={`Across ${num(row.agentCount)} agent${row.agentCount === 1 ? "" : "s"}`} Icon={Package} tint="bg-emerald-50 text-emerald-600" />
          <StatCard label="Open Orders" value={num(row.openOrders)} foot="All statuses" Icon={FileText} tint="bg-blue-50 text-blue-600" />
          <StatCard label="Ready / Actionable Orders" value={num(row.readyOrders)} foot="Ready + Rescheduled" Icon={Users} tint="bg-amber-50 text-amber-600" />
          <StatCard label="State Shortage" value={product ? signed(-product.deficit) : signed(-row.deficit)}
            foot="Units needed now" Icon={AlertTriangle} tint="bg-rose-50 text-rose-600" />
          <StatCard label="Recommended Transfer" value={`${num(sendUnits)} units`}
            foot={target ? `To ${target.agent.name}`
              : row.agentCount === 0 ? "No agent in this state yet"
                : "No receiving agent short"}
            Icon={TrendingUp} tint="bg-violet-50 text-violet-600" />
        </div>

        <div className="flex flex-wrap gap-1 border-b border-gray-100 px-6">
          {tabs.map((entry) => (
            <button key={entry.key} type="button" onClick={() => onTab(entry.key)}
              className={`!min-h-0 border-b-2 px-4 py-2.5 text-sm font-bold transition-colors ${
                tab === entry.key ? "border-[#1F8FE0] text-[#1F8FE0]" : "border-transparent text-gray-500 hover:text-gray-800"}`}>
              {entry.label}
            </button>
          ))}
        </div>

        {tab === "agents" && (
          <div className="px-6 py-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="m-0 text-base font-black text-gray-950">Agents in {row.state}</h3>
                <p className="m-0 text-[12px] text-gray-500">Stock position and order status for each agent in this state.</p>
              </div>
              <button type="button" onClick={() => onTab("notes")}
                className="!min-h-0 inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-xs font-bold text-gray-700 hover:bg-gray-50">
                <FileText className="h-4 w-4" /> Add Note
              </button>
            </div>
            <div className="mt-3 overflow-hidden rounded-xl border border-gray-200">
              <AgentTable
                agents={row.agents} dense={false} canManage={canManage} productId={productId}
                onSend={(agent, units) => onCreateTransfer?.({
                  productId: productId ?? undefined, quantity: units, toState: row.state,
                  toAgentId: agent.agentId, toAgentLocationId: agent.locationId
                })}
                onOrders={(agent) => onOpenOrders?.(agent.name)}
              />
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-3">
              <section className="rounded-xl border border-gray-200 p-4">
                <h4 className="m-0 text-sm font-bold text-gray-900">Order Status Breakdown (State)</h4>
                <p className="m-0 text-[11px] text-gray-500">Total {num(row.openOrders)} open order{row.openOrders === 1 ? "" : "s"} in {row.state}.</p>
                <div className="mt-3 flex items-center gap-4">
                  <Donut slices={slices} total={row.openOrders} caption="Orders" />
                  <ul className="m-0 min-w-0 flex-1 list-none space-y-1.5 p-0">
                    {row.statusCounts.length === 0 ? (
                      <li className="text-[12px] italic text-gray-400">No open orders.</li>
                    ) : row.statusCounts.map((entry) => (
                      <li key={entry.label} className="flex items-center gap-2 text-[12px]">
                        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: TIER_HEX[entry.tier] }} />
                        <span className="min-w-0 flex-1 truncate text-gray-600">{entry.label}</span>
                        <span className="shrink-0 font-bold text-gray-900">{entry.count}</span>
                        <span className="w-10 shrink-0 text-right text-gray-400">{Math.round((entry.count / Math.max(1, row.openOrders)) * 100)}%</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </section>

              <section className="rounded-xl border border-gray-200 p-4">
                <h4 className="m-0 text-sm font-bold text-gray-900">Top Customers (Ready Orders)</h4>
                <p className="m-0 text-[11px] text-gray-500">{num(ready.length)} customer{ready.length === 1 ? "" : "s"} ready for delivery.</p>
                <ul className="m-0 mt-3 list-none space-y-2 p-0">
                  {ready.length === 0 ? (
                    <li className="text-[12px] italic text-gray-400">Nobody in {row.state} is ready yet.</li>
                  ) : ready.slice(0, 4).map((order) => (
                    <li key={order.id || order.customer} className="flex items-center gap-2.5">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-100 text-[10px] font-black text-gray-600">{initials(order.customer)}</span>
                      <span className="min-w-0 flex-1">
                        <strong className="block truncate text-[12px] font-bold text-gray-900">{order.customer}</strong>
                        <span className="block text-[11px] text-gray-400">{order.phone || order.agentName}</span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold ${DEMAND_TIER_META[order.tier].chip}`}>{order.statusLabel}</span>
                        <span className="mt-0.5 block text-[10px] text-gray-400">{readinessLine(order)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
                {ready.length > 0 && onOpenOrders && (
                  <button type="button" onClick={() => onOpenOrders(row.state)}
                    className="!min-h-0 mt-3 w-full rounded-lg border border-gray-200 px-3 py-2 text-xs font-bold text-gray-700 hover:bg-gray-50">
                    View All Ready Orders →
                  </button>
                )}
              </section>

              <section className="rounded-xl border border-gray-200 p-4">
                <div className="flex items-center justify-between">
                  <h4 className="m-0 text-sm font-bold text-gray-900">Recommendation</h4>
                  <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-bold text-violet-700"><Sparkles className="h-3 w-3" /> Derived</span>
                </div>
                <div className={`mt-3 rounded-xl border p-3 ${row.deficit > 0 ? "border-rose-200 bg-rose-50" : "border-emerald-200 bg-emerald-50"}`}>
                  <strong className={`flex items-start gap-2 text-[13px] font-black ${row.deficit > 0 ? "text-rose-800" : "text-emerald-800"}`}>
                    {row.deficit > 0 ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> : <PackageCheck className="mt-0.5 h-4 w-4 shrink-0" />}
                    {row.recommendation === "Replenish State" ? `Send ${num(sendUnits)} unit${sendUnits === 1 ? "" : "s"} to ${row.state}`
                      : row.recommendation === "Rebalance Agents" ? `Rebalance ${num(row.rebalanceUnits)} unit${row.rebalanceUnits === 1 ? "" : "s"} inside ${row.state}`
                        : row.recommendation === "Watch Demand" ? "Watch demand - do not transfer yet"
                          : `${row.state} is covered`}
                  </strong>
                  <p className={`m-0 mt-1.5 text-[11px] leading-relaxed ${row.deficit > 0 ? "text-rose-700" : "text-emerald-700"}`}>
                    {row.recommendation === "Replenish State"
                      ? `There are ${num(row.readyOrders)} ready customer${row.readyOrders === 1 ? "" : "s"} but only ${num(product?.sellable ?? row.sellable)} sellable unit${(product?.sellable ?? row.sellable) === 1 ? "" : "s"} across ${num(row.agentCount)} agent${row.agentCount === 1 ? "" : "s"}. Send stock to the agent with confirmed demand.`
                      : row.recommendation === "Rebalance Agents"
                        ? `${row.state} holds enough stock overall, but it is with the wrong agent. Move it inside the state rather than shipping more in.`
                        : row.recommendation === "Watch Demand"
                          ? `${num(row.openOrders)} order${row.openOrders === 1 ? "" : "s"} exceed stock, but only ${num(row.readyOrders)} ${row.readyOrders === 1 ? "is" : "are"} ready or rescheduled. Recheck when another customer becomes ready.`
                          : "Every ready customer here can be served by the agent holding their order."}
                  </p>
                </div>

                {target && (
                  <div className="mt-3 rounded-xl border border-gray-200 p-3">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Suggested receiving agent</span>
                    <div className="mt-2 flex items-center gap-2.5">
                      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-rose-50 text-[11px] font-black text-rose-700">{initials(target.agent.name)}</span>
                      <span className="min-w-0 flex-1">
                        <strong className="block truncate text-[12px] font-bold text-gray-900">{target.agent.name}</strong>
                        <span className="block text-[11px] text-gray-500">{num(target.agent.readyOrders)} ready order{target.agent.readyOrders === 1 ? "" : "s"} · {num(target.agent.sellable)} stock</span>
                      </span>
                    </div>
                  </div>
                )}

                {row.rebalanceUnits > 0 && row.sendUnits > 0 && (
                  <p className="m-0 mt-2 rounded-lg bg-blue-50 px-3 py-2 text-[11px] leading-relaxed text-blue-800">
                    {num(row.rebalanceUnits)} of those unit{row.rebalanceUnits === 1 ? "" : "s"} can come from another agent inside {row.state} - only {num(row.sendUnits)} truly has to be shipped in.
                  </p>
                )}

                {canManage && onCreateTransfer && (row.sendUnits > 0 || row.rebalanceUnits > 0) && (
                  <div className="mt-3 space-y-2">
                    {row.sendUnits > 0 && !target && row.agentCount === 0 && (
                      <p className="m-0 rounded-lg bg-amber-50 px-3 py-2 text-[11px] font-semibold leading-relaxed text-amber-900">
                        No agent covers {row.state} yet. Stock is sent to an agent, not to a state - assign one to {row.state} first,
                        then this becomes a transfer.
                      </p>
                    )}
                    {row.sendUnits > 0 && target && (
                      <button type="button"
                        onClick={() => onCreateTransfer({
                          productId: productId ?? undefined, quantity: sendUnits > 0 ? sendUnits : target.units,
                          toState: row.state, toAgentId: target.agent.agentId, toAgentLocationId: target.agent.locationId
                        })}
                        className="!min-h-0 flex w-full items-center justify-center gap-2 rounded-lg bg-rose-600 px-3 py-2.5 text-sm font-bold text-white hover:bg-rose-700">
                        <Truck className="h-4 w-4" /> Send {num(sendUnits)} Unit{sendUnits === 1 ? "" : "s"} to Agent
                      </button>
                    )}
                    <button type="button" onClick={() => onTab("transfer")}
                      className="!min-h-0 flex w-full items-center justify-center gap-2 rounded-lg border border-rose-200 px-3 py-2.5 text-sm font-bold text-rose-700 hover:bg-rose-50">
                      <ArrowLeftRight className="h-4 w-4" /> Create Transfer Plan
                    </button>
                  </div>
                )}
              </section>
            </div>

            <section className="mt-4 overflow-hidden rounded-xl border border-gray-200">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-4 py-3">
                <h4 className="m-0 text-sm font-bold text-gray-900">Recent Orders in {row.state}</h4>
                {onOpenOrders && (
                  <button type="button" onClick={() => onOpenOrders(row.state)} className="!min-h-0 text-xs font-bold text-blue-600 hover:underline">View All Orders →</button>
                )}
              </div>
              <OrderTable orders={recent} showNote />
            </section>
          </div>
        )}

        {tab === "orders" && (
          <div className="px-6 py-5">
            <h3 className="m-0 text-base font-black text-gray-950">Orders in {row.state}</h3>
            <p className="m-0 mb-3 text-[12px] text-gray-500">
              Every open order, strongest demand first. Only the {num(row.readyOrders)} ready one{row.readyOrders === 1 ? "" : "s"} drive the recommendation.
            </p>
            <div className="overflow-hidden rounded-xl border border-gray-200">
              <OrderTable
                orders={[...row.orders].sort((a, b) => DEMAND_TIER_ORDER.indexOf(a.tier) - DEMAND_TIER_ORDER.indexOf(b.tier))}
                showNote
              />
            </div>
          </div>
        )}

        {tab === "transfer" && (
          <TransferOptions row={row} rows={rows} productId={productId} canManage={canManage} onCreateTransfer={onCreateTransfer} />
        )}

        {tab === "performance" && (
          <div className="px-6 py-5">
            <h3 className="m-0 text-base font-black text-gray-950">State Performance</h3>
            <p className="m-0 mb-3 text-[12px] text-gray-500">
              Delivered demand over the last {lookbackDays} days, against what {row.state} is holding now.
            </p>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <StatCard label="Run rate" value={`${Math.round(row.dailySales * 10) / 10}`} foot="Units delivered / day" Icon={TrendingUp} tint="bg-blue-50 text-blue-600" />
              <StatCard label="Cover" value={row.dailySales > 0 ? `${Math.round((Math.max(0, row.sellable - row.readyUnits) / row.dailySales) * 10) / 10}` : "-"} foot="Days of free stock" Icon={PackageCheck} tint="bg-emerald-50 text-emerald-600" />
              <StatCard label="In transit" value={num(row.inTransit)} foot="Units already on the way" Icon={Truck} tint="bg-sky-50 text-sky-600" />
              <StatCard label="Revenue at risk" value={naira(row.atRiskRevenue)} foot="Ready orders their agent cannot cover" Icon={AlertTriangle} tint="bg-rose-50 text-rose-600" />
            </div>
            <div className="mt-4 overflow-hidden rounded-xl border border-gray-200">
              <table className="w-full text-left text-sm">
                <thead className="bg-gray-50/70 text-[10px] font-bold uppercase tracking-wider text-gray-500">
                  <tr>
                    <th className="px-3 py-2.5">Product</th>
                    <th className="px-3 py-2.5 text-right">Sellable</th>
                    <th className="px-3 py-2.5 text-right">Committed</th>
                    <th className="px-3 py-2.5 text-right">Ready units</th>
                    <th className="px-3 py-2.5 text-right">In transit</th>
                    <th className="px-3 py-2.5 text-right">Short by</th>
                    <th className="px-3 py-2.5 text-right">Can spare</th>
                  </tr>
                </thead>
                <tbody>
                  {row.byProduct.length === 0 ? (
                    <tr><td colSpan={7} className="px-4 py-8 text-center text-sm italic text-gray-400">No stock or open orders in {row.state}.</td></tr>
                  ) : row.byProduct.map((entry) => (
                    <tr key={entry.productId} className="border-t border-gray-50">
                      <td className="px-3 py-2.5 font-semibold text-gray-800">{entry.productName}</td>
                      <td className="px-3 py-2.5 text-right text-gray-700">{num(entry.sellable)}</td>
                      <td className="px-3 py-2.5 text-right text-gray-500">{num(entry.reserved)}</td>
                      <td className="px-3 py-2.5 text-right font-bold text-gray-900">{num(entry.readyUnits)}</td>
                      <td className={`px-3 py-2.5 text-right ${entry.inTransit > 0 ? "text-blue-600" : "text-gray-300"}`}>{entry.inTransit > 0 ? num(entry.inTransit) : "-"}</td>
                      <td className={`px-3 py-2.5 text-right font-bold ${entry.deficit > 0 ? "text-rose-600" : "text-gray-300"}`}>{entry.deficit > 0 ? num(entry.deficit) : "-"}</td>
                      <td className={`px-3 py-2.5 text-right ${entry.surplus > 0 ? "text-emerald-600" : "text-gray-300"}`}>{entry.surplus > 0 ? num(entry.surplus) : "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {tab === "notes" && (
          <div className="px-6 py-5">
            <h3 className="m-0 text-base font-black text-gray-950">Notes on {row.state}</h3>
            <p className="m-0 text-[12px] text-gray-500">
              Why a state that looks short was left alone - so the next person reading the same red row does not ship against
              a decision already made. Notes are kept, not edited.
            </p>
            <div className="mt-3 rounded-xl border border-gray-200 p-3">
              <textarea
                className="w-full resize-y rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-400"
                rows={3} maxLength={2000} value={noteDraft} onChange={(event) => onNoteDraft(event.target.value)}
                placeholder={`e.g. Agent travelling until Monday - holding the ${product?.productName ?? "transfer"} until then.`} />
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <span className="text-[11px] text-gray-400">
                  Saved against {row.state}{product ? ` · ${product.productName}` : ""}
                </span>
                <button type="button" onClick={onAddNote} disabled={noteSaving || !noteDraft.trim()}
                  className="!min-h-0 inline-flex items-center gap-2 rounded-lg bg-[#1F8FE0] px-3.5 py-2 text-sm font-bold text-white hover:bg-[#1560a8] disabled:opacity-50">
                  {noteSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />} Add Note
                </button>
              </div>
              {noteError && <p className="m-0 mt-2 rounded-lg bg-rose-50 px-3 py-2 text-[12px] font-semibold text-rose-700">{noteError}</p>}
            </div>

            <ul className="m-0 mt-4 list-none space-y-2 p-0">
              {!notesLoaded ? (
                <li className="flex items-center gap-2 text-[12px] text-gray-400"><Loader2 className="h-4 w-4 animate-spin" /> Loading notes...</li>
              ) : notes.length === 0 ? (
                <li className="rounded-xl border border-dashed border-gray-200 px-4 py-8 text-center text-sm italic text-gray-400">No notes on {row.state} yet.</li>
              ) : notes.map((note) => (
                <li key={note.id} className="rounded-xl border border-gray-200 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <strong className="text-[12px] font-bold text-gray-900">{note.createdByName || "Someone"}</strong>
                    <span className="text-[11px] text-gray-400">{shortDate(note.createdAt)}{note.productName ? ` · ${note.productName}` : ""}</span>
                  </div>
                  <p className="m-0 mt-1 whitespace-pre-wrap text-[13px] leading-relaxed text-gray-700">{note.body}</p>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex justify-end border-t border-gray-100 px-6 py-4">
          <button type="button" onClick={onClose}
            className="!min-h-0 rounded-lg border border-gray-200 px-5 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50">Close</button>
        </div>
      </div>
    </div>
  );
}
