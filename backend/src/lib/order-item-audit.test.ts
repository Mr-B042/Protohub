import assert from "node:assert/strict";
import test from "node:test";
import { describeOrderItemChanges } from "./order-item-audit.js";

test("describes an add-on removal with quantity, price, and total", () => {
  const notes = describeOrderItemChanges({
    beforeLines: [{
      id: "XS-1",
      productName: "Shark Soap Holder",
      quantity: 5,
      amount: 10_000
    }],
    afterLines: [],
    beforeAmount: 26_500,
    afterAmount: 16_500,
    currency: "NGN"
  });

  assert.deepEqual(notes, [
    "Add-on removed: Shark Soap Holder x 5 for ₦10,000. Order total changed from ₦26,500 to ₦16,500."
  ]);
});

test("describes add-on quantity and price changes", () => {
  const notes = describeOrderItemChanges({
    beforeLines: [{ id: "XS-1", productName: "Soap Holder", quantity: 2, amount: 4_000 }],
    afterLines: [{ id: "XS-1", productName: "Soap Holder", quantity: 5, amount: 10_000 }],
    beforeAmount: 20_500,
    afterAmount: 26_500,
    currency: "NGN"
  });

  assert.deepEqual(notes, [
    "Add-on changed: Soap Holder, quantity 2 to 5, price ₦4,000 to ₦10,000. Order total changed from ₦20,500 to ₦26,500."
  ]);
});

test("describes free gift changes without a price", () => {
  const notes = describeOrderItemChanges({
    beforeLines: [],
    afterLines: [{ id: "FG-1", productName: "Adhesive Hook", quantity: 10 }],
    kind: "free gift"
  });

  assert.deepEqual(notes, ["Free gift added: Adhesive Hook x 10."]);
});
