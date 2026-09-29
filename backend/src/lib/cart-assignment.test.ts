import assert from "node:assert/strict";
import test from "node:test";
import {
  AUTO_SUBMIT_GIVES_UP_MS, DEFAULT_ASSIGNMENT_RULES, cartContactNumber, handOutWaitMs
} from "./cart-assignment.js";

const MIN = 60 * 1000;

// Onoh Amaka's cart, 29 Sept: every detail filled in, never submitted.
const complete = {
  customer: "Onoh Amaka", phone: "08034742355", address: "9 excellence close along eleme road",
  city: "Port Harcourt", state: "Rivers", product_id: "p1", package_id: "k1"
};
const halfFinished = { ...complete, address: null };

test("a complete cart is handed out after the normal wait when auto-submit is off", () => {
  assert.equal(handOutWaitMs(complete, DEFAULT_ASSIGNMENT_RULES, "off"), 10 * MIN);
});

test("a complete cart is handed out after the normal wait in cart mode - it stays a cart there", () => {
  assert.equal(handOutWaitMs(complete, DEFAULT_ASSIGNMENT_RULES, "cart"), 10 * MIN);
});

test("under full auto-submit a complete cart waits until the converter has given up", () => {
  const wait = handOutWaitMs(complete, DEFAULT_ASSIGNMENT_RULES, "full");
  assert.ok(wait > AUTO_SUBMIT_GIVES_UP_MS, "must not race the converter inside its window");
  assert.equal(wait, 17 * MIN);
});

test("a half-finished cart always waits the normal time, whatever the mode", () => {
  for (const mode of ["full", "cart", "off"] as const) {
    assert.equal(handOutWaitMs(halfFinished, DEFAULT_ASSIGNMENT_RULES, mode), 10 * MIN);
  }
});

test("a branch's own longer wait is kept", () => {
  const rules = { ...DEFAULT_ASSIGNMENT_RULES, assignmentDelayMinutes: 30 };
  assert.equal(handOutWaitMs(complete, rules, "full"), 30 * MIN);
  assert.equal(handOutWaitMs(halfFinished, rules, "off"), 30 * MIN);
});

test("the WhatsApp number is used when the phone box is incomplete (Edet John, 27 Sept)", () => {
  assert.equal(cartContactNumber({ phone: "070", whatsapp: "07025844645" }), "07025844645");
});

test("the phone number wins when both are usable", () => {
  assert.equal(cartContactNumber({ phone: "08034742355", whatsapp: "07025844645" }), "08034742355");
});

test("no usable number means nobody is handed the cart", () => {
  assert.equal(cartContactNumber({ phone: "070", whatsapp: null }), null);
  assert.equal(cartContactNumber({ phone: "No phone yet", whatsapp: "" }), null);
});
