import assert from "node:assert/strict";
import test from "node:test";

// Mirrors sameFieldValue in routes/orders.ts. That guard decides whether a
// delivered order's edit is touching stock, so a false positive blocks every
// correction and a false negative lets stock drift in silently.
function sameFieldValue(next: unknown, before: unknown): boolean {
  const blank = (value: unknown) => value === null || value === undefined || value === "";
  if (blank(next) && blank(before)) return true;
  if (blank(next) !== blank(before)) return false;
  if (typeof next === "object" || typeof before === "object") {
    return JSON.stringify(next) === JSON.stringify(before);
  }
  const asNumber = Number(next);
  const beforeNumber = Number(before);
  if (Number.isFinite(asNumber) && Number.isFinite(beforeNumber)) return asNumber === beforeNumber;
  return String(next) === String(before);
}

// The false positive that would have 409'd every delivered edit.
test("a string quantity equals the same number", () => {
  assert.equal(sameFieldValue("2", 2), true);
  assert.equal(sameFieldValue(2, "2"), true);
});

test("a real quantity change is still detected", () => {
  assert.equal(sameFieldValue("3", 2), false);
  assert.equal(sameFieldValue(0, 2), false);
});

test("empty, null and undefined all count as unset together", () => {
  assert.equal(sameFieldValue("", null), true);
  assert.equal(sameFieldValue(null, undefined), true);
  assert.equal(sameFieldValue(undefined, ""), true);
});

test("clearing a set field is a change", () => {
  assert.equal(sameFieldValue("", "agent-1"), false);
  assert.equal(sameFieldValue(null, 5), false);
});

test("setting a previously unset field is a change", () => {
  assert.equal(sameFieldValue("agent-1", null), false);
});

test("uuids compare as strings", () => {
  assert.equal(sameFieldValue("a1b2", "a1b2"), true);
  assert.equal(sameFieldValue("a1b2", "c3d4"), false);
});

test("snapshots compare structurally", () => {
  assert.equal(sameFieldValue([{ productId: "p1", quantity: 2 }], [{ productId: "p1", quantity: 2 }]), true);
  assert.equal(sameFieldValue([{ productId: "p1", quantity: 2 }], [{ productId: "p1", quantity: 3 }]), false);
});

// Zero is a real value, not a blank one.
test("zero is not treated as unset", () => {
  assert.equal(sameFieldValue(0, null), false);
  assert.equal(sameFieldValue(0, 0), true);
});
