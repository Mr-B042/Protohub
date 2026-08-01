import assert from "node:assert/strict";
import test from "node:test";
import { resolveStandardFee, ruleMatches, limitsForTrustLevel, type FeeRule } from "./pda-fees.js";

const rule = (over: Partial<FeeRule> & Pick<FeeRule, "id" | "scope" | "fee">): FeeRule =>
  ({ matchValue: null, active: true, sameDaySurcharge: 0, ...over });

const rules: FeeRule[] = [
  rule({ id: "default", scope: "default", fee: 3000 }),
  rule({ id: "rivers", scope: "state", matchValue: "Rivers", fee: 5000, sameDaySurcharge: 1000 }),
  rule({ id: "gra", scope: "city", matchValue: "GRA", fee: 4000 })
];

test("the most specific rule wins, so a city rate beats its state rate", () => {
  const resolved = resolveStandardFee(rules, { state: "Rivers", city: "GRA" });
  assert.equal(resolved.total, 4000);
  assert.equal(resolved.ruleId, "gra");
});

test("a state rate applies when no city rate matches", () => {
  const resolved = resolveStandardFee(rules, { state: "Rivers", city: "Diobu" });
  assert.equal(resolved.total, 5000);
});

test("the default only applies when nothing else matches", () => {
  assert.equal(resolveStandardFee(rules, { state: "Kano" }).total, 3000);
});

test("state matching ignores the word State", () => {
  assert.equal(resolveStandardFee(rules, { state: "Rivers State" }).ruleId, "rivers");
});

test("the same-day surcharge is added only when asked for", () => {
  assert.equal(resolveStandardFee(rules, { state: "Rivers", sameDay: false }).total, 5000);
  const surcharged = resolveStandardFee(rules, { state: "Rivers", sameDay: true });
  assert.equal(surcharged.total, 6000);
  assert.match(surcharged.reason, /same-day surcharge/);
});

test("distance bands match on their range", () => {
  const band = rule({ id: "far", scope: "distance", distanceMinKm: 20, distanceMaxKm: 50, fee: 8000 });
  assert.equal(ruleMatches(band, { distanceKm: 30 }), true);
  assert.equal(ruleMatches(band, { distanceKm: 60 }), false);
  assert.equal(ruleMatches(band, {}), false, "no distance known means the band cannot apply");
});

test("an inactive rule never applies", () => {
  const off = [rule({ id: "off", scope: "state", matchValue: "Rivers", fee: 9999, active: false }), ...rules];
  assert.equal(resolveStandardFee(off, { state: "Rivers" }).total, 5000);
});

test("with no rules at all the caller is told to set one, not quietly charged zero", () => {
  const resolved = resolveStandardFee([], { state: "Rivers" });
  assert.equal(resolved.total, 0);
  assert.equal(resolved.ruleId, null);
  assert.match(resolved.reason, /Set a default rate/);
});

test("duplicate rules of equal specificity resolve to the cheaper one", () => {
  const dupes = [
    rule({ id: "a", scope: "state", matchValue: "Rivers", fee: 7000 }),
    rule({ id: "b", scope: "state", matchValue: "Rivers", fee: 5000 })
  ];
  assert.equal(resolveStandardFee(dupes, { state: "Rivers" }).total, 5000);
});

test("every resolution explains which rule decided it", () => {
  assert.match(resolveStandardFee(rules, { state: "Rivers" }).reason, /state rate for Rivers/);
  assert.match(resolveStandardFee(rules, { state: "Kano" }).reason, /default rate/);
});

const limitSettings = {
  probationMaxStock: 20, probationMaxCod: 100000, probationMaxActiveOrders: 3,
  verifiedMaxStock: 60, verifiedMaxCod: 300000, verifiedMaxActiveOrders: 8,
  trustedMaxStock: 150, trustedMaxCod: 750000, trustedMaxActiveOrders: 15
};

test("trust levels map to their configured limits", () => {
  assert.equal(limitsForTrustLevel("Trusted", limitSettings).maxStock, 150);
  assert.equal(limitsForTrustLevel("Verified", limitSettings).maxCod, 300000);
  assert.equal(limitsForTrustLevel("Probation", limitSettings).maxActiveOrders, 3);
});

test("an unrecognised trust level falls to the TIGHTEST limits, never the loosest", () => {
  // A typo or a future level must not accidentally grant maximum exposure.
  assert.deepEqual(limitsForTrustLevel("Platinum", limitSettings), limitsForTrustLevel("Probation", limitSettings));
});
