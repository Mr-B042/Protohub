import assert from "node:assert/strict";
import test from "node:test";
import {
  CLOSE_CHECKS, freeOperatingCash, summariseClose, summariseProfit, type EvaluatedCheck
} from "./period-close.js";

const evaluate = (over: Partial<EvaluatedCheck> = {}): EvaluatedCheck => ({
  key: "k", group: "trading", label: "A check", kind: "computed",
  required: true, done: true, evidence: "", ...over
});

test("every check has a unique key", () => {
  const keys = CLOSE_CHECKS.map((check) => check.key);
  assert.equal(new Set(keys).size, keys.length);
});

test("the checklist carries both computed facts and manual claims", () => {
  assert.ok(CLOSE_CHECKS.some((check) => check.kind === "computed"));
  assert.ok(CLOSE_CHECKS.some((check) => check.kind === "manual"));
});

// The whole point of the mixed model: a claim must never masquerade as a fact.
test("no computed check is also marked manual", () => {
  CLOSE_CHECKS.forEach((check) => {
    assert.ok(check.kind === "computed" || check.kind === "manual");
  });
});

test("progress counts computed and manual separately", () => {
  const progress = summariseClose([
    evaluate({ key: "a", kind: "computed", done: true }),
    evaluate({ key: "b", kind: "computed", done: false, required: false }),
    evaluate({ key: "c", kind: "manual", done: true, required: false })
  ]);
  assert.equal(progress.computedTotal, 2);
  assert.equal(progress.computedDone, 1);
  assert.equal(progress.manualTotal, 1);
  assert.equal(progress.manualDone, 1);
  assert.equal(progress.completed, 2);
  assert.equal(progress.progressPct, 67);
});

test("a week with every required check green can close", () => {
  const progress = summariseClose([
    evaluate({ key: "a", required: true, done: true }),
    evaluate({ key: "b", required: true, done: true })
  ]);
  assert.equal(progress.canClose, true);
  assert.equal(progress.blocking.length, 0);
});

test("one failing required check blocks the close", () => {
  const progress = summariseClose([
    evaluate({ key: "a", required: true, done: true }),
    evaluate({ key: "b", required: true, done: false })
  ]);
  assert.equal(progress.canClose, false);
  assert.deepEqual(progress.blocking.map((row) => row.key), ["b"]);
});

// A gap the business has never tracked must not make the week uncloseable.
test("an advisory check left red warns without blocking", () => {
  const progress = summariseClose([
    evaluate({ key: "required", required: true, done: true }),
    evaluate({ key: "stock_purchases_recorded", required: false, done: false })
  ]);
  assert.equal(progress.canClose, true);
  assert.equal(progress.completed, 1);
  assert.equal(progress.blocking.length, 0);
});

test("stock purchases is advisory, since it has no data source at all", () => {
  const check = CLOSE_CHECKS.find((entry) => entry.key === "stock_purchases_recorded");
  assert.equal(check?.required, false);
});

test("the cash-critical checks are required, not advisory", () => {
  ["opening_cash_counted", "bank_balances_verified", "variances_resolved", "reserves_not_overcommitted"]
    .forEach((key) => {
      assert.equal(CLOSE_CHECKS.find((check) => check.key === key)?.required, true, key);
    });
});

test("an empty checklist cannot close a week by vacuous truth", () => {
  const progress = summariseClose([]);
  assert.equal(progress.total, 0);
  assert.equal(progress.progressPct, 0);
});

// Neither stock nor agent-held cash can pay a bill on Monday.
test("free operating cash excludes inventory and COD with agents", () => {
  const free = freeOperatingCash({ totalLiquidCash: 2_480_000, reservedCash: 1_000_000 });
  assert.equal(free, 1_480_000);
});

test("reserving more than is held reports negative free cash, not zero", () => {
  assert.equal(freeOperatingCash({ totalLiquidCash: 500_000, reservedCash: 900_000 }), -400_000);
});

test("no reserves leaves the whole liquid balance free", () => {
  assert.equal(freeOperatingCash({ totalLiquidCash: 2_480_000, reservedCash: 0 }), 2_480_000);
});

test("profit walks revenue down through cogs and opex", () => {
  const profit = summariseProfit({ totalRevenue: 6_750_000, totalCogs: 3_600_000, operatingExpenses: 2_650_000 });
  assert.equal(profit.grossProfit, 3_150_000);
  assert.equal(profit.netProfit, 500_000);
  assert.equal(profit.netMarginPct, 7.41);
});

test("a loss-making week reports a negative margin rather than hiding it", () => {
  const profit = summariseProfit({ totalRevenue: 1_000_000, totalCogs: 800_000, operatingExpenses: 500_000 });
  assert.equal(profit.netProfit, -300_000);
  assert.equal(profit.netMarginPct, -30);
});

test("a week with no revenue does not divide by zero", () => {
  const profit = summariseProfit({ totalRevenue: 0, totalCogs: 0, operatingExpenses: 50_000 });
  assert.equal(profit.netProfit, -50_000);
  assert.equal(profit.netMarginPct, 0);
});

test("non-numeric input reads as zero rather than NaN", () => {
  const profit = summariseProfit({ totalRevenue: "x", totalCogs: null, operatingExpenses: undefined });
  assert.equal(profit.netProfit, 0);
  assert.equal(profit.grossProfit, 0);
});
