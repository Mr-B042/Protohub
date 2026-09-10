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
  FileText, Loader2, MapPin, Package, PackageCheck, Search, ShoppingBag, ShoppingCart,
  CornerDownRight, SlidersHorizontal, Sparkles, TrendingUp, Truck, Users, X
} from "lucide-react";
import type { OpsCart, OpsOrder, OpsProduct, OpsStateHub, OpsWaybill } from "./InventoryLogisticsOperationsPage";
import { downloadCsv, num } from "./inventory-ops-model";
import { naira } from "../lib/money-privacy";
import { NIGERIA_ZONES, type NigeriaZone } from "../lib/nigeria";
import { stateReplenishmentNotesApi, type StateReplenishmentNote } from "../lib/api";
import {
  AGENT_STATUS_TONE, DEMAND_TIER_META, DEMAND_TIER_ORDER, PRIORITY_TONE,
  buildProductReplenishmentRows, buildStateReplenishmentRows, donorsFor,
  internalDonorsFor, priorityRank, receivingPlanFor,
  type AgentPosition, type CartDemandRow, type DemandTier, type ProductPosition, type ReplenishmentOrder,
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
  carts: OpsCart[];
  waybills: OpsWaybill[];
  lookbackDays: number;
  canManage: boolean;
  /** ⚠️ FALSE FOR "Inventory Manager & Logistics Operations". That role must not
   *  see money anywhere - the server already strips order amounts for them, and
   *  about sixty other places in the app gate on the same flag. This page did
   *  not, and showed them a naira figure. */
  canSeeMoney: boolean;
  /** False for the same role: it has never seen a customer name or phone
   *  anywhere in the app, so counts are shown instead of people. */
  canSeeCustomers: boolean;
  onCreateTransfer?: (request: ReplenishmentTransferRequest) => void;
  onOpenOrders?: (search: string) => void;
  onOpenAgent?: (agentId: string) => void;
};

type Tab = "overview" | "state" | "agent" | "product" | "forecast";
type SortKey = "priority" | "shortage" | "ready" | "stock" | "state";
type InlineTab = "agents" | "open" | "ready" | "carts" | "transfer";
type ModalTab = "agents" | "orders" | "carts" | "transfer" | "performance" | "notes";

const TABS: Array<{ key: Tab; label: string }> = [
  { key: "overview", label: "Overview" },
  { key: "state", label: "State View" },
  { key: "agent", label: "Agent View" },
  { key: "product", label: "Product View" },
  { key: "forecast", label: "Demand Forecast" }
];

const PRIORITIES: ReplenishmentPriority[] = ["Critical", "High", "Medium", "Low", "Healthy"];

const RECOMMENDATION_LABEL: Record<StateReplenishmentRow["recommendation"], string> = {
  "Replenish State": "Send stock in",
  "Rebalance Agents": "Move stock across",
  "Assign Orders": "Give orders to an agent",
  "Watch Demand": "Wait and see",
  "No Action": "Nothing to do"
};
const PRIORITY_LABEL: Record<ReplenishmentPriority, string> = {
  Critical: "Urgent", High: "Soon", Medium: "Keep an eye", Low: "Not yet", Healthy: "All good"
};
const AGENT_STATUS_LABEL: Record<AgentPosition["status"], string> = {
  Critical: "Cannot deliver", "Low Stock": "Not enough", Watch: "Nothing left", Healthy: "All good"
};

const RECOMMENDATION_TONE: Record<StateReplenishmentRow["recommendation"], string> = {
  "Replenish State": "text-rose-600",
  "Rebalance Agents": "text-orange-600",
  "Assign Orders": "text-blue-600",
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
  products, stateHubs, orders, carts, waybills, lookbackDays, canManage,
  canSeeMoney, canSeeCustomers, onCreateTransfer, onOpenOrders, onOpenAgent
}: Props) {
  const [tab, setTab] = useState<Tab>("overview");
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
    () => buildStateReplenishmentRows(products, stateHubs, orders, waybills, carts, { productIds, lookbackDays }),
    [products, stateHubs, orders, waybills, carts, productIds, lookbackDays]
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

  const needList = useMemo(() => {
    const term = search.trim().toLowerCase();
    return scoped
      .flatMap((row) => row.byProduct
        // ⚠️ "SHORT" IS NOT THE SAME AS "NEEDS STOCK MOVED", and listing the
        // first was nonsense on screen: Abia showed Edge Brusher Max as
        // "short by 3" with 61 units sitting in the state.
        //
        // `deficit` is the raw gap - what the waiting people need, counted
        // before anything is netted off. It stays that way because the maths
        // needs it. But an order with no agent yet, or a cart, adds to that gap
        // whether or not the units are already on the shelf, so a state with
        // plenty of stock still showed a shortage.
        //
        // This page is called Who Needs Stock. A line belongs on it when stock
        // has to travel: sent in because nobody here has enough, or moved
        // across because the agent who is short is not the agent holding it.
        // Stock already here, or already on its way, is not a shortage - those
        // orders need assigning, which the state row says and the footnote
        // below counts.
        .filter((entry) => entry.sendUnits > 0 || (entry.rebalanceUnits > 0 && row.agentShortages > 0))
        .map((entry) => ({
          row, entry,
          // A line is only truly urgent when the state cannot cover it at all.
          // Stock that is present but unassigned is paperwork, not a shortage.
          urgent: entry.sendUnits > 0,
          waiting: entry.readyUnits + entry.cartUnits
        })))
      .filter(({ row, entry }) => !term
        || row.state.toLowerCase().includes(term)
        || entry.productName.toLowerCase().includes(term))
      .sort((a, b) =>
        Number(b.urgent) - Number(a.urgent)
        || b.entry.sendUnits - a.entry.sendUnits
        || b.entry.deficit - a.entry.deficit
        || a.row.state.localeCompare(b.row.state));
  }, [scoped, search]);

  // Same lines, gathered under their state, with the customers behind them
  // worked out so the page can say when products travel together.
  const needGroups = useMemo(() => {
    const groups = new Map<string, { row: StateReplenishmentRow; lines: typeof needList }>();
    for (const line of needList) {
      const found = groups.get(line.row.key);
      if (found) found.lines.push(line);
      else groups.set(line.row.key, { row: line.row, lines: [line] });
    }
    return Array.from(groups.values()).map(({ row, lines }) => {
      // Main products first, each followed by whatever ships free with it. A
      // companion whose parent is not short here stays top-level, because
      // burying it under a product that is not on screen would hide it.
      const shortIds = new Set(lines.map((line) => line.entry.productId));
      const parentShown = (line: typeof lines[number]) =>
        line.entry.partOfProductId && shortIds.has(line.entry.partOfProductId)
          ? line.entry.partOfProductId : null;
      const mains = lines.filter((line) => !parentShown(line))
        .sort((a, b) => b.entry.sendUnits - a.entry.sendUnits || b.entry.deficit - a.entry.deficit);
      const ordered = mains.flatMap((main) => [
        main,
        ...lines.filter((line) => parentShown(line) === main.entry.productId)
          .sort((a, b) => b.entry.deficit - a.entry.deficit)
      ]);
      lines = ordered;
      // Who is actually waiting, per short product. Only ready orders and cart
      // people count - the same rule that built the shortage.
      const whoWants = (productId: string) => new Set<string>([
        ...row.orders.filter((order) => order.actionable && order.lines.some((l) => l.productId === productId))
          .map((order) => `o:${order.id || order.customer}`),
        ...row.carts.filter((cart) => cart.productId === productId).map((cart) => `c:${cart.id}`)
      ]);
      const sets = lines.map((line) => whoWants(line.entry.productId));
      const union = new Set(sets.flatMap((set) => [...set]));
      const shared = sets.length > 0
        ? [...sets[0]].filter((who) => sets.every((set) => set.has(who)))
        : [];
      // Anybody wanting every one of these products bought them as a package,
      // so those products ship together whatever else is going on.
      const travelTogether = lines.length > 1 && shared.length > 0;
      return {
        row, lines,
        customers: union.size,
        sharedCustomers: shared.length,
        mainCount: lines.filter((line) => !parentShown(line)).length,
        travelTogether,
        sendUnits: lines.reduce((sum, line) => sum + line.entry.sendUnits, 0),
        shortUnits: lines.reduce((sum, line) => sum + line.entry.deficit, 0),
        urgent: lines.some((line) => line.urgent)
      };
    }).sort((a, b) =>
      Number(b.urgent) - Number(a.urgent) || b.sendUnits - a.sendUnits || a.row.state.localeCompare(b.row.state));
  }, [needList]);

  // Demand that is already covered by stock in the state or stock on its way.
  // Not a shortage, but somebody still has to give those orders to an agent -
  // so it is counted and said out loud rather than silently dropped.
  const coveredByStockHere = useMemo(() => {
    const states = new Set<string>();
    let orders = 0;
    for (const row of scoped) {
      for (const entry of row.byProduct) {
        if (entry.deficit <= 0) continue;
        if (entry.sendUnits > 0 || (entry.rebalanceUnits > 0 && row.agentShortages > 0)) continue;
        states.add(row.key);
        orders += entry.deficit;
      }
    }
    return { states: states.size, units: orders };
  }, [scoped]);

  const needTotals = useMemo(() => ({
    lines: needList.length,
    urgentLines: needList.filter((entry) => entry.urgent).length,
    statesTouched: new Set(needList.map((entry) => entry.row.key)).size,
    productsTouched: new Set(needList.map((entry) => entry.entry.productId)).size,
    unitsToSend: needList.reduce((sum, entry) => sum + entry.entry.sendUnits, 0),
    peopleWaiting: needList.reduce((sum, entry) => sum + entry.waiting, 0)
  }), [needList]);

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
    cartCustomers: scoped.reduce((sum, row) => sum + row.cartCustomers, 0),
    cartUnits: scoped.reduce((sum, row) => sum + row.cartUnits, 0),
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
  const openModal = (row: StateReplenishmentRow, productId?: string) => {
    setModalKey(row.key);
    setModalTab("agents");
    setModalProductId(productId ?? row.byProduct[0]?.productId ?? "");
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

  const exportStates = () => downloadCsv("states-that-need-stock.csv", visible.map((row) => ({
    State: row.state, Zone: row.zone ?? "-", Agents: row.agentCount,
    "Stock we can sell": row.sellable, "Orders waiting": row.openOrders, "Customers ready": row.readyOrders,
    "Units ready customers need": row.readyUnits,
    "People from carts": row.cartCustomers, "Units for cart people": row.cartUnits,
    "Agents who cannot deliver": row.agentShortages,
    "Short or spare": row.position,
    "Units to send in": row.sendUnits, "Units to move between agents": row.rebalanceUnits,
    "Units on the way": row.inTransit,
    "What to do": RECOMMENDATION_LABEL[row.recommendation], "How urgent": PRIORITY_LABEL[row.priority],
    // A spreadsheet leaks just as well as a screen.
    ...(canSeeMoney ? { "Money at risk": row.atRiskRevenue } : {})
  })));
  const exportAgents = () => downloadCsv("what-each-agent-holds.csv", agentRows.map((agent) => ({
    Agent: agent.name, State: agent.state, Area: agent.area, Phone: agent.phone,
    "Stock we can sell": agent.sellable, "Kept for orders": agent.reserved, "Orders waiting": agent.openOrders,
    "Customers ready": agent.readyOrders, "Units ready customers need": agent.readyUnits,
    "Short or spare": agent.position, "Short by": agent.deficit, "Can give away": agent.surplus,
    Status: AGENT_STATUS_LABEL[agent.status]
  })));

  const rowPad = dense ? "px-3 py-2" : "px-3 py-3";
  const headCell = "px-3 py-3 text-[10px] font-bold uppercase tracking-wider text-gray-500";

  // ── Recommendation sentence ────────────────────────────────────────────────
  // One place, so the table cell, the inline panel and the modal cannot each
  // describe the same position differently.
  const recommendationText = (row: StateReplenishmentRow) => {
    if (row.recommendation === "Replenish State") return `Send ${num(row.sendUnits)} unit${row.sendUnits === 1 ? "" : "s"}`;
    return RECOMMENDATION_LABEL[row.recommendation];
  };
  const recommendationDetail = (row: StateReplenishmentRow) => {
    if (row.recommendation === "Replenish State") {
      const target = receivingPlanFor(row, modalProductIdFor(row))[0];
      return target ? `to ${target.agent.name}` : "to state agent";
    }
    if (row.recommendation === "Rebalance Agents") return "from another agent here";
    if (row.recommendation === "Assign Orders") return "the stock is already here";
    if (row.recommendation === "Watch Demand") return "hardly anyone is ready";
    return "";
  };
  // The products actually short here, worst first - at most two, so the cell
  // stays a cell.
  function shortestProducts(row: StateReplenishmentRow) {
    return row.byProduct.filter((entry) => entry.deficit > 0)
      .sort((a, b) => b.sendUnits - a.sendUnits || b.deficit - a.deficit)
      .slice(0, 2);
  }
  function modalProductIdFor(row: StateReplenishmentRow) {
    return productFilter === "all" ? null : (row.byProduct.find((entry) => entry.productId === productFilter)?.productId ?? null);
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="m-0 text-2xl font-bold text-gray-950">Who Needs Stock</h1>
          <p className="m-0 mt-0.5 text-sm text-gray-500">
            See which agents have run out, which states need more stock sent in, and which customers are ready to receive theirs.
          </p>
        </div>
        <button type="button" onClick={() => setShowHelp((value) => !value)}
          className="!min-h-0 inline-flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-xs font-bold text-blue-700 hover:bg-blue-100">
          <CircleHelp className="h-4 w-4" /> How it works
        </button>
      </header>

      {showHelp && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm leading-relaxed text-blue-900">
          <p className="m-0"><strong>Agents hold the stock, not states.</strong> A state can have plenty of stock in total and
            still let customers down, because the stock is with the agent who has no orders. So we count agent by agent first,
            then add it up.</p>
          <p className="m-0 mt-2"><strong>Only customers who are ready count.</strong> That means <em>Ready</em> (a rep spoke
            to them) or <em>Rescheduled</em> (they gave a day). Call Back, Not Answering and the rest still show on screen, but
            they never make us send stock - that is what stops a van crossing Nigeria for someone who never picks up.</p>
          <p className="m-0 mt-2"><strong>You get one of three answers.</strong> <em>Send stock in</em> - the agents there do not
            have enough between them. <em>Move stock across</em> - the state has enough, it is just with the wrong agent, so shift
            it over instead of shipping more. <em>Wait and see</em> - lots of people have ordered, but hardly any are ready yet.</p>
          <p className="m-0 mt-2 text-[12px] text-blue-800">
            How we work out what to send: what each agent is short, take away what other agents nearby can give, take away what
            is already on the way. Nothing here moves stock by itself - every button just opens the transfer form for you to check
            and confirm.
          </p>
        </div>
      )}

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="States that need stock" value={num(totals.statesNeeding)}
          foot={`${num(totals.statesRebalancing)} more can sort it out on their own`}
          Icon={Package} tint="bg-rose-50 text-rose-600" />
        <Kpi label="Agents who cannot deliver" value={num(totals.agentShortages)}
          foot={`In ${num(totals.statesAffected)} state${totals.statesAffected === 1 ? "" : "s"}`}
          Icon={Users} tint="bg-orange-50 text-orange-600" />
        <Kpi label="Customers ready right now" value={num(totals.readyOrders + totals.cartCustomers)}
          foot={totals.cartCustomers > 0
            ? `${num(totals.readyOrders)} ordered · ${num(totals.cartCustomers)} said yes on a call`
            : `Waiting on ${num(totals.agentsWithReady)} agent${totals.agentsWithReady === 1 ? "" : "s"}`}
          Icon={ShoppingCart} tint="bg-emerald-50 text-emerald-600" />
        <Kpi label="Units to move" value={num(totals.unitsRecommended)}
          foot={canSeeMoney
            ? `${naira(totals.atRiskRevenue)} of orders could be lost`
            : `${num(totals.readyOrders + totals.cartCustomers)} order${totals.readyOrders + totals.cartCustomers === 1 ? "" : "s"} could be lost`}
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
                        The states I can see (CSV)
                      </button>
                      <button type="button" onClick={() => { exportAgents(); setExportOpen(false); }}
                        className="!min-h-0 block w-full border-t border-gray-100 px-3 py-2.5 text-left text-sm font-semibold text-gray-700 hover:bg-gray-50">
                        Every agent and what they hold (CSV)
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
                  placeholder={tab === "overview" ? "Search state or product..." : tab === "product" ? "Search product..." : tab === "agent" ? "Search agent..." : "Search state..."}
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
                <option value="all">Any urgency</option>
                {PRIORITIES.map((entry) => <option key={entry} value={entry}>{PRIORITY_LABEL[entry]}</option>)}
              </select>
              <label className="ml-auto flex items-center gap-2 text-sm font-semibold text-gray-600">
                <span className="hidden sm:inline">Sort by</span>
                <select className="!min-h-0 rounded-lg border border-gray-200 px-3 py-2 text-sm" value={sortBy}
                  onChange={(event) => setSortBy(event.target.value as SortKey)}>
                  <option value="priority">Most urgent first</option>
                  <option value="shortage">Most units short</option>
                  <option value="ready">Most customers ready</option>
                  <option value="stock">Least stock left</option>
                  <option value="state">State name (A-Z)</option>
                </select>
              </label>
              <button type="button" onClick={() => setDense((value) => !value)} title={dense ? "Comfortable rows" : "Compact rows"}
                className={`!min-h-0 rounded-lg border px-2.5 py-2 ${dense ? "border-blue-200 bg-blue-50 text-blue-700" : "border-gray-200 text-gray-500 hover:bg-gray-50"}`}>
                <SlidersHorizontal className="h-4 w-4" />
              </button>
            </div>

            {tab === "overview" && (
              <div>
                <div className="grid grid-cols-2 gap-3 border-b border-gray-100 p-4 md:grid-cols-4">
                  <StatCard label="States to sort out" value={num(needTotals.statesTouched)}
                    foot={`${num(needTotals.productsTouched)} product${needTotals.productsTouched === 1 ? "" : "s"} between them`}
                    Icon={AlertTriangle} tint="bg-rose-50 text-rose-600" />
                  <StatCard label="Units to send" value={num(needTotals.unitsToSend)}
                    foot="After in-state spare and stock on the way" Icon={Truck} tint="bg-violet-50 text-violet-600" />
                  <StatCard label="People waiting" value={num(needTotals.peopleWaiting)}
                    foot="Units they are waiting for" Icon={Users} tint="bg-amber-50 text-amber-600" />
                  {canSeeMoney ? (
                    <StatCard label="Money at risk" value={naira(totals.atRiskRevenue)}
                      foot="Orders their agent cannot fill" Icon={TrendingUp} tint="bg-emerald-50 text-emerald-600" />
                  ) : (
                    <StatCard label="Orders at risk" value={num(totals.readyOrders + totals.cartCustomers)}
                      foot="Their agent cannot fill these" Icon={TrendingUp} tint="bg-emerald-50 text-emerald-600" />
                  )}
                </div>

                <p className="m-0 border-b border-gray-100 bg-blue-50/60 px-4 py-2.5 text-[12px] leading-relaxed text-blue-900">
                  <strong>One block per state, one shipment each.</strong> A state total hides which product is short:
                  Cross River can read "160 in stock" while holding none at all of the shelf its customers are waiting for.
                  A package also brings its free gifts, so one order needs several products - those are grouped here rather
                  than listed as separate jobs. Everything you need is on this screen; you should not have to open a state.
                </p>

                <div className="overflow-x-auto">
                  <table className="w-full min-w-[940px] text-left text-sm">
                    <thead>
                      <tr className="border-b border-gray-100 bg-gray-50/70">
                        <th className={headCell}>Where / what</th>
                        <th className={`${headCell} text-right`} title="Units of THIS product in this state - not the state's total stock.">
                          Stock<span className="block normal-case text-gray-400">of this one</span></th>
                        <th className={`${headCell} text-right`}>Waiting<span className="block normal-case text-gray-400">units</span></th>
                        <th className={`${headCell} text-right`}>Short by</th>
                        <th className={`${headCell} text-right`}>On the way</th>
                        <th className={headCell}>What to do</th>
                        <th className={`${headCell} text-right`}>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {needGroups.length === 0 ? (
                        <tr><td colSpan={7} className="px-4 py-12 text-center text-sm italic text-gray-400">
                          Nothing needs stock moved right now.
                          {coveredByStockHere.units > 0
                            ? ` ${num(coveredByStockHere.units)} unit${coveredByStockHere.units === 1 ? "" : "s"} are waiting on stock that is already there or on its way - those orders just need giving to an agent.`
                            : " Every customer who is ready can be served."}
                        </td></tr>
                      ) : needGroups.map((group, groupIndex) => (
                        <Fragment key={group.row.key}>
                          {/* One block per state. Everything under it goes on the
                              same lorry, so it is one job, not one per product. */}
                          <tr className="border-b border-gray-100 bg-gray-50/60">
                            <td className="px-3 py-2.5">
                              <span className="flex items-center gap-2">
                                <span className="text-gray-400">{groupIndex + 1}</span>
                                <strong className="text-[15px] font-black text-gray-950">{group.row.state}</strong>
                                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${PRIORITY_TONE[group.row.priority]}`}>{PRIORITY_LABEL[group.row.priority]}</span>
                              </span>
                              <span className="mt-0.5 block text-[11px] text-gray-500">
                                {group.row.agentCount} agent{group.row.agentCount === 1 ? "" : "s"} · {group.row.zone ?? "Unzoned"} ·{" "}
                                {num(group.customers)} {group.customers === 1 ? "person" : "people"} waiting
                              </span>
                            </td>
                            <td colSpan={4} className="px-3 py-2.5">
                              {/* ⚠️ A package ships with its free gifts, so ONE order
                                  becomes several product lines. Saying so is the
                                  difference between one job and three. */}
                              {group.travelTogether ? (
                                <span className="inline-flex items-start gap-1.5 rounded-lg bg-blue-50 px-2.5 py-1.5 text-[11px] font-semibold leading-relaxed text-blue-900">
                                  <Package className="mt-0.5 h-3 w-3 shrink-0" />
                                  {group.sharedCustomers === group.customers
                                    ? `These ${group.lines.length} go out together - the same ${num(group.customers)} ${group.customers === 1 ? "person" : "people"} ordered all of them as one package.`
                                    : `${num(group.sharedCustomers)} of these ${num(group.customers)} people ordered all ${group.lines.length} as one package, so those go out together.`}
                                </span>
                              ) : group.lines.length > 1 ? (
                                <span className="text-[11px] text-gray-500">
                                  {group.mainCount === group.lines.length
                                    ? `${group.lines.length} different products short here`
                                    : `${num(group.mainCount)} product${group.mainCount === 1 ? "" : "s"} short here, plus ${num(group.lines.length - group.mainCount)} that ship free with ${group.mainCount === 1 ? "it" : "them"}`}
                                </span>
                              ) : null}
                            </td>
                            <td className="px-3 py-2.5">
                              <strong className={`block text-[12px] font-bold ${group.sendUnits > 0 ? "text-rose-600" : "text-blue-600"}`}>
                                {group.sendUnits > 0 ? `Send ${num(group.sendUnits)} unit${group.sendUnits === 1 ? "" : "s"} in total` : "Give the orders to an agent"}
                              </strong>
                              <span className="block text-[11px] text-gray-400">{group.sendUnits > 0 ? "one shipment" : "the stock is already here"}</span>
                            </td>
                            <td className="px-3 py-2.5 text-right">
                              <button type="button" onClick={() => openModal(group.row, group.lines[0].entry.productId)}
                                className="!min-h-0 rounded-lg border border-blue-200 bg-white px-3 py-1.5 text-xs font-bold text-blue-700 hover:bg-blue-50">View</button>
                            </td>
                          </tr>
                          {group.lines.map(({ row, entry, urgent, waiting }) => {
                            const ridesWithShown = entry.partOfProductId
                              && group.lines.some((line) => line.entry.productId === entry.partOfProductId);
                            return (
                            <tr key={`${row.key}-${entry.productId}`} className="border-b border-gray-50 hover:bg-gray-50/40">
                              <td className={`${rowPad} ${ridesWithShown ? "pl-16" : "pl-10"}`}>
                                {ridesWithShown ? (
                                  <span className="flex items-start gap-1.5">
                                    <CornerDownRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-300" />
                                    <span>
                                      <span className="font-semibold text-gray-700">{entry.productName}</span>
                                      <span className="block text-[11px] text-gray-400">free with the {entry.partOfProductName}</span>
                                    </span>
                                  </span>
                                ) : (
                                  <span className="font-bold text-gray-900">{entry.productName}</span>
                                )}
                              </td>
                              <td className={`${rowPad} text-right`}>
                                <span className={`inline-flex min-w-9 justify-center rounded-md px-2 py-1 text-xs font-bold ${
                                  entry.sellable === 0 ? "bg-rose-50 text-rose-700" : "bg-amber-50 text-amber-700"}`}>{num(entry.sellable)}</span>
                              </td>
                              <td className={`${rowPad} text-right font-bold text-gray-900`}>
                                {num(waiting)}
                                {entry.cartUnits > 0 && (
                                  <span className="ml-1 inline-flex items-center gap-0.5 rounded-full bg-violet-50 px-1.5 py-0.5 text-[10px] font-bold text-violet-700"
                                    title={`${num(entry.cartUnits)} of these are for people who left a cart and said yes on a call`}>
                                    <ShoppingBag className="h-2.5 w-2.5" />{num(entry.cartUnits)}
                                  </span>
                                )}
                              </td>
                              <td className={`${rowPad} text-right`}>
                                <span className="inline-flex min-w-9 justify-center rounded-md bg-rose-50 px-2 py-1 text-xs font-bold text-rose-700">{num(entry.deficit)}</span>
                              </td>
                              <td className={`${rowPad} text-right ${entry.inTransit > 0 ? "text-blue-600" : "text-gray-300"}`}>{entry.inTransit > 0 ? num(entry.inTransit) : "-"}</td>
                              <td className={rowPad}>
                                {urgent ? (
                                  <span className="text-[12px] font-bold text-rose-600">Send {num(entry.sendUnits)}</span>
                                ) : entry.rebalanceUnits > 0 && row.agentShortages > 0 ? (
                                  <span className="text-[12px] font-bold text-orange-600">Move {num(entry.rebalanceUnits)} across</span>
                                ) : (
                                  <span className="text-[12px] font-bold text-blue-600">Already here</span>
                                )}
                              </td>
                              <td className={`${rowPad} text-right`}>
                                <button type="button" onClick={() => openModal(row, entry.productId)}
                                  className="!min-h-0 rounded-lg px-2 py-1 text-[11px] font-bold text-gray-500 hover:bg-gray-100">Open</button>
                              </td>
                            </tr>
                            );
                          })}
                        </Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="m-0 border-t border-gray-100 px-4 py-3 text-xs text-gray-400">
                  Only products that need stock moved are listed. "Short by" counts people who ordered plus people who left a
                  cart and said yes on a call; "Send" then takes off what agents here can spare and what is already on the way.
                  Products marked as going out together are one package - the same customers ordered all of them.
                  {coveredByStockHere.units > 0 && (
                    <span className="mt-1 block text-gray-500">
                      Another {num(coveredByStockHere.units)} unit{coveredByStockHere.units === 1 ? "" : "s"} across{" "}
                      {num(coveredByStockHere.states)} state{coveredByStockHere.states === 1 ? "" : "s"} {coveredByStockHere.units === 1 ? "is" : "are"} already
                      covered by stock there or stock on the way - those orders just need giving to an agent. See State View.
                    </span>
                  )}
                </p>
              </div>
            )}

            {tab === "state" && (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[980px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50/70">
                      <th className={`${headCell} w-10`}>#</th>
                      <th className={`${headCell} w-8`} />
                      <th className={headCell}>State</th>
                      <th className={`${headCell} text-right`} title="How many agents hold stock in this state.">
                        Agents<span className="block normal-case text-gray-400">in state</span></th>
                      <th className={`${headCell} text-right`} title="Units the agents here actually have, ready to sell.">
                        Stock<span className="block normal-case text-gray-400">we can sell</span></th>
                      <th className={`${headCell} text-right`} title="Every order still open here, however likely the customer is.">
                        Orders<span className="block normal-case text-gray-400">all waiting</span></th>
                      <th className={`${headCell} text-right`} title="Customers a rep confirmed, or who gave a delivery date. Only these move stock.">
                        Ready<span className="block normal-case text-gray-400">will take it now</span></th>
                      <th className={`${headCell} text-right`} title="People who left a cart, said yes when a rep rang, and never placed the order. They still need stock.">
                        From cart<span className="block normal-case text-gray-400">said yes on a call</span></th>
                      <th className={`${headCell} text-right`} title="Agents here who cannot serve their own ready customers.">
                        Agents short<span className="block normal-case text-gray-400">cannot deliver</span></th>
                      <th className={`${headCell} text-right`} title="Stock left once every ready customer is served. A minus means not enough.">
                        Short or spare<span className="block normal-case text-gray-400">after ready ones</span></th>
                      <th className={headCell}>How urgent</th>
                      <th className={headCell}>What to do</th>
                      <th className={`${headCell} text-right`}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.length === 0 ? (
                      <tr><td colSpan={13} className="px-4 py-12 text-center text-sm italic text-gray-400">
                        {actionOnly ? "Nothing needs stock moved right now." : "No state matches what you picked."}
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
                            {row.cartCustomers > 0 ? (
                              <span className="inline-flex items-center gap-1 rounded-md bg-violet-50 px-2 py-1 text-xs font-bold text-violet-700"
                                title={`${row.cartCustomers} left a cart and said yes when we rang · ${num(row.cartUnits)} unit${row.cartUnits === 1 ? "" : "s"}`}>
                                <ShoppingBag className="h-3 w-3" />{num(row.cartCustomers)}
                              </span>
                            ) : <span className="text-xs text-gray-300">-</span>}
                          </td>
                          <td className={`${rowPad} text-right`}>
                            <span className={`inline-flex min-w-9 justify-center rounded-md px-2 py-1 text-xs font-bold ${
                              row.agentShortages > 0 ? "bg-rose-50 text-rose-700" : "bg-gray-100 text-gray-500"}`}>{num(row.agentShortages)}</span>
                          </td>
                          <td className={`${rowPad} text-right`}>
                            <span className={`inline-flex min-w-9 justify-center rounded-md px-2 py-1 text-xs font-bold ${signedTone(row.position)}`}>{signed(row.position)}</span>
                          </td>
                          <td className={rowPad}>
                            <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-bold ${PRIORITY_TONE[row.priority]}`}>{PRIORITY_LABEL[row.priority]}</span>
                          </td>
                          <td className={rowPad}>
                            <strong className={`block text-[12px] font-bold ${RECOMMENDATION_TONE[row.recommendation]}`}>{recommendationText(row)}</strong>
                            {/* ⚠️ WHICH PRODUCT. Without this the row says "send 3
                                units" next to "160 in stock" and the only way to
                                learn what is actually short is to open the state. */}
                            {shortestProducts(row).length > 0 ? (
                              <span className="block text-[11px] text-gray-500">
                                {shortestProducts(row).map((entry) => entry.productName).join(", ")}
                                {row.byProduct.filter((entry) => entry.deficit > 0).length > 2 && " +more"}
                              </span>
                            ) : recommendationDetail(row) ? (
                              <span className="block text-[11px] text-gray-400">({recommendationDetail(row)})</span>
                            ) : null}
                          </td>
                          <td className={`${rowPad} text-right`}>
                            <button type="button" onClick={() => openModal(row)}
                              className="!min-h-0 rounded-lg border border-blue-200 bg-white px-3 py-1.5 text-xs font-bold text-blue-700 hover:bg-blue-50">View</button>
                          </td>
                        </tr>
                        {expanded.has(row.key) && (
                          <tr className="border-b border-gray-100 bg-gray-50/70">
                            <td colSpan={13} className="px-10 py-3">
                              <p className="m-0 mb-2 text-[10px] font-bold uppercase tracking-wider text-gray-500">Each product in {row.state}</p>
                              <table className="w-full text-left text-xs">
                                <thead className="text-[10px] uppercase tracking-wider text-gray-400">
                                  <tr>
                                    <th className="pb-1.5">Product</th>
                                    <th className="pb-1.5 text-right">Stock</th>
                                    <th className="pb-1.5 text-right">Kept for orders</th>
                                    <th className="pb-1.5 text-right">Needed now</th>
                                    <th className="pb-1.5 text-right">From cart</th>
                                    <th className="pb-1.5 text-right">On the way</th>
                                    <th className="pb-1.5 text-right">Short by</th>
                                    <th className="pb-1.5 text-right">Can give away</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {row.byProduct.length === 0 ? (
                                    <tr><td colSpan={8} className="py-2 italic text-gray-400">No stock here, and nobody has ordered.</td></tr>
                                  ) : row.byProduct.map((entry) => (
                                    <tr key={entry.productId} className="border-t border-gray-200/70">
                                      <td className="py-1.5 font-semibold text-gray-800">{entry.productName}</td>
                                      <td className="py-1.5 text-right text-gray-700">{num(entry.sellable)}</td>
                                      <td className="py-1.5 text-right text-gray-500">{num(entry.reserved)}</td>
                                      <td className="py-1.5 text-right font-bold text-gray-900">{num(entry.readyUnits)}</td>
                                      <td className={`py-1.5 text-right ${entry.cartUnits > 0 ? "font-bold text-violet-700" : "text-gray-300"}`}>{entry.cartUnits > 0 ? num(entry.cartUnits) : "-"}</td>
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
                      <th className={`${headCell} text-right`} title="Units this agent has, ready to sell.">Stock</th>
                      <th className={`${headCell} text-right`} title="Units already promised to open orders.">Kept for orders</th>
                      <th className={`${headCell} text-right`}>Orders</th>
                      <th className={`${headCell} text-right`}>Ready</th>
                      <th className={`${headCell} text-right`} title="Stock left once this agent serves its ready customers. A minus means not enough.">Short or spare</th>
                      <th className={`${headCell} text-right`} title="Units no customer is waiting on - what this agent can hand over.">Can give away</th>
                      <th className={headCell}>Status</th>
                      <th className={`${headCell} text-right`}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {agentRows.length === 0 ? (
                      <tr><td colSpan={11} className="px-4 py-12 text-center text-sm italic text-gray-400">No agent is short, and none has stock to spare.</td></tr>
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
                          <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-bold ${AGENT_STATUS_TONE[agent.status]}`}>{AGENT_STATUS_LABEL[agent.status]}</span>
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
                      <th className={`${headCell} text-right`}>Stock</th>
                      <th className={`${headCell} text-right`}>Kept for orders</th>
                      <th className={`${headCell} text-right`}>Needed now</th>
                      <th className={`${headCell} text-right`}>On the way</th>
                      <th className={`${headCell} text-right`}>Agents short</th>
                      <th className={`${headCell} text-right`}>Short by</th>
                      <th className={headCell}>States short</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleProductRows.length === 0 ? (
                      <tr><td colSpan={9} className="px-4 py-12 text-center text-sm italic text-gray-400">No product is short of what ready customers need.</td></tr>
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
                    The people ready today are already counted. This adds what the last {lookbackDays} days of{" "}
                    <strong>delivered</strong> orders suggest the next{" "}
                    <select className="!min-h-0 rounded-md border border-gray-200 bg-white px-2 py-1 text-[12px] font-bold"
                      value={horizonDays} onChange={(event) => setHorizonDays(Number(event.target.value))}>
                      <option value={7}>7 days</option><option value={14}>14 days</option><option value={30}>30 days</option>
                    </select>{" "}
                    will bring on top of them.
                  </p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[920px] text-left text-sm">
                    <thead>
                      <tr className="border-b border-gray-100 bg-gray-50/70">
                        <th className={`${headCell} w-10`}>#</th>
                        <th className={headCell}>State</th>
                        <th className={`${headCell} text-right`}>Stock</th>
                        <th className={`${headCell} text-right`}>On the way</th>
                        <th className={`${headCell} text-right`}>Ready now</th>
                        <th className={`${headCell} text-right`} title="Units delivered per day over the window.">
                          Sold a day<span className="block normal-case text-gray-400">on average</span></th>
                        <th className={`${headCell} text-right`} title="How long the free stock lasts at that rate.">
                          Days left<span className="block normal-case text-gray-400">before empty</span></th>
                        <th className={`${headCell} text-right`}>Orders expected<span className="block normal-case text-gray-400">next {horizonDays} days</span></th>
                        <th className={`${headCell} text-right`}>Units to keep</th>
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
                  We only count orders actually delivered, so a state that has never delivered shows a dash instead of a
                  flattering number. This tab is a guess about the future - it never sends stock on its own.
                </p>
              </div>
            )}

            <p className="m-0 border-t border-gray-100 px-4 py-3 text-xs text-gray-400">
              {tab === "overview" && `${needGroups.length} state${needGroups.length === 1 ? "" : "s"} to sort out, ${needList.length} product line${needList.length === 1 ? "" : "s"} · `}
              {tab === "state" && `Showing ${visible.length} of ${rows.length} states · `}
              {tab === "agent" && `Showing ${agentRows.length} agent hubs · `}
              {tab === "product" && `Showing ${visibleProductRows.length} of ${productRows.length} products · `}
"Ready" means the customer is confirmed or gave a date. "Orders" means everyone who has ordered and not cancelled.
            </p>
          </section>

          {selected && (
            <StateDetailPanel
              row={selected}
              tab={inlineTab}
              rows={rows}
              productFilter={productFilter === "all" ? null : productFilter}
              canManage={canManage}
              canSeeCustomers={canSeeCustomers}
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
                <span className="mb-1 block text-[11px] font-semibold text-gray-500">How urgent</span>
                <select className="!min-h-0 w-full rounded-lg border border-gray-200 px-2 py-2 text-sm" value={priorityFilter}
                  onChange={(event) => setPriorityFilter(event.target.value as "all" | ReplenishmentPriority)}>
                  <option value="all">Any urgency</option>
                  {PRIORITIES.map((entry) => <option key={entry} value={entry}>{PRIORITY_LABEL[entry]}</option>)}
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
              <span className="text-[12px] font-semibold text-gray-600">Only show states I need to act on</span>
              <button type="button" role="switch" aria-checked={actionOnly} onClick={() => setActionOnly((value) => !value)}
                className={`relative h-6 w-11 shrink-0 !min-h-0 rounded-full p-0 transition-colors ${actionOnly ? "bg-[#1F8FE0]" : "bg-gray-200"}`}>
                <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${actionOnly ? "left-5" : "left-0.5"}`} />
              </button>
            </div>
          </section>

          <section className="rounded-xl border border-gray-200 bg-white p-4">
            <h2 className="m-0 text-sm font-bold text-gray-900">How sure is this customer?</h2>
            <p className="m-0 mt-1 text-[11px] leading-relaxed text-gray-400">
              Your own order statuses, sorted by how likely the person is to really take the delivery.
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
              Only <strong className="text-gray-700">Ready</strong> and <strong className="text-gray-700">Rescheduled</strong> make us
              send stock. The rest are shown so you can see them, but we never ship for them.
            </p>
          </section>

          <section className="rounded-xl border border-blue-200 bg-blue-50 p-4">
            <div className="flex items-start gap-2.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-blue-600"><PackageCheck className="h-4 w-4" /></span>
              <div>
                <h2 className="m-0 text-sm font-bold text-blue-900">Stock moves by agent</h2>
                <p className="m-0 mt-1 text-[12px] leading-relaxed text-blue-800">
                  We sell through state agents. Stock goes to one named agent, never to a state - so a state that looks fine on
                  paper can still have an agent with nothing left to deliver.
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
          canSeeMoney={canSeeMoney}
          canSeeCustomers={canSeeCustomers}
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
            <th className="px-3 py-2.5 text-right" title="Units on hand, minus anything damaged or missing.">Stock</th>
            <th className="px-3 py-2.5 text-right" title="Units already promised to open orders.">Kept for orders</th>
            <th className="px-3 py-2.5 text-right">Orders</th>
            <th className="px-3 py-2.5 text-right">Ready</th>
            <th className="px-3 py-2.5 text-right" title="Stock left once this agent serves its ready customers. A minus means not enough.">Short or spare</th>
            <th className="px-3 py-2.5">Status</th>
            <th className="px-3 py-2.5 text-right">Action</th>
          </tr>
        </thead>
        <tbody>
          {agents.length === 0 ? (
            <tr><td colSpan={10} className="px-4 py-8 text-center text-sm italic text-gray-400">No agent has been set up in this state yet.</td></tr>
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
                  <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-bold ${AGENT_STATUS_TONE[agent.status]}`}>{AGENT_STATUS_LABEL[agent.status]}</span>
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

function OrderTable({ orders, showNote, canSeeCustomers = true }: {
  orders: ReplenishmentOrder[]; showNote?: boolean; canSeeCustomers?: boolean;
}) {
  const columns = (canSeeCustomers ? 8 : 6) + (showNote ? 1 : 0);
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[820px] text-left text-sm">
        <thead>
          <tr className="border-b border-gray-100 bg-gray-50/70 text-[10px] font-bold uppercase tracking-wider text-gray-500">
            <th className="px-3 py-2.5">Order</th>
            {canSeeCustomers && <th className="px-3 py-2.5">Customer</th>}
            {canSeeCustomers && <th className="px-3 py-2.5">Phone</th>}
            <th className="px-3 py-2.5">Agent</th>
            <th className="px-3 py-2.5 text-right">Units</th>
            <th className="px-3 py-2.5">Status</th>
            <th className="px-3 py-2.5" title="How likely this customer is to actually take delivery.">How sure</th>
            <th className="px-3 py-2.5">Ordered</th>
            {showNote && <th className="px-3 py-2.5">Notes</th>}
          </tr>
        </thead>
        <tbody>
          {orders.length === 0 ? (
            <tr><td colSpan={columns} className="px-4 py-8 text-center text-sm italic text-gray-400">No orders here.</td></tr>
          ) : orders.map((order) => (
            <tr key={order.id || `${order.customer}-${order.createdAt}`} className="border-b border-gray-50">
              <td className="px-3 py-2.5 font-semibold text-gray-500">{order.id || "-"}</td>
              {canSeeCustomers && <td className="px-3 py-2.5 font-bold text-gray-900">{order.customer}</td>}
              {canSeeCustomers && <td className="px-3 py-2.5 text-gray-600">{order.phone || "-"}</td>}
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

function CartTable({ carts, state, canSeeCustomers = true }: { carts: CartDemandRow[]; state: string; canSeeCustomers?: boolean }) {
  return (
    <div>
      <p className="m-0 border-b border-gray-100 bg-violet-50/60 px-4 py-2.5 text-[12px] leading-relaxed text-violet-900">
        <strong>These people never placed an order.</strong> They left a cart, a rep rang them, and they said yes.
        They still need stock, so they count towards the shortage - but they are kept apart from real orders here so you can
        judge them yourself.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] text-left text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/70 text-[10px] font-bold uppercase tracking-wider text-gray-500">
              {canSeeCustomers && <th className="px-3 py-2.5">Customer</th>}
              {canSeeCustomers && <th className="px-3 py-2.5">Phone</th>}
              <th className="px-3 py-2.5">Product</th>
              <th className="px-3 py-2.5 text-right">Units</th>
              <th className="px-3 py-2.5">They said</th>
              <th className="px-3 py-2.5">Where they are</th>
              <th className="px-3 py-2.5">Last call</th>
            </tr>
          </thead>
          <tbody>
            {carts.length === 0 ? (
              <tr><td colSpan={canSeeCustomers ? 7 : 5} className="px-4 py-8 text-center text-sm italic text-gray-400">Nobody in {state} left a cart and said yes.</td></tr>
            ) : carts.map((cart) => (
              <tr key={cart.id} className="border-b border-gray-50">
                {canSeeCustomers && (
                  <td className="px-3 py-2.5">
                    <strong className="block font-bold text-gray-900">{cart.customer}</strong>
                    <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-1.5 py-0.5 text-[10px] font-bold text-violet-700">
                      <ShoppingBag className="h-2.5 w-2.5" /> From cart
                    </span>
                  </td>
                )}
                {canSeeCustomers && <td className="px-3 py-2.5 text-gray-600">{cart.phone || "-"}</td>}
                <td className="px-3 py-2.5 text-gray-700">{cart.productName}</td>
                <td className="px-3 py-2.5 text-right font-bold text-gray-900">{num(cart.quantity)}</td>
                <td className="px-3 py-2.5">
                  <span className="inline-flex rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[11px] font-bold text-violet-700">{cart.lastOutcomeCode}</span>
                </td>
                <td className="px-3 py-2.5">
                  <span className="block text-[12px] text-gray-700">{cart.city || "Not given"}</span>
                  {/* ⚠️ A worked-out state can be wrong. Saying so is the only
                      thing that lets somebody catch it before stock moves. */}
                  {cart.stateSource === "guessed-from-city" && (
                    <span className="mt-0.5 inline-flex items-center gap-1 rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-700"
                      title="The customer left the state blank. We worked it out from the town they typed - check it before sending stock.">
                      <AlertTriangle className="h-2.5 w-2.5" /> State worked out
                    </span>
                  )}
                  {cart.stateSource === "read-from-text" && (
                    <span className="mt-0.5 block text-[10px] text-gray-400">State read from the address</span>
                  )}
                </td>
                <td className="px-3 py-2.5 text-gray-500">{shortDate(cart.lastOutcomeAt) || "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
            <h3 className="m-0 text-sm font-bold text-gray-900">Try inside {row.state} first</h3>
            <p className="m-0 text-[11px] text-gray-500">Agents here with stock that no customer is already waiting on.</p>
          </div>
          <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${row.rebalanceUnits > 0 ? "bg-orange-50 text-orange-700" : "bg-gray-100 text-gray-500"}`}>
            {row.rebalanceUnits > 0 ? `${num(row.rebalanceUnits)} unit${row.rebalanceUnits === 1 ? "" : "s"} can come from here` : "Nobody here has spare"}
          </span>
        </div>
        {internal.length === 0 ? (
          <p className="m-0 px-4 py-6 text-center text-sm italic text-gray-400">No agent in {row.state} has anything to spare.</p>
        ) : (
          <ul className="m-0 list-none divide-y divide-gray-50 p-0">
            {internal.map((donor) => (
              <li key={donor.agent.key} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-50 text-[11px] font-black text-emerald-700">{initials(donor.agent.name)}</span>
                <span className="min-w-0 flex-1">
                  <strong className="block text-sm font-bold text-gray-900">{donor.agent.name}</strong>
                  <span className="block text-[11px] text-gray-500">{donor.agent.area || row.state} · {num(donor.units)} to spare · {num(donor.agent.readyOrders)} customer{donor.agent.readyOrders === 1 ? "" : "s"} of their own</span>
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
            <h3 className="m-0 text-sm font-bold text-gray-900">Spare stock in other states</h3>
            <p className="m-0 text-[11px] text-gray-500">Closest first. Just a suggestion about distance - orders still go to the agent in the customer's own state.</p>
          </div>
          <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${row.sendUnits > 0 ? "bg-rose-50 text-rose-700" : "bg-gray-100 text-gray-500"}`}>
            {row.sendUnits > 0 ? `${num(row.sendUnits)} still to find` : "Nothing needed from outside"}
          </span>
        </div>
        {external.length === 0 ? (
          <p className="m-0 px-4 py-6 text-center text-sm italic text-gray-400">No agent anywhere has this product to spare.</p>
        ) : (
          <ul className="m-0 list-none divide-y divide-gray-50 p-0">
            {external.map((donor) => (
              <li key={`${donor.agent.stateKey}-${donor.agent.key}`} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-50 text-[11px] font-black text-blue-700">{initials(donor.agent.name)}</span>
                <span className="min-w-0 flex-1">
                  <strong className="block text-sm font-bold text-gray-900">{donor.agent.name}</strong>
                  <span className="block text-[11px] text-gray-500">
                    {donor.agent.state}{donor.agent.area ? ` · ${donor.agent.area}` : ""} · {num(donor.units)} to spare
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
                    <Truck className="h-3.5 w-3.5" /> Send from here
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
  row, tab, rows, productFilter, canManage, canSeeCustomers, dense, onTab, onClose, onCreateTransfer, onOpenOrders, onOpenAgent
}: {
  row: StateReplenishmentRow;
  tab: InlineTab;
  rows: StateReplenishmentRow[];
  productFilter: string | null;
  canManage: boolean;
  canSeeCustomers: boolean;
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
    { key: "open", label: `All Orders (${row.openOrders})` },
    { key: "ready", label: `Ready Customers (${row.readyOrders})` },
    { key: "carts", label: `From Carts (${row.cartCustomers})` },
    { key: "transfer", label: "Where to get stock" }
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
              <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${PRIORITY_TONE[row.priority]}`}>{PRIORITY_LABEL[row.priority]}</span>
            </h2>
            <p className="m-0 text-[12px] text-gray-500">
              {num(row.agentCount)} agent{row.agentCount === 1 ? "" : "s"} · {num(row.sellable)} unit{row.sellable === 1 ? "" : "s"} to sell ·{" "}
              {num(row.readyOrders)} customer{row.readyOrders === 1 ? "" : "s"} ready · {row.deficit > 0 ? `short by ${num(row.deficit)}` : "enough to go round"}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {row.deficit > 0 && (
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5">
              <AlertTriangle className="h-5 w-5 shrink-0 text-rose-600" />
              <div>
                <strong className="block text-[13px] font-black text-rose-800">Short by {num(row.deficit)} unit{row.deficit === 1 ? "" : "s"}</strong>
                <span className="block text-[11px] text-rose-700">
                  {num(row.readyOrders)} customer{row.readyOrders === 1 ? "" : "s"} ready{row.cartCustomers > 0 ? ` + ${num(row.cartCustomers)} from carts` : ""}, but only {num(row.sellable)} unit{row.sellable === 1 ? "" : "s"} to give them
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
      {tab === "open" && <OrderTable orders={row.orders} showNote canSeeCustomers={canSeeCustomers} />}
      {tab === "ready" && <OrderTable orders={ready} showNote canSeeCustomers={canSeeCustomers} />}
      {tab === "carts" && <CartTable carts={row.carts} state={row.state} canSeeCustomers={canSeeCustomers} />}
      {tab === "transfer" && <TransferOptions row={row} rows={rows} productId={productFilter} canManage={canManage} onCreateTransfer={onCreateTransfer} />}
    </section>
  );
}

// ── Full state modal ─────────────────────────────────────────────────────────

function StateModal({
  row, rows, product, onProduct, tab, onTab, onClose, canManage, canSeeMoney, canSeeCustomers, notes, notesLoaded,
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
  canSeeMoney: boolean;
  canSeeCustomers: boolean;
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
    { key: "agents", label: "Agent by agent" },
    { key: "orders", label: "All orders" },
    { key: "carts", label: `From carts (${row.cartCustomers})` },
    { key: "transfer", label: "Where to get stock" },
    { key: "performance", label: "How this state is doing" },
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
                  {row.recommendation === "Replenish State" ? "Needs stock"
                    : row.recommendation === "Rebalance Agents" ? "Move stock across"
                      : row.recommendation === "Watch Demand" ? "Wait and see" : "All good"}
                </span>
              </h2>
              <p className="m-0 mt-0.5 text-sm text-gray-500">Everything about stock, agents, orders and what to do next in {row.state}.</p>
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
          <StatCard label="Stock we can sell" value={num(product?.sellable ?? row.sellable)}
            foot={`Held by ${num(row.agentCount)} agent${row.agentCount === 1 ? "" : "s"}`} Icon={Package} tint="bg-emerald-50 text-emerald-600" />
          <StatCard label="Orders waiting" value={num(row.openOrders)} foot="Everyone who has ordered" Icon={FileText} tint="bg-blue-50 text-blue-600" />
          <StatCard label="Ready to take it" value={num(row.readyOrders)} foot="Confirmed, or gave a date" Icon={Users} tint="bg-amber-50 text-amber-600" />
          <StatCard label="Units short" value={product ? signed(-product.deficit) : signed(-row.deficit)}
            foot="Needed today" Icon={AlertTriangle} tint="bg-rose-50 text-rose-600" />
          <StatCard label="Units to send" value={`${num(sendUnits)} units`}
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
                <p className="m-0 text-[12px] text-gray-500">What each agent here is holding, and how many customers are waiting on them.</p>
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
                <h4 className="m-0 text-sm font-bold text-gray-900">Where the orders stand</h4>
                <p className="m-0 text-[11px] text-gray-500">{num(row.openOrders)} order{row.openOrders === 1 ? "" : "s"} waiting in {row.state}.</p>
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
                <h4 className="m-0 text-sm font-bold text-gray-900">Customers waiting on us</h4>
                <p className="m-0 text-[11px] text-gray-500">{num(ready.length)} {ready.length === 1 ? "person is" : "people are"} ready to take delivery.</p>
                <ul className="m-0 mt-3 list-none space-y-2 p-0">
                  {ready.length === 0 ? (
                    <li className="text-[12px] italic text-gray-400">Nobody in {row.state} is ready to receive yet.</li>
                  ) : !canSeeCustomers ? (
                    /* ⚠️ This role has never seen a customer name or phone
                       anywhere in the app. Counts answer the stock question
                       just as well, so it gets counts. */
                    row.agents.filter((agent) => agent.readyOrders > 0).map((agent) => (
                      <li key={agent.key} className="flex items-center gap-2.5">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-100 text-[10px] font-black text-gray-600">{initials(agent.name)}</span>
                        <span className="min-w-0 flex-1 text-[12px] font-bold text-gray-900">{agent.name}</span>
                        <span className="shrink-0 text-[11px] font-bold text-gray-600">{num(agent.readyOrders)} waiting</span>
                      </li>
                    ))
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
                    See all ready customers →
                  </button>
                )}
              </section>

              <section className="rounded-xl border border-gray-200 p-4">
                <div className="flex items-center justify-between">
                  <h4 className="m-0 text-sm font-bold text-gray-900">What to do</h4>
                  <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-bold text-violet-700"><Sparkles className="h-3 w-3" /> Worked out for you</span>
                </div>
                <div className={`mt-3 rounded-xl border p-3 ${row.deficit > 0 ? "border-rose-200 bg-rose-50" : "border-emerald-200 bg-emerald-50"}`}>
                  <strong className={`flex items-start gap-2 text-[13px] font-black ${row.deficit > 0 ? "text-rose-800" : "text-emerald-800"}`}>
                    {row.deficit > 0 ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> : <PackageCheck className="mt-0.5 h-4 w-4 shrink-0" />}
                    {row.recommendation === "Replenish State" ? `Send ${num(sendUnits)} unit${sendUnits === 1 ? "" : "s"} to ${row.state}`
                      : row.recommendation === "Rebalance Agents" ? `Move ${num(row.rebalanceUnits)} unit${row.rebalanceUnits === 1 ? "" : "s"} between agents in ${row.state}`
                        : row.recommendation === "Watch Demand" ? "Wait - do not send anything yet"
                          : `${row.state} has enough`}
                  </strong>
                  <p className={`m-0 mt-1.5 text-[11px] leading-relaxed ${row.deficit > 0 ? "text-rose-700" : "text-emerald-700"}`}>
                    {row.recommendation === "Replenish State"
                      ? `${num(row.readyOrders)} customer${row.readyOrders === 1 ? "" : "s"} ${row.readyOrders === 1 ? "is" : "are"} ready${row.cartCustomers > 0 ? `, plus ${num(row.cartCustomers)} more who left a cart and said yes on a call` : ""}, but the ${num(row.agentCount)} agent${row.agentCount === 1 ? "" : "s"} here only have ${num(product?.sellable ?? row.sellable)} unit${(product?.sellable ?? row.sellable) === 1 ? "" : "s"} between them. Send stock to the agent whose customers are waiting.`
                      : row.recommendation === "Rebalance Agents"
                        ? `${row.state} has enough stock in total - it is just with the wrong agent. Move it across inside the state instead of shipping more in.`
                        : row.recommendation === "Watch Demand"
                          ? `There ${row.openOrders === 1 ? "is" : "are"} ${num(row.openOrders)} order${row.openOrders === 1 ? "" : "s"} but only ${num(row.readyOrders)} ${row.readyOrders === 1 ? "person is" : "people are"} ready. Wait - check again when someone else becomes ready.`
                          : "Every customer who is ready can be served by the agent holding their order."}
                  </p>
                </div>

                {target && (
                  <div className="mt-3 rounded-xl border border-gray-200 p-3">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Send it to this agent</span>
                    <div className="mt-2 flex items-center gap-2.5">
                      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-rose-50 text-[11px] font-black text-rose-700">{initials(target.agent.name)}</span>
                      <span className="min-w-0 flex-1">
                        <strong className="block truncate text-[12px] font-bold text-gray-900">{target.agent.name}</strong>
                        <span className="block text-[11px] text-gray-500">{num(target.agent.readyOrders)} customer{target.agent.readyOrders === 1 ? "" : "s"} waiting · {num(target.agent.sellable)} in stock</span>
                      </span>
                    </div>
                  </div>
                )}

                {row.cartUnits > 0 && (
                  <p className="m-0 mt-2 rounded-lg bg-violet-50 px-3 py-2 text-[11px] leading-relaxed text-violet-900">
                    <ShoppingBag className="mr-1 inline h-3 w-3" />
                    {num(row.cartUnits)} of those unit{row.cartUnits === 1 ? "" : "s"} {row.cartUnits === 1 ? "is" : "are"} for {num(row.cartCustomers)} {row.cartCustomers === 1 ? "person" : "people"} who
                    left a cart and said yes on a call, not for orders already placed.
                    {row.cartsFromGuessedState > 0 && ` ${num(row.cartsFromGuessedState)} of them left the state blank, so we worked it out from the town they typed.`}
                  </p>
                )}
                {row.rebalanceUnits > 0 && row.sendUnits > 0 && (
                  <p className="m-0 mt-2 rounded-lg bg-blue-50 px-3 py-2 text-[11px] leading-relaxed text-blue-800">
{num(row.rebalanceUnits)} of those unit{row.rebalanceUnits === 1 ? "" : "s"} can come from another agent already in {row.state} - only {num(row.sendUnits)} really needs shipping in.
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
                      <ArrowLeftRight className="h-4 w-4" /> See where to get it
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
              <OrderTable orders={recent} showNote canSeeCustomers={canSeeCustomers} />
            </section>
          </div>
        )}

        {tab === "orders" && (
          <div className="px-6 py-5">
            <h3 className="m-0 text-base font-black text-gray-950">All orders in {row.state}</h3>
            <p className="m-0 mb-3 text-[12px] text-gray-500">
              Everyone waiting, most likely to buy at the top. Only the {num(row.readyOrders)} ready {row.readyOrders === 1 ? "one" : "ones"} decide whether we send stock.
            </p>
            <div className="overflow-hidden rounded-xl border border-gray-200">
              <OrderTable
                orders={[...row.orders].sort((a, b) => DEMAND_TIER_ORDER.indexOf(a.tier) - DEMAND_TIER_ORDER.indexOf(b.tier))}
                showNote
                canSeeCustomers={canSeeCustomers}
              />
            </div>
          </div>
        )}

        {tab === "carts" && (
          <div className="px-6 py-5">
            <h3 className="m-0 text-base font-black text-gray-950">People from carts in {row.state}</h3>
            <p className="m-0 mb-3 text-[12px] text-gray-500">
              {num(row.cartCustomers)} {row.cartCustomers === 1 ? "person" : "people"} · {num(row.cartUnits)} unit{row.cartUnits === 1 ? "" : "s"}{canSeeMoney ? ` · ${naira(row.cartRevenue)}` : ""}
              {row.cartsFromGuessedState > 0 && ` · ${num(row.cartsFromGuessedState)} with a state we worked out`}
            </p>
            <div className="overflow-hidden rounded-xl border border-gray-200">
              <CartTable carts={row.carts} state={row.state} canSeeCustomers={canSeeCustomers} />
            </div>
          </div>
        )}
        {tab === "transfer" && (
          <TransferOptions row={row} rows={rows} productId={productId} canManage={canManage} onCreateTransfer={onCreateTransfer} />
        )}

        {tab === "performance" && (
          <div className="px-6 py-5">
            <h3 className="m-0 text-base font-black text-gray-950">How {row.state} is doing</h3>
            <p className="m-0 mb-3 text-[12px] text-gray-500">
              What has actually been delivered in the last {lookbackDays} days, against what {row.state} is holding today.
            </p>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <StatCard label="Sold a day" value={`${Math.round(row.dailySales * 10) / 10}`} foot="Units, on average" Icon={TrendingUp} tint="bg-blue-50 text-blue-600" />
              <StatCard label="Days left" value={row.dailySales > 0 ? `${Math.round((Math.max(0, row.sellable - row.readyUnits) / row.dailySales) * 10) / 10}` : "-"} foot="Before the shelf is empty" Icon={PackageCheck} tint="bg-emerald-50 text-emerald-600" />
              <StatCard label="On the way" value={num(row.inTransit)} foot="Units already shipped here" Icon={Truck} tint="bg-sky-50 text-sky-600" />
              {canSeeMoney
                ? <StatCard label="Money at risk" value={naira(row.atRiskRevenue)} foot="Ready orders their agent cannot fill" Icon={AlertTriangle} tint="bg-rose-50 text-rose-600" />
                : <StatCard label="Orders at risk" value={num(row.readyOrders)} foot="Ready orders their agent cannot fill" Icon={AlertTriangle} tint="bg-rose-50 text-rose-600" />}
            </div>
            <div className="mt-4 overflow-hidden rounded-xl border border-gray-200">
              <table className="w-full text-left text-sm">
                <thead className="bg-gray-50/70 text-[10px] font-bold uppercase tracking-wider text-gray-500">
                  <tr>
                    <th className="px-3 py-2.5">Product</th>
                    <th className="px-3 py-2.5 text-right">Stock</th>
                    <th className="px-3 py-2.5 text-right">Kept for orders</th>
                    <th className="px-3 py-2.5 text-right">Needed now</th>
                    <th className="px-3 py-2.5 text-right">On the way</th>
                    <th className="px-3 py-2.5 text-right">Short by</th>
                    <th className="px-3 py-2.5 text-right">Can give away</th>
                  </tr>
                </thead>
                <tbody>
                  {row.byProduct.length === 0 ? (
                    <tr><td colSpan={7} className="px-4 py-8 text-center text-sm italic text-gray-400">No stock in {row.state}, and nobody has ordered.</td></tr>
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
              Write down why you did not send stock, so the next person seeing this red row does not send it by mistake.
              Notes are kept as written - they cannot be edited later.
            </p>
            <div className="mt-3 rounded-xl border border-gray-200 p-3">
              <textarea
                className="w-full resize-y rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-400"
                rows={3} maxLength={2000} value={noteDraft} onChange={(event) => onNoteDraft(event.target.value)}
                placeholder={`e.g. Agent is travelling until Monday, so I am holding the ${product?.productName ?? "stock"} till then.`} />
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <span className="text-[11px] text-gray-400">
                  This note is saved on {row.state}{product ? ` · ${product.productName}` : ""}
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
