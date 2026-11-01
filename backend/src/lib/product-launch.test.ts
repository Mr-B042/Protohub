import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_LAUNCH_SETTINGS, canSeeSilentOrders, hideSilentOrders, isAllowedSwitch, launchSettingsOf, switchRevealsOrders
} from "./product-launch.js";

test("settings fall back to Bright's choices: no customer messages in Silent Test, left out of the rate", () => {
  assert.deepEqual(launchSettingsOf(null), DEFAULT_LAUNCH_SETTINGS);
  assert.equal(DEFAULT_LAUNCH_SETTINGS.silentCustomerMessages, false);
  assert.equal(DEFAULT_LAUNCH_SETTINGS.softLeaveOutOfRate, true);
  assert.deepEqual(launchSettingsOf({ silentHoldCarts: false, junk: 1, revealRepAlerts: "yes" }), { ...DEFAULT_LAUNCH_SETTINGS, silentHoldCarts: false });
});

test("only leaving Silent Test reveals orders", () => {
  assert.equal(switchRevealsOrders("silent", "soft"), true);
  assert.equal(switchRevealsOrders("silent", "live"), true);
  assert.equal(switchRevealsOrders("soft", "live"), false);
  assert.equal(switchRevealsOrders("live", "silent"), false);
  assert.equal(isAllowedSwitch("soft", "soft"), false);
});

test("Silent Test orders are hidden from every role but the Owner, including an Owner previewing a rep", () => {
  const calls: Array<[string, string]> = [];
  const query = { neq(column: string, value: string) { calls.push([column, value]); return query; } };
  hideSilentOrders(query, "Owner");
  assert.deepEqual(calls, []);
  for (const role of ["Admin", "Manager", "Sales Rep", "Inventory Manager & Logistics Operations"]) hideSilentOrders(query, role);
  assert.equal(calls.length, 4);
  assert.deepEqual(calls[0], ["launch_stage", "silent"]);
  assert.equal(canSeeSilentOrders(undefined), false);
});
