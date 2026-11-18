import assert from "node:assert/strict";
import test from "node:test";
import { nairaFactor, orderInNaira } from "./pay-currency.js";

const rates = new Map([["ZMW", 61]]); // ₦61 per K1 (Bright, 18 Nov 2026)

test("a Zambia order's money is read in naira for pay; the saved row is untouched", () => {
  const order = { id: "z1", currency: "ZMW", amount: 1180, original_amount: 600, logistics_cost: 50, quantity: 10,
    cross_sell_lines: [{ productId: "p", quantity: 1, amount: 100 }] };
  const pay = orderInNaira(order, rates);
  assert.equal(pay.amount, 71980);            // K1,180 × 61
  assert.equal(pay.original_amount, 36600);
  assert.equal(pay.logistics_cost, 3050);
  assert.equal(pay.quantity, 10);             // counts never change
  assert.equal(pay.cross_sell_lines[0].amount, 6100);
  assert.equal(pay.currency, "NGN");
  assert.equal(order.amount, 1180);           // original row is not changed
  assert.equal(order.cross_sell_lines[0].amount, 100);
});

test("naira orders and orders with no known rate are left as they are", () => {
  const ng = { id: "n1", currency: "NGN", amount: 26500 };
  assert.equal(orderInNaira(ng, rates), ng);
  const gh = { id: "g1", currency: "GHS", amount: 300 };
  assert.equal(orderInNaira(gh, rates), gh);
  assert.equal(nairaFactor("ZMW", rates), 61);
  assert.equal(nairaFactor(undefined, rates), 1);
});

test("a 5% upfront bonus on a K1,180 order pays the naira value, not ₦59", () => {
  const pay = orderInNaira({ id: "z2", currency: "ZMW", amount: 1180 }, rates);
  assert.equal(Math.round(pay.amount * 0.05), 3599);
});
