import { test } from "node:test";
import assert from "node:assert/strict";
import { friendlyError, fieldLabel } from "./friendly-error.js";

const say = (raw: string) => friendlyError(raw)!.message;

test("BUG-1003's refusal says it was not their fault and what to do now", () => {
  const out = friendlyError('new row for relation "cart_contact_attempts" violates check constraint "cart_attempt_outcome_valid"')!;
  assert.match(out.message, /^Not saved\. You did nothing wrong/);
  assert.match(out.message, /pick another option that fits and save again/);
  assert.match(out.message, /Report a Bug/);
  assert.match(out.detail, /cart_attempt_outcome_valid/);
});

test("each message says what went wrong and exactly how to fix it", () => {
  assert.equal(say('null value in column "next_action_at" of relation "x" violates not-null constraint'), 'Not saved. "Call-back date" is empty. Fill it in, then save again.');
  assert.match(say('duplicate key value violates unique constraint "orders_pkey"'), /tapped Save twice.*Refresh the page/);
  assert.match(say('insert or update on table "orders" violates foreign key constraint "x"'), /deleted or changed by someone else\. Refresh the page, pick it again/);
  assert.match(say('invalid input syntax for type numeric: "5,000"'), /You typed "5,000"\. Type numbers only, with no commas.*write 5000/);
  assert.match(say('invalid input syntax for type date: "28th"'), /Pick it again from the calendar/);
  assert.match(say('invalid input value for enum user_role: "Delivery Agent"'), /"Delivery Agent" is not one of the options here\. Pick one from the list/);
  assert.match(say("canceling statement due to statement timeout"), /You did nothing wrong\. Wait a minute and try again/);
  assert.match(say("TypeError: fetch failed"), /lost its connection/);
  assert.match(say("Could not find the 'tap_channel' column of 'x' in the schema cache"), /not set up yet on our side\. Tap Report a Bug/);
  assert.match(say("Cannot read properties of undefined (reading 'id')"), /Try once more\. If it happens again, tap Report a Bug/);
  assert.equal(fieldLabel("assigned_rep_id"), "Sales rep");
  assert.equal(fieldLabel("waybill_fee"), "Waybill fee");
});

test("no message uses words a rep would have to decode", () => {
  const raws = ['violates check constraint "a"', 'null value in column "a" violates not-null constraint', "duplicate key value violates unique constraint", "violates foreign key constraint",
    'invalid input syntax for type uuid: "x"', "value too long for type", "statement timeout", "JWT expired", "permission denied for table x", "fetch failed", "PGRST204", "Internal server error."];
  for (const raw of raws) assert.doesNotMatch(say(raw), /database|constraint|column|relation|server|schema|syntax|uuid|enum|JWT|format|value|record|query|request/i, raw);
});

test("a route's own plain message is left exactly as written", () => {
  for (const plain of ["Pick why the customer said no.", "Only the Owner can approve this.", "Order not found.", "Delivery fee is not defined for this state yet.", "Permission denied: only Admins can do this."]) {
    assert.equal(friendlyError(plain), null, plain);
  }
});
