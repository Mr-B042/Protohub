import assert from "node:assert/strict";
import test from "node:test";
import {
  canFallbackToLegacyInventoryRole,
  INVENTORY_OPERATIONS_ROLE,
  publicUserRole
} from "./user-role.js";

test("legacy inventory managers receive the expanded public role", () => {
  assert.equal(publicUserRole("Inventory Manager"), INVENTORY_OPERATIONS_ROLE);
  assert.equal(publicUserRole("Owner"), "Owner");
});

test("only enum compatibility failures use the legacy storage fallback", () => {
  assert.equal(canFallbackToLegacyInventoryRole({ code: "22P02", message: "invalid input value for enum" }), true);
  assert.equal(canFallbackToLegacyInventoryRole({ message: `Role ${INVENTORY_OPERATIONS_ROLE} is unavailable` }), true);
  assert.equal(canFallbackToLegacyInventoryRole({ code: "23505", message: "duplicate key" }), false);
});
