// Stock Intelligence (Product Trend › Stock Intelligence, Bright 23 Nov 2026).
// Pure rules - no database - so they can be tested. stock-intel-data.ts loads
// the rows; routes/stock-intel.ts serves the result; stock-intel-alerts.ts
// alerts from the SAME result, so the tab and the alerts never disagree.
//
// The unit is one agent HUB x one product (never the state: a state total
// hides an empty hub next to a full one - see State Replenishment).
//
// Per hub x product:
//   speed        = units delivered in the last `windowDays` ÷ windowDays
//   usable       = on the shelf − defective − missing − reserved (open orders
//                  already given to this hub)
//   days left    = (usable + in transit) ÷ speed
//   lead time    = Owner's setting, else the median of this hub's last
//                  received waybills (dispatched → received), else 4 days
//   safety stock = Owner's setting (days of sales), else 2 days
//   status       = against THIS hub's lead time, not one number for all:
//                  Critical      stock (incl. in transit) runs out before a
//                                restock sent today can arrive
//                  Restock Soon  runs out inside lead time + safety days
//                  Watch         within 3 more days of that
//                  Healthy       otherwise
//   restock      = speed × 7 + safety units − usable − in transit
//                  (Bright's example: 4 × 7 + 8 − 12 = 24)
//   at-risk      = orders expected in the gap between running out and the
//                  restock arriving (lost sales risk)
//
// A delivery streak counts days in a row (ending today, or yesterday when
// today has none yet) with at least one unit delivered. A Sunday with no
// delivery does not break it. A streak never decides a restock on its own.

export const DEFAULT_LEAD_DAYS = 4;
export const DEFAULT_SAFETY_DAYS = 2;
export const COVER_DAYS = 7;
export const WATCH_EXTRA_DAYS = 3;
const MAX_LEAD_SAMPLES = 5;

export type StockStatus = "Critical" | "Restock Soon" | "Watch" | "Healthy";
export const STATUS_ORDER: Record<StockStatus, number> = { Critical: 0, "Restock Soon": 1, Watch: 2, Healthy: 3 };

export type IntelHub = {
  locationId: string;
  agentId: string;
  agentName: string;
  hubName: string;
  state: string;
  /** productId -> pieces */
  stock: Map<string, { quantity: number; defective: number; missing: number }>;
};
export type IntelDelivery = { locationId: string; productId: string; units: number; dayKey: string; orderId: string };
export type IntelReserve = { locationId: string; productId: string; units: number; orderId: string };
export type IntelInbound = { locationId: string; productId: string; units: number };
export type IntelLeadSample = { locationId: string; days: number; receivedKey: string };
export type IntelRoute = { id?: string; destState: string; productId: string | null; sourceState: string | null; priority: number };
export type IntelSetting = { locationId: string | null; productId: string | null; leadTimeDays: number | null; safetyDays: number | null };

export type SourceOption = {
  kind: "warehouse" | "hub";
  label: string;
  state: string | null;
  locationId?: string;
  agentId?: string;
  /** Units this source can give without making itself short. */
  spare: number;
  /** Units suggested from this source. */
  units: number;
  priority: number;
  sameState?: boolean;
};

export type HubProductRow = {
  key: string;
  locationId: string;
  agentId: string;
  agentName: string;
  hubName: string;
  state: string;
  productId: string;
  onShelf: number;
  defective: number;
  missing: number;
  reserved: number;
  usable: number;
  inTransit: number;
  delivered: number;
  /** Units delivered in the window before this one (for "↑ 21%"). */
  deliveredPrev: number;
  deliveredOrders: number;
  daily: number[];
  speed: number;
  streak: number;
  /** The streak as it stood one window ago (for "↑ +1.2 days"). */
  streakBefore: number;
  daysLeft: number | null;
  leadDays: number;
  leadSource: "set" | "measured" | "default";
  safetyDays: number;
  safetyUnits: number;
  status: StockStatus;
  restock: number;
  atRiskUnits: number;
  atRiskOrders: number;
  sources: SourceOption[];
  primarySource: string;
};

export type HubRisk = {
  sourceState: string;
  productId: string;
  hubLabel: string;
  available: number;
  ownDemand: number;
  networkDemand: number;
  required: number;
  shortage: number;
  dependents: Array<{ state: string; agentName: string; locationId: string; units: number }>;
  dependentStates: string[];
};

export type FallbackChance = {
  locationId: string;
  agentName: string;
  state: string;
  productId: string;
  need: number;
  from: SourceOption;
};

export type IntelInput = {
  today: string;
  windowDays: number;
  hubs: IntelHub[];
  deliveries: IntelDelivery[];
  reserves: IntelReserve[];
  inbound: IntelInbound[];
  leadSamples: IntelLeadSample[];
  routes: IntelRoute[];
  settings: IntelSetting[];
  warehouse: Map<string, number>;
  /** Only these products (null = all). */
  productIds?: Set<string> | null;
};

export type IntelResult = {
  rows: HubProductRow[];
  hubRisks: HubRisk[];
  fallbacks: FallbackChance[];
  days: string[];
};

// ── Small helpers ───────────────────────────────────────────────────────────

export const shiftDay = (key: string, days: number) => {
  const date = new Date(`${key}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};
export const isSunday = (key: string) => new Date(`${key}T12:00:00Z`).getUTCDay() === 0;
export const daysBetweenKeys = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);

export function median(values: number[]) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Days in a row with a delivery, ending today (or yesterday if today has none yet). Sundays with none are skipped. */
export function deliveryStreak(deliveredDays: Set<string>, today: string, maxDays = 60) {
  let day = deliveredDays.has(today) ? today : shiftDay(today, -1);
  let streak = 0;
  for (let i = 0; i < maxDays; i += 1) {
    if (deliveredDays.has(day)) streak += 1;
    else if (!isSunday(day)) break;
    day = shiftDay(day, -1);
  }
  return streak;
}

/** Status against this hub's own lead time and safety days. */
export function statusFor(args: { usable: number; inTransit: number; speed: number; leadDays: number; safetyDays: number; reserved: number; onShelf: number }): StockStatus {
  const { usable, inTransit, speed, leadDays, safetyDays } = args;
  // Open orders already waiting on this hub with nothing to fill them.
  if (args.reserved > args.onShelf + inTransit) return "Critical";
  if (speed <= 0) return "Healthy";
  const cover = (usable + inTransit) / speed;
  if (cover < leadDays) return "Critical";
  if (cover < leadDays + safetyDays) return "Restock Soon";
  if (cover < leadDays + safetyDays + WATCH_EXTRA_DAYS) return "Watch";
  return "Healthy";
}

/** Bright's formula: speed × 7 + safety units − usable − in transit, never below 0. */
export function restockUnits(args: { speed: number; safetyUnits: number; usable: number; inTransit: number; reservedShort: number }) {
  return Math.max(0, Math.ceil(args.speed * COVER_DAYS + args.safetyUnits - args.usable - args.inTransit + args.reservedShort));
}

/** Units (and orders) expected between running out and a restock sent today arriving. */
export function atRisk(args: { usable: number; inTransit: number; speed: number; leadDays: number; unitsPerOrder: number; reservedShort: number }) {
  const gapUnits = args.speed > 0 ? Math.max(0, args.leadDays * args.speed - (args.usable + args.inTransit)) : 0;
  const units = gapUnits + args.reservedShort;
  return { units, orders: units > 0 ? Math.ceil(units / Math.max(1, args.unitsPerOrder)) : 0 };
}

/** The routes for one state and product, in priority order (a product's own rows replace the general ones). */
export function routesFor(routes: IntelRoute[], state: string, productId: string): IntelRoute[] {
  const forState = routes.filter((route) => route.destState === state);
  const own = forState.filter((route) => route.productId === productId);
  const chosen = own.length > 0 ? own : forState.filter((route) => route.productId === null);
  if (chosen.length === 0) return [{ destState: state, productId: null, sourceState: null, priority: 1 }];
  return [...chosen].sort((a, b) => a.priority - b.priority);
}

function settingFor(settings: IntelSetting[], locationId: string, productId: string) {
  const pick = (loc: string | null, prod: string | null) => settings.find((s) => s.locationId === loc && s.productId === prod);
  const order = [pick(locationId, productId), pick(locationId, null), pick(null, productId), pick(null, null)];
  return {
    leadTimeDays: order.find((s) => s?.leadTimeDays != null)?.leadTimeDays ?? null,
    safetyDays: order.find((s) => s?.safetyDays != null)?.safetyDays ?? null
  };
}

// ── The model ───────────────────────────────────────────────────────────────

export function buildStockIntel(input: IntelInput): IntelResult {
  const { today, hubs } = input;
  const windowDays = Math.max(1, input.windowDays);
  const windowStart = shiftDay(today, -(windowDays - 1));
  const days = Array.from({ length: windowDays }, (_, i) => shiftDay(windowStart, i));
  const keep = (productId: string) => !input.productIds || input.productIds.has(productId);
  const hubById = new Map(hubs.map((hub) => [hub.locationId, hub]));
  const k = (locationId: string, productId: string) => `${locationId}::${productId}`;

  // Deliveries per hub x product: window units, per day, all-time-in-range days (for streaks).
  const prevStart = shiftDay(windowStart, -windowDays);
  const delivered = new Map<string, { units: number; prev: number; orders: Set<string>; byDay: Map<string, number>; streakDays: Set<string> }>();
  for (const d of input.deliveries) {
    if (!hubById.has(d.locationId) || !keep(d.productId) || d.units <= 0) continue;
    const key = k(d.locationId, d.productId);
    const entry = delivered.get(key) ?? { units: 0, prev: 0, orders: new Set<string>(), byDay: new Map(), streakDays: new Set<string>() };
    entry.streakDays.add(d.dayKey);
    if (d.dayKey >= prevStart && d.dayKey < windowStart) entry.prev += d.units;
    if (d.dayKey >= windowStart && d.dayKey <= today) {
      entry.units += d.units;
      entry.orders.add(d.orderId);
      entry.byDay.set(d.dayKey, (entry.byDay.get(d.dayKey) ?? 0) + d.units);
    }
    delivered.set(key, entry);
  }
  const reserved = new Map<string, number>();
  for (const r of input.reserves) if (keep(r.productId)) reserved.set(k(r.locationId, r.productId), (reserved.get(k(r.locationId, r.productId)) ?? 0) + Math.max(0, r.units));
  const inbound = new Map<string, number>();
  for (const r of input.inbound) if (keep(r.productId)) inbound.set(k(r.locationId, r.productId), (inbound.get(k(r.locationId, r.productId)) ?? 0) + Math.max(0, r.units));
  const leadByHub = new Map<string, number[]>();
  for (const s of [...input.leadSamples].sort((a, b) => b.receivedKey.localeCompare(a.receivedKey))) {
    const list = leadByHub.get(s.locationId) ?? [];
    if (list.length < MAX_LEAD_SAMPLES && s.days >= 0) list.push(Math.max(1, s.days));
    leadByHub.set(s.locationId, list);
  }

  // Every hub x product that has stock, sales, open orders or stock on the way.
  const keys = new Set<string>();
  for (const hub of hubs) for (const [productId, s] of hub.stock) if (keep(productId) && (s.quantity > 0)) keys.add(k(hub.locationId, productId));
  for (const map of [delivered, reserved, inbound]) for (const key of map.keys()) if (hubById.has(key.split("::")[0])) keys.add(key);

  const rows: HubProductRow[] = [];
  for (const key of keys) {
    const [locationId, productId] = key.split("::");
    const hub = hubById.get(locationId)!;
    const shelf = hub.stock.get(productId) ?? { quantity: 0, defective: 0, missing: 0 };
    const onShelf = Math.max(0, shelf.quantity - shelf.defective - shelf.missing);
    const held = reserved.get(key) ?? 0;
    const usable = Math.max(0, onShelf - held);
    const reservedShort = Math.max(0, held - onShelf);
    const inTransit = inbound.get(key) ?? 0;
    const d = delivered.get(key);
    const units = d?.units ?? 0;
    const speed = units / windowDays;
    const setting = settingFor(input.settings, locationId, productId);
    const measured = median(leadByHub.get(locationId) ?? []);
    const leadDays = setting.leadTimeDays ?? (measured != null ? Math.round(measured * 10) / 10 : DEFAULT_LEAD_DAYS);
    const leadSource: HubProductRow["leadSource"] = setting.leadTimeDays != null ? "set" : measured != null ? "measured" : "default";
    const safetyDays = setting.safetyDays ?? DEFAULT_SAFETY_DAYS;
    const safetyUnits = Math.ceil(speed * safetyDays);
    const status = statusFor({ usable, inTransit, speed, leadDays, safetyDays, reserved: held, onShelf: onShelf });
    const restock = status === "Healthy" ? 0 : restockUnits({ speed, safetyUnits, usable, inTransit, reservedShort });
    const unitsPerOrder = d && d.orders.size > 0 ? units / d.orders.size : 1;
    const risk = atRisk({ usable, inTransit, speed, leadDays, unitsPerOrder, reservedShort });
    rows.push({
      key, locationId, agentId: hub.agentId, agentName: hub.agentName, hubName: hub.hubName, state: hub.state, productId,
      onShelf, defective: shelf.defective, missing: shelf.missing, reserved: held, usable, inTransit,
      delivered: units, deliveredPrev: d?.prev ?? 0, deliveredOrders: d?.orders.size ?? 0, daily: days.map((day) => d?.byDay.get(day) ?? 0),
      speed, streak: d ? deliveryStreak(d.streakDays, today) : 0,
      streakBefore: d ? deliveryStreak(new Set([...d.streakDays].filter((day) => day < windowStart)), shiftDay(windowStart, -1)) : 0,
      // Days left counts stock already on the way, like the status does.
      daysLeft: speed > 0 ? (usable + inTransit) / speed : null,
      leadDays, leadSource, safetyDays, safetyUnits, status, restock,
      atRiskUnits: Math.round(risk.units), atRiskOrders: risk.orders,
      sources: [], primarySource: "Main warehouse"
    });
  }

  // ── Where each restock should come from ──────────────────────────────────
  // A hub's spare = usable − (its own 7 days + safety) − what it already owes
  // a restock. Giving away more would make it the next shortage (brief §7).
  const ownNeed = (row: HubProductRow) => Math.ceil(row.speed * COVER_DAYS) + row.safetyUnits;
  const spare = new Map<string, number>();
  for (const row of rows) spare.set(row.key, Math.max(0, row.usable + row.inTransit - ownNeed(row)));
  for (const hub of hubs) for (const [productId, s] of hub.stock) {
    const key = k(hub.locationId, productId);
    if (!spare.has(key) && keep(productId)) spare.set(key, Math.max(0, s.quantity - s.defective - s.missing));
  }
  const warehouseLeft = new Map(input.warehouse);
  const hubsInState = (state: string) => hubs.filter((hub) => hub.state === state);
  const hubLabel = (hub: IntelHub) => (hub.hubName && hub.hubName !== hub.agentName ? `${hub.agentName} (${hub.hubName})` : hub.agentName);

  const short = rows.filter((row) => row.restock > 0).sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || b.atRiskOrders - a.atRiskOrders || b.restock - a.restock);
  const fallbacks: FallbackChance[] = [];
  for (const row of short) {
    const routes = routesFor(input.routes, row.state, row.productId);
    row.primarySource = routes[0].sourceState ? `${routes[0].sourceState === "FCT Abuja" ? "Abuja" : routes[0].sourceState} hub` : "Main warehouse";
    let need = row.restock;
    const options: SourceOption[] = [];
    // Another hub in the same state first: the shortest trip.
    for (const other of hubsInState(row.state)) {
      if (other.locationId === row.locationId || need <= 0) continue;
      const key = k(other.locationId, row.productId);
      const can = spare.get(key) ?? 0;
      if (can <= 0) continue;
      const units = Math.min(can, need);
      options.push({ kind: "hub", label: hubLabel(other), state: other.state, locationId: other.locationId, agentId: other.agentId, spare: can, units, priority: 0, sameState: true });
      spare.set(key, can - units);
      need -= units;
    }
    for (const route of routes) {
      if (need <= 0) break;
      if (route.sourceState === null) {
        const can = Math.max(0, warehouseLeft.get(row.productId) ?? 0);
        const units = Math.min(can, need);
        options.push({ kind: "warehouse", label: "Main warehouse", state: null, spare: can, units, priority: route.priority });
        warehouseLeft.set(row.productId, can - units);
        need -= units;
        continue;
      }
      for (const source of hubsInState(route.sourceState)) {
        if (need <= 0) break;
        const key = k(source.locationId, row.productId);
        const can = spare.get(key) ?? 0;
        const units = Math.min(can, need);
        options.push({ kind: "hub", label: hubLabel(source), state: source.state, locationId: source.locationId, agentId: source.agentId, spare: can, units, priority: route.priority });
        if (units > 0) {
          spare.set(key, can - units);
          need -= units;
          if (route.priority > 1) fallbacks.push({ locationId: row.locationId, agentName: row.agentName, state: row.state, productId: row.productId, need: row.restock, from: options[options.length - 1] });
        }
      }
    }
    row.sources = options;
  }

  // ── Hub dependency (brief §3) ─────────────────────────────────────────────
  // A hub that restocks other states must keep its own 7 days + safety AND
  // cover what those agents need. Abuja: 40 on hand, 15 own + 35 network = 50
  // -> 10 short.
  const hubRisks: HubRisk[] = [];
  const sourceStates = new Set(input.routes.filter((r) => r.sourceState && r.priority === 1).map((r) => r.sourceState!));
  const productsInPlay = new Set(rows.map((row) => row.productId));
  for (const sourceState of sourceStates) {
    const own = hubsInState(sourceState);
    if (own.length === 0) continue;
    for (const productId of productsInPlay) {
      const ownRows = rows.filter((row) => row.state === sourceState && row.productId === productId);
      const available = ownRows.reduce((sum, row) => sum + row.usable + row.inTransit, 0)
        + own.filter((hub) => !ownRows.some((row) => row.locationId === hub.locationId)).reduce((sum, hub) => {
          const s = hub.stock.get(productId); return sum + (s ? Math.max(0, s.quantity - s.defective - s.missing) : 0);
        }, 0);
      const ownDemand = ownRows.reduce((sum, row) => sum + ownNeed(row), 0);
      const dependents: HubRisk["dependents"] = [];
      for (const row of rows) {
        if (row.productId !== productId || row.restock <= 0) continue;
        const first = routesFor(input.routes, row.state, productId)[0];
        if (first.sourceState === sourceState) dependents.push({ state: row.state, agentName: row.agentName, locationId: row.locationId, units: row.restock });
      }
      const networkDemand = dependents.reduce((sum, d) => sum + d.units, 0);
      if (ownDemand + networkDemand <= 0) continue;
      const required = ownDemand + networkDemand;
      hubRisks.push({
        sourceState, productId, hubLabel: own.length === 1 ? hubLabel(own[0]) : `${sourceState === "FCT Abuja" ? "Abuja" : sourceState} hubs`,
        available, ownDemand, networkDemand, required, shortage: Math.max(0, required - available), dependents,
        dependentStates: [...new Set(input.routes.filter((r) => r.sourceState === sourceState && r.priority === 1).map((r) => r.destState))].sort()
      });
    }
  }
  hubRisks.sort((a, b) => b.shortage - a.shortage || b.required - a.required);

  rows.sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || (a.daysLeft ?? 1e9) - (b.daysLeft ?? 1e9) || b.delivered - a.delivered);
  return { rows, hubRisks, fallbacks, days };
}
