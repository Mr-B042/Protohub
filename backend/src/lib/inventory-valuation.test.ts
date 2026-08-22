import assert from "node:assert/strict";
import test from "node:test";
import {
  groupValue, inventoryHealth, movementDirection, sellableUnits, stockCondition,
  summariseInventory, summariseMovements, valueProduct, type ProductStockInput
} from "./inventory-valuation.js";

const product = (over: Partial<ProductStockInput> = {}): ProductStockInput => ({
  productId: "p1", name: "Multi Corner Storage Shelf", sku: "MCS", imageUrl: null,
  catalogType: "standard", warehouseUnits: 40, agentUnits: 36, damagedUnits: 0,
  unitCost: 11_500, sellingPrice: 41_000, reorderPoint: 10,
  unitsSoldRecently: 22, weekTrend: 12, ...over
});

test("stock on hand is warehouse plus agent, less damaged", () => {
  assert.equal(sellableUnits(product()), 76);
  assert.equal(sellableUnits(product({ damagedUnits: 6 })), 70);
});

test("damaged units can never push stock below zero", () => {
  assert.equal(sellableUnits(product({ warehouseUnits: 2, agentUnits: 0, damagedUnits: 50 })), 0);
});

test("stock is valued at cost, with retail carried only as an estimate", () => {
  const valued = valueProduct(product());
  assert.equal(valued.costValue, 76 * 11_500);
  assert.equal(valued.retailValue, 76 * 41_000);
  assert.notEqual(valued.costValue, valued.retailValue);
});

test("a product with no cost on file is flagged rather than valued silently", () => {
  const valued = valueProduct(product({ unitCost: 0 }));
  assert.equal(valued.costValue, 0);
  assert.equal(valued.missingCost, true);
});

test("no stock and no cost is not flagged as a pricing gap", () => {
  assert.equal(valueProduct(product({ unitCost: 0, warehouseUnits: 0, agentUnits: 0 })).missingCost, false);
});

test("healthy stock is moving and above its reorder point", () => {
  assert.equal(stockCondition(product()), "healthy");
});

test("stock that has not moved at all is slow moving", () => {
  assert.equal(stockCondition(product({ unitsSoldRecently: 0 })), "slow_moving");
});

test("at or below reorder point is at risk", () => {
  assert.equal(stockCondition(product({ warehouseUnits: 6, agentUnits: 4, reorderPoint: 10 })), "at_risk");
  assert.equal(stockCondition(product({ warehouseUnits: 0, agentUnits: 0 })), "at_risk");
});

// Worst-first ordering: a real problem must not hide behind a milder label.
test("a product that is both at risk and unsold reports the worse condition", () => {
  assert.equal(stockCondition(product({ warehouseUnits: 3, agentUnits: 0, reorderPoint: 10, unitsSoldRecently: 0 })), "at_risk");
});

test("stock that is entirely damaged reads as damaged, not merely at risk", () => {
  assert.equal(stockCondition(product({ warehouseUnits: 5, agentUnits: 0, damagedUnits: 5 })), "damaged");
});

// The weighting bug this function exists to avoid.
test("average unit cost is weighted by holding, not a mean of the costs", () => {
  const totals = summariseInventory([
    valueProduct(product({ productId: "cheap", warehouseUnits: 99, agentUnits: 0, unitCost: 100, reorderPoint: 0 })),
    valueProduct(product({ productId: "dear", warehouseUnits: 1, agentUnits: 0, unitCost: 100_000, reorderPoint: 0 }))
  ]);
  assert.equal(totals.totalUnits, 100);
  assert.equal(totals.totalCostValue, 109_900);
  assert.equal(totals.averageUnitCost, 1099);
  // The naive mean would have been 50,050 - forty-five times too high.
  assert.ok(totals.averageUnitCost < 2000);
});

test("empty stock does not divide by zero", () => {
  const totals = summariseInventory([]);
  assert.equal(totals.averageUnitCost, 0);
  assert.equal(totals.totalUnits, 0);
  assert.equal(totals.productLines, 0);
});

test("unpriced stock is counted and reported, not buried", () => {
  const totals = summariseInventory([
    valueProduct(product({ productId: "a", unitCost: 0 })),
    valueProduct(product({ productId: "b" }))
  ]);
  assert.equal(totals.unpricedLines, 1);
  assert.equal(totals.unpricedUnits, 76);
});

test("health slices keep empty conditions so nothing looks forgotten", () => {
  const { slices } = inventoryHealth([valueProduct(product())]);
  assert.equal(slices.length, 4);
  assert.ok(slices.some((slice) => slice.condition === "at_risk" && slice.amount === 0));
});

test("health shares add up to the whole", () => {
  const { slices, total } = inventoryHealth([
    valueProduct(product({ productId: "a" })),
    valueProduct(product({ productId: "b", unitsSoldRecently: 0 }))
  ]);
  assert.equal(total, 2 * 76 * 11_500);
  assert.equal(Math.round(slices.reduce((sum, slice) => sum + slice.sharePct, 0)), 100);
});

test("grouping merges duplicate keys and ranks by value", () => {
  const rows = groupValue([
    { key: "lagos", label: "Lagos", amount: 1_000_000, units: 40 },
    { key: "abuja", label: "Abuja", amount: 2_000_000, units: 60 },
    { key: "lagos", label: "Lagos", amount: 1_150_000, units: 20 }
  ]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].key, "lagos");
  assert.equal(rows[0].amount, 2_150_000);
  assert.equal(rows[0].units, 60);
});

// Stock moving between our own hubs is not stock entering or leaving.
test("internal hub movements are excluded exactly as transfers are from cash flow", () => {
  assert.equal(movementDirection("Distributed to Agent"), "internal");
  assert.equal(movementDirection("Waybill In"), "internal");
  assert.equal(movementDirection("Waybill Out"), "internal");
  assert.equal(movementDirection("Stock Added"), "in");
  assert.equal(movementDirection("Order Fulfilled"), "out");
  assert.equal(movementDirection("Return"), "in");
  assert.equal(movementDirection("Correction"), "adjustment");
});

test("a week of movements nets out to the real change", () => {
  const costs = new Map([["p1", 1000]]);
  const totals = summariseMovements([
    { type: "Stock Added", qty: 126, productId: "p1" },
    { type: "Order Fulfilled", qty: 88, productId: "p1" },
    { type: "Distributed to Agent", qty: 500, productId: "p1" }
  ], costs);
  assert.equal(totals.stockInUnits, 126);
  assert.equal(totals.stockOutUnits, 88);
  assert.equal(totals.netUnits, 38);
  assert.equal(totals.netValue, 38_000);
});

test("a negative correction reduces the net rather than inflating it", () => {
  const totals = summariseMovements(
    [{ type: "Correction", qty: -20, productId: "p1" }], new Map([["p1", 500]]));
  assert.equal(totals.adjustmentUnits, -20);
  assert.equal(totals.netUnits, -20);
  assert.equal(totals.netValue, -10_000);
});

test("a movement on a product with no cost still counts its units", () => {
  const totals = summariseMovements([{ type: "Stock Added", qty: 10, productId: "unknown" }], new Map());
  assert.equal(totals.stockInUnits, 10);
  assert.equal(totals.stockInValue, 0);
});
