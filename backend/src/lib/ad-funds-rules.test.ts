import assert from "node:assert/strict";
import test from "node:test";
import { alertDue, amountInWords, cleanFundsSettings, fundsLeft, lowReason } from "./ad-funds-rules.js";

test("settings default to on at ₦5,000 and reject junk", () => {
  assert.deepEqual(cleanFundsSettings(undefined), { enabled: true, threshold: 5000 });
  assert.deepEqual(cleanFundsSettings({ enabled: false, threshold: "7500" }), { enabled: false, threshold: 7500 });
  assert.deepEqual(cleanFundsSettings({ threshold: -3 }), { enabled: true, threshold: 5000 });
});

test("amount read from Meta's words", () => {
  assert.equal(amountInWords("Available balance (NGN 4,500.00)"), 4500);
  assert.equal(amountInWords("Available Balance (NGN12,345.67 NGN)"), 12345.67);
  assert.equal(amountInWords("Visa *1234"), 1234);
  assert.equal(amountInWords(""), null);
});

test("prepaid balance", () => {
  assert.deepEqual(fundsLeft({ currency: "NGN", is_prepay_account: true, funding_source_details: { type: 20, display_string: "Available balance (NGN 3,200.00)" } }), { left: 3200, source: "prepaid" });
});

test("spending limit left, in naira from kobo", () => {
  assert.deepEqual(fundsLeft({ currency: "NGN", spend_cap: "2000000", amount_spent: "1700000", funding_source_details: { type: 1, display_string: "Visa *1234" } }), { left: 3000, source: "spend_limit" });
});

test("card charged after, no limit: nothing to run out of", () => {
  assert.deepEqual(fundsLeft({ currency: "NGN", spend_cap: "0", amount_spent: "999", funding_source_details: { type: 1, display_string: "Visa *1234" } }), { left: null, source: null });
});

test("prepaid with Meta's own limit: the Available balance (with VAT), as Ads Manager shows", () => {
  // Real reading, 12 Nov 2026: limit minus spent = ₦20,465.12 = ₦22,000 / 1.075.
  assert.deepEqual(fundsLeft({ currency: "NGN", is_prepay_account: true, spend_cap: "1734261462", amount_spent: "1734240857", funding_source_details: { type: 20, display_string: "Available balance (NGN221.50)" } }), { left: 221.5, source: "prepaid" });
  assert.deepEqual(fundsLeft({ currency: "NGN", spend_cap: "1000000", amount_spent: "966666.6", funding_source_details: { type: 1, display_string: "Visa *1234" } }), { left: 333.33, source: "spend_limit" });
});

test("low only below the level, naira only; unpaid always", () => {
  assert.equal(lowReason({ left: 4999, currency: "NGN", accountStatus: 1, threshold: 5000 }), "low");
  assert.equal(lowReason({ left: 5000, currency: "NGN", accountStatus: 1, threshold: 5000 }), null);
  assert.equal(lowReason({ left: 10, currency: "ZMW", accountStatus: 1, threshold: 5000 }), null);
  assert.equal(lowReason({ left: null, currency: "NGN", accountStatus: 1, threshold: 5000 }), null);
  assert.equal(lowReason({ left: null, currency: "NGN", accountStatus: 3, threshold: 5000 }), "unpaid");
});

test("alert at once, then every 6 hours in the day only", () => {
  const at = (iso: string) => Date.parse(iso);
  assert.equal(alertDue({ low: false, lowSince: null, lastAlertAt: null, nowMs: at("2026-11-12T10:00:00Z") }), null);
  // First drop at 2am Lagos still alerts: the ads stop when it runs out.
  assert.equal(alertDue({ low: true, lowSince: null, lastAlertAt: null, nowMs: at("2026-11-12T01:00:00Z") }), "first");
  assert.equal(alertDue({ low: true, lowSince: "2026-11-12T08:00:00Z", lastAlertAt: "2026-11-12T08:00:00Z", nowMs: at("2026-11-12T12:00:00Z") }), null);
  assert.equal(alertDue({ low: true, lowSince: "2026-11-12T08:00:00Z", lastAlertAt: "2026-11-12T08:00:00Z", nowMs: at("2026-11-12T14:00:00Z") }), "remind");
  // 11pm Lagos: no reminder at night.
  assert.equal(alertDue({ low: true, lowSince: "2026-11-12T08:00:00Z", lastAlertAt: "2026-11-12T08:00:00Z", nowMs: at("2026-11-12T22:00:00Z") }), null);
});
