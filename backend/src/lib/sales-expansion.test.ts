import assert from "node:assert/strict";
import test from "node:test";
import { complianceBonusDecision, complianceBonusDecisionWithWaiver, complianceGraceWindow, defaultSalesExpansionSettings, isSalesExpansionTriggerOutcome, salesExpansionSummaryFromRows } from "./sales-expansion.js";

test("sales expansion prompts only for Ready and Rescheduled outcomes", () => {
  assert.equal(isSalesExpansionTriggerOutcome("Ready"), true);
  assert.equal(isSalesExpansionTriggerOutcome(" rescheduled "), true);
  assert.equal(isSalesExpansionTriggerOutcome("Pending"), false);
  assert.equal(isSalesExpansionTriggerOutcome("Not Ready"), false);
  assert.equal(isSalesExpansionTriggerOutcome("Call Back"), false);
  assert.equal(isSalesExpansionTriggerOutcome(null), false);
});

test("compliance bonus tiers reduce performance bonus only at the configured thresholds", () => {
  const settings = defaultSalesExpansionSettings();
  assert.deepEqual(complianceBonusDecision(100, settings), { bonusMultiplier: 1, reductionPct: 0, level: "full", formalWarning: false });
  assert.equal(complianceBonusDecision(98, settings).bonusMultiplier, 1);
  assert.equal(complianceBonusDecision(97.9, settings).bonusMultiplier, 0.95);
  assert.equal(complianceBonusDecision(94, settings).bonusMultiplier, 0.9);
  assert.deepEqual(complianceBonusDecision(89.9, settings), { bonusMultiplier: 0, reductionPct: 100, level: "no_compliance_bonus", formalWarning: true });
});

test("an Owner waiver restores pay without erasing the policy deduction evidence", () => {
  const decision = complianceBonusDecision(89, defaultSalesExpansionSettings());
  assert.deepEqual(complianceBonusDecisionWithWaiver(decision, true), {
    bonusMultiplier: 1,
    reductionPct: 0,
    policyBonusMultiplier: 0,
    policyReductionPct: 100
  });
  assert.deepEqual(complianceBonusDecisionWithWaiver(decision, false), {
    bonusMultiplier: 0,
    reductionPct: 100,
    policyBonusMultiplier: 0,
    policyReductionPct: 100
  });
});

test("the active week keeps earned bonus protected until Saturday night in Lagos", () => {
  const decision = complianceBonusDecision(89, defaultSalesExpansionSettings());
  assert.deepEqual(complianceBonusDecisionWithWaiver(decision, false, true), {
    bonusMultiplier: 1,
    reductionPct: 0,
    policyBonusMultiplier: 0,
    policyReductionPct: 100
  });

  const beforeDeadline = complianceGraceWindow("2026-07-12", new Date("2026-07-18T22:59:59.998Z"));
  assert.equal(beforeDeadline.graceActive, true);
  assert.equal(beforeDeadline.deadlineAt, "2026-07-18T22:59:59.999Z");
  assert.equal(beforeDeadline.deductionAppliesAt, "2026-07-18T23:00:00.000Z");

  const afterDeadline = complianceGraceWindow("2026-07-12", new Date("2026-07-18T23:00:00.000Z"));
  assert.equal(afterDeadline.graceActive, false);
  assert.deepEqual(complianceBonusDecisionWithWaiver(decision, false, afterDeadline.graceActive), {
    bonusMultiplier: 0,
    reductionPct: 100,
    policyBonusMultiplier: 0,
    policyReductionPct: 100
  });
});

test("delivered conversion counts only accepted add-ons still present on delivered orders", () => {
  const attempts = [
    { id: "a1", order_id: "o1", eligibility: "eligible", record_status: "active" },
    { id: "a2", order_id: "o2", eligibility: "eligible", record_status: "active" },
    { id: "a3", order_id: "o3", eligibility: "exempt", record_status: "active" }
  ];
  const lines = [
    { order_id: "o1", offer_type: "cross_sell", response: "accepted", linked_order_item_id: "line-1", accepted_amount: 5000 },
    { order_id: "o2", offer_type: "cross_sell", response: "accepted", linked_order_item_id: "line-2", accepted_amount: 7000 }
  ];
  const orders = [
    { id: "o1", status: "Delivered", cross_sell_lines: [{ id: "line-1" }] },
    { id: "o2", status: "Delivered", cross_sell_lines: [] }
  ];
  const summary = salesExpansionSummaryFromRows(attempts, orders, lines);
  assert.equal(summary.crossSellAcceptedCount, 2);
  assert.equal(summary.crossSellDeliveredCount, 1);
  assert.equal(summary.deliveredAddOnValue, 5000);
});
