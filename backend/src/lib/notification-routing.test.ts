import { test } from "node:test";
import assert from "node:assert/strict";
import { ALERTS, cleanRoute } from "./notification-routing-rules.js";

test("defaults keep today's behaviour: Admins get every Owner order alert", () => {
  for (const key of ["order_new", "order_confirmed", "order_delivered", "order_failed", "order_cancelled", "order_rescheduled", "order_follow_up", "cart_assigned"] as const) {
    assert.ok(ALERTS[key].defaults.roles.includes("Owner"), key);
    assert.ok(ALERTS[key].defaults.roles.includes("Admin"), key);
  }
});

test("cleanRoute drops unknown roles and duplicates", () => {
  assert.deepEqual(cleanRoute("order_delivered", { roles: ["Owner", "Owner", "Hacker"], rep: false, push: false }), { roles: ["Owner"], rep: false, push: false });
});

test("cleanRoute falls back to the default for junk", () => {
  assert.deepEqual(cleanRoute("order_failed", null), ALERTS.order_failed.defaults);
  assert.notEqual(cleanRoute("order_failed", null).roles, ALERTS.order_failed.defaults.roles);
});

test("new-cart alert never goes to 'the rep' (there is none yet)", () => {
  assert.equal(cleanRoute("cart_new", { roles: [], rep: true, push: true }).rep, false);
});
