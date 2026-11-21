import { supabase } from "./supabase.js";
import { logger } from "./logger.js";
import { lagosDateKey } from "./sales-bonus-engine.js";
import { sinceStartCore } from "./ad-spend-data.js";
import { TIKTOK_PREFIX } from "./ad-spend.js";
import { repBonusesForPlacedRange } from "./marketing-performance.js";
import { rateFor } from "./currency-rates.js";
import { addDays, campaignDecisions, DELIVERED, ENGINE_RULES, moneyOf, type CampaignDecisionRow, type EngineCampaign, type EngineOrder, type Money } from "./campaign-engine.js";

// Loading for Tracking Hub › Campaign Decisions (Bright, 21 Nov 2026). The
// rules are in campaign-engine.ts; this file reads the database and Meta
// (through Since Start's loader, so break-even and "running right now" are the
// same everywhere) and adds what the money needs: delivered dates, each
// delivered order's rep bonus (both bonus systems, as the Dashboard takes off
// profit), and failed-delivery fees (expenses "Failed Delivery", id EXP-DEL-<order>).

export const PERIODS = [3, 7, 14, 30] as const;
const CACHE_MS = 5 * 60_000;
const cache = new Map<string, { at: number; value: Awaited<ReturnType<typeof build>> }>();
const FAILED_ID = /^EXP-DEL-(.+)$/;

/** Every running campaign of the branch with its decision, kept 5 minutes per period. */
export async function loadCampaignDecisions(orgId: string, branchId: string, opts: { periodDays?: number; fresh?: boolean } = {}) {
  const periodDays = PERIODS.includes(opts.periodDays as any) ? opts.periodDays! : 3;
  const key = `${orgId}|${branchId}|${periodDays}`;
  const hit = cache.get(key);
  if (!opts.fresh && hit && Date.now() - hit.at < CACHE_MS) return { ...hit.value, checkedAt: new Date(hit.at).toISOString() };
  const value = await build(orgId, branchId, periodDays);
  const at = Date.now();
  cache.set(key, { at, value });
  return { ...value, checkedAt: new Date(at).toISOString() };
}

async function build(orgId: string, branchId: string, periodDays: number) {
  const today = lagosDateKey(new Date().toISOString());
  const core = await sinceStartCore(orgId, branchId, today);
  const from = addDays(today, -(ENGINE_RULES.matureToDays + 7));

  // Rep bonuses are naira everywhere (staff pay, #1022); profit is in the branch's money.
  const [bonuses, failed, branch] = await Promise.all([
    repBonusesForPlacedRange(orgId, branchId, addDays(today, -ENGINE_RULES.matureToDays), today).catch((err: any) => {
      logger.warn("campaign decisions: rep bonuses unavailable", { orgId, error: err?.message ?? String(err) });
      return null;
    }),
    supabase.from("expenses").select("id, amount").eq("org_id", orgId).eq("branch_id", branchId).eq("category", "Failed Delivery").gte("date", from).limit(20000),
    supabase.from("branches").select("currency").eq("id", branchId).maybeSingle()
  ]);
  if (failed.error) throw failed.error;
  const currency = String((branch.data as any)?.currency ?? "NGN").toUpperCase();
  const nairaPer = currency === "NGN" ? 1 : (await rateFor(orgId, "NGN", currency))?.fromPerTo ?? null;
  const bonusInBranch = (naira: number) => (nairaPer ? naira / nairaPer : naira);
  const failedByOrder = new Map<string, number>();
  for (const row of (failed.data ?? []) as any[]) {
    const id = FAILED_ID.exec(String(row.id))?.[1];
    if (id) failedByOrder.set(id, (failedByOrder.get(id) ?? 0) + (Number(row.amount) || 0));
  }

  // Orders per campaign, with money.
  const orders = new Map<string, EngineOrder[]>();
  const byProduct = new Map<string, EngineOrder[]>();
  for (const o of core.data.orders) {
    const engineOrder: EngineOrder = {
      id: o.id, day: o.day, deliveredDay: o.deliveredDay ?? null, status: o.status, amount: o.amount, productCost: o.productCost, deliveryFee: o.deliveryFee,
      repBonus: o.status === DELIVERED ? (bonuses ? bonusInBranch(bonuses.byOrderId.get(o.id) ?? 0) : null) : 0,
      failedCost: failedByOrder.get(o.id) ?? 0
    };
    if (o.campaignId) orders.set(o.campaignId, [...(orders.get(o.campaignId) ?? []), engineOrder]);
    if (o.productId) byProduct.set(o.productId, [...(byProduct.get(o.productId) ?? []), engineOrder]);
  }
  // Product fallbacks (young campaigns): delivery rate and contribution per delivered order, from mature orders.
  const matureFrom = addDays(today, -ENGINE_RULES.matureToDays), matureTo = addDays(today, -ENGINE_RULES.matureFromDays);
  const productStats = new Map<string, { rate: number | null; perDelivered: number | null }>();
  for (const [productId, list] of byProduct) {
    const mature = list.filter((o) => o.day >= matureFrom && o.day <= matureTo);
    const delivered = mature.filter((o) => o.status === DELIVERED);
    productStats.set(productId, {
      rate: mature.length >= 10 ? delivered.length / mature.length : null,
      perDelivered: delivered.length ? delivered.reduce((sum, o) => sum + o.amount - o.productCost - o.deliveryFee - (o.repBonus ?? 0), 0) / delivered.length : null
    });
  }

  // Spend, Meta purchases and funnel per campaign per day.
  const spend = new Map<string, Map<string, number>>();
  const platform = new Map<string, Map<string, number>>();
  const funnel = new Map<string, { impressions: number; linkClicks: number; landingPageViews: number; spend: number; covered: number }>();
  const weekFrom = addDays(today, -ENGINE_RULES.weekDays), yesterday = addDays(today, -1);
  for (const row of core.data.insights) {
    const amount = Number(row.spend) || 0;
    const days = spend.get(row.campaign_id) ?? new Map<string, number>();
    days.set(row.day, (days.get(row.day) ?? 0) + amount);
    spend.set(row.campaign_id, days);
    if (row.purchases) {
      const p = platform.get(row.campaign_id) ?? new Map<string, number>();
      p.set(row.day, (p.get(row.day) ?? 0) + Number(row.purchases));
      platform.set(row.campaign_id, p);
    }
    if (row.day >= weekFrom && row.day <= yesterday) {
      const f = funnel.get(row.campaign_id) ?? { impressions: 0, linkClicks: 0, landingPageViews: 0, spend: 0, covered: 0 };
      f.spend += amount;
      if (row.impressions !== null && row.impressions !== undefined) { f.impressions += row.impressions; f.covered += amount; }
      f.linkClicks += row.linkClicks ?? 0; f.landingPageViews += row.landingPageViews ?? 0;
      funnel.set(row.campaign_id, f);
    }
  }

  // ⚠️ Only campaigns Meta says are delivering RIGHT NOW (as before): a campaign
  // stays "ACTIVE" with its ads paused. An account Meta did not answer for is
  // left out and named, never guessed. TikTok: spent today.
  const image = new Map(core.data.basics.products.map((p: any) => [p.id, p.image_url ?? null]));
  const unknown = new Set<string>();
  const campaigns: EngineCampaign[] = [];
  for (const row of core.rows) {
    const isTikTok = row.platform !== "meta" || row.campaignId.startsWith(TIKTOK_PREFIX);
    if (isTikTok) { if ((spend.get(row.campaignId)?.get(today) ?? 0) <= 0) continue; }
    else if (row.runningSource !== "live") { unknown.add(row.campaignId); continue; }
    else if (!row.running) continue;
    const stats = row.productId ? productStats.get(row.productId) : undefined;
    const target = core.targets.find((t) => t.productId === row.productId);
    campaigns.push({
      campaignId: row.campaignId, campaignName: row.campaignName, platform: row.platform, accountName: row.accountName,
      productId: row.productId, productName: row.productName, productImage: row.productId ? image.get(row.productId) ?? null : null, running: true,
      target: row.target, targetSource: row.targetSource,
      productDeliveryRate: stats?.rate ?? target?.deliveryRate ?? null, productContributionPerDelivered: stats?.perDelivered ?? null,
      lifetimeSpend: row.spend, lifetimeOrders: row.orders, lifetimeDelivered: row.delivered
    });
  }
  const rows = campaignDecisions({ today, periodDays, campaigns, orders, spend, platform }).map((row) => {
    const f = funnel.get(row.campaignId);
    // Diagnostics only (write-up: never a reason on their own). Shown when Meta's numbers cover the spend.
    const ok = f && f.spend > 0 && f.covered / f.spend >= 0.95;
    return { ...row, funnel: ok ? { impressions: f!.impressions, linkClicks: f!.linkClicks, landingPageViews: f!.landingPageViews, ctr: f!.impressions ? f!.linkClicks / f!.impressions : null, cpc: f!.linkClicks ? f!.spend / f!.linkClicks : null, cpm: f!.impressions ? (f!.spend / f!.impressions) * 1000 : null, conversion: f!.linkClicks ? row.week.orders / f!.linkClicks : null } : null };
  });

  // Whole-page totals and the all-campaign daily table, for the period and the one before.
  const sum = (list: Money[]): Money => list.reduce((acc, m) => ({
    ...acc,
    orders: acc.orders + m.orders, delivered: acc.delivered + m.delivered, pending: acc.pending + m.pending, failed: acc.failed + m.failed,
    deliveredRevenue: acc.deliveredRevenue + m.deliveredRevenue, productCost: acc.productCost + m.productCost, logistics: acc.logistics + m.logistics,
    repBonus: acc.repBonus + m.repBonus, failedCost: acc.failedCost + m.failedCost, grossProfit: acc.grossProfit + m.grossProfit,
    contributionBeforeAds: acc.contributionBeforeAds + m.contributionBeforeAds, adSpend: acc.adSpend + m.adSpend, netContribution: acc.netContribution + m.netContribution,
    expectedFinal: acc.expectedFinal + m.expectedFinal, projectedFromPending: acc.projectedFromPending + m.projectedFromPending,
    bonusesMissing: acc.bonusesMissing || m.bonusesMissing
  }), moneyOf([], 0, { deliveryRate: null, contributionPerDelivered: null }));
  const finish = (m: Money): Money => ({ ...m, deliveryRate: m.orders ? m.delivered / m.orders : null, finalisedRate: m.delivered + m.failed ? m.delivered / (m.delivered + m.failed) : null, costPerOrder: m.orders ? m.adSpend / m.orders : null, costPerDelivered: m.delivered ? m.adSpend / m.delivered : null });
  const totals = finish(sum(rows.map((r) => r.period)));
  const previousTotals = finish(sum(rows.map((r) => r.previous)));
  const periodFrom = addDays(today, -periodDays);
  const daily = Array.from({ length: periodDays }, (_, i) => addDays(periodFrom, i)).map((day) => {
    const cells = rows.map((r) => r.days.find((d) => d.day === day)).filter(Boolean) as CampaignDecisionRow["days"];
    const t = cells.reduce((acc, d) => ({ orders: acc.orders + d.orders, delivered: acc.delivered + d.delivered, pending: acc.pending + d.pending, failed: acc.failed + d.failed, spend: acc.spend + d.spend, revenue: acc.revenue + d.revenue, grossProfit: acc.grossProfit + d.grossProfit, netContribution: acc.netContribution + d.netContribution }), { orders: 0, delivered: 0, pending: 0, failed: 0, spend: 0, revenue: 0, grossProfit: 0, netContribution: 0 });
    return { day, ...t, deliveryRate: t.orders ? t.delivered / t.orders : null };
  });

  return {
    today, periodDays, currency, rules: ENGINE_RULES, rows, totals, previousTotals, daily,
    bonusesPartial: bonuses === null || bonuses.rulesUnavailable,
    unchecked: unknown.size, uncheckedAccounts: core.liveFailures.map((f) => ({ name: f.name, message: f.message })),
    linkedShare: core.linkedShare
  };
}

/** Orders of one campaign placed on one day (the detail view's daily rows open to these). */
export async function campaignDayOrders(orgId: string, branchId: string, campaignId: string, day: string) {
  const { data, error } = await supabase.from("orders")
    .select("id, created_at, customer, state, status, amount, product_name, package_name, delivered_date, form_context, utm_campaign")
    .eq("org_id", orgId).eq("branch_id", branchId)
    .gte("created_at", `${addDays(day, -1)}T23:00:00.000Z`).lt("created_at", `${day}T23:00:00.000Z`)
    .limit(2000);
  if (error) throw error;
  const isId = (v: unknown) => typeof v === "string" && v.trim() === campaignId;
  return ((data ?? []) as any[]).filter((o) => {
    const c = o.form_context ?? {};
    return [c.campaignId, c.campaign_id, c.utmId, o.utm_campaign].some(isId) || [c.campaignId, c.campaign_id, c.utmId, o.utm_campaign].some((v) => typeof v === "string" && `${TIKTOK_PREFIX}${v.trim()}` === campaignId);
  }).map((o) => ({ id: String(o.id), customer: o.customer ?? "", state: o.state ?? "", status: o.status ?? "", amount: Number(o.amount) || 0, product: o.package_name || o.product_name || "", deliveredDay: o.delivered_date ? String(o.delivered_date).slice(0, 10) : null }));
}
