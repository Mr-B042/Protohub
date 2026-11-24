import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSold, type SoldRow } from "./stock-sold-model.js";

const row = (id: string, day: string, state: string, agent: string, lines: Array<[string, number]>) =>
  ({ id, delivered_date: day, state, agent_id: agent, lines }) as SoldRow;
const linesOf = (r: any) => r.lines.map(([productId, quantity]: [string, number]) => ({ productId, quantity }));
const rows = [
  row("1", "2026-11-20", "Lagos", "a1", [["hook", 2], ["rack", 1]]),
  row("2", "2026-11-20", "Lagos", "a1", [["hook", 3]]),
  row("3", "2026-11-21", "Kano", "a2", [["hook", 1]]),
  row("4", "2026-11-01", "Lagos", "a1", [["rack", 4]])
];

test("pieces per day x product x state x agent inside the range; an order with two products is one order", () => {
  const out = buildSold(rows, linesOf, { start: "2026-11-20", end: "2026-11-21", productIds: null });
  assert.deepEqual(out.lines, [
    { day: "2026-11-20", productId: "hook", state: "Lagos", agentId: "a1", pieces: 5, orders: 2 },
    { day: "2026-11-20", productId: "rack", state: "Lagos", agentId: "a1", pieces: 1, orders: 1 },
    { day: "2026-11-21", productId: "hook", state: "Kano", agentId: "a2", pieces: 1, orders: 1 }
  ]);
  assert.equal(out.orderCells.find((c) => c.day === "2026-11-20")!.orders, 2);
});

test("a day-by-day total for every loaded day (the quick-range chip counts)", () => {
  const out = buildSold(rows, linesOf, { start: "2026-11-20", end: "2026-11-20", productIds: null });
  assert.deepEqual(out.days, [
    { day: "2026-11-01", pieces: 4, orders: 1 },
    { day: "2026-11-20", pieces: 6, orders: 2 },
    { day: "2026-11-21", pieces: 1, orders: 1 }
  ]);
});

test("only the chosen product is counted", () => {
  const out = buildSold(rows, linesOf, { start: "2026-11-01", end: "2026-11-30", productIds: new Set(["rack"]) });
  assert.equal(out.lines.reduce((s, l) => s + l.pieces, 0), 5);
  assert.deepEqual(out.days.map((d) => d.day), ["2026-11-01", "2026-11-20"]);
});
