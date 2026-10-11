import assert from "node:assert/strict";
import test from "node:test";
import { deliveredEventTime, deriveFbc, fbclidSeenAt, metaIdsFromFormContext } from "./meta-capi.js";

test("fbp/fbc saved on the order are used as they are", () => {
  assert.deepEqual(metaIdsFromFormContext({ fbp: "fb.1.1.111", fbc: "fb.1.2.abc", fbclid: "abc" }), { fbp: "fb.1.1.111", fbc: "fb.1.2.abc", fbclid: "abc", visitorId: null });
});

test("when the form dropped them, they are read back from the form's address (the #/route?query part)", () => {
  const landingUrl = "https://app.protohub.ng/#/order-form/embed?product=x&fbclid=CLICK&fbp=fb.1.1700.999&fbc=fb.1.1700.CLICK";
  assert.deepEqual(metaIdsFromFormContext({ fbp: null, fbc: "", landingUrl }), { fbp: "fb.1.1700.999", fbc: "fb.1.1700.CLICK", fbclid: "CLICK", visitorId: null });
});

test("old underscore names in the address are understood too", () => {
  assert.equal(metaIdsFromFormContext({ landingUrl: "https://x.test/page?_fbp=fb.1.1.5" }).fbp, "fb.1.1.5");
});

test("nothing to find gives nulls, never empty strings", () => {
  assert.deepEqual(metaIdsFromFormContext({ landingUrl: "not a url" }), { fbp: null, fbc: null, fbclid: null, visitorId: null });
  assert.deepEqual(metaIdsFromFormContext(null), { fbp: null, fbc: null, fbclid: null, visitorId: null });
});


test("delivered event time is noon Lagos on the delivered day, never in the future", () => {
  const noon = Date.parse("2026-09-30T12:00:00+01:00");
  assert.equal(deliveredEventTime("2026-09-30", noon + 3600_000), Math.floor(noon / 1000));
  assert.equal(deliveredEventTime("2026-09-30", noon - 3600_000), Math.floor((noon - 3600_000) / 1000));
  assert.equal(deliveredEventTime(null, noon), Math.floor(noon / 1000));
});

// Meta Events Manager errors, 10 Oct 2026 (real shapes from orders 5059-5068).
test("fbc built from the address uses milliseconds and when the click was first seen", () => {
  const now = Date.parse("2026-10-10T07:28:03Z");
  const seen = fbclidSeenAt({ secondsSinceOpen: 95 }, "2026-10-10T07:28:03Z");
  assert.equal(seen, now - 95_000);
  // No _fbc cookie (order 5068): build it - ms, never seconds, never "now" for an old order.
  assert.equal(deriveFbc(null, "IwZXh0bgNhZW0BMABwZG9mBWZkaWQWUQD9bFPntkiV5gvjpfBu", seen, now), `fb.1.${now - 95_000}.IwZXh0bgNhZW0BMABwZG9mBWZkaWQWUQD9bFPntkiV5gvjpfBu`);
  assert.ok(String(deriveFbc(null, "abc", seen, now)).split(".")[2].length === 13, "milliseconds have 13 digits");
});

test("an older click in the _fbc cookie gives way to the click in the address", () => {
  // Order 5064: the cookie held a previous click; the address the current one.
  const cookie = "fb.1.1791541727425.IwZXh0bgNhZW0BMABwZG9mBWFkaWQBqzxwwvwF53NydGMGYXBwX";
  const current = "IwZXh0bgNhZW0BMABwZG9mBWFkaWQBqzvwu5CEB3NydGMGYXBw";
  const out = String(deriveFbc(cookie, current, 1791563000000, 1791563463000));
  assert.ok(out.endsWith(`.${current}`), "uses the current click, unchanged");
  assert.equal(out, `fb.1.1791563000000.${current}`);
  // The same click in both: the cookie is sent exactly as it is.
  assert.equal(deriveFbc(`fb.1.1791541727425.${current}`, current, 1, 2), `fb.1.1791541727425.${current}`);
  // No click in the address: the cookie as it is.
  assert.equal(deriveFbc(cookie, null), cookie);
  assert.equal(deriveFbc(null, null), undefined);
  // The click id is never lower-cased or cut.
  assert.ok(String(deriveFbc(null, "AbC-123_xYz", 5, 10)).endsWith(".AbC-123_xYz"));
  // A first-seen time in the future is not allowed.
  assert.equal(deriveFbc(null, "abc", 9_999_999_999_999, 1000), "fb.1.1000.abc");
});

test("the form's visitor id is passed on only when it is the 64 hex characters the form makes", () => {
  const id = "a".repeat(64);
  assert.equal(metaIdsFromFormContext({ visitorId: id }).visitorId, id);
  assert.equal(metaIdsFromFormContext({ visitorId: ` ${id.toUpperCase()} ` }).visitorId, id);
  assert.equal(metaIdsFromFormContext({ visitorId: "08031234567" }).visitorId, null);
  assert.equal(metaIdsFromFormContext({ visitorId: 12345 }).visitorId, null);
});

test("a click id the form cut at 180 characters is sent whole, from the form's saved address", () => {
  const whole = `IwY2xjawN${"aB3dE".repeat(36)}_aem_XyZabcd`; // 201 characters, mixed case
  assert.equal(whole.length, 201);
  const cut = whole.slice(0, 180);
  const landingUrl = `https://app.protohub.ng/#/order-form/embed?product=x&fbclid=${whole}&fbc=fb.1.1760000000000.${whole}`;
  const ids = metaIdsFromFormContext({ fbclid: cut, fbc: `fb.1.1760000000000.${whole}`.slice(0, 180), landingUrl });
  assert.equal(ids.fbclid, whole);
  assert.equal(ids.fbc, `fb.1.1760000000000.${whole}`);
  // Sent to Meta unchanged: same letters, same case, nothing dropped.
  assert.equal(deriveFbc(ids.fbc, ids.fbclid, 1760000000000), `fb.1.1760000000000.${whole}`);

  // A DIFFERENT click in the address is not a longer copy of the saved one: the saved one stays.
  const other = `Other${"zZ9".repeat(60)}`;
  assert.equal(metaIdsFromFormContext({ fbclid: cut, landingUrl: `https://x.test/#/f?fbclid=${other}` }).fbclid, cut);
  // A short saved value is never swapped for something that merely starts the same.
  assert.equal(metaIdsFromFormContext({ fbclid: "abc", landingUrl: "https://x.test/#/f?fbclid=abcdef" }).fbclid, "abc");
});

test("a cookie cut short is the same click: keep its time, send the whole click id", () => {
  const whole = `IwY2xjawN${"aB3dE".repeat(36)}_aem_XyZabcd`;
  const cutCookie = `fb.1.1759990000000.${whole}`.slice(0, 180);
  assert.equal(deriveFbc(cutCookie, whole, 1760000000000), `fb.1.1759990000000.${whole}`);
  // An older, different click in the cookie still loses to the click in the address.
  assert.equal(deriveFbc(`fb.1.1750000000000.${"q".repeat(170)}`, whole, 1760000000000, 1760000500000), `fb.1.1760000000000.${whole}`);
});
