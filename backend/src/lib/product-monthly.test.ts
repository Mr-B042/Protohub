import assert from "node:assert/strict";
import test from "node:test";
import { judgeMonth, monthBounds, monthsEnding, productMonths, type MonthlyOrder } from "./product-monthly.js";

const orders = (productId: string, month: string, placed: number, delivered: number, amount = 10_000, productCost = 4_000, deliveryFee = 1_000): MonthlyOrder[] =>
  Array.from({ length: placed }, (_, index) => ({ productId, month, status: index < delivered ? "Delivered" : "Failed", amount, productCost, deliveryFee }));

const base = { month: "2026-10", orders: 100, delivered: 70, rate: 70, revenue: 700_000, productCost: 280_000, deliveryFees: 70_000, adSpend: 100_000, profit: 250_000, costPerOrder: 1000, breakEven: null, breakEvenSource: null };

test("months: the six ending with the one picked, across a year end", () => {
  assert.deepEqual(monthsEnding("2026-02", 4), ["2025-11", "2025-12", "2026-01", "2026-02"]);
  assert.deepEqual(monthBounds("2026-02"), { from: "2026-02-01", to: "2026-02-28" });
  assert.deepEqual(monthBounds("2028-02"), { from: "2028-02-01", to: "2028-02-29" });
});

test("verdicts follow Bright's rules", () => {
  assert.equal(judgeMonth(base, null).verdict, "scale");
  assert.equal(judgeMonth({ ...base, rate: 64 }, null).verdict, "keep");
  assert.match(judgeMonth({ ...base, rate: 64 }, null).reason!, /1 point from Scale/);
  assert.equal(judgeMonth({ ...base, rate: 60 }, null).verdict, "keep");
  assert.equal(judgeMonth({ ...base, rate: 59.9 }, null).verdict, "fix");
  // Thin: profit under 10% of revenue.
  assert.equal(judgeMonth({ ...base, profit: 69_000 }, null).verdict, "fix");
  assert.equal(judgeMonth({ ...base, profit: 70_000 }, null).verdict, "scale");
  // One losing month = Fix, two in a row = Stop.
  assert.equal(judgeMonth({ ...base, profit: -1 }, { month: "2026-09", profit: 5, orders: 50, adSpend: 1 }).verdict, "fix");
  const stop = judgeMonth({ ...base, profit: -1 }, { month: "2026-09", profit: -5, orders: 50, adSpend: 1 });
  assert.equal(stop.verdict, "stop");
  assert.equal(stop.reason, "Lost money after ads in Sep and Oct");
  // A month before with nothing at all does not count as a loss.
  assert.equal(judgeMonth({ ...base, profit: -1 }, { month: "2026-09", profit: 0, orders: 0, adSpend: 0 }).verdict, "fix");
  // Under 10 orders: not judged, even when losing.
  assert.equal(judgeMonth({ ...base, orders: 9, profit: -50_000 }, null).verdict, "new");
  assert.equal(judgeMonth({ ...base, orders: 0, adSpend: 0 }, null).verdict, null);
});

test("a product's months: profit after ads, cost per order, break-even like the campaign check", () => {
  const all = [...orders("a", "2026-09", 20, 10), ...orders("a", "2026-10", 20, 14), ...orders("b", "2026-10", 50, 50)];
  const months = productMonths({ productId: "a", months: ["2026-08", "2026-09", "2026-10"], orders: all, adSpend: [{ productId: "a", month: "2026-10", amount: 40_000 }, { productId: "b", month: "2026-10", amount: 999 }], ownBreakEven: null });
  assert.equal(months[0].verdict, null);
  const oct = months[2];
  assert.equal(oct.orders, 20);
  assert.equal(oct.delivered, 14);
  assert.equal(oct.rate, 70);
  assert.equal(oct.revenue, 140_000);
  assert.equal(oct.adSpend, 40_000);
  assert.equal(oct.profit, 140_000 - 56_000 - 14_000 - 40_000);
  assert.equal(oct.costPerOrder, 2_000);
  // Margin 5,000 per delivered order × 70% delivered.
  assert.equal(oct.breakEven, 3_500);
  assert.equal(oct.breakEvenSource, "worked_out");
  assert.equal(oct.verdict, "scale");
  // Sept: 50% delivered.
  assert.equal(months[1].verdict, "fix");
  const own = productMonths({ productId: "a", months: ["2026-10"], orders: all, adSpend: [], ownBreakEven: 2_500 });
  assert.equal(own[0].breakEven, 2_500);
  assert.equal(own[0].breakEvenSource, "set_by_you");
});
