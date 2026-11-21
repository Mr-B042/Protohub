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
  /**
   * Is the campaign delivering right now (asked live from Meta)? "unknown" when
   * Meta did not answer for the account, and for TikTok. adLive: this ad itself
   * (a live campaign can have this ad switched off); null when not known.
   */
  campaignStatus?: CampaignStatus; adLive?: boolean | null;
};
export type CampaignStatus = "live" | "off" | "unknown";
const STATUS_ORDER: CampaignStatus[] = ["live", "unknown", "off"];
export type StreakOrder = { day: string; adId: string | null; campaignId?: string | null; status: string };

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

type DayOrders = Map<string, { all: number; confirmed: number }>;
type Metrics = Omit<StreakRow, keyof StreakAd>;

const windowDays = (today: string) => Array.from({ length: STREAK_RULES.window }, (_, i) => addDaysToDateKey(today, i - STREAK_RULES.window)); // oldest -> yesterday

/** Ran in the last 7 full days or today = still running (only those are listed). */
function ranRecently(spendOf: Map<string, number>, today: string) {
  const from = addDaysToDateKey(today, -STREAK_RULES.recent);
  for (const [day, spend] of spendOf) if (spend > 0 && day >= from && day <= today) return true;
  return false;
}

/** Everything the table shows for one strip of days (an ad, or a whole campaign). */
function measure(spendOf: Map<string, number>, ordersOf: DayOrders, today: string, target: number | null): Metrics {
  const days = windowDays(today);
  const recentFrom = days[days.length - STREAK_RULES.recent];
  const strip: StreakDay[] = days.map((day) => ({ day, spend: spendOf.get(day) ?? 0, orders: ordersOf.get(day)?.all ?? 0 }));
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
  const { verdict, reason } = judgeStreak({ activeDays14, orderDays14, activeDays7, orderDays7, share14, share7, costPerOrder14, target });
  return {
    days: strip, run, activeDays14, orderDays14, activeDays7, orderDays7, share14, share7,
    orders14, confirmed14, spend14, costPerOrder14, ordersToday: ordersOf.get(today)?.all ?? 0, spendToday: spendOf.get(today) ?? 0,
    target, verdict, reason
  };
}

function ordersByKey(orders: StreakOrder[], keyOf: (order: StreakOrder) => string | null | undefined) {
  const map = new Map<string, DayOrders>();
  for (const order of orders) {
    const key = keyOf(order);
    if (!key) continue;
    const byDay = map.get(key) ?? new Map();
    const cell = byDay.get(order.day) ?? { all: 0, confirmed: 0 };
    cell.all += 1;
    if (CONFIRMED_STATUSES.has(order.status)) cell.confirmed += 1;
    byDay.set(order.day, cell);
    map.set(key, byDay);
  }
  return map;
}

const byVerdictThenLive = <T extends { verdict: StreakVerdict; campaignStatus?: CampaignStatus; share14: number | null; orders14: number }>(a: T, b: T) =>
  STREAK_ORDER.indexOf(a.verdict) - STREAK_ORDER.indexOf(b.verdict)
  || STATUS_ORDER.indexOf(a.campaignStatus ?? "unknown") - STATUS_ORDER.indexOf(b.campaignStatus ?? "unknown")
  || (b.share14 ?? 0) - (a.share14 ?? 0) || b.orders14 - a.orders14;

export function orderStreaks(input: {
  today: string;
  ads: StreakAd[];
  /** Spend per ad per day (any days; only the window is read). */
  spend: Map<string, Map<string, number>>;
  orders: StreakOrder[];
  /** Break-even cost per order per product. */
  targets: Map<string, number>;
}): StreakRow[] {
  const ordersByAd = ordersByKey(input.orders, (order) => order.adId);
  const rows: StreakRow[] = [];
  for (const ad of input.ads) {
    const spendOf = input.spend.get(ad.adId) ?? new Map<string, number>();
    if (!ranRecently(spendOf, input.today)) continue;
    const target = ad.productId ? input.targets.get(ad.productId) ?? null : null;
    rows.push({ ...ad, ...measure(spendOf, ordersByAd.get(ad.adId) ?? new Map(), input.today, target) });
  }
  // Within a verdict, live campaigns first: those are the ones budget can go to now.
  return rows.sort(byVerdictThenLive);
}

// ------------------------------------------------------------ by campaign
//
// Bright, 21 Nov 2026: "campaign with one ad creative and the ones with 2 or
// more ... distinguish so we don't off the overall campaign that is doing
// well, whereas one of the ad creatives needs to be off". The VERDICT is the
// campaign's (all its ads together); each ad of a 2+ ad campaign gets its own
// ACTION, judged inside the campaign. A one-ad campaign is that ad: one verdict.

export type AdAction = "best" | "keep" | "watch" | "turn_off_ad" | "already_off" | "too_soon";
export const AD_ACTION_ORDER: AdAction[] = ["turn_off_ad", "watch", "best", "keep", "too_soon", "already_off"];

export type CampaignAdRow = StreakRow & { action: AdAction; actionReason: string; orderShare: number | null };
export type CampaignStreakRow = Metrics & {
  campaignId: string; campaignName: string; accountId: string; accountName: string; platform: "meta" | "tiktok";
  productId: string | null; productName: string | null; campaignStatus: CampaignStatus;
  /** Ads that ran in the last 7 days (newest work first: actions to take on top). */
  ads: CampaignAdRow[];
  adCount: number; liveAdCount: number; adsToTurnOff: number;
};

/** What to do with ONE ad of a campaign that has 2+ ads. */
export function adActionIn(ad: StreakRow, campaign: { orders14: number; bestAdId: string | null }): { action: AdAction; reason: string } {
  const R = STREAK_RULES;
  const shareText = campaign.orders14 > 0 ? `${ad.orders14} of the campaign's ${campaign.orders14} orders` : "no order yet";
  if (ad.adLive === false) return { action: "already_off", reason: `Already switched off. Brought ${shareText}.` };
  const t = ad.target;
  if (t !== null && ad.orders14 === 0 && ad.spend14 >= 2 * t) {
    return { action: "turn_off_ad", reason: `Spent ${ngn(ad.spend14)} (over 2× break-even ${ngn(t)}) with no order. Turn off this ad; the campaign keeps running on its other ads.` };
  }
  if (t !== null && ad.costPerOrder14 !== null && ad.activeDays14 >= R.minActiveDays && ad.costPerOrder14 > t) {
    return { action: "turn_off_ad", reason: `${ngn(ad.costPerOrder14)} an order, above break-even ${ngn(t)}, over ${ad.activeDays14} days. Turn off this ad, not the campaign.` };
  }
  if (t !== null && ad.orders14 === 0 && ad.spend14 >= t) return { action: "watch", reason: `Spent ${ngn(ad.spend14)} with no order yet (break-even ${ngn(t)}). Off at 2× if still nothing.` };
  if (ad.orders14 === 0 && ad.activeDays14 >= R.minActiveDays) return { action: "watch", reason: `No order in ${ad.activeDays14} days (spent ${ngn(ad.spend14)}). The others carry the campaign; check this creative.` };
  if (ad.adId === campaign.bestAdId) return { action: "best", reason: `Best ad here: ${shareText}${ad.costPerOrder14 !== null ? ` at ${ngn(ad.costPerOrder14)} an order` : ""}.` };
  if (ad.activeDays14 < R.minActiveDays && ad.orders14 === 0) return { action: "too_soon", reason: `Ran ${ad.activeDays14} day${ad.activeDays14 === 1 ? "" : "s"}; too soon to judge.` };
  return { action: "keep", reason: `Keep: ${shareText}${ad.costPerOrder14 !== null ? ` at ${ngn(ad.costPerOrder14)} an order` : ""}.` };
}

export function campaignStreaks(input: {
  today: string; ads: StreakAd[]; spend: Map<string, Map<string, number>>; orders: StreakOrder[]; targets: Map<string, number>;
}): CampaignStreakRow[] {
  const ordersByAd = ordersByKey(input.orders, (order) => order.adId);
  // Campaign orders: every order carrying the campaign, even without its ad id.
  const ordersByCampaign = ordersByKey(input.orders, (order) => order.campaignId ?? null);
  const groups = new Map<string, StreakAd[]>();
  for (const ad of input.ads) groups.set(ad.campaignId, [...(groups.get(ad.campaignId) ?? []), ad]);
  const rows: CampaignStreakRow[] = [];
  for (const [campaignId, ads] of groups) {
    const spendOf = new Map<string, number>();
    for (const ad of ads) for (const [day, amount] of input.spend.get(ad.adId) ?? []) spendOf.set(day, (spendOf.get(day) ?? 0) + amount);
    if (!ranRecently(spendOf, input.today)) continue;
    const products = new Set(ads.map((ad) => ad.productId));
    const productId = products.size === 1 ? ads[0].productId : null;
    const target = productId ? input.targets.get(productId) ?? null : null;
    // Orders with the campaign id; fall back to its ads' orders when none carry it.
    const campaignOrders: DayOrders = ordersByCampaign.get(campaignId) ?? new Map();
    if (!campaignOrders.size) for (const ad of ads) for (const [day, cell] of ordersByAd.get(ad.adId) ?? []) {
      const c = campaignOrders.get(day) ?? { all: 0, confirmed: 0 };
      campaignOrders.set(day, { all: c.all + cell.all, confirmed: c.confirmed + cell.confirmed });
    }
    const metrics = measure(spendOf, campaignOrders, input.today, target);
    const adRows = ads.filter((ad) => ranRecently(input.spend.get(ad.adId) ?? new Map(), input.today))
      .map((ad) => ({ ...ad, ...measure(input.spend.get(ad.adId) ?? new Map(), ordersByAd.get(ad.adId) ?? new Map(), input.today, ad.productId ? input.targets.get(ad.productId) ?? null : null) }));
    const best = adRows.filter((ad) => ad.orders14 > 0 && ad.adLive !== false).sort((a, b) => b.orders14 - a.orders14 || (a.costPerOrder14 ?? Infinity) - (b.costPerOrder14 ?? Infinity))[0];
    const multi = adRows.length >= 2;
    const judged: CampaignAdRow[] = adRows.map((ad) => {
      const { action, reason } = multi ? adActionIn(ad, { orders14: metrics.orders14, bestAdId: best?.adId ?? null }) : { action: "keep" as AdAction, reason: "The only ad: the campaign's verdict is this ad's." };
      return { ...ad, action, actionReason: reason, orderShare: metrics.orders14 > 0 ? ad.orders14 / metrics.orders14 : null };
    }).sort((a, b) => AD_ACTION_ORDER.indexOf(a.action) - AD_ACTION_ORDER.indexOf(b.action) || b.orders14 - a.orders14);
    const first = ads[0];
    const statuses = new Set(ads.map((ad) => ad.campaignStatus ?? "unknown"));
    rows.push({
      ...metrics, campaignId, campaignName: first.campaignName, accountId: first.accountId, accountName: first.accountName, platform: first.platform,
      productId, productName: productId ? first.productName : null,
      campaignStatus: statuses.has("live") ? "live" : statuses.has("off") ? "off" : "unknown",
      ads: judged, adCount: judged.length, liveAdCount: judged.filter((ad) => ad.adLive === true).length,
      adsToTurnOff: multi ? judged.filter((ad) => ad.action === "turn_off_ad").length : 0
    });
  }
  return rows.sort(byVerdictThenLive);
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
