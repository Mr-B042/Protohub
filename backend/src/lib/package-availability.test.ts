import assert from "node:assert/strict";
import test from "node:test";
import { packageAllowsState, serviceableAgentStockByProductForState } from "./package-availability.js";

test("normal packages are available in every state by default", () => {
  assert.equal(packageAllowsState({ id: "pkg-1" }, "Lagos"), true);
  assert.equal(packageAllowsState({ id: "pkg-1", state_filter_mode: "all", state_restrictions: ["Lagos"] }, "Kano"), true);
});

test("allow-list packages only show in selected states", () => {
  const pkg = { id: "pkg-2", state_filter_mode: "allow", state_restrictions: ["Lagos", "FCT Abuja"] };
  assert.equal(packageAllowsState(pkg, "Lagos"), true);
  assert.equal(packageAllowsState(pkg, "Abuja"), true);
  assert.equal(packageAllowsState(pkg, "Rivers"), false);
});

test("block-list packages hide only selected states", () => {
  const pkg = { id: "pkg-3", state_filter_mode: "block", state_restrictions: ["Oyo"] };
  assert.equal(packageAllowsState(pkg, "Lagos"), true);
  assert.equal(packageAllowsState(pkg, "Oyo"), false);
});

test("serviceable state stock counts covered-agent stock even when the physical hub is in another state", () => {
  const available = serviceableAgentStockByProductForState([
    {
      primary_base_state: "FCT Abuja",
      coverage: [{ state: "Lagos", active: true }],
      locations: [
        {
          active: true,
          stock: [{ product_id: "prod-1", quantity: 7 }]
        }
      ]
    }
  ], "Lagos");

  assert.equal(available.get("prod-1"), 7);
});

test("serviceable state stock falls back to the agent base state when no explicit coverage rows exist", () => {
  const available = serviceableAgentStockByProductForState([
    {
      primary_base_state: "Rivers",
      locations: [
        {
          active: true,
          stock: [{ product_id: "prod-2", quantity: 3 }]
        }
      ]
    }
  ], "Rivers");

  assert.equal(available.get("prod-2"), 3);
});
