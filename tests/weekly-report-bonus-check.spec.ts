import { expect, test } from "@playwright/test";
import {
  buildRepWeeklySnapshot, reportDueDate, runBonusCheck, type WeeklyReportOrderInput
} from "../src/pages/weekly-report-model";

const WEEK = "2026-09-20";
const WEEK_END = "2026-09-26";

const order = (overrides: Partial<WeeklyReportOrderInput>): WeeklyReportOrderInput => ({
  id: "4400",
  createdKey: "2026-09-21",
  deliveredKey: "2026-09-22",
  status: "Delivered",
  productKey: "id:rack",
  productName: "Rack / Shelf",
  packageName: "1 Piece",
  customer: "Ada",
  amount: 34500,
  hasUpsell: false,
  hasCrossSell: false,
  bonusManuallyAdjusted: false,
  ...overrides
});

const snapshot = (orders: WeeklyReportOrderInput[], perOrder: Record<string, { base: number; upsell: number; crossSell: number }>, extra: Partial<Parameters<typeof buildRepWeeklySnapshot>[0]> = {}) => {
  const sum = (key: "base" | "upsell" | "crossSell") => Object.values(perOrder).reduce((total, part) => total + part[key], 0);
  return buildRepWeeklySnapshot({
    repId: "rep-1", repName: "Chelsea", weekStart: WEEK, weekEnd: WEEK_END, orders,
    bonus: { base: sum("base"), upsell: sum("upsell"), crossSell: sum("crossSell"), total: 0, perOrder },
    fines: [], previous: null, now: new Date("2026-09-29T09:00:00Z"), ...extra
  });
};

test("a fully paid week is accurate", () => {
  const live = snapshot([order({ id: "1" }), order({ id: "2", hasUpsell: true })], {
    "1": { base: 200, upsell: 0, crossSell: 0 },
    "2": { base: 200, upsell: 800, crossSell: 0 }
  });
  const result = runBonusCheck({ weekStart: WEEK, weekEnd: WEEK_END, live, frozen: live, named: [] });
  expect(result.verdict).toBe("accurate");
  expect(result.findings.every((finding) => finding.level !== "issue")).toBe(true);
});

test("a delivered order with no bonus, and an unpaid upsell, go to the manager", () => {
  const live = snapshot([order({ id: "1" }), order({ id: "2", hasUpsell: true })], {
    "2": { base: 200, upsell: 0, crossSell: 0 }
  });
  const result = runBonusCheck({ weekStart: WEEK, weekEnd: WEEK_END, live, frozen: null, named: [] });
  expect(result.verdict).toBe("issues");
  expect(result.findings.filter((finding) => finding.level === "issue").map((finding) => finding.orderId)).toEqual(["1", "2"]);
});

test("an order delivered in another week is explained, not raised", () => {
  const live = snapshot([order({ id: "1" })], { "1": { base: 200, upsell: 0, crossSell: 0 } });
  const result = runBonusCheck({
    weekStart: WEEK, weekEnd: WEEK_END, live, frozen: null,
    named: [{ ref: "9", found: true, mine: true, status: "Delivered", createdKey: "2026-09-25", deliveredKey: "2026-09-28" }]
  });
  expect(result.verdict).toBe("accurate");
  expect(result.findings.some((finding) => finding.orderId === "9" && finding.level === "info")).toBe(true);
});

test("an order that is not the rep's goes to the manager", () => {
  const live = snapshot([], {});
  const result = runBonusCheck({
    weekStart: WEEK, weekEnd: WEEK_END, live, frozen: null,
    named: [{ ref: "77", found: false, mine: false, status: "", createdKey: null, deliveredKey: null }]
  });
  expect(result.verdict).toBe("issues");
});

test("a correction is added to the bonus, a fine taken off", () => {
  const live = snapshot([order({ id: "1" })], { "1": { base: 200, upsell: 0, crossSell: 0 } }, {
    adjustments: [{ id: "q1", label: "Bonus correction", amount: 500, date: "" }],
    fines: [{ id: "f1", label: "Late", amount: 100, date: "2026-09-23" }]
  });
  expect(live.totals.adjustments).toBe(500);
  expect(live.totals.finalBonus).toBe(600);
});

test("a week's report is due on the Tuesday after it", () => {
  expect(reportDueDate("2026-09-20")).toBe("2026-09-29");
});

test("approved missed-log charges are deducted; pending ones are shown, not deducted", () => {
  const live = snapshot([order({ id: "1" })], { "1": { base: 5000, upsell: 0, crossSell: 0 } }, {
    logMisses: [
      { kind: "follow_up", ref: "a", missDate: "2026-09-23", amount: 50, status: "approved", label: "", orderId: "4307" },
      { kind: "follow_up", ref: "b", missDate: "2026-09-23", amount: 50, status: "approved", label: "", orderId: "4308" },
      { kind: "cart_log", ref: "r|2026-09-24", missDate: "2026-09-24", amount: 1500, status: "pending", label: "", cartsMissed: 3 },
      { kind: "cart_log", ref: "r|2026-09-25", missDate: "2026-09-25", amount: 500, status: "waived", label: "", cartsMissed: 1 }
    ]
  });
  expect(live.totals.logMissFines).toBe(100);
  expect(live.totals.pendingLogMisses).toBe(1500);
  expect(live.totals.finalBonus).toBe(4900);
  expect(live.fines.some((fine) => fine.label.includes("2 orders"))).toBe(true);
});

test("fines bigger than the bonus carry into next week, and last week's leftover comes off first", () => {
  const big = snapshot([order({ id: "1" })], { "1": { base: 200, upsell: 0, crossSell: 0 } }, {
    logMisses: [{ kind: "cart_log", ref: "r|2026-09-24", missDate: "2026-09-24", amount: 1500, status: "approved", label: "", cartsMissed: 3 }]
  });
  expect(big.totals.finalBonus).toBe(0);
  expect(big.totals.unpaidFines).toBe(1300);
  const next = snapshot([order({ id: "1" })], { "1": { base: 5000, upsell: 0, crossSell: 0 } }, { carriedFines: 1300 });
  expect(next.totals.finalBonus).toBe(3700);
  expect(next.totals.unpaidFines).toBe(0);
});

test("a carried-over delivery is paid this week but does not lift this week's delivery rate", () => {
  const live = snapshot([
    order({ id: "1" }),
    order({ id: "2", status: "New", deliveredKey: null }),
    // Placed the week before, delivered this week: carried over.
    order({ id: "3", createdKey: "2026-09-18", deliveredKey: "2026-09-21" })
  ], {
    "1": { base: 200, upsell: 0, crossSell: 0 },
    "3": { base: 200, upsell: 0, crossSell: 0 }
  });
  expect(live.totals.orders).toBe(2);
  expect(live.totals.delivered).toBe(1);
  expect(live.totals.deliveryRate).toBe(50);
  expect(live.totals.deliveredForBonus).toBe(2);
  expect(live.totals.carryOverOrders).toBe(1);
  expect(live.products[0]).toMatchObject({ orders: 2, delivered: 1, deliveryRate: 50 });
  expect(live.daily.find((day) => day.date === "2026-09-21")).toMatchObject({ orders: 2, delivered: 1, deliveryRate: 50 });
});

test("each delivered order carries its base / upsell / cross-sell split and its workings, and they add up", () => {
  const lines = [{ label: "Delivered base bonus", amount: 200, note: "Website order, 1 pcs. Matched 1 pcs rule worth ₦200.", tone: "earned" as const }];
  const live = snapshot([
    order({ id: "1", bonusLines: lines }),
    order({ id: "2", hasCrossSell: true, bonusLines: [...lines, { label: "Cross-sell bonus", amount: 2500, note: "1 rep-added line.", tone: "earned" as const }] }),
    order({ id: "3", status: "Confirmed", deliveredKey: null, bonusLines: lines })
  ], { "1": { base: 200, upsell: 0, crossSell: 0 }, "2": { base: 200, upsell: 0, crossSell: 2500 } });
  const byId = Object.fromEntries(live.orders.map((row) => [row.id, row]));
  expect(byId["2"].baseBonus).toBe(200);
  expect(byId["2"].crossSellBonus).toBe(2500);
  expect(byId["2"].bonusLines?.map((line) => line.label)).toEqual(["Delivered base bonus", "Cross-sell bonus"]);
  // Not delivered this week: no bonus, no workings.
  expect(byId["3"].bonus).toBe(0);
  expect(byId["3"].bonusLines).toBeUndefined();
  const delivered = live.orders.filter((row) => row.bonus > 0);
  expect(delivered.reduce((sum, row) => sum + (row.baseBonus ?? 0), 0)).toBe(live.totals.baseBonus);
  expect(delivered.reduce((sum, row) => sum + (row.crossSellBonus ?? 0), 0)).toBe(live.totals.crossSellBonus);
});
