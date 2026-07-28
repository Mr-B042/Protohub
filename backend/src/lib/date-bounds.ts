import { lagosDateKey } from "./sales-bonus-engine.js";

// Shared "any date range, falling back to current month" bounds resolver.
// Originally written inline in recovery-rep-kpi.ts for the Recovery Rep
// Overview tab's date filter; extracted here so customer-retention.ts's
// dashboard-summary/bonus-summary endpoints can use the exact same
// dateFrom/dateTo contract instead of their own bespoke string interpolation.
export interface DateBounds {
  rangeKey: string;
  start: string;
  exclusiveEnd: string;
}

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const monthBounds = (month: string | undefined): DateBounds => {
  const key = /^\d{4}-\d{2}$/.test(month ?? "") ? (month as string) : lagosDateKey().slice(0, 7);
  const start = `${key}-01`;
  const startDate = new Date(`${start}T00:00:00Z`);
  const nextMonth = new Date(startDate);
  nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
  const exclusiveEnd = nextMonth.toISOString().slice(0, 10);
  return { rangeKey: key, start, exclusiveEnd };
};

// dateFrom/dateTo take precedence when both are present and valid; falls
// back to the month-based bounds otherwise (defaulting to the current
// month), so any caller that only ever passed `month` keeps working.
export const resolveDateBounds = (query: Record<string, unknown>): DateBounds => {
  const dateFrom = typeof query.dateFrom === "string" && DATE_KEY_PATTERN.test(query.dateFrom) ? query.dateFrom : null;
  const dateTo = typeof query.dateTo === "string" && DATE_KEY_PATTERN.test(query.dateTo) ? query.dateTo : null;
  if (dateFrom && dateTo && dateFrom <= dateTo) {
    const exclusiveEndDate = new Date(`${dateTo}T00:00:00Z`);
    exclusiveEndDate.setUTCDate(exclusiveEndDate.getUTCDate() + 1);
    return { rangeKey: `${dateFrom}..${dateTo}`, start: dateFrom, exclusiveEnd: exclusiveEndDate.toISOString().slice(0, 10) };
  }
  return monthBounds(typeof query.month === "string" ? query.month : undefined);
};
