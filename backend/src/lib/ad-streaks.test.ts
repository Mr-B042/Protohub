import assert from "node:assert/strict";
import test from "node:test";
import { judgeStreak, orderStreaks, type StreakAd } from "./ad-streaks.js";

const today = "2026-11-20";
const ad = (adId: string, productId: string | null = "p1"): StreakAd => ({
  adId, adName: adId, campaignId: "c", campaignName: "C", adsetId: "s", adsetName: "S", accountId: "a", accountName: "A", platform: "meta", productId, productName: productId
});
// Days back from yesterday: 1 = 19 Nov ... 14 = 6 Nov.
const day = (back: number) => `2026-11-${String(20 - back).padStart(2, "0")}`;
const spendOn = (backs: number[], amount = 5000) => new Map(backs.map((b) => [day(b), amount]));
const ordersOn = (adId: string, backs: number[], status = "Confirmed") => backs.map((b) => ({ day: day(b), adId, status }));
const all14 = Array.from({ length: 14 }, (_, i) => i + 1);

test("consistency counts days with an order over days the ad ran; off days don't count or break the run", () => {
  // Ran 12 of 14 days (off on days 3 and 4), orders on 10 of them, none on day 6.
  const ran = all14.filter((b) => b !== 3 && b !== 4);
  const withOrder = ran.filter((b) => b !== 6 && b !== 12);
  const [row] = orderStreaks({ today, ads: [ad("x")], spend: new Map([["x", spendOn(ran)]]), orders: ordersOn("x", withOrder), targets: new Map([["p1", 10_000]]) });
  assert.equal(row.activeDays14, 12);
  assert.equal(row.orderDays14, 10);
  // Back from yesterday: 1, 2 have orders; 3, 4 off (skipped); 5 has an order; 6 spent with none -> stop.
  assert.equal(row.run, 3);
  assert.equal(row.days.length, 14);
  assert.equal(row.days[13].day, "2026-11-19");
});

test("steady and cheap = scale; steady but above 70% of break-even is not", () => {
  const spend = new Map([["x", spendOn(all14, 3000)]]);
  const orders = ordersOn("x", all14);
  const cheap = orderStreaks({ today, ads: [ad("x")], spend, orders, targets: new Map([["p1", 10_000]]) })[0];
  assert.equal(cheap.verdict, "scale");
  assert.equal(cheap.costPerOrder14, 3000);
  assert.equal(orderStreaks({ today, ads: [ad("x")], spend, orders, targets: new Map([["p1", 4000]]) })[0].verdict, "steady_ok");
  assert.equal(orderStreaks({ today, ads: [ad("x")], spend, orders, targets: new Map([["p1", 2000]]) })[0].verdict, "steady_costly");
  assert.equal(orderStreaks({ today, ads: [ad("x", null)], spend, orders, targets: new Map() })[0].verdict, "steady_no_target");
});

test("an ad that stopped spending over a week ago is left out", () => {
  const rows = orderStreaks({ today, ads: [ad("old")], spend: new Map([["old", spendOn([9, 10, 11])]]), orders: ordersOn("old", [9, 10, 11]), targets: new Map() });
  assert.equal(rows.length, 0);
});

test("today is shown on its own, never in the 14 days", () => {
  const spend = new Map([["x", new Map([...spendOn([1]), [today, 2000]])]]);
  const [row] = orderStreaks({ today, ads: [ad("x")], spend, orders: [...ordersOn("x", [1]), { day: today, adId: "x", status: "New" }], targets: new Map() });
  assert.equal(row.ordersToday, 1);
  assert.equal(row.spendToday, 2000);
  assert.equal(row.orders14, 1);
  assert.equal(row.confirmed14, 1);
});

test("too few days, slipped this week, patchy", () => {
  assert.equal(judgeStreak({ activeDays14: 3, orderDays14: 3, activeDays7: 3, orderDays7: 3, share14: 1, share7: 1, costPerOrder14: 1000, target: 9000 }).verdict, "building");
  const slipped = judgeStreak({ activeDays14: 14, orderDays14: 10, activeDays7: 7, orderDays7: 3, share14: 10 / 14, share7: 3 / 7, costPerOrder14: 1000, target: 9000 });
  assert.equal(slipped.verdict, "building");
  assert.match(slipped.reason, /slipped/);
  assert.equal(judgeStreak({ activeDays14: 10, orderDays14: 2, activeDays7: 7, orderDays7: 1, share14: 0.2, share7: 1 / 7, costPerOrder14: 1000, target: 9000 }).verdict, "patchy");
});
