import { test } from "node:test";
import assert from "node:assert/strict";
import { stateRestockNeeds, stockTotals, type HubStockRow } from "./state-restock-model.js";

const hub = (state: string, productId: string, left: number, onTheWay = 0, agentId = `a-${state}`): HubStockRow => ({ locationId: `l-${state}-${agentId}`, agentId, state, productId, left, onTheWay });

test("Bright's example: Lagos sold 20, has 15 left -> send at least 5", () => {
  const out = stateRestockNeeds({ sold: [{ state: "Lagos", productId: "p", pieces: 20 }], stock: [hub("Lagos", "p", 9, 0, "a1"), hub("Lagos", "p", 6, 0, "a2")] });
  assert.deepEqual(out, [{ state: "Lagos", productId: "p", sold: 20, left: 15, onTheWay: 0, send: 5 }]);
});

test("pieces on the way count toward cover", () => {
  assert.equal(stateRestockNeeds({ sold: [{ state: "Ogun", productId: "p", pieces: 14 }], stock: [hub("Ogun", "p", 4, 10)] }).length, 0);
  assert.equal(stateRestockNeeds({ sold: [{ state: "Ogun", productId: "p", pieces: 14 }], stock: [hub("Ogun", "p", 4, 6)] })[0].send, 4);
});

test("a state that sold under 12 in the week is not busy, so no alert", () => {
  assert.equal(stateRestockNeeds({ sold: [{ state: "Abia", productId: "p", pieces: 11 }], stock: [] }).length, 0);
  assert.equal(stateRestockNeeds({ sold: [{ state: "Imo", productId: "p", pieces: 7 }, { state: "Imo", productId: "p", pieces: 5 }], stock: [hub("Imo", "p", 2)] })[0].send, 10);
});

test("stock totals per state and per agent, with a product filter", () => {
  const rows = [hub("Lagos", "p", 9, 1, "a1"), hub("Lagos", "q", 5, 0, "a1"), hub("Lagos", "p", 6, 0, "a2")];
  assert.deepEqual(stockTotals(rows, (r) => r.state).get("Lagos"), { left: 20, onTheWay: 1 });
  assert.deepEqual(stockTotals(rows, (r) => r.agentId, new Set(["p"])).get("a1"), { left: 9, onTheWay: 1 });
});
