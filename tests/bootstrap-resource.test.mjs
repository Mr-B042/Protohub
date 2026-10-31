import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile(new URL("../src/lib/bootstrap-resource.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext } });
const { settleBootstrapResource, mergeOlderRows, isCompleteOrderChunk, isCompleteWorkspaceHistory } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);

function deferred() {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

test("Orders hydrate while an unrelated resource is still pending", async () => {
  const orders = deferred();
  const payroll = deferred();
  const shown = [];
  const orderJob = settleBootstrapResource(orders.promise, (result) => shown.push(["orders", result]), () => true);
  const payrollJob = settleBootstrapResource(payroll.promise, (result) => shown.push(["payroll", result]), () => true);
  let allFinished = false;
  const all = Promise.all([orderJob, payrollJob]).then(() => { allFinished = true; });

  const rows = { data: [{ id: "recent" }], total: 1 };
  orders.resolve(rows);
  await orderJob;
  assert.equal(allFinished, false);
  assert.equal(shown.length, 1);
  assert.equal(shown[0][0], "orders");
  assert.equal(shown[0][1].value, rows);

  payroll.resolve([]);
  await all;
  assert.equal(shown[1][0], "payroll");
});

test("a failed supporting API does not reject or prevent another resource from hydrating", async () => {
  const applied = [];
  const reason = new Error("payroll unavailable");
  const results = await Promise.all([
    settleBootstrapResource(Promise.reject(reason), (result) => applied.push(result.status), () => true),
    settleBootstrapResource(Promise.resolve(["product"]), (result) => applied.push(result.status), () => true)
  ]);
  assert.deepEqual(applied.sort(), ["fulfilled", "rejected"]);
  assert.equal(results[0].status, "rejected");
  assert.equal(results[0].reason, reason);
  assert.equal(results[1].status, "fulfilled");
});

test("a response from an unmounted or superseded workspace cannot hydrate its state", async () => {
  const request = deferred();
  let current = true;
  let applied = false;
  const loading = settleBootstrapResource(request.promise, () => { applied = true; }, () => current);
  current = false;
  request.resolve({ data: [{ id: "previous-branch" }], total: 1 });
  await loading;
  assert.equal(applied, false);
});

test("malformed data hydration follows the controlled rejection path to release loading UI", async () => {
  let loading = true;
  const result = await settleBootstrapResource(Promise.resolve("bad response"), (settled) => {
    if (settled.status === "fulfilled") throw new Error("invalid order payload");
    loading = false;
  }, () => true);
  assert.equal(result.status, "rejected");
  assert.match(result.reason.message, /invalid order payload/);
  assert.equal(loading, false);
});

test("older history adds all missing rows and preserves newer live versions", () => {
  const live = { id: "same", status: "Delivered" };
  const recent = [{ id: "new", status: "New" }, live];
  const older = [{ id: "same", status: "Processing" }, { id: "old", status: "Failed" }, { id: "old", status: "New" }];
  const merged = mergeOlderRows(recent, older);
  assert.deepEqual(merged.map((row) => row.id), ["new", "same", "old"]);
  assert.equal(merged[1], live);
  assert.equal(mergeOlderRows(merged, older), merged, "an unchanged older snapshot should not trigger a full-app render");
});

test("only uncapped successful order chunks qualify as a complete financial history", () => {
  const fulfilled = (value) => ({ status: "fulfilled", value });
  assert.equal(isCompleteOrderChunk(fulfilled({ data: [], total: 0 })), true);
  assert.equal(isCompleteOrderChunk(fulfilled({ data: [{ id: "1" }], total: 1 })), true);
  assert.equal(isCompleteOrderChunk(fulfilled({ data: [{ id: "1" }], total: 2 })), false);
  assert.equal(isCompleteOrderChunk(fulfilled({ data: [], total: "unknown" })), false);
  assert.equal(isCompleteOrderChunk(fulfilled("<!doctype html>")), false);
  assert.equal(isCompleteOrderChunk({ status: "rejected", reason: new Error("offline") }), false);
});

test("persisted calculations stay gated while stock inputs load, without holding visible Orders", async () => {
  const stock = deferred();
  const orders = { status: "fulfilled", value: { data: [{ id: "1" }], total: 1 } };
  const carts = { status: "fulfilled", value: [] };
  let visible = false;
  let writesReady = false;
  const visibleOrders = settleBootstrapResource(Promise.resolve(orders.value), () => { visible = true; }, () => true);
  const stockInput = settleBootstrapResource(stock.promise, () => {}, () => true);
  const calculations = Promise.all([visibleOrders, stockInput]).then(([orderResult, stockResult]) => {
    writesReady = isCompleteWorkspaceHistory([orderResult, orders], [carts, carts], [stockResult]);
  });
  await visibleOrders;
  assert.equal(visible, true);
  assert.equal(writesReady, false);
  stock.resolve([]);
  await calculations;
  assert.equal(writesReady, true);
  assert.equal(isCompleteWorkspaceHistory([orders, orders], [carts, carts], [{ status: "rejected", reason: "stock failed" }]), false);
  assert.equal(isCompleteWorkspaceHistory([orders, orders], [carts, { status: "fulfilled", value: {} }], []), false);
});
