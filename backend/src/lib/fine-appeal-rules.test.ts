import assert from "node:assert/strict";
import test from "node:test";
import { canStillAppeal, cancelOutcome, snapshotWithFine } from "./fine-appeal-rules.js";

test("appeal window: until the week is with the Owner", () => {
  assert.equal(canStillAppeal(null), true);
  assert.equal(canStillAppeal("open"), true);
  assert.equal(canStillAppeal("returned_to_manager"), true);
  assert.equal(canStillAppeal("submitted_to_owner"), false);
  assert.equal(canStillAppeal("locked"), false);
});

test("who cancels: a fine the Owner charged goes to the Owner", () => {
  assert.equal(cancelOutcome(false, false), "cancelled");
  assert.equal(cancelOutcome(true, false), "awaiting_owner");
  assert.equal(cancelOutcome(true, true), "cancelled");
});

test("a sent report's figures without the fine, then with it again", () => {
  const fine = { id: "f1", label: "Late order send", amount: 500, date: "2026-10-27" };
  const sent = { fines: [fine, { id: "f2", label: "Other", amount: 200, date: "2026-10-28" }], totals: { baseBonus: 6000, upsellBonus: 1000, crossSellBonus: 0, deliveryBonus: 400, adjustments: 0, carriedFines: 0, fines: 700, finalBonus: 6700, unpaidFines: 0 } };
  const held = snapshotWithFine(sent, fine, false);
  assert.equal(held.totals.fines, 200);
  assert.equal(held.totals.finalBonus, 7200);
  assert.deepEqual(held.fines.map((item: any) => item.id), ["f2"]);
  const back = snapshotWithFine(held, fine, true);
  assert.equal(back.totals.fines, 700);
  assert.equal(back.totals.finalBonus, 6700);
  // Taking it out twice changes nothing.
  assert.equal(snapshotWithFine(held, fine, false), held);
  // Fines bigger than the bonus: the rest carries.
  const small = { fines: [fine], totals: { baseBonus: 300, fines: 500, finalBonus: 0, unpaidFines: 200 } };
  assert.equal(snapshotWithFine(small, fine, false).totals.finalBonus, 300);
  assert.equal(snapshotWithFine(small, fine, false).totals.unpaidFines, 0);
});
