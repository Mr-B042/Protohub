import assert from "node:assert/strict";
import test from "node:test";
import { isSettled, owedOnOrder, summariseReceivables, type AgentOrderRow } from "./agent-receivables.js";

const order = (over: Partial<AgentOrderRow> = {}): AgentOrderRow => ({
  orderId: "o1", agentId: "a1", agentName: "Bos Courier",
  amount: 30_000, amountRemitted: 0, logisticsCost: 5_000,
  remittanceStatus: null, settledOn: "2026-08-11", ...over
});

// The bug this file exists to kill.
test("a settled order owes nothing, whatever the arithmetic says", () => {
  const settled = order({ remittanceStatus: "Paid", amountRemitted: 25_000 });
  assert.equal(owedOnOrder(settled), 0);
});

test("the delivery fee an agent kept is not money owed", () => {
  // Agent collected 30,000, kept their 5,000 fee, remitted 25,000. Square.
  assert.equal(owedOnOrder(order({ remittanceStatus: "Paid", amountRemitted: 25_000 })), 0);
  // Same order read the old way would have shown 5,000 outstanding.
  assert.equal(30_000 - 25_000, 5_000);
});

test("Paid is matched case-insensitively and around whitespace", () => {
  assert.equal(isSettled({ remittanceStatus: "paid" }), true);
  assert.equal(isSettled({ remittanceStatus: " Paid " }), true);
  assert.equal(isSettled({ remittanceStatus: "Pending" }), false);
  assert.equal(isSettled({ remittanceStatus: null }), false);
});

test("an unsettled order nets off only the fee already recorded", () => {
  assert.equal(owedOnOrder(order({ amount: 30_000, logisticsCost: 5_000, amountRemitted: 0 })), 25_000);
});

// Monthly-remit agents: the fee does not exist yet, so the full amount is owed.
test("no recorded fee means the agent owes the gross amount", () => {
  assert.equal(owedOnOrder(order({ amount: 30_000, logisticsCost: 0, amountRemitted: 0 })), 30_000);
});

test("a provisional estimate can never reduce the debt, only a recorded fee", () => {
  // Two identical deliveries; only one has had its fee priced.
  const priced = order({ orderId: "priced", logisticsCost: 5_000 });
  const awaiting = order({ orderId: "awaiting", logisticsCost: 0 });
  assert.equal(owedOnOrder(priced), 25_000);
  assert.equal(owedOnOrder(awaiting), 30_000);
  assert.ok(owedOnOrder(awaiting) > owedOnOrder(priced));
});

test("a part remittance leaves only the remainder owing", () => {
  assert.equal(owedOnOrder(order({ amount: 30_000, logisticsCost: 5_000, amountRemitted: 10_000 })), 15_000);
});

test("over-remitting on one order never pays off another", () => {
  const over = order({ orderId: "over", amount: 10_000, logisticsCost: 0, amountRemitted: 25_000 });
  const under = order({ orderId: "under", amount: 30_000, logisticsCost: 0, amountRemitted: 0 });
  assert.equal(owedOnOrder(over), 0);
  assert.equal(summariseReceivables([over, under]).totalOwed, 30_000);
});

test("a fee larger than the order cannot make the debt negative", () => {
  assert.equal(owedOnOrder(order({ amount: 3_000, logisticsCost: 5_000, amountRemitted: 0 })), 0);
});

test("settled orders drop out of the count entirely", () => {
  const summary = summariseReceivables([
    order({ orderId: "a", remittanceStatus: "Paid", amountRemitted: 25_000 }),
    order({ orderId: "b" })
  ]);
  assert.equal(summary.orderCount, 1);
  assert.equal(summary.agentCount, 1);
});

test("nothing outstanding reports zero rather than an empty-looking total", () => {
  const summary = summariseReceivables([order({ remittanceStatus: "Paid", amountRemitted: 25_000 })]);
  assert.equal(summary.totalOwed, 0);
  assert.equal(summary.orderCount, 0);
  assert.deepEqual(summary.byAgent, []);
});

test("agents are ranked by what they owe, worst first", () => {
  const summary = summariseReceivables([
    order({ orderId: "1", agentId: "small", agentName: "Small", amount: 10_000, logisticsCost: 0 }),
    order({ orderId: "2", agentId: "big", agentName: "Big", amount: 90_000, logisticsCost: 0 }),
    order({ orderId: "3", agentId: "big", agentName: "Big", amount: 20_000, logisticsCost: 0 })
  ]);
  assert.deepEqual(summary.byAgent.map((row) => row.agentName), ["Big", "Small"]);
  assert.equal(summary.byAgent[0].owed, 110_000);
  assert.equal(summary.byAgent[0].orders, 2);
});

test("orders still waiting on a fee are counted so the figure can be explained", () => {
  const summary = summariseReceivables([
    order({ orderId: "1", logisticsCost: 0 }),
    order({ orderId: "2", logisticsCost: 0 }),
    order({ orderId: "3", logisticsCost: 4_000 })
  ]);
  assert.equal(summary.ordersAwaitingFee, 2);
  assert.equal(summary.byAgent[0].ordersAwaitingFee, 2);
});

test("the oldest outstanding delivery is surfaced per agent", () => {
  const summary = summariseReceivables([
    order({ orderId: "new", settledOn: "2026-08-20" }),
    order({ orderId: "old", settledOn: "2026-07-03" })
  ]);
  assert.equal(summary.byAgent[0].oldestSettledOn, "2026-07-03");
});

test("an order with no agent is still counted, under Unassigned", () => {
  const summary = summariseReceivables([order({ agentId: null, agentName: "", logisticsCost: 0 })]);
  assert.equal(summary.byAgent[0].agentName, "Unassigned");
  assert.equal(summary.totalOwed, 30_000);
});

test("non-numeric fields read as zero rather than NaN", () => {
  const broken = order({
    amount: Number.NaN, logisticsCost: "" as unknown as number, amountRemitted: null as unknown as number
  });
  assert.equal(owedOnOrder(broken), 0);
  assert.equal(summariseReceivables([broken]).totalOwed, 0);
});
