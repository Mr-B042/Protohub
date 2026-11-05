import test from "node:test";
import assert from "node:assert/strict";
import { nigerianPhoneForSave } from "./ng-phone.js";

test("every accepted way of writing a number is saved as 080...", () => {
  for (const typed of ["+23408168580493", "08168580493", "+2348168580493", "8168580493", "234 816 858 0493", "0816-858-0493"]) {
    assert.equal(nigerianPhoneForSave(typed), "08168580493", typed);
  }
});

test("anything that is not a full mobile number is kept as typed", () => {
  for (const typed of ["No phone yet", "0803", "0803546892", "05012345678", "", undefined, null]) {
    assert.equal(nigerianPhoneForSave(typed), typed, String(typed));
  }
});
