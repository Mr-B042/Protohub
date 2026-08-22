import assert from "node:assert/strict";
import test from "node:test";
import {
  buildBreakdown,
  buildDailyTrend,
  CASH_OUT_GROUPS,
  cashOutGroupFor,
  changeVsPrevious,
  dayRange,
  withRunningBalance
} from "./cash-flow.js";

// ── Category mapping ──────────────────────────────────────

test("every real expense category lands in a group", () => {
  // The full list the expense form offers today.
  const categories = [
    "Ad Spend", "Delivery", "Failed Delivery", "Salary",
    "Clearing & Shipping", "Waybill", "Airtime & Data", "Stock Loss", "Other"
  ];
  categories.forEach((category) => {
    assert.ok(CASH_OUT_GROUPS.includes(cashOutGroupFor(category)), `${category} has no group`);
  });
});

test("ads, payroll and logistics map where a reader expects", () => {
  assert.equal(cashOutGroupFor("Ad Spend"), "Facebook / Instagram Ads");
  assert.equal(cashOutGroupFor("Salary"), "Payroll");
  assert.equal(cashOutGroupFor("Delivery"), "Logistics / Dispatch");
  assert.equal(cashOutGroupFor("Waybill"), "Logistics / Dispatch");
  assert.equal(cashOutGroupFor("Clearing & Shipping"), "Logistics / Dispatch");
});

test("an unknown or missing category is never dropped", () => {
  // Silently discarding spend would understate cash out, which is the one
  // number this page must not flatter.
  assert.equal(cashOutGroupFor("Something New"), "Other Operating Expenses");
  assert.equal(cashOutGroupFor(null), "Other Operating Expenses");
  assert.equal(cashOutGroupFor(""), "Other Operating Expenses");
});

test("category matching ignores case and spacing", () => {
  assert.equal(cashOutGroupFor("  ad spend "), "Facebook / Instagram Ads");
  assert.equal(cashOutGroupFor("STOCK PURCHASE"), "Stock Purchases");
});

// ── Trend ─────────────────────────────────────────────────

test("days with no movement still appear on the trend", () => {
  const days = dayRange("2026-08-18", "2026-08-20");
  const trend = buildDailyTrend(days, [{ day: "2026-08-18", amount: 100 }], [{ day: "2026-08-20", amount: 40 }]);
  assert.equal(trend.length, 3);
  assert.deepEqual(trend[1], { day: "2026-08-19", cashIn: 0, cashOut: 0, net: 0 });
  assert.equal(trend[2].net, -40);
});

test("a backwards range yields nothing rather than looping forever", () => {
  assert.deepEqual(dayRange("2026-08-20", "2026-08-18"), []);
});

test("a single day range is one day, not zero", () => {
  assert.deepEqual(dayRange("2026-08-18", "2026-08-18"), ["2026-08-18"]);
});

// ── Comparison ────────────────────────────────────────────

test("change against the previous period", () => {
  assert.equal(changeVsPrevious(714000, 556000), 28.4);
});

test("no previous cash gives null rather than a fake infinity", () => {
  assert.equal(changeVsPrevious(500, 0), null);
});

test("a negative base still compares sensibly", () => {
  // Going from -100 to +100 is a 200% improvement, not -200%.
  assert.equal(changeVsPrevious(100, -100), 200);
});

// ── Breakdown ─────────────────────────────────────────────

test("shares add up and the largest slice leads", () => {
  const amounts = new Map([["Ads", 1120000], ["Stock", 420000], ["Logistics", 120000]]);
  const { slices, total } = buildBreakdown(amounts);
  assert.equal(total, 1660000);
  assert.equal(slices[0].label, "Ads");
  assert.ok(Math.abs(slices.reduce((sum, slice) => sum + slice.sharePct, 0) - 100) < 0.1);
});

test("a fixed group with no spend is kept, not hidden", () => {
  // Stock Purchases has no history; showing it at zero tells the reader the
  // category exists and is empty rather than that it was forgotten.
  const { slices } = buildBreakdown(new Map([["Ads", 100]]), ["Ads", "Stock Purchases"]);
  assert.equal(slices.length, 2);
  assert.equal(slices.find((slice) => slice.label === "Stock Purchases")?.amount, 0);
});

test("an all-zero breakdown does not divide by zero", () => {
  const { slices, total } = buildBreakdown(new Map([["Ads", 0]]), ["Ads"]);
  assert.equal(total, 0);
  assert.equal(slices[0].sharePct, 0);
});

// ── Running balance ───────────────────────────────────────

test("balance is walked oldest-first then shown newest-first", () => {
  const rows = [
    { id: "a", cashIn: 100, cashOut: 0 },
    { id: "b", cashIn: 0, cashOut: 30 },
    { id: "c", cashIn: 50, cashOut: 0 }
  ];
  const walked = withRunningBalance(rows, 1000);
  // Newest first for display.
  assert.equal(walked[0].id, "c");
  assert.equal(walked[0].balance, 1120);
  assert.equal(walked[2].id, "a");
  assert.equal(walked[2].balance, 1100);
});

test("an empty period returns the opening balance untouched", () => {
  assert.deepEqual(withRunningBalance([], 2450000), []);
});
