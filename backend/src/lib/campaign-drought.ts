/**
 * Campaigns with no order for 3 days (Bright, 5 Nov 2026). With many
 * campaigns running nobody can watch them all, so Protohub says which ones
 * have stopped bringing orders and what to do.
 *
 * Bright's rules:
 *  - "Order" = a Protohub order that came from the campaign (the Ad Spend /
 *    Since Start count), not Meta's purchases.
 *  - A campaign counts when it is ON (checked LIVE with Meta in
 *    campaign-drought-alerts.ts: at least one ad delivering), spent recently,
 *    and has had no order for 3 WHOLE days (today never counts: it is not
 *    over, and Ads Manager's day rows only show whole days - 6 Nov 2026).
 *  - Cost per order SINCE IT STARTED decides the group:
 *      under ₦6,500    -> Check and adjust (it has been worth it)
 *      ₦6,500 - 7,500  -> Watch
 *      over ₦7,500     -> Turn off (also: no order at all since it started)
 */

export const DROUGHT_RULES = { days: 3, adjustBelow: 6_500, offAbove: 7_500 };

export type DroughtGroup = "off" | "watch" | "adjust";
export const DROUGHT_ORDER: DroughtGroup[] = ["off", "watch", "adjust"];

export type DroughtCampaign = {
  campaignId: string; campaignName: string; platform: string; accountName: string;
  running: boolean; start: string | null;
  /** Since it started. */
  spend: number; orders: number; cpa: number | null;
  productName: string | null;
};

export type Drought = DroughtCampaign & {
  group: DroughtGroup;
  daysWithoutOrder: number;
  lastOrderDay: string | null;
  /** Spent in the last 3 days / since the last order. */
  recentSpend: number;
  spendSinceLastOrder: number;
  /** Today's spend so far, inside spendSinceLastOrder and spend. */
  todaySpend: number;
  advice: string;
  /** Same campaign, same dry spell: one alert only. */
  episodeKey: string;
};

const naira = (value: number) => `₦${Math.round(value).toLocaleString("en-NG")}`;
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
const addDays = (day: string, days: number) => { const d = new Date(`${day}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };

export function groupFor(cpa: number | null): DroughtGroup {
  if (cpa === null || cpa > DROUGHT_RULES.offAbove) return "off";
  if (cpa >= DROUGHT_RULES.adjustBelow) return "watch";
  return "adjust";
}

/**
 * The campaigns that have gone dry. `lastOrderDay` and `spendByDay` are per
 * campaign id; spendByDay holds the recent days only (Lagos dates).
 */
export function campaignDroughts(input: {
  today: string;
  campaigns: DroughtCampaign[];
  lastOrderDay: Map<string, string>;
  spendByDay: Map<string, Map<string, number>>;
  /** First day spendByDay covers: spend seen only after it is a real first day. */
  spendFrom?: string;
}): Drought[] {
  // Spent in the 3 whole days or today.
  const recentFrom = addDays(input.today, -DROUGHT_RULES.days);
  const out: Drought[] = [];
  for (const campaign of input.campaigns) {
    if (!campaign.running) continue;
    const days = input.spendByDay.get(campaign.campaignId) ?? new Map<string, number>();
    const recentSpend = [...days.entries()].filter(([day]) => day >= recentFrom).reduce((sum, [, spend]) => sum + spend, 0);
    if (recentSpend <= 0) continue;
    const last = input.lastOrderDay.get(campaign.campaignId) ?? null;
    // ⚠️ Meta's "start" for a campaign with no start date is the day its ad was
    // MADE, not the day it first spent. 6 Nov 2026: a campaign made 18 Oct that
    // first spent that morning was flagged "no order in 20 days, turn it off".
    // So a never-ordered campaign counts from its first day of daily spend
    // (when that day is inside the daily data, not just where the data begins).
    const spentDays = [...days.entries()].filter(([, spend]) => spend > 0).map(([day]) => day).sort();
    const firstSpent = spentDays[0] ?? null;
    const realFirstSpent = firstSpent && (!input.spendFrom || firstSpent > input.spendFrom) ? firstSpent : null;
    const started = realFirstSpent && (!campaign.start || realFirstSpent > campaign.start) ? realFirstSpent : campaign.start;
    // WHOLE days only (Bright, 6 Nov 2026): last order on the 3rd, today the
    // 6th -> the 4th and 5th = 2 days; Ads Manager shows the same two empty
    // rows. Counting the 6th at 9am called it "3 days" a day early.
    // Never an order: whole days from its first day of spend.
    const daysWithoutOrder = last ? daysBetween(last, input.today) - 1 : started ? daysBetween(started, input.today) : 0;
    if (daysWithoutOrder < DROUGHT_RULES.days) continue;
    const spendSinceLastOrder = [...days.entries()].filter(([day]) => !last || day > last).reduce((sum, [, spend]) => sum + spend, 0);
    // Lifetime spend is refreshed less often than the daily rows: never show
    // less spent since it started than the daily rows already add up to.
    const dailySinceStart = [...days.entries()].filter(([day]) => !campaign.start || day >= campaign.start).reduce((sum, [, spend]) => sum + spend, 0);
    const spend = Math.max(campaign.spend, dailySinceStart);
    const cpa = campaign.orders > 0 ? spend / campaign.orders : null;
    const group = groupFor(cpa);
    const todaySpend = days.get(input.today) ?? 0;
    const dry = `${daysWithoutOrder} full day${daysWithoutOrder === 1 ? "" : "s"}`;
    const advice = cpa === null
      ? `${naira(spend)} spent since it started and no order in ${dry}. Turn it off.`
      : group === "off"
        ? `${naira(cpa)} per order since it started (over ${naira(DROUGHT_RULES.offAbove)}) and no order for ${dry}. Turn it off.`
        : group === "watch"
          ? `${naira(cpa)} per order since it started, close to the ${naira(DROUGHT_RULES.offAbove)} limit, and no order for ${dry}. Watch it: turn it off if no order comes tomorrow.`
          : `${naira(cpa)} per order since it started, so it has been worth it, but no order for ${dry}. Check it before turning it off: ad approved and delivering, budget, the form link, and refresh the picture/video.`;
    out.push({
      ...campaign, spend, cpa, group, daysWithoutOrder, lastOrderDay: last, recentSpend, spendSinceLastOrder, todaySpend, advice,
      // "after-": the 6 Nov alerts went out a day early under the old count;
      // a new key lets the real alert go out once 3 whole days have passed.
      episodeKey: `${campaign.campaignId}:${last ? `after-${last}` : `start-${started ?? ""}`}`
    });
  }
  return out.sort((a, b) => DROUGHT_ORDER.indexOf(a.group) - DROUGHT_ORDER.indexOf(b.group) || b.spendSinceLastOrder - a.spendSinceLastOrder);
}
