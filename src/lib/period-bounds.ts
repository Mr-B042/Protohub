/**
 * The period filter every dashboard in this app shares.
 *
 * ⚠️ ONE IMPLEMENTATION, ON PURPOSE. The pill row lived as inline JSX inside
 * App.tsx with its bounds maths beside it, so a page rendered anywhere else had
 * to copy both. Two copies of "what does This Month mean" is how one screen
 * ends up disagreeing with another about the same day - and this app already
 * keeps a Sunday-anchored week that a naive copy would get wrong.
 *
 * Lifted out of App.tsx verbatim; App still calls it, so both surfaces answer
 * from the same function rather than two that merely look alike.
 */

export type Period =
  | "Today" | "Yesterday" | "This Week" | "Last Week"
  | "This Month" | "Last Month" | "This Year" | "Custom";

export type DateRange = { start: string; end: string };

/** The pills, in the order they are shown. "Custom" is the date picker. */
export const PERIODS: Period[] = [
  "Today", "Yesterday", "This Week", "Last Week", "This Month", "Last Month", "This Year"
];

export const formatDateKey = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

/**
 * The inclusive day range a period covers.
 *
 * Returns null only for a Custom period with no range chosen yet - the caller
 * decides whether that means "everything" or "nothing", because those are
 * different answers on a report than on a work queue.
 */
export function periodBounds(
  activePeriod: Period,
  range: DateRange
): { dateFrom: string; dateTo: string } | null {
  const now = new Date();
  const today = formatDateKey(now);
  // Sunday-anchored, matching every other week in this app.
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - now.getDay());

  if (activePeriod === "Custom") {
    return range.start && range.end ? { dateFrom: range.start, dateTo: range.end } : null;
  }

  if (activePeriod === "Today") {
    return { dateFrom: today, dateTo: today };
  }

  if (activePeriod === "Yesterday") {
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    const key = formatDateKey(yesterday);
    return { dateFrom: key, dateTo: key };
  }

  if (activePeriod === "This Week") {
    return { dateFrom: formatDateKey(weekStart), dateTo: today };
  }

  if (activePeriod === "Last Week") {
    const lastWeekStart = new Date(weekStart);
    lastWeekStart.setDate(weekStart.getDate() - 7);
    const lastWeekEnd = new Date(weekStart);
    lastWeekEnd.setDate(weekStart.getDate() - 1);
    return { dateFrom: formatDateKey(lastWeekStart), dateTo: formatDateKey(lastWeekEnd) };
  }

  if (activePeriod === "This Month") {
    return { dateFrom: `${today.slice(0, 7)}-01`, dateTo: today };
  }

  if (activePeriod === "Last Month") {
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastDay = new Date(now.getFullYear(), now.getMonth(), 0);
    return { dateFrom: formatDateKey(lastMonth), dateTo: formatDateKey(lastDay) };
  }

  return { dateFrom: `${today.slice(0, 4)}-01-01`, dateTo: today };
}

/** Short label for the chosen window, e.g. "Sep 1, 2026 - Sep 30, 2026". */
export function periodRangeLabel(activePeriod: Period, range: DateRange): string {
  const bounds = periodBounds(activePeriod, range);
  if (!bounds) return "Pick a date range";
  const pretty = (key: string) =>
    new Date(`${key}T12:00:00`).toLocaleDateString("en-NG", { month: "short", day: "numeric", year: "numeric" });
  return bounds.dateFrom === bounds.dateTo
    ? pretty(bounds.dateFrom)
    : `${pretty(bounds.dateFrom)} - ${pretty(bounds.dateTo)}`;
}
