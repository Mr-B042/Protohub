// Ad Spend -> Since Start (Bright, 8 Oct 2026): each campaign judged over its
// WHOLE life, by rules, not by feel. Bright's rules:
//   * target = the product's break-even cost per order, worked out from its
//     own numbers (or the Owner's own target for that product);
//   * "Needs more time" until 3 days AND 2x target spent;
//   * hook rate < 25% weak, >= 30% strong - advice only, never "turn off".
// Pure: the loading is in ad-spend-data.ts.

import { resolveSplits, type Split, type SpendOrder } from "./ad-spend.js";

export const RULES = { minDays: 3, minSpendTimesTarget: 2, winningBelow: 0.7, hookWeak: 25, hookStrong: 30, breakEvenMinOrders: 10 };

export type Verdict = "winning" | "keep" | "learning" | "turn_off" | "check_tracking" | "no_target";
export const VERDICT_ORDER: Verdict[] = ["turn_off", "check_tracking", "winning", "keep", "learning", "no_target"];

export type LifetimeRow = {
  platform: "meta" | "tiktok"; account_id: string; campaign_id: string; campaign_name: string; campaign_status: string | null; campaign_start: string | null;
  adset_id: string; adset_name: string; ad_id: string; ad_name: string; first_day: string | null; last_day: string | null;
  spend: number; impressions: number; link_clicks: number; video_hook: number; video_full: number; platform_purchases: number;
};

const pct = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : null);
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;

/**
 * Break-even cost per order for a product: what a delivered order leaves after
 * product cost and delivery fee, times the share of orders that get delivered.
 * Spend more than this per order and the product loses money on ads.
 * Uses orders old enough to have been delivered or not (placed 7-37 days ago).
 */
export function breakEvenCpa(orders: SpendOrder[]): { cpa: number | null; deliveryRate: number | null; margin: number | null; orders: number } {
  const closedOrders = orders.length;
  const delivered = orders.filter((order) => order.status === "Delivered");
  if (closedOrders < RULES.breakEvenMinOrders || delivered.length === 0) return { cpa: null, deliveryRate: null, margin: null, orders: closedOrders };
  const margin = delivered.reduce((sum, order) => sum + order.amount - order.productCost - order.deliveryFee, 0) / delivered.length;
  const deliveryRate = delivered.length / closedOrders;
  return { cpa: margin > 0 ? margin * deliveryRate : null, deliveryRate, margin, orders: closedOrders };
}

export type Judgement = { verdict: Verdict; reason: string; advice: string[] };

export function judge(input: { days: number; spend: number; orders: number; platformPurchases: number; target: number | null; hookRate: number | null; platform: "meta" | "tiktok"; productName: string | null; running: boolean }): Judgement {
  const advice: string[] = [];
  const hookWord = input.platform === "tiktok" ? "first 2 seconds" : "first 3 seconds";
  if (input.hookRate !== null && input.hookRate < RULES.hookWeak) advice.push(`Weak hook (${input.hookRate.toFixed(1)}%): most people scroll past. Change the ${hookWord} of the video.`);
  const naira = (value: number) => `₦${Math.round(value).toLocaleString("en-NG")}`;
  if (input.target === null) return { verdict: "no_target", reason: `No target cost per order for ${input.productName ?? "this campaign's product"} yet (not enough delivered orders to work it out). Set one.`, advice };
  const neededSpend = input.target * RULES.minSpendTimesTarget;
  if (input.days < RULES.minDays || input.spend < neededSpend) {
    const parts = [];
    if (input.days < RULES.minDays) parts.push(`day ${input.days} of ${RULES.minDays}`);
    if (input.spend < neededSpend) parts.push(`${naira(input.spend)} of ${naira(neededSpend)} spent`);
    return { verdict: "learning", reason: `Too early to judge: ${parts.join(", ")}.`, advice };
  }
  const cpa = input.orders > 0 ? input.spend / input.orders : null;
  if (cpa === null) {
    if (input.platformPurchases > 0) return { verdict: "check_tracking", reason: `${input.platform === "tiktok" ? "TikTok" : "Meta"} reports ${Math.round(input.platformPurchases)} purchase${Math.round(input.platformPurchases) === 1 ? "" : "s"} but no Protohub order carries this campaign. Check the ad's link and URL parameters before turning it off.`, advice };
    return { verdict: "turn_off", reason: `${naira(input.spend)} spent and no orders.`, advice };
  }
  if (input.hookRate !== null && input.hookRate >= RULES.hookStrong && cpa > input.target) advice.push(`Strong hook (${input.hookRate.toFixed(1)}%): the video stops people, so look at the offer, price or form.`);
  if (cpa <= input.target * RULES.winningBelow) return { verdict: "winning", reason: `${naira(cpa)} per order, ${Math.round((1 - cpa / input.target) * 100)}% under break-even (${naira(input.target)}). Give it more budget.`, advice };
  if (cpa <= input.target) return { verdict: "keep", reason: `${naira(cpa)} per order, under break-even (${naira(input.target)}). Keep it running.`, advice };
  return { verdict: "turn_off", reason: `${naira(cpa)} per order, ${Math.round((cpa / input.target - 1) * 100)}% over break-even (${naira(input.target)}). Every order loses money${input.running ? "" : " (already off)"}.`, advice };
}

export type SinceStartInput = {
  today: string; ordersFrom: string;
  lifetime: LifetimeRow[]; orders: SpendOrder[];
  mappings: Map<string, Split[]>; evidence: Map<string, string>;
  /** product id -> { cpa, source } */
  targets: Map<string, { cpa: number; source: "worked_out" | "set_by_you" }>;
  products: Map<string, { name: string }>; accountNames: Map<string, string>;
};

/** One row per campaign (with its ads), judged since it started. */
export function sinceStart(input: SinceStartInput) {
  const campaigns = new Map<string, LifetimeRow[]>();
  for (const row of input.lifetime) campaigns.set(row.campaign_id, [...(campaigns.get(row.campaign_id) ?? []), row]);
  const sum = (rows: LifetimeRow[], key: keyof LifetimeRow) => rows.reduce((total, row) => total + (Number(row[key]) || 0), 0);
  const metricsOf = (rows: LifetimeRow[]) => {
    const spend = sum(rows, "spend");
    const impressions = sum(rows, "impressions");
    const hooks = sum(rows, "video_hook");
    return {
      spend, impressions, linkClicks: sum(rows, "link_clicks"), platformPurchases: sum(rows, "platform_purchases"),
      hookRate: hooks > 0 ? pct(hooks, impressions) : null, holdRate: pct(sum(rows, "video_full"), hooks), ctr: pct(sum(rows, "link_clicks"), impressions),
      cpm: impressions > 0 ? (spend / impressions) * 1000 : null
    };
  };
  const ordersOf = (test: (order: SpendOrder) => boolean, since: string) => input.orders.filter((order) => order.day >= since && test(order));

  return Array.from(campaigns.entries()).map(([campaignId, ads]) => {
    const first = ads[0];
    const firstSpend = ads.map((row) => row.first_day).filter(Boolean).sort()[0] ?? null;
    // Start = the campaign's own start date when sane, else its first day of spend.
    const start = first.campaign_start && first.campaign_start > "2015-01-01" ? first.campaign_start : firstSpend;
    const lastSpend = ads.map((row) => row.last_day).filter(Boolean).sort().pop() ?? null;
    const running = (first.campaign_status ?? "").toUpperCase() === "ACTIVE";
    const end = running || !lastSpend ? input.today : lastSpend;
    const days = start ? Math.max(1, daysBetween(start, end < start ? start : end)) : 0;
    // Product: each ad's spend follows the same rules as the Ad Spend tab; the biggest share names the campaign.
    const productSpend = new Map<string, number>();
    for (const ad of ads) {
      const { splits } = resolveSplits({ ad_id: ad.ad_id, adset_id: ad.adset_id, campaign_id: ad.campaign_id, ad_account_id: ad.account_id }, input.mappings, input.evidence);
      for (const split of splits) productSpend.set(split.productId, (productSpend.get(split.productId) ?? 0) + (ad.spend * split.share) / 100);
    }
    const totalMapped = Array.from(productSpend.values()).reduce((a, b) => a + b, 0);
    const productId = Array.from(productSpend.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    // Target: spend-weighted across the campaign's products.
    let target: number | null = null;
    let targetSource: "worked_out" | "set_by_you" | "mixed" | null = null;
    if (totalMapped > 0) {
      let weighted = 0; let covered = 0; const sources = new Set<string>();
      for (const [id, amount] of productSpend) { const t = input.targets.get(id); if (t) { weighted += t.cpa * amount; covered += amount; sources.add(t.source); } }
      if (covered >= totalMapped * 0.999) { target = weighted / covered; targetSource = sources.size === 1 ? (Array.from(sources)[0] as "worked_out" | "set_by_you") : "mixed"; }
    }
    const since = start && start > input.ordersFrom ? start : input.ordersFrom;
    const orders = ordersOf((order) => order.campaignId === campaignId, since);
    const delivered = orders.filter((order) => order.status === "Delivered").length;
    const m = metricsOf(ads);
    const productName = productId ? input.products.get(productId)?.name ?? null : null;
    const judgement = judge({ days, spend: m.spend, orders: orders.length, platformPurchases: m.platformPurchases, target, hookRate: m.hookRate, platform: first.platform, productName, running });
    const adRows = ads.map((ad) => {
      const am = metricsOf([ad]);
      const adOrders = ordersOf((order) => order.adId === ad.ad_id, since).length;
      return { adId: ad.ad_id, adName: ad.ad_name, adsetName: ad.adset_name, firstDay: ad.first_day, ...am, orders: adOrders, cpa: adOrders ? am.spend / adOrders : null };
    }).sort((a, b) => b.spend - a.spend);
    return {
      campaignId, campaignName: first.campaign_name, platform: first.platform, accountId: first.account_id, accountName: input.accountNames.get(first.account_id) ?? first.account_id,
      status: first.campaign_status, running, start, days, ordersCountedFrom: since !== start ? since : null,
      productId: productSpend.size ? productId : null, productName, products: productSpend.size,
      ...m, orders: orders.length, delivered, cpa: orders.length ? m.spend / orders.length : null, cpdo: delivered ? m.spend / delivered : null,
      target, targetSource,
      ...(productSpend.size ? judgement : { verdict: "no_target" as Verdict, reason: "No product yet, so there is no target to judge it by. Assign one in Campaign View.", advice: judgement.advice }),
      ads: adRows
    };
  });
}
