import { supabase } from "./supabase.js";
import { logger } from "./logger.js";

// ── Salary → weekly-spread, daily-drip expense ─────────────────────────────
// Salary is a MONTHLY cost but the business closes out profit WEEKLY (same
// cadence Ad Spend is entered at) — a single end-of-month lump meant salary
// never showed up in a given week's break-even/net-profit view except the one
// week it happened to land in. The company's total monthly salary (sum of
// every active user's fixed_salary) is split into 4 equal weekly slices, and
// each week's slice is further smoothed across its 4 WORKING days — Monday
// through Thursday — a quarter of the week's amount per day. Friday,
// Saturday, and the week's own Sunday anchor carry none.
//
// Crucially, days are NOT all written at once when a week is "spread" — that
// would just future-date rows and still read as a shock. Monday's entry is
// only ever created by an explicit "Spread Week N" click (the manual on/off
// switch), which also catches up any already-elapsed days in that week. Once
// Monday exists, the daily cron (dropDueDailySalaryForAllOrgs) takes over and
// creates Tuesday/Wednesday/Thursday's entries automatically — one per day,
// on that day, and only if the day before it already exists (proof the week
// was actually activated).

export const salaryMonthKey = (input?: unknown): string => {
  if (typeof input === "string" && /^\d{4}-\d{2}$/.test(input)) return input;
  return new Date(Date.now() + 60 * 60 * 1000).toISOString().slice(0, 7); // Lagos (UTC+1) month
};
export const salaryMonthLabel = (monthKey: string): string =>
  new Date(`${monthKey}-01T12:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
export const lagosTodayKey = (): string => new Date(Date.now() + 60 * 60 * 1000).toISOString().slice(0, 10);

export const salariedFixed = (structure: { type?: string | null; fixed_salary?: number | null } | null | undefined): number =>
  structure && structure.type !== "Per Delivered Order" ? Number(structure.fixed_salary ?? 0) : 0;

export async function totalMonthlySalary(orgId: string): Promise<number> {
  const [{ data: users }, { data: structures }] = await Promise.all([
    supabase.from("users").select("id").eq("org_id", orgId).eq("active", true),
    supabase.from("pay_structures").select("user_id, type, fixed_salary").eq("org_id", orgId)
  ]);
  const activeIds = new Set((users ?? []).map((u: any) => u.id as string));
  return (structures ?? [])
    .filter((s: any) => activeIds.has(s.user_id))
    .reduce((sum: number, s: any) => sum + salariedFixed(s), 0);
}

// 4 consecutive Sunday-anchored weeks covering "the month" — week 1 starts on
// the Sunday on/before the 1st, so dating an expense there lands inside the
// same Sun–Sat week bucket the rest of Finance/break-even already use.
export function weekStartsForMonth(monthKey: string): string[] {
  const [y, m] = monthKey.split("-").map(Number);
  const firstOfMonth = new Date(Date.UTC(y, (m || 1) - 1, 1, 12));
  const week1Start = new Date(firstOfMonth);
  week1Start.setUTCDate(week1Start.getUTCDate() - firstOfMonth.getUTCDay());
  return [0, 1, 2, 3].map((i) => {
    const d = new Date(week1Start);
    d.setUTCDate(d.getUTCDate() + i * 7);
    return d.toISOString().slice(0, 10);
  });
}

export const WEEKDAY_SPREAD_LABELS = ["Mon", "Tue", "Wed", "Thu"] as const;
export function weekdaySpreadDates(monthKey: string, week: number): string[] {
  const sunday = weekStartsForMonth(monthKey)[week - 1];
  const [y, m, d] = sunday.split("-").map(Number);
  const base = new Date(Date.UTC(y, (m || 1) - 1, d, 12));
  return [1, 2, 3, 4].map((offset) => {
    const dt = new Date(base);
    dt.setUTCDate(dt.getUTCDate() + offset);
    return dt.toISOString().slice(0, 10);
  });
}
export const weekdaySpreadIds = (monthKey: string, week: number) => [1, 2, 3, 4].map((d) => `SAL-WEEKLY-${monthKey}-W${week}-D${d}`);

// Which of a week's 4 weekday dates are on/before today — i.e. already
// "elapsed" and eligible for a manual catch-up spread right now.
export function elapsedDayIndices(dayDates: string[], todayKey: string): number[] {
  return [0, 1, 2, 3].filter((i) => dayDates[i] <= todayKey);
}

// ── Daily cron: drop TODAY's slice for any week that's already been manually
// activated (its previous weekday already has an expense row). Only ever
// continues an already-started week — it never originates Monday itself, so
// a week that was never clicked stays fully manual/untouched. Runs once a
// day; a no-op on Fri/Sat/Sun and for orgs with no salaried active users.
export async function dropDueDailySalaryForAllOrgs(): Promise<{ orgsChecked: number; created: number }> {
  const todayKey = lagosTodayKey();
  const [y, m, d] = todayKey.split("-").map(Number);
  const dow = new Date(Date.UTC(y, (m || 1) - 1, d, 12)).getUTCDay(); // 0=Sun..6=Sat
  if (dow < 1 || dow > 4) return { orgsChecked: 0, created: 0 }; // nothing drips on Fri/Sat/Sun

  const { data: orgs, error: orgsError } = await supabase.from("organizations").select("id");
  if (orgsError) {
    logger.error("salary drip: org query failed", { error: orgsError.message });
    return { orgsChecked: 0, created: 0 };
  }

  // A week can start in the tail of the PREVIOUS month (e.g. week 1 of a month
  // that doesn't open on a Sunday) — never in the next month (week 4's start
  // is at most 21 days after week 1's, which is always within the same month).
  const candidateMonths = [0, -1].map((offset) => {
    const dt = new Date(Date.UTC(y, (m || 1) - 1 + offset, 1, 12));
    return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}`;
  });

  let created = 0;
  for (const org of (orgs ?? []) as { id: string }[]) {
    const orgId = org.id;
    let bucket: { monthKey: string; week: number; dayIndex: number } | null = null;
    for (const monthKey of candidateMonths) {
      for (let week = 1; week <= 4 && !bucket; week++) {
        const idx = weekdaySpreadDates(monthKey, week).indexOf(todayKey);
        if (idx !== -1) bucket = { monthKey, week, dayIndex: idx };
      }
      if (bucket) break;
    }
    if (!bucket || bucket.dayIndex === 0) continue; // Monday only ever starts via manual click

    const ids = weekdaySpreadIds(bucket.monthKey, bucket.week);
    const priorId = ids[bucket.dayIndex - 1];
    const todayId = ids[bucket.dayIndex];
    const { data: rows } = await supabase.from("expenses").select("id").eq("org_id", orgId).in("id", [priorId, todayId]);
    const existingIds = new Set((rows ?? []).map((r: any) => r.id as string));
    if (!existingIds.has(priorId)) continue; // week never manually activated — stay untouched
    if (existingIds.has(todayId)) continue;  // already dropped today

    const total = await totalMonthlySalary(orgId);
    if (total <= 0) continue;
    const dailyAmount = Math.round(Math.round(total / 4) / 4);
    const { error } = await supabase.from("expenses").insert({
      id: todayId, org_id: orgId, date: todayKey, category: "Salary",
      description: `Weekly salary spread · Week ${bucket.week}, ${WEEKDAY_SPREAD_LABELS[bucket.dayIndex]} · ${salaryMonthLabel(bucket.monthKey)}`,
      amount: dailyAmount, currency: "NGN", paid_by: "System (auto-spread)"
    });
    if (error) {
      logger.warn("salary drip: insert failed", { orgId, todayId, error: error.message });
      continue;
    }
    created++;
  }
  return { orgsChecked: (orgs ?? []).length, created };
}
