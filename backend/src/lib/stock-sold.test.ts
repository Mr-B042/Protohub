import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSold, type SoldRow, type SourcedLine } from "./stock-sold-model.js";

type L = [string, number, string?, boolean?];
const row = (id: string, day: string, state: string, agent: string, main: string, lines: L[]) =>
  ({ id, delivered_date: day, state, agent_id: agent, product_id: main, quantity: 1, lines }) as SoldRow;
const linesOf = (r: any): SourcedLine[] => r.lines.map(([productId, quantity, sourceType = "base_product", isFreeGift = false]: L) => ({ productId, quantity, sourceType, isFreeGift }));
const rows = [
  // Corner rack with 10 free hooks and a glue cross-sell.
  row("1", "2026-11-20", "Lagos", "a1", "rack", [["rack", 1], ["hook", 10, "package_component", true], ["glue", 1, "cross_sell"]]),
  row("2", "2026-11-20", "Lagos", "a1", "rack", [["rack", 2]]),
  row("3", "2026-11-21", "Kano", "a2", "shelf", [["shelf", 1], ["brush", 1, "free_gift"]]),
  row("4", "2026-11-01", "Lagos", "a1", "shelf", [["shelf", 4]])
];

test("only the main product counts; gifts and add-ons ride inside it", () => {
  const out = buildSold(rows, linesOf, { start: "2026-11-20", end: "2026-11-21", productIds: null });
  assert.deepEqual(out.lines, [
    { day: "2026-11-20", productId: "rack", state: "Lagos", agentId: "a1", pieces: 3, orders: 2 },
    { day: "2026-11-21", productId: "shelf", state: "Kano", agentId: "a2", pieces: 1, orders: 1 }
  ]);
  assert.deepEqual(out.extras.map((e) => [e.productId, e.itemId, e.kind, e.pieces]), [
    ["rack", "hook", "gift", 10], ["rack", "glue", "cross_sell", 1], ["shelf", "brush", "gift", 1]
  ]);
  assert.equal(out.orderCells.find((c) => c.day === "2026-11-20")!.orders, 2);
});

test("a day-by-day total of main pieces (the quick-range chip counts)", () => {
  const out = buildSold(rows, linesOf, { start: "2026-11-01", end: "2026-11-30", productIds: null });
  assert.deepEqual(out.days, [
    { day: "2026-11-01", pieces: 4, orders: 1 },
    { day: "2026-11-20", pieces: 3, orders: 2 },
    { day: "2026-11-21", pieces: 1, orders: 1 }
  ]);
});

test("the product filter picks orders by their main product", () => {
  const out = buildSold(rows, linesOf, { start: "2026-11-01", end: "2026-11-30", productIds: new Set(["shelf"]) });
  assert.equal(out.lines.reduce((s, l) => s + l.pieces, 0), 5);
  assert.deepEqual(out.extras.map((e) => e.itemId), ["brush"]);
});

test("a package of other products still sells its main product once", () => {
  const out = buildSold([row("9", "2026-11-05", "Edo", "a3", "combo", [["hook", 4, "package_component"], ["glue", 1, "package_component"]])], linesOf, { start: "2026-11-01", end: "2026-11-30", productIds: null });
  assert.equal(out.lines[0].pieces, 1);
  assert.deepEqual(out.extras.map((e) => [e.itemId, e.kind]), [["hook", "package"], ["glue", "package"]]);
});
