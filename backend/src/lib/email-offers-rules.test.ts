import assert from "node:assert/strict";
import test from "node:test";
import { benefitText, codeFrom, discountFor, offerProblem, offerState, type Offer, type OfferCheck } from "./email-offers-rules.js";

const NOW = Date.parse("2026-11-08T12:00:00+01:00");
const DAY = 86_400_000;
const offer = (extra: Partial<Offer> = {}): Offer => ({
  id: "o1", name: "Flash", type: "flash", benefit: "percent", value: 10, code: "FLASH10", minOrder: 0, productIds: [], minDelivered: 0,
  startsMs: null, endsMs: null, usageLimit: null, perCustomerLimit: 1, status: "active", ...extra
});
const check = (extra: Partial<OfferCheck> = {}): OfferCheck => ({ productId: "p1", amount: 15_000, nowMs: NOW, usedTotal: 0, usedByCustomer: 0, usedBySend: false, deliveredOrders: 0, ...extra });

test("discount: percent and naira, rounded, never more than the order", () => {
  assert.equal(discountFor({ benefit: "percent", value: 10 }, 15_000), 1_500);
  assert.equal(discountFor({ benefit: "percent", value: 12.5 }, 9_999), 1_250);
  assert.equal(discountFor({ benefit: "fixed", value: 500 }, 15_000), 500);
  assert.equal(discountFor({ benefit: "fixed", value: 20_000 }, 15_000), 15_000);
  assert.equal(discountFor({ benefit: "percent", value: 150 }, 15_000), 15_000);
  assert.equal(discountFor({ benefit: "percent", value: 10 }, 0), 0);
  assert.equal(benefitText({ benefit: "percent", value: 10 }), "10% OFF");
  assert.equal(benefitText({ benefit: "fixed", value: 1500 }), "₦1,500 OFF");
});

test("state: scheduled, live and expired by the dates; paused and drafts never apply", () => {
  assert.equal(offerState(offer({ startsMs: NOW + DAY }), NOW), "scheduled");
  assert.equal(offerState(offer({ startsMs: NOW - DAY, endsMs: NOW + DAY }), NOW), "live");
  assert.equal(offerState(offer({ endsMs: NOW }), NOW), "expired");
  assert.equal(offerState(offer({ status: "paused" }), NOW), "paused");
  assert.match(offerProblem(offer({ status: "draft" }), check())!, /not running/);
});

test("who gets it: products, minimum order, limits, one use per email, loyalty", () => {
  assert.equal(offerProblem(offer(), check()), null);
  assert.match(offerProblem(offer({ productIds: ["p2"] }), check())!, /other products/);
  assert.match(offerProblem(offer({ minOrder: 20_000 }), check())!, /20,000 or more/);
  assert.match(offerProblem(offer(), check({ usedBySend: true }))!, /already used/);
  assert.match(offerProblem(offer({ usageLimit: 5 }), check({ usedTotal: 5 }))!, /used up/);
  assert.match(offerProblem(offer(), check({ usedByCustomer: 1 }))!, /already used this offer/);
  assert.equal(offerProblem(offer({ perCustomerLimit: 2 }), check({ usedByCustomer: 1 })), null);
  assert.match(offerProblem(offer({ minDelivered: 2 }), check({ deliveredOrders: 1 }))!, /2\+ delivered/);
  assert.equal(offerProblem(offer({ minDelivered: 2 }), check({ deliveredOrders: 3 })), null);
});

test("codes: upper case, safe characters, 3 to 24 long", () => {
  assert.equal(codeFrom("flash 10!"), "FLASH10");
  assert.equal(codeFrom("ab"), null);
  assert.equal(codeFrom("new_customer-500"), "NEW_CUSTOMER-500");
});
