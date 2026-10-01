import assert from "node:assert/strict";
import test from "node:test";
import { deliveredEventTime, metaIdsFromFormContext } from "./meta-capi.js";

test("fbp/fbc saved on the order are used as they are", () => {
  assert.deepEqual(metaIdsFromFormContext({ fbp: "fb.1.1.111", fbc: "fb.1.2.abc", fbclid: "abc" }), { fbp: "fb.1.1.111", fbc: "fb.1.2.abc", fbclid: "abc" });
});

test("when the form dropped them, they are read back from the form's address (the #/route?query part)", () => {
  const landingUrl = "https://app.protohub.ng/#/order-form/embed?product=x&fbclid=CLICK&fbp=fb.1.1700.999&fbc=fb.1.1700.CLICK";
  assert.deepEqual(metaIdsFromFormContext({ fbp: null, fbc: "", landingUrl }), { fbp: "fb.1.1700.999", fbc: "fb.1.1700.CLICK", fbclid: "CLICK" });
});

test("old underscore names in the address are understood too", () => {
  assert.equal(metaIdsFromFormContext({ landingUrl: "https://x.test/page?_fbp=fb.1.1.5" }).fbp, "fb.1.1.5");
});

test("nothing to find gives nulls, never empty strings", () => {
  assert.deepEqual(metaIdsFromFormContext({ landingUrl: "not a url" }), { fbp: null, fbc: null, fbclid: null });
  assert.deepEqual(metaIdsFromFormContext(null), { fbp: null, fbc: null, fbclid: null });
});


test("delivered event time is noon Lagos on the delivered day, never in the future", () => {
  const noon = Date.parse("2026-09-30T12:00:00+01:00");
  assert.equal(deliveredEventTime("2026-09-30", noon + 3600_000), Math.floor(noon / 1000));
  assert.equal(deliveredEventTime("2026-09-30", noon - 3600_000), Math.floor((noon - 3600_000) / 1000));
  assert.equal(deliveredEventTime(null, noon), Math.floor(noon / 1000));
});
