import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ALERT_TTL_SECONDS, TRAY_PLACES, deliveryPolicyForPush, isTrayTag, preparePushPayload, trayTagFor
} from "./push-policy.js";

describe("push delivery policy", () => {
  it("keeps every real alert waiting 24 hours for a phone with its data off", () => {
    for (const kind of ["order_new", "order_assigned", "abandoned_cart_new", "low_stock", "info"]) {
      assert.equal(deliveryPolicyForPush({ kind }).ttlSeconds, 24 * 60 * 60, kind);
    }
    assert.equal(ALERT_TTL_SECONDS, 86_400);
  });

  it("still lets a test push expire quickly", () => {
    assert.equal(deliveryPolicyForPush({ kind: "test_push" }).ttlSeconds, 120);
  });

  it("gives one phone all 40 places in turn before reusing any", () => {
    const phone = `web:https://fcm.example/phone-${Math.random()}`;
    const first40 = Array.from({ length: TRAY_PLACES }, () => trayTagFor(phone));
    assert.equal(new Set(first40).size, 40, "no place reused within 40 alerts");
    assert.ok(first40.every(isTrayTag));
    // The 41st alert takes the place of the 1st - the oldest, never a recent one.
    assert.equal(trayTagFor(phone), first40[0]);
    assert.equal(trayTagFor(phone), first40[1]);
  });

  it("keeps each phone's places separate", () => {
    const a = `native:device-a-${Math.random()}`;
    const b = `native:device-b-${Math.random()}`;
    const aTags = Array.from({ length: 10 }, () => trayTagFor(a));
    trayTagFor(b);
    trayTagFor(b);
    // Alerts to B do not move A along.
    const next = trayTagFor(a);
    const expected = `protohub-slot-${(Number(aTags[9].split("-").pop()) + 1) % TRAY_PLACES}`;
    assert.equal(next, expected);
  });

  it("stamps the event time once and keeps a caller's tag", () => {
    const prepared = preparePushPayload({ kind: "order_new", tag: "order-22-new", title: "New order" }, 1234);
    assert.equal(prepared.timestamp, 1234);
    assert.equal(preparePushPayload(prepared, 9999).timestamp, 1234);
    assert.equal(prepared.tag, "order-22-new");
  });
});
