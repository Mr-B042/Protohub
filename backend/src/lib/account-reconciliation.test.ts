import assert from "node:assert/strict";
import test from "node:test";
import {
  adjustedBookBalance, adjustmentDelta, isReconciled, rawDifference, remainingDifference,
  summariseReconciliations, sumItems, unmatchedBookItems, varianceBand, type BookItem
} from "./account-reconciliation.js";

// The worked example from the design: books say 1,320,000, bank says 1,405,000.
test("difference is statement minus books, so extra bank money reads positive", () => {
  assert.equal(rawDifference(1_405_000, 1_320_000), 85_000);
});

test("a bank holding less than the books reads negative", () => {
  assert.equal(rawDifference(1_300_000, 1_320_000), -20_000);
});

// The same sign convention as Weekly Reconciliation: negative means missing.
test("the sign means the same thing here as on the weekly count", () => {
  const missing = rawDifference(900, 1000);
  assert.ok(missing < 0);
  const surplus = rawDifference(1100, 1000);
  assert.ok(surplus > 0);
});

test("a credit we never recorded raises what the books should say", () => {
  assert.equal(adjustmentDelta([{ amount: 10_000, direction: "in" }]), 10_000);
});

test("a bank charge lowers what the books should say", () => {
  assert.equal(adjustmentDelta([{ amount: 5_000, direction: "out" }]), -5_000);
});

test("adjustments net off against each other", () => {
  assert.equal(adjustmentDelta([
    { amount: 5_000, direction: "out" },
    { amount: 10_000, direction: "out" },
    { amount: 2_000, direction: "in" }
  ]), -13_000);
  assert.equal(adjustedBookBalance(1_320_000, [{ amount: 5_000, direction: "out" }]), 1_315_000);
});

test("no adjustments leaves the book balance alone", () => {
  assert.equal(adjustedBookBalance(1_320_000, []), 1_320_000);
  assert.equal(remainingDifference(1_405_000, 1_320_000, []), 85_000);
});

// The point of adjustments: explaining a gap should close it.
test("adjustments that explain the whole gap reconcile the account", () => {
  const remaining = remainingDifference(1_405_000, 1_320_000, [{ amount: 85_000, direction: "in" }]);
  assert.equal(remaining, 0);
  assert.equal(isReconciled(remaining), true);
});

test("a partial explanation leaves the rest outstanding", () => {
  const remaining = remainingDifference(1_405_000, 1_320_000, [{ amount: 60_000, direction: "in" }]);
  assert.equal(remaining, 25_000);
  assert.equal(isReconciled(remaining), false);
});

test("an adjustment pushed the wrong way widens the gap rather than hiding it", () => {
  assert.equal(remainingDifference(1_405_000, 1_320_000, [{ amount: 85_000, direction: "out" }]), 170_000);
});

test("float noise does not block a reconciliation", () => {
  assert.equal(isReconciled(0.2), true);
  assert.equal(isReconciled(-0.2), true);
  assert.equal(isReconciled(1), false);
});

test("variance bands split on the fifty thousand line", () => {
  assert.equal(varianceBand(0), "matched");
  assert.equal(varianceBand(35_500), "small");
  assert.equal(varianceBand(50_000), "small");
  assert.equal(varianceBand(50_001), "large");
  assert.equal(varianceBand(-85_000), "large");
});

const record = (over: Partial<Parameters<typeof summariseReconciliations>[0][number]> = {}) => ({
  id: "r", statementBalance: 1_000_000, bookBalance: 1_000_000,
  status: "reconciled" as const, adjustments: [], ...over
});

test("counts and percentages add up across statuses", () => {
  const summary = summariseReconciliations([
    record({ id: "a" }),
    record({ id: "b" }),
    record({ id: "c", status: "in_progress", statementBalance: 985_000 })
  ]);
  assert.equal(summary.total, 3);
  assert.equal(summary.reconciled, 2);
  assert.equal(summary.unreconciled, 1);
  assert.equal(summary.reconciledPct, 66.67);
});

// An account already at zero is not a backlog item.
test("an in-progress account with no gap is not counted as unreconciled", () => {
  const summary = summariseReconciliations([record({ status: "in_progress" })]);
  assert.equal(summary.inProgress, 1);
  assert.equal(summary.unreconciled, 0);
});

test("total variance counts only what is still unexplained", () => {
  const summary = summariseReconciliations([
    record({ id: "a", status: "in_progress", statementBalance: 1_015_000 }),
    record({ id: "b", status: "in_progress", statementBalance: 1_050_000 }),
    record({ id: "c" })
  ]);
  assert.equal(summary.varianceCount, 2);
  assert.equal(summary.totalVariance, 65_000);
});

test("variance already explained by adjustments drops out of the total", () => {
  const summary = summariseReconciliations([
    record({ id: "a", status: "in_progress", statementBalance: 1_015_000, adjustments: [{ amount: 15_000, direction: "in" }] })
  ]);
  assert.equal(summary.totalVariance, 0);
  assert.equal(summary.unreconciled, 0);
});

test("an empty month does not divide by zero", () => {
  const summary = summariseReconciliations([]);
  assert.equal(summary.total, 0);
  assert.equal(summary.reconciledPct, 0);
  assert.equal(summary.bands.large.sharePct, 0);
});

const item = (over: Partial<BookItem> = {}): BookItem => ({
  sourceType: "expense", sourceId: "e1", occurredOn: "2026-08-23",
  description: "Meta Ads Payment", amount: 150_000, direction: "out", ...over
});

test("matched movements drop out of the unmatched list", () => {
  const rows = unmatchedBookItems(
    [item({ sourceId: "e1" }), item({ sourceId: "e2" })],
    [{ sourceType: "expense", sourceId: "e1" }]
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].sourceId, "e2");
});

// Ids can collide across tables, so the type has to be part of the key.
test("an expense and a remittance sharing an id are not confused", () => {
  const rows = unmatchedBookItems(
    [item({ sourceType: "expense", sourceId: "shared" }), item({ sourceType: "remittance", sourceId: "shared" })],
    [{ sourceType: "expense", sourceId: "shared" }]
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].sourceType, "remittance");
});

// Derived live, so nothing added later can hide behind an old reconciliation.
test("a movement added after matching still shows as unmatched", () => {
  const rows = unmatchedBookItems(
    [item({ sourceId: "old" }), item({ sourceId: "added-later" })],
    [{ sourceType: "expense", sourceId: "old" }]
  );
  assert.deepEqual(rows.map((row) => row.sourceId), ["added-later"]);
});

test("unmatched totals sum what is left", () => {
  assert.equal(sumItems([item({ amount: 150_000 }), item({ amount: 320_000 })]), 470_000);
  assert.equal(sumItems([]), 0);
});
