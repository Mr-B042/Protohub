import test from "node:test";
import assert from "node:assert/strict";
import { approverFor, canApprove, checkStatusFor, departmentOf, nextRequestCode, parseExpenseCsv, paymentSourceOf } from "./expense-intel-rules.js";

test("approver by amount: Manager ≤25k, Admin ≤100k, Owner above", () => {
  assert.equal(approverFor(5_000), "Manager");
  assert.equal(approverFor(25_000), "Manager");
  assert.equal(approverFor(25_001), "Admin");
  assert.equal(approverFor(150_000), "Owner");
});

test("higher roles may approve lower amounts; others never", () => {
  assert.equal(canApprove("Owner", 1_000), true);
  assert.equal(canApprove("Admin", 80_000), true);
  assert.equal(canApprove("Manager", 80_000), false);
  assert.equal(canApprove("Accountant", 100), false);
  assert.equal(canApprove("Admin", 150_000), false);
});

test("system rows stay auto whoever saves them; reps' rows unchecked", () => {
  assert.equal(checkStatusFor("EXP-DEL-5803", "Sales Rep"), "auto");
  assert.equal(checkStatusFor("ads-auto-meta-x", "Owner"), "auto");
  assert.equal(checkStatusFor("exp-abc", "Manager"), "verified");
  assert.equal(checkStatusFor("EXP-123", "Inventory Manager & Logistics Operations"), "unchecked");
});

test("payment source from how the row was made", () => {
  assert.equal(paymentSourceOf({ id: "MGRF-1" }), "Manager Wallet");
  assert.equal(paymentSourceOf({ id: "EXP-DEL-1" }), "Agent");
  assert.equal(paymentSourceOf({ id: "SAL-WEEKLY-2026-10-W1" }), "Payroll");
  assert.equal(paymentSourceOf({ id: "exp-1", paid_by: "Supplier (Guangzhou)" }), "Supplier");
  assert.equal(paymentSourceOf({ id: "exp-1", paid_by: "Bright" }), "Company");
});

test("departments by category, overridable", () => {
  assert.equal(departmentOf("Waybill"), "Operations & Fulfillment");
  assert.equal(departmentOf("Ad Spend"), "Marketing & Growth");
  assert.equal(departmentOf("Bonuses & Incentives"), "Sales & Customer Support");
  assert.equal(departmentOf("Clearing & Shipping"), "Inventory & Procurement");
  assert.equal(departmentOf("Airtime & Data"), "Administration");
  assert.equal(departmentOf("Other", { Other: "Administration" }), "Administration");
});

test("request codes count up", () => {
  assert.equal(nextRequestCode([]), "EXP-REQ-0001");
  assert.equal(nextRequestCode(["EXP-REQ-0009", "EXP-REQ-0002"]), "EXP-REQ-0010");
});

test("CSV import: header skipped, both date styles, problems by line", () => {
  const { rows, problems } = parseExpenseCsv('date,category,amount,description\n2026-10-31,Waybill,"63,700",Shelf to Abuja\n31/10/2026,Other,₦5000,Ink\nbad,Other,10,x\n2026-10-01,Other,0,zero');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].amount, 63_700);
  assert.equal(rows[1].date, "2026-10-31");
  assert.equal(problems.length, 2);
});
