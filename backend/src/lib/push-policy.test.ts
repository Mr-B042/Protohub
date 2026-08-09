import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { boundedPushTag, deliveryPolicyForPush, preparePushPayload } from "./push-policy.js";

describe("push delivery policy", () => {
  it("keeps real-time order alerts short-lived", () => {
    assert.deepEqual(deliveryPolicyForPush({ kind: "order_new" }), {
      collapseGroup: "orders",
      ttlSeconds: 1800
    });
  });

  it("gives operational alerts a longer finite window", () => {
    assert.deepEqual(deliveryPolicyForPush({ kind: "low_stock" }), {
      collapseGroup: "operations",
      ttlSeconds: 21600
    });
  });

  it("maps unlimited event ids into sixteen stable tray slots", () => {
    const tags = new Set<string>();
    for (let index = 0; index < 500; index += 1) {
      tags.add(boundedPushTag({ kind: "order_new", tag: `order-${index}-new` }));
      tags.add(boundedPushTag({ kind: "abandoned_cart_new", tag: `cart-${index}` }));
      tags.add(boundedPushTag({ kind: "low_stock", tag: `stock-${index}` }));
      tags.add(boundedPushTag({ kind: "info", tag: `info-${index}` }));
    }
    assert.equal(tags.size, 16);
    assert.ok([...tags].every((tag) => /^protohub-(orders|customer|operations|general)-[0-3]$/.test(tag)));
  });

  it("adds one event timestamp and does not remap an already prepared tag", () => {
    const prepared = preparePushPayload({ kind: "order_new", tag: "order-22-new", title: "New order" }, 1234);
    assert.equal(prepared.timestamp, 1234);
    assert.equal(preparePushPayload(prepared, 9999).timestamp, 1234);
    assert.equal(preparePushPayload(prepared, 9999).tag, prepared.tag);
  });
});
