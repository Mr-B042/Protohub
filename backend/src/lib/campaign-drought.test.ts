import assert from "node:assert/strict";
import test from "node:test";
import { campaignDroughts, groupFor, type DroughtCampaign } from "./campaign-drought.js";

const TODAY = "2026-11-05";
const campaign = (id: string, cpa: number | null, extra: Partial<DroughtCampaign> = {}): DroughtCampaign => ({
  campaignId: id, campaignName: `Campaign ${id}`, platform: "meta", accountName: "Main", running: true, start: "2026-10-01",
  spend: cpa === null ? 30_000 : cpa * 20, orders: cpa === null ? 0 : 20, cpa, productName: "Shelf", ...extra
});
const days = (entries: Array<[string, number]>) => new Map(entries);

test("the three groups by cost per order since start", () => {
  assert.equal(groupFor(5_000), "adjust");
  assert.equal(groupFor(6_499), "adjust");
  assert.equal(groupFor(6_500), "watch");
  assert.equal(groupFor(7_500), "watch");
  assert.equal(groupFor(7_501), "off");
  assert.equal(groupFor(null), "off");
});

test("only running campaigns that spent and had no order for 3 days", () => {
  const spend = new Map([
    ["a", days([["2026-11-04", 5_000], ["2026-11-05", 3_000]])],
    ["b", days([["2026-11-05", 4_000]])],
    ["c", days([["2026-11-05", 4_000]])],
    ["d", days([["2026-10-30", 4_000]])],
    ["e", days([["2026-11-03", 2_000], ["2026-11-05", 2_000]])],
    ["f", days([["2026-11-05", 2_000]])]
  ]);
  const lastOrderDay = new Map([["a", "2026-11-02"], ["b", "2026-11-03"], ["c", "2026-11-01"], ["d", "2026-10-20"], ["f", "2026-10-25"]]);
  const result = campaignDroughts({
    today: TODAY, lastOrderDay, spendByDay: spend,
    campaigns: [
      campaign("a", 5_000),                       // last order 2nd: 3 days -> adjust
      campaign("b", 9_000),                       // last order 3rd: only 2 days -> not yet
      campaign("c", 7_000, { running: false }),   // switched off -> skip
      campaign("d", 9_000),                       // no spend in the last 3 days -> skip
      campaign("e", null, { start: "2026-11-03" }),// no order ever, 3 days old -> off
      campaign("f", 7_000)                        // watch
    ]
  });
  assert.deepEqual(result.map((row) => `${row.campaignId}:${row.group}:${row.daysWithoutOrder}`), ["e:off:3", "f:watch:11", "a:adjust:3"]);
  const a = result.find((row) => row.campaignId === "a")!;
  assert.equal(a.spendSinceLastOrder, 8_000);
  assert.equal(a.episodeKey, "a:2026-11-02");
  assert.match(a.advice, /has been worth it/);
  assert.match(result[0].advice, /no order yet\. Turn it off/);
});

test("a never-ordered campaign counts from its first day of spend, not the day its ad was made (6 Nov 2026)", () => {
  const spendByDay = new Map([
    ["new", days([["2026-11-05", 4_871]])],                                       // made 18 Oct, first spent today
    ["old", days([["2026-10-31", 1_000], ["2026-11-05", 2_000]])],                 // first spent 31 Oct
    ["edge", days([["2026-10-28", 1_000], ["2026-11-05", 2_000]])]                 // spend from where the data begins
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
  assert.equal(old.daysWithoutOrder, 6);
  assert.equal(old.spend, 3_000); // the daily rows add up to more than the older lifetime figure
  assert.equal(result.find((row) => row.campaignId === "edge")!.daysWithoutOrder, 36);
});

test("cost per order uses the larger, fresher spend", () => {
  const result = campaignDroughts({
    today: TODAY, lastOrderDay: new Map([["a", "2026-11-01"]]), spendByDay: new Map([["a", days([["2026-10-20", 60_000], ["2026-11-05", 10_000]])]]),
    campaigns: [campaign("a", 3_000, { start: "2026-10-20", spend: 60_000, orders: 20 })]
  });
  assert.equal(result[0].spend, 70_000);
  assert.equal(result[0].cpa, 3_500);
});
