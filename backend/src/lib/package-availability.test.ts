import assert from "node:assert/strict";
import test from "node:test";
import { packageAllowsState } from "./package-availability.js";

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
