import assert from "node:assert/strict";
import test from "node:test";
import { deliveredPixel, deliveredSwitch } from "./meta-capi-delivered.js";

const link = (over: Partial<{ send_delivered_event: boolean; delivered_event_name: string | null }> = {}) =>
  ({ send_delivered_event: false, delivered_event_name: "OrderDelivered", ...over });

test("the delivered-sale event is off until the branch or the setting switches it on", () => {
  assert.deepEqual(deliveredSwitch(link(), undefined), { on: false, eventName: "OrderDelivered" });
  assert.deepEqual(deliveredSwitch(link(), { on: false, eventName: "PaidOrder" }), { on: false, eventName: "OrderDelivered" });
  // Tracking Hub settings: on for the whole branch, with the name typed there.
  assert.deepEqual(deliveredSwitch(link(), { on: true, eventName: "PaidOrder" }), { on: true, eventName: "PaidOrder" });
  // The older per-setting switch still works, with its own name.
  assert.deepEqual(deliveredSwitch(link({ send_delivered_event: true, delivered_event_name: "Delivered_Sale" }), undefined), { on: true, eventName: "Delivered_Sale" });
  // A blank or badly shaped name falls back, so Meta never gets an invalid event name.
  assert.equal(deliveredSwitch(link(), { on: true, eventName: "" }).eventName, "OrderDelivered");
  assert.equal(deliveredSwitch(link(), { on: true, eventName: "paid order!" }).eventName, "OrderDelivered");
});

test("a delivered sale goes to the Pixel its Purchase went to", () => {
  const main = { pixel_id: "1584729439695996", access_token: "main-token", test_event_code: null };
  const clicked = { pixelId: "1314625690797063", token: "adset-token", testing: false, testEventCode: null, paused: false };
  // Purchase recorded on the clicked ad set's Pixel (one Pixel per sale): follow it, with its own token.
  assert.deepEqual(deliveredPixel(main, "1314625690797063", [clicked]), { pixelId: "1314625690797063", accessToken: "adset-token", testEventCode: null });
  // Purchase on the main Pixel, or no Purchase on record: the main Pixel.
  assert.deepEqual(deliveredPixel(main, "1584729439695996", [clicked]), { pixelId: "1584729439695996", accessToken: "main-token", testEventCode: null });
  assert.deepEqual(deliveredPixel(main, null, [clicked]), { pixelId: "1584729439695996", accessToken: "main-token", testEventCode: null });
  // That Pixel is no longer on the link, is paused, or has no token: the main Pixel, never nothing.
  assert.equal(deliveredPixel(main, "1314625690797063", []).pixelId, "1584729439695996");
  assert.equal(deliveredPixel(main, "1314625690797063", [{ ...clicked, paused: true }]).pixelId, "1584729439695996");
  assert.equal(deliveredPixel(main, "1314625690797063", [{ ...clicked, token: null }]).pixelId, "1584729439695996");
  // A Pixel marked Testing sends to Meta's Test Events tab.
  assert.equal(deliveredPixel(main, "1314625690797063", [{ ...clicked, testing: true, testEventCode: "TEST123" }]).testEventCode, "TEST123");
});
