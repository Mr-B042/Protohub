import assert from "node:assert/strict";
import test from "node:test";
import { breakEvenCpa, judge, sinceStart, type LifetimeRow } from "./ad-since-start.js";
import type { SpendOrder } from "./ad-spend.js";

const base = { platform: "meta" as const, platformPurchases: 0, target: 10000, hookRate: 28, productName: "Shelf", running: true };
const order = (over: Partial<SpendOrder>): SpendOrder => ({ id: "1", day: "2026-10-01", productId: "shelf", status: "Pending", amount: 40000, productCost: 15000, deliveryFee: 3000, campaignId: null, adsetId: null, adId: null, ...over });

test("needs more time until 3 days AND 2x target spent", () => {
  assert.equal(judge({ ...base, days: 2, spend: 50000, orders: 10 }).verdict, "learning");
  assert.equal(judge({ ...base, days: 5, spend: 15000, orders: 0 }).verdict, "learning");
  assert.match(judge({ ...base, days: 2, spend: 5000, orders: 0 }).reason, /day 2 of 3, ₦5,000 of ₦20,000 spent/);
});

test("winning at 70% of break-even or less, keep under it, turn off over it", () => {
  assert.equal(judge({ ...base, days: 4, spend: 70000, orders: 10 }).verdict, "winning");
  assert.equal(judge({ ...base, days: 4, spend: 95000, orders: 10 }).verdict, "keep");
  assert.equal(judge({ ...base, days: 4, spend: 120000, orders: 10 }).verdict, "turn_off");
  assert.equal(judge({ ...base, days: 4, spend: 30000, orders: 0 }).verdict, "turn_off");
});

test("Meta sales with no Protohub orders is a tracking problem, not a kill", () => {
  assert.equal(judge({ ...base, days: 4, spend: 30000, orders: 0, platformPurchases: 3 }).verdict, "check_tracking");
});

test("hook rate gives advice, never the verdict", () => {
  const weak = judge({ ...base, days: 4, spend: 70000, orders: 10, hookRate: 18 });
  assert.equal(weak.verdict, "winning");
  assert.match(weak.advice[0], /Weak hook \(18.0%\)/);
  const strongButLosing = judge({ ...base, days: 4, spend: 120000, orders: 10, hookRate: 34 });
  assert.equal(strongButLosing.verdict, "turn_off");
  assert.match(strongButLosing.advice[0], /offer, price or form/);
  assert.match(judge({ ...base, platform: "tiktok", days: 4, spend: 70000, orders: 10, hookRate: 10 }).advice[0], /first 2 seconds/);
});

test("break-even = delivered margin x delivery rate, and needs enough orders", () => {
  const orders = [...Array.from({ length: 6 }, (_, i) => order({ id: `d${i}`, status: "Delivered" })), ...Array.from({ length: 4 }, (_, i) => order({ id: `c${i}`, status: "Cancelled" }))];
  // (40,000 - 15,000 - 3,000) x 6/10
  assert.equal(breakEvenCpa(orders).cpa, 13200);
  assert.equal(breakEvenCpa(orders.slice(0, 5)).cpa, null);
});

test("a campaign is judged from its own start, with its product's target", () => {
  const ad = (over: Partial<LifetimeRow>): LifetimeRow => ({ platform: "meta", account_id: "111", campaign_id: "c1", campaign_name: "Shelf Main", campaign_status: "ACTIVE", campaign_start: "2026-10-01", adset_id: "s1", adset_name: "Lagos", ad_id: "a1", ad_name: "Video 1", first_day: "2026-10-01", last_day: "2026-10-08", spend: 40000, impressions: 100000, link_clicks: 1500, video_hook: 22000, video_full: 5000, platform_purchases: 6, ...over });
  const [row] = sinceStart({
    today: "2026-10-08", ordersFrom: "2026-06-01",
    lifetime: [ad({}), ad({ ad_id: "a2", ad_name: "Video 2", spend: 20000, impressions: 50000, video_hook: 20000 })],
    orders: [order({ id: "1", campaignId: "c1", adId: "a1", day: "2026-10-02" }), order({ id: "2", campaignId: "c1", adId: "a2", day: "2026-10-03", status: "Delivered" }), order({ id: "3", campaignId: "c1", day: "2026-09-20" })],
    mappings: new Map([["campaign:c1", [{ productId: "shelf", share: 100 }]]]), evidence: new Map(),
    targets: new Map([["shelf", { cpa: 30000, source: "worked_out" as const }]]), products: new Map([["shelf", { name: "Shelf" }]]), accountNames: new Map()
  });
  assert.equal(row.days, 8);
  assert.equal(row.spend, 60000);
  assert.equal(row.orders, 2); // the 20 Sep order is before the campaign started
  assert.equal(row.cpa, 30000);
  assert.equal(row.verdict, "keep");
  assert.equal(Math.round(row.hookRate! * 10) / 10, 28);
  assert.equal(row.ads[0].adName, "Video 1");
});
