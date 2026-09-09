// State & Agent Replenishment Intelligence - the arithmetic.
//
// ⚠️ STOCK LIVES WITH AN AGENT, NOT WITH A STATE. Every other stock page in
// this module totals a state and calls it the answer, and for replenishment
// that is wrong: a state can hold seven units against seven ready orders and
// still fail four of them, because the units sit with the agent who has no
// customers and the agent with the customers has none. So the unit of account
// here is the AGENT HUB (one agent in one state - agent_location), and a state
// row is only ever the sum of its hubs plus the question "can they cover each
// other?".
//
// The second idea is DEMAND CONFIDENCE. Raw open orders are not demand. A
// customer who is not picking calls does not justify moving stock across
// Nigeria; a customer with a delivery date does. Actionable demand is the only
// number that triggers a recommendation - raw orders are shown beside it so the
// two can never be mistaken for each other.
import type { OpsCart, OpsOrder, OpsProduct, OpsStateHub, OpsWaybill } from "./InventoryLogisticsOperationsPage";
import {
  CLOSED_ORDER_STATES, canonicalStateKey, inventoryLinesForOrder,
  isInTransitWaybill, norm, waybillInventoryLines
} from "./inventory-ops-model";
import { resolveStateFromText, zoneForState, type NigeriaZone, type StateSource } from "../lib/nigeria";

// ── Demand confidence ────────────────────────────────────────────────────────
// Tiers over the app's REAL rep-facing status labels (orderStatusViews in
// App.tsx), not invented ones. App.tsx resolves (status, call_outcome) into a
// label once and hands it over as OpsOrder.statusLabel, so this file never
// re-implements that resolution and cannot drift from it.
export type DemandTier = "very_high" | "high" | "medium" | "low" | "very_low" | "none";

export const DEMAND_TIER_META: Record<DemandTier, { label: string; dot: string; chip: string; text: string }> = {
  very_high: { label: "Very sure",     dot: "bg-rose-500",    chip: "bg-rose-50 text-rose-700 border-rose-200",       text: "text-rose-600" },
  high:      { label: "Sure",          dot: "bg-rose-400",    chip: "bg-rose-50 text-rose-600 border-rose-200",       text: "text-rose-500" },
  medium:    { label: "Maybe",         dot: "bg-amber-400",   chip: "bg-amber-50 text-amber-700 border-amber-200",    text: "text-amber-600" },
  low:       { label: "Not likely",    dot: "bg-yellow-300",  chip: "bg-yellow-50 text-yellow-700 border-yellow-200", text: "text-yellow-700" },
  very_low:  { label: "Very unlikely", dot: "bg-gray-300",    chip: "bg-gray-100 text-gray-600 border-gray-200",      text: "text-gray-500" },
  none:      { label: "Gone",          dot: "bg-gray-800",    chip: "bg-gray-100 text-gray-600 border-gray-200",      text: "text-gray-500" }
};

// ⚠️ ONLY very_high AND high COUNT AS ACTIONABLE - confirmed by Bright,
// 2026-09-09. "Ready" means a rep logged the customer as ready for delivery;
// "Rescheduled" means a rep set an actual date. Everything below the line is
// displayed, and never moves stock.
//
// "Pending" sits at Medium on purpose. It is the raw Confirmed pipeline status
// with NO call outcome logged - nobody has actually worked the order yet, so it
// is a queue entry, not a waiting customer.
const TIER_BY_STATUS_LABEL: Record<string, DemandTier> = {
  "ready": "very_high",
  "rescheduled": "high",
  "pending": "medium",
  "call back": "medium",
  "follow up": "low",
  "not ready": "low",
  "new": "low",
  "not answering": "very_low",
  "number busy": "very_low",
  "switched off": "very_low",
  "not available": "very_low",
  "product unavailable": "very_low",
  "delivered": "none",
  "cancelled": "none",
  "rejected": "none",
  "failed delivery": "none"
};

/** Display order for the status breakdown - strongest demand first. */
export const DEMAND_TIER_ORDER: DemandTier[] = ["very_high", "high", "medium", "low", "very_low", "none"];

// Fallback for callers that pass an OpsOrder without a resolved label (the
// other four stock pages build OpsOrder without one). Raw pipeline statuses
// only - deliberately coarse, because guessing finer than the data allows is
// how a page starts disagreeing with the order list.
const TIER_BY_RAW_STATUS: Record<string, DemandTier> = {
  "confirmed": "medium", "dispatched": "very_high", "in process": "medium",
  "new": "low", "postponed": "low",
  "delivered": "none", "cancelled": "none", "failed": "none"
};

export const tierForOrder = (order: OpsOrder): DemandTier => {
  const label = norm(order.statusLabel);
  if (label && TIER_BY_STATUS_LABEL[label]) return TIER_BY_STATUS_LABEL[label];
  return TIER_BY_RAW_STATUS[norm(order.status)] ?? "low";
};

export const isActionableTier = (tier: DemandTier) => tier === "very_high" || tier === "high";

// ── Abandoned carts ──────────────────────────────────────────────────────────
// ⚠️ A CART IS NOT AN ORDER. Somebody said yes on the phone and never placed
// one. That is real demand for stock - it was invisible here before, so a state
// could show "no action" while people waited - but it is a WEAKER promise than
// an order, and Bright asked to see the two apart. So cart units are counted in
// the shortage AND kept in their own field the whole way through, never folded
// into readyUnits.
//
// Only these two results mean the person is waiting (Bright, 2026-09-09).
// "Asked to call back" and "Price concern" are deliberately out: nobody has
// said yes yet.
const CART_DEMAND_OUTCOMES = new Set(["interested", "wants to order now"]);

export const isCartWaiting = (cart: OpsCart) =>
  norm(cart.status) !== "converted"
  && norm(cart.status) !== "lost"
  && CART_DEMAND_OUTCOMES.has(norm(cart.lastOutcomeCode));

export type CartDemandRow = {
  id: string;
  customer: string;
  phone: string;
  productId: string;
  productName: string;
  quantity: number;
  amount: number;
  lastOutcomeCode: string;
  lastOutcomeAt?: string;
  /** How the state was arrived at. "guessed-from-city" can be wrong, so the
   *  page marks those rows rather than presenting them as fact. */
  stateSource: StateSource;
  city: string;
};

// ── Row shapes ───────────────────────────────────────────────────────────────

export type ReplenishmentOrder = {
  id: string;
  customer: string;
  phone: string;
  quantity: number;
  statusLabel: string;
  tier: DemandTier;
  actionable: boolean;
  agentKey: string;
  agentName: string;
  createdAt?: string;
  scheduledDate?: string;
  amount: number;
  note: string;
  /** Only the lines that match the current product filter. */
  lines: Array<{ productId: string; quantity: number }>;
};

export type ProductPosition = {
  productId: string;
  productName: string;
  sellable: number;
  reserved: number;
  readyUnits: number;
  inTransit: number;
  /** Units people who said yes on a call are waiting for. Counted in the
   *  shortage, never mixed into readyUnits. */
  cartUnits: number;
  /** Units this hub is short for its own ready customers AND cart people. */
  deficit: number;
  /** Units free of every open commitment - the honest amount it can give away. */
  surplus: number;
};

export type AgentPosition = {
  key: string;
  agentId?: string;
  locationId?: string;
  name: string;
  area: string;
  phone: string;
  active: boolean;
  state: string;
  stateKey: string;
  sellable: number;
  reserved: number;
  readyUnits: number;
  openOrders: number;
  readyOrders: number;
  /** Sellable minus what its ready customers need. Negative = cannot deliver. */
  position: number;
  deficit: number;
  surplus: number;
  byProduct: ProductPosition[];
  orders: ReplenishmentOrder[];
  readyCustomers: ReplenishmentOrder[];
  status: "Critical" | "Low Stock" | "Watch" | "Healthy";
};

export type Recommendation = "Replenish State" | "Rebalance Agents" | "Watch Demand" | "No Action";
export type ReplenishmentPriority = "Critical" | "High" | "Medium" | "Low" | "Healthy";

export type StateReplenishmentRow = {
  key: string;
  state: string;
  zone: NigeriaZone | null;
  agents: AgentPosition[];
  agentCount: number;
  sellable: number;
  reserved: number;
  openOrders: number;
  readyOrders: number;
  readyUnits: number;
  openUnits: number;
  inTransit: number;
  /** People who said yes on a call and never ordered. Own fields on purpose. */
  cartCustomers: number;
  cartUnits: number;
  cartRevenue: number;
  carts: CartDemandRow[];
  /** Carts here whose state was worked out from the city box rather than typed
   *  by the customer. Shown so a wrong guess can be spotted. */
  cartsFromGuessedState: number;
  /** How many hubs in this state cannot serve their own ready customers. */
  agentShortages: number;
  /** Sellable across the state minus ready demand across the state. */
  position: number;
  /** Sum of the per-hub deficits - the real gap, before netting. */
  deficit: number;
  surplus: number;
  /** New stock the state genuinely needs, after internal cover and transit. */
  sendUnits: number;
  /** Units an agent-to-agent move inside the state can cover. */
  rebalanceUnits: number;
  recommendation: Recommendation;
  priority: ReplenishmentPriority;
  atRiskRevenue: number;
  orders: ReplenishmentOrder[];
  byProduct: ProductPosition[];
  tierCounts: Record<DemandTier, number>;
  statusCounts: Array<{ label: string; tier: DemandTier; count: number }>;
  /** Delivered units per day over the lookback window, for the forecast tab. */
  dailySales: number;
};

const PRIORITY_RANK: Record<ReplenishmentPriority, number> = {
  Critical: 0, High: 1, Medium: 2, Low: 3, Healthy: 4
};
export const priorityRank = (priority: ReplenishmentPriority) => PRIORITY_RANK[priority];

export const PRIORITY_TONE: Record<ReplenishmentPriority, string> = {
  Critical: "bg-rose-50 text-rose-700 border-rose-200",
  High: "bg-orange-50 text-orange-700 border-orange-200",
  Medium: "bg-amber-50 text-amber-700 border-amber-200",
  Low: "bg-gray-100 text-gray-600 border-gray-200",
  Healthy: "bg-emerald-50 text-emerald-700 border-emerald-200"
};

export const AGENT_STATUS_TONE: Record<AgentPosition["status"], string> = {
  Critical: "bg-rose-50 text-rose-700 border-rose-200",
  "Low Stock": "bg-amber-50 text-amber-700 border-amber-200",
  Watch: "bg-gray-100 text-gray-600 border-gray-200",
  Healthy: "bg-emerald-50 text-emerald-700 border-emerald-200"
};

const stateLabelOf = (value?: string) => {
  const key = canonicalStateKey(value);
  if (key === "fct") return "FCT Abuja";
  const clean = String(value ?? "").replace(/,?\s*Nigeria\s*$/i, "").trim();
  return clean || "Unassigned";
};

/** One agent in one state. agent_locations is the real unit: a multi-state
 *  agent holds separate stock per location, and its orders carry the location
 *  they were served from. Falling back to the agent id would merge a Lagos hub
 *  and a Rivers hub into one impossible row. */
const hubKey = (hub: Pick<OpsStateHub, "locationId" | "agentId" | "agentName">) =>
  hub.locationId || hub.agentId || `name:${norm(hub.agentName)}`;

const orderHubKey = (order: OpsOrder) =>
  order.assignedAgentLocationId || order.assignedAgentId || (order.assignedAgentName ? `name:${norm(order.assignedAgentName)}` : "");

export type BuildOptions = {
  /** Restrict every number to these products. Undefined = whole catalogue. */
  productIds?: ReadonlySet<string>;
  /** Delivered-demand window, for the forecast tab's run rate. */
  lookbackDays?: number;
};

export function buildStateReplenishmentRows(
  products: OpsProduct[],
  stateHubs: OpsStateHub[],
  orders: OpsOrder[],
  waybills: OpsWaybill[],
  carts: OpsCart[] = [],
  options: BuildOptions = {}
): StateReplenishmentRow[] {
  const { productIds, lookbackDays = 7 } = options;
  const productName = new Map(products.map((product) => [product.id, product.name]));
  const included = (productId: string) => !productIds || productIds.has(productId);

  type HubDraft = {
    hub: OpsStateHub;
    key: string;
    stateKey: string;
    stock: Map<string, number>;
    reserved: Map<string, number>;
    ready: Map<string, number>;
    transit: Map<string, number>;
    orders: ReplenishmentOrder[];
  };
  type StateDraft = {
    key: string;
    label: string;
    hubs: Map<string, HubDraft>;
    orders: ReplenishmentOrder[];
    /** Orders whose state is known but whose agent is not - see below. */
    unassigned: ReplenishmentOrder[];
    delivered: number;
    transitLoose: Map<string, number>;
    carts: CartDemandRow[];
    cartUnits: Map<string, number>;
  };

  const states = new Map<string, StateDraft>();
  const stateFor = (raw?: string) => {
    const key = canonicalStateKey(raw);
    if (!key) return null;
    const found = states.get(key);
    if (found) return found;
    const created: StateDraft = {
      key, label: stateLabelOf(raw), hubs: new Map(), orders: [],
      unassigned: [], delivered: 0, transitLoose: new Map(),
      carts: [], cartUnits: new Map()
    };
    states.set(key, created);
    return created;
  };

  // 1. Hubs and their physical stock.
  const hubIndex = new Map<string, HubDraft>();
  for (const hub of stateHubs) {
    const state = stateFor(hub.state);
    if (!state) continue;
    const key = hubKey(hub);
    const draft: HubDraft = {
      hub, key, stateKey: state.key,
      stock: new Map(), reserved: new Map(), ready: new Map(), transit: new Map(), orders: []
    };
    // ⚠️ A hub can arrive with no stocks array at all - the fault that took
    // down three stock pages at once. Same defence here.
    for (const line of hub.stocks ?? []) {
      if (!included(line.productId)) continue;
      const units = Math.max(0, Number(line.quantity) || 0);
      if (units <= 0) continue;
      draft.stock.set(line.productId, (draft.stock.get(line.productId) ?? 0) + units);
    }
    state.hubs.set(key, draft);
    hubIndex.set(key, draft);
  }

  // 2. Orders, split by confidence and attributed to the hub that must serve them.
  const windowStart = Date.now() - Math.max(1, lookbackDays) * 86_400_000;
  for (const order of orders) {
    const rawStatus = norm(order.status);
    const lines = inventoryLinesForOrder(order).filter((line) => included(line.productId));

    if (CLOSED_ORDER_STATES.has(rawStatus)) {
      if (rawStatus !== "delivered" || lines.length === 0) continue;
      const when = Date.parse(order.deliveredAt || order.createdAt || "");
      if (!Number.isFinite(when) || when < windowStart) continue;
      const state = stateFor(order.state || order.location);
      if (state) state.delivered += lines.reduce((sum, line) => sum + line.quantity, 0);
      continue;
    }
    if (lines.length === 0) continue;

    const state = stateFor(order.state || order.location);
    if (!state) continue;
    const tier = tierForOrder(order);
    const actionable = isActionableTier(tier);
    const units = lines.reduce((sum, line) => sum + line.quantity, 0);
    const key = orderHubKey(order);
    const draft = key ? state.hubs.get(key) : undefined;

    const row: ReplenishmentOrder = {
      id: order.id ?? "",
      customer: order.customer ?? "Unnamed customer",
      phone: order.phone ?? "",
      quantity: units,
      statusLabel: order.statusLabel || order.status || "New",
      tier,
      actionable,
      agentKey: draft?.key ?? "",
      agentName: draft?.hub.agentName ?? order.assignedAgentName ?? "Unassigned",
      createdAt: order.createdAt,
      scheduledDate: order.scheduledDate,
      amount: Math.max(0, Number(order.amount) || 0),
      note: order.lastNote ?? "",
      lines
    };
    state.orders.push(row);

    if (!draft) {
      // ⚠️ AN ORDER WITH NO AGENT STILL COUNTS AGAINST THE STATE. Dropping it
      // would understate demand exactly where it hurts - a brand-new order in a
      // state nobody has been assigned yet is the clearest replenishment signal
      // there is. It has no hub to be short at, so it lands on the state row
      // only, and the state's deficit picks it up below.
      state.unassigned.push(row);
      continue;
    }
    draft.orders.push(row);
    for (const line of lines) {
      draft.reserved.set(line.productId, (draft.reserved.get(line.productId) ?? 0) + line.quantity);
      if (actionable) draft.ready.set(line.productId, (draft.ready.get(line.productId) ?? 0) + line.quantity);
    }
  }

  // 3. Stock already on its way. Counted so the page never recommends a second
  //    shipment for a gap the first one already closes.
  for (const waybill of waybills) {
    if (!isInTransitWaybill(waybill)) continue;
    const state = stateFor(waybill.toState || waybill.to);
    if (!state) continue;
    const target = waybill.toAgentLocationId || waybill.toAgentId
      ? state.hubs.get(waybill.toAgentLocationId || waybill.toAgentId || "")
      : undefined;
    for (const line of waybillInventoryLines(waybill)) {
      if (!line.productId || !included(line.productId)) continue;
      if (target) target.transit.set(line.productId, (target.transit.get(line.productId) ?? 0) + line.quantity);
      else state.transitLoose.set(line.productId, (state.transitLoose.get(line.productId) ?? 0) + line.quantity);
    }
  }

  // 4. Carts where the last call said the person is waiting.
  //
  // ⚠️ CARTS CARRY NO AGENT, only a state - nobody has been assigned to serve
  // them yet. So they behave exactly like an order with no agent: they raise
  // the STATE's shortage without belonging to any hub, which is right, because
  // whichever agent ends up serving them still needs the units.
  //
  // The state is worked out rather than read: most carts are captured
  // mid-checkout with the state box blank and the town typed into `city`. The
  // source is kept on every row so a guess is never shown as a fact.
  for (const cart of carts) {
    if (!isCartWaiting(cart)) continue;
    if (!cart.productId || !included(cart.productId)) continue;
    const resolved = resolveStateFromText(cart.state, cart.city);
    if (!resolved.state) continue;
    const state = stateFor(resolved.state);
    if (!state) continue;
    const units = Math.max(1, Math.round(Number(cart.quantity) || 0) || 1);
    state.carts.push({
      id: cart.id,
      customer: cart.customer || "Unnamed customer",
      phone: cart.phone || "",
      productId: cart.productId,
      productName: productName.get(cart.productId) ?? cart.productName ?? "Unknown product",
      quantity: units,
      amount: Math.max(0, Number(cart.amount) || 0),
      lastOutcomeCode: cart.lastOutcomeCode ?? "",
      lastOutcomeAt: cart.lastOutcomeAt,
      stateSource: resolved.source,
      city: cart.city ?? ""
    });
    state.cartUnits.set(cart.productId, (state.cartUnits.get(cart.productId) ?? 0) + units);
  }

  // 5. Fold each state up from its hubs.
  return Array.from(states.values()).map((state) => {
    const agents: AgentPosition[] = Array.from(state.hubs.values()).map((draft) => {
      const productIdsHere = new Set([
        ...draft.stock.keys(), ...draft.reserved.keys(), ...draft.ready.keys(), ...draft.transit.keys()
      ]);
      const byProduct: ProductPosition[] = Array.from(productIdsHere).map((productId) => {
        const sellable = draft.stock.get(productId) ?? 0;
        const reserved = draft.reserved.get(productId) ?? 0;
        const readyUnits = draft.ready.get(productId) ?? 0;
        return {
          productId,
          productName: productName.get(productId) ?? "Unknown product",
          sellable, reserved, readyUnits,
          // Always zero at hub level: a cart has no agent yet, so its units sit
          // on the state row and never on one agent's shoulders.
          cartUnits: 0,
          inTransit: draft.transit.get(productId) ?? 0,
          deficit: Math.max(0, readyUnits - sellable),
          // Free of EVERY open commitment, not just the ready ones. Giving away
          // a unit that a Call Back customer may still take is how a rebalance
          // turns one shortage into two.
          surplus: Math.max(0, sellable - reserved)
        };
      }).sort((a, b) => b.deficit - a.deficit || b.sellable - a.sellable);

      const sellable = byProduct.reduce((sum, row) => sum + row.sellable, 0);
      const reserved = byProduct.reduce((sum, row) => sum + row.reserved, 0);
      const readyUnits = byProduct.reduce((sum, row) => sum + row.readyUnits, 0);
      const deficit = byProduct.reduce((sum, row) => sum + row.deficit, 0);
      const surplus = byProduct.reduce((sum, row) => sum + row.surplus, 0);
      const readyCustomers = draft.orders.filter((order) => order.actionable);
      return {
        key: draft.key,
        agentId: draft.hub.agentId,
        locationId: draft.hub.locationId,
        name: draft.hub.agentName,
        area: draft.hub.city ?? "",
        phone: draft.hub.agentPhone ?? "",
        active: draft.hub.active !== false,
        state: state.label,
        stateKey: state.key,
        sellable, reserved, readyUnits,
        openOrders: draft.orders.length,
        readyOrders: readyCustomers.length,
        position: sellable - readyUnits,
        deficit, surplus,
        byProduct,
        orders: draft.orders,
        readyCustomers,
        status: deficit > 0 && sellable === 0 ? "Critical"
          : deficit > 0 ? "Low Stock"
            : draft.orders.length > 0 && sellable === 0 ? "Watch" : "Healthy"
      } satisfies AgentPosition;
    }).sort((a, b) => a.position - b.position || b.readyOrders - a.readyOrders || a.name.localeCompare(b.name));

    // Per-product state totals, so the modal's product picker and the "send N
    // units" figure read off the same numbers as the agent rows.
    const productKeys = new Set<string>();
    for (const agent of agents) for (const row of agent.byProduct) productKeys.add(row.productId);
    for (const order of state.unassigned) for (const line of order.lines) productKeys.add(line.productId);
    for (const productId of state.transitLoose.keys()) productKeys.add(productId);
    for (const productId of state.cartUnits.keys()) productKeys.add(productId);

    const byProduct: ProductPosition[] = Array.from(productKeys).map((productId) => {
      const parts = agents.map((agent) => agent.byProduct.find((row) => row.productId === productId));
      const unassignedReady = state.unassigned
        .filter((order) => order.actionable)
        .reduce((sum, order) => sum + order.lines.filter((line) => line.productId === productId).reduce((n, line) => n + line.quantity, 0), 0);
      const unassignedOpen = state.unassigned
        .reduce((sum, order) => sum + order.lines.filter((line) => line.productId === productId).reduce((n, line) => n + line.quantity, 0), 0);
      const cartUnits = state.cartUnits.get(productId) ?? 0;
      return {
        productId,
        productName: productName.get(productId) ?? "Unknown product",
        sellable: parts.reduce((sum, row) => sum + (row?.sellable ?? 0), 0),
        reserved: parts.reduce((sum, row) => sum + (row?.reserved ?? 0), 0) + unassignedOpen,
        readyUnits: parts.reduce((sum, row) => sum + (row?.readyUnits ?? 0), 0) + unassignedReady,
        // Kept apart from readyUnits the whole way up, so a shortage built out
        // of phone calls can always be told from one built out of orders.
        cartUnits,
        inTransit: parts.reduce((sum, row) => sum + (row?.inTransit ?? 0), 0) + (state.transitLoose.get(productId) ?? 0),
        // ⚠️ SUM OF HUB DEFICITS, NOT THE NETTED STATE FIGURE. Netting is the
        // mistake this whole page exists to correct: it makes a state whose
        // stock sits with the wrong agent look healthy.
        //
        // Cart units are added here because nobody holds stock for them yet -
        // same treatment as an order with no agent.
        deficit: parts.reduce((sum, row) => sum + (row?.deficit ?? 0), 0) + unassignedReady + cartUnits,
        surplus: parts.reduce((sum, row) => sum + (row?.surplus ?? 0), 0)
      };
    }).sort((a, b) => b.deficit - a.deficit || b.sellable - a.sellable);

    const sellable = byProduct.reduce((sum, row) => sum + row.sellable, 0);
    const reserved = byProduct.reduce((sum, row) => sum + row.reserved, 0);
    const readyUnits = byProduct.reduce((sum, row) => sum + row.readyUnits, 0);
    const inTransit = byProduct.reduce((sum, row) => sum + row.inTransit, 0);
    const deficit = byProduct.reduce((sum, row) => sum + row.deficit, 0);
    const surplus = byProduct.reduce((sum, row) => sum + row.surplus, 0);
    const openUnits = state.orders.reduce((sum, order) => sum + order.quantity, 0);
    const readyOrdersList = state.orders.filter((order) => order.actionable);

    // Cover the gap from inside the state first, then from transit, and only
    // ask for new stock for what is left. Done per product so a surplus of
    // hangers cannot appear to cover a shortage of brushers.
    const rebalanceUnits = byProduct.reduce((sum, row) => sum + Math.min(row.deficit, row.surplus), 0);
    const sendUnits = byProduct.reduce(
      (sum, row) => sum + Math.max(0, row.deficit - row.surplus - row.inTransit), 0
    );

    const agentShortages = agents.filter((agent) => agent.deficit > 0).length;
    const strandedReady = agents.some((agent) => agent.deficit > 0 && agent.sellable === 0);
    const unservedReady = state.unassigned.some((order) => order.actionable) || state.carts.length > 0;

    const recommendation: Recommendation = sendUnits > 0 ? "Replenish State"
      : rebalanceUnits > 0 ? "Rebalance Agents"
        : openUnits > sellable && state.orders.length > 0 ? "Watch Demand"
          : "No Action";

    const priority: ReplenishmentPriority =
      sendUnits > 0 && (strandedReady || unservedReady) ? "Critical"
        : sendUnits > 0 ? "High"
          : rebalanceUnits > 0 && agentShortages > 1 ? "High"
            : rebalanceUnits > 0 ? "Medium"
              : recommendation === "Watch Demand" ? "Low"
                : "Healthy";

    // Revenue riding on ready orders whose own hub cannot cover them. Counted
    // per order, never per unit, so a part-covered order is not half-lost.
    const shortHubs = new Set(agents.filter((agent) => agent.deficit > 0).map((agent) => agent.key));
    const atRiskRevenue = readyOrdersList
      .filter((order) => !order.agentKey || shortHubs.has(order.agentKey))
      .reduce((sum, order) => sum + order.amount, 0)
      // Cart money is at risk whenever the state cannot cover its shortage:
      // no agent is holding anything for these people at all.
      + (sendUnits > 0 ? state.carts.reduce((sum, cart) => sum + cart.amount, 0) : 0);

    const tierCounts = DEMAND_TIER_ORDER.reduce((acc, tier) => {
      acc[tier] = state.orders.filter((order) => order.tier === tier).length;
      return acc;
    }, {} as Record<DemandTier, number>);

    const labelCounts = new Map<string, { label: string; tier: DemandTier; count: number }>();
    for (const order of state.orders) {
      const found = labelCounts.get(order.statusLabel);
      if (found) found.count += 1;
      else labelCounts.set(order.statusLabel, { label: order.statusLabel, tier: order.tier, count: 1 });
    }

    return {
      key: state.key,
      state: state.label,
      zone: zoneForState(state.label),
      agents,
      agentCount: agents.length,
      sellable, reserved,
      openOrders: state.orders.length,
      readyOrders: readyOrdersList.length,
      readyUnits, openUnits, inTransit,
      cartCustomers: state.carts.length,
      cartUnits: state.carts.reduce((sum, cart) => sum + cart.quantity, 0),
      cartRevenue: state.carts.reduce((sum, cart) => sum + cart.amount, 0),
      carts: state.carts.sort((a, b) => Date.parse(b.lastOutcomeAt ?? "") - Date.parse(a.lastOutcomeAt ?? "")),
      cartsFromGuessedState: state.carts.filter((cart) => cart.stateSource === "guessed-from-city").length,
      agentShortages,
      position: sellable - readyUnits,
      deficit, surplus, sendUnits, rebalanceUnits,
      recommendation, priority,
      atRiskRevenue,
      orders: state.orders,
      byProduct,
      tierCounts,
      statusCounts: Array.from(labelCounts.values()).sort(
        (a, b) => DEMAND_TIER_ORDER.indexOf(a.tier) - DEMAND_TIER_ORDER.indexOf(b.tier) || b.count - a.count
      ),
      dailySales: state.delivered / Math.max(1, lookbackDays)
    } satisfies StateReplenishmentRow;
  }).sort((a, b) =>
    priorityRank(a.priority) - priorityRank(b.priority)
    || b.sendUnits - a.sendUnits
    || a.state.localeCompare(b.state));
}

// ── Where the stock should come from ─────────────────────────────────────────

export type DonorHub = {
  agent: AgentPosition;
  units: number;
  sameZone: boolean;
};

/**
 * Hubs elsewhere that can spare the product, best first.
 *
 * ⚠️ SURPLUS, NOT STOCK. A hub holding 40 units against 40 open orders has
 * nothing to give; offering it as a donor is how one state's shortage becomes
 * two. Same-zone donors rank first because that is the shorter, cheaper
 * journey - it is a suggestion about distance, never a routing rule. Orders
 * still route strictly to the in-state hub that can fulfil them.
 */
export function donorsFor(
  rows: StateReplenishmentRow[],
  needyStateKey: string,
  productId: string | null,
  zone: NigeriaZone | null
): DonorHub[] {
  const donors: DonorHub[] = [];
  for (const row of rows) {
    if (row.key === needyStateKey) continue;
    for (const agent of row.agents) {
      const units = productId
        ? (agent.byProduct.find((entry) => entry.productId === productId)?.surplus ?? 0)
        : agent.surplus;
      if (units <= 0) continue;
      donors.push({ agent, units, sameZone: Boolean(zone) && row.zone === zone });
    }
  }
  return donors.sort((a, b) =>
    Number(b.sameZone) - Number(a.sameZone) || b.units - a.units || a.agent.name.localeCompare(b.agent.name));
}

/** Hubs INSIDE the state that can cover a shortage without a new shipment. */
export function internalDonorsFor(row: StateReplenishmentRow, productId: string | null): DonorHub[] {
  return row.agents
    .map((agent) => ({
      agent,
      units: productId
        ? (agent.byProduct.find((entry) => entry.productId === productId)?.surplus ?? 0)
        : agent.surplus,
      sameZone: true
    }))
    .filter((entry) => entry.units > 0)
    .sort((a, b) => b.units - a.units || a.agent.name.localeCompare(b.agent.name));
}

/**
 * Which hub should receive a shipment into this state, and how much.
 *
 * The receiving agent is the one holding the ready customers, not the one with
 * the best address - that is the difference between "send stock to Akwa Ibom"
 * and "send stock to the agent in Akwa Ibom who has four people waiting".
 */
export function receivingPlanFor(row: StateReplenishmentRow, productId: string | null) {
  const need = (agent: AgentPosition) => productId
    ? (agent.byProduct.find((entry) => entry.productId === productId)?.deficit ?? 0)
    : agent.deficit;
  return row.agents
    .map((agent) => ({ agent, units: need(agent) }))
    .filter((entry) => entry.units > 0)
    .sort((a, b) => b.units - a.units || b.agent.readyOrders - a.agent.readyOrders);
}

// ── Cross-state product view ─────────────────────────────────────────────────

export type ProductReplenishmentRow = {
  productId: string;
  productName: string;
  sellable: number;
  readyUnits: number;
  openUnits: number;
  inTransit: number;
  deficit: number;
  surplus: number;
  statesShort: Array<{ state: string; units: number }>;
  agentsShort: number;
};

export function buildProductReplenishmentRows(rows: StateReplenishmentRow[]): ProductReplenishmentRow[] {
  const byProduct = new Map<string, ProductReplenishmentRow>();
  for (const row of rows) {
    for (const entry of row.byProduct) {
      const found = byProduct.get(entry.productId) ?? {
        productId: entry.productId, productName: entry.productName,
        sellable: 0, readyUnits: 0, openUnits: 0, inTransit: 0, deficit: 0, surplus: 0,
        statesShort: [], agentsShort: 0
      };
      found.sellable += entry.sellable;
      found.readyUnits += entry.readyUnits;
      found.openUnits += entry.reserved;
      found.inTransit += entry.inTransit;
      found.deficit += entry.deficit;
      found.surplus += entry.surplus;
      if (entry.deficit > 0) found.statesShort.push({ state: row.state, units: entry.deficit });
      found.agentsShort += row.agents.filter(
        (agent) => (agent.byProduct.find((line) => line.productId === entry.productId)?.deficit ?? 0) > 0
      ).length;
      byProduct.set(entry.productId, found);
    }
  }
  return Array.from(byProduct.values())
    .map((row) => ({ ...row, statesShort: row.statesShort.sort((a, b) => b.units - a.units) }))
    .sort((a, b) => b.deficit - a.deficit || b.readyUnits - a.readyUnits || a.productName.localeCompare(b.productName));
}
