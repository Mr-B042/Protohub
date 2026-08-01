import assert from "node:assert/strict";
import test from "node:test";
import { stockMovementBlocker, applyToRow, totalHeld, MOVEMENT_MAP, type StockRow } from "./pda-stock.js";

const row = (over: Partial<StockRow> = {}): StockRow => ({
  available: 0, reserved: 0, out_for_delivery: 0,
  damaged: 0, missing: 0, awaiting_investigation: 0, ...over
});

test("receiving from the company needs no existing stock", () => {
  assert.equal(stockMovementBlocker("Received from company", 20, row()), null);
  assert.equal(applyToRow("Received from company", 20, row()).available, 20);
});

test("you cannot reserve more than is available", () => {
  const blocker = stockMovementBlocker("Reserved for order", 3, row({ available: 1 }));
  assert.match(blocker ?? "", /Only 1 unit in available, cannot move 3/);
});

test("a reservation moves units without changing the total held", () => {
  // The unit is still with the agent - it has only changed purpose. A move that
  // altered the total would mean stock appearing or vanishing.
  const before = row({ available: 5 });
  const after = applyToRow("Reserved for order", 2, before);
  assert.equal(after.available, 3);
  assert.equal(after.reserved, 2);
  assert.equal(totalHeld(after), totalHeld(before));
});

test("delivering removes the unit from the agent entirely", () => {
  const after = applyToRow("Delivered to customer", 1, row({ out_for_delivery: 1 }));
  assert.equal(totalHeld(after), 0);
});

test("a failed delivery returns the unit to available, not to nowhere", () => {
  const before = row({ out_for_delivery: 2 });
  const after = applyToRow("Returned to available", 2, before);
  assert.equal(after.available, 2);
  assert.equal(after.out_for_delivery, 0);
  assert.equal(totalHeld(after), totalHeld(before));
});

test("the full lifecycle balances", () => {
  // Receive 10, reserve 3, send 2 out, deliver 1, fail 1 back.
  let s = row();
  s = applyToRow("Received from company", 10, s);
  s = applyToRow("Reserved for order", 3, s);
  s = applyToRow("Out for delivery", 2, s);
  s = applyToRow("Delivered to customer", 1, s);
  s = applyToRow("Returned to available", 1, s);
  assert.deepEqual(
    { available: s.available, reserved: s.reserved, out: s.out_for_delivery },
    { available: 8, reserved: 1, out: 0 }
  );
  assert.equal(totalHeld(s), 9, "one unit left with a customer");
});

test("written-off units still count as held until resolved", () => {
  // Damaged and missing stock is unaccounted for, not gone. Dropping it from
  // the total is how shrinkage disappears from view.
  const s = applyToRow("Written off missing", 2, row({ available: 5 }));
  assert.equal(s.missing, 2);
  assert.equal(totalHeld(s), 5);
});

test("you cannot deliver a unit that never went out", () => {
  const blocker = stockMovementBlocker("Delivered to customer", 1, row({ available: 10 }));
  assert.match(blocker ?? "", /Only 0 units in out for delivery/);
});

test("quantity must be a positive whole number", () => {
  for (const bad of [0, -1, 1.5, Number.NaN]) {
    assert.ok(stockMovementBlocker("Received from company", bad, row()), `${bad} should be rejected`);
  }
});

test("every movement in the map is reachable and does something", () => {
  // Guards against adding a movement name to the DB constraint but forgetting
  // to define how it actually moves units.
  for (const [name, map] of Object.entries(MOVEMENT_MAP)) {
    assert.ok(map.from !== undefined && map.to !== undefined, `${name} has no mapping`);
    assert.ok(map.from !== null || map.to !== null, `${name} moves nothing`);
  }
});
