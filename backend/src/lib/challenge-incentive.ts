// Monthly incentive tiers (Bright, 3 Oct 2026). Each product challenge's earned
// reward is paid in the first week after the month, cut by the person's
// delivery rate for the month (Manager Dashboard formula: delivered in the
// month / placed in the month; a rep's own orders, the company for the manager):
//   70% and above -> full, 65 to under 70 -> half, 60 to under 65 -> quarter,
//   under 60 -> nothing.

export const INCENTIVE_TIERS = [
  { min: 70, percent: 100, label: "Full" },
  { min: 65, percent: 50, label: "Half" },
  { min: 60, percent: 25, label: "Quarter" }
] as const;

/** Delivered in the month / placed in the month, one decimal. Null when nothing was placed. */
export function monthlyDeliveryRate(placed: number, delivered: number): number | null {
  if (placed <= 0) return null;
  return Math.round((delivered / placed) * 1000) / 10;
}

export function incentiveTier(rate: number | null) {
  const tier = rate === null ? null : INCENTIVE_TIERS.find((item) => rate >= item.min) ?? null;
  // The next tier up and how far away it is, for "you need X% more".
  const higher = INCENTIVE_TIERS.filter((item) => rate === null || rate < item.min);
  const next = higher.length ? higher[higher.length - 1] : null;
  return {
    percent: tier?.percent ?? 0,
    label: tier?.label ?? "None",
    minRate: tier?.min ?? null,
    nextPercent: next?.percent ?? null,
    nextMinRate: next?.min ?? null,
    pointsToNext: next && rate !== null ? Math.round((next.min - rate) * 10) / 10 : null
  };
}

export function payableAmount(earned: number, tierPercent: number) {
  return Math.round(Math.max(0, earned) * tierPercent) / 100;
}

const addDays = (key: string, days: number) => {
  const date = new Date(`${key}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

/** "accruing" while the month runs; "due" from the day after it ends (paid in that first week). */
export function incentiveWindow(endDate: string, today: string) {
  const dueFrom = addDays(endDate, 1);
  const dueBy = addDays(endDate, 7);
  return { dueFrom, dueBy, status: today < dueFrom ? "accruing" as const : today > dueBy ? "overdue" as const : "due" as const };
}
