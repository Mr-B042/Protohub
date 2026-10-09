import assert from "node:assert/strict";
import test from "node:test";
import { allocateWaybillWeek } from "./waybill-costs.js";

test("a ₦45,000 weekly total with ₦8,000 paid from the wallet books ₦37,000 more (₦45,000 once)", () => {
  const r = allocateWaybillWeek([{ id: "t", declared: 45000, productId: "rack" }], [{ id: "w", amount: 8000, productId: "rack" }]);
  assert.equal(r.booked.get("t"), 37000);
  assert.equal(r.unmatchedWallet, 0);
});

test("a typed total with no product takes the wallet payments of any product", () => {
  const r = allocateWaybillWeek([{ id: "t", declared: 45000, productId: null }], [{ id: "a", amount: 8000, productId: "rack" }, { id: "b", amount: 5000, productId: null }]);
  assert.equal(r.booked.get("t"), 32000);
});

test("each product's total takes its own wallet payments first", () => {
  const r = allocateWaybillWeek(
    [{ id: "rack", declared: 45000, productId: "rack" }, { id: "shelf", declared: 30000, productId: "shelf" }],
    [{ id: "a", amount: 8000, productId: "rack" }, { id: "b", amount: 9000, productId: "shelf" }]
  );
  assert.equal(r.booked.get("rack"), 37000);
  assert.equal(r.booked.get("shelf"), 21000);
});

test("wallet payments above the typed total never make it negative; the extra is reported", () => {
  const r = allocateWaybillWeek([{ id: "t", declared: 45000, productId: "rack" }], [{ id: "a", amount: 50000, productId: "rack" }]);
  assert.equal(r.booked.get("t"), 0);
  assert.equal(r.unmatchedWallet, 5000);
});

test("no typed total: the wallet payment stands as the cost (nothing absorbed)", () => {
  const r = allocateWaybillWeek([], [{ id: "a", amount: 13500, productId: "rack" }]);
  assert.equal(r.unmatchedWallet, 13500);
});
