/**
 * Weekly Report approvals - the figures (Bright, 1 Oct 2026).
 *
 * The rep never types a number. App.tsx hands this file the rep's orders for
 * the week and the bonus row from buildManagerBonusRepRows (the Manager
 * Dashboard's own bonus table), and this file only adds up. So the rep's
 * report, the manager's review and the bonus table cannot disagree.
 *
 * ⚠️ HOW THINGS ARE COUNTED (same as the rest of the app, on purpose)
 * - Orders = placed in the week (repeat-order holds left out).
 * - Delivered / delivery rate = of THOSE orders, how many are delivered now.
 *   That is the 25 of 44 = 56.8% in the design.
 * - Bonus = orders DELIVERED in the week, the bonus week every other bonus
 *   screen uses. An order placed last Saturday and delivered on Monday earns
 *   in this week's bonus but counts in last week's orders.
 *
 * When the rep submits, the snapshot below is frozen on the server. The
 * review pages build it again live and compareSnapshots() lists what moved.
 */

export const WEEKLY_REPORT_SNAPSHOT_VERSION = 1;

export type WeeklyOrderType = "Upsell" | "Cross-Sell" | "Upsell + Cross-Sell" | "Standard";

export type WeeklyReportOrderInput = {
  id: string;
  createdKey: string;
  deliveredKey: string | null;
  status: string;
  productKey: string;
  productName: string;
  packageName: string;
  customer: string;
  amount: number;
  hasUpsell: boolean;
  hasCrossSell: boolean;
  bonusManuallyAdjusted: boolean;
};

export type WeeklyReportBonusInput = {
  base: number;
  upsell: number;
  crossSell: number;
  total: number;
  /** orderId -> that order's bonus (base + upsell + cross-sell). */
  perOrder: Record<string, { base: number; upsell: number; crossSell: number }>;
};

export type WeeklyReportFine = { id: string; label: string; amount: number; date: string };

export type WeeklyReportProductRow = {
  key: string;
  name: string;
  orders: number;
  delivered: number;
  deliveryRate: number;
};

export type WeeklyReportDayRow = { date: string; orders: number; delivered: number; deliveryRate: number };

export type WeeklyReportOrderRow = {
  id: string;
  date: string;
  deliveredDate: string | null;
  customer: string;
  product: string;
  type: WeeklyOrderType;
  amount: number;
  status: string;
  placedThisWeek: boolean;
  bonus: number;
  /** The upsell and cross-sell parts of `bonus` (0 if none). */
  upsellBonus?: number;
  crossSellBonus?: number;
  bonusManuallyAdjusted: boolean;
};

export type WeeklyReportSnapshot = {
  version: number;
  repId: string;
  repName: string;
  weekStart: string;
  weekEnd: string;
  generatedAt: string;
  totals: {
    orders: number;
    delivered: number;
    deliveryRate: number;
    /** Orders delivered in the week - the ones the bonus is paid on. */
    deliveredForBonus: number;
    baseBonus: number;
    upsellBonus: number;
    crossSellBonus: number;
    fines: number;
    /** Bonus corrections from answered bonus queries, paid in this week. */
    adjustments?: number;
    finalBonus: number;
    upsellOrders: number;
    crossSellOrders: number;
    manuallyAdjustedOrders: number;
    /** Orders placed in an EARLIER week and delivered this week. Their bonus is
     *  already inside the figures above - this only says how much of it. */
    carryOverOrders?: number;
    carryOverBonus?: number;
  };
  previous: { orders: number; delivered: number; deliveryRate: number; finalBonus: number } | null;
  products: WeeklyReportProductRow[];
  daily: WeeklyReportDayRow[];
  expansion: {
    crossSell: { orders: number; delivered: number; deliveryRate: number; bonus: number };
    upsell: { orders: number; delivered: number; deliveryRate: number; bonus: number };
  };
  fines: WeeklyReportFine[];
  adjustments?: WeeklyReportFine[];
  orders: WeeklyReportOrderRow[];
  /** Every order the report covers. The server checks these for edits made after submit. */
  orderIds: string[];
};

const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0);

export const addDaysKey = (dateKey: string, days: number) => {
  const date = new Date(`${dateKey}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

/**
 * Reports are submitted on the TUESDAY after the week ends (Bright, 1 Oct
 * 2026): week Sun 20 - Sat 26 Sept opens and is due on Tue 29 Sept. Waiting
 * until Tuesday gives the weekend's orders time to be attended to, so they
 * count in the week they were placed. Orders delivered later still earn: their
 * bonus lands in the week they are delivered (carry-over).
 */
export const reportDueDate = (weekStart: string) => addDaysKey(weekStart, 9);
/** Submit opens on the due Tuesday itself. */
export const reportOpensOn = reportDueDate;
/** Submitted after the end of the due Tuesday (Lagos day). */
export const isLateSubmission = (weekStart: string, submittedIso: string | null | undefined) => {
  if (!submittedIso) return false;
  const lagosDay = new Date(new Date(submittedIso).getTime() + 60 * 60 * 1000).toISOString().slice(0, 10);
  return lagosDay > reportDueDate(weekStart);
};
/** When the rep FIRST submitted, from the audit trail (a resubmission after a return is not late). */
export const firstSubmittedAt = (
  audit: Array<{ action: string; repId?: string | null; createdAt: string; detail?: any }>,
  repId: string
) => audit
  .filter((entry) => entry.action === "rep_submitted" && entry.repId === repId)
  .map((entry) => entry.createdAt)
  .sort()[0] ?? null;

export const weekDays = (weekStart: string) => Array.from({ length: 7 }, (_, index) => addDaysKey(weekStart, index));

const inWeek = (key: string | null | undefined, weekStart: string, weekEnd: string) =>
  !!key && key >= weekStart && key <= weekEnd;

const orderType = (order: Pick<WeeklyReportOrderInput, "hasUpsell" | "hasCrossSell">): WeeklyOrderType =>
  order.hasUpsell && order.hasCrossSell
    ? "Upsell + Cross-Sell"
    : order.hasUpsell
      ? "Upsell"
      : order.hasCrossSell
        ? "Cross-Sell"
        : "Standard";

export function buildRepWeeklySnapshot(input: {
  repId: string;
  repName: string;
  weekStart: string;
  weekEnd: string;
  /** The rep's orders placed OR delivered in the week. Holds already removed from "placed". */
  orders: WeeklyReportOrderInput[];
  bonus: WeeklyReportBonusInput;
  fines: WeeklyReportFine[];
  /** Corrections paid in this week (answered bonus queries). Added on top. */
  adjustments?: WeeklyReportFine[];
  previous: WeeklyReportSnapshot["previous"];
  now?: Date;
}): WeeklyReportSnapshot {
  const { weekStart, weekEnd } = input;
  const placed = input.orders.filter((order) => inWeek(order.createdKey, weekStart, weekEnd));
  const placedDelivered = placed.filter((order) => order.status === "Delivered");
  const deliveredInWeek = input.orders.filter((order) => order.status === "Delivered" && inWeek(order.deliveredKey, weekStart, weekEnd));

  // Product breakdown, biggest first.
  const productMap = new Map<string, WeeklyReportProductRow>();
  for (const order of placed) {
    const row = productMap.get(order.productKey) ?? { key: order.productKey, name: order.productName || "Unknown product", orders: 0, delivered: 0, deliveryRate: 0 };
    row.orders += 1;
    if (order.status === "Delivered") row.delivered += 1;
    productMap.set(order.productKey, row);
  }
  const products = Array.from(productMap.values())
    .map((row) => ({ ...row, deliveryRate: pct(row.delivered, row.orders) }))
    .sort((a, b) => b.orders - a.orders || a.name.localeCompare(b.name));

  const daily = weekDays(weekStart).map((date) => {
    const dayOrders = placed.filter((order) => order.createdKey === date);
    const delivered = dayOrders.filter((order) => order.status === "Delivered").length;
    return { date, orders: dayOrders.length, delivered, deliveryRate: pct(delivered, dayOrders.length) };
  });

  const bonusFor = (orderId: string) => {
    const parts = input.bonus.perOrder[orderId];
    return parts ? parts.base + parts.upsell + parts.crossSell : 0;
  };

  const upsellPlaced = placed.filter((order) => order.hasUpsell);
  const crossPlaced = placed.filter((order) => order.hasCrossSell);
  const expansion = {
    crossSell: {
      orders: crossPlaced.length,
      delivered: crossPlaced.filter((order) => order.status === "Delivered").length,
      deliveryRate: pct(crossPlaced.filter((order) => order.status === "Delivered").length, crossPlaced.length),
      bonus: input.bonus.crossSell
    },
    upsell: {
      orders: upsellPlaced.length,
      delivered: upsellPlaced.filter((order) => order.status === "Delivered").length,
      deliveryRate: pct(upsellPlaced.filter((order) => order.status === "Delivered").length, upsellPlaced.length),
      bonus: input.bonus.upsell
    }
  };

  const seen = new Set<string>();
  const orders: WeeklyReportOrderRow[] = [];
  for (const order of [...placed, ...deliveredInWeek]) {
    if (seen.has(order.id)) continue;
    seen.add(order.id);
    const deliveredThisWeek = order.status === "Delivered" && inWeek(order.deliveredKey, weekStart, weekEnd);
    orders.push({
      id: order.id,
      date: order.createdKey,
      deliveredDate: order.deliveredKey,
      customer: order.customer,
      product: [order.productName, order.packageName].filter(Boolean).join(" – "),
      type: orderType(order),
      amount: Math.round(order.amount || 0),
      status: order.status,
      placedThisWeek: inWeek(order.createdKey, weekStart, weekEnd),
      bonus: deliveredThisWeek ? Math.round(bonusFor(order.id)) : 0,
      upsellBonus: deliveredThisWeek ? Math.round(input.bonus.perOrder[order.id]?.upsell ?? 0) : 0,
      crossSellBonus: deliveredThisWeek ? Math.round(input.bonus.perOrder[order.id]?.crossSell ?? 0) : 0,
      bonusManuallyAdjusted: order.bonusManuallyAdjusted
    });
  }
  orders.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));

  const fineTotal = input.fines.reduce((sum, fine) => sum + Math.max(0, fine.amount), 0);
  const baseBonus = Math.round(input.bonus.base);
  const upsellBonus = Math.round(input.bonus.upsell);
  const crossSellBonus = Math.round(input.bonus.crossSell);
  const earned = baseBonus + upsellBonus + crossSellBonus;
  const adjustments = input.adjustments ?? [];
  const adjustmentTotal = Math.round(adjustments.reduce((sum, item) => sum + Math.max(0, item.amount), 0));

  return {
    version: WEEKLY_REPORT_SNAPSHOT_VERSION,
    repId: input.repId,
    repName: input.repName,
    weekStart,
    weekEnd,
    generatedAt: (input.now ?? new Date()).toISOString(),
    totals: {
      orders: placed.length,
      delivered: placedDelivered.length,
      deliveryRate: pct(placedDelivered.length, placed.length),
      deliveredForBonus: deliveredInWeek.length,
      baseBonus,
      upsellBonus,
      crossSellBonus,
      fines: Math.round(fineTotal),
      adjustments: adjustmentTotal,
      finalBonus: Math.max(0, earned + adjustmentTotal - Math.round(fineTotal)),
      upsellOrders: upsellPlaced.length,
      crossSellOrders: crossPlaced.length,
      manuallyAdjustedOrders: orders.filter((order) => order.bonusManuallyAdjusted && order.bonus > 0).length,
      carryOverOrders: orders.filter((order) => !order.placedThisWeek && order.bonus > 0).length,
      carryOverBonus: orders.filter((order) => !order.placedThisWeek).reduce((sum, order) => sum + order.bonus, 0)
    },
    previous: input.previous,
    products,
    daily,
    expansion,
    fines: input.fines,
    adjustments,
    orders,
    orderIds: orders.map((order) => order.id)
  };
}

/** Totals the manager and owner need to see side by side. */
export const SNAPSHOT_CHECKS: Array<{ key: keyof WeeklyReportSnapshot["totals"]; label: string; money?: boolean; percent?: boolean }> = [
  { key: "orders", label: "Orders" },
  { key: "delivered", label: "Delivered" },
  { key: "deliveryRate", label: "Delivery rate", percent: true },
  { key: "crossSellOrders", label: "Cross-sell orders" },
  { key: "crossSellBonus", label: "Cross-sell bonus", money: true },
  { key: "upsellOrders", label: "Upsell orders" },
  { key: "upsellBonus", label: "Upsell bonus", money: true },
  { key: "baseBonus", label: "Base bonus", money: true },
  { key: "fines", label: "Fines / deductions", money: true },
  { key: "adjustments", label: "Bonus corrections", money: true },
  { key: "finalBonus", label: "Final bonus payable", money: true }
];

export type SnapshotDifference = { key: string; label: string; submitted: number; now: number; money?: boolean; percent?: boolean };

/** What moved between the frozen report and the figures worked out now. */
export function compareSnapshots(frozen: WeeklyReportSnapshot | null | undefined, live: WeeklyReportSnapshot | null | undefined): SnapshotDifference[] {
  if (!frozen?.totals || !live?.totals) return [];
  const differences: SnapshotDifference[] = [];
  for (const check of SNAPSHOT_CHECKS) {
    const submitted = Number(frozen.totals[check.key] ?? 0);
    const now = Number(live.totals[check.key] ?? 0);
    const tolerance = check.percent ? 0.05 : 0.5;
    if (Math.abs(submitted - now) > tolerance) {
      differences.push({ key: check.key, label: check.label, submitted, now, money: check.money, percent: check.percent });
    }
  }
  // Products: compare order counts per product.
  const frozenProducts = new Map((frozen.products ?? []).map((row) => [row.key, row]));
  const liveProducts = new Map((live.products ?? []).map((row) => [row.key, row]));
  const productKeys = new Set([...frozenProducts.keys(), ...liveProducts.keys()]);
  for (const key of productKeys) {
    const before = frozenProducts.get(key);
    const after = liveProducts.get(key);
    if ((before?.orders ?? 0) !== (after?.orders ?? 0) || (before?.delivered ?? 0) !== (after?.delivered ?? 0)) {
      differences.push({
        key: `product:${key}`,
        label: `${after?.name ?? before?.name ?? "Product"} delivered`,
        submitted: before?.delivered ?? 0,
        now: after?.delivered ?? 0
      });
    }
  }
  return differences;
}

export const REP_STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  submitted: "Submitted",
  returned: "Returned",
  manager_approved: "Manager Approved",
  owner_approved: "Owner Approved",
  locked: "Locked"
};

export const COMPANY_STATUS_LABEL: Record<string, string> = {
  open: "Manager Review",
  submitted_to_owner: "Pending Approval",
  returned_to_manager: "Returned to Manager",
  locked: "Approved & Locked"
};

export const CORRECTION_SECTION_LABEL: Record<string, string> = {
  orders: "Orders",
  delivery: "Delivery",
  product_breakdown: "Product Breakdown",
  upsell_cross_sell: "Upsell / Cross-sell",
  bonus: "Bonus",
  other: "Other"
};

/** Common problems per section, so a return is never vague. "Other" lets them type. */
export const CORRECTION_PROBLEMS: Record<string, string[]> = {
  orders: ["Order missing from the report", "Order should not be counted", "Order assigned to the wrong rep"],
  delivery: ["Delivery not confirmed", "Delivered date is wrong", "Status needs updating"],
  product_breakdown: ["Product recorded wrongly", "Package or quantity is wrong"],
  upsell_cross_sell: ["Cross-sell needs verification", "Upsell needs verification", "Add-on not actually sold by the rep"],
  bonus: ["Bonus amount looks wrong", "Manual bonus change needs a reason", "Fine missing or wrong"],
  other: []
};

export const AUDIT_ACTION_LABEL: Record<string, string> = {
  rep_submitted: "Submitted to manager",
  rep_resubmitted: "Corrected and resubmitted",
  manager_approved: "Approved by manager",
  manager_returned: "Returned for correction",
  rep_flagged: "Issue flagged for the owner",
  company_submitted: "Submitted to owner",
  company_resubmitted: "Resubmitted to owner",
  owner_approved_locked: "Approved & locked by owner",
  owner_returned: "Returned to manager",
  owner_reopened: "Week reopened by owner",
  bonus_check_accurate: "Checked bonus: accurate",
  bonus_query_opened: "Bonus query sent to manager",
  bonus_query_resolved: "Bonus query answered"
};

// ── Company week ────────────────────────────────────────────────────────────

export type ManagerBonusPreview = {
  performanceBonus: number;
  performanceNote: string;
  supportBonus: number;
  supportNote: string;
  total: number;
  deliveryRate: number;
};

export type CompanyWeeklySnapshot = {
  version: number;
  weekStart: string;
  weekEnd: string;
  generatedAt: string;
  totals: {
    orders: number;
    delivered: number;
    deliveryRate: number;
    baseBonus: number;
    upsellBonus: number;
    crossSellBonus: number;
    fines: number;
    totalBonus: number;
    reps: number;
  };
  previous: { orders: number; delivered: number; deliveryRate: number; totalBonus: number } | null;
  products: WeeklyReportProductRow[];
  daily: WeeklyReportDayRow[];
  reps: Array<{ repId: string; repName: string; orders: number; delivered: number; deliveryRate: number; crossSellBonus: number; upsellBonus: number; baseBonus: number; fines: number; finalBonus: number }>;
};

/** Adds up rep snapshots into the company week. */
export function buildCompanySnapshot(weekStart: string, weekEnd: string, reps: WeeklyReportSnapshot[], now = new Date()): CompanyWeeklySnapshot {
  const sum = (pick: (snap: WeeklyReportSnapshot) => number) => reps.reduce((total, snap) => total + (pick(snap) || 0), 0);
  const orders = sum((snap) => snap.totals.orders);
  const delivered = sum((snap) => snap.totals.delivered);
  const productMap = new Map<string, WeeklyReportProductRow>();
  for (const snap of reps) {
    for (const row of snap.products) {
      const current = productMap.get(row.key) ?? { ...row, orders: 0, delivered: 0, deliveryRate: 0 };
      current.orders += row.orders;
      current.delivered += row.delivered;
      productMap.set(row.key, current);
    }
  }
  const daily = weekDays(weekStart).map((date) => {
    const dayOrders = reps.reduce((total, snap) => total + (snap.daily.find((day) => day.date === date)?.orders ?? 0), 0);
    const dayDelivered = reps.reduce((total, snap) => total + (snap.daily.find((day) => day.date === date)?.delivered ?? 0), 0);
    return { date, orders: dayOrders, delivered: dayDelivered, deliveryRate: pct(dayDelivered, dayOrders) };
  });
  const withPrevious = reps.filter((snap) => snap.previous);
  const previousOrders = withPrevious.reduce((total, snap) => total + (snap.previous?.orders ?? 0), 0);
  const previousDelivered = withPrevious.reduce((total, snap) => total + (snap.previous?.delivered ?? 0), 0);
  return {
    version: WEEKLY_REPORT_SNAPSHOT_VERSION,
    weekStart,
    weekEnd,
    generatedAt: now.toISOString(),
    totals: {
      orders,
      delivered,
      deliveryRate: pct(delivered, orders),
      baseBonus: sum((snap) => snap.totals.baseBonus),
      upsellBonus: sum((snap) => snap.totals.upsellBonus),
      crossSellBonus: sum((snap) => snap.totals.crossSellBonus),
      fines: sum((snap) => snap.totals.fines),
      totalBonus: sum((snap) => snap.totals.finalBonus),
      reps: reps.length
    },
    previous: withPrevious.length > 0 ? {
      orders: previousOrders,
      delivered: previousDelivered,
      deliveryRate: pct(previousDelivered, previousOrders),
      totalBonus: withPrevious.reduce((total, snap) => total + (snap.previous?.finalBonus ?? 0), 0)
    } : null,
    products: Array.from(productMap.values())
      .map((row) => ({ ...row, deliveryRate: pct(row.delivered, row.orders) }))
      .sort((a, b) => b.orders - a.orders || a.name.localeCompare(b.name)),
    daily,
    reps: reps.map((snap) => ({
      repId: snap.repId,
      repName: snap.repName,
      orders: snap.totals.orders,
      delivered: snap.totals.delivered,
      deliveryRate: snap.totals.deliveryRate,
      crossSellBonus: snap.totals.crossSellBonus,
      upsellBonus: snap.totals.upsellBonus,
      baseBonus: snap.totals.baseBonus,
      fines: snap.totals.fines,
      finalBonus: snap.totals.finalBonus
    }))
  };
}

// ── Check My Bonus (Bright, 1 Oct 2026) ─────────────────────────────────────
// A rep who feels underpaid asks the system first. Anything it finds goes to
// the manager; if it finds nothing, the rep sees why and can still send it
// with a reason. "issue" = something a manager must look at; "info" = an
// explanation (carried over, not delivered yet, fines); "ok" = checked fine.

export type BonusCheckFinding = { level: "issue" | "info" | "ok"; text: string; orderId?: string };

/** What the app knows about an order the rep named. */
export type NamedOrderLookup = {
  ref: string;
  found: boolean;
  /** Assigned to this rep. */
  mine: boolean;
  status: string;
  createdKey: string | null;
  deliveredKey: string | null;
};

const naira = (value: number) => `\u20a6${Math.round(value).toLocaleString("en-NG")}`;
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sept", "Oct", "Nov", "Dec"];
/** "2026-09-20" -> "20 Sept" (the year is obvious from the week). */
const dayLabel = (key: string | null | undefined) => {
  if (!key) return "";
  const [, month, day] = key.split("-").map(Number);
  return `${day} ${MONTH_NAMES[(month || 1) - 1]}`;
};

export function runBonusCheck(input: {
  weekStart: string;
  weekEnd: string;
  live: WeeklyReportSnapshot;
  /** What the rep submitted, if they have. */
  frozen: WeeklyReportSnapshot | null;
  named: NamedOrderLookup[];
}): { verdict: "accurate" | "issues"; findings: BonusCheckFinding[] } {
  const { weekStart, weekEnd, live, frozen } = input;
  const findings: BonusCheckFinding[] = [];
  const inWeek = (key: string | null) => !!key && key >= weekStart && key <= weekEnd;
  const deliveredHere = live.orders.filter((order) => order.status === "Delivered" && inWeek(order.deliveredDate));

  // 1. Every delivered order earns something.
  const unpaid = deliveredHere.filter((order) => order.bonus <= 0);
  for (const order of unpaid) {
    findings.push({ level: "issue", orderId: order.id, text: `Order #${order.id} was delivered on ${dayLabel(order.deliveredDate)} but shows no bonus.` });
  }
  if (deliveredHere.length > 0 && unpaid.length === 0) {
    findings.push({ level: "ok", text: `All ${deliveredHere.length} orders delivered this week have a bonus.` });
  }

  // 2. Upsells and add-ons earned their part.
  const upsells = deliveredHere.filter((order) => order.type === "Upsell" || order.type === "Upsell + Cross-Sell");
  const crossSells = deliveredHere.filter((order) => order.type === "Cross-Sell" || order.type === "Upsell + Cross-Sell");
  const upsellUnpaid = upsells.filter((order) => (order.upsellBonus ?? 0) <= 0);
  const crossUnpaid = crossSells.filter((order) => (order.crossSellBonus ?? 0) <= 0);
  for (const order of upsellUnpaid) findings.push({ level: "issue", orderId: order.id, text: `The upsell on order #${order.id} earned no upsell bonus.` });
  for (const order of crossUnpaid) findings.push({ level: "issue", orderId: order.id, text: `The add-on on order #${order.id} earned no cross-sell bonus.` });
  if (upsells.length > 0 && upsellUnpaid.length === 0) findings.push({ level: "ok", text: `All ${upsells.length} upsells were paid (${naira(live.totals.upsellBonus)}).` });
  if (crossSells.length > 0 && crossUnpaid.length === 0) findings.push({ level: "ok", text: `All ${crossSells.length} cross-sells were paid (${naira(live.totals.crossSellBonus)}).` });

  // 3. Bonuses set by hand need a manager's eye.
  for (const order of deliveredHere.filter((item) => item.bonusManuallyAdjusted)) {
    findings.push({ level: "issue", orderId: order.id, text: `The bonus on order #${order.id} was set by hand (${naira(order.bonus)}). Your manager should confirm it.` });
  }

  // 4. Has the bonus moved since the rep submitted?
  if (frozen?.totals) {
    if (live.totals.finalBonus > frozen.totals.finalBonus + 0.5) {
      findings.push({ level: "issue", text: `Your bonus is now ${naira(live.totals.finalBonus)}, but the report you submitted says ${naira(frozen.totals.finalBonus)}.` });
    } else if (live.totals.finalBonus < frozen.totals.finalBonus - 0.5) {
      findings.push({ level: "info", text: `Your bonus went down from ${naira(frozen.totals.finalBonus)} to ${naira(live.totals.finalBonus)} since you submitted, because an order changed.` });
    } else {
      findings.push({ level: "ok", text: `Your bonus matches the report you submitted (${naira(frozen.totals.finalBonus)}).` });
    }
  }

  // 5. Explain what lowered it.
  for (const fine of live.fines ?? []) findings.push({ level: "info", text: `A fine of ${naira(fine.amount)} was taken: ${fine.label}.` });
  if ((live.totals.carryOverOrders ?? 0) > 0) {
    findings.push({ level: "info", text: `${live.totals.carryOverOrders} order(s) placed in an earlier week were delivered this week and paid here (${naira(live.totals.carryOverBonus ?? 0)}).` });
  }

  // 6. The orders the rep named.
  for (const named of input.named) {
    const ref = named.ref;
    if (!named.found || !named.mine) {
      findings.push({ level: "issue", orderId: ref, text: `Order #${ref} is not on your list. It may be assigned to another rep.` });
      continue;
    }
    if (named.status !== "Delivered") {
      findings.push({ level: "info", orderId: ref, text: `Order #${ref} is "${named.status}", not delivered yet. Its bonus is paid in the week it is delivered.` });
      continue;
    }
    if (!inWeek(named.deliveredKey)) {
      findings.push({ level: "info", orderId: ref, text: `Order #${ref} was delivered on ${dayLabel(named.deliveredKey)}, so its bonus is paid in that week's report, not this one.` });
      continue;
    }
    const row = live.orders.find((order) => order.id === ref);
    if (!row || row.bonus <= 0) {
      if (!unpaid.some((order) => order.id === ref)) findings.push({ level: "issue", orderId: ref, text: `Order #${ref} was delivered this week but shows no bonus.` });
    } else {
      findings.push({ level: "ok", orderId: ref, text: `Order #${ref} was delivered on ${dayLabel(row.deliveredDate)} and paid ${naira(row.bonus)}.` });
    }
  }

  return { verdict: findings.some((finding) => finding.level === "issue") ? "issues" : "accurate", findings };
}
