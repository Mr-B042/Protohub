import { nigerianPhoneCore } from "./ng-phone.js";
import { EMAIL_PATTERN, cleanEmail } from "./email-clean.js";

/**
 * Email Marketing rules (Bright, 8 Nov 2026). Pure functions, tested in
 * email-marketing-rules.test.ts; lib/email-marketing.ts does the reading and
 * writing.
 *
 * A "purchase" is a DELIVERED order: on pay-on-delivery an order is not money
 * until it arrives. A customer is a phone number (every order has one); an
 * email is something some customers add.
 */

export const DAY_MS = 86_400_000;
const LAGOS_OFFSET_MS = 60 * 60_000;

export const lagosDay = (ms: number) => new Date(ms + LAGOS_OFFSET_MS).toISOString().slice(0, 10);
export const lagosHour = (ms: number) => new Date(ms + LAGOS_OFFSET_MS).getUTCHours();

// ── Emails ────────────────────────────────────────────────────────────

// A usable email or null: shared with the order and cart routes (email-clean.ts).
export { EMAIL_PATTERN, cleanEmail };

/** Customers are matched on the phone's last 10 digits (080…, +234…, 80… are one person). */
export const phoneKey = (raw: unknown) => {
  const core = nigerianPhoneCore(String(raw ?? ""));
  return core.length >= 7 ? core : "";
};

// ── Customers ─────────────────────────────────────────────────────────

export type OrderLite = {
  phone: string | null;
  email: string | null;
  status: string;
  amount: number;
  quantity: number | null;
  productId: string | null;
  state: string | null;
  createdAt: string;
  deliveredDate: string | null;
  /** Where the order came from (Facebook, Instagram, TikTok, ...). */
  source?: string | null;
  upfrontPaid?: boolean;
  /** The rep's last call note (why an order went quiet). */
  outcome?: string;
};

export type CartLite = {
  phone: string | null;
  email: string | null;
  productId: string | null;
  createdAt: string;
  converted: boolean;
};

export type CustomerStats = {
  key: string;
  deliveredCount: number;
  deliveredTotal: number;
  firstDeliveredMs: number | null;
  lastDeliveredMs: number | null;
  lastDeliveredQty: number | null;
  /** When the most recently delivered order was placed. */
  lastDeliveredOrderCreatedMs: number | null;
  boughtProducts: Set<string>;
  interestProducts: Set<string>;
  state: string;
  lastOrderMs: number | null;
  /** Newest cart that never became an order. */
  lastOpenCartMs: number | null;
  name: string;
  email: string | null;
  /** The first order's source: where this customer first came from. */
  firstSource: string;
  upfrontPaid: boolean;
  /** Has an approved customer review (set from customer_reviews). */
  reviewed: boolean;
  /** Their latest order never got delivered, and why (quietReason); null = not quiet. */
  quietReason: QuietReason | null;
};

const deliveredMs = (order: OrderLite) => {
  // delivered_date is a calendar day; noon Lagos keeps it on that day.
  if (order.deliveredDate && /^\d{4}-\d{2}-\d{2}/.test(order.deliveredDate)) return Date.parse(`${order.deliveredDate.slice(0, 10)}T11:00:00Z`);
  return Date.parse(order.createdAt);
};

/** One record per customer (phone), from their orders and carts. */
export function buildCustomers(orders: OrderLite[], carts: CartLite[]): Map<string, CustomerStats> {
  const customers = new Map<string, CustomerStats>();
  const get = (key: string) => {
    let row = customers.get(key);
    if (!row) {
      row = { key, deliveredCount: 0, deliveredTotal: 0, firstDeliveredMs: null, lastDeliveredMs: null, lastDeliveredQty: null, lastDeliveredOrderCreatedMs: null, boughtProducts: new Set(), interestProducts: new Set(), state: "", lastOrderMs: null, lastOpenCartMs: null, name: "", email: null, firstSource: "", upfrontPaid: false, reviewed: false, quietReason: null };
      customers.set(key, row);
    }
    return row;
  };
  const sorted = [...orders].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  for (const order of sorted) {
    const key = phoneKey(order.phone);
    if (!key) continue;
    const row = get(key);
    const created = Date.parse(order.createdAt);
    if (Number.isFinite(created)) row.lastOrderMs = Math.max(row.lastOrderMs ?? 0, created);
    if (order.state) row.state = order.state;
    if (!row.firstSource && order.source) row.firstSource = order.source;
    if (order.upfrontPaid) row.upfrontPaid = true;
    const email = cleanEmail(order.email);
    if (email) row.email = email;
    if (order.productId) row.interestProducts.add(order.productId);
    if (order.status === "Delivered") {
      const when = deliveredMs(order);
      row.deliveredCount += 1;
      row.deliveredTotal += Number(order.amount) || 0;
      if (order.productId) row.boughtProducts.add(order.productId);
      if (Number.isFinite(when)) {
        row.firstDeliveredMs = row.firstDeliveredMs === null ? when : Math.min(row.firstDeliveredMs, when);
        if (row.lastDeliveredMs === null || when >= row.lastDeliveredMs) {
          row.lastDeliveredMs = when;
          row.lastDeliveredQty = order.quantity ?? null;
          row.lastDeliveredOrderCreatedMs = Number.isFinite(created) ? created : null;
        }
      }
    }
  }
  // Went quiet: judged on each customer's latest order (sorted oldest first above).
  const latest = new Map<string, OrderLite>();
  for (const order of sorted) { const key = phoneKey(order.phone); if (key) latest.set(key, order); }
  for (const [key, order] of latest) customers.get(key)!.quietReason = quietReason(order.status, order.outcome);
  for (const cart of carts) {
    const key = phoneKey(cart.phone);
    if (!key) continue;
    const row = get(key);
    if (cart.productId) row.interestProducts.add(cart.productId);
    const created = Date.parse(cart.createdAt);
    const email = cleanEmail(cart.email);
    if (email && !row.email) row.email = email;
    // A cart counts as left behind when it never became an order and no
    // order from this phone came after it.
    if (!cart.converted && Number.isFinite(created) && !(row.lastOrderMs !== null && row.lastOrderMs >= created)) {
      row.lastOpenCartMs = Math.max(row.lastOpenCartMs ?? 0, created);
    }
  }
  return customers;
}

/** Customers who have bought at least once. */
export const buyers = (customers: Iterable<CustomerStats>) => [...customers].filter((row) => row.deliveredCount > 0);

/** The spend a customer needs to be in the top `percent`% of buyers. */
export function spendThreshold(customers: Iterable<CustomerStats>, percent: number) {
  const totals = buyers(customers).map((row) => row.deliveredTotal).sort((a, b) => b - a);
  if (!totals.length) return Infinity;
  const count = Math.max(1, Math.ceil((totals.length * Math.min(100, Math.max(1, percent))) / 100));
  return totals[count - 1];
}

// ── People: customers and the email list together ─────────────────────

export type ContactLite = {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  source: string;
  status: string;
  createdAt: string;
  lastOpenedMs: number | null;
  lastClickedMs: number | null;
  lastEmailedMs: number | null;
};

export type Person = { key: string; contact: ContactLite | null; stats: CustomerStats | null };

/** Every customer plus every listed email, joined on phone (then on email). */
export function buildPeople(customers: Map<string, CustomerStats>, contacts: ContactLite[]): Person[] {
  const byEmail = new Map<string, CustomerStats>();
  for (const row of customers.values()) if (row.email) byEmail.set(row.email, row);
  const people = new Map<string, Person>();
  for (const row of customers.values()) people.set(`p:${row.key}`, { key: `p:${row.key}`, contact: null, stats: row });
  for (const contact of contacts) {
    const key = phoneKey(contact.phone);
    const stats = (key && customers.get(key)) || byEmail.get(contact.email) || null;
    const personKey = stats ? `p:${stats.key}` : `e:${contact.email}`;
    const person = people.get(personKey);
    // One person may have two emails over time; the subscribed, newest one wins.
    if (person) {
      if (!person.contact || (person.contact.status !== "subscribed" && contact.status === "subscribed") || (person.contact.status === contact.status && contact.createdAt > person.contact.createdAt)) person.contact = contact;
    } else {
      people.set(personKey, { key: personKey, contact, stats });
    }
  }
  return [...people.values()];
}

// ── Conditions ────────────────────────────────────────────────────────

// ── Customers who went quiet (Bright, 9 Nov 2026) ─────────────────────
// "Follow up customers who aren't scheduled but haven't been picking calls
// for days… forever till they buy." A customer is quiet when their LATEST
// order never got delivered: it failed, was postponed or cancelled, or it is
// still open but the last call note says they don't pick or reply. The
// reason (read from the rep's call note) picks the words of the email.

export const QUIET_REASONS = ["unreachable", "not_ready", "let_down", "said_no", "other"] as const;
export type QuietReason = (typeof QUIET_REASONS)[number];
export const QUIET_REASON_LABELS: Record<QuietReason, string> = {
  unreachable: "Stopped picking calls or replying",
  not_ready: "Not ready yet (travel, money, timing)",
  let_down: "We let them down (out of stock, can't reach their area)",
  said_no: "Said no thanks",
  other: "Other or no reason written"
};
const CLOSED_QUIET = new Set(["Failed", "Postponed", "Cancelled"]);
const OPEN = new Set(["New", "Confirmed"]);
const UNREACHABLE = /pick|respond|answer|reply|unreachable|switched off|busy|ignor|block|silent|hung up|ends the call|not reachable|unavailable on phone/;

/** Why a customer's latest order went quiet, or null when it doesn't count (delivered, still being worked normally, wrong number). */
export function quietReason(status: string, note: string | null | undefined): QuietReason | null {
  const t = String(note ?? "").toLowerCase();
  if (/wrong number|invalid number|not .*(his|her|their) number/.test(t)) return null;
  const open = OPEN.has(status);
  if (!open && !CLOSED_QUIET.has(status)) return null;
  // Open orders count only when the customer stopped answering.
  if (open) return UNREACHABLE.test(t) && !/stock|coverage/.test(t) ? "unreachable" : null;
  if (/stock|coverage|far|waybill|no rider/.test(t)) return "let_down";
  if (/not interested|doesn.?t want|don.?t want|stop (calling|disturb|question)|disturbing|reject|no longer need|changed (his|her|their) mind/.test(t)) return "said_no";
  if (UNREACHABLE.test(t)) return "unreachable";
  if (/travel|town|not back|back to|when (he|she|they)|ready|available|next week|next month|monday|tuesday|wednesday|thursday|friday|saturday|sunday|resched|reach out|call (me|back)|money|salary|payment|paid/.test(t)) return "not_ready";
  return "other";
}

export type ConditionField =
  | "purchased_product" | "purchase_count" | "last_purchase_days" | "first_purchase_days"
  | "total_spent" | "avg_order_value" | "spend_top_percent" | "state" | "cart_abandoned"
  | "product_interest" | "email_opened" | "email_clicked" | "joined_days" | "source" | "upsell_ready"
  | "contact_status" | "tag" | "left_review" | "order_source" | "went_quiet" | "ever_ordered";

export type Condition = { field: ConditionField; op: string; value: string | number };

/** `exclude`: anyone matching ANY of these is left out (Create Segment, "And exclude customers"). */
export type SegmentRule = { match: "all" | "any"; conditions: Condition[]; exclude?: Condition[] };

/** The picker in the condition builder: plain words for every field and test. */
export const CONDITION_FIELDS: Array<{ field: ConditionField; group: string; label: string; ops: Array<{ op: string; label: string }>; value: "product" | "number" | "days" | "money" | "percent" | "state" | "source" | "none" | "status" | "tag" | "channel" | "quiet"; unit?: string }> = [
  { field: "purchased_product", group: "Purchase History", label: "Purchase History", ops: [{ op: "is", label: "Purchased product" }, { op: "is_not", label: "Never bought product" }], value: "product" },
  { field: "purchase_count", group: "Purchase Frequency", label: "Purchase Frequency", ops: [{ op: "gte", label: "Is at least" }, { op: "lte", label: "Is at most" }, { op: "eq", label: "Is exactly" }], value: "number", unit: "times" },
  { field: "last_purchase_days", group: "Last Purchase", label: "Last Purchase", ops: [{ op: "within", label: "Within last" }, { op: "over", label: "More than" }], value: "days", unit: "ago" },
  { field: "first_purchase_days", group: "First Purchase", label: "First Purchase", ops: [{ op: "within", label: "Within last" }], value: "days" },
  { field: "total_spent", group: "Money Spent", label: "Total Spent", ops: [{ op: "gte", label: "Is at least" }, { op: "lte", label: "Is at most" }], value: "money" },
  { field: "avg_order_value", group: "Money Spent", label: "Average Order", ops: [{ op: "gte", label: "Is at least" }, { op: "lte", label: "Is at most" }], value: "money" },
  { field: "spend_top_percent", group: "Money Spent", label: "Top Spenders", ops: [{ op: "top", label: "Is in the top" }], value: "percent", unit: "% by spend" },
  { field: "state", group: "Location", label: "Location / State", ops: [{ op: "is", label: "Is" }, { op: "is_not", label: "Is not" }], value: "state" },
  { field: "cart_abandoned", group: "Carts", label: "Left a Cart", ops: [{ op: "within", label: "Within last" }, { op: "none_within", label: "None in the last" }], value: "days" },
  { field: "product_interest", group: "Purchase History", label: "Interested In", ops: [{ op: "is", label: "Ordered or carted" }], value: "product" },
  { field: "email_opened", group: "Email Activity", label: "Opened an Email", ops: [{ op: "within", label: "Within last" }, { op: "not_within", label: "Not within last" }], value: "days" },
  { field: "email_clicked", group: "Email Activity", label: "Clicked an Email", ops: [{ op: "within", label: "Within last" }, { op: "not_within", label: "Not within last" }], value: "days" },
  { field: "joined_days", group: "Email List", label: "Joined the List", ops: [{ op: "within", label: "Within last" }], value: "days" },
  { field: "source", group: "Email List", label: "Came From", ops: [{ op: "is", label: "Is" }], value: "source" },
  { field: "upsell_ready", group: "Purchase History", label: "Bought One Unit", ops: [{ op: "is", label: "Last order was 1 unit" }], value: "none" },
  { field: "order_source", group: "Location", label: "First Order From", ops: [{ op: "is", label: "Is" }, { op: "is_not", label: "Is not" }], value: "channel" },
  { field: "went_quiet", group: "Purchase History", label: "Went Quiet", ops: [{ op: "is", label: "Latest order never delivered:" }], value: "quiet" },
  { field: "ever_ordered", group: "Purchase History", label: "Ever Ordered", ops: [{ op: "is", label: "Has placed an order (any status)" }, { op: "is_not", label: "Has never placed an order" }], value: "none" },
  { field: "left_review", group: "Purchase History", label: "Left a Review", ops: [{ op: "is", label: "Has an approved review" }, { op: "is_not", label: "Has no approved review" }], value: "none" },
  { field: "contact_status", group: "Email List", label: "Customer Status", ops: [{ op: "is", label: "Is" }, { op: "is_not", label: "Is not" }], value: "status" },
  { field: "tag", group: "Email List", label: "Tag", ops: [{ op: "is", label: "Has tag" }, { op: "is_not", label: "Doesn't have tag" }], value: "tag" }
];

export type MatchContext = { nowMs: number; topSpend: (percent: number) => number; hasTag?: (person: Person, tagId: string) => boolean };

export function contextFor(customers: Map<string, CustomerStats>, nowMs: number, hasTag?: (person: Person, tagId: string) => boolean): MatchContext {
  const cache = new Map<number, number>();
  return {
    nowMs,
    hasTag,
    topSpend: (percent) => {
      if (!cache.has(percent)) cache.set(percent, spendThreshold(customers.values(), percent));
      return cache.get(percent)!;
    }
  };
}

const num = (value: unknown, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

export function personMatches(person: Person, condition: Condition, ctx: MatchContext): boolean {
  const stats = person.stats;
  const contact = person.contact;
  const days = num(condition.value) * DAY_MS;
  const count = stats?.deliveredCount ?? 0;
  const total = stats?.deliveredTotal ?? 0;
  switch (condition.field) {
    case "purchased_product": {
      const has = !!stats?.boughtProducts.has(String(condition.value));
      return condition.op === "is_not" ? !has : has;
    }
    case "purchase_count": {
      const n = num(condition.value);
      return condition.op === "lte" ? count <= n : condition.op === "eq" ? count === n : count >= n;
    }
    case "last_purchase_days": {
      if (!stats?.lastDeliveredMs) return false;
      const age = ctx.nowMs - stats.lastDeliveredMs;
      return condition.op === "over" ? age > days : age <= days;
    }
    case "first_purchase_days":
      return !!stats?.firstDeliveredMs && ctx.nowMs - stats.firstDeliveredMs <= days;
    case "total_spent":
      return condition.op === "lte" ? count > 0 && total <= num(condition.value) : total >= num(condition.value) && count > 0;
    case "avg_order_value": {
      if (!count) return false;
      const average = total / count;
      return condition.op === "lte" ? average <= num(condition.value) : average >= num(condition.value);
    }
    case "spend_top_percent":
      return count > 0 && total >= ctx.topSpend(num(condition.value, 20));
    case "state": {
      const same = !!stats?.state && stats.state.trim().toLowerCase() === String(condition.value).trim().toLowerCase();
      return condition.op === "is_not" ? !same : same;
    }
    case "cart_abandoned": {
      const recent = !!stats?.lastOpenCartMs && ctx.nowMs - stats.lastOpenCartMs <= days;
      return condition.op === "none_within" ? !recent : recent;
    }
    case "product_interest":
      return !!stats?.interestProducts.has(String(condition.value));
    case "email_opened":
    case "email_clicked": {
      const at = condition.field === "email_opened" ? contact?.lastOpenedMs : contact?.lastClickedMs;
      const recent = !!at && ctx.nowMs - at <= days;
      return condition.op === "not_within" ? !recent : recent;
    }
    case "joined_days":
      return !!contact && ctx.nowMs - Date.parse(contact.createdAt) <= days;
    case "source":
      return !!contact && contact.source === String(condition.value);
    case "upsell_ready":
      return count > 0 && stats?.lastDeliveredQty === 1;
    case "order_source": {
      const same = !!stats?.firstSource && stats.firstSource.toLowerCase() === String(condition.value).toLowerCase();
      return condition.op === "is_not" ? !same : same;
    }
    case "ever_ordered":
      return condition.op === "is_not" ? !stats?.lastOrderMs : !!stats?.lastOrderMs;
    case "left_review":
      return condition.op === "is_not" ? !stats?.reviewed : !!stats?.reviewed;
    case "went_quiet":
      return !!stats?.quietReason && (String(condition.value) === "any" || stats.quietReason === condition.value);
    case "contact_status": {
      const same = (contact?.status ?? "") === String(condition.value);
      return condition.op === "is_not" ? !same : same;
    }
    case "tag": {
      const has = !!ctx.hasTag?.(person, String(condition.value));
      return condition.op === "is_not" ? !has : has;
    }
    default:
      return false;
  }
}

export function segmentMatches(person: Person, rule: SegmentRule, ctx: MatchContext) {
  const exclude = (rule.exclude ?? []).filter((c) => c && c.field);
  if (exclude.length && exclude.some((c) => personMatches(person, c, ctx))) return false;
  const conditions = (rule.conditions ?? []).filter((c) => c && c.field);
  if (!conditions.length) return true;
  return rule.match === "any" ? conditions.some((c) => personMatches(person, c, ctx)) : conditions.every((c) => personMatches(person, c, ctx));
}

/** Checks a condition list from the browser: known fields and tests only. */
export function cleanConditions(raw: unknown): Condition[] {
  if (!Array.isArray(raw)) return [];
  const out: Condition[] = [];
  for (const item of raw.slice(0, 12)) {
    const field = CONDITION_FIELDS.find((row) => row.field === (item as Condition)?.field);
    if (!field) continue;
    const op = field.ops.some((row) => row.op === (item as Condition).op) ? (item as Condition).op : field.ops[0].op;
    const value = (item as Condition).value;
    out.push({ field: field.field, op, value: typeof value === "number" ? value : String(value ?? "").slice(0, 120) });
  }
  return out;
}


/**
 * Second batch of ready-made groups (Bright, 9 Nov 2026: "which segment are
 * we missing… create them"). Added to every branch once, after the first
 * batch: customers who went quiet (all, and by reason, matching the
 * Autopilot follow-ups), one-time buyers, top spenders, engaged readers,
 * buyers of each best seller and the next biggest states after Lagos.
 */
export function builtInSegmentsV2(topProducts: Array<{ id: string; name: string }>, topStates: string[]): BuiltInSegment[] {
  const quiet = (key: string, name: string, description: string, value: string): BuiltInSegment =>
    ({ key, name, description, icon: "alert", match: "all", conditions: [{ field: "went_quiet", op: "is", value }] });
  return [
    quiet("quiet_all", "Went Quiet – Everyone", "Ordered, but their latest order was never delivered (failed, postponed, cancelled or stopped answering)", "any"),
    quiet("quiet_unreachable", "Went Quiet – Stopped Answering", "Stopped picking calls or replying to messages", "unreachable"),
    quiet("quiet_not_ready", "Went Quiet – Not Ready Yet", "Travelled, no money yet, or asked to wait", "not_ready"),
    quiet("quiet_let_down", "Went Quiet – We Let Them Down", "We couldn't deliver: out of stock, or we couldn't reach their area", "let_down"),
    quiet("quiet_said_no", "Went Quiet – Said No", "Told the rep they no longer want it", "said_no"),
    { key: "one_time", name: "One-Time Buyers", description: "One delivery, 30+ days ago: ready for a second order", icon: "userplus", match: "all",
      conditions: [{ field: "purchase_count", op: "eq", value: 1 }, { field: "last_purchase_days", op: "over", value: 30 }] },
    { key: "top_spenders", name: "Top 20% Spenders", description: "The fifth of customers who spent the most", icon: "crown", match: "all", conditions: [{ field: "spend_top_percent", op: "top", value: 20 }] },
    { key: "engaged", name: "Engaged Readers", description: "Opened an email in the last 30 days", icon: "mail", match: "all", conditions: [{ field: "email_opened", op: "within", value: 30 }] },
    ...topProducts.map((product): BuiltInSegment => ({
      key: `bought_${product.id.slice(0, 8)}`, name: `Bought: ${product.name}`, description: `Got ${product.name} delivered`, icon: "cart", match: "all",
      conditions: [{ field: "purchased_product", op: "is", value: product.id }]
    })),
    ...topStates.map((state): BuiltInSegment => ({
      key: `state_${state.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 30)}`, name: `By Location – ${state.replace(/^FCT\s+/i, "")}`, description: `Customers in ${state}`, icon: "pin", match: "all",
      conditions: [{ field: "state", op: "is", value: state }]
    }))
  ];
}

// ── Ready-made groups ─────────────────────────────────────────────────

export type BuiltInSegment = { key: string; name: string; description: string; icon: string; match: "all" | "any"; conditions: Condition[] };

/** The eight groups on Bright's Audience & Segments design, added once per branch. */
export function builtInSegments(topProduct: { id: string; name: string } | null): BuiltInSegment[] {
  return [
    { key: "vip", name: "VIP Customers", description: "High-value customers (average order ₦50,000+)", icon: "crown", match: "all", conditions: [{ field: "avg_order_value", op: "gte", value: 50000 }] },
    { key: "repeat", name: "Repeat Buyers", description: "Customers with 2+ delivered orders", icon: "refresh", match: "all", conditions: [{ field: "purchase_count", op: "gte", value: 2 }] },
    { key: "recent", name: "Recent Buyers", description: "Got a delivery in the last 30 days", icon: "cart", match: "all", conditions: [{ field: "last_purchase_days", op: "within", value: 30 }] },
    { key: "inactive", name: "Inactive Customers", description: "No purchase in 60+ days", icon: "clock", match: "all", conditions: [{ field: "last_purchase_days", op: "over", value: 60 }] },
    { key: "cart", name: "Cart Abandoners", description: "Added to cart but didn't complete the order", icon: "cartx", match: "all", conditions: [{ field: "cart_abandoned", op: "within", value: 365 }] },
    ...(topProduct ? [{ key: "interest_top", name: `Product Interest: ${topProduct.name}`, description: `Ordered or carted ${topProduct.name}`, icon: "sparkles", match: "all" as const, conditions: [{ field: "product_interest" as ConditionField, op: "is", value: topProduct.id }] }] : []),
    { key: "upsell", name: "Upsell Opportunity", description: "Last order was a single unit: ready for a bigger pack", icon: "tag", match: "all", conditions: [{ field: "upsell_ready", op: "is", value: "yes" }] },
    { key: "lagos", name: "By Location – Lagos", description: "Customers in Lagos State", icon: "pin", match: "all", conditions: [{ field: "state", op: "is", value: "Lagos" }] }
  ];
}

/** Step 2's quick tiles and the Overview's segment list. */
export const QUICK_SEGMENTS: Record<string, { name: string; hint: string; icon: string; rule: SegmentRule }> = {
  recent: { name: "Recent Buyers", hint: "Last 30 days", icon: "cart", rule: { match: "all", conditions: [{ field: "last_purchase_days", op: "within", value: 30 }] } },
  repeat: { name: "Repeat Buyers", hint: "2+ purchases", icon: "refresh", rule: { match: "all", conditions: [{ field: "purchase_count", op: "gte", value: 2 }] } },
  high_value: { name: "High-Value", hint: "Top 20% by spend", icon: "crown", rule: { match: "all", conditions: [{ field: "spend_top_percent", op: "top", value: 20 }] } },
  at_risk: { name: "At-Risk Customers", hint: "No purchase in 60+ days", icon: "alert", rule: { match: "all", conditions: [{ field: "last_purchase_days", op: "over", value: 60 }, { field: "last_purchase_days", op: "within", value: 90 }] } },
  cart: { name: "Cart Abandoners", hint: "Added to cart, no order", icon: "cartx", rule: { match: "all", conditions: [{ field: "cart_abandoned", op: "within", value: 30 }] } },
  inactive: { name: "Inactive Customers", hint: "No purchase in 90+ days", icon: "pause", rule: { match: "all", conditions: [{ field: "last_purchase_days", op: "over", value: 90 }] } },
  new: { name: "New Customers", hint: "First purchase", icon: "userplus", rule: { match: "all", conditions: [{ field: "purchase_count", op: "eq", value: 1 }] } },
  location: { name: "Location / State", hint: "Target by state/region", icon: "pin", rule: { match: "all", conditions: [{ field: "state", op: "is", value: "Lagos" }] } }
};

export const OVERVIEW_SEGMENTS: Array<{ key: string; name: string; icon: string; rule: SegmentRule }> = [
  { key: "all", name: "All Customers", icon: "users", rule: { match: "all", conditions: [] } },
  { key: "repeat", name: "Repeat Buyers", icon: "refresh", rule: QUICK_SEGMENTS.repeat.rule },
  { key: "high_value", name: "High-Value (Top 20%)", icon: "crown", rule: QUICK_SEGMENTS.high_value.rule },
  { key: "inactive30", name: "Inactive (30+ Days)", icon: "clock", rule: { match: "all", conditions: [{ field: "last_purchase_days", op: "over", value: 30 }] } },
  { key: "new7", name: "New Customers (≤7 Days)", icon: "userplus", rule: { match: "all", conditions: [{ field: "first_purchase_days", op: "within", value: 7 }] } }
];

/** Step 2 "Customer Journey Audience": where a customer is right now. */
export const JOURNEY_STAGES: Record<string, { name: string; hint: string; rule: SegmentRule }> = {
  just_delivered: { name: "Just delivered", hint: "Got a delivery in the last 7 days", rule: { match: "all", conditions: [{ field: "last_purchase_days", op: "within", value: 7 }] } },
  new_customer: { name: "New customer", hint: "First order delivered in the last 30 days", rule: { match: "all", conditions: [{ field: "first_purchase_days", op: "within", value: 30 }, { field: "purchase_count", op: "eq", value: 1 }] } },
  repeat: { name: "Repeat customer", hint: "2 or more deliveries", rule: { match: "all", conditions: [{ field: "purchase_count", op: "gte", value: 2 }] } },
  at_risk: { name: "Going quiet", hint: "Last delivery 60 to 90 days ago", rule: { match: "all", conditions: [{ field: "last_purchase_days", op: "over", value: 60 }, { field: "last_purchase_days", op: "within", value: 90 }] } },
  lapsed: { name: "Gone quiet", hint: "No delivery in 90+ days", rule: { match: "all", conditions: [{ field: "last_purchase_days", op: "over", value: 90 }] } },
  cart: { name: "Left a cart", hint: "Left a cart in the last 7 days", rule: { match: "all", conditions: [{ field: "cart_abandoned", op: "within", value: 7 }] } },
  never_bought: { name: "Never bought", hint: "On the list, no delivery yet", rule: { match: "all", conditions: [{ field: "purchase_count", op: "eq", value: 0 }] } }
};

// ── Who gets a campaign ───────────────────────────────────────────────

export type AudienceChoice = {
  source: "all" | "segment" | "custom" | "journey" | "list";
  segmentId?: string;
  custom?: { name?: string; match: "all" | "any"; conditions: Condition[] };
  journeyStage?: string;
  listId?: string;
  exclude?: { on: boolean; segmentId?: string; boughtWithinDays?: number; emailedWithinDays?: number };
};

export type SavedSegment = { id: string; name: string; kind: "auto" | "fixed"; match: "all" | "any"; conditions: Condition[]; exclude?: Condition[]; contactIds: string[] };

/** The rule behind an audience choice (null = nobody, e.g. a deleted group). */
export function ruleFor(choice: AudienceChoice, segments: Map<string, SavedSegment>): { rule: SegmentRule; fixedIds: Set<string> | null } | null {
  if (choice.source === "all") return { rule: { match: "all", conditions: [] }, fixedIds: null };
  if (choice.source === "custom") return { rule: { match: choice.custom?.match === "any" ? "any" : "all", conditions: cleanConditions(choice.custom?.conditions) }, fixedIds: null };
  if (choice.source === "journey") {
    const stage = JOURNEY_STAGES[choice.journeyStage ?? ""];
    return stage ? { rule: stage.rule, fixedIds: null } : null;
  }
  const segment = segments.get((choice.source === "list" ? choice.listId : choice.segmentId) ?? "");
  if (!segment) return null;
  return segment.kind === "fixed"
    ? { rule: { match: "all", conditions: [] }, fixedIds: new Set(segment.contactIds) }
    : { rule: { match: segment.match, conditions: segment.conditions, exclude: segment.exclude }, fixedIds: null };
}

export type AudienceResult = {
  /** Customers and listed people the rules pick, email or not. */
  matched: Person[];
  /** The ones who will get the email: on the list and subscribed. */
  recipients: Person[];
  /** Picked but on the list as unsubscribed or bounced. */
  optedOut: number;
};

export function resolveAudience(people: Person[], choice: AudienceChoice, segments: Map<string, SavedSegment>, ctx: MatchContext): AudienceResult {
  const base = ruleFor(choice, segments);
  if (!base) return { matched: [], recipients: [], optedOut: 0 };
  let matched = people.filter((person) => (base.fixedIds ? !!person.contact && base.fixedIds.has(person.contact.id) : segmentMatches(person, base.rule, ctx)));
  // "All Customers" means everyone we can reach plus every buyer.
  if (choice.source === "all") matched = people.filter((person) => !!person.contact || (person.stats?.deliveredCount ?? 0) > 0);
  const exclude = choice.exclude;
  if (exclude?.on) {
    const skip = exclude.segmentId ? ruleFor({ source: "segment", segmentId: exclude.segmentId }, segments) : null;
    matched = matched.filter((person) => {
      if (skip && (skip.fixedIds ? !!person.contact && skip.fixedIds.has(person.contact.id) : segmentMatches(person, skip.rule, ctx))) return false;
      if (exclude.boughtWithinDays && person.stats?.lastDeliveredMs && ctx.nowMs - person.stats.lastDeliveredMs <= exclude.boughtWithinDays * DAY_MS) return false;
      if (exclude.emailedWithinDays && person.contact?.lastEmailedMs && ctx.nowMs - person.contact.lastEmailedMs <= exclude.emailedWithinDays * DAY_MS) return false;
      return true;
    });
  }
  const recipients = matched.filter((person) => person.contact?.status === "subscribed");
  const optedOut = matched.filter((person) => person.contact && person.contact.status !== "subscribed").length;
  return { matched, recipients, optedOut };
}

/** A/B: alternate down the list sorted by email, so each half is a fair mix. */
export function assignVariants<T extends { email: string }>(rows: T[], abTest: boolean): Array<T & { variant: "a" | "b" }> {
  const sorted = [...rows].sort((a, b) => a.email.localeCompare(b.email));
  return sorted.map((row, index) => ({ ...row, variant: abTest && index % 2 === 1 ? "b" : "a" }));
}

// ── Sending times ─────────────────────────────────────────────────────

export type Delivery = {
  type: "one_time" | "recurring" | "automation";
  sendAt?: string | null;
  repeat?: { every: "day" | "week" | "month"; until?: string | null };
  automation?: {
    /** The step 4 ready-made flow it started from, if any. */
    preset?: "post_purchase" | "win_back" | "cart_recovery" | null;
    trigger: "delivered" | "ordered" | "cart" | "inactive";
    delayHours: number;
    inactiveDays?: number;
    exit: "none" | "purchased";
  };
};

/** Step 4's ready-made flows: each sets this campaign's trigger, wait and stop rule. */
export const AUTOMATION_PRESETS: Record<string, { name: string; hint: string; trigger: "delivered" | "ordered" | "cart" | "inactive"; delayHours: number; inactiveDays?: number; exit: "none" | "purchased"; goal: string }> = {
  post_purchase: { name: "Post-Purchase Follow-Up", hint: "Thank you, usage tips, and upsell", trigger: "delivered", delayHours: 48, exit: "purchased", goal: "Increase repeat purchase" },
  win_back: { name: "Win-Back (Inactive Customers)", hint: "Re-engage customers after no purchase", trigger: "inactive", delayHours: 0, inactiveDays: 60, exit: "purchased", goal: "Bring them back" },
  cart_recovery: { name: "Abandoned Cart Recovery", hint: "Remind customers to complete their order", trigger: "cart", delayHours: 1, exit: "purchased", goal: "Finish the order" },
  // A day after the delivery, so the order's points are in (Loyalty & Rewards gives them within 10 minutes).
  loyalty: { name: "Loyalty Reward", hint: "Tell members their points, level and voucher", trigger: "delivered", delayHours: 24, exit: "none", goal: "Bring members back" }
};

/** The next send time after `afterMs` for a repeating campaign (null when it has ended). */
export function nextRepeatAt(delivery: Delivery, afterMs: number): number | null {
  if (delivery.type !== "recurring" || !delivery.sendAt) return null;
  const start = Date.parse(delivery.sendAt);
  if (!Number.isFinite(start)) return null;
  const until = delivery.repeat?.until ? Date.parse(delivery.repeat.until) : Infinity;
  const every = delivery.repeat?.every ?? "week";
  let next = start;
  let guard = 0;
  while (next <= afterMs && guard < 5000) {
    guard += 1;
    if (every === "month") {
      const d = new Date(start);
      const months = guard;
      const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1, d.getUTCHours(), d.getUTCMinutes()));
      const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
      target.setUTCDate(Math.min(d.getUTCDate(), lastDay));
      next = target.getTime();
    } else {
      next = start + guard * (every === "day" ? DAY_MS : 7 * DAY_MS);
    }
  }
  return next <= until ? next : null;
}

/** When a customer's automation email is due (null = not due for this trigger). */
export function automationDueMs(delivery: Delivery, person: Person): number | null {
  const auto = delivery.automation;
  if (!auto || !person.stats) return null;
  const delay = Math.max(0, auto.delayHours) * 60 * 60_000;
  if (auto.trigger === "delivered") return person.stats.lastDeliveredMs !== null ? person.stats.lastDeliveredMs + delay : null;
  if (auto.trigger === "ordered") return person.stats.lastOrderMs !== null ? person.stats.lastOrderMs + delay : null;
  if (auto.trigger === "cart") return person.stats.lastOpenCartMs !== null ? person.stats.lastOpenCartMs + delay : null;
  if (auto.trigger === "inactive") return person.stats.lastDeliveredMs !== null ? person.stats.lastDeliveredMs + Math.max(1, auto.inactiveDays ?? 60) * DAY_MS : null;
  return null;
}

/**
 * Who an automation emails now: due, the trigger happened after the
 * automation was switched on (no emails about old events), not already sent
 * and, with the "stop after another purchase" exit, no newer delivery.
 */
export function automationRecipients(delivery: Delivery, people: Person[], startedMs: number, nowMs: number, alreadySent: Set<string>): Person[] {
  const auto = delivery.automation;
  if (!auto) return [];
  return people.filter((person) => {
    if (!person.contact || person.contact.status !== "subscribed" || alreadySent.has(person.contact.email)) return false;
    const due = automationDueMs(delivery, person);
    if (due === null || due > nowMs) return false;
    // When the thing happened: the delivery / order / cart, or the day an
    // inactive customer crossed the line. Only events after switch-on count.
    const eventMs = auto.trigger === "inactive" ? due : due - Math.max(0, auto.delayHours) * 60 * 60_000;
    if (eventMs < startedMs) return false;
    const lastOrder = person.stats?.lastOrderMs ?? null;
    // A cart that later became an order is not "left behind".
    if (auto.trigger === "cart" && lastOrder !== null && person.stats?.lastOpenCartMs !== null && lastOrder >= (person.stats?.lastOpenCartMs ?? Infinity)) return false;
    // An order placed after the delivered one: not inactive any more, and
    // "stop when they buy again" for the delivery follow-up.
    const newerOrder = lastOrder !== null && person.stats?.lastDeliveredOrderCreatedMs != null && lastOrder > person.stats.lastDeliveredOrderCreatedMs;
    if (auto.trigger === "inactive" && newerOrder) return false;
    if (auto.exit === "purchased" && auto.trigger === "delivered" && newerOrder) return false;
    if (auto.exit === "purchased" && auto.trigger === "cart" && person.stats?.lastDeliveredMs != null && person.stats.lastDeliveredMs > eventMs) return false;
    return true;
  });
}

/** The 2-hour window when most customers order (Lagos time), from real orders. */
export function bestSendWindow(createdAtMs: number[]): { startHour: number; endHour: number; share: number } | null {
  if (createdAtMs.length < 20) return null;
  const hours = new Array(24).fill(0);
  for (const ms of createdAtMs) hours[lagosHour(ms)] += 1;
  let best = 8, bestCount = -1, bestScore = -1;
  for (let h = 7; h <= 21; h += 1) {
    const count = hours[h] + hours[(h + 1) % 24];
    // On a tie, start at the busier hour (19:00–21:00, not 18:00–20:00, when orders sit at 7 PM).
    const score = count * 100_000 + hours[h];
    if (score > bestScore) { best = h; bestCount = count; bestScore = score; }
  }
  return { startHour: best, endHour: best + 2, share: Math.round((bestCount / createdAtMs.length) * 100) };
}

// ── Results ───────────────────────────────────────────────────────────

export type CampaignResult = { sent: number; opened: number; clicked: number; orders: number; revenue: number; audience: number };

/** Ranges from this business's own past campaigns; null until there are 3. */
export function estimateFromPast(past: CampaignResult[], audience: number, averageOrder: number) {
  const usable = past.filter((row) => row.sent >= 10);
  if (usable.length < 3) return null;
  const rates = (pick: (row: CampaignResult) => number) => {
    const values = usable.map((row) => pick(row) / row.sent).sort((a, b) => a - b);
    return { low: values[0], high: values[values.length - 1] };
  };
  const open = rates((row) => row.opened), click = rates((row) => row.clicked), conversion = rates((row) => row.orders);
  return {
    open, click, conversion,
    revenue: { low: Math.round(audience * conversion.low * averageOrder), high: Math.round(audience * conversion.high * averageOrder) }
  };
}

export type HealthGrade = "good" | "fair" | "poor";
export function emailHealth(sent: number, failed: number): { grade: HealthGrade; percent: number } | null {
  const total = sent + failed;
  if (!total) return null;
  const percent = Math.round((sent / total) * 1000) / 10;
  return { grade: percent >= 98 ? "good" : percent >= 95 ? "fair" : "poor", percent };
}

/** % change, or null when there is nothing to compare against. */
export const percentChange = (now: number, before: number) => (before > 0 ? Math.round(((now - before) / before) * 1000) / 10 : null);

// ── Links ─────────────────────────────────────────────────────────────

export function slugFor(name: string, random: string) {
  const base = name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "campaign";
  return `${base}-${random.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5)}`;
}

/** Adds utm_source=email etc. Links into the app's own form keep the tags inside the #/... part, where the form reads them. */
export function withUtm(url: string, tags: Record<string, string>) {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return url; }
  if (!/^https?:$/.test(parsed.protocol)) return url;
  const hash = parsed.hash;
  if (hash.startsWith("#/") && hash.includes("order-form")) {
    const [path, query = ""] = hash.slice(1).split("?");
    const params = new URLSearchParams(query);
    for (const [key, value] of Object.entries(tags)) if (value) params.set(key, value);
    parsed.hash = `${path}?${params.toString()}`;
    return parsed.toString();
  }
  for (const [key, value] of Object.entries(tags)) if (value) parsed.searchParams.set(key, value);
  return parsed.toString();
}

// ── Customer numbers for the Overview ─────────────────────────────────

export type CustomerKpis = {
  buyers: number; repeat: number; deliveredOrders: number; revenue: number;
  ltv: number; frequency: number; retention: number; active: number; aov: number; avgAgeMonths: number;
};

/** The customer numbers as they stood at `cutoffMs` (deliveries up to then). */
export function kpisAt(orders: OrderLite[], cutoffMs: number): CustomerKpis {
  const groups = new Map<string, { count: number; total: number; first: number; last: number }>();
  for (const order of orders) {
    if (order.status !== "Delivered") continue;
    const when = deliveredMs(order);
    if (!Number.isFinite(when) || when > cutoffMs) continue;
    const key = phoneKey(order.phone);
    if (!key) continue;
    const row = groups.get(key) ?? { count: 0, total: 0, first: when, last: when };
    row.count += 1;
    row.total += Number(order.amount) || 0;
    row.first = Math.min(row.first, when);
    row.last = Math.max(row.last, when);
    groups.set(key, row);
  }
  let repeat = 0, deliveredOrders = 0, revenue = 0, active = 0, ageDays = 0;
  for (const row of groups.values()) {
    if (row.count >= 2) repeat += 1;
    deliveredOrders += row.count;
    revenue += row.total;
    if (cutoffMs - row.last <= 90 * DAY_MS) active += 1;
    ageDays += (cutoffMs - row.first) / DAY_MS;
  }
  const buyersCount = groups.size;
  return {
    buyers: buyersCount, repeat, deliveredOrders, revenue,
    ltv: buyersCount ? revenue / buyersCount : 0,
    frequency: buyersCount ? deliveredOrders / buyersCount : 0,
    retention: buyersCount ? (repeat / buyersCount) * 100 : 0,
    active,
    aov: deliveredOrders ? revenue / deliveredOrders : 0,
    avgAgeMonths: buyersCount ? ageDays / buyersCount / 30.44 : 0
  };
}

/** Month ends (Lagos) for the last `count` months, oldest first; the current month ends now. */
export function monthEnds(nowMs: number, count: number): Array<{ key: string; label: string; endMs: number }> {
  const out: Array<{ key: string; label: string; endMs: number }> = [];
  const now = new Date(nowMs + LAGOS_OFFSET_MS);
  for (let i = count - 1; i >= 0; i -= 1) {
    const year = now.getUTCFullYear(), month = now.getUTCMonth() - i;
    const start = new Date(Date.UTC(year, month, 1));
    const nextStart = Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1) - LAGOS_OFFSET_MS;
    out.push({
      key: start.toISOString().slice(0, 7),
      label: start.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" }),
      endMs: i === 0 ? nowMs : nextStart - 1
    });
  }
  return out;
}

// ── Engagement, tiers, ready-made lists / tags / fields ───────────────

export type Engagement = "high" | "medium" | "low" | "none";

/** High: opened or clicked in 30 days. Medium: in 90 days. Low: emailed, no open in 90 days. */
export function engagementOf(contact: ContactLite | null, nowMs: number): Engagement {
  if (!contact) return "none";
  const last = Math.max(contact.lastOpenedMs ?? 0, contact.lastClickedMs ?? 0);
  if (last && nowMs - last <= 30 * DAY_MS) return "high";
  if (last && nowMs - last <= 90 * DAY_MS) return "medium";
  return contact.lastEmailedMs ? "low" : "none";
}

/** A list's engagement: the share of its emailed people who opened lately. */
export function groupEngagement(contacts: Array<ContactLite | null>, nowMs: number): Engagement {
  const levels = contacts.map((contact) => engagementOf(contact, nowMs)).filter((level) => level !== "none");
  if (!levels.length) return "none";
  const high = levels.filter((level) => level === "high").length / levels.length;
  const active = levels.filter((level) => level !== "low").length / levels.length;
  return high >= 0.4 ? "high" : active >= 0.15 ? "medium" : "low";
}

export function customerTier(stats: CustomerStats | null, ctx: MatchContext) {
  if (!stats?.deliveredCount) return "";
  if (stats.deliveredTotal / stats.deliveredCount >= 50000) return "VIP";
  if (stats.deliveredTotal >= ctx.topSpend(20)) return "High Value";
  return "Regular";
}

export const BUILT_IN_LISTS: BuiltInSegment[] = [
  { key: "list_customers", name: "Customers", description: "Everyone who gave an email on the order form or an unfinished order", icon: "users", match: "any", conditions: [{ field: "source", op: "is", value: "order" }, { field: "source", op: "is", value: "cart" }] },
  { key: "list_newsletter", name: "Newsletter", description: "People added by hand who asked for updates and offers", icon: "mail", match: "all", conditions: [{ field: "source", op: "is", value: "manual" }] }
];

export type BuiltInTag = { key: string; name: string; color: string; icon: string; description: string; match: "all" | "any"; conditions: Condition[] };
export const BUILT_IN_TAGS: BuiltInTag[] = [
  { key: "vip", name: "VIP", color: "amber", icon: "crown", description: "High-value customers (average order ₦50,000+).", match: "all", conditions: [{ field: "avg_order_value", op: "gte", value: 50000 }] },
  { key: "repeat", name: "Repeat Buyer", color: "blue", icon: "cart", description: "Customers with 2+ delivered orders.", match: "all", conditions: [{ field: "purchase_count", op: "gte", value: 2 }] },
  { key: "reviewer", name: "Reviewer", color: "purple", icon: "star", description: "Customers with an approved review.", match: "all", conditions: [{ field: "left_review", op: "is", value: "yes" }] },
  { key: "new", name: "New Customer", color: "green", icon: "sparkles", description: "First delivery in the last 30 days.", match: "all", conditions: [{ field: "first_purchase_days", op: "within", value: 30 }] },
  { key: "cart", name: "Cart Abandoner", color: "orange", icon: "cart", description: "Left a cart in the last 30 days without ordering.", match: "all", conditions: [{ field: "cart_abandoned", op: "within", value: 30 }] },
  { key: "inactive", name: "Inactive", color: "red", icon: "ban", description: "No delivery in 60+ days.", match: "all", conditions: [{ field: "last_purchase_days", op: "over", value: 60 }] }
];

export type FieldType = "text" | "number" | "date" | "dropdown" | "multi";
export type BuiltInField = { key: string; name: string; type: FieldType; icon: string; description: string; required: boolean; useInForms: boolean; options: string[] };
export const BUILT_IN_FIELDS: BuiltInField[] = [
  { key: "state", name: "State", type: "dropdown", icon: "pin", description: "Customer's state (e.g., Lagos, Abuja, Rivers).", required: true, useInForms: true, options: [] },
  { key: "product_interest", name: "Product Interest", type: "multi", icon: "box", description: "Products the customer ordered or put in a cart.", required: false, useInForms: true, options: [] },
  { key: "order_count", name: "Order Count", type: "number", icon: "tag", description: "Number of delivered orders.", required: false, useInForms: false, options: [] },
  { key: "aov", name: "AOV (₦)", type: "number", icon: "naira", description: "Average order value of delivered orders (₦).", required: false, useInForms: false, options: [] },
  { key: "source", name: "Customer Source", type: "dropdown", icon: "users", description: "Where the customer first came from (Facebook, Instagram, TikTok, ...).", required: false, useInForms: true, options: ["Facebook", "Instagram", "TikTok", "Website", "Audience Network", "Threads", "WhatsApp", "Direct"] },
  { key: "delivery_type", name: "Delivery Type", type: "dropdown", icon: "truck", description: "How they pay: on delivery (POD) or before delivery (PBD).", required: false, useInForms: true, options: ["POD", "PBD"] },
  { key: "tier", name: "Customer Tier", type: "dropdown", icon: "star", description: "Customer value group (Regular, VIP, High Value).", required: false, useInForms: true, options: ["Regular", "VIP", "High Value"] },
  { key: "last_purchase", name: "Last Purchase Date", type: "date", icon: "calendar", description: "Date of the customer's last delivered order.", required: false, useInForms: false, options: [] }
];

/** A built-in field's value for one person ("" = not known). */
export function systemFieldValue(key: string, person: Person, ctx: MatchContext, productName: (id: string) => string): string {
  const stats = person.stats;
  switch (key) {
    case "state": return stats?.state ?? "";
    case "product_interest": return stats ? [...stats.interestProducts].map(productName).filter(Boolean).join(", ") : "";
    case "order_count": return stats?.deliveredCount ? String(stats.deliveredCount) : "";
    case "aov": return stats?.deliveredCount ? String(Math.round(stats.deliveredTotal / stats.deliveredCount)) : "";
    case "source": return stats?.firstSource ?? "";
    case "delivery_type": return stats?.lastOrderMs ? (stats.upfrontPaid ? "PBD" : "POD") : "";
    case "tier": return customerTier(stats, ctx);
    case "last_purchase": return stats?.lastDeliveredMs ? lagosDay(stats.lastDeliveredMs) : "";
    default: return "";
  }
}

/** A field key from its name: "Delivery Type" → "delivery_type". */
export const fieldKeyFor = (name: string) => name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "field";

export type FieldDef = { key: string; type: string; options: string[]; systemKey: string | null };

/** Answers checked against each field's type; unknown and ready-made fields are dropped. */
export function cleanFieldValues(fields: FieldDef[], raw: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    if (field.systemKey || !(field.key in raw)) continue;
    const value = raw[field.key];
    if (value === null || value === undefined || value === "") { out[field.key] = ""; continue; }
    if (field.type === "number") { const n = Number(String(value).replace(/[,₦\s]/g, "")); if (Number.isFinite(n)) out[field.key] = String(n); }
    else if (field.type === "date") { const text = String(value).trim().slice(0, 10); if (/^\d{4}-\d{2}-\d{2}$/.test(text)) out[field.key] = text; }
    else if (field.type === "dropdown") { const text = String(value).trim(); const match = field.options.find((option) => option.toLowerCase() === text.toLowerCase()); if (match) out[field.key] = match; }
    else if (field.type === "multi") {
      const list = (Array.isArray(value) ? value : String(value).split(/[;,]/)).map((item) => String(item).trim()).filter(Boolean);
      out[field.key] = list.map((item) => field.options.find((option) => option.toLowerCase() === item.toLowerCase())).filter(Boolean);
    } else out[field.key] = String(value).trim().slice(0, 200);
  }
  return out;
}
