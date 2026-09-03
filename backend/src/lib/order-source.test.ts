import assert from "node:assert/strict";
import test from "node:test";
import { resolveOrderSource, sourceFromClickIds, sourceFromUtm } from "./order-source.js";

// Order 3992, 3 Sept 2026. The ad pointed at the embed URL with no utm_source,
// and Facebook appended its own click ID to that same query string.
const ORDER_3992_CONTEXT = {
  fbclid: "IwAR78DNvpouZp8NmoFFprH5QC7NUibZf1U5s4HA1FnmWaKFMur-Z7-hFY5B0GAg_wamooc_lUPIqNzLTEuTNXHqaVAgLQ_wamoaem__ZimFeOAy0HIpCMbXJ66gQ",
  gclid: null,
  ttclid: null
};

test("an untagged ad link is not Direct when Facebook stamped a click ID", () => {
  // What the link itself said, and what it used to be filed as.
  assert.equal(sourceFromUtm("direct"), "Direct");
  assert.equal(resolveOrderSource("direct", ORDER_3992_CONTEXT), "Facebook");
});

test("a tagged link always beats the click ID", () => {
  // {{site_source_name}} knows the placement; fbclid cannot. Instagram traffic
  // must not be relabelled Facebook just because Meta stamps one click ID.
  assert.equal(resolveOrderSource("ig", ORDER_3992_CONTEXT), "Instagram");
  assert.equal(resolveOrderSource("an", ORDER_3992_CONTEXT), "Audience Network");
  assert.equal(resolveOrderSource("tt", { fbclid: "x" }), "TikTok");
});

test("a genuinely direct visit stays Direct", () => {
  assert.equal(resolveOrderSource("direct", {}), "Direct");
  assert.equal(resolveOrderSource(undefined, { fbclid: "", gclid: null }), "Direct");
  assert.equal(resolveOrderSource("direct", null), "Direct");
});

test("Google and Microsoft clicks land in Website, never Direct", () => {
  // Neither has a source of its own, but a paid click is not a direct visit.
  assert.equal(resolveOrderSource("direct", { gclid: "abc" }), "Website");
  assert.equal(resolveOrderSource("direct", { msclkid: "abc" }), "Website");
  assert.equal(resolveOrderSource("direct", { wbraid: "abc" }), "Website");
});

test("TikTok's click ID outranks a stray fbclid", () => {
  assert.equal(sourceFromClickIds({ fbclid: "a", ttclid: "b" }), "TikTok");
  assert.equal(sourceFromClickIds({}), null);
});
