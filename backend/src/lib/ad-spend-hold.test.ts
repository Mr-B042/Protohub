import { test } from "node:test";
import assert from "node:assert/strict";
import { isHeldAdSpend } from "./ad-spend-expenses.js";

test("Silent Test holds a product's ad spend from the day its test started, and nothing else", () => {
  const held = new Map([["shelf", "2026-11-03"]]);
  assert.equal(isHeldAdSpend("shelf", "2026-11-02", held), false, "the day before the test records as normal");
  assert.equal(isHeldAdSpend("shelf", "2026-11-03", held), true, "from the start day it is held");
  assert.equal(isHeldAdSpend("shelf", "2026-11-10", held), true);
  assert.equal(isHeldAdSpend("racks", "2026-11-10", held), false, "other products are untouched");
  assert.equal(isHeldAdSpend(null, "2026-11-10", held), false, "unassigned spend is never held");
  assert.equal(isHeldAdSpend("shelf", "2026-11-10", new Map()), false, "after the test leaves Silent Test nothing is held");
});
