import assert from "node:assert/strict";
import test from "node:test";
import { uniqueMergedCartIds } from "./cart-dedup.js";

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
