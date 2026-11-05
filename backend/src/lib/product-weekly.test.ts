import assert from "node:assert/strict";
import test from "node:test";
import { judgeProductWeek, splitChange, stockAt, topFailReasons, usualWeek, weekFigures, type WeeklyClickDay, type WeeklyOrder } from "./product-weekly.js";

const W = ["2026-09-27", "2026-10-04", "2026-10-11", "2026-10-18", "2026-10-25"];
const end = (week: string) => { const d = new Date(`${week}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 6); return d.toISOString().slice(0, 10); };

function orders(week: string, placed: number, delivered: number, extra: Partial<WeeklyOrder> = {}, failReason = "Not answering"): WeeklyOrder[] {
  return Array.from({ length: placed }, (_, i) => ({
    productId: "p", week, placedAt: Date.parse(`${week}T10:00:00+01:00`), status: i < delivered ? "Delivered" : "Failed",
    deliveredDate: i < delivered ? week : null, amount: 40_000, productCost: 14_000, deliveryFee: 5_000, state: "Lagos",
    upsold: false, failReason: i < delivered ? null : failReason, ...extra
  }));
}

const figures = (week: string, rows: WeeklyOrder[], spend: number, clicks: WeeklyClickDay[] = [], carts = 0) =>
  weekFigures({ week, weekEnd: end(week), cutoff: end(week), orders: rows, ads: spend ? [{ productId: "p", day: week, spend }] : [], clicks, carts });

test("the four parts add up to the whole change in profit after ads", () => {
  const usual = usualWeek(W.slice(0, 4).map((week) => figures(week, orders(week, 40, 26), 120_000)))!;
  const now = figures(W[4], orders(W[4], 30, 15), 150_000);
  const parts = splitChange(now, usual);
  const total = parts.orders + parts.rate + parts.margin + parts.adcost;
  assert.ok(Math.abs(total - (now.profit - usual.profit)) < 0.001);
  // Spend with no orders at all still lands in ad cost.
  const empty = figures(W[4], [], 50_000);
  const p2 = splitChange(empty, usual);
  assert.ok(Math.abs(p2.orders + p2.rate + p2.margin + p2.adcost - (empty.profit - usual.profit)) < 0.001);
});

test("like for like: a delivery after the cutoff does not count yet", () => {
  const rows = orders(W[3], 10, 10).map((row, i) => ({ ...row, deliveredDate: i < 6 ? W[3] : "2026-11-03" }));
  const f = weekFigures({ week: W[3], weekEnd: end(W[3]), cutoff: "2026-10-26", orders: rows, ads: [], clicks: [], carts: 0 });
  assert.equal(f.delivered, 6);
  assert.equal(f.rate, 60);
});

test("a weak week from delivery rate names the rate, the top reason and the fix", () => {
  const previous = W.slice(0, 4).map((week) => figures(week, orders(week, 40, 26), 120_000));
  const week = figures(W[4], orders(W[4], 40, 16), 120_000);
  const result = judgeProductWeek({ week, previous, targetCpa: null, stockOuts: [], failReasons: topFailReasons(orders(W[4], 40, 16)), ageDays: 3 });
  assert.equal(result.verdict, "weak");
  assert.equal(result.drivers[0].key, "rate");
  assert.match(result.summary, /Biggest reason: delivery rate/);
  assert.match(result.fixes[0], /Not answering.*call them faster/);
});

test("dearer clicks are named with the CPC; stock-outs become a restock fix", () => {
  const clicks = (week: string, spend: number, linkClicks: number): WeeklyClickDay[] => [{ productId: "p", day: week, spend, linkClicks, impressions: linkClicks * 50 }];
  const previous = W.slice(0, 4).map((week) => figures(week, orders(week, 40, 26), 120_000, clicks(week, 120_000, 800)));
  const week = figures(W[4], orders(W[4], 40, 26), 200_000, clicks(W[4], 200_000, 800));
  const result = judgeProductWeek({ week, previous, targetCpa: 3_500, stockOuts: [{ state: "Kano", daysOut: 3, ordersWhileOut: 4 }], failReasons: [], ageDays: 3 });
  assert.equal(result.verdict, "weak");
  assert.equal(result.drivers[0].key, "adcost");
  assert.match(result.fixes[0], /Clicks cost more than usual \(CPC ₦250 vs ₦150\)/);
  assert.ok(result.fixes.some((fix) => /Send stock to Kano: 4 order/.test(fix)));
});

test("a strong week lists what went right; too new and too small are not judged", () => {
  const previous = W.slice(0, 4).map((week) => figures(week, orders(week, 40, 24), 120_000));
  const strong = judgeProductWeek({ week: figures(W[4], orders(W[4], 60, 42), 120_000), previous, targetCpa: null, stockOuts: [], failReasons: [], ageDays: 3 });
  assert.equal(strong.verdict, "strong");
  assert.ok(strong.wins.length >= 1);
  const fresh = judgeProductWeek({ week: figures(W[4], orders(W[4], 20, 12), 50_000), previous: [figures(W[3], orders(W[3], 10, 5), 0)], targetCpa: null, stockOuts: [], failReasons: [], ageDays: 3 });
  assert.equal(fresh.verdict, "new");
  const small = judgeProductWeek({ week: figures(W[4], orders(W[4], 3, 2), 0), previous, targetCpa: null, stockOuts: [], failReasons: [], ageDays: 3 });
  assert.equal(small.verdict, "small");
});

test("stock as it stood, walked back from today through the change log", () => {
  const changes = [{ at: 100, old: 5, next: 0 }, { at: 200, old: 0, next: 12 }];
  assert.equal(stockAt(12, changes, 50), 5);
  assert.equal(stockAt(12, changes, 150), 0);
  assert.equal(stockAt(12, changes, 250), 12);
  assert.equal(stockAt(7, [], 50), 7);
});
