// Order Streaks (Bright, 20 Nov 2026: "ads that are consistently getting
// orders ... will give us an edge to scale it"). Pure rules, no database.
//
// Bright's choices (20 Nov 2026):
// - CONSISTENCY, not an unbroken run: days with an order ÷ days the ad ran,
//   over the last 7 and 14 FULL days (today is shown on its own - it is not
//   over yet). A day the ad did not spend and got no order is a day it was
//   off: it neither counts nor breaks anything. On real data an unbroken run
//   left 57 of 58 ads at 0-2 days, even ads with orders on 10 of 14 days.
// - "Scale" needs the streak AND profit: cost per order at or under 70% of
//   the product's break-even (the same target Since Start and Campaign
//   Decisions use). Steady but costly ads are shown as such, never "scale".

import { CONFIRMED_STATUSES } from "./ad-spend.js";

/** "2026-11-20" + n days (calendar days; no time zone involved). */
const addDaysToDateKey = (key: string, n: number) => {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export const STREAK_RULES = {
  /** Full days looked at (ending yesterday), and the recent part of them. */
  window: 14, recent: 7,
  /** Steady = an order on at least this share of the days the ad ran, over 14 AND 7 days. */
  steadyShare: 0.7,
  /** ...on at least this many days the ad ran (fewer is too soon to tell). */
  minActiveDays: 5,
  /** Scale = cost per order at or under this share of break-even (Since Start's "winning"). */
  scaleBelow: 0.7,
  /** Building = an order on at least this share of its days. */
  buildingShare: 0.5
};

export type StreakVerdict = "scale" | "steady_ok" | "steady_costly" | "steady_no_target" | "building" | "patchy";
export const STREAK_ORDER: StreakVerdict[] = ["scale", "steady_ok", "steady_no_target", "steady_costly", "building", "patchy"];

export type StreakAd = {
  adId: string; adName: string; campaignId: string; campaignName: string; adsetId: string; adsetName: string;
  accountId: string; accountName: string; platform: "meta" | "tiktok"; productId: string | null; productName: string | null;
};
export type StreakOrder = { day: string; adId: string | null; status: string };

/** One day of the 14, oldest first: what the strip of squares shows. */
export type StreakDay = { day: string; spend: number; orders: number };

export type StreakRow = StreakAd & {
  days: StreakDay[];
  /** Days in a row with an order, counting back from yesterday (off days skipped). */
  run: number;
  activeDays14: number; orderDays14: number; activeDays7: number; orderDays7: number;
  /** Order days ÷ days it ran, 0-1 (null = did not run). */
  share14: number | null; share7: number | null;
  orders14: number; confirmed14: number; spend14: number; costPerOrder14: number | null;
  ordersToday: number; spendToday: number;
  target: number | null; verdict: StreakVerdict; reason: string;
};

const share = (part: number, whole: number) => (whole > 0 ? part / whole : null);

export function orderStreaks(input: {
  today: string;
  ads: StreakAd[];
  /** Spend per ad per day (any days; only the window is read). */
  spend: Map<string, Map<string, number>>;
  orders: StreakOrder[];
  /** Break-even cost per order per product. */
  targets: Map<string, number>;
}): StreakRow[] {
  const { today } = input;
  const days = Array.from({ length: STREAK_RULES.window }, (_, i) => addDaysToDateKey(today, i - STREAK_RULES.window)); // oldest -> yesterday
  const recentFrom = days[days.length - STREAK_RULES.recent];
  const ordersByAd = new Map<string, Map<string, { all: number; confirmed: number }>>();
  for (const order of input.orders) {
    if (!order.adId) continue;
    const byDay = ordersByAd.get(order.adId) ?? new Map();
    const cell = byDay.get(order.day) ?? { all: 0, confirmed: 0 };
    cell.all += 1;
    if (CONFIRMED_STATUSES.has(order.status)) cell.confirmed += 1;
    byDay.set(order.day, cell);
    ordersByAd.set(order.adId, byDay);
  }
  const rows: StreakRow[] = [];
  for (const ad of input.ads) {
    const spendOf = input.spend.get(ad.adId) ?? new Map<string, number>();
    const ordersOf = ordersByAd.get(ad.adId) ?? new Map<string, { all: number; confirmed: number }>();
    const strip: StreakDay[] = days.map((day) => ({ day, spend: spendOf.get(day) ?? 0, orders: ordersOf.get(day)?.all ?? 0 }));
    // Only ads still running: spent in the last 7 full days or today.
    const ranRecently = strip.some((cell) => cell.day >= recentFrom && cell.spend > 0) || (spendOf.get(today) ?? 0) > 0;
    if (!ranRecently) continue;
    const active = (cell: StreakDay) => cell.spend > 0 || cell.orders > 0;
    const recent = strip.filter((cell) => cell.day >= recentFrom);
    const activeDays14 = strip.filter(active).length;
    const orderDays14 = strip.filter((cell) => cell.orders > 0).length;
    const activeDays7 = recent.filter(active).length;
    const orderDays7 = recent.filter((cell) => cell.orders > 0).length;
    let run = 0;
    for (let i = strip.length - 1; i >= 0; i -= 1) {
      const cell = strip[i];
      if (cell.orders > 0) run += 1;
      else if (cell.spend > 0) break;
    }
    const orders14 = strip.reduce((sum, cell) => sum + cell.orders, 0);
    const confirmed14 = days.reduce((sum, day) => sum + (ordersOf.get(day)?.confirmed ?? 0), 0);
    const spend14 = strip.reduce((sum, cell) => sum + cell.spend, 0);
    const costPerOrder14 = orders14 > 0 ? spend14 / orders14 : null;
    const share14 = share(orderDays14, activeDays14);
    const share7 = share(orderDays7, activeDays7);
    const target = ad.productId ? input.targets.get(ad.productId) ?? null : null;
    const { verdict, reason } = judgeStreak({ activeDays14, orderDays14, activeDays7, orderDays7, share14, share7, costPerOrder14, target });
    rows.push({
      ...ad, days: strip, run, activeDays14, orderDays14, activeDays7, orderDays7, share14, share7,
      orders14, confirmed14, spend14, costPerOrder14, ordersToday: ordersOf.get(today)?.all ?? 0, spendToday: spendOf.get(today) ?? 0,
      target, verdict, reason
    });
  }
  return rows.sort((a, b) => STREAK_ORDER.indexOf(a.verdict) - STREAK_ORDER.indexOf(b.verdict)
    || (b.share14 ?? 0) - (a.share14 ?? 0) || b.orders14 - a.orders14);
}

const pct = (value: number) => `${Math.round(value * 100)}%`;
const ngn = (value: number) => `₦${Math.round(value).toLocaleString("en-NG")}`;

export function judgeStreak(m: {
  activeDays14: number; orderDays14: number; activeDays7: number; orderDays7: number;
  share14: number | null; share7: number | null; costPerOrder14: number | null; target: number | null;
}): { verdict: StreakVerdict; reason: string } {
  const R = STREAK_RULES;
  const days = `orders on ${m.orderDays14} of the ${m.activeDays14} days it ran`;
  const steady = m.activeDays14 >= R.minActiveDays && (m.share14 ?? 0) >= R.steadyShare && (m.share7 ?? 0) >= R.steadyShare;
  if (steady) {
    if (m.target === null || m.costPerOrder14 === null) return { verdict: "steady_no_target", reason: `Steady: ${days}. Break-even not known, so the cost can't be judged.` };
    const ratio = m.costPerOrder14 / m.target;
    if (ratio <= R.scaleBelow) return { verdict: "scale", reason: `Steady: ${days}, at ${ngn(m.costPerOrder14)} an order (${pct(ratio)} of break-even ${ngn(m.target)}).` };
    if (ratio <= 1) return { verdict: "steady_ok", reason: `Steady: ${days}, but ${ngn(m.costPerOrder14)} an order is ${pct(ratio)} of break-even. Bring the cost down before adding budget.` };
    return { verdict: "steady_costly", reason: `Steady: ${days}, but ${ngn(m.costPerOrder14)} an order is above break-even ${ngn(m.target)}. Orders come in daily at a loss.` };
  }
  if (m.activeDays14 < R.minActiveDays && m.orderDays14 > 0) return { verdict: "building", reason: `Too soon to tell: ran ${m.activeDays14} of ${R.minActiveDays} days needed, ${days}.` };
  if ((m.share14 ?? 0) >= R.buildingShare) {
    const slipped = (m.share14 ?? 0) >= R.steadyShare && (m.share7 ?? 0) < R.steadyShare;
    return { verdict: "building", reason: slipped ? `Was steady, slipped this week: orders on ${m.orderDays7} of ${m.activeDays7} recent days.` : `Getting there: ${days}.` };
  }
  return { verdict: "patchy", reason: m.orderDays14 === 0 ? `No order in the ${m.activeDays14} days it ran.` : `Patchy: ${days}.` };
}
