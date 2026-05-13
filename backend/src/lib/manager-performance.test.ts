import test from "node:test";
import assert from "node:assert/strict";
import { buildManagerPerformance } from "./manager-performance.js";

const now = Date.now();
const daysAgo = (days: number) => new Date(now - days * 24 * 60 * 60 * 1000).toISOString();

test("empty teams score zero and report no activity", () => {
  const result = buildManagerPerformance(
    [{ id: "team-1", name: "North", leadId: "lead-1", productIds: [], memberIds: ["rep-1"] }],
    [{ id: "lead-1", name: "Lead", active: true }, { id: "rep-1", name: "Rep", active: true }],
    []
  );

  assert.equal(result.rows[0]?.hasActivity, false);
  assert.equal(result.rows[0]?.score, 0);
  assert.equal(result.summary.averageScore, 0);
});

test("perfect teams score 100", () => {
  const result = buildManagerPerformance(
    [{ id: "team-1", name: "North", leadId: "lead-1", productIds: [], memberIds: ["rep-1", "rep-2"] }],
    [
      { id: "lead-1", name: "Lead", active: true },
      { id: "rep-1", name: "Rep 1", active: true },
      { id: "rep-2", name: "Rep 2", active: true }
    ],
    [
      { id: "o1", assignedRepId: "rep-1", productId: "p1", status: "Delivered", createdAt: daysAgo(2) },
      { id: "o2", assignedRepId: "rep-2", productId: "p1", status: "Delivered", createdAt: daysAgo(1) }
    ]
  );

  assert.equal(result.rows[0]?.deliveryRate, 100);
  assert.equal(result.rows[0]?.confirmedPathRate, 100);
  assert.equal(result.rows[0]?.score, 100);
  assert.equal(result.summary.overallDeliveryRate, 100);
});

test("overdue follow-ups and stale pipeline drag scores down", () => {
  const result = buildManagerPerformance(
    [{ id: "team-1", name: "North", leadId: "lead-1", productIds: [], memberIds: ["rep-1", "rep-2"] }],
    [
      { id: "lead-1", name: "Lead", active: true },
      { id: "rep-1", name: "Rep 1", active: true },
      { id: "rep-2", name: "Rep 2", active: true }
    ],
    [
      { id: "o1", assignedRepId: "rep-1", productId: "p1", status: "Delivered", createdAt: daysAgo(4) },
      {
        id: "o2",
        assignedRepId: "rep-2",
        productId: "p1",
        status: "Postponed",
        createdAt: daysAgo(3),
        timelineNotes: [{ id: "n1", text: "call back", by: "Rep 2", date: daysAgo(3), followUpAt: daysAgo(1) }]
      },
      { id: "o3", assignedRepId: "rep-2", productId: "p1", status: "Confirmed", createdAt: daysAgo(3) }
    ]
  );

  assert.equal(result.rows[0]?.overdueFollowUps, 1);
  assert.equal(result.rows[0]?.pipelineAtRisk, 2);
  assert.equal(result.rows[0]?.followUpCompliance, 0);
  assert.equal(result.rows[0]?.pipelineHealth, 0);
  assert.ok((result.rows[0]?.score ?? 0) < 30);
});

test("scoped teams ignore orders outside their product scope", () => {
  const result = buildManagerPerformance(
    [{ id: "team-1", name: "North", leadId: "lead-1", productIds: ["p1"], memberIds: ["rep-1", "rep-2"] }],
    [
      { id: "lead-1", name: "Lead", active: true },
      { id: "rep-1", name: "Rep 1", active: true },
      { id: "rep-2", name: "Rep 2", active: true }
    ],
    [
      { id: "o1", assignedRepId: "rep-1", productId: "p1", status: "Delivered", createdAt: daysAgo(2) },
      { id: "o2", assignedRepId: "rep-2", productId: "p2", status: "Failed", createdAt: daysAgo(2) }
    ]
  );

  assert.equal(result.rows[0]?.orders, 1);
  assert.equal(result.rows[0]?.delivered, 1);
  assert.equal(result.rows[0]?.score, 100);
});
