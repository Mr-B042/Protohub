import assert from "node:assert/strict";
import test from "node:test";
import { isDedupablePhone, uniqueMergedCartIds } from "./cart-dedup.js";

test("merged cart ids are unique and never include the survivor", () => {
  assert.deepEqual(
    uniqueMergedCartIds(
      ["CART-100001", "CART-100001", "CART-200002", "CART-900009", "", null],
      "CART-900009"
    ),
    ["CART-100001", "CART-200002"]
  );
});

test("merged cart ids ignore malformed values without reordering valid ids", () => {
  assert.deepEqual(
    uniqueMergedCartIds([undefined, 42, " CART-300003 ", {}, "CART-400004"], "CART-500005"),
    ["CART-300003", "CART-400004"]
  );
});

test("a full phone number can identify a cart", () => {
  assert.equal(isDedupablePhone("08034121526"), true);
  assert.equal(isDedupablePhone("8034121526"), true);
  assert.equal(isDedupablePhone("+2348034121526"), true);
  assert.equal(isDedupablePhone("0803 412 1526"), true);
});

test("the 'no phone yet' placeholder is never an identity", () => {
  // This is the exact value that merged two unrelated shoppers' carts.
  assert.equal(isDedupablePhone("No phone yet"), false);
});

test("a half-typed number is not an identity either", () => {
  // Real values from production carts.
  assert.equal(isDedupablePhone("080"), false);
  assert.equal(isDedupablePhone("08087"), false);
  assert.equal(isDedupablePhone("80"), false);
});

test("empty and missing values are not identities", () => {
  assert.equal(isDedupablePhone(""), false);
  assert.equal(isDedupablePhone(null), false);
  assert.equal(isDedupablePhone(undefined), false);
});
