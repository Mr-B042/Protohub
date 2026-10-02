import assert from "node:assert/strict";
import test from "node:test";
import { attributionCapture, domainOf, healthScore, humanMetaError, orderAdIds, purchaseStatus, reconciliationVerdict } from "./tracking-hub.js";

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
