import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_FUND_SETTINGS, customerPaymentEffect, fundTotals, fundsEditable, fundsReadiness, logisticsSplit, missingProof, equalSplit, splitProblem, scaleSplits, claimableRemittances, heldOrders, type FundTxn
} from "./manager-funds.js";

const txn = (overrides: Partial<FundTxn>): FundTxn => ({
  id: "t", kind: "expense", category: "logistics", amount: 1000, occurredAt: "2026-09-14T10:00:00Z",
  status: "recorded", reference: null, orderIds: [], description: "x", evidenceCount: 0, ...overrides
});

test("Bright's example: opening + received - spent - remitted = expected", () => {
  const totals = fundTotals(3900, [
    txn({ kind: "customer_payment", category: null, amount: 285800, orderIds: ["4343"] }),
    txn({ kind: "owner_funding", category: null, amount: 150000, reference: "TRF-1" }),
    txn({ kind: "company_transfer_in", category: null, amount: 20000 }),
    txn({ kind: "expense", category: "logistics", amount: 17000 }),
    txn({ kind: "expense", category: "meta_ads", amount: 23800, evidenceCount: 1 }),
    txn({ kind: "expense", category: "airtime_data", amount: 5000 }),
    txn({ kind: "expense", category: "packaging", amount: 4200 }),
    txn({ kind: "expense", category: "office", amount: 3500 }),
    txn({ kind: "expense", category: "miscellaneous", amount: 7700 }),
    txn({ kind: "remittance_out", category: null, amount: 350000, evidenceCount: 1 })
  ], 48500, DEFAULT_FUND_SETTINGS);
  assert.equal(totals.received, 455800);
  assert.equal(totals.spent, 61200);
  assert.equal(totals.remitted, 350000);
  assert.equal(totals.expected, 48500);
  assert.equal(totals.variance, 0);
});

test("a remittance is never an expense, and a voided entry counts for nothing", () => {
  const totals = fundTotals(0, [
    txn({ kind: "customer_payment", category: null, amount: 100000, orderIds: ["1"] }),
    txn({ kind: "remittance_out", category: null, amount: 80000, evidenceCount: 1 }),
    txn({ kind: "expense", amount: 5000, status: "voided" })
  ], 20000, DEFAULT_FUND_SETTINGS);
  assert.equal(totals.spent, 0);
  assert.equal(totals.remitted, 80000);
  assert.equal(totals.expected, 20000);
});

test("variance is actual minus expected: short money is negative", () => {
  const totals = fundTotals(0, [txn({ kind: "customer_payment", category: null, amount: 48500, orderIds: ["1"] })], 46500, DEFAULT_FUND_SETTINGS);
  assert.equal(totals.variance, -2000);
  assert.deepEqual(fundsReadiness(totals, ""), ["Explain the difference between the expected and actual balance."]);
  // A big expense with no receipt does not hold the week up by default.
  const withExpense = fundTotals(60000, [txn({ amount: 50000 })], 10000, DEFAULT_FUND_SETTINGS);
  assert.equal(withExpense.pending, 0);
  assert.deepEqual(fundsReadiness(totals, "Paid a rider in cash, receipt lost"), []);
});

test("by default receipts are optional: nothing blocks for a missing receipt", () => {
  assert.equal(missingProof(txn({ amount: 500000 }), DEFAULT_FUND_SETTINGS), null);
  assert.equal(missingProof(txn({ kind: "remittance_out", category: null }), DEFAULT_FUND_SETTINGS), null);
  assert.equal(missingProof(txn({ kind: "owner_funding", category: null }), DEFAULT_FUND_SETTINGS), null);
  assert.equal(missingProof(txn({ kind: "other_in", category: null, description: "Refund from packaging supplier" }), DEFAULT_FUND_SETTINGS), null);
  // Explanations are not receipts and are still needed.
  assert.equal(missingProof(txn({ kind: "other_in", category: null, description: "refund" }), DEFAULT_FUND_SETTINGS), "Explanation required");
  assert.equal(missingProof(txn({ kind: "customer_payment", category: null }), DEFAULT_FUND_SETTINGS), "Order number required");
  assert.equal(missingProof(txn({ category: "other", description: "" }), DEFAULT_FUND_SETTINGS), "Explain what 'Other' was");
});

test("if the owner switches the rules on, receipts become required", () => {
  const strict = { expenseProofMin: 10000, remittanceProofRequired: true, ownerFundingReferenceRequired: true, otherInProofRequired: true };
  assert.equal(missingProof(txn({ amount: 9999 }), strict), null);
  assert.equal(missingProof(txn({ amount: 10000 }), strict), "Receipt required");
  assert.equal(missingProof(txn({ amount: 10000, evidenceCount: 1 }), strict), null);
  assert.equal(missingProof(txn({ kind: "remittance_out", category: null }), strict), "Transfer proof required");
  assert.equal(missingProof(txn({ kind: "owner_funding", category: null, reference: "TRF-9" }), strict), null);
});

test("nothing changes once the week is with the owner or locked", () => {
  assert.equal(fundsEditable("open", false).ok, true);
  assert.equal(fundsEditable("returned_to_manager", false).ok, true);
  assert.equal(fundsEditable(null, false).ok, true);
  assert.equal(fundsEditable("submitted_to_owner", false).ok, false);
  assert.equal(fundsEditable("locked", false).ok, false);
  assert.equal(fundsEditable("open", true).ok, false);
});

test("a customer payment follows the order screen's remittance rules", () => {
  const base = { orderAmount: 34500, logisticsCost: 0, alreadyRemitted: 0, orderStatus: "Delivered", remittanceStatus: "Pending", editOpen: false, role: "Manager" };
  const exact = customerPaymentEffect({ ...base, payment: 34500 });
  assert.equal(exact.ok, true);
  if (exact.ok) assert.equal(exact.nextStatus, "Paid");
  assert.equal(customerPaymentEffect({ ...base, payment: 20000 }).ok, false);
  assert.equal(customerPaymentEffect({ ...base, payment: 40000 }).ok, false);
  const adminPart = customerPaymentEffect({ ...base, payment: 20000, role: "Admin" });
  assert.equal(adminPart.ok, true);
  if (adminPart.ok) { assert.equal(adminPart.nextStatus, "Partial"); assert.equal(adminPart.needsReason, true); }
  assert.equal(customerPaymentEffect({ ...base, payment: 1, remittanceStatus: "Paid" }).ok, false);
  // Agent already deducted a fee: expected is amount - fee.
  assert.equal(customerPaymentEffect({ ...base, logisticsCost: 3500, payment: 31000 }).ok, true);
});

test("claimableRemittances: an already-paid order's payment can move into the wallet once", () => {
  const wallets = new Set(["wallet-grace", "wallet-ada"]);
  const rows = [
    { id: "r1", amount: 39500, accountId: "company-bank" },
    { id: "r2", amount: 0, accountId: null }
  ];
  assert.deepEqual(claimableRemittances(rows, wallets, new Set()).total, 39500);
  // Already in someone's wallet: nothing to move.
  assert.equal(claimableRemittances([{ id: "r1", amount: 39500, accountId: "wallet-ada" }], wallets, new Set()).total, 0);
  // Already moved by another live wallet entry: not moved twice.
  assert.equal(claimableRemittances(rows, wallets, new Set(["r1"])).total, 0);
  // A payment and its reversal net to nothing.
  assert.equal(claimableRemittances([
    { id: "a", amount: 39500, accountId: null }, { id: "b", amount: -39500, accountId: null }
  ], wallets, new Set()).rows.length, 0);
});

test("logisticsSplit: only the part above the orders' fees is a new cost", () => {
  assert.deepEqual(logisticsSplit(10000, 9000, 0), { counted: 9000, newCost: 1000 });
  assert.deepEqual(logisticsSplit(5000, 9000, 0), { counted: 5000, newCost: 0 });
  assert.deepEqual(logisticsSplit(5000, 9000, 6000), { counted: 3000, newCost: 2000 });
  assert.deepEqual(logisticsSplit(5000, 0, 0), { counted: 0, newCost: 5000 });
  assert.deepEqual(logisticsSplit(5000, 4000, 9000), { counted: 0, newCost: 5000 });
});

test("waybill shared by products: equal shares add up to the payment", () => {
  assert.deepEqual(equalSplit(9000, 3), [3000, 3000, 3000]);
  assert.deepEqual(equalSplit(10000, 3), [3333.33, 3333.33, 3333.34]);
  assert.deepEqual(equalSplit(9000, 1), [9000]);
});

test("waybill shared by products: shares must add up, products once", () => {
  assert.equal(splitProblem([{ productId: "a", amount: 5000 }, { productId: "b", amount: 4000 }], 9000), null);
  assert.match(splitProblem([{ productId: "a", amount: 5000 }, { productId: "b", amount: 3000 }], 9000) ?? "", /add up/);
  assert.match(splitProblem([{ productId: "a", amount: 4500 }, { productId: "a", amount: 4500 }], 9000) ?? "", /once/);
  assert.match(splitProblem([{ productId: "a", amount: 9000 }, { productId: "b", amount: 0 }], 9000) ?? "", /above zero/);
});

test("waybill shared by products: a new amount keeps each product's proportion", () => {
  assert.deepEqual(scaleSplits([{ productId: "a", amount: 6000 }, { productId: "b", amount: 3000 }], 12000), [{ productId: "a", amount: 8000 }, { productId: "b", amount: 4000 }]);
  const scaled = scaleSplits([{ productId: "a", amount: 1 }, { productId: "b", amount: 1 }, { productId: "c", amount: 1 }], 100);
  assert.equal(Math.round(scaled.reduce((sum, split) => sum + split.amount, 0) * 100), 10000);
});

test("heldOrders: cleared orders not in a wallet, grouped, newest first", () => {
  const wallets = new Set(["wallet-manager"]);
  const row = (id: string, orderId: string, amount: number, accountId: string | null, receivedAt: string) =>
    ({ id, orderId, amount, accountId, receivedAt, customer: `C${orderId}`, product: "Shelf" });
  const rows = [
    row("r1", "5598", 13000, null, "2026-10-28T11:00:00Z"),
    row("r2", "5516", 12000, null, "2026-10-27T11:00:00Z"),
    row("r3", "5516", 500, "company", "2026-10-27T12:00:00Z"),
    row("r4", "5677", 13500, "wallet-manager", "2026-10-28T12:00:00Z"), // already in her wallet
    row("r5", "5680", 10000, null, "2026-10-28T10:00:00Z"),            // already moved by an entry
    row("r6", "5700", 9000, null, "2026-10-28T09:00:00Z"),
    row("r7", "5700", -9000, null, "2026-10-28T09:30:00Z")              // paid then reversed
  ];
  const held = heldOrders(rows, wallets, new Set(["r5"]));
  assert.deepEqual(held.map((order) => [order.orderId, order.total]), [["5598", 13000], ["5516", 12500]]);
  assert.deepEqual(held[1].rows.map((r) => r.id), ["r2", "r3"]);
});
