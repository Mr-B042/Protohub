import assert from "node:assert/strict";
import test from "node:test";
import { availableAfterDeliveredReservations, deliveredStockShortfallMessage } from "./delivered-stock-reservations.js";

test("pending delivered orders reserve stock without changing the physical balance", () => {
  const available = availableAfterDeliveredReservations(
    [{ product_id: "brush", quantity: 50 }],
    [{ product_id: "brush", quantity: 6 }, { product_id: "brush", quantity: 3 }]
  );
  assert.equal(available.get("brush"), 41);
});

test("reservations are isolated by product", () => {
  const available = availableAfterDeliveredReservations(
    [{ product_id: "shelf", quantity: 20 }, { product_id: "glue", quantity: 10 }],
    [{ product_id: "shelf", quantity: 5 }, { product_id: "glue", quantity: 2 }]
  );
  assert.deepEqual([...available], [["shelf", 15], ["glue", 8]]);
});

test("over-committed stock never appears as negative availability", () => {
  const available = availableAfterDeliveredReservations(
    [{ product_id: "hanger", quantity: 2 }],
    [{ product_id: "hanger", quantity: 4 }]
  );
  assert.equal(available.get("hanger"), 0);
});

test("shortfall message names the reserving order instead of claiming zero stock", () => {
  const message = deliveredStockShortfallMessage({
    agentName: "Ideal Logistics",
    hubName: "Rivers Hub",
    productName: "Multi Corner Storage Shelf",
    needed: 1,
    onShelf: 1,
    reservations: [{ orderId: "4750", quantity: 1 }]
  });
  assert.match(message, /Ideal Logistics \(Rivers Hub\) has 1 unit on the shelf/);
  assert.match(message, /1 unit is already reserved for order 4750/);
  assert.match(message, /0 units are free/);
  assert.doesNotMatch(message, /has 0 units/);
});

test("shortfall message without reservations reports the shelf count", () => {
  const message = deliveredStockShortfallMessage({
    agentName: "Ideal Logistics",
    productName: "Shelf",
    needed: 2,
    onShelf: 1,
    reservations: []
  });
  assert.match(message, /Ideal Logistics has 1 unit on the shelf/);
  assert.doesNotMatch(message, /reserved/);
});
