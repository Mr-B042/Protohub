// Monthly incentive tiers (Bright, 3 Oct 2026). Each product challenge's earned
// reward is paid in the first week after the month, cut by the person's
// delivery rate for the calendar month (Orders page formula: orders placed in
// the month that are delivered / orders placed in the month; a rep's own
// orders, the company for the manager):
//   70% and above -> full, 65 to under 70 -> half, 60 to under 65 -> quarter,
//   under 60 -> nothing.

export const INCENTIVE_TIERS = [
  { min: 70, percent: 100, label: "Full" },
  { min: 65, percent: 50, label: "Half" },
  { min: 60, percent: 25, label: "Quarter" }
] as const;

/**
 * Delivered / placed as a WHOLE percent, rounded exactly like the Manager
 * Dashboard's Team performance table (Bright, 3 Oct 2026): the manager
 * reviews from that table, so 123 of 190 (64.7%) is 65% on both screens and
 * pays half. Null when nothing was placed.
 */
export function monthlyDeliveryRate(placed: number, delivered: number): number | null {
  if (placed <= 0) return null;
  return Math.round((delivered / placed) * 100);
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
    pointsToNext: next && rate !== null ? next.min - rate : null
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

/**
 * The calendar month a challenge belongs to: the month its end date falls in
 * (Bright, 3 Oct 2026). Weekly months end on a Saturday on or before the last
 * day, so a September challenge (30 Aug – 26 Sept) gives 1 – 30 Sept. The
 * delivery rate is judged on this whole month; pieces stay on the challenge dates.
 */
export function calendarMonthOf(endDate: string) {
  const [year, month] = endDate.split("-").map(Number);
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const pad = (value: number) => String(value).padStart(2, "0");
  return { from: `${year}-${pad(month)}-01`, to: `${year}-${pad(month)}-${pad(last)}` };
}

/** "accruing" while the calendar month runs; "due" from the day after it ends (paid in that first week). */
export function incentiveWindow(endDate: string, today: string) {
  const monthEnd = calendarMonthOf(endDate).to;
  const dueFrom = addDays(monthEnd, 1);
  const dueBy = addDays(monthEnd, 7);
  return { dueFrom, dueBy, status: today < dueFrom ? "accruing" as const : today > dueBy ? "overdue" as const : "due" as const };
}

// ── Paid incentive → weekly expenses (Bright, 3 Oct 2026) ──
// When an incentive is marked paid it is booked as a "Bonuses & Incentives"
// expense, spread across the challenge's own weeks (4 for September:
// 30 Aug, 6, 13, 20 Sept) instead of landing in one week. One row per week,
// dated that week's Sunday (the challenge start + 7 days each), so every week's
// break-even carries its share. Equal shares to the kobo; the last week takes
// what is left so the rows always add up to the amount paid.
export const INCENTIVE_EXPENSE_CATEGORY = "Bonuses & Incentives";

export function challengeWeekStarts(startDate: string, endDate: string): string[] {
  const weeks: string[] = [];
  for (let day = startDate; day <= endDate; day = addDays(day, 7)) weeks.push(day);
  return weeks.length ? weeks : [startDate];
}

export function incentiveExpenseSplit(amount: number, weeks: number): number[] {
  const count = Math.max(1, weeks);
  const totalKobo = Math.round(Math.max(0, amount) * 100);
  const share = Math.floor(totalKobo / count);
  return Array.from({ length: count }, (_, index) => (index === count - 1 ? totalKobo - share * (count - 1) : share) / 100);
}

/** The expense ids for one payout, so undo can find and remove exactly them. */
export const incentiveExpenseIdPrefix = (payoutId: string) => `incentive-${payoutId}-w`;
