import { test } from "node:test";
import assert from "node:assert/strict";
import { carryMissingFees } from "./missing-fee-carry.js";

test("charges a bonus can cover carry nothing", () => {
  assert.equal(carryMissingFees([{ charges: 1000, payable: 13625 }]), 0);
});

test("charges bigger than the payout carry the rest", () => {
  assert.equal(carryMissingFees([{ charges: 1500, payable: 1000 }]), 500);
});

test("a carried rest is taken first the next week", () => {
  assert.equal(carryMissingFees([{ charges: 1500, payable: 0 }, { charges: 0, payable: 1000 }]), 500);
  assert.equal(carryMissingFees([{ charges: 1500, payable: 0 }, { charges: 500, payable: 5000 }]), 0);
});

test("a week with no report pays nothing", () => {
  assert.equal(carryMissingFees([{ charges: 500, payable: 0 }]), 500);
});
