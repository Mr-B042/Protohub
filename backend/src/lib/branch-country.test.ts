import assert from "node:assert/strict";
import test from "node:test";
import { zambianPhoneForSave } from "./branch-country.js";

test("Zambian numbers are saved as 0971234567 however they were typed", () => {
  for (const typed of ["0971234567", "971234567", "+260971234567", "260 97 123 4567", "00260971234567"]) assert.equal(zambianPhoneForSave(typed), "0971234567", typed);
  assert.equal(zambianPhoneForSave("0761234567"), "0761234567");
  assert.equal(zambianPhoneForSave("12345"), "12345", "not a Zambian mobile: kept as typed");
  assert.equal(zambianPhoneForSave("08031234567"), "08031234567", "a Nigerian number is left alone");
});
