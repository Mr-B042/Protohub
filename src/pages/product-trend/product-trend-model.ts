// Product Trend - the maths (Bright's design, 20 Oct 2026).
//
// ⚠️ SAME DEFINITIONS AS FINANCE, so the two pages never disagree:
// - Orders     = orders PLACED in the period (held duplicates already left
//                out by the server), the order cohort.
// - Delivered  = of those, the ones now Delivered. Delivery rate = delivered
//                ÷ orders (the Orders-page cohort rate).
// - Net profit = delivered revenue − product cost − delivery fees − running
//                costs. Running costs are Finance's: every expense except
//                "Delivery" (delivery is the order's own fee). Costs tagged to a
//                product stay with it; untagged ones are shared out by each
//                product's share of delivered sales (Finance's
//                proportionalShare). = Finance › Product Profitability
//                "Direct Net Profit" − "Shared Opex".
// - States and agents carry no costs of their own (ads are not tracked by
//   state), so each delivered order carries its product's running costs in
//   proportion to its own sales. That is how a state or agent gets a net
//   profit, and the page says so wherever it shows one.

export type TrendOrder = {
  id: string;
  productId: string;
  /** Canonical state name ("Lagos", "FCT Abuja"), or "" when unknown. */
  state: string;
  agentId: string;
  /** Raw pipeline status (New, Confirmed, ..., Delivered, Failed, Cancelled). */
  status: string;
  amount: number;
  /** Pieces in the order (one order of 3 racks = 3 units). */
  units: number;
  /** Day placed, YYYY-MM-DD (Lagos). */
  createdKey: string;
  logisticsCost: number;
  /** Product cost of the order (Finance's costForOrder). */
  cogs: number;
  /** Day delivered, YYYY-MM-DD, when delivered. */
  deliveredKey?: string;
};

export type TrendExpense = { amount: number; dateKey: string; productId: string | null; type: string };
export type TrendProduct = { id: string; name: string; sku?: string; active: boolean; warehouseStock?: number };
export type TrendHub = { agentId: string; agentName: string; state: string; active: boolean; stocks: Array<{ productId: string; quantity: number }> };
export type TrendAgent = { id: string; name: string };

export type TrendFilters = { productId: string; state: string; agentId: string; status: string };
export const ALL = "all";
export const EMPTY_FILTERS: TrendFilters = { productId: ALL, state: ALL, agentId: ALL, status: ALL };

/** Below this many orders a rate is too shaky to rank on. */
export const MIN_RATE_SAMPLE = 10;

export const isDelivered = (order: TrendOrder) => order.status === "Delivered";
/** Got past the rep's call: Confirmed or anything after it (Failed included - it was sent out). */
export const isConfirmed = (order: TrendOrder) => ["Confirmed", "In Process", "Dispatched", "Postponed", "Delivered", "Failed"].includes(order.status);
/** Still to be delivered (waiting customers). */
export const isOpen = (order: TrendOrder) => ["New", "Confirmed", "In Process", "Dispatched", "Postponed"].includes(order.status);
export const isDead = (order: TrendOrder) => order.status === "Cancelled" || order.status === "Failed";
const pctOf = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : 0);
/** Percentage change, or null when there is nothing to compare with. */
export const growthPct = (now: number, before: number) => (before > 0 ? ((now - before) / before) * 100 : null);

export function filterOrders(orders: TrendOrder[], filters: TrendFilters) {
  return orders.filter((order) =>
    (filters.productId === ALL || order.productId === filters.productId)
    && (filters.state === ALL || order.state === filters.state)
    && (filters.agentId === ALL || order.agentId === filters.agentId)
    && (filters.status === ALL || order.status === filters.status));
}

// ── Running costs, Finance's way ────────────────────────────────────────────

export type CostBook = {
  /** Running cost one delivered order carries (by order id). */
  perOrder: Map<string, number>;
  /** Costs of a product that sold nothing delivered: no order to carry them. */
  unplaced: Map<string, number>;
};

/** Finance's proportionalShare. */
export const proportionalShare = (valueBase: number, totalBase: number, pool: number, countBase = 0, totalCountBase = 0) => {
  if (pool === 0) return 0;
  if (totalBase > 0) return pool * (valueBase / totalBase);
  if (totalCountBase > 0) return pool * (countBase / totalCountBase);
  return 0;
};

/**
 * Work the period's running costs out over the WHOLE period's delivered orders
 * (never a filtered slice, or filtering to Lagos would load Lagos with all of
 * a product's costs). Filters then pick orders; each carries its own share.
 */
export function buildCostBook(allOrders: TrendOrder[], expenses: TrendExpense[], from: string, to: string): CostBook {
  const delivered = allOrders.filter(isDelivered);
  const inPeriod = expenses.filter((expense) => expense.dateKey >= from && expense.dateKey <= to && expense.type !== "Delivery");
  const shared = inPeriod.filter((expense) => !expense.productId).reduce((sum, expense) => sum + expense.amount, 0);
  const direct = new Map<string, number>();
  for (const expense of inPeriod) {
    if (expense.productId) direct.set(expense.productId, (direct.get(expense.productId) ?? 0) + expense.amount);
  }
  const totalRevenue = delivered.reduce((sum, order) => sum + order.amount, 0);
  const byProduct = new Map<string, TrendOrder[]>();
  for (const order of delivered) {
    const list = byProduct.get(order.productId);
    if (list) list.push(order); else byProduct.set(order.productId, [order]);
  }
  const perOrder = new Map<string, number>();
  const unplaced = new Map<string, number>();
  const productIds = new Set([...byProduct.keys(), ...direct.keys()]);
  for (const productId of productIds) {
    const rows = byProduct.get(productId) ?? [];
    const revenue = rows.reduce((sum, order) => sum + order.amount, 0);
    const pool = (direct.get(productId) ?? 0) + proportionalShare(revenue, totalRevenue, shared, rows.length, delivered.length);
    if (rows.length === 0) { if (pool !== 0) unplaced.set(productId, pool); continue; }
    for (const order of rows) perOrder.set(order.id, proportionalShare(order.amount, revenue, pool, 1, rows.length));
  }
  return { perOrder, unplaced };
}

// ── One set of orders → the figures every table shows ───────────────────────

export type Figures = {
  orders: number;
  confirmed: number;
  /** Days from order to delivery, averaged over delivered orders with both dates. */
  avgDeliveryDays: number | null;
  delivered: number;
  failed: number;
  cancelled: number;
  open: number;
  units: number;
  unitsDelivered: number;
  rate: number;
  revenue: number;
  aov: number;
  cogs: number;
  logistics: number;
  runningCosts: number;
  net: number;
};

export function figuresFor(orders: TrendOrder[], costs: CostBook, extraCosts = 0): Figures {
  let delivered = 0, failed = 0, cancelled = 0, units = 0, unitsDelivered = 0, revenue = 0, cogs = 0, logistics = 0, runningCosts = extraCosts;
  let confirmed = 0, dayTotal = 0, dayCount = 0;
  for (const order of orders) {
    units += order.units;
    if (isConfirmed(order)) confirmed += 1;
    if (isDelivered(order) && order.deliveredKey && order.deliveredKey >= order.createdKey) { dayTotal += daysBetween(order.createdKey, order.deliveredKey); dayCount += 1; }
    if (order.status === "Failed") failed += 1;
    else if (order.status === "Cancelled") cancelled += 1;
    if (!isDelivered(order)) continue;
    delivered += 1;
    unitsDelivered += order.units;
    revenue += order.amount;
    cogs += order.cogs;
    logistics += order.logisticsCost;
    runningCosts += costs.perOrder.get(order.id) ?? 0;
  }
  return {
    orders: orders.length,
    confirmed,
    avgDeliveryDays: dayCount > 0 ? dayTotal / dayCount : null,
    delivered, failed, cancelled,
    open: orders.length - delivered - failed - cancelled,
    units, unitsDelivered,
    rate: pctOf(delivered, orders.length),
    revenue,
    aov: delivered > 0 ? revenue / delivered : 0,
    cogs, logistics, runningCosts,
    net: revenue - cogs - logistics - runningCosts
  };
}

export type Share = { key: string; count: number; share: number };

/** Top states (or anything) by count, with each one's share of the total. */
export function topShares(orders: TrendOrder[], keyOf: (order: TrendOrder) => string, limit = 3): Share[] {
  const counts = new Map<string, number>();
  for (const order of orders) {
    const key = keyOf(order);
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([key, count]) => ({ key, count, share: pctOf(count, orders.length) }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
    .slice(0, limit);
}

// ── Time buckets ────────────────────────────────────────────────────────────

export type Granularity = "daily" | "weekly" | "monthly";

const addDays = (key: string, days: number) => {
  const date = new Date(`${key}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};
export const daysBetween = (from: string, to: string) =>
  Math.round((new Date(`${to}T12:00:00Z`).getTime() - new Date(`${from}T12:00:00Z`).getTime()) / 86_400_000);

/** The same length of time just before [from, to]. */
export function previousPeriod(from: string, to: string) {
  const length = daysBetween(from, to) + 1;
  return { from: addDays(from, -length), to: addDays(from, -1) };
}

/** Sunday-started weeks, like every other weekly view in Protohub. */
const weekStartOf = (key: string) => addDays(key, -new Date(`${key}T12:00:00Z`).getUTCDay());

export function bucketKeys(from: string, to: string, granularity: Granularity) {
  const keys: string[] = [];
  if (granularity === "daily") for (let key = from; key <= to; key = addDays(key, 1)) keys.push(key);
  else if (granularity === "weekly") for (let key = weekStartOf(from); key <= to; key = addDays(key, 7)) keys.push(key);
  else {
    for (let key = `${from.slice(0, 7)}-01`; key <= to;) {
      keys.push(key);
      const [y, m] = key.split("-").map(Number);
      key = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
    }
  }
  return keys;
}
export const bucketOf = (key: string, granularity: Granularity) =>
  granularity === "daily" ? key : granularity === "weekly" ? weekStartOf(key) : `${key.slice(0, 7)}-01`;

export type TrendMetric = "orders" | "delivered" | "rate" | "revenue" | "unitsDelivered" | "aov";
export const TREND_METRICS: Array<{ key: TrendMetric; label: string; money?: boolean; percent?: boolean }> = [
  { key: "orders", label: "Total Orders" },
  { key: "delivered", label: "Delivered Orders" },
  { key: "rate", label: "Delivery Rate", percent: true },
  { key: "revenue", label: "Delivered Revenue", money: true },
  { key: "unitsDelivered", label: "Units Delivered" },
  { key: "aov", label: "Delivered AOV", money: true }
];

const metricOf = (orders: TrendOrder[], metric: TrendMetric) => {
  const delivered = orders.filter(isDelivered);
  switch (metric) {
    case "orders": return orders.length;
    case "delivered": return delivered.length;
    case "rate": return orders.length > 0 ? pctOf(delivered.length, orders.length) : null;
    case "revenue": return delivered.reduce((sum, order) => sum + order.amount, 0);
    case "unitsDelivered": return delivered.reduce((sum, order) => sum + order.units, 0);
    case "aov": return delivered.length > 0 ? delivered.reduce((sum, order) => sum + order.amount, 0) / delivered.length : null;
  }
};

/** One value per bucket for each series (series = a set of orders). */
export function seriesOver(series: Record<string, TrendOrder[]>, from: string, to: string, granularity: Granularity, metric: TrendMetric) {
  const keys = bucketKeys(from, to, granularity);
  const grouped: Record<string, Map<string, TrendOrder[]>> = {};
  for (const [name, orders] of Object.entries(series)) {
    const map = new Map<string, TrendOrder[]>();
    for (const order of orders) {
      const bucket = bucketOf(order.createdKey, granularity);
      const list = map.get(bucket);
      if (list) list.push(order); else map.set(bucket, [order]);
    }
    grouped[name] = map;
  }
  return keys.map((key) => {
    const row: Record<string, string | number | null> = { key };
    for (const name of Object.keys(series)) row[name] = metricOf(grouped[name].get(key) ?? [], metric);
    return row;
  });
}

// ── Rows for each tab ───────────────────────────────────────────────────────

export type ProductRow = {
  product: TrendProduct;
  now: Figures;
  before: Figures;
  topStatesByOrders: Share[];
  topStatesByDelivered: Share[];
  /** Orders per day (or week, for long periods) for the little chart. */
  spark: number[];
  stockWithAgents: number;
};

export function buildProductRows(args: {
  products: TrendProduct[];
  orders: TrendOrder[];
  previousOrders: TrendOrder[];
  costs: CostBook;
  previousCosts: CostBook;
  hubs: TrendHub[];
  from: string;
  to: string;
  /** No state/agent/status filter: product-level costs with no order stay on the row. */
  wholeProduct: boolean;
}): ProductRow[] {
  const { products, orders, previousOrders, costs, previousCosts, hubs, from, to, wholeProduct } = args;
  const sparkGrain: Granularity = daysBetween(from, to) > 45 ? "weekly" : "daily";
  const sparkKeys = bucketKeys(from, to, sparkGrain);
  return products
    .map((product) => {
      const mine = orders.filter((order) => order.productId === product.id);
      const before = previousOrders.filter((order) => order.productId === product.id);
      const counts = new Map<string, number>();
      for (const order of mine) counts.set(bucketOf(order.createdKey, sparkGrain), (counts.get(bucketOf(order.createdKey, sparkGrain)) ?? 0) + 1);
      return {
        product,
        now: figuresFor(mine, costs, wholeProduct ? costs.unplaced.get(product.id) ?? 0 : 0),
        before: figuresFor(before, previousCosts, wholeProduct ? previousCosts.unplaced.get(product.id) ?? 0 : 0),
        topStatesByOrders: topShares(mine, (order) => order.state),
        topStatesByDelivered: topShares(mine.filter(isDelivered), (order) => order.state),
        spark: sparkKeys.map((key) => counts.get(key) ?? 0),
        stockWithAgents: hubs.reduce((sum, hub) => sum + hub.stocks.filter((stock) => stock.productId === product.id).reduce((s, stock) => s + Math.max(0, stock.quantity), 0), 0)
      };
    })
    .filter((row) => row.now.orders > 0 || row.before.orders > 0 || row.now.net !== 0);
}

export type StateRow = {
  state: string;
  now: Figures;
  before: Figures;
  stockWithAgents: number;
  activeAgents: number;
  topProducts: Share[];
};

export function buildStateRows(args: { orders: TrendOrder[]; previousOrders: TrendOrder[]; costs: CostBook; previousCosts: CostBook; hubs: TrendHub[]; productId: string }): StateRow[] {
  const { orders, previousOrders, costs, previousCosts, hubs, productId } = args;
  const states = new Set<string>();
  for (const order of orders) if (order.state) states.add(order.state);
  return [...states].map((state) => {
    const mine = orders.filter((order) => order.state === state);
    const stateHubs = hubs.filter((hub) => hub.state === state);
    return {
      state,
      now: figuresFor(mine, costs),
      before: figuresFor(previousOrders.filter((order) => order.state === state), previousCosts),
      stockWithAgents: stateHubs.reduce((sum, hub) => sum + hub.stocks
        .filter((stock) => productId === ALL || stock.productId === productId)
        .reduce((s, stock) => s + Math.max(0, stock.quantity), 0), 0),
      activeAgents: new Set(stateHubs.filter((hub) => hub.active).map((hub) => hub.agentId)).size,
      topProducts: topShares(mine, (order) => order.productId)
    };
  }).sort((a, b) => b.now.orders - a.now.orders || a.state.localeCompare(b.state));
}

export type AgentRow = {
  agentId: string;
  name: string;
  states: string[];
  products: number;
  now: Figures;
  before: Figures;
  stockHeld: number;
  /** Same-state comparison: this agent's rate minus the other agents' rate there. */
  vsPeers: number | null;
  peerState: string | null;
};

export function buildAgentRows(args: { orders: TrendOrder[]; previousOrders: TrendOrder[]; costs: CostBook; previousCosts: CostBook; hubs: TrendHub[]; agents: TrendAgent[]; productId: string }): AgentRow[] {
  const { orders, previousOrders, costs, previousCosts, hubs, agents, productId } = args;
  const ids = new Set(orders.map((order) => order.agentId).filter(Boolean));
  const rows = [...ids].map((agentId) => {
    const mine = orders.filter((order) => order.agentId === agentId);
    const states = topShares(mine, (order) => order.state, 10).map((share) => share.key);
    return {
      agentId,
      name: agents.find((agent) => agent.id === agentId)?.name ?? hubs.find((hub) => hub.agentId === agentId)?.agentName ?? "Former agent",
      states,
      products: new Set(mine.map((order) => order.productId)).size,
      now: figuresFor(mine, costs),
      before: figuresFor(previousOrders.filter((order) => order.agentId === agentId), previousCosts),
      stockHeld: hubs.filter((hub) => hub.agentId === agentId).reduce((sum, hub) => sum + hub.stocks
        .filter((stock) => productId === ALL || stock.productId === productId)
        .reduce((s, stock) => s + Math.max(0, stock.quantity), 0), 0),
      vsPeers: null as number | null,
      peerState: null as string | null
    };
  });
  // Compare with the OTHER agents in the agent's main state, only when both
  // sides have enough orders to mean something (Bright's brief: sample size).
  for (const row of rows) {
    const state = row.states[0];
    if (!state || row.now.orders < MIN_RATE_SAMPLE) continue;
    const peers = orders.filter((order) => order.state === state && order.agentId && order.agentId !== row.agentId);
    if (peers.length < MIN_RATE_SAMPLE) continue;
    const peerRate = pctOf(peers.filter(isDelivered).length, peers.length);
    const ownInState = orders.filter((order) => order.state === state && order.agentId === row.agentId);
    if (ownInState.length < MIN_RATE_SAMPLE) continue;
    row.vsPeers = pctOf(ownInState.filter(isDelivered).length, ownInState.length) - peerRate;
    row.peerState = state;
  }
  return rows.sort((a, b) => b.now.orders - a.now.orders || a.name.localeCompare(b.name));
}

/** Product × state grid: one cell per pair that has orders. */
export function buildHeatmap(orders: TrendOrder[], costs: CostBook) {
  const cells = new Map<string, TrendOrder[]>();
  for (const order of orders) {
    if (!order.state) continue;
    const key = `${order.productId}|${order.state}`;
    const list = cells.get(key);
    if (list) list.push(order); else cells.set(key, [order]);
  }
  const out = new Map<string, Figures>();
  for (const [key, rows] of cells) out.set(key, figuresFor(rows, costs));
  return out;
}

/** Display name for a canonical state ("FCT Abuja" reads as "Abuja", as in the design). */
export const stateLabel = (state: string) => (state === "FCT Abuja" ? "Abuja" : state || "Unknown");
/** The map's name for a canonical state. */
export const mapStateName = (state: string) => (state === "FCT Abuja" ? "FCT" : state);

// ── Agent status (Bright's Agent Performance design, 20 Oct 2026) ───────────
// Bands by delivery rate, set around the 65 / 60 lines of the weekly rate
// rule. Below MIN_RATE_SAMPLE orders an agent is "New": too few to judge.
export const AGENT_STATUSES = [
  { key: "top", label: "Top Performer", min: 70, color: "#15803d" },
  { key: "potential", label: "High Potential", min: 66, color: "#1d4ed8" },
  { key: "strong", label: "Strong", min: 62, color: "#16a34a" },
  { key: "watch", label: "Watch", min: 57, color: "#d97706" },
  { key: "support", label: "Needs Support", min: 50, color: "#dc2626" },
  { key: "low", label: "Low Performance", min: -1, color: "#b91c1c" }
] as const;
export type AgentStatusKey = (typeof AGENT_STATUSES)[number]["key"] | "new";
export const agentStatusOf = (figures: Figures): AgentStatusKey =>
  figures.orders < MIN_RATE_SAMPLE ? "new" : AGENT_STATUSES.find((status) => figures.rate >= status.min)!.key;

// ── Stock (Bright's Stock Recommendation design, 20 Oct 2026) ───────────────
// The unit is the STATE here, as in the design. Per-agent shortfalls (two
// agents in a state can each be short while the state total looks fine) stay
// on Inventory › Who Needs Stock, which the tab links to.

export type StockBand = "Critical" | "High" | "Medium" | "Low";

/** Stock status of a state, from days of cover and waiting customers. */
export function stockBand(stock: number, waitingUnits: number, coverDays: number | null): StockBand {
  if (stock < waitingUnits || (coverDays !== null && coverDays < 7)) return "Critical";
  if (coverDays !== null && coverDays < 14) return "High";
  if (coverDays !== null && coverDays < 21) return "Medium";
  return "Low";
}

export type StockStateRow = {
  state: string;
  stock: number;
  /** Units on orders not yet delivered (customers waiting). */
  waitingUnits: number;
  /** Units likely to be ORDERED in the next 30 days at the period's pace. */
  forecast30: number;
  /** Of those, how many are likely to be delivered (state delivery rate). */
  deliverable30: number;
  rate: number;
  coverDays: number | null;
  need: number;
  priority: StockBand;
  recommended: number;
};

export type StockPlan = {
  rows: StockStateRow[];
  available: number;
  allocated: number;
  totalStock: number;
  waitingUnits: number;
  forecastLow: number;
  forecastHigh: number;
  coverDays: number | null;
  statesNeeding: number;
  reallocatable: number;
  netPerUnit: number;
  withoutDelivered: number;
  withDelivered: number;
};

/**
 * Where a product's warehouse stock should go. Need = waiting units + the
 * next 30 days' likely deliveries − stock already there. The warehouse units
 * are handed out by priority (Critical first), then by need × delivery rate,
 * so a state that delivers well gets served before one that does not.
 */
export function buildStockPlan(args: {
  orders: TrendOrder[]; productId: string; hubs: TrendHub[]; days: number; available: number; netPerUnit: number; overrides?: Record<string, number>;
}): StockPlan {
  const { orders, productId, hubs, days, available, netPerUnit, overrides } = args;
  const mine = orders.filter((order) => order.productId === productId);
  const overallRate = mine.length > 0 ? mine.filter(isDelivered).length / mine.length : 0;
  const states = new Set<string>();
  for (const order of mine) if (order.state) states.add(order.state);
  for (const hub of hubs) if (hub.state && hub.stocks.some((s) => s.productId === productId && s.quantity > 0)) states.add(hub.state);
  const lastWeekFrom = mine.reduce((max, order) => (order.createdKey > max ? order.createdKey : max), "");
  const recentStart = lastWeekFrom ? (() => { const d = new Date(`${lastWeekFrom}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - 6); return d.toISOString().slice(0, 10); })() : "";
  const rows: StockStateRow[] = [...states].map((state) => {
    const here = mine.filter((order) => order.state === state);
    const stock = hubs.filter((hub) => hub.state === state).reduce((sum, hub) => sum + hub.stocks.filter((s) => s.productId === productId).reduce((t, s) => t + Math.max(0, s.quantity), 0), 0);
    const waitingUnits = here.filter(isOpen).reduce((sum, order) => sum + order.units, 0);
    const forecast30 = (here.reduce((sum, order) => sum + order.units, 0) / Math.max(1, days)) * 30;
    const rate = here.length >= MIN_RATE_SAMPLE ? here.filter(isDelivered).length / here.length : overallRate;
    const deliverable30 = forecast30 * rate;
    const coverDays = deliverable30 > 0 ? stock / (deliverable30 / 30) : null;
    const need = Math.max(0, Math.round(waitingUnits + deliverable30 - stock));
    return { state, stock, waitingUnits, forecast30, deliverable30, rate: rate * 100, coverDays, need, priority: stockBand(stock, waitingUnits, coverDays), recommended: 0 };
  });
  const order: Record<StockBand, number> = { Critical: 0, High: 1, Medium: 2, Low: 3 };
  rows.sort((a, b) => order[a.priority] - order[b.priority] || b.need * b.rate - a.need * a.rate || a.state.localeCompare(b.state));
  let left = Math.max(0, Math.floor(available));
  for (const row of rows) {
    const give = overrides && row.state in overrides ? Math.max(0, Math.floor(overrides[row.state])) : Math.min(row.need, left);
    row.recommended = Math.min(give, left);
    left -= row.recommended;
  }
  // Forecast range: the period's pace and the last 7 days' pace.
  const unitsAll = mine.reduce((sum, o) => sum + o.units, 0);
  const paceAll = (unitsAll / Math.max(1, days)) * 30;
  const recentUnits = recentStart ? mine.filter((o) => o.createdKey >= recentStart).reduce((sum, o) => sum + o.units, 0) : 0;
  const paceRecent = days >= 14 ? (recentUnits / 7) * 30 : paceAll;
  const totalStock = rows.reduce((sum, row) => sum + row.stock, 0);
  const deliverableAll = rows.reduce((sum, row) => sum + row.deliverable30, 0);
  const withoutDelivered = rows.reduce((sum, row) => sum + Math.min(row.stock, row.deliverable30), 0);
  const withDelivered = rows.reduce((sum, row) => sum + Math.min(row.stock + row.recommended, row.deliverable30), 0);
  return {
    rows,
    available: Math.max(0, Math.floor(available)),
    allocated: rows.reduce((sum, row) => sum + row.recommended, 0),
    totalStock,
    waitingUnits: rows.reduce((sum, row) => sum + row.waitingUnits, 0),
    forecastLow: Math.round(Math.min(paceAll, paceRecent)),
    forecastHigh: Math.round(Math.max(paceAll, paceRecent)),
    coverDays: deliverableAll > 0 ? totalStock / (deliverableAll / 30) : null,
    statesNeeding: rows.filter((row) => row.priority === "Critical" || row.priority === "High").length,
    // Stock beyond 45 days of deliveries could serve a busier state.
    reallocatable: Math.round(rows.reduce((sum, row) => sum + (row.coverDays !== null && row.coverDays > 45 ? row.stock - (row.deliverable30 / 30) * 45 : row.deliverable30 === 0 ? row.stock : 0), 0)),
    netPerUnit,
    withoutDelivered: Math.round(withoutDelivered),
    withDelivered: Math.round(withDelivered)
  };
}

/** Nice bins for a map legend, highest first (e.g. 300+, 200-299, ..., 1-9, 0). */
export function countBins(max: number): number[] {
  if (max >= 150) return [300, 200, 100, 50, 10, 1];
  if (max >= 30) return [50, 30, 20, 10, 5, 1];
  return [10, 7, 5, 3, 2, 1];
}
