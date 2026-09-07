import assert from "node:assert/strict";
import test from "node:test";
import { atomicInventoryPayload, InventoryMovementError } from "./inventory-movements.js";

test("an order's component deductions become one stable atomic batch", () => {
  const payload = atomicInventoryPayload([
    {
      productId: "11111111-1111-4111-8111-111111111111",
      productName: "Shelf",
      type: "Order Fulfilled",
      quantity: 3,
      sourceScope: "agent_location",
      sourceAgentLocationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      orderId: "ORD-100",
      idempotencyKey: "order:ORD-100:delivery:1:shelf"
    },
    {
      productId: "22222222-2222-4222-8222-222222222222",
      productName: "Glue",
      type: "Order Fulfilled",
      quantity: 3,
      sourceScope: "agent_location",
      sourceAgentLocationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      orderId: "ORD-100",
      idempotencyKey: "order:ORD-100:delivery:1:glue"
    }
  ]);

  assert.equal(payload.length, 2);
  assert.deepEqual(payload.map((line) => line.quantity), [3, 3]);
  assert.deepEqual(payload.map((line) => line.ledgerQuantity), [3, 3]);
  assert.ok(payload.every((line) => line.sourceScope === "agent_location"));
});
test("signed corrections retain their ledger sign", () => {
  const [line] = atomicInventoryPayload([{
    productId: "11111111-1111-4111-8111-111111111111",
    type: "Correction",
    quantity: 4,
    ledgerQuantity: -4,
    sourceScope: "warehouse",
    idempotencyKey: "manual:one"
  }]);
  assert.equal(line.quantity, 4);
  assert.equal(line.ledgerQuantity, -4);
});

test("duplicate retry keys are rejected before reaching the database", () => {
  assert.throws(() => atomicInventoryPayload([
    {
      productId: "11111111-1111-4111-8111-111111111111",
      type: "Return",
      quantity: 1,
      destinationScope: "warehouse",
      idempotencyKey: "same"
    },
    {
      productId: "22222222-2222-4222-8222-222222222222",
      type: "Return",
      quantity: 1,
      destinationScope: "warehouse",
      idempotencyKey: "same"
    }
  ]), (error: unknown) => error instanceof InventoryMovementError && error.code === "DUPLICATE_INVENTORY_KEY");
});
