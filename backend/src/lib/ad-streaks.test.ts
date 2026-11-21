import assert from "node:assert/strict";
import test from "node:test";
import { campaignStreaks, judgeStreak, orderStreaks, type StreakAd } from "./ad-streaks.js";

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

test("within a verdict, live campaigns come before off ones", () => {
  const spend = new Map([["on", spendOn(all14, 3000)], ["off", spendOn(all14, 3000)]]);
  const orders = [...ordersOn("on", all14), ...ordersOn("off", all14)];
  const rows = orderStreaks({ today, ads: [{ ...ad("off"), campaignStatus: "off" }, { ...ad("on"), campaignStatus: "live", adLive: true }], spend, orders, targets: new Map([["p1", 10_000]]) });
  assert.deepEqual(rows.map((row) => [row.adId, row.campaignStatus]), [["on", "live"], ["off", "off"]]);
});

const inCampaign = (adId: string, campaignId: string, adLive: boolean | null = true): StreakAd => ({ ...ad(adId), campaignId, campaignName: campaignId, campaignStatus: "live", adLive });
const withCampaign = (list: Array<{ day: string; adId: string; status: string }>, campaignId: string) => list.map((o) => ({ ...o, campaignId }));

test("a strong campaign with one bad creative: campaign says scale, only that ad says turn off", () => {
  const spend = new Map([["good", spendOn(all14, 2000)], ["bad", spendOn(all14, 2000)]]);
  // good: an order every day; bad: 2 orders in 14 days at ₦14,000 each (break-even ₦10,000).
  const orders = withCampaign([...ordersOn("good", all14), ...ordersOn("bad", [3, 9])], "c1");
  const [row] = campaignStreaks({ today, ads: [inCampaign("good", "c1"), inCampaign("bad", "c1")], spend, orders, targets: new Map([["p1", 10_000]]) });
  assert.equal(row.adCount, 2);
  assert.equal(row.orders14, 16);
  assert.equal(row.verdict, "scale"); // ₦56,000 / 16 = ₦3,500 an order
  assert.equal(row.adsToTurnOff, 1);
  assert.deepEqual(row.ads.map((a) => [a.adId, a.action]), [["bad", "turn_off_ad"], ["good", "best"]]);
});

test("an ad with no order after 2× break-even is turned off; at 1× it is watched", () => {
  const ads = [inCampaign("a", "c"), inCampaign("b", "c"), inCampaign("z", "c")];
  const spend = new Map([["a", spendOn(all14, 3000)], ["b", spendOn([1, 2, 3, 4], 3000)], ["z", spendOn([1, 2, 3, 4, 5, 6, 7], 3000)]]);
  const [row] = campaignStreaks({ today, ads, spend, orders: withCampaign(ordersOn("a", all14), "c"), targets: new Map([["p1", 10_000]]) });
  const action = Object.fromEntries(row.ads.map((a) => [a.adId, a.action]));
  assert.equal(action.z, "turn_off_ad"); // ₦21,000 spent, no order
  assert.equal(action.b, "watch");       // ₦12,000 spent, no order
  assert.equal(action.a, "best");
});

test("a one-ad campaign is that ad: no ad action to take apart from the verdict", () => {
  const [row] = campaignStreaks({ today, ads: [inCampaign("solo", "c9")], spend: new Map([["solo", spendOn(all14, 20000)]]), orders: withCampaign(ordersOn("solo", [1, 2]), "c9"), targets: new Map([["p1", 10_000]]) });
  assert.equal(row.adCount, 1);
  assert.equal(row.adsToTurnOff, 0);
  assert.equal(row.ads[0].action, "keep");
  assert.equal(row.verdict, "patchy");
});

test("campaign orders without an ad id still count for the campaign; switched-off ads say so", () => {
  const ads = [inCampaign("on", "c2"), inCampaign("gone", "c2", false)];
  const spend = new Map([["on", spendOn(all14, 1000)], ["gone", spendOn([1, 2], 1000)]]);
  const orders = [...withCampaign(ordersOn("on", [1, 2]), "c2"), { day: day(3), adId: null, campaignId: "c2", status: "New" }];
  const [row] = campaignStreaks({ today, ads, spend, orders, targets: new Map() });
  assert.equal(row.orders14, 3);
  assert.equal(row.ads.find((a) => a.adId === "gone")!.action, "already_off");
});
