import assert from "node:assert/strict";
import test from "node:test";
import { judgeRepMonth, mostCommon, prevMonth, repMonthFigures, repProducts, type RepMonthStat, type RepOrder, type RepVerdict } from "./rep-monthly.js";

const orders = (repId: string, placed: number, delivered: number, extra: Partial<RepOrder> = {}): RepOrder[] =>
  Array.from({ length: placed }, (_, index) => ({
    repId, month: "2026-10", productId: "p1", productName: "Shelf", status: index < delivered ? "Delivered" : "Failed",
    amount: 40_000, productCost: 14_000, deliveryFee: 5_000, bonus: 500, upsold: false, upsellValue: 0, upsellLabel: null, crossSells: [], ...extra
  }));

const stat = (repId: string, placed: number, delivered: number, salary: number, extra: Partial<RepOrder> = {}, discipline = { lateSends: 0, missedFollowUps: 0, fines: 0 }) =>
  repMonthFigures({ month: "2026-10", orders: orders(repId, placed, delivered, extra), salary, discipline });

test("money after their pay = revenue − product cost − delivery − bonus − salary", () => {
  const s = stat("a", 10, 7, 80_000, { upsold: true, upsellValue: 9_000, crossSells: [{ name: "Brush", amount: 3_000 }] });
  assert.equal(s.revenue, 280_000);
  assert.equal(s.bonus, 3_500);
  assert.equal(s.pay, 83_500);
  assert.equal(s.money, 280_000 - 98_000 - 35_000 - 3_500 - 80_000);
  assert.equal(s.aov, 40_000);
  assert.equal(s.upsellValue, 63_000);
  assert.equal(s.crossSellValue, 21_000);
  assert.equal(s.extraRate, 200);
  // A month with no orders carries no salary.
  assert.equal(repMonthFigures({ month: "2026-10", orders: [], salary: 80_000 }).pay, 0);
});

test("verdicts: Star, Solid, Coach, Watch, Review, Too new", () => {
  const xs = { crossSells: [{ name: "Brush", amount: 3_000 }] };
  const all = new Map<string, RepMonthStat>([
    ["star", stat("star", 100, 70, 80_000, xs)],      // 70%, most money
    ["solid", stat("solid", 100, 62, 80_000, xs)],    // 62%
    ["coach", stat("coach", 100, 57, 80_000, xs)],    // 57%
    ["low", stat("low", 100, 60, 80_000, xs)],        // 60%: Solid
    ["watch", stat("watch", 100, 50, 80_000, xs)],    // 50%
    ["new", stat("new", 5, 5, 80_000, xs)],
    ["late", stat("late", 100, 70, 80_000, xs, { lateSends: 12, missedFollowUps: 0, fines: 0 })]
  ]);
  judgeRepMonth(all, new Map());
  assert.equal(all.get("star")!.verdict, "star");
  assert.equal(all.get("solid")!.verdict, "solid");
  assert.match(all.get("solid")!.reason!, /3 pts from Star/);
  assert.equal(all.get("coach")!.verdict, "coach");
  assert.equal(all.get("watch")!.verdict, "watch");
  assert.equal(all.get("new")!.verdict, "new");
  assert.equal(all.get("late")!.verdict, "review");
  assert.equal(all.get("late")!.reason, "12 late order sends this month");
  assert.equal(all.get("low")!.verdict, "solid");
  // Six judged reps (Too new is not ranked): the bottom quarter is one rep, the least money.
  assert.equal(all.get("watch")!.rank, 6);
  assert.equal(all.get("new")!.rank, null);
  assert.equal(all.get("star")!.rank, 1);
});

test("Watch two months running turns to Review; weak upsell + cross-sell is Coach", () => {
  const all = new Map<string, RepMonthStat>([
    ["a", stat("a", 100, 70, 80_000, { crossSells: [{ name: "Brush", amount: 1 }] })],
    ["b", stat("b", 100, 70, 80_000)],
    ["c", stat("c", 100, 50, 80_000, { crossSells: [{ name: "Brush", amount: 1 }] })]
  ]);
  judgeRepMonth(all, new Map<string, RepVerdict | null>([["c", "watch"]]));
  assert.equal(all.get("c")!.verdict, "review");
  assert.equal(all.get("c")!.reason, "Watch in Sep and Oct");
  // b: no upsell or cross-sell while the team has 66.7%.
  assert.equal(all.get("b")!.verdict, "coach");
  assert.equal(prevMonth("2026-01"), "2025-12");
});

test("product split and most common", () => {
  const rows = [...orders("a", 4, 3), ...orders("a", 2, 0, { productId: "p2", productName: "Rack" })];
  const products = repProducts(rows);
  assert.equal(products[0].name, "Shelf");
  assert.equal(products[0].rate, 75);
  assert.equal(products[0].moneyBeforeSalary, 3 * (40_000 - 14_000 - 5_000 - 500));
  assert.equal(products[1].rate, 0);
  assert.deepEqual(mostCommon(["x", "y", "x", null]), { name: "x", count: 2 });
  assert.equal(mostCommon([]), null);
});
