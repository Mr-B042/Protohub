import assert from "node:assert/strict";
import test from "node:test";
import { financialHighlights, healthChecks, rankSlices, weekOverWeek } from "./weekly-overview.js";

test("growth is measured against last week", () => {
  const movement = weekOverWeek(1_245_000, 1_107_000);
  assert.equal(movement.delta, 138_000);
  assert.equal(movement.pct, 12.5);
});

test("a fall reports a negative change", () => {
  const movement = weekOverWeek(900, 1000);
  assert.equal(movement.delta, -100);
  assert.equal(movement.pct, -10);
});

// Neither 0% nor Infinity is a figure anyone can act on.
test("growth from nothing is null, not zero and not infinity", () => {
  const movement = weekOverWeek(500_000, 0);
  assert.equal(movement.pct, null);
  assert.equal(movement.delta, 500_000);
});

test("a fall from a negative base still reads sensibly", () => {
  const movement = weekOverWeek(-50, -100);
  assert.equal(movement.delta, 50);
  assert.equal(movement.pct, 50);
});

const health = (over: Partial<Parameters<typeof healthChecks>[0]> = {}) => healthChecks({
  freeOperatingCash: 1_500_000, netCashFlow: 400_000, operatingExpenseRatioPct: 20,
  collectionEfficiencyPct: 95, cashVariance: 0, varianceVerified: true, hasRevenue: true, ...over
});

test("a healthy week rates good across the board", () => {
  assert.ok(health().every((check) => check.rating === "good"));
});

test("negative free cash is poor liquidity, not fair", () => {
  assert.equal(health({ freeOperatingCash: -400_000 })[0].rating, "poor");
});

test("spending more than came in is poor cash flow", () => {
  assert.equal(health({ netCashFlow: -200_000 })[1].rating, "poor");
});

// A dashboard that shows green because it has no data is worse than one that admits it.
test("nothing to judge reads unknown rather than good", () => {
  const checks = health({ hasRevenue: false });
  assert.equal(checks.find((check) => check.key === "expense_control")?.rating, "unknown");
  assert.equal(checks.find((check) => check.key === "collection")?.rating, "unknown");
});

test("an uncounted week cannot claim a good variance", () => {
  const check = health({ varianceVerified: false, cashVariance: 0 })
    .find((entry) => entry.key === "variance");
  assert.equal(check?.rating, "unknown");
  assert.match(check!.detail, /has not been counted/);
});

test("a large variance rates poor, a small one only fair", () => {
  assert.equal(health({ cashVariance: -120_000 }).find((c) => c.key === "variance")?.rating, "poor");
  assert.equal(health({ cashVariance: -20_000 }).find((c) => c.key === "variance")?.rating, "fair");
});

test("expense control degrades as opex eats revenue", () => {
  assert.equal(health({ operatingExpenseRatioPct: 20 })[2].rating, "good");
  assert.equal(health({ operatingExpenseRatioPct: 35 })[2].rating, "fair");
  assert.equal(health({ operatingExpenseRatioPct: 60 })[2].rating, "poor");
});

const week = (over: Partial<Parameters<typeof financialHighlights>[0]> = {}) => ({
  cashIn: 5_860_000, cashOut: 4_215_000, revenue: 6_750_000, cogs: 3_600_000,
  deliveredValue: 6_337_000, ...over
});

// A quiet Sunday is part of the week.
test("daily averages divide by seven, not by days with activity", () => {
  const rows = financialHighlights(week({ cashIn: 700_000 }), week());
  assert.equal(rows[0].value, 100_000);
});

test("gross margin is revenue less cost of goods", () => {
  const rows = financialHighlights(week(), week());
  assert.equal(rows.find((row) => row.key === "gross_margin")?.value, 3_150_000);
});

test("a week with no revenue reports zero ratios rather than dividing by zero", () => {
  const rows = financialHighlights(week({ revenue: 0, deliveredValue: 0 }), week());
  assert.equal(rows.find((row) => row.key === "opex_ratio")?.value, 0);
  assert.equal(rows.find((row) => row.key === "collection")?.value, 0);
});

test("collection efficiency compares cash received to value delivered", () => {
  const rows = financialHighlights(week({ cashIn: 500, deliveredValue: 1000 }), week());
  assert.equal(rows.find((row) => row.key === "collection")?.value, 50);
});

test("slices rank largest first and share the whole", () => {
  const slices = rankSlices(new Map([["Ads", 2_150_000], ["Payroll", 420_000], ["Delivery", 820_000]]));
  assert.equal(slices[0].label, "Ads");
  assert.equal(Math.round(slices.reduce((sum, slice) => sum + slice.sharePct, 0)), 100);
});

test("empty categories are dropped rather than shown at zero percent", () => {
  const slices = rankSlices(new Map([["Ads", 100], ["Nothing", 0]]));
  assert.equal(slices.length, 1);
});

test("no spending at all produces no slices rather than NaN", () => {
  assert.deepEqual(rankSlices(new Map()), []);
});
