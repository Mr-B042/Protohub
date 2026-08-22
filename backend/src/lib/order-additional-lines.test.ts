import assert from "node:assert/strict";
import test from "node:test";
import {
  additionalLinesTotal, additionalLinesUnits, bonusEligibleTotal, checkAgentStock,
  normalizeAdditionalLines, orderMoneyBreakdown, stockShortfallMessage
} from "./order-additional-lines.js";

const line = (over: Record<string, unknown> = {}) => ({
  id: "extra-1", productId: "p1", productName: "Edge Brusher Max",
  quantity: 2, amount: 28_000, ...over
});

test("a well-formed line survives normalisation intact", () => {
  const [row] = normalizeAdditionalLines([line()]);
  assert.equal(row.productId, "p1");
  assert.equal(row.quantity, 2);
  assert.equal(row.amount, 28_000);
});

// A line that cannot name its product cannot ship either.
test("lines with no product are dropped, not defaulted", () => {
  assert.equal(normalizeAdditionalLines([line({ productId: "" }), line({ productId: null })]).length, 0);
  assert.equal(normalizeAdditionalLines([{ amount: 500 }]).length, 0);
});

test("non-array input is an empty list, never a crash", () => {
  assert.deepEqual(normalizeAdditionalLines(null), []);
  assert.deepEqual(normalizeAdditionalLines("nope"), []);
  assert.deepEqual(normalizeAdditionalLines(undefined), []);
});

test("quantity falls back to one rather than zero or negative", () => {
  assert.equal(normalizeAdditionalLines([line({ quantity: 0 })])[0].quantity, 1);
  assert.equal(normalizeAdditionalLines([line({ quantity: -5 })])[0].quantity, 1);
  assert.equal(normalizeAdditionalLines([line({ quantity: "3" })])[0].quantity, 3);
});

// A free giveaway still ships, so zero has to be a legal price.
test("a zero-priced line is allowed and still carries stock", () => {
  const [row] = normalizeAdditionalLines([line({ amount: 0, quantity: 4 })]);
  assert.equal(row.amount, 0);
  assert.equal(row.quantity, 4);
});

test("a negative amount is floored - a refund is not an order line", () => {
  assert.equal(normalizeAdditionalLines([line({ amount: -5_000 })])[0].amount, 0);
});

// Nothing pays out unless someone deliberately said so.
test("bonus eligibility is off unless explicitly true", () => {
  assert.equal(normalizeAdditionalLines([line()])[0].bonusEligible, false);
  assert.equal(normalizeAdditionalLines([line({ bonusEligible: "yes" })])[0].bonusEligible, false);
  assert.equal(normalizeAdditionalLines([line({ bonusEligible: 1 })])[0].bonusEligible, false);
  assert.equal(normalizeAdditionalLines([line({ bonusEligible: true })])[0].bonusEligible, true);
});

test("totals add the lines up", () => {
  const rows = [line({ id: "a", amount: 28_000 }), line({ id: "b", amount: 12_000, quantity: 1 })];
  assert.equal(additionalLinesTotal(rows), 40_000);
  assert.equal(additionalLinesUnits(rows), 3);
});

test("only flagged lines count toward a bonus", () => {
  const rows = [
    line({ id: "a", amount: 28_000, bonusEligible: true }),
    line({ id: "b", amount: 12_000 })
  ];
  assert.equal(additionalLinesTotal(rows), 40_000);
  assert.equal(bonusEligibleTotal(rows), 28_000);
});

test("no flagged lines means no bonus base at all", () => {
  assert.equal(bonusEligibleTotal([line(), line({ id: "b" })]), 0);
});

// The trap: extras must come OUT of main, or main is inflated by their value.
test("main is the total less both cross-sell and extras", () => {
  const breakdown = orderMoneyBreakdown({
    amount: 67_500,
    cross_sell_lines: [{ amount: 5_000 }],
    additional_lines: [line({ amount: 28_000 })]
  });
  assert.equal(breakdown.total, 67_500);
  assert.equal(breakdown.crossSell, 5_000);
  assert.equal(breakdown.additional, 28_000);
  assert.equal(breakdown.main, 34_500);
});

test("an order with no add-ons is all main", () => {
  const breakdown = orderMoneyBreakdown({ amount: 39_500 });
  assert.equal(breakdown.main, 39_500);
  assert.equal(breakdown.additional, 0);
  assert.equal(breakdown.crossSell, 0);
});

test("a discount below the add-ons floors main at zero, never negative", () => {
  const breakdown = orderMoneyBreakdown({
    amount: 10_000, additional_lines: [line({ amount: 28_000 })]
  });
  assert.equal(breakdown.main, 0);
});

test("the three parts never exceed the total they came from", () => {
  const breakdown = orderMoneyBreakdown({
    amount: 100_000,
    cross_sell_lines: [{ amount: 20_000 }],
    additional_lines: [line({ amount: 30_000 })]
  });
  assert.equal(breakdown.main + breakdown.crossSell + breakdown.additional, 100_000);
});

// The double-spend: two lines of one product against one stock figure.
test("two lines of the same product are summed before the stock check", () => {
  const checks = checkAgentStock(
    [
      { productId: "p1", productName: "Brusher", quantity: 3 },
      { productId: "p1", productName: "Brusher", quantity: 3 }
    ],
    new Map([["p1", 5]])
  );
  assert.equal(checks.length, 1);
  assert.equal(checks[0].needed, 6);
  assert.equal(checks[0].ok, false);
});

test("enough stock passes the check", () => {
  const checks = checkAgentStock(
    [{ productId: "p1", productName: "Brusher", quantity: 2 }], new Map([["p1", 10]]));
  assert.equal(checks[0].ok, true);
  assert.equal(stockShortfallMessage(checks), null);
});

test("exactly enough stock is enough", () => {
  const checks = checkAgentStock(
    [{ productId: "p1", productName: "Brusher", quantity: 5 }], new Map([["p1", 5]]));
  assert.equal(checks[0].ok, true);
});

test("an agent holding none of a product fails the check", () => {
  const checks = checkAgentStock(
    [{ productId: "ghost", productName: "Anti-Arthritis Oil", quantity: 1 }], new Map());
  assert.equal(checks[0].held, 0);
  assert.equal(checks[0].ok, false);
});

test("the shortfall message names every product that is short", () => {
  const checks = checkAgentStock([
    { productId: "a", productName: "Brusher", quantity: 6 },
    { productId: "b", productName: "Racks", quantity: 1 },
    { productId: "c", productName: "Oil", quantity: 2 }
  ], new Map([["a", 2], ["b", 4], ["c", 0]]));
  const message = stockShortfallMessage(checks) ?? "";
  assert.match(message, /Brusher: needs 6, agent holds 2/);
  assert.match(message, /Oil: needs 2, agent holds 0/);
  assert.ok(!message.includes("Racks"));
});

// ── Stock deduction, via the real inventory builder ──
import { orderInventoryLinesFromRow } from "./order-inventory.js";

test("an extra line deducts stock like any other item", () => {
  const lines = orderInventoryLinesFromRow({
    product_id: "main", product_name: "Corner Racks", quantity: 1,
    additional_lines: [line({ productId: "p1", productName: "Brusher", quantity: 2 })]
  });
  const extra = lines.find((row) => row.productId === "p1");
  assert.equal(extra?.quantity, 2);
  assert.equal(extra?.sourceType, "additional");
});

// A free giveaway still physically leaves the shelf.
test("a zero-priced extra still deducts its full quantity", () => {
  const lines = orderInventoryLinesFromRow({
    product_id: "main", product_name: "Corner Racks", quantity: 1,
    additional_lines: [line({ productId: "p1", productName: "Brusher", quantity: 4, amount: 0 })]
  });
  assert.equal(lines.find((row) => row.productId === "p1")?.quantity, 4);
});

test("an extra is not a free gift, even at zero price", () => {
  const lines = orderInventoryLinesFromRow({
    product_id: "main", product_name: "Racks", quantity: 1,
    additional_lines: [line({ productId: "p1", amount: 0 })]
  });
  assert.equal(lines.find((row) => row.productId === "p1")?.isFreeGift, false);
});

test("an extra of the same product as the main line collapses into it", () => {
  const lines = orderInventoryLinesFromRow({
    product_id: "p1", product_name: "Brusher", quantity: 1,
    additional_lines: [line({ productId: "p1", productName: "Brusher", quantity: 2 })]
  });
  assert.equal(lines.filter((row) => row.productId === "p1").length, 1);
  assert.equal(lines.find((row) => row.productId === "p1")?.quantity, 3);
});

test("an order with no extras deducts exactly what it always did", () => {
  const lines = orderInventoryLinesFromRow({
    product_id: "main", product_name: "Racks", quantity: 2
  });
  assert.equal(lines.length, 1);
  assert.equal(lines[0].quantity, 2);
});
