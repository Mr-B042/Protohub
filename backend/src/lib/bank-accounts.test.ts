import assert from "node:assert/strict";
import test from "node:test";
import { computeAccountBalances, summariseAccounts, unassignedTotal } from "./bank-accounts.js";

const accounts = [
  { id: "opay", openingBalance: 100_000 },
  { id: "moniepoint", openingBalance: 50_000 }
];

test("opening balances stand when nothing has moved", () => {
  const balances = computeAccountBalances(accounts, [], []);
  assert.equal(balances.find((row) => row.accountId === "opay")?.currentBalance, 100_000);
  assert.equal(balances.find((row) => row.accountId === "moniepoint")?.availableBalance, 50_000);
});

test("assigned cash moves only its own account", () => {
  const balances = computeAccountBalances(accounts, [
    { accountId: "opay", cashIn: 20_000, cashOut: 0 },
    { accountId: "opay", cashIn: 0, cashOut: 5_000 }
  ], []);
  assert.equal(balances.find((row) => row.accountId === "opay")?.currentBalance, 115_000);
  assert.equal(balances.find((row) => row.accountId === "moniepoint")?.currentBalance, 50_000);
});

test("unassigned cash touches no account balance", () => {
  // It still exists - it is reported separately - but it cannot be attributed.
  const balances = computeAccountBalances(accounts, [{ accountId: null, cashIn: 900_000, cashOut: 0 }], []);
  assert.equal(balances.find((row) => row.accountId === "opay")?.currentBalance, 100_000);
});

test("unassigned cash is reported as its own total", () => {
  assert.equal(unassignedTotal([
    { accountId: null, cashIn: 900_000, cashOut: 0 },
    { accountId: null, cashIn: 0, cashOut: 100_000 },
    { accountId: "opay", cashIn: 5_000, cashOut: 0 }
  ]), 800_000);
});

// ── Transfers ─────────────────────────────────────────────

test("a cleared transfer moves money without creating or destroying any", () => {
  const balances = computeAccountBalances(accounts, [], [
    { fromAccountId: "opay", toAccountId: "moniepoint", amount: 30_000, clearedAt: "2026-08-22T10:00:00Z" }
  ]);
  const opay = balances.find((row) => row.accountId === "opay")!;
  const moniepoint = balances.find((row) => row.accountId === "moniepoint")!;
  assert.equal(opay.currentBalance, 70_000);
  assert.equal(moniepoint.currentBalance, 80_000);
  // The company total is unchanged - this is not cash flow.
  assert.equal(opay.currentBalance + moniepoint.currentBalance, 150_000);
});

test("an uncleared transfer has already left the sender", () => {
  const balances = computeAccountBalances(accounts, [], [
    { fromAccountId: "opay", toAccountId: "moniepoint", amount: 30_000, clearedAt: null }
  ]);
  const opay = balances.find((row) => row.accountId === "opay")!;
  assert.equal(opay.currentBalance, 70_000);
  assert.equal(opay.availableBalance, 70_000);
  assert.equal(opay.pendingOut, 30_000);
});

test("an uncleared transfer is not spendable on the receiving side yet", () => {
  const balances = computeAccountBalances(accounts, [], [
    { fromAccountId: "opay", toAccountId: "moniepoint", amount: 30_000, clearedAt: null }
  ]);
  const moniepoint = balances.find((row) => row.accountId === "moniepoint")!;
  // Counted in current so the money is not invisible, held out of available.
  assert.equal(moniepoint.currentBalance, 80_000);
  assert.equal(moniepoint.availableBalance, 50_000);
  assert.equal(moniepoint.pendingIn, 30_000);
});

test("a transfer to a deleted or unknown account does not vanish from the sender", () => {
  const balances = computeAccountBalances(accounts, [], [
    { fromAccountId: "opay", toAccountId: "gone", amount: 10_000, clearedAt: null }
  ]);
  assert.equal(balances.find((row) => row.accountId === "opay")?.currentBalance, 90_000);
});

test("a zero or negative transfer is ignored rather than reversing a balance", () => {
  const balances = computeAccountBalances(accounts, [], [
    { fromAccountId: "opay", toAccountId: "moniepoint", amount: 0, clearedAt: null },
    { fromAccountId: "opay", toAccountId: "moniepoint", amount: -500, clearedAt: null }
  ]);
  assert.equal(balances.find((row) => row.accountId === "opay")?.currentBalance, 100_000);
});

// ── Summary strip ─────────────────────────────────────────

test("cash in hand is split out from bank balances", () => {
  const kinds = [
    { id: "opay", kind: "bank" as const },
    { id: "moniepoint", kind: "bank" as const },
    { id: "drawer", kind: "cash" as const }
  ];
  const balances = computeAccountBalances(
    [...accounts, { id: "drawer", openingBalance: 25_000 }], [], []
  );
  const totals = summariseAccounts(kinds, balances);
  assert.equal(totals.totalBank, 150_000);
  assert.equal(totals.cashInHand, 25_000);
  assert.equal(totals.totalLiquid, 175_000);
});

test("money in flight is counted once, on the receiving side", () => {
  const kinds = [{ id: "opay", kind: "bank" as const }, { id: "moniepoint", kind: "bank" as const }];
  const balances = computeAccountBalances(accounts, [], [
    { fromAccountId: "opay", toAccountId: "moniepoint", amount: 30_000, clearedAt: null }
  ]);
  const totals = summariseAccounts(kinds, balances);
  assert.equal(totals.pendingToClear, 30_000);
  // In flight or not, the company still holds the same money.
  assert.equal(totals.totalLiquid, 150_000);
});
