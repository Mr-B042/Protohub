import test from "node:test";
import assert from "node:assert/strict";
import { deliveryExpenseFor } from "./order-delivery-expense.js";

const base = { id: "4610", customer: "Ada", currency: "NGN", product_id: "p1", created_at: "2026-09-27T09:00:00Z" };

test("no fee means no cost row", () => {
  assert.equal(deliveryExpenseFor({ ...base, status: "Failed", logistics_cost: 0 }, null, "2026-10-12"), null);
  assert.equal(deliveryExpenseFor({ ...base, status: "Delivered", logistics_cost: null }, null, "2026-10-12"), null);
});

test("a failed order's fee is a Failed Delivery cost on the day it failed", () => {
  const row = deliveryExpenseFor({ ...base, status: "Failed", logistics_cost: 5000 }, "2026-10-07", "2026-10-12");
  assert.equal(row?.id, "EXP-DEL-4610");
  assert.equal(row?.category, "Failed Delivery");
  assert.equal(row?.amount, 5000);
  assert.equal(row?.date, "2026-10-07");
});

test("a failed order with no known failed day is dated today, never the day it was placed", () => {
  const row = deliveryExpenseFor({ ...base, status: "Cancelled", logistics_cost: "2000" }, null, "2026-10-12");
  assert.equal(row?.category, "Failed Delivery");
  assert.equal(row?.date, "2026-10-12");
});

test("a delivered order's fee is a Delivery cost on its delivered date", () => {
  const row = deliveryExpenseFor({ ...base, status: "Delivered", logistics_cost: 3500, delivered_date: "2026-09-28" }, null, "2026-10-12");
  assert.equal(row?.category, "Delivery");
  assert.equal(row?.date, "2026-09-28");
});
