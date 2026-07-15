import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSmartStockAlertCandidates } from "./smart-stock-candidates.js";

test("an empty agent is flagged even when another agent makes the state total look healthy", () => {
  const rows = buildSmartStockAlertCandidates({
    stateSupply: [{ productId: "edge", state: "Abuja", stock: 20 }],
    agentSupply: [
      { agentId: "agent-empty", agentName: "Bright Abuja", productId: "edge", state: "Abuja", stock: 0 },
      { agentId: "agent-stocked", agentName: "Backup Abuja", productId: "edge", state: "Abuja", stock: 20 }
    ],
    demand: [{ productId: "edge", state: "Abuja", recentOrders: 7, recentUnits: 7 }]
  });

  assert.deepEqual(rows, [{
    scope: "agent",
    productId: "edge",
    state: "Abuja",
    stock: 0,
    recentOrders: 7,
    recentUnits: 7,
    daysOfStock: 0,
    agentId: "agent-empty",
    agentName: "Bright Abuja"
  }]);
});

test("a state-wide shortage produces one state alert instead of duplicate agent alerts", () => {
  const rows = buildSmartStockAlertCandidates({
    stateSupply: [{ productId: "rack", state: "Edo", stock: 1 }],
    agentSupply: [
      { agentId: "edo-agent", agentName: "Edo Atomic", productId: "rack", state: "Edo", stock: 1 }
    ],
    demand: [{ productId: "rack", state: "Edo", recentOrders: 4, recentUnits: 7 }]
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.scope, "state");
  assert.equal(rows[0]?.stock, 1);
  assert.equal(rows[0]?.recentUnits, 7);
});

test("demand below the minimum does not create noisy background alerts", () => {
  const rows = buildSmartStockAlertCandidates({
    stateSupply: [{ productId: "slow", state: "Lagos", stock: 0 }],
    agentSupply: [
      { agentId: "lagos-agent", agentName: "Lagos LBN", productId: "slow", state: "Lagos", stock: 0 }
    ],
    demand: [{ productId: "slow", state: "Lagos", recentOrders: 1, recentUnits: 1 }]
  });

  assert.deepEqual(rows, []);
});
