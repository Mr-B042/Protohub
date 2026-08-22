import assert from "node:assert/strict";
import test from "node:test";
import {
  daysUntil, nextReserveRef, outstandingOf, reserveBreakdown, reserveDisplayStatus,
  reserveInsights, summariseReserves, upcomingReleases, type ReserveInput
} from "./cash-reserves.js";

const TODAY = "2026-08-24";
const reserve = (over: Partial<ReserveInput> = {}): ReserveInput => ({
  id: "r1", name: "Payroll Reserve", category: "payroll", amount: 800_000,
  releasedAmount: 0, status: "active", expectedReleaseDate: "2026-08-30",
  availableToUse: false, ...over
});

test("a part-released reserve only holds the remainder back", () => {
  assert.equal(outstandingOf(reserve({ releasedAmount: 300_000 })), 500_000);
  assert.equal(outstandingOf(reserve({ releasedAmount: 800_000 })), 0);
});

test("a cancelled reserve holds nothing back", () => {
  assert.equal(outstandingOf(reserve({ status: "cancelled" })), 0);
});

test("over-release can never report a negative hold", () => {
  assert.equal(outstandingOf({ amount: 100, releasedAmount: 250, status: "active" }), 0);
});

test("free operating cash is liquid cash minus what is still held", () => {
  const summary = summariseReserves([reserve(), reserve({ id: "r2", amount: 200_000, category: "tax" })], 3_164_000);
  assert.equal(summary.totalReserved, 1_000_000);
  assert.equal(summary.freeOperatingCash, 2_164_000);
  assert.equal(summary.activeCount, 2);
});

// The state the page exists to surface: promising money that is not there.
test("over-committing is reported, never clamped to zero", () => {
  const summary = summariseReserves([reserve({ amount: 5_000_000 })], 1_000_000);
  assert.equal(summary.freeOperatingCash, -4_000_000);
  assert.equal(summary.overCommitted, true);
});

test("cancelled reserves are excluded from every headline", () => {
  const summary = summariseReserves([reserve({ status: "cancelled" })], 1_000_000);
  assert.equal(summary.totalReserved, 0);
  assert.equal(summary.freeOperatingCash, 1_000_000);
  assert.equal(summary.overCommitted, false);
});

test("no liquid cash does not divide by zero", () => {
  const summary = summariseReserves([reserve()], 0);
  assert.equal(summary.reservedPct, 0);
  assert.equal(summary.overCommitted, true);
});

test("days left counts down and goes negative once passed", () => {
  assert.equal(daysUntil("2026-08-30", TODAY), 6);
  assert.equal(daysUntil("2026-08-24", TODAY), 0);
  assert.equal(daysUntil("2026-08-20", TODAY), -4);
  assert.equal(daysUntil(null, TODAY), null);
});

// The important one: a passed date must not silently free the money.
test("an overdue reserve is still held back, not released", () => {
  const overdue = reserve({ expectedReleaseDate: "2026-08-10" });
  assert.equal(reserveDisplayStatus(overdue, TODAY), "overdue");
  assert.equal(outstandingOf(overdue), 800_000);
  assert.equal(summariseReserves([overdue], 1_000_000).freeOperatingCash, 200_000);
});

test("a reserve due within a week is flagged before it lapses", () => {
  assert.equal(reserveDisplayStatus(reserve({ expectedReleaseDate: "2026-08-28" }), TODAY), "due_soon");
  assert.equal(reserveDisplayStatus(reserve({ expectedReleaseDate: "2026-09-30" }), TODAY), "active");
});

test("a reserve with no release date is simply active", () => {
  assert.equal(reserveDisplayStatus(reserve({ expectedReleaseDate: null }), TODAY), "active");
});

test("a fully released reserve reads as released", () => {
  assert.equal(reserveDisplayStatus(reserve({ releasedAmount: 800_000 }), TODAY), "released");
});

test("breakdown shares sum to the whole and drop empty reserves", () => {
  const { slices, total } = reserveBreakdown([
    reserve({ id: "a", amount: 800_000 }),
    reserve({ id: "b", amount: 200_000 }),
    reserve({ id: "c", amount: 100_000, releasedAmount: 100_000 })
  ]);
  assert.equal(total, 1_000_000);
  assert.equal(slices.length, 2);
  assert.equal(slices[0].amount, 800_000);
  assert.equal(Math.round(slices.reduce((sum, slice) => sum + slice.sharePct, 0)), 100);
});

test("upcoming releases put the most urgent first, overdue included", () => {
  const rows = upcomingReleases([
    reserve({ id: "later", expectedReleaseDate: "2026-09-10" }),
    reserve({ id: "overdue", expectedReleaseDate: "2026-08-20" }),
    reserve({ id: "soon", expectedReleaseDate: "2026-08-28" })
  ], TODAY, 30);
  assert.deepEqual(rows.map((row) => row.id), ["overdue", "soon", "later"]);
  assert.equal(rows[0].daysLeft, -4);
});

test("reserves without a date never appear in upcoming releases", () => {
  assert.equal(upcomingReleases([reserve({ expectedReleaseDate: null })], TODAY).length, 0);
});

test("over-commitment outranks every other insight", () => {
  const reserves = [reserve({ amount: 5_000_000 })];
  const insights = reserveInsights(reserves, summariseReserves(reserves, 1_000_000), TODAY);
  assert.equal(insights[0].kind, "critical");
  assert.match(insights[0].detail, /not actually there/);
});

test("a missing payroll reserve is called out rather than passed over", () => {
  const reserves = [reserve({ category: "tax" })];
  const insights = reserveInsights(reserves, summariseReserves(reserves, 5_000_000), TODAY);
  assert.ok(insights.some((entry) => entry.title === "No payroll reserve"));
});

// YYMM, so August 2026 is 2608. The supplied design showed RES-2508 against
// 2026 dates - inconsistent sample data, not a different scheme.
test("reference codes continue the month's sequence", () => {
  assert.equal(nextReserveRef(["RES-2608-001", "RES-2608-002"], TODAY), "RES-2608-003");
  assert.equal(nextReserveRef([], TODAY), "RES-2608-001");
});

// Deleting a reserve must not hand its number to a new one.
test("a deleted reserve never has its reference reused", () => {
  assert.equal(nextReserveRef(["RES-2608-001", "RES-2608-007"], TODAY), "RES-2608-008");
});

test("last month's codes do not bleed into this month", () => {
  assert.equal(nextReserveRef(["RES-2607-009"], TODAY), "RES-2608-001");
});

test("a code from another month is ignored, not misparsed", () => {
  assert.equal(nextReserveRef(["RES-2512-042", "RES-2608-003"], TODAY), "RES-2608-004");
});
