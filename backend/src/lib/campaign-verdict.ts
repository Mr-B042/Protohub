/**
 * ONE decision per running campaign (Bright, 15 Nov 2026), replacing the
 * separate "no order for 3 days" / "spending with no order" / "too expensive"
 * lists that could tell him "turn it off" and "it has been worth it" about the
 * same campaign at once.
 *
 * Bright's framework: never judge on CPC; judge on profitable DELIVERED sales.
 * The yardstick is the product's BREAK-EVEN cost per placed order (average
 * delivered profit × delivery rate, or the Owner's own target: Since Start).
 * Without one, ₦7,500 (his old turn-off level) is used and the card says so.
 *
 * In order, the first that fits wins:
 *  turn_off  no order since the last one and 2× break-even spent since then
 *            (today included), or above break-even over the last 3 full days
 *            AND since it started ("consistently above").
 *  pause     no order and 1.5× break-even spent since the last one, or the
 *            ad cost per delivered order is above what a delivery earns
 *            (poor delivery is losing money).
 *  watch     85-100% of break-even over 3 full days; or more than one
 *            break-even spent with no order; or a bad 3 days while still
 *            fine since it started.
 *  scale     at most 70% of break-even over 3 full days with 3+ orders, and
 *            under break-even since it started.
 *  keep      everything else (counted, not listed).
 * Checked FIRST: Meta reports purchases from it since the last Protohub order
 * but none reached Protohub -> check_tracking (orders not linked), never
 * "turn off" on missing data.
 */

export const VERDICT_RULES = {
  fallbackTarget: 7_500,
  turnOffNoOrderTimes: 2,
  pauseNoOrderTimes: 1.5,
  watchFrom: 0.85,
  scaleAtMost: 0.7,
  scaleMinOrders: 3,
  recentDays: 3,
  minDeliveredForLoss: 5
};

export type CampaignVerdict = "turn_off" | "pause" | "check_tracking" | "watch" | "scale" | "keep";
export const VERDICT_ORDER: CampaignVerdict[] = ["turn_off", "pause", "check_tracking", "watch", "scale", "keep"];

export type VerdictCampaign = {
  campaignId: string; campaignName: string; platform: string; accountName: string; productName: string | null;
  running: boolean;
  /** Break-even cost per placed order for its product (null = not known yet). */
  target: number | null; targetSource: "worked_out" | "set_by_you" | "mixed" | null;
  /** Since it started. */
  spend: number; orders: number; delivered: number;
  /** What one delivered order earns on average for the product, before ads (null = unknown). */
  marginPerDelivery: number | null;
};

export type VerdictResult = VerdictCampaign & {
  verdict: CampaignVerdict;
  /** One plain sentence: why. */
  reason: string;
  /** What to do. */
  action: string;
  yardstick: number; yardstickKnown: boolean;
  recentSpend: number; recentOrders: number; recentCpo: number | null;
  lifetimeCpo: number | null; costPerDelivered: number | null;
  spendSinceLastOrder: number; lastOrderDay: string | null; todaySpend: number;
  /** Same campaign, same situation: alert once. */
  episodeKey: string;
};

const naira = (value: number) => `₦${Math.round(value).toLocaleString("en-NG")}`;
const addDays = (day: string, days: number) => { const d = new Date(`${day}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
const mondayOf = (day: string) => { const d = new Date(`${day}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); };

/** The last day it was switched back on after 2+ days with no spend (null = never paused) from `from`. */
function restartDay(days: Map<string, number>, from: string, today: string) {
  let idle = 0, restart: string | null = null;
  for (let day = from; day <= today; day = addDays(day, 1)) {
    if ((days.get(day) ?? 0) > 0) { if (idle >= 2) restart = day; idle = 0; } else idle += 1;
  }
  return restart;
}

export function campaignVerdicts(input: {
  today: string;
  campaigns: VerdictCampaign[];
  lastOrderDay: Map<string, string>;
  ordersByDay: Map<string, Map<string, number>>;
  spendByDay: Map<string, Map<string, number>>;
  /** Meta's own purchases per campaign per day (tracking check). */
  platformByDay?: Map<string, Map<string, number>>;
  /** First day spendByDay covers. */
  spendFrom?: string;
}): VerdictResult[] {
  const R = VERDICT_RULES;
  const out: VerdictResult[] = [];
  for (const c of input.campaigns) {
    if (!c.running) continue;
    const days = input.spendByDay.get(c.campaignId) ?? new Map<string, number>();
    const orderDays = input.ordersByDay.get(c.campaignId) ?? new Map<string, number>();
    const T = c.target && c.target > 0 ? c.target : R.fallbackTarget;
    const known = Boolean(c.target && c.target > 0);
    const todaySpend = days.get(input.today) ?? 0;

    // Last 3 FULL days (today is not over).
    let recentSpend = 0, recentOrders = 0;
    for (let d = addDays(input.today, -R.recentDays); d < input.today; d = addDays(d, 1)) {
      recentSpend += days.get(d) ?? 0;
      recentOrders += orderDays.get(d) ?? 0;
    }
    const recentCpo = recentOrders > 0 ? recentSpend / recentOrders : null;
    // Never less spent since it started than the daily rows add up to.
    const spend = Math.max(c.spend, [...days.values()].reduce((a, b) => a + b, 0));
    const lifetimeCpo = c.orders > 0 ? spend / c.orders : null;
    const costPerDelivered = c.delivered > 0 ? spend / c.delivered : null;

    // Spent since the last order (or since switched back on / first spend), today included.
    const last = input.lastOrderDay.get(c.campaignId) ?? null;
    const firstSpent = [...days.entries()].filter(([, s]) => s > 0).map(([d]) => d).sort()[0] ?? null;
    let from = last ? addDays(last, 1) : firstSpent;
    if (from) {
      const restart = restartDay(days, input.spendFrom && input.spendFrom > from ? input.spendFrom : from, input.today);
      if (restart && restart > from) from = restart;
    }
    const spendSinceLastOrder = from ? [...days.entries()].filter(([d]) => d >= from! && d <= input.today).reduce((sum, [, s]) => sum + s, 0) : 0;
    // A campaign with no spend in the last 3 days and today is idle: nothing to decide.
    if (recentSpend + todaySpend <= 0) continue;

    const yard = `${naira(T)}${known ? "" : " (no break-even worked out yet, so ₦7,500 is used)"}`;
    const base = {
      ...c, spend, yardstick: T, yardstickKnown: known, recentSpend, recentOrders, recentCpo, lifetimeCpo, costPerDelivered,
      spendSinceLastOrder, lastOrderDay: last, todaySpend
    };
    const spell = `${c.campaignId}:${from ?? "start"}`;
    const sinceWord = last ? "since the last order" : "since it started spending";
    let verdict: CampaignVerdict = "keep", reason = "", action = "", key = "";
    const losingOnDelivery = c.marginPerDelivery !== null && costPerDelivered !== null && c.delivered >= R.minDeliveredForLoss && costPerDelivered > c.marginPerDelivery;

    const platformSince = from ? [...(input.platformByDay?.get(c.campaignId) ?? new Map<string, number>()).entries()].filter(([d]) => d >= from! && d <= input.today).reduce((sum, [, n]) => sum + n, 0) : 0;

    if (spendSinceLastOrder >= T && platformSince > 0) {
      verdict = "check_tracking"; key = `${spell}:tracking`;
      reason = `Meta counts ${platformSince} purchase${platformSince === 1 ? "" : "s"} from it ${sinceWord}, but no order reached Protohub with this campaign on it.`;
      action = "Check tracking before deciding: the form link must carry the campaign (utm), and the order must come through Protohub's form. Don't turn it off on missing data.";
    } else if (spendSinceLastOrder >= T * R.turnOffNoOrderTimes) {
      verdict = "turn_off"; key = `${spell}:off-dry`;
      reason = `${naira(spendSinceLastOrder)} spent ${sinceWord} with no order: ${(spendSinceLastOrder / T).toFixed(1)}× its break-even of ${yard}.`;
      action = "Turn it off. If it was doing well before, check the ad is approved, the form link works and stock is available, then restart with a new picture/video.";
    } else if (recentCpo !== null && recentCpo > T && lifetimeCpo !== null && lifetimeCpo > T && recentSpend >= T) {
      verdict = "turn_off"; key = `${c.campaignId}:off-high-${addDays(input.today, -1)}`;
      reason = `${naira(recentCpo)} per order over the last 3 full days and ${naira(lifetimeCpo)} since it started: both above its break-even of ${yard}.`;
      action = "Turn it off: it is consistently costing more per order than an order earns.";
    } else if (spendSinceLastOrder >= T * R.pauseNoOrderTimes) {
      verdict = "pause"; key = `${spell}:pause-dry`;
      reason = `${naira(spendSinceLastOrder)} spent ${sinceWord} with no order: ${(spendSinceLastOrder / T).toFixed(1)}× its break-even of ${yard}.`;
      action = "Pause and check before more money goes: ad approved and delivering, the form link, the offer and price, stock. Turn it off if it reaches 2× with no order.";
    } else if (losingOnDelivery) {
      verdict = "pause"; key = `${c.campaignId}:delivery-${mondayOf(input.today)}`;
      reason = `Each delivered order costs ${naira(costPerDelivered!)} in ads, more than a delivery earns (${naira(c.marginPerDelivery!)}): ${c.delivered} of ${c.orders} orders delivered.`;
      action = "Pause and look at delivery: who is failing (agents, states, unreachable customers) before spending more. Orders that don't deliver lose money.";
    } else if (recentCpo !== null && recentCpo >= T * R.watchFrom) {
      verdict = "watch"; key = `${c.campaignId}:watch-${addDays(input.today, -1)}`;
      reason = recentCpo > T
        ? `${naira(recentCpo)} per order over the last 3 full days, above its break-even of ${yard}, but ${lifetimeCpo !== null ? `${naira(lifetimeCpo)} since it started` : "fine since it started"}.`
        : `${naira(recentCpo)} per order over the last 3 full days, close to its break-even of ${yard}.`;
      action = "Watch it: don't raise the budget. Turn it off if it stays above break-even.";
    } else if (spendSinceLastOrder >= T) {
      verdict = "watch"; key = `${spell}:watch-dry`;
      reason = `${naira(spendSinceLastOrder)} spent ${sinceWord} with no order, more than its break-even of ${yard}.`;
      action = `Watch it. Pause and check at ${naira(T * R.pauseNoOrderTimes)} with no order.`;
    } else if (recentCpo !== null && recentCpo <= T * R.scaleAtMost && recentOrders >= R.scaleMinOrders && (lifetimeCpo === null || lifetimeCpo <= T) && known) {
      verdict = "scale"; key = `${c.campaignId}:scale-${addDays(input.today, -1)}`;
      reason = `${naira(recentCpo)} per order over the last 3 full days (${recentOrders} orders), well under its break-even of ${yard}.`;
      action = "Consider raising the budget slowly (about 20% every 2-3 days) while it stays under break-even.";
    } else {
      verdict = "keep"; key = `${c.campaignId}:keep`;
      reason = recentCpo !== null ? `${naira(recentCpo)} per order over the last 3 full days, under its break-even of ${yard}.` : `Under its break-even of ${yard} so far.`;
      action = "Keep it running.";
    }
    out.push({ ...base, verdict, reason, action, episodeKey: key });
  }
  return out.sort((a, b) => VERDICT_ORDER.indexOf(a.verdict) - VERDICT_ORDER.indexOf(b.verdict) || b.spendSinceLastOrder - a.spendSinceLastOrder);
}
