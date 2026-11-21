import assert from "node:assert/strict";
import test from "node:test";
import { addDays, campaignDecisions, moneyOf, ratingOf, type EngineCampaign, type EngineOrder } from "./campaign-engine.js";

const today = "2026-11-21";
const day = (back: number) => addDays(today, -back);
const campaign = (over: Partial<EngineCampaign> = {}): EngineCampaign => ({
  campaignId: "c", campaignName: "C", platform: "meta", accountName: "A", productId: "p", productName: "Shelf", productImage: null, running: true,
  target: 10_000, targetSource: "worked_out", productDeliveryRate: 0.7, productContributionPerDelivered: 18_000,
  lifetimeSpend: 0, lifetimeOrders: 0, lifetimeDelivered: 0, ...over
});
let n = 0;
const order = (back: number, status: string, over: Partial<EngineOrder> = {}): EngineOrder => ({
  id: `o${n++}`, day: day(back), deliveredDay: status === "Delivered" ? day(Math.max(0, back - 2)) : null, status,
  amount: 39_500, productCost: 15_000, deliveryFee: 6_000, repBonus: 500, failedCost: 0, ...over
});
/** `perDay` orders a day over `days` days back from yesterday, every 3rd one still pending, mature ones 80% delivered. */
const steadyOrders = (perDay: number, days: number) => {
  const out: EngineOrder[] = [];
  for (let b = 1; b <= days; b += 1) for (let i = 0; i < perDay; i += 1) {
    const mature = b >= 7;
    out.push(order(b, mature ? (i % 5 === 4 ? "Failed" : "Delivered") : i % 3 === 0 ? "Confirmed" : "Delivered"));
  }
  return out;
};
const spendDays = (amount: number, days: number, withToday = true) => new Map([...Array.from({ length: days }, (_, i) => [day(i + 1), amount] as [string, number]), ...(withToday ? [[today, amount / 2] as [string, number]] : [])]);
const run = (c: EngineCampaign, orders: EngineOrder[], spend: Map<string, number>, platform?: Map<string, number>) =>
  campaignDecisions({ today, periodDays: 3, campaigns: [c], orders: new Map([[c.campaignId, orders]]), spend: new Map([[c.campaignId, spend]]), platform: platform ? new Map([[c.campaignId, platform]]) : undefined })[0];

test("money counts delivered orders only; pending is projected apart", () => {
  const m = moneyOf([order(1, "Delivered"), order(1, "Delivered"), order(1, "Failed", { failedCost: 1_500 }), order(1, "Confirmed")], 20_000, { deliveryRate: 0.5, contributionPerDelivered: 18_000 });
  assert.equal(m.deliveredRevenue, 79_000);
  assert.equal(m.grossProfit, 49_000);              // 79,000 − 30,000
  assert.equal(m.contributionBeforeAds, 34_500);    // − 12,000 delivery − 1,000 bonus − 1,500 failed
  assert.equal(m.netContribution, 14_500);
  assert.equal(m.pending, 1);
  // Pending projected at the product's 18,000 (fewer than 3 own deliveries) × 50%, minus 50% × the 1,500 failed fee.
  assert.equal(m.projectedFromPending, 0.5 * 18_000 - 0.5 * 1_500);
  assert.equal(m.expectedFinal, 14_500 + 8_250);
  assert.equal(m.costPerOrder, 5_000);
  assert.equal(m.finalisedRate, 2 / 3);
});

test("steady, cheap, well delivered, enough orders: scale gradually", () => {
  const row = run(campaign(), steadyOrders(3, 30), spendDays(9_000, 30), undefined);
  assert.equal(row.decision, "scale");
  assert.equal(row.week.costPerOrder, 3_000);
  assert.ok(row.matureRate! >= 0.7);
  assert.ok(row.budgetChangePct! >= 10);
  assert.ok(row.score >= 70 && row.score <= 100, `score ${row.score}`);
  assert.equal(row.rating, ratingOf(row.score));
  assert.equal(row.scoreParts.reduce((s, p) => s + p.max, 0), 100);
});

test("looks great but too few orders: keep and collect more data, never scale", () => {
  const row = run(campaign(), steadyOrders(1, 5), spendDays(1_500, 5));
  assert.equal(row.decision, "keep");
  assert.equal(row.collectMoreData, true);
  assert.equal(row.confidence, "low");
});

test("2× break-even with no order is escalated for review, not turned off", () => {
  const orders = [order(9, "Delivered"), order(10, "Delivered")];
  const row = run(campaign(), orders, spendDays(3_000, 9));
  assert.equal(row.decision, "pause");
  assert.equal(row.escalate, true);
  assert.ok(row.spendSinceLastOrder >= 20_000);
});

test("no pause for a dry spell that is normal for an expensive-but-profitable campaign", () => {
  // Normally ₦9,000 an order; ₦16,000 dry is 1.6× break-even but under 3 of its own orders.
  const orders = [...Array.from({ length: 8 }, (_, i) => order(2 + (i % 5), "Delivered")), order(3, "Delivered")];
  const spend = new Map([[day(1), 16_000], [today, 0], ...Array.from({ length: 6 }, (_, i) => [day(i + 2), 13_000] as [string, number])]);
  const row = run(campaign(), orders, spend);
  assert.notEqual(row.decision, "pause");
});

test("sustained losses with evidence: turn off", () => {
  const orders = Array.from({ length: 12 }, (_, i) => order(1 + (i % 7), i % 2 ? "Delivered" : "Failed", { failedCost: i % 2 ? 0 : 2_000 }));
  const row = run(campaign({ lifetimeSpend: 300_000, lifetimeOrders: 20 }), orders, spendDays(30_000, 7));
  assert.equal(row.decision, "turn_off");
});

test("Meta purchases that never reached Protohub: pause and check tracking", () => {
  const row = run(campaign(), [order(6, "Delivered")], spendDays(4_000, 6), new Map([[day(2), 2]]));
  assert.equal(row.decision, "pause");
  assert.match(row.label, /tracking/);
});

test("close to break-even lately: watch", () => {
  const orders = [...steadyOrders(2, 30).filter((o) => o.day < day(3)), order(1, "Confirmed"), order(2, "Confirmed"), order(3, "Confirmed")];
  const spend = new Map([...spendDays(6_000, 30), [day(1), 9_000], [day(2), 9_000], [day(3), 9_000]]);
  const row = run(campaign(), orders, spend);
  assert.equal(row.decision, "watch");
});
