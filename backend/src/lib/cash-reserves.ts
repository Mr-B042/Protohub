// Restricted cash: money still in the account but already spoken for.
//
// ⚠️ A reserve is a LABEL, never a movement. Nothing here touches a bank
// balance, a cash flow total, or a reconciliation figure. The only number a
// reserve changes is Free Operating Cash - what is left once the promises are
// taken off the top.

export type ReserveCategory =
  | "payroll" | "tax" | "supplier" | "advertising" | "emergency" | "owner" | "other";

export const RESERVE_CATEGORIES: ReserveCategory[] = [
  "payroll", "tax", "supplier", "advertising", "emergency", "owner", "other"
];

export type ReserveInput = {
  id: string;
  name: string;
  category: ReserveCategory | string;
  amount: number;
  releasedAmount: number;
  status: "active" | "released" | "cancelled" | string;
  expectedReleaseDate: string | null;
  availableToUse: boolean;
};

const num = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

/** Still being held back. A part-released reserve only holds the remainder. */
export function outstandingOf(reserve: Pick<ReserveInput, "amount" | "releasedAmount" | "status">): number {
  if (reserve.status === "cancelled") return 0;
  return Math.max(num(reserve.amount) - num(reserve.releasedAmount), 0);
}

/** Whole days from `today` to `dateKey`. Negative once the date has passed. */
export function daysUntil(dateKey: string | null, today: string): number | null {
  if (!dateKey) return null;
  const target = new Date(`${dateKey}T00:00:00Z`).getTime();
  const now = new Date(`${today}T00:00:00Z`).getTime();
  if (!Number.isFinite(target) || !Number.isFinite(now)) return null;
  return Math.round((target - now) / 86_400_000);
}

export type ReserveDisplayStatus = "active" | "due_soon" | "overdue" | "released" | "cancelled";

/**
 * What the row badge says.
 *
 * ⚠️ Being past its release date does NOT release a reserve. The money is
 * still held back until someone actually releases it - an overdue reserve is a
 * prompt to act, not a silent unlock, and treating it as freed would quietly
 * inflate Free Operating Cash by money that is still committed.
 */
export function reserveDisplayStatus(reserve: ReserveInput, today: string): ReserveDisplayStatus {
  if (reserve.status === "cancelled") return "cancelled";
  if (outstandingOf(reserve) <= 0) return "released";
  const left = daysUntil(reserve.expectedReleaseDate, today);
  if (left === null) return "active";
  if (left < 0) return "overdue";
  if (left <= 7) return "due_soon";
  return "active";
}

export type ReserveSummary = {
  totalReserved: number;
  totalLiquidCash: number;
  /** Liquid cash minus everything still held back. CAN be negative. */
  freeOperatingCash: number;
  reservedPct: number;
  activeCount: number;
  /** True when more has been promised than the business actually holds. */
  overCommitted: boolean;
};

/**
 * The headline figures.
 *
 * ⚠️ Free Operating Cash is NOT clamped at zero. Reserving more than the
 * business holds is a real and important state - it means money has been
 * promised that does not exist - and flooring it at zero would hide exactly
 * the situation the page is meant to surface.
 */
export function summariseReserves(reserves: ReserveInput[], totalLiquidCash: number): ReserveSummary {
  const live = (reserves ?? []).filter((reserve) => reserve.status !== "cancelled");
  const totalReserved = live.reduce((sum, reserve) => sum + outstandingOf(reserve), 0);
  const liquid = num(totalLiquidCash);
  return {
    totalReserved,
    totalLiquidCash: liquid,
    freeOperatingCash: liquid - totalReserved,
    reservedPct: liquid > 0 ? Math.round((totalReserved / liquid) * 10000) / 100 : 0,
    activeCount: live.filter((reserve) => outstandingOf(reserve) > 0).length,
    overCommitted: totalReserved > liquid
  };
}

export type ReserveSlice = { id: string; label: string; amount: number; sharePct: number };

/** Donut slices, largest first. Fully-released reserves are left out. */
export function reserveBreakdown(reserves: ReserveInput[]): { slices: ReserveSlice[]; total: number } {
  const live = (reserves ?? [])
    .map((reserve) => ({ reserve, amount: outstandingOf(reserve) }))
    .filter((entry) => entry.amount > 0);
  const total = live.reduce((sum, entry) => sum + entry.amount, 0);
  const slices = live
    .map((entry) => ({
      id: entry.reserve.id,
      label: entry.reserve.name,
      amount: entry.amount,
      sharePct: total > 0 ? Math.round((entry.amount / total) * 10000) / 100 : 0
    }))
    .sort((left, right) => right.amount - left.amount);
  return { slices, total };
}

export type UpcomingRelease = {
  id: string; name: string; amount: number;
  releaseDate: string; daysLeft: number;
};

/**
 * Reserves due to be released within `withinDays`, soonest first.
 * Overdue ones are INCLUDED - they are the most urgent, not the least.
 */
export function upcomingReleases(
  reserves: ReserveInput[], today: string, withinDays = 30
): UpcomingRelease[] {
  return (reserves ?? [])
    .filter((reserve) => reserve.status !== "cancelled" && outstandingOf(reserve) > 0)
    .map((reserve) => ({ reserve, left: daysUntil(reserve.expectedReleaseDate, today) }))
    .filter((entry): entry is { reserve: ReserveInput; left: number } =>
      entry.left !== null && entry.left <= withinDays)
    .sort((left, right) => left.left - right.left)
    .map((entry) => ({
      id: entry.reserve.id,
      name: entry.reserve.name,
      amount: outstandingOf(entry.reserve),
      releaseDate: entry.reserve.expectedReleaseDate as string,
      daysLeft: entry.left
    }));
}

export type ReserveInsight = {
  kind: "healthy" | "warning" | "info" | "critical";
  title: string;
  detail: string;
};

/**
 * The plain-language read on the reserve position.
 *
 * Over-commitment is reported FIRST and as critical: every other observation
 * is secondary to having promised money that is not there.
 */
export function reserveInsights(
  reserves: ReserveInput[], summary: ReserveSummary, today: string
): ReserveInsight[] {
  const insights: ReserveInsight[] = [];
  const nairaish = (value: number) => `₦${Math.round(value).toLocaleString("en-NG")}`;

  if (summary.overCommitted) {
    insights.push({
      kind: "critical",
      title: "Reserved more than you hold",
      detail: `${nairaish(summary.totalReserved)} is reserved against ${nairaish(summary.totalLiquidCash)} of liquid cash. `
        + `${nairaish(Math.abs(summary.freeOperatingCash))} of it is not actually there.`
    });
  } else if (summary.reservedPct >= 70) {
    insights.push({
      kind: "warning",
      title: "Most of your cash is committed",
      detail: `${summary.reservedPct.toFixed(2)}% of liquid cash is reserved, leaving ${nairaish(summary.freeOperatingCash)} to operate on.`
    });
  } else {
    insights.push({
      kind: "healthy",
      title: "Healthy reserve level",
      detail: `${summary.reservedPct.toFixed(2)}% of your liquid cash is reserved.`
    });
  }

  const payroll = (reserves ?? []).filter((reserve) => reserve.category === "payroll");
  const payrollHeld = payroll.reduce((sum, reserve) => sum + outstandingOf(reserve), 0);
  if (payrollHeld > 0) {
    insights.push({ kind: "info", title: "Payroll covered", detail: `${nairaish(payrollHeld)} is set aside for salaries.` });
  } else {
    insights.push({ kind: "warning", title: "No payroll reserve", detail: "Salaries are not set aside. Payroll is the one bill that cannot slip." });
  }

  const soon = upcomingReleases(reserves, today, 7);
  if (soon.length > 0) {
    const total = soon.reduce((sum, entry) => sum + entry.amount, 0);
    const overdue = soon.filter((entry) => entry.daysLeft < 0);
    insights.push(overdue.length > 0
      ? {
        kind: "warning",
        title: "Release date passed",
        detail: `${overdue.length} reserve${overdue.length === 1 ? "" : "s"} worth ${nairaish(overdue.reduce((sum, entry) => sum + entry.amount, 0))} `
          + "are past their release date and still being held back."
      }
      : { kind: "info", title: "Upcoming release", detail: `${nairaish(total)} will be released within 7 days.` });
  }

  const emergency = (reserves ?? []).filter((reserve) => reserve.category === "emergency");
  const emergencyHeld = emergency.reduce((sum, reserve) => sum + outstandingOf(reserve), 0);
  if (summary.totalLiquidCash > 0 && emergencyHeld / summary.totalLiquidCash < 0.05) {
    insights.push({
      kind: "warning",
      title: "Emergency reserve low",
      detail: emergencyHeld > 0
        ? `Only ${nairaish(emergencyHeld)} is held for emergencies - under 5% of liquid cash.`
        : "Nothing is held for emergencies."
    });
  }

  return insights;
}

/**
 * Next reference code for a month, e.g. RES-2508-003.
 *
 * Derived from the codes already issued in that month rather than a count of
 * rows, so deleting a reserve cannot hand its number to a new one and make two
 * different reserves share a reference in the audit trail.
 */
export function nextReserveRef(existingCodes: string[], today: string): string {
  const prefix = `RES-${today.slice(2, 4)}${today.slice(5, 7)}`;
  const highest = (existingCodes ?? []).reduce((max, code) => {
    if (!code?.startsWith(`${prefix}-`)) return max;
    const parsed = Number(code.slice(prefix.length + 1));
    return Number.isFinite(parsed) && parsed > max ? parsed : max;
  }, 0);
  return `${prefix}-${String(highest + 1).padStart(3, "0")}`;
}
