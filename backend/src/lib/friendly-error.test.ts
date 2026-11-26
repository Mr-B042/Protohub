import { test } from "node:test";
import assert from "node:assert/strict";
import { friendlyError, fieldLabel } from "./friendly-error.js";

test("BUG-1003's raw database text becomes plain words with what to do", () => {
  const out = friendlyError('new row for relation "cart_contact_attempts" violates check constraint "cart_attempt_outcome_valid"')!;
  assert.match(out.message, /^Not saved/);
  assert.match(out.message, /Report a Bug/);
  assert.match(out.detail, /cart_attempt_outcome_valid/);
});

test("each kind of database error says what happened and what to do", () => {
  assert.match(friendlyError('null value in column "customer_phone" of relation "orders" violates not-null constraint')!.message, /"Customer phone" is missing\. Fill it in/);
  assert.match(friendlyError('duplicate key value violates unique constraint "orders_pkey"')!.message, /already exists\. Refresh/);
  assert.match(friendlyError('insert or update on table "orders" violates foreign key constraint "orders_agent_id_fkey"')!.message, /no longer exists/);
  assert.match(friendlyError('invalid input syntax for type numeric: "5,000"')!.message, /a number \("5,000"\) is in the wrong format/);
  assert.match(friendlyError('invalid input value for enum user_role: "Delivery Agent"')!.message, /"Delivery Agent" is not an accepted choice/);
  assert.match(friendlyError("canceling statement due to statement timeout")!.message, /took too long/);
  assert.match(friendlyError("TypeError: fetch failed")!.message, /couldn't reach its database/);
  assert.match(friendlyError("Could not find the 'tap_channel' column of 'cart_contact_attempts' in the schema cache")!.message, /out of date/);
  assert.match(friendlyError("Cannot read properties of undefined (reading 'id')")!.message, /on our side/);
  assert.match(friendlyError("Internal server error.")!.message, /on our side/);
  assert.equal(fieldLabel("assigned_rep_id"), "Assigned rep");
});

test("a route's own plain message is left exactly as written", () => {
  for (const plain of ["Pick why the customer said no.", "Only the Owner can approve this.", "Order not found.", "Delivery fee is not defined for this state yet.", "Permission denied: only Admins can do this."]) {
    assert.equal(friendlyError(plain), null, plain);
  }
});
