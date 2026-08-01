import assert from "node:assert/strict";
import test from "node:test";
import { isCostedLossReason } from "./stock-loss-expense.js";

test("returned stock is not a loss", () => {
  // Those units came back and are still ours - charging for them would invent
  // a cost that never happened.
  assert.equal(isCostedLossReason("Return to Warehouse"), false);
});

test("damage, theft and unreported sales all cost money", () => {
  // Each of these means units left the business without a recorded sale, so
  // their cost was never recognised as COGS anywhere else.
  for (const reason of ["Damaged", "Theft", "Unreported Sale", "Other", "Missing", "Damaged and missing"]) {
    assert.equal(isCostedLossReason(reason), true, `${reason} should be costed`);
  }
});
