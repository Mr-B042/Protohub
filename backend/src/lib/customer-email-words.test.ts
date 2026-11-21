import assert from "node:assert/strict";
import test from "node:test";
import { deliveredSubject, firstNameOf, newOrderSubject, statusSubject } from "./customer-email-words.js";

test("first name: plain, title-only and empty", () => {
  assert.equal(firstNameOf("MERCY okafor"), "Mercy");
  assert.equal(firstNameOf("Mrs"), "");
  assert.equal(firstNameOf("  "), "");
  assert.equal(firstNameOf(null), "");
});

test("status subjects name the customer and the product, never Protohub", () => {
  assert.equal(statusSubject("Mercy Okafor", "Multi Corner Storage Shelf", "Confirmed"), "Mercy, your Multi Corner Storage Shelf order is confirmed ✓");
  assert.equal(statusSubject("Peace", "Edge Brusher Max", "Postponed"), "Peace, your Edge Brusher Max has a new delivery day");
  assert.equal(statusSubject("Mrs", "Edge Brusher Max", "Failed"), "We couldn't deliver your Edge Brusher Max");
  assert.equal(statusSubject("Ada", "Shelf", "Scheduled"), "Ada, an update on your Shelf order");
  for (const s of ["Confirmed", "Postponed", "Failed", "Other"]) assert.ok(!/protohub/i.test(statusSubject("Ada", "Shelf", s)));
});

test("new-order and delivered subjects", () => {
  assert.equal(newOrderSubject("Ada", "Shelf"), "Ada, we got your Shelf order ✓");
  assert.equal(deliveredSubject("", "Shelf"), "Your Shelf has been delivered 💙");
});
