import assert from "node:assert/strict";
import test from "node:test";
import { writtenReasonProblem } from "./cart-written-reason.js";

test("Not interested needs a written reason in the customer's words", () => {
  assert.match(writtenReasonProblem("", "Price")!, /Write what/);
  assert.match(writtenReasonProblem("   ", "Price")!, /Write what/);
  assert.match(writtenReasonProblem("too costly", "Price")!, /3 words/);
  assert.match(writtenReasonProblem("no no no", "Price")!, /3 words/);
  assert.match(writtenReasonProblem("Not available in their area.", "Not available in their area")!, /repeat/);
  assert.match(writtenReasonProblem("Customer not interested", "Price")!, /3 words|repeat/);
  assert.equal(writtenReasonProblem("Said we don't deliver to Lafia, wants pickup in Abuja", "Not available in their area"), null);
  assert.equal(writtenReasonProblem("He said ₦39,500 is too much for him", "Price"), null);
});
