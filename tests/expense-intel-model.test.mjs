import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile(new URL("../src/pages/expense-intel/model.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext } });
const M = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);

const summary = { revenue: 1000, cogs: 400, recognizedLogistics: 120, recordedDeliveryExpense: 130, deliveryExpenseNotRecognized: 130, recordedOperatingExpense: 300, bonusEstimate: 40, managerBonusExpense: 10, totalBonusExpense: 50, operatingExpense: 350, grossProfit: 480, netProfit: 130 };
const exp = (id, category, amount, extra = {}) => ({ id, category, amount, date: "2026-10-05", productName: "", description: "", checkStatus: "verified", ...extra });
const rows = [exp("EXP-DEL-1", "Delivery", 130, { checkStatus: "auto" }), exp("ads-auto-meta-1", "Ad Spend", 200, { checkStatus: "auto" }), exp("e1", "Waybill", 60), exp("e2", "Other", 40)];

test("cost groups add up to business costs exactly", () => {
  const groups = M.costGroups(summary, rows);
  const total = groups.reduce((s, g) => s + g.amount, 0);
  assert.equal(total, summary.cogs + summary.recognizedLogistics + summary.operatingExpense);
  assert.equal(groups.find((g) => g.group === "Salaries & Incentives").amount, 50);
});

test("reconciliation: delivery rows are replaced by order fees, not added", () => {
  const r = M.reconcile(summary, rows, 983, 953);
  assert.equal(r.recorded, 430);
  assert.equal(r.deliveryRows, 130);
  assert.equal(r.business, 870);
  assert.equal(r.mergedAway, 30);
});

test("months and like-for-like", () => {
  assert.equal(M.addMonths("2026-01", -1), "2025-12");
  assert.equal(M.monthEnd("2026-02"), "2026-02-28");
  assert.deepEqual(M.lastMonths("2026-10", 3), ["2026-08", "2026-09", "2026-10"]);
  assert.equal(M.daysCounted("2026-11", "2026-11-16"), 16);
  assert.equal(M.daysCounted("2026-10", "2026-11-16"), 31);
  assert.equal(M.likeForLikeEnd("2026-10", "2026-11", "2026-11-16"), "2026-10-16");
});

test("recurring budgets carry forward until changed", () => {
  const all = [
    { month: "2026-09", category: "Ad Spend", amount: 100, recurring: true },
    { month: "2026-09", category: "Waybill", amount: 50, recurring: false },
    { month: "2026-10", category: "Ad Spend", amount: 80, recurring: false }
  ];
  assert.deepEqual(M.budgetsFor("2026-10", all).map((b) => [b.category, b.amount]), [["Ad Spend", 80]]);
  assert.deepEqual(M.budgetsFor("2026-11", all).map((b) => b.category), []);
  assert.equal(M.budgetsFor("2026-10", [all[0]])[0].amount, 100);
  const r = M.budgetRows("2026-10", [{ month: "2026-10", category: "Waybill", amount: 400, recurring: false }], () => 450);
  assert.equal(r[0].status, "Over Budget");
  assert.equal(M.budgetRows("2026-10", [{ month: "2026-10", category: "Waybill", amount: 400, recurring: false }], () => 370)[0].status, "At Risk");
});

test("duplicates ignore system rows", () => {
  const d = M.possibleDuplicates([exp("a", "Other", 5000), exp("b", "Other", 5000), exp("EXP-DEL-9", "Delivery", 5000, { checkStatus: "auto" }), exp("EXP-DEL-8", "Delivery", 5000, { checkStatus: "auto" })]);
  assert.equal(d.length, 1);
  assert.equal(d[0].count, 2);
});

test("alerts fire on real rises only", () => {
  const money = (v) => `₦${v}`;
  const alerts = M.smartAlerts({
    month: "2026-10", compare: "2026-09", money, budgets: [], duplicates: [], stateCostRises: [],
    now: { adSpend: 124, delivered: 108, failedCost: 150, logistics: 1000, waybill: 450, incentives: 120, netProfit: 100 },
    before: { adSpend: 100, delivered: 100, waybill: 380, incentives: 100, netProfit: 100 }
  });
  assert.deepEqual(alerts.map((a) => a.key).sort(), ["2026-10:ad-vs-delivered", "2026-10:failed-share", "2026-10:incentives-up"].sort());
});

test("forecast: straight line, needs 3 months", () => {
  assert.deepEqual(M.forecast([10, 20], 2), [null, null]);
  assert.deepEqual(M.forecast([10, 20, 30], 2), [40, 50]);
});

test("opportunities come from the branch's own best months", () => {
  const o = M.opportunities({
    month: "2026-10", money: (v) => String(Math.round(v)),
    cppByMonth: [9500, 8000, null], placedNow: 100, cppNow: 9000,
    rateByMonth: [72, 65], rateNow: 70, failedCostPerFail: 1000,
    waybillByMonth: [300, 300, 300], waybillNow: 450, slowStock: { value: 0, products: 0 }
  });
  assert.equal(o.find((x) => x.kind === "ads").savings, 100_000);
  assert.equal(o.find((x) => x.kind === "delivery").savings, 2_000);
  assert.equal(o.find((x) => x.kind === "waybill").savings, 150);
});
