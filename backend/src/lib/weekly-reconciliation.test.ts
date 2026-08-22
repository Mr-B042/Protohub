import assert from "node:assert/strict";
import test from "node:test";
import {
  accountDifference,
  investigationProgress,
  isMatched,
  reconciliationStatus,
  summariseVerification
} from "./weekly-reconciliation.js";

// The worked example from the design: ₦2.6m expected, ₦2.48m counted.
const week = [
  { bankAccountId: "gt", accountLabel: "GTBank Operations", systemBalance: 1_320_000, actualBalance: 1_300_000 },
  { bankAccountId: "mp", accountLabel: "Moniepoint Collections", systemBalance: 800_000, actualBalance: 800_000 },
  { bankAccountId: "ac", accountLabel: "Access Bank Reserve", systemBalance: 300_000, actualBalance: 300_000 },
  { bankAccountId: null, accountLabel: "Cash in Hand", systemBalance: 180_000, actualBalance: 80_000 }
];

test("variance is actual minus expected, so missing money reads negative", () => {
  const summary = summariseVerification(week);
  assert.equal(summary.totalSystem, 2_600_000);
  assert.equal(summary.totalActual, 2_480_000);
  assert.equal(summary.variance, -120_000);
});

test("the account breakdown always adds up to the week variance", () => {
  const summary = summariseVerification(week);
  const sumOfLines = summary.lines.reduce((total, line) => total + line.difference, 0);
  assert.equal(sumOfLines, summary.variance);
});

test("each account is judged on its own, not on the week total", () => {
  const summary = summariseVerification(week);
  assert.equal(summary.matchedCount, 2);
  assert.equal(summary.mismatchedCount, 2);
  assert.equal(summary.lines.find((line) => line.accountLabel === "Cash in Hand")?.difference, -100_000);
  assert.equal(summary.lines.find((line) => line.accountLabel === "Moniepoint Collections")?.matched, true);
});

test("an empty count is not a balanced week", () => {
  const summary = summariseVerification([]);
  assert.equal(summary.totalCount, 0);
  assert.equal(summary.variance, 0);
  assert.equal(reconciliationStatus({ verified: false, variance: 0 }), "not_verified");
});

test("float noise does not manufacture a variance", () => {
  assert.equal(isMatched(0.2), true);
  assert.equal(isMatched(-0.2), true);
  assert.equal(isMatched(1), false);
});

test("missing and surplus cash both count as unmatched", () => {
  assert.equal(accountDifference({ systemBalance: 100, actualBalance: 40 }), -60);
  assert.equal(accountDifference({ systemBalance: 100, actualBalance: 160 }), 60);
  assert.equal(isMatched(60), false);
});

test("non-numeric input reads as zero rather than NaN", () => {
  const summary = summariseVerification([
    { bankAccountId: null, accountLabel: "Broken", systemBalance: Number.NaN, actualBalance: "" as unknown as number }
  ]);
  assert.equal(summary.variance, 0);
  assert.equal(summary.totalActual, 0);
});

test("a verified week that balances is balanced", () => {
  assert.equal(reconciliationStatus({ verified: true, variance: 0 }), "balanced");
  assert.equal(reconciliationStatus({ verified: true, variance: 0.3 }), "balanced");
});

test("a gap with no investigation demands one", () => {
  assert.equal(reconciliationStatus({ verified: true, variance: -120_000 }), "needs_investigation");
  assert.equal(
    reconciliationStatus({ verified: true, variance: -120_000, investigationStatus: null }),
    "needs_investigation"
  );
});

test("an open investigation reads as investigating, not as a fresh gap", () => {
  assert.equal(
    reconciliationStatus({ verified: true, variance: -120_000, investigationStatus: "in_progress" }),
    "investigating"
  );
  assert.equal(
    reconciliationStatus({ verified: true, variance: -120_000, investigationStatus: "submitted" }),
    "investigating"
  );
});

// The distinction the whole page turns on: explained is not the same as fine.
test("a resolved investigation never disguises itself as a balanced week", () => {
  const status = reconciliationStatus({
    verified: true, variance: -120_000, investigationStatus: "resolved"
  });
  assert.equal(status, "resolved");
  assert.notEqual(status, "balanced");
});

test("progress is measured in absolute terms so a shortfall is not negative", () => {
  const progress = investigationProgress(-120_000, 100_000);
  assert.equal(progress.explained, 100_000);
  assert.equal(progress.unexplained, 20_000);
  assert.equal(progress.pct, 83);
});

test("explaining more than the gap cannot exceed 100% or go negative", () => {
  const progress = investigationProgress(-120_000, 500_000);
  assert.equal(progress.explained, 120_000);
  assert.equal(progress.unexplained, 0);
  assert.equal(progress.pct, 100);
});

test("nothing explained yet is zero percent, not complete", () => {
  const progress = investigationProgress(-120_000, 0);
  assert.equal(progress.pct, 0);
  assert.equal(progress.unexplained, 120_000);
});

test("a surplus is explained the same way a shortfall is", () => {
  const progress = investigationProgress(50_000, 25_000);
  assert.equal(progress.pct, 50);
  assert.equal(progress.unexplained, 25_000);
});

test("no variance is fully explained by definition", () => {
  assert.equal(investigationProgress(0, 0).pct, 100);
});
