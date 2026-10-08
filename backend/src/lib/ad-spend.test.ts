import assert from "node:assert/strict";
import test from "node:test";
import { UNMAPPED, allocate, buildReport, linkEvidence, mappingIndex, resolveSplits, tiktokOrderIds, validSplits, type AccountInfo, type SpendInsight, type SpendOrder } from "./ad-spend.js";

const insight = (over: Partial<SpendInsight>): SpendInsight => ({
  day: "2026-10-08", spend: 1000, ad_account_id: "111", campaign_id: "c1", campaign_name: "Shelf Main", adset_id: "s1", adset_name: "Lagos", ad_id: "a1", ad_name: "Video 1", ...over
});
const order = (over: Partial<SpendOrder>): SpendOrder => ({
  id: "1", day: "2026-10-08", productId: "shelf", status: "Pending", amount: 40000, productCost: 15000, deliveryFee: 3000, campaignId: null, adsetId: null, adId: null, ...over
});
const accounts = new Map<string, AccountInfo>([
  ["111", { accountId: "111", name: "Household A", businessKey: "b1", businessName: "Household Business" }],
  ["222", { accountId: "222", name: "Protools C", businessKey: "b2", businessName: "Protools Main" }]
]);
const products = new Map([["shelf", { name: "Corner Shelf", imageUrl: null }], ["rack", { name: "5-in-1 Rack", imageUrl: null }]]);
const report = (insights: SpendInsight[], orders: SpendOrder[], mappings: Parameters<typeof mappingIndex>[0] = [], evidence = new Map<string, string>(), view: any = "product", filters = {}) =>
  buildReport({
    view, from: "2026-10-08", to: "2026-10-08", compareFrom: "2026-10-07", compareTo: "2026-10-07", trendDays: ["2026-10-07", "2026-10-08"], chartDays: ["2026-10-07", "2026-10-08"],
    pieces: allocate(insights, mappingIndex(mappings), evidence, accounts), orders, filters, accounts, products
  });

test("the lowest level set wins: ad > ad set > campaign > tracking link > ad account", () => {
  const index = mappingIndex([
    { level: "account", meta_id: "111", splits: [{ productId: "acct", share: 100 }] },
    { level: "campaign", meta_id: "c1", splits: [{ productId: "camp", share: 100 }] },
    { level: "adset", meta_id: "s1", splits: [{ productId: "set", share: 100 }] },
    { level: "ad", meta_id: "a1", splits: [{ productId: "ad", share: 100 }] }
  ]);
  const evidence = new Map([["a1", "link"], ["a2", "link"], ["a3", "link"]]);
  assert.equal(resolveSplits({ ad_id: "a1", adset_id: "s1", campaign_id: "c1", ad_account_id: "111" }, index, evidence).splits[0].productId, "ad");
  assert.equal(resolveSplits({ ad_id: "a2", adset_id: "s1", campaign_id: "c1", ad_account_id: "111" }, index, evidence).source, "adset");
  assert.equal(resolveSplits({ ad_id: "a2", adset_id: "s9", campaign_id: "c1", ad_account_id: "111" }, index, evidence).source, "campaign");
  assert.equal(resolveSplits({ ad_id: "a3", adset_id: "s9", campaign_id: "c9", ad_account_id: "111" }, index, evidence).source, "link");
  assert.equal(resolveSplits({ ad_id: "a9", adset_id: "s9", campaign_id: "c9", ad_account_id: "111" }, index, evidence).source, "account");
  assert.deepEqual(resolveSplits({ ad_id: "a9", adset_id: "s9", campaign_id: "c9", ad_account_id: "999" }, index, evidence), { splits: [], source: null });
});

test("a renamed campaign keeps its product (mapped by id, never by name)", () => {
  const mappings = [{ level: "campaign" as const, meta_id: "c1", splits: [{ productId: "shelf", share: 100 }] }];
  const before = report([insight({ campaign_name: "Shelf Campaign 01" })], [], mappings);
  const after = report([insight({ campaign_name: "October Scaling CBO" })], [], mappings);
  assert.equal(before.rows[0].id, "shelf");
  assert.equal(after.rows[0].id, "shelf");
});

test("unmapped spend is shown, never guessed", () => {
  const result = report([insight({ spend: 37500, campaign_id: "new1" }), insight({ spend: 0, campaign_id: "new2" })], []);
  assert.equal(result.unmapped.spend, 37500);
  assert.equal(result.unmapped.campaigns, 1);
  assert.equal(result.rows[0].id, UNMAPPED);
  assert.equal(result.kpis.spend, 37500);
});

test("split allocation divides a campaign's spend by share", () => {
  const mappings = [{ level: "campaign" as const, meta_id: "c1", splits: [{ productId: "rack", share: 60 }, { productId: "shelf", share: 40 }] }];
  const result = report([insight({ spend: 100000 })], [], mappings);
  assert.deepEqual(result.rows.map((row) => [row.id, row.spend]), [["rack", 60000], ["shelf", 40000]]);
});

test("one product's spend from several campaigns and ad accounts adds up", () => {
  const mappings = ["c1", "c2", "c6", "c9"].map((id) => ({ level: "campaign" as const, meta_id: id, splits: [{ productId: "shelf", share: 100 }] }));
  const result = report([
    insight({ campaign_id: "c1", spend: 40000 }), insight({ campaign_id: "c2", spend: 25000, ad_id: "a2" }),
    insight({ campaign_id: "c6", spend: 32000, ad_id: "a6" }), insight({ campaign_id: "c9", spend: 18000, ad_id: "a9", ad_account_id: "222" })
  ], [], mappings);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].spend, 115000);
  assert.equal(result.rows[0].campaigns, 4);
  assert.equal(result.rows[0].accounts, 2);
});

test("CPA, CPDO, delivered AOV, ROAS and profit after ads", () => {
  const mappings = [{ level: "campaign" as const, meta_id: "c1", splits: [{ productId: "shelf", share: 100 }] }];
  const orders = [
    order({ id: "1", status: "Delivered", amount: 40000 }), order({ id: "2", status: "Delivered", amount: 40000 }),
    order({ id: "3" }), order({ id: "4", status: "Cancelled" }), order({ id: "5", productId: "rack" })
  ];
  const row = report([insight({ spend: 20000 })], orders, mappings).rows[0];
  assert.equal(row.orders, 4);
  assert.equal(row.delivered, 2);
  assert.equal(row.cpa, 5000);
  assert.equal(row.cpdo, 10000);
  assert.equal(row.deliveredAov, 40000);
  assert.equal(row.roas, 4);
  // 2 x (40,000 - 15,000 - 3,000) - 20,000
  assert.equal(row.profit, 24000);
});

test("campaign view counts only orders carrying that campaign", () => {
  const mappings = [{ level: "campaign" as const, meta_id: "c1", splits: [{ productId: "shelf", share: 100 }] }];
  const orders = [order({ id: "1", campaignId: "c1" }), order({ id: "2", adId: "a1" }), order({ id: "3" })];
  const result = report([insight({})], orders, mappings, new Map(), "campaign");
  assert.equal(result.rows[0].id, "c1");
  assert.equal(result.rows[0].orders, 2);
});

test("an ad's tracking link gives the product only when one product has 90%+ of its visits", () => {
  const evidence = linkEvidence([
    { adId: "a1", productId: "shelf", visits: 95 }, { adId: "a1", productId: "rack", visits: 5 },
    { adId: "a2", productId: "shelf", visits: 60 }, { adId: "a2", productId: "rack", visits: 40 }
  ]);
  assert.equal(evidence.get("a1"), "shelf");
  assert.equal(evidence.has("a2"), false);
});

test("shares must add up to 100", () => {
  const ids = new Set(["shelf", "rack"]);
  assert.equal(validSplits([{ productId: "shelf", share: 100 }], ids), null);
  assert.equal(validSplits([{ productId: "shelf", share: 60 }, { productId: "rack", share: 40 }], ids), null);
  assert.match(validSplits([{ productId: "shelf", share: 60 }, { productId: "rack", share: 30 }], ids)!, /90%/);
  assert.match(validSplits([{ productId: "gone", share: 100 }], ids)!, /no longer exists/);
  assert.match(validSplits([], ids)!, /Pick a product/);
});

test("TikTok orders never count against Meta spend; untagged orders still do", () => {
  const mappings = [{ level: "campaign" as const, meta_id: "c1", splits: [{ productId: "shelf", share: 100 }] }];
  const orders = [order({ id: "1", campaignId: "c1" }), order({ id: "2" }), order({ id: "3", otherPlatform: "TikTok" }), order({ id: "4", otherPlatform: "TikTok", status: "Delivered" })];
  const result = report([insight({ spend: 10000 })], orders, mappings);
  assert.equal(result.rows[0].orders, 2);
  assert.equal(result.rows[0].delivered, 0);
  assert.equal(result.kpis.cpa, 5000);
  assert.deepEqual(result.leftOut, [{ platform: "TikTok", orders: 2 }]);
});

test("each platform's orders are measured against its own spend", () => {
  const mappings = [
    { level: "campaign" as const, meta_id: "c1", splits: [{ productId: "shelf", share: 100 }] },
    { level: "campaign" as const, meta_id: "tt:9", splits: [{ productId: "shelf", share: 100 }] }
  ];
  const insights = [insight({ spend: 10000 }), insight({ platform: "tiktok", spend: 6000, campaign_id: "tt:9", ad_id: "tt:91", adset_id: "tt:90", ad_account_id: "tt:7" })];
  const orders = [order({ id: "1" }), order({ id: "2" }), order({ id: "3", otherPlatform: "TikTok" }), order({ id: "4", otherPlatform: "TikTok" }), order({ id: "5", otherPlatform: "TikTok" })];
  const run = (platform: "meta" | "tiktok" | "all", connected: Array<"meta" | "tiktok">) => buildReport({
    view: "product", from: "2026-10-08", to: "2026-10-08", compareFrom: "2026-10-07", compareTo: "2026-10-07", trendDays: ["2026-10-08"], chartDays: ["2026-10-08"],
    pieces: allocate(insights, mappingIndex(mappings), new Map(), accounts), orders, filters: { platform }, accounts, products, connected
  }).kpis;
  assert.deepEqual([run("meta", ["meta", "tiktok"]).spend, run("meta", ["meta", "tiktok"]).orders], [10000, 2]);
  assert.deepEqual([run("tiktok", ["meta", "tiktok"]).spend, run("tiktok", ["meta", "tiktok"]).orders], [6000, 3]);
  assert.deepEqual([run("all", ["meta", "tiktok"]).spend, run("all", ["meta", "tiktok"]).orders], [16000, 5]);
  // TikTok spend not read yet: "All" must not count TikTok orders against Meta's spend.
  assert.equal(run("all", ["meta"]).orders, 2);
});

test("a TikTok order finds its campaign by id, else by an unshared campaign name", () => {
  const byName = new Map<string, string | null>([["shelf corner group", "tt:1"], ["twin", null]]);
  assert.equal(tiktokOrderIds({ form_context: { utmId: "1844000000000001" }, utm_campaign: null }, byName).campaignId, "tt:1844000000000001");
  const withId = new Map<string, string | null>([["shelf corner group", "tt:1"], ["racks", "tt:1844000000000001"]]);
  assert.equal(tiktokOrderIds({ form_context: { utmId: "1844000000000001" }, utm_campaign: "Shelf Corner Group" }, withId).campaignId, "tt:1844000000000001");
  assert.equal(tiktokOrderIds({ form_context: {}, utm_campaign: "  Shelf  Corner Group " }, byName).campaignId, "tt:1");
  assert.equal(tiktokOrderIds({ form_context: {}, utm_campaign: "Twin" }, byName).campaignId, null);
  // A stray id no TikTok campaign has loses to the name.
  assert.equal(tiktokOrderIds({ form_context: { utmId: "120218799456" }, utm_campaign: "Shelf Corner Group" }, byName).campaignId, "tt:1");
  assert.equal(tiktokOrderIds({ form_context: {}, utm_term: "1800000000000002", utm_content: "1800000000000003" }, byName).adId, "tt:1800000000000003");
});
