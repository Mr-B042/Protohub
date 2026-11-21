// Campaign Decisions engine (Bright, 21 Nov 2026: "ProtoHub Campaign Decisions
// — Complete Logic & Rating System"). Pure: no database, no Meta.
//
// Three parts, as the write-up asks:
//   1. PROFITABILITY: real money from DELIVERED orders (revenue, product cost,
//      delivery, rep bonus, failed-delivery fees, ad spend) and, kept apart, a
//      PROJECTED figure for orders still pending. Pending orders are never
//      counted as sales.
//   2. RATING: a 0-100 score from six weighted parts, each scaled smoothly.
//   3. DECISION: scale / keep / watch / pause / turn off, with a confidence
//      level, from the rules below. The score advises; the rules decide.
//
// Bright's choices (21 Nov 2026): costs = product + delivery + rep bonus +
// failed deliveries; these rules REPLACE campaign-verdict.ts everywhere
// (page, alerts, Telegram).
//
// ⚠️ THE DECISION NEVER DEPENDS ON THE PAGE'S PERIOD PICKER. It always reads
// the last 3 and 7 full days, orders old enough to judge delivery (placed
// 7-37 days ago) and the campaign's whole life, so the page, the alerts and
// Telegram say the same thing. The picker only changes the money columns.

export const ENGINE_RULES = {
  fallbackTarget: 7_500,
  recentDays: 3, weekDays: 7,
  /** Orders placed this long ago or more have had time to be delivered. */
  matureFromDays: 7, matureToDays: 37, matureMinOrders: 5,
  /** Delivery rate a campaign must hold to be scaled (write-up: 70%). */
  scaleDeliveryRate: 0.7,
  scaleCpoAtMost: 0.7, watchCpoFrom: 0.8, pauseCpoFrom: 1.3,
  /** Orders in 7 days before a campaign may be scaled (small samples are blocked). */
  scaleMinOrders: 10,
  pauseNoOrderTimes: 1.5, escalateNoOrderTimes: 2,
  /** A dry spell only counts when it is this many of the campaign's own normal cost per order (not "a few hours"). */
  dryNormalTimes: 3,
  confidenceMedium: 10, confidenceHigh: 30,
  /** Delivery-rate drop (points) between older and newer mature orders that counts as declining. */
  deliveryDropPoints: 0.1
};

export type Decision = "scale" | "keep" | "watch" | "pause" | "turn_off";
export const DECISION_ORDER: Decision[] = ["turn_off", "pause", "watch", "scale", "keep"];
export type Confidence = "high" | "medium" | "low";
export type Rating = "Excellent" | "Very Good" | "Good" | "Average" | "Poor" | "Critical";

export type EngineOrder = {
  id: string;
  /** Day placed (Lagos). */
  day: string;
  deliveredDay: string | null;
  status: string;
  amount: number; productCost: number; deliveryFee: number;
  /** Naira rep bonus on a delivered order (null = could not be read). */
  repBonus: number | null;
  /** Failed-delivery fee booked for this order (0 = none). */
  failedCost: number;
};

export type EngineCampaign = {
  campaignId: string; campaignName: string; platform: string; accountName: string;
  productId: string | null; productName: string | null; productImage: string | null;
  running: boolean;
  /** Break-even cost per placed order (null = not known). */
  target: number | null; targetSource: "worked_out" | "set_by_you" | "mixed" | null;
  /** The product's delivery rate and contribution per delivered order (fallbacks for young campaigns). */
  productDeliveryRate: number | null; productContributionPerDelivered: number | null;
  /** Since it started. */
  lifetimeSpend: number; lifetimeOrders: number; lifetimeDelivered: number;
};

export const DELIVERED = "Delivered";
const FAILED = new Set(["Failed", "Rejected", "Returned", "Cancelled"]);
export const outcomeOf = (status: string): "delivered" | "failed" | "pending" => status === DELIVERED ? "delivered" : FAILED.has(status) ? "failed" : "pending";

export const addDays = (day: string, n: number) => { const d = new Date(`${day}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const ngn = (value: number) => `${value < 0 ? "−" : ""}₦${Math.abs(Math.round(value)).toLocaleString("en-NG")}`;
const pct = (value: number) => `${Math.round(value * 100)}%`;
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
/** 0 at `bad`, 1 at `good`, straight line between (either direction). */
const scale = (x: number, bad: number, good: number) => clamp01((x - bad) / (good - bad));

// ------------------------------------------------------------ 1. money

export type Money = {
  orders: number; delivered: number; pending: number; failed: number;
  deliveredRevenue: number; productCost: number; logistics: number; repBonus: number; failedCost: number;
  grossProfit: number; contributionBeforeAds: number; adSpend: number; netContribution: number;
  /** Projected: net contribution once pending orders settle at the expected delivery rate. */
  expectedFinal: number; projectedFromPending: number;
  /** Orders placed in the window ÷ delivered so far (young windows read low). */
  deliveryRate: number | null;
  /** Delivered ÷ (delivered + failed): settled orders only. */
  finalisedRate: number | null;
  costPerOrder: number | null; costPerDelivered: number | null;
  /** A delivered order's rep bonus could not be read: contribution is then too high. */
  bonusesMissing: boolean;
};

export function moneyOf(orders: EngineOrder[], adSpend: number, expect: { deliveryRate: number | null; contributionPerDelivered: number | null }): Money {
  let delivered = 0, pending = 0, failed = 0, revenue = 0, cost = 0, logistics = 0, bonus = 0, failedCost = 0, missing = false;
  for (const order of orders) {
    const outcome = outcomeOf(order.status);
    failedCost += order.failedCost || 0;
    if (outcome === "pending") { pending += 1; continue; }
    if (outcome === "failed") { failed += 1; continue; }
    delivered += 1;
    revenue += order.amount; cost += order.productCost; logistics += order.deliveryFee;
    if (order.repBonus === null) missing = true; else bonus += order.repBonus;
  }
  const grossProfit = revenue - cost;
  const contributionBeforeAds = grossProfit - logistics - bonus - failedCost;
  const netContribution = contributionBeforeAds - adSpend;
  // Projection: pending orders at the expected delivery rate and contribution
  // per delivered order (own, once there are 3+ deliveries; else the product's).
  const own = delivered >= 3 ? (contributionBeforeAds + failedCost) / delivered : null;
  const perDelivered = own ?? expect.contributionPerDelivered;
  const avgFailedCost = failed > 0 ? failedCost / failed : 0;
  const rate = expect.deliveryRate;
  const projectedFromPending = pending > 0 && rate !== null && perDelivered !== null
    ? pending * rate * perDelivered - pending * (1 - rate) * avgFailedCost : 0;
  return {
    orders: orders.length, delivered, pending, failed,
    deliveredRevenue: revenue, productCost: cost, logistics, repBonus: bonus, failedCost,
    grossProfit, contributionBeforeAds, adSpend, netContribution,
    expectedFinal: netContribution + projectedFromPending, projectedFromPending,
    deliveryRate: orders.length ? delivered / orders.length : null,
    finalisedRate: delivered + failed ? delivered / (delivered + failed) : null,
    costPerOrder: orders.length ? adSpend / orders.length : null,
    costPerDelivered: delivered ? adSpend / delivered : null,
    bonusesMissing: missing
  };
}

// ------------------------------------------------------------ 2. rating

export type ScorePart = { key: "net" | "delivery" | "cpp" | "recent" | "volume" | "safety"; label: string; max: number; points: number; note: string };

export function ratingOf(score: number): Rating {
  return score >= 90 ? "Excellent" : score >= 80 ? "Very Good" : score >= 70 ? "Good" : score >= 60 ? "Average" : score >= 40 ? "Poor" : "Critical";
}

export function deliveryHealth(rate: number | null): string | null {
  if (rate === null) return null;
  return rate >= 0.8 ? "Excellent" : rate >= 0.7 ? "Healthy" : rate >= 0.6 ? "Needs improvement" : rate >= 0.5 ? "Poor" : "Critical";
}

export function scoreOf(m: {
  week: Money; target: number; targetKnown: boolean; matureRate: number | null;
  recentCpo: number | null; priorCpo: number | null; recentSpend: number; trackingOk: boolean;
}): { score: number; parts: ScorePart[] } {
  const parts: ScorePart[] = [];
  const add = (key: ScorePart["key"], label: string, max: number, share: number, note: string) =>
    parts.push({ key, label, max, points: Math.round(max * clamp01(share) * 10) / 10, note });
  // Net contribution (30): expected contribution after ads per naira of ads. −50% → 0, break even → 1/3, ≥ +100% → full.
  const ret = m.week.adSpend > 0 ? m.week.expectedFinal / m.week.adSpend : m.week.expectedFinal > 0 ? 1 : 0;
  add("net", "Net contribution", 30, ret <= 0 ? scale(ret, -0.5, 0) / 3 : 1 / 3 + (2 / 3) * scale(ret, 0, 1), m.week.adSpend > 0 ? `${ngn(m.week.expectedFinal)} expected after ${ngn(m.week.adSpend)} ads (7 days)` : "No ad spend in 7 days");
  // Delivery rate (20): mature cohort, 40% → 0, 80% → full. Unknown = half.
  add("delivery", "Delivery rate", 20, m.matureRate === null ? 0.5 : scale(m.matureRate, 0.4, 0.8), m.matureRate === null ? "Not enough old orders yet" : `${pct(m.matureRate)} of orders old enough to judge`);
  // Cost per order (15): 7-day cost per order ÷ break-even, 130% → 0, 50% → full.
  const cppRatio = m.week.costPerOrder !== null ? m.week.costPerOrder / m.target : null;
  add("cpp", "Cost per order", 15, cppRatio === null ? 0 : scale(cppRatio, 1.3, 0.5), cppRatio === null ? "No order in 7 days" : `${ngn(m.week.costPerOrder!)} an order, ${pct(cppRatio)} of break-even${m.targetKnown ? "" : " (break-even not known)"}`);
  // Recent performance (15): last 3 days vs the 4 before. Cheaper = better.
  let recentShare = 0.55, recentNote = "Not enough days to compare";
  if (m.recentCpo === null) { recentShare = m.recentSpend > 0 ? 0 : 0.5; recentNote = m.recentSpend > 0 ? "No order in the last 3 days" : "Not running the last 3 days"; }
  else if (m.priorCpo !== null) {
    const r = m.priorCpo / m.recentCpo; // > 1 = improving
    recentShare = r >= 1 ? 2 / 3 + (1 / 3) * scale(r, 1, 1.25) : (2 / 3) * scale(r, 0.6, 1);
    recentNote = r >= 1.05 ? `Improving: ${ngn(m.recentCpo)} vs ${ngn(m.priorCpo)} an order before` : r <= 0.95 ? `Getting dearer: ${ngn(m.recentCpo)} vs ${ngn(m.priorCpo)} an order before` : "Steady";
  }
  add("recent", "Recent performance", 15, recentShare, recentNote);
  // Order volume & reliability (10): 7 of it for orders (30+ = full), 3 for tracking working.
  const vol = (7 * scale(m.week.orders, 0, 30) + (m.trackingOk ? 3 : 0)) / 10;
  add("volume", "Order volume & reliability", 10, vol, `${m.week.orders} order${m.week.orders === 1 ? "" : "s"} in 7 days${m.trackingOk ? "" : ", tracking in doubt"}`);
  // Break-even safety (10): room left under break-even, 0 → 0, 50%+ → full.
  add("safety", "Break-even safety", 10, cppRatio === null ? 0 : scale(1 - cppRatio, 0, 0.5), cppRatio === null ? "—" : cppRatio < 1 ? `${pct(1 - cppRatio)} room under break-even` : `${pct(cppRatio - 1)} over break-even`);
  return { score: Math.round(parts.reduce((sum, p) => sum + p.points, 0)), parts };
}

// ------------------------------------------------------------ 3. decision

export type DecisionResult = {
  decision: Decision; confidence: Confidence; collectMoreData: boolean; escalate: boolean;
  /** Short label ("Scale gradually", "Keep — collect more data", "Pause & check"). */
  label: string;
  why: string; action: string; monitor: string; reconsider: string;
  /** Budget change to try (scale only). */
  budgetChangePct: number | null;
  /** Plain-English cards. */
  goingWell: string[]; goingWrong: string[];
  /** Same campaign, same situation: alert once. */
  episodeKey: string;
};

export type EngineDay = { day: string; spend: number; orders: number; delivered: number; pending: number; failed: number; revenue: number; grossProfit: number; netContribution: number; platformPurchases: number };

export type CampaignDecisionRow = EngineCampaign & {
  target: number; targetKnown: boolean;
  /** The page's period. */
  period: Money; previous: Money;
  /** Fixed decision basis. */
  week: Money; recentSpend: number; recentOrders: number; recentCpo: number | null; priorCpo: number | null;
  lifetimeCpo: number | null; spendSinceLastOrder: number; lastOrderDay: string | null; todaySpend: number; todayOrders: number;
  matureRate: number | null; matureOrders: number; matureRateSource: "campaign" | "product" | null;
  deliveryTrend: { older: number; newer: number } | null;
  deliveryHealth: string | null;
  score: number; rating: Rating; scoreParts: ScorePart[];
  /** Order-date view: last 14 full days + today, and the page's period days. */
  days: EngineDay[];
  /** Delivery-date view: deliveries recorded each day (any placement date). */
  deliveryDays: Array<{ day: string; delivered: number; revenue: number; contribution: number }>;
} & DecisionResult;

function spendOver(days: Map<string, number>, from: string, to: string) {
  let sum = 0;
  for (const [day, value] of days) if (day >= from && day <= to) sum += value;
  return sum;
}

export function campaignDecisions(input: {
  today: string;
  /** The page's period: this many full days ending yesterday (and the same before it). */
  periodDays: number;
  campaigns: EngineCampaign[];
  orders: Map<string, EngineOrder[]>;
  spend: Map<string, Map<string, number>>;
  /** Meta's own purchases per campaign per day (tracking check). */
  platform?: Map<string, Map<string, number>>;
}): CampaignDecisionRow[] {
  const R = ENGINE_RULES;
  const { today } = input;
  const yesterday = addDays(today, -1);
  const out: CampaignDecisionRow[] = [];
  for (const c of input.campaigns) {
    if (!c.running) continue;
    const days = input.spend.get(c.campaignId) ?? new Map<string, number>();
    const orders = input.orders.get(c.campaignId) ?? [];
    const todaySpend = days.get(today) ?? 0;
    const recentFrom = addDays(today, -R.recentDays), weekFrom = addDays(today, -R.weekDays);
    const recentSpend = spendOver(days, recentFrom, yesterday);
    if (recentSpend + todaySpend <= 0) continue; // idle: nothing to decide
    const T = c.target && c.target > 0 ? c.target : R.fallbackTarget;
    const known = Boolean(c.target && c.target > 0);

    // Delivery: own mature orders, else the product's.
    const mature = orders.filter((o) => o.day >= addDays(today, -R.matureToDays) && o.day <= addDays(today, -R.matureFromDays));
    const ownRate = mature.length >= R.matureMinOrders ? mature.filter((o) => o.status === DELIVERED).length / mature.length : null;
    const matureRate = ownRate ?? c.productDeliveryRate;
    const matureRateSource = ownRate !== null ? "campaign" as const : c.productDeliveryRate !== null ? "product" as const : null;
    const half = addDays(today, -22);
    const older = mature.filter((o) => o.day < half), newer = mature.filter((o) => o.day >= half);
    const deliveryTrend = older.length >= 8 && newer.length >= 8
      ? { older: older.filter((o) => o.status === DELIVERED).length / older.length, newer: newer.filter((o) => o.status === DELIVERED).length / newer.length } : null;
    const expect = { deliveryRate: matureRate, contributionPerDelivered: c.productContributionPerDelivered };

    const inRange = (from: string, to: string) => orders.filter((o) => o.day >= from && o.day <= to);
    const week = moneyOf(inRange(weekFrom, yesterday), spendOver(days, weekFrom, yesterday), expect);
    const recentOrders = inRange(recentFrom, yesterday).length;
    const recentCpo = recentOrders ? recentSpend / recentOrders : null;
    const priorFrom = weekFrom, priorTo = addDays(recentFrom, -1);
    const priorOrders = inRange(priorFrom, priorTo).length;
    const priorCpo = priorOrders ? spendOver(days, priorFrom, priorTo) / priorOrders : null;
    const lifetimeSpend = Math.max(c.lifetimeSpend, [...days.values()].reduce((a, b) => a + b, 0));
    const lifetimeCpo = c.lifetimeOrders > 0 ? lifetimeSpend / c.lifetimeOrders : null;

    const periodFrom = addDays(today, -input.periodDays), prevFrom = addDays(periodFrom, -input.periodDays);
    const period = moneyOf(inRange(periodFrom, yesterday), spendOver(days, periodFrom, yesterday), expect);
    const previous = moneyOf(inRange(prevFrom, addDays(periodFrom, -1)), spendOver(days, prevFrom, addDays(periodFrom, -1)), expect);

    // Dry spell: spent since the last order (today included).
    const lastOrderDay = orders.reduce<string | null>((last, o) => (!last || o.day > last ? o.day : last), null);
    const firstSpent = [...days.entries()].filter(([, s]) => s > 0).map(([d]) => d).sort()[0] ?? null;
    const dryFrom = lastOrderDay ? addDays(lastOrderDay, 1) : firstSpent;
    const spendSinceLastOrder = dryFrom ? spendOver(days, dryFrom, today) : 0;
    const normalCpo = week.costPerOrder ?? lifetimeCpo;
    // "Not just a few hours without orders": the spell must also be several of its own normal orders' worth.
    const longDry = (times: number) => spendSinceLastOrder >= T * times && (normalCpo === null || spendSinceLastOrder >= normalCpo * R.dryNormalTimes);
    const platformSince = dryFrom ? spendOver(input.platform?.get(c.campaignId) ?? new Map(), dryFrom, today) : 0;
    const trackingIssue = spendSinceLastOrder >= T && platformSince > 0;

    const evidence = week.orders + mature.length;
    const stable = recentCpo !== null && priorCpo !== null ? Math.abs(recentCpo - priorCpo) / priorCpo <= 0.3 : false;
    let confidence: Confidence = evidence >= R.confidenceHigh && mature.length >= 10 && !trackingIssue && stable ? "high" : week.orders >= R.confidenceMedium || evidence >= R.confidenceHigh ? "medium" : "low";
    if (!known && confidence === "high") confidence = "medium";

    const { score, parts } = scoreOf({ week, target: T, targetKnown: known, matureRate, recentCpo, priorCpo, recentSpend, trackingOk: !trackingIssue });
    const decided = decide({
      c, T, known, week, recentSpend, recentOrders, recentCpo, priorCpo, lifetimeCpo, spendSinceLastOrder, lastOrderDay, dryFrom,
      longDry, trackingIssue, platformSince, matureRate, matureOrders: mature.length, deliveryTrend, confidence, score, today
    });

    // Order-date view: last 14 full days + today (and the period, if longer).
    const span = Math.max(14, input.periodDays);
    const platformDays = input.platform?.get(c.campaignId) ?? new Map<string, number>();
    const dayRows: EngineDay[] = [];
    for (let i = span; i >= 0; i -= 1) {
      const day = addDays(today, -i);
      const m = moneyOf(orders.filter((o) => o.day === day), days.get(day) ?? 0, expect);
      dayRows.push({ day, spend: m.adSpend, orders: m.orders, delivered: m.delivered, pending: m.pending, failed: m.failed, revenue: m.deliveredRevenue, grossProfit: m.grossProfit, netContribution: m.netContribution, platformPurchases: platformDays.get(day) ?? 0 });
    }
    const byDelivery = new Map<string, { delivered: number; revenue: number; contribution: number }>();
    for (const o of orders) {
      if (o.status !== DELIVERED || !o.deliveredDay || o.deliveredDay < addDays(today, -span)) continue;
      const cell = byDelivery.get(o.deliveredDay) ?? { delivered: 0, revenue: 0, contribution: 0 };
      cell.delivered += 1; cell.revenue += o.amount;
      cell.contribution += o.amount - o.productCost - o.deliveryFee - (o.repBonus ?? 0);
      byDelivery.set(o.deliveredDay, cell);
    }

    out.push({
      ...c, target: T, targetKnown: known, lifetimeSpend,
      period, previous, week, recentSpend, recentOrders, recentCpo, priorCpo, lifetimeCpo,
      spendSinceLastOrder, lastOrderDay, todaySpend, todayOrders: orders.filter((o) => o.day === today).length,
      matureRate, matureOrders: mature.length, matureRateSource, deliveryTrend, deliveryHealth: deliveryHealth(matureRate),
      score, rating: ratingOf(score), scoreParts: parts,
      days: dayRows, deliveryDays: [...byDelivery.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, v]) => ({ day, ...v })),
      ...decided
    });
  }
  return out.sort((a, b) => DECISION_ORDER.indexOf(a.decision) - DECISION_ORDER.indexOf(b.decision) || b.period.netContribution - a.period.netContribution);
}

function decide(x: {
  c: EngineCampaign; T: number; known: boolean; week: Money;
  recentSpend: number; recentOrders: number; recentCpo: number | null; priorCpo: number | null; lifetimeCpo: number | null;
  spendSinceLastOrder: number; lastOrderDay: string | null; dryFrom: string | null; longDry: (times: number) => boolean;
  trackingIssue: boolean; platformSince: number; matureRate: number | null; matureOrders: number;
  deliveryTrend: { older: number; newer: number } | null; confidence: Confidence; score: number; today: string;
}): DecisionResult {
  const R = ENGINE_RULES;
  const be = `${ngn(x.T)}${x.known ? "" : " (break-even not worked out yet, ₦7,500 used)"}`;
  const since = x.lastOrderDay ? "since the last order" : "since it started spending";
  const spell = `${x.c.campaignId}:${x.dryFrom ?? "start"}`;
  const yesterday = addDays(x.today, -1);
  const expectedNeg = x.week.expectedFinal < 0;
  const declining = x.deliveryTrend !== null && x.deliveryTrend.older - x.deliveryTrend.newer >= R.deliveryDropPoints;
  const lowSample = x.confidence === "low";

  // Plain-English cards, from the numbers.
  const well: string[] = [], wrong: string[] = [];
  if (x.week.costPerOrder !== null && x.week.costPerOrder <= x.T) well.push(`Orders cost ${ngn(x.week.costPerOrder)} each over 7 days, under the ${ngn(x.T)} it can afford.`);
  if (x.week.expectedFinal > 0) well.push(`Expected to keep ${ngn(x.week.expectedFinal)} after ads from the last 7 days' orders${x.week.pending ? ` (${x.week.pending} still pending)` : ""}.`);
  if (x.matureRate !== null && x.matureRate >= 0.7) well.push(`${pct(x.matureRate)} of older orders were delivered: healthy.`);
  if (x.recentCpo !== null && x.priorCpo !== null && x.recentCpo < x.priorCpo * 0.95) well.push(`Getting cheaper: ${ngn(x.recentCpo)} an order in the last 3 days vs ${ngn(x.priorCpo)} before.`);
  if (x.week.costPerOrder !== null && x.week.costPerOrder > x.T) wrong.push(`Orders cost ${ngn(x.week.costPerOrder)} each over 7 days, above the ${ngn(x.T)} it can afford.`);
  if (expectedNeg) wrong.push(`Expected to lose ${ngn(-x.week.expectedFinal)} after ads on the last 7 days' orders.`);
  // Low delivery alone never decides (write-up: a 55% campaign can still make money); it is in the money, the score and here.
  if (x.matureRate !== null && x.matureRate < 0.6) wrong.push(`Only ${pct(x.matureRate)} of older orders were delivered.`);
  if (declining) wrong.push(`Delivery fell from ${pct(x.deliveryTrend!.older)} to ${pct(x.deliveryTrend!.newer)} on newer orders.`);
  if (x.recentCpo !== null && x.priorCpo !== null && x.recentCpo > x.priorCpo * 1.3) wrong.push(`Getting dearer: ${ngn(x.recentCpo)} an order in the last 3 days vs ${ngn(x.priorCpo)} before.`);
  if (x.spendSinceLastOrder >= x.T) wrong.push(`${ngn(x.spendSinceLastOrder)} spent ${since} with no order.`);
  if (x.trackingIssue) wrong.push(`Meta counts ${x.platformSince} purchase${x.platformSince === 1 ? "" : "s"} ${since} that never reached Protohub.`);
  if (x.week.bonusesMissing) wrong.push("Some rep bonuses could not be read, so contribution reads a little high.");
  if (lowSample) wrong.push(`Only ${x.week.orders} order${x.week.orders === 1 ? "" : "s"} in 7 days: too few to be sure.`);

  const base = { goingWell: well, goingWrong: wrong, budgetChangePct: null as number | null, escalate: false, collectMoreData: false };
  const result = (decision: Decision, label: string, why: string, action: string, monitor: string, reconsider: string, key: string, extra: Partial<DecisionResult> = {}): DecisionResult =>
    ({ ...base, decision, confidence: x.confidence, label, why, action, monitor, reconsider, episodeKey: key, ...extra });

  if (x.trackingIssue) {
    return result("pause", "Pause & check tracking", `Meta reports ${x.platformSince} purchase${x.platformSince === 1 ? "" : "s"} ${since}, but none reached Protohub with this campaign on it. ${ngn(x.spendSinceLastOrder)} spent meanwhile.`,
      "Check tracking before deciding: the form link must carry the campaign, and orders must come through Protohub's form. Don't turn it off on missing data.",
      "Whether new orders arrive with this campaign on them.", "As soon as orders link again.", `${spell}:tracking`);
  }
  if (x.longDry(R.escalateNoOrderTimes)) {
    return result("pause", "Pause & escalate", `${ngn(x.spendSinceLastOrder)} spent ${since} with no order: ${(x.spendSinceLastOrder / x.T).toFixed(1)}× its break-even of ${be}, and several times what an order normally costs it.`,
      "Pause now and review today: ad approved and delivering, the form link, the offer and price, stock. Only turn it off if the check finds nothing and losses are sustained.",
      "Orders after restarting.", "Restart once the cause is found and fixed.", `${spell}:escalate`, { escalate: true });
  }
  const recentAbove = (x.recentCpo !== null && x.recentCpo > x.T) || (x.recentOrders === 0 && x.recentSpend >= x.T);
  if (x.confidence !== "low" && expectedNeg && recentAbove && x.lifetimeCpo !== null && x.lifetimeCpo > x.T) {
    return result("turn_off", "Turn off", `Losing money and not improving: expected ${ngn(x.week.expectedFinal)} after ads over 7 days (${x.week.orders} orders), ${x.recentCpo !== null ? `${ngn(x.recentCpo)} an order lately` : "no order lately"} and ${ngn(x.lifetimeCpo)} since it started, against a break-even of ${be}.`,
      "Turn it off and build a new test (new creative, offer or audience).", "—", "Only with a new test.", `${x.c.campaignId}:off-${yesterday}`);
  }
  if (x.longDry(R.pauseNoOrderTimes)) {
    return result("pause", "Pause & check", `${ngn(x.spendSinceLastOrder)} spent ${since} with no order: ${(x.spendSinceLastOrder / x.T).toFixed(1)}× its break-even of ${be}.`,
      "Pause and check before more money goes: ad approved and delivering, the form link, the offer and price, stock.",
      "Spend with no order.", `Escalate at ${ngn(x.T * R.escalateNoOrderTimes)} with no order.`, `${spell}:pause`);
  }
  if (x.recentCpo !== null && x.recentOrders >= 3 && x.recentCpo >= x.T * R.pauseCpoFrom) {
    return result("pause", "Pause & check", `${ngn(x.recentCpo)} an order over the last 3 full days (${x.recentOrders} orders), ${pct(x.recentCpo / x.T)} of its break-even of ${be}.`,
      "Pause and find what changed: creative fatigue, audience, offer, competitor prices.", "Cost per order after restarting.", "When cost per order is back under break-even.", `${x.c.campaignId}:pause-cpo-${yesterday}`);
  }
  if (expectedNeg && x.week.orders >= 5) {
    return result("pause", "Pause & check", `Expected to lose ${ngn(-x.week.expectedFinal)} after ads on the last 7 days' ${x.week.orders} orders, counting deliveries still to come.`,
      "Pause and check cost per order and delivery before spending more.", "Delivery rate and cost per order.", "When expected contribution turns positive.", `${x.c.campaignId}:pause-neg-${yesterday}`);
  }
  if (x.matureRate !== null && x.matureOrders >= 10 && x.matureRate < 0.5) {
    return result("pause", "Pause & check delivery", `Only ${pct(x.matureRate)} of ${x.matureOrders} older orders were delivered.`,
      "Pause and look at delivery: which agents, states or customers fail, before spending more.", "Delivery rate of new orders.", "When delivery is back above 60%.", `${x.c.campaignId}:pause-dr-${yesterday}`);
  }
  const watchWhy =
    x.recentCpo !== null && x.recentCpo >= x.T * R.watchCpoFrom ? `${ngn(x.recentCpo)} an order over the last 3 full days, ${pct(x.recentCpo / x.T)} of its break-even of ${be}.`
    : x.spendSinceLastOrder >= x.T ? `${ngn(x.spendSinceLastOrder)} spent ${since} with no order, more than its break-even of ${be}.`
    : declining ? `Delivery is slipping: ${pct(x.deliveryTrend!.older)} → ${pct(x.deliveryTrend!.newer)} on newer orders.`
    : x.recentCpo !== null && x.priorCpo !== null && x.recentCpo > x.priorCpo * 1.3 ? `Getting dearer: ${ngn(x.recentCpo)} an order lately vs ${ngn(x.priorCpo)} before.`
    : null;
  if (watchWhy) {
    return result("watch", "Watch", watchWhy, "Don't raise the budget. Find the cause and review after 1-2 more days of orders.",
      "Cost per order against break-even, and delivery of new orders.", "If cost per order passes break-even or delivery keeps falling, pause.", `${x.c.campaignId}:watch-${yesterday}`);
  }
  const canScale = x.known && x.recentCpo !== null && x.recentCpo <= x.T * R.scaleCpoAtMost
    && x.week.costPerOrder !== null && x.week.costPerOrder <= x.T * R.scaleCpoAtMost
    && x.week.expectedFinal > 0 && x.matureRate !== null && x.matureRate >= R.scaleDeliveryRate;
  if (canScale && x.week.orders >= R.scaleMinOrders && x.confidence !== "low") {
    const bump = x.score >= 90 && x.confidence === "high" ? 20 : x.score >= 80 ? 15 : 10;
    return result("scale", "Scale gradually", `${ngn(x.week.costPerOrder!)} an order over 7 days (${x.week.orders} orders), ${pct(x.week.costPerOrder! / x.T)} of break-even ${be}; ${pct(x.matureRate!)} of older orders delivered; ${ngn(x.week.expectedFinal)} expected after ads.`,
      `Raise the budget by ${bump}%, then reassess after 2-3 days of new orders.`, "Cost per order, delivery of new orders and expected contribution after the increase.",
      "If cost per order nears break-even, delivery drops, or expected contribution turns negative.", `${x.c.campaignId}:scale-${yesterday}`, { budgetChangePct: bump });
  }
  if (canScale || lowSample) {
    return result("keep", "Keep — collect more data", canScale ? `Looks strong (${ngn(x.recentCpo!)} an order lately, ${pct(x.recentCpo! / x.T)} of break-even) but only ${x.week.orders} order${x.week.orders === 1 ? "" : "s"} in 7 days: too few to scale on.` : `Only ${x.week.orders} order${x.week.orders === 1 ? "" : "s"} in 7 days: too few to judge yet.`,
      "Keep the budget as it is until more orders arrive.", `Orders: scaling needs ${R.scaleMinOrders}+ in 7 days.`, `With ${R.scaleMinOrders}+ orders in 7 days.`, `${x.c.campaignId}:keep`, { collectMoreData: true });
  }
  return result("keep", "Keep running", x.week.costPerOrder !== null ? `${ngn(x.week.costPerOrder)} an order over 7 days, under its break-even of ${be}${x.week.expectedFinal > 0 ? `, ${ngn(x.week.expectedFinal)} expected after ads` : ""}.` : `Under its break-even of ${be} so far.`,
    "Keep the current budget.", "Orders, deliveries and contribution.", "Scale when it holds under 70% of break-even with 70%+ delivery.", `${x.c.campaignId}:keep`);
}
