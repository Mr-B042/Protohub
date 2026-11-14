import assert from "node:assert/strict";
import test from "node:test";
import { campaignDroughts, groupFor, runningDays, type DroughtCampaign } from "./campaign-drought.js";

const TODAY = "2026-11-05";
const campaign = (id: string, cpa: number | null, extra: Partial<DroughtCampaign> = {}): DroughtCampaign => ({
  campaignId: id, campaignName: `Campaign ${id}`, platform: "meta", accountName: "Main", running: true, start: "2026-10-01",
  spend: cpa === null ? 30_000 : cpa * 20, orders: cpa === null ? 0 : 20, cpa, productName: "Shelf", ...extra
});
const days = (entries: Array<[string, number]>) => new Map(entries);
/** Spend every day from..to (inclusive). */
const daily = (from: string, to: string, amount: number) => {
  const out: Array<[string, number]> = [];
  for (let d = new Date(`${from}T00:00:00Z`); d.toISOString().slice(0, 10) <= to; d.setUTCDate(d.getUTCDate() + 1)) out.push([d.toISOString().slice(0, 10), amount]);
  return out;
};

test("the three groups by cost per order since start", () => {
  assert.equal(groupFor(5_000), "adjust");
  assert.equal(groupFor(6_499), "adjust");
  assert.equal(groupFor(6_500), "watch");
  assert.equal(groupFor(7_500), "watch");
  assert.equal(groupFor(7_501), "off");
  assert.equal(groupFor(null), "off");
});

test("only running campaigns that spent and had no order for 3 whole days", () => {
  const spend = new Map([
    ["a", days([["2026-11-02", 1_000], ["2026-11-03", 2_000], ["2026-11-04", 2_000], ["2026-11-05", 3_000]])],
    ["b", days(daily("2026-11-03", "2026-11-05", 4_000))],
    ["c", days([["2026-11-05", 4_000]])],
    ["d", days([["2026-10-30", 4_000]])],
    ["e", days(daily("2026-11-02", "2026-11-05", 2_000))],
    ["f", days(daily("2026-10-26", "2026-11-05", 2_000))]
  ]);
  const lastOrderDay = new Map([["a", "2026-11-01"], ["b", "2026-11-02"], ["c", "2026-11-01"], ["d", "2026-10-20"], ["f", "2026-10-25"]]);
  const result = campaignDroughts({
    today: TODAY, lastOrderDay, spendByDay: spend,
    campaigns: [
      campaign("a", 5_000),                       // last order 1st: 2nd, 3rd, 4th = 3 whole days -> adjust
      campaign("b", 9_000),                       // last order 2nd: only the 3rd and 4th -> not yet
      campaign("c", 7_000, { running: false }),   // switched off -> skip
      campaign("d", 9_000),                       // no spend lately -> skip
      campaign("e", null, { start: "2026-11-02" }),// no order ever, 3 whole days -> off
      campaign("f", 7_000)                        // watch
    ]
  });
  assert.deepEqual(result.map((row) => `${row.campaignId}:${row.group}:${row.daysWithoutOrder}`), ["e:off:3", "f:watch:10", "a:adjust:3"]);
  const a = result.find((row) => row.campaignId === "a")!;
  assert.equal(a.spendSinceLastOrder, 8_000);
  assert.equal(a.todaySpend, 3_000);
  assert.equal(a.episodeKey, "a:after-2026-11-01");
  assert.match(a.advice, /has been worth it/);
  assert.match(result[0].advice, /no order in 3 full days running\. Turn it off/);
});

test("today is never counted as a day without an order (13 Oct Edge Brusher, 6 Nov 2026)", () => {
  const input = (today: string) => campaignDroughts({
    today, lastOrderDay: new Map([["eb", "2026-11-03"]]),
    spendByDay: new Map([["eb", days([["2026-11-04", 2_756], ["2026-11-05", 2_860], ["2026-11-06", 1_640], ["2026-11-07", 900]])]]),
    campaigns: [campaign("eb", 5_364, { start: "2026-10-19", spend: 85_823, orders: 16 })]
  });
  assert.equal(input("2026-11-06").length, 0); // the 4th and 5th: 2 whole days, as Ads Manager shows
  const next = input("2026-11-07");
  assert.equal(next[0].daysWithoutOrder, 3);
  assert.equal(next[0].todaySpend, 900);
});

test("a never-ordered campaign counts from its first day of spend, not the day its ad was made (6 Nov 2026)", () => {
  const spendByDay = new Map([
    ["new", days([["2026-11-05", 4_871]])],                                       // made 18 Oct, first spent today
    ["old", days([["2026-10-31", 1_000], ...daily("2026-11-01", "2026-11-04", 200), ["2026-11-05", 1_200]])], // first spent 31 Oct
    ["edge", days([...daily("2026-10-28", "2026-11-04", 500), ["2026-11-05", 2_000]])]  // spend from where the data begins
  ]);
  const result = campaignDroughts({
    today: TODAY, lastOrderDay: new Map(), spendByDay, spendFrom: "2026-10-28",
    campaigns: [
      campaign("new", null, { start: "2026-10-18", spend: 3_172 }),
      campaign("old", null, { start: "2026-10-18", spend: 2_500 }),
      campaign("edge", null, { start: "2026-10-01", spend: 40_000 })
    ]
  });
  assert.deepEqual(result.map((row) => row.campaignId).sort(), ["edge", "old"]);
  const old = result.find((row) => row.campaignId === "old")!;
  assert.equal(old.daysWithoutOrder, 5);
  assert.equal(old.spend, 3_000); // the daily rows add up to more than the older lifetime figure
  assert.equal(result.find((row) => row.campaignId === "edge")!.daysWithoutOrder, 35);
});

test("cost per order uses the larger, fresher spend", () => {
  const result = campaignDroughts({
    today: TODAY, lastOrderDay: new Map([["a", "2026-11-01"]]), spendByDay: new Map([["a", days([["2026-10-20", 60_000], ["2026-11-02", 1_000], ["2026-11-03", 1_000], ["2026-11-04", 1_000], ["2026-11-05", 7_000]])]]),
    campaigns: [campaign("a", 3_000, { start: "2026-10-20", spend: 60_000, orders: 20 })]
  });
  assert.equal(result[0].spend, 70_000);
  assert.equal(result[0].cpa, 3_500);
});

test("days switched off never count, nor the day it is switched back on (Bright, 12 Nov 2026)", () => {
  // Last order 29 Oct, ran the 30th, off from the 31st, switched back on late on the 11th.
  const spendByDay = new Map([["shelf", days([["2026-10-30", 3_000], ["2026-11-11", 300], ["2026-11-12", 3_103]])]]);
  const run = (today: string, extra: Array<[string, number]> = []) => campaignDroughts({
    today, lastOrderDay: new Map([["shelf", "2026-10-29"]]), spendFrom: "2026-10-06",
    spendByDay: new Map([["shelf", new Map([...spendByDay.get("shelf")!, ...extra])]]),
    campaigns: [campaign("shelf", 6_780)]
  });
  assert.equal(run("2026-11-12").length, 0); // only the 30th ran: 1 day, not 13
  assert.equal(runningDays(spendByDay.get("shelf")!, "2026-10-30", "2026-11-12"), 1);
  // Still nothing by the 14th (30th, 12th, 13th = 3 running days): flagged then, honestly.
  const later = run("2026-11-14", [["2026-11-13", 3_000], ["2026-11-14", 500]]);
  assert.equal(later[0].daysWithoutOrder, 3);
  // A new spell after switching back on: its own alert, not silenced by an older one.
  assert.equal(later[0].episodeKey, "shelf:after-2026-10-29:on-2026-11-11");
});

test("running days: a one-day dip does not restart; days before the data count as before", () => {
  const spend = days([["2026-11-01", 100], ["2026-11-03", 100], ["2026-11-04", 100]]);
  assert.equal(runningDays(spend, "2026-11-01", "2026-11-05"), 3);              // the 2nd: one quiet day, the 3rd still counts
  assert.equal(runningDays(days([["2026-11-01", 100], ["2026-11-02", 100]]), "2026-10-20", "2026-11-05", "2026-11-01"), 14); // 20-31 Oct unknown (12) + 1st and 2nd
});

test("money alerts: Multi Corner Shelf 2026 (restarted 11 Nov, 1 order on the 12th, then spending with none)", async () => {
  const { campaignMoneyAlerts } = await import("./campaign-drought.js");
  const camp = { campaignId: "C1", campaignName: "Multi Corner Shelf 2026", platform: "meta", accountName: "A", running: true, start: "2026-07-21", spend: 1_640_000, orders: 300, cpa: 5_400, productName: "Shelf" };
  const spend = new Map([["C1", new Map([["2026-10-20", 5000], ["2026-11-11", 90], ["2026-11-12", 16860], ["2026-11-13", 16488], ["2026-11-14", 7628]])]]);
  const ordersByDay = new Map([["C1", new Map([["2026-11-12", 1]])]]);
  const lastOrderDay = new Map([["C1", "2026-11-12"]]);
  // 13 Nov afternoon: burn (₦16,488 since the order) and pricey (11-12 Nov: ₦16,950 for 1).
  const on13 = campaignMoneyAlerts({ today: "2026-11-13", campaigns: [camp], lastOrderDay, ordersByDay, spendByDay: spend, spendFrom: "2026-10-08" });
  assert.deepEqual(on13.map((a) => a.kind), ["burn", "pricey"]);
  assert.equal(Math.round(on13[0].spend), 16488);
  assert.equal(on13[0].episodeKey, "C1:burn-2026-11-13");
  assert.equal(Math.round(on13[1].costPerOrder!), 16950);
  // 14 Nov: same dry spell -> same burn key (no second alert), pricey key moves a day.
  const on14 = campaignMoneyAlerts({ today: "2026-11-14", campaigns: [camp], lastOrderDay, ordersByDay, spendByDay: spend, spendFrom: "2026-10-08" });
  assert.equal(on14[0].episodeKey, "C1:burn-2026-11-13");
  assert.equal(Math.round(on14[0].spend), 24116);
  assert.equal(on14[1].episodeKey, "C1:pricey-2026-11-13");
});

test("money alerts: under the limit, switched off, and a restart after a pause", async () => {
  const { campaignMoneyAlerts } = await import("./campaign-drought.js");
  const camp = { campaignId: "C2", campaignName: "X", platform: "meta", accountName: "A", running: true, start: null, spend: 0, orders: 0, cpa: null, productName: null };
  const cheap = new Map([["C2", new Map([["2026-11-12", 4000], ["2026-11-13", 3000]])]]);
  const orders = new Map([["C2", new Map([["2026-11-12", 1], ["2026-11-13", 1]])]]);
  assert.equal(campaignMoneyAlerts({ today: "2026-11-14", campaigns: [camp], lastOrderDay: new Map([["C2", "2026-11-13"]]), ordersByDay: orders, spendByDay: cheap }).length, 0);
  assert.equal(campaignMoneyAlerts({ today: "2026-11-14", campaigns: [{ ...camp, running: false }], lastOrderDay: new Map(), ordersByDay: new Map(), spendByDay: new Map([["C2", new Map([["2026-11-13", 50000]])]]) }).length, 0);
  // Old spend before a 2-week pause doesn't count: only ₦3,000 since it was switched back on.
  const paused = new Map([["C2", new Map([["2026-10-20", 9000], ["2026-11-13", 3000]])]]);
  assert.equal(campaignMoneyAlerts({ today: "2026-11-14", campaigns: [camp], lastOrderDay: new Map([["C2", "2026-10-15"]]), ordersByDay: new Map(), spendByDay: paused, spendFrom: "2026-10-08" }).length, 0);
});
