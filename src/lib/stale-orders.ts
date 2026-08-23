// Orders that have sat too long without being delivered or rescheduled.
//
// An order placed more than a week ago that nobody has delivered, and nobody
// has given a new date, is not "in progress" - it is stuck. Bright's rule:
// make it impossible to miss on screen, and push the rep to mark it Failed
// Delivery so the recovery rep can take it over. A stuck order quietly ageing
// in the pipeline helps nobody; a failed one at least reaches someone whose
// job is to win it back.

/** Days an order may sit before it is considered stuck. */
export const STALE_ORDER_DAYS = 7;
/** Past this it stops being late and starts being abandoned. */
export const CRITICAL_ORDER_DAYS = 14;

export type StaleTier = "none" | "due" | "overdue" | "critical";

export type StaleOrderInput = {
  status: string;
  createdAt: string | null | undefined;
  /** A promised delivery slot, if one was given. */
  scheduledAt?: string | null;
  deliveredDate?: string | null;
};

export type StaleVerdict = {
  tier: StaleTier;
  ageDays: number;
  /** Days past the 7-day line. 0 unless actually stale. */
  daysOverdue: number;
  /** True when a future promise is holding it - handled, not stuck. */
  heldByPromise: boolean;
  reason: string;
};

const TERMINAL = new Set(["Delivered", "Cancelled", "Failed"]);

const daysBetween = (fromIso: string, nowMs: number): number | null => {
  const then = new Date(fromIso).getTime();
  if (!Number.isFinite(then)) return null;
  return Math.floor((nowMs - then) / 86_400_000);
};

/**
 * Is this order stuck, and how badly?
 *
 * ⚠️ A FUTURE scheduled date suppresses the warning entirely. Someone has
 * given the customer a day and the order is being worked - pulsing at a rep
 * who already did the right thing trains them to ignore the signal, which is
 * how a warning that matters becomes wallpaper.
 *
 * ⚠️ A PAST scheduled date does NOT suppress it. A promise that has come and
 * gone is worse than no promise: the customer was told a day and it slipped.
 */
export function staleOrderVerdict(order: StaleOrderInput, now: number = Date.now()): StaleVerdict {
  const idle: StaleVerdict = {
    tier: "none", ageDays: 0, daysOverdue: 0, heldByPromise: false, reason: ""
  };

  if (TERMINAL.has(String(order.status ?? ""))) return idle;
  if (!order.createdAt) return idle;

  const ageDays = daysBetween(order.createdAt, now);
  if (ageDays === null) return idle;

  const scheduled = order.scheduledAt ? new Date(order.scheduledAt).getTime() : null;
  const heldByPromise = scheduled !== null && Number.isFinite(scheduled) && scheduled > now;
  if (heldByPromise) {
    return { ...idle, ageDays, heldByPromise: true, reason: "A delivery date is promised and still ahead." };
  }

  if (ageDays <= STALE_ORDER_DAYS) return { ...idle, ageDays };

  const daysOverdue = ageDays - STALE_ORDER_DAYS;
  const missedPromise = scheduled !== null && Number.isFinite(scheduled) && scheduled <= now;
  const tier: StaleTier = ageDays >= CRITICAL_ORDER_DAYS ? "critical" : "overdue";

  return {
    tier,
    ageDays,
    daysOverdue,
    heldByPromise: false,
    reason: missedPromise
      ? `Promised date passed and it is ${ageDays} days old. Mark it Failed Delivery so recovery can take it.`
      : `${ageDays} days old with no delivery and no new date. Mark it Failed Delivery so recovery can take it.`
  };
}

export function isStaleOrder(order: StaleOrderInput, now: number = Date.now()): boolean {
  const tier = staleOrderVerdict(order, now).tier;
  return tier === "overdue" || tier === "critical";
}

export type StaleSummary = {
  total: number;
  overdue: number;
  critical: number;
  oldestDays: number;
};

/**
 * The header count.
 *
 * Counts ORDERS, not days, and reports the worst age separately - "12 orders,
 * oldest 23 days" says more in one line than an average ever could.
 */
export function summariseStaleOrders(
  orders: StaleOrderInput[], now: number = Date.now()
): StaleSummary {
  const verdicts = (orders ?? [])
    .map((order) => staleOrderVerdict(order, now))
    .filter((verdict) => verdict.tier === "overdue" || verdict.tier === "critical");
  return {
    total: verdicts.length,
    overdue: verdicts.filter((verdict) => verdict.tier === "overdue").length,
    critical: verdicts.filter((verdict) => verdict.tier === "critical").length,
    oldestDays: verdicts.reduce((worst, verdict) => Math.max(worst, verdict.ageDays), 0)
  };
}

export const STALE_TIER_STYLE: Record<Exclude<StaleTier, "none">, {
  dot: string; chip: string; label: string;
}> = {
  due: {
    dot: "bg-amber-400",
    chip: "bg-amber-50 text-amber-800 border-amber-200",
    label: "Due"
  },
  overdue: {
    dot: "bg-amber-500",
    chip: "bg-amber-50 text-amber-800 border-amber-300",
    label: "Stuck"
  },
  critical: {
    dot: "bg-rose-500",
    chip: "bg-rose-50 text-rose-800 border-rose-300",
    label: "Abandoned"
  }
};
