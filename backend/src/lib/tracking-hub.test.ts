import assert from "node:assert/strict";
import test from "node:test";
import { attributionCapture, domainOf, explainCampaignGaps, healthScore, humanMetaError, orderAdIds, productFromName, purchaseStatus, reconciliationVerdict } from "./tracking-hub.js";

test("browser + server with the same event id is one Purchase in Meta", () => {
  assert.equal(purchaseStatus({ serverStatus: "sent", serverEventId: "18452", browserEventId: "18452" }), "deduped");
  assert.equal(purchaseStatus({ serverStatus: "sent", serverEventId: "18452", browserEventId: null }), "server_only");
  assert.equal(purchaseStatus({ serverStatus: "rejected", serverEventId: "18452", browserEventId: null }), "capi_failed");
  assert.equal(purchaseStatus({ serverStatus: null, serverEventId: null, browserEventId: "18452" }), "browser_only");
  assert.equal(purchaseStatus({ serverStatus: null, serverEventId: null, browserEventId: null }), "not_tracked");
  assert.equal(purchaseStatus({ serverStatus: "sent", serverEventId: "1", browserEventId: "1", serverTest: true }), "test");
});

test("Meta's errors become plain words", () => {
  assert.match(humanMetaError("Invalid OAuth access token data.", 400).title, /connection is not working/);
  assert.match(humanMetaError("(#100) Object with ID '123' does not exist", 400).title, /cannot find/);
  assert.match(humanMetaError("", null).title, /Could not reach Meta/);
});

test("ad ids come from campaign_id/adset_id/ad_id or utm_id/utm_term/utm_content", () => {
  assert.deepEqual(orderAdIds({ form_context: { utmId: "120253793342730359" }, utm_term: "120253793342820359", utm_content: "120253793342760359" }),
    { campaignId: "120253793342730359", adsetId: "120253793342820359", adId: "120253793342760359" });
  assert.deepEqual(orderAdIds({ form_context: {}, utm_campaign: "Shelf Corner Group", utm_content: "creative-a" }), { campaignId: null, adsetId: null, adId: null });
});

test("attribution capture is a share of ad orders", () => {
  const capture = attributionCapture([
    { form_context: { fbclid: "x", utmId: "120253793342730359", userAgent: "ua" }, utm_source: "fb", utm_campaign: "c", utm_term: "120253793342820359", utm_content: "120253793342760359", referrer: "https://brightpathhubs.com/shelf" },
    { form_context: { fbclid: "y", landingUrl: "https://x/#/f?fbp=fb.1.1.2" }, utm_source: "fb", utm_campaign: null, referrer: null },
    { form_context: {}, utm_source: "direct" }
  ]);
  assert.equal(capture.orders, 2);
  assert.equal(capture.fields.fbclid, 100);
  assert.equal(capture.fields.fbp_fbc, 50);
  assert.equal(capture.fields.campaign, 50);
});

test("domains and health", () => {
  assert.equal(domainOf("https://www.BrightPathHubs.com/shelf/?a=1"), "brightpathhubs.com");
  assert.equal(domainOf(""), null);
  assert.equal(healthScore([{ key: "a", label: "", total: 4, healthy: 3, detail: "" }, { key: "b", label: "", total: 1, healthy: 1, detail: "" }]), 80);
  assert.equal(healthScore([]), 0);
});

test("reconciliation explains the difference instead of blaming the Pixel", () => {
  assert.equal(reconciliationVerdict({ protohubOrders: 43, purchaseEvents: 43, sentToMeta: 43, duplicates: 0, metaPurchases: 44 }).tone, "ok");
  assert.match(reconciliationVerdict({ protohubOrders: 38, purchaseEvents: 38, sentToMeta: 38, duplicates: 0, metaPurchases: 52 }).conclusion, /did not generate 14 additional/);
  assert.match(reconciliationVerdict({ protohubOrders: 40, purchaseEvents: 40, sentToMeta: 30, duplicates: 0, metaPurchases: 30 }).likely, /10 orders were not sent/);
  assert.equal(reconciliationVerdict({ protohubOrders: 5, purchaseEvents: 5, sentToMeta: 5, duplicates: 0, metaPurchases: null }).tone, "info");
});

test("explainCampaignGaps: Bright's 3 Oct shelf and racks", () => {
  const rows = [
    { id: "0009", name: "0009 Shelf", productId: "shelf", protohub: 0, meta: 1, orderIds: [] },
    { id: "cshelf", name: "C Shelf Corner", productId: "shelf", protohub: 0, meta: 1, orderIds: [] },
    { id: "multi2026", name: "Multi Corner Shelf 2026", productId: "shelf", protohub: 1, meta: 0, orderIds: ["4782"] },
    { id: "unsynced", name: "120253933094970359", productId: "shelf", protohub: 1, meta: 0, orderIds: ["4778"] },
    { id: "abo", name: "5-in-1 ABO Test", productId: "racks", protohub: 0, meta: 1, orderIds: [] },
    { id: "005", name: "005 5-in-1", productId: "racks", protohub: 1, meta: 1, orderIds: ["4774"] }
  ];
  const out = explainCampaignGaps(rows, new Map([["racks", 4]]));
  assert.equal(out.get("0009")?.creditedElsewhere, 1);
  assert.equal(out.get("cshelf")?.unexplained, 0);
  assert.equal(out.get("multi2026")?.creditedElsewhere, 1);
  assert.equal(out.get("abo")?.otherPixel, 1);
  assert.equal(out.get("abo")?.unexplained, 0);
  assert.equal(out.has("005"), false);
});

test("explainCampaignGaps: a real gap stays a gap", () => {
  const out = explainCampaignGaps([{ id: "a", name: "A", productId: "p", protohub: 0, meta: 3, orderIds: [] }], new Map());
  assert.equal(out.get("a")?.unexplained, 3);
});

test("productFromName uses words only one product has", () => {
  const products = [{ id: "shelf", name: "Multi Corner Storage Shelf" }, { id: "racks", name: "5-in-1 Corner Racks" }, { id: "edge", name: "Edge Brusher Max" }];
  assert.equal(productFromName("C Shelf Corner Sales campaign", products), "shelf");
  assert.equal(productFromName("5-in-1 Corner Rack | Sales | ABO Test", products), "racks");
  assert.equal(productFromName("D New Sept Edge Brusher Sales campaign", products), "edge");
  assert.equal(productFromName("Corner Sales campaign", products), null);
});
