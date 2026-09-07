import assert from "node:assert/strict";
import test from "node:test";
import { availableAfterDeliveredReservations } from "./delivered-stock-reservations.js";

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
