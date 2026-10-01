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
    finalBonus: number;
    upsellOrders: number;
    crossSellOrders: number;
    manuallyAdjustedOrders: number;
  };
  previous: { orders: number; delivered: number; deliveryRate: number; finalBonus: number } | null;
  products: WeeklyReportProductRow[];
  daily: WeeklyReportDayRow[];
  expansion: {
    crossSell: { orders: number; delivered: number; deliveryRate: number; bonus: number };
    upsell: { orders: number; delivered: number; deliveryRate: number; bonus: number };
  };
  fines: WeeklyReportFine[];
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
      bonusManuallyAdjusted: order.bonusManuallyAdjusted
    });
  }
  orders.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));

  const fineTotal = input.fines.reduce((sum, fine) => sum + Math.max(0, fine.amount), 0);
  const baseBonus = Math.round(input.bonus.base);
  const upsellBonus = Math.round(input.bonus.upsell);
  const crossSellBonus = Math.round(input.bonus.crossSell);
  const earned = baseBonus + upsellBonus + crossSellBonus;

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
      finalBonus: Math.max(0, earned - Math.round(fineTotal)),
      upsellOrders: upsellPlaced.length,
      crossSellOrders: crossPlaced.length,
      manuallyAdjustedOrders: orders.filter((order) => order.bonusManuallyAdjusted && order.bonus > 0).length
    },
    previous: input.previous,
    products,
    daily,
    expansion,
    fines: input.fines,
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
  owner_reopened: "Week reopened by owner"
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
