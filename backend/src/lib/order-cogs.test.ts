import assert from "node:assert/strict";
import test from "node:test";
import { costChangeImpact, needsFreezing, resolveOrderCogs } from "./order-cogs.js";

// The whole point: a frozen order ignores today's prices.
test("a snapshot wins over the live figure", () => {
  const result = resolveOrderCogs({ cogs_snapshot: 11_500, cogs_snapshot_at: "2026-08-01T00:00:00Z" }, 12_000);
  assert.equal(result.amount, 11_500);
  assert.equal(result.source, "snapshot");
  assert.equal(result.frozenAt, "2026-08-01T00:00:00Z");
});

test("an unfrozen order falls back to the live figure", () => {
  const result = resolveOrderCogs({}, 12_000);
  assert.equal(result.amount, 12_000);
  assert.equal(result.source, "live");
  assert.equal(result.frozenAt, null);
});

test("an explicit null snapshot is treated as unfrozen", () => {
  assert.equal(resolveOrderCogs({ cogs_snapshot: null }, 900).source, "live");
});

// Zero is a real cost - a free replacement, written-off goods.
test("a zero snapshot stays frozen and does not fall through", () => {
  const result = resolveOrderCogs({ cogs_snapshot: 0 }, 12_000);
  assert.equal(result.amount, 0);
  assert.equal(result.source, "snapshot");
});

test("a nonsense snapshot falls back rather than poisoning the figure", () => {
  assert.equal(resolveOrderCogs({ cogs_snapshot: "not a number" }, 500).source, "live");
});

test("only delivered orders are frozen", () => {
  assert.equal(needsFreezing({ status: "Delivered" }), true);
  assert.equal(needsFreezing({ status: "New" }), false);
  assert.equal(needsFreezing({ status: "Confirmed" }), false);
  assert.equal(needsFreezing({ status: "Cancelled" }), false);
});

test("an already-frozen order is not frozen twice", () => {
  assert.equal(needsFreezing({ status: "Delivered", cogs_snapshot: 11_500 }), false);
  assert.equal(needsFreezing({ status: "Delivered", cogs_snapshot: 0 }), false);
});

// The real case: 97 units at +₦500.
test("a cost rise is reported as the profit it would erase", () => {
  const impact = costChangeImpact({
    previousUnitCost: 11_500,
    newUnitCost: 12_000,
    deliveredOrders: Array.from({ length: 90 }, (_, i) => ({ units: i < 7 ? 2 : 1, frozen: false }))
  });
  assert.equal(impact.ordersAffected, 90);
  assert.equal(impact.unitsAffected, 97);
  assert.equal(impact.delta, 500);
  assert.equal(impact.reportedProfitShift, -48_500);
});

test("a cost cut would inflate past profit, and says so", () => {
  const impact = costChangeImpact({
    previousUnitCost: 12_000, newUnitCost: 11_000,
    deliveredOrders: [{ units: 10, frozen: false }]
  });
  assert.equal(impact.delta, -1_000);
  assert.equal(impact.reportedProfitShift, 10_000);
});

// Once history is frozen, a cost change moves nothing.
test("frozen orders are excluded from the impact entirely", () => {
  const impact = costChangeImpact({
    previousUnitCost: 11_500, newUnitCost: 12_000,
    deliveredOrders: [
      { units: 50, frozen: true },
      { units: 3, frozen: false }
    ]
  });
  assert.equal(impact.ordersAffected, 1);
  assert.equal(impact.unitsAffected, 3);
  assert.equal(impact.alreadyFrozen, 1);
  assert.equal(impact.reportedProfitShift, -1_500);
});

test("a fully frozen history means a cost change restates nothing", () => {
  const impact = costChangeImpact({
    previousUnitCost: 11_500, newUnitCost: 20_000,
    deliveredOrders: [{ units: 90, frozen: true }]
  });
  assert.equal(impact.reportedProfitShift, 0);
  assert.equal(impact.ordersAffected, 0);
});

test("no delivered orders is a safe no-op", () => {
  const impact = costChangeImpact({ previousUnitCost: 100, newUnitCost: 200, deliveredOrders: [] });
  assert.equal(impact.reportedProfitShift, 0);
  assert.equal(impact.unitsAffected, 0);
});

test("an unchanged cost shifts nothing even with unfrozen history", () => {
  const impact = costChangeImpact({
    previousUnitCost: 11_500, newUnitCost: 11_500,
    deliveredOrders: [{ units: 97, frozen: false }]
  });
  assert.equal(impact.delta, 0);
  assert.equal(impact.reportedProfitShift, 0);
});
