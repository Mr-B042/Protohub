import assert from "node:assert/strict";
import test from "node:test";
import { alertSeesAdSpend, alertSeesCustomer } from "./alert-privacy.js";
import { seesBusinessMoney, seesCustomer } from "./telegram-rules.js";

test("customer details and ad spend: who may see them in an alert (6 Nov 2026)", () => {
  for (const role of ["Owner", "Admin", "Manager", "Sales Rep", "Recovery Rep", "Sales Closer"]) assert.equal(alertSeesCustomer(role), true, role);
  for (const role of ["Inventory Manager", "Inventory Manager & Logistics Operations", "Marketer", "Viewer", "Delivery Agent", "", null]) assert.equal(alertSeesCustomer(role as string), false, String(role));
  assert.deepEqual(["Owner", "Admin", "Manager", "Marketer"].map(alertSeesAdSpend), [true, true, false, false]);
});

test("Telegram uses the very same lists as the app's own alerts", () => {
  assert.equal(seesCustomer, alertSeesCustomer);
  assert.equal(seesBusinessMoney, alertSeesAdSpend);
});
