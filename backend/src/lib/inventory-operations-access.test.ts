import assert from "node:assert/strict";
import test from "node:test";
import { inventoryOperationsOrder } from "./inventory-operations-access.js";

test("inventory operations order payload excludes customer and financial data", () => {
  const result = inventoryOperationsOrder({
    id: "ORD-1",
    customer: "Private Customer",
    phone: "08000000000",
    whatsapp: "08000000000",
    email: "private@example.com",
    address: "Private address",
    amount: 50_000,
    logistics_cost: 5_000,
    amount_remitted: 45_000,
    assigned_rep_id: "rep-private",
    product_id: "product-1",
    product_name: "Stock item",
    quantity: 3,
    status: "Confirmed",
    state: "Rivers"
  });

  assert.deepEqual(
    { productId: result.product_id, quantity: result.quantity, state: result.state },
    { productId: "product-1", quantity: 3, state: "Rivers" }
  );
  for (const sensitive of ["customer", "phone", "whatsapp", "email", "address", "amount", "logistics_cost", "amount_remitted", "assigned_rep_id"]) {
    assert.equal(Object.hasOwn(result, sensitive), false, `${sensitive} must not be returned`);
  }
});
