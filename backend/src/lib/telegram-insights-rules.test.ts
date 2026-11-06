import assert from "node:assert/strict";
import test from "node:test";
import {
  bestAt, changeText, compareDraft, finesLeaderDraft, finesRepDraft, fineTotals, productsDraft, rangeLabel, rankReps, repsDraft,
  shortNaira, trendDraft, upsellsDraft, wantsLastWeek, weekDraft, weekPeriods,
  type CompareSide, type FineItem, type RepRow, type TrendRow, type UpsellRow
} from "./telegram-insights-rules.js";
import { COMMANDS, cleanCommandSettings, commandAllowed, commandsFor, type BusinessReport } from "./telegram-rules.js";

const report = (overrides: Partial<BusinessReport> = {}): BusinessReport => ({
  label: "x", ordersIn: 200, topProducts: [{ name: "Edge Brusher", orders: 90 }], delivered: 120, deliveredRevenue: 3_450_000,
  failed: 12, cancelled: 8, stillNew: 5, lateSendOuts: 3, adSpend: 420_000, ...overrides
});

test("weeks run Sunday to Saturday; 'same days last week' stops on the same weekday", () => {
  const p = weekPeriods("2026-11-06"); // a Friday
  assert.deepEqual([p.thisWeek.from, p.thisWeek.to], ["2026-11-01", "2026-11-06"]);
  assert.deepEqual([p.lastWeek.from, p.lastWeek.to], ["2026-10-25", "2026-10-31"]);
  assert.deepEqual([p.sameDaysLastWeek.from, p.sameDaysLastWeek.to], ["2026-10-25", "2026-10-30"]);
  assert.deepEqual([p.weekBefore.from, p.weekBefore.to], ["2026-10-18", "2026-10-24"]);
  // On a Sunday this week is just today.
  const sunday = weekPeriods("2026-11-08");
  assert.deepEqual([sunday.thisWeek.from, sunday.thisWeek.to, sunday.sameDaysLastWeek.to], ["2026-11-08", "2026-11-08", "2026-11-01"]);
});

test("date ranges read naturally", () => {
  assert.equal(rangeLabel("2026-11-01", "2026-11-06"), "Sun 1 – Fri 6 Nov");
  assert.equal(rangeLabel("2026-11-29", "2026-12-05"), "Sun 29 Nov – Sat 5 Dec");
  assert.equal(rangeLabel("2026-11-06", "2026-11-06"), "Fri 6 Nov");
  assert.equal(wantsLastWeek("last"), true);
  assert.equal(wantsLastWeek("full"), true);
  assert.equal(wantsLastWeek(""), false);
});

test("the change column: points for rates, how many for small counts, percent otherwise", () => {
  assert.equal(changeText(3, 7, "count"), "-4");
  assert.equal(changeText(120, 100, "count"), "+20%");
  assert.equal(changeText(61, 66, "rate"), "-5pt");
  assert.equal(changeText(5, 5, "count"), "same");
  assert.equal(changeText(500, 0, "money"), "new");
  assert.equal(changeText(null, 4, "count"), "");
  assert.equal(shortNaira(3_450_000), "₦3.45m");
  assert.equal(shortNaira(420_000), "₦420k");
  assert.equal(shortNaira(9_500), "₦9,500");
});

test("/compare: a side-by-side table that fits a phone; ad spend only for the Owner and Admins", () => {
  const side = (overrides: Partial<CompareSide> = {}): CompareSide => ({ ...report(), finesAmount: 3_500, ...overrides });
  const input = { heading: "This week vs last week", nowLabel: "Sun 1 – Fri 6 Nov", beforeLabel: "Sun 25 – Fri 30 Oct (same days)", nowColumn: "This wk", beforeColumn: "Last wk",
    now: side(), before: side({ ordersIn: 160, delivered: 110, deliveredRevenue: 3_000_000, adSpend: 380_000, finesAmount: 6_000 }) };
  const owner = compareDraft(input, "Owner").text;
  const manager = compareDraft(input, "Manager").text;
  const table = owner.split("<pre>")[1].split("</pre>")[0].split("\n");
  for (const line of table) assert.ok([...line].length <= 32, `too wide for a phone: "${line}"`);
  assert.match(owner, /Orders\s+200\s+160\s+\+25%/);
  assert.match(owner, /Ad spend/);
  assert.match(manager, /Revenue/);
  assert.doesNotMatch(manager, /Ad spend|Per order/);
  assert.match(owner, /Orders up 25%/);
});

test("/week: revenue for leadership, ad spend only for the Owner and Admins", () => {
  const input = { heading: "This week so far", period: weekPeriods("2026-11-06").thisWeek, report: report(), fines: fineTotals([]), topRep: { name: "Chelsea", orders: 60, delivered: 38 }, live: true };
  const manager = weekDraft(input, "Manager").text;
  assert.match(manager, /₦3,450,000/);
  assert.match(manager, /Delivery rate: <b>60%<\/b>/);
  assert.match(manager, /Still New right now: 5/);
  assert.doesNotMatch(manager, /Ad spend/);
  assert.match(weekDraft(input, "Admin").text, /Ad spend: ₦420,000 · ₦2,100 per order/);
  assert.doesNotMatch(weekDraft({ ...input, live: false }, "Owner").text, /Still New/);
});

test("/reps: most delivered first; a rep with few orders is listed, not ranked; best rate needs 10 orders", () => {
  const rows: RepRow[] = [
    { repId: "a", name: "Chelsea", orders: 60, delivered: 38, lateSends: 1, finesAmount: 500 },
    { repId: "b", name: "Esther", orders: 50, delivered: 33, lateSends: 0, finesAmount: 0 },
    { repId: "c", name: "Delight", orders: 3, delivered: 3, lateSends: 0, finesAmount: 0 }
  ];
  const { ranked, unranked, bestRate } = rankReps(rows);
  assert.deepEqual(ranked.map((row) => row.name), ["Chelsea", "Esther"]);
  assert.deepEqual(unranked.map((row) => row.name), ["Delight"]);
  assert.equal(bestRate?.name, "Esther"); // 66% beats 63%; Delight's 100% of 3 does not count
  const text = repsDraft({ heading: "Sales reps · this week so far", period: weekPeriods("2026-11-06").thisWeek, rows }).text;
  assert.match(text, /🥇 Chelsea – 38 of 60 delivered \(63%\) · 1 late send · ₦500 fines/);
  assert.match(text, /Delight – 3 of 3 delivered \(100%\) · too few orders to rank/);
});

test("/upsells: best among sales reps with 5+ delivered, as on the Upsell Performance page", () => {
  const rows: UpsellRow[] = [
    { repId: "a", name: "Chelsea", salesRep: true, delivered: 38, upsell: 7, cross: 2, either: 9 },
    { repId: "b", name: "Esther", salesRep: true, delivered: 30, upsell: 5, cross: 4, either: 8 },
    { repId: "c", name: "Delight", salesRep: true, delivered: 2, upsell: 2, cross: 2, either: 2 },
    { repId: "__other__", name: "Other staff", salesRep: false, delivered: 10, upsell: 5, cross: 5, either: 6 }
  ];
  assert.equal(bestAt(rows, "upsell")?.row.name, "Chelsea"); // 18.4% vs 16.7%; Delight (2 delivered) and other staff are not ranked
  assert.equal(bestAt(rows, "cross")?.row.name, "Esther");
  const text = upsellsDraft({ heading: "Upsells & cross-sells · this week so far", period: weekPeriods("2026-11-06").thisWeek, rows }).text;
  assert.match(text, /Delivered orders: <b>80<\/b>/);
  assert.match(text, /Upsold: <b>19<\/b> \(23\.8%\)/);
  assert.match(text, /• Other staff: 5 · 5 of 10/);
});

test("/fines: a fine under appeal is shown apart and not added to the total", () => {
  const fines: FineItem[] = [
    { repId: "a", repName: "Chelsea", amount: 500, label: "Late order send - Order #5932 not sent out within 15 minutes", date: "2026-11-03", held: false },
    { repId: "a", repName: "Chelsea", amount: 1_000, label: "Typed fine - rude to customer", date: "2026-11-04", held: true },
    { repId: "b", repName: "Esther", amount: 2_000, label: "No delivery fee - Order #5900", date: "2026-11-05", held: false }
  ];
  const period = weekPeriods("2026-11-06").thisWeek;
  assert.deepEqual(fineTotals(fines), { count: 2, amount: 2_500, heldCount: 1, heldAmount: 1_000 });
  const leader = finesLeaderDraft({ heading: "Fines · this week so far", period, fines, logs: { approved: 1_200, pending: 400 }, previous: { label: "Last week", fines: [] } }).text;
  assert.match(leader, /Fines: <b>2<\/b> · <b>₦2,500<\/b>/);
  assert.match(leader, /• Esther: 1 · ₦2,000\n• Chelsea: 1 · ₦500/);
  assert.match(leader, /Under appeal \(not taken off yet\): 1 · ₦1,000/);
  assert.match(leader, /Missed logs: ₦1,200 approved · ₦400 waiting for approval/);
  const mine = finesRepDraft({ heading: "Your fines · this week so far", period, fines: fines.filter((fine) => fine.repId === "a"), logs: null, previous: null }).text;
  assert.match(mine, /Total: <b>₦500<\/b>/);
  assert.match(mine, /not taken off while your appeal is open/);
  assert.doesNotMatch(mine, /Esther/);
});

test("/products: ranked by money from delivered orders", () => {
  const text = productsDraft({ heading: "Best products · this week so far", period: weekPeriods("2026-11-06").thisWeek, beforeLabel: "the same days last week", rows: [
    { name: "Shelf", orders: 70, delivered: 30, revenue: 900_000, ordersBefore: 60 },
    { name: "Edge Brusher", orders: 60, delivered: 40, revenue: 1_200_000, ordersBefore: 66 }
  ] }, "Manager").text;
  assert.ok(text.indexOf("Edge Brusher") < text.indexOf("Shelf"));
  assert.match(text, /70 orders \(\+17% vs the same days last week\) · 30 delivered \(43%\)/);
});

test("/trend: the verdict and profit (they include ad spend) only for the Owner and Admins", () => {
  const rows: TrendRow[] = [{
    name: "Edge Brusher", weeks: [40, 50, 45, 60, 64], thisWeekSoFar: 45,
    last: { orders: 64, rate: 66, profit: 210_000 }, usual: { orders: 48.75, rate: 62, profit: 170_000 }, verdict: "strong"
  }];
  const owner = trendDraft({ lastWeekLabel: "Sun 25 – Sat 31 Oct", ageDays: 6, rows }, "Owner").text;
  const manager = trendDraft({ lastWeekLabel: "Sun 25 – Sat 31 Oct", ageDays: 6, rows }, "Manager").text;
  assert.match(owner, /🟢 Strong week/);
  assert.match(owner, /Profit after ads ₦210k \(usual ₦170k\)/);
  assert.match(manager, /Orders 64 \(usual 49, \+31%\) · delivered 66% \(usual 62%, \+4 pts\)/);
  assert.doesNotMatch(manager, /Strong|Profit/);
  assert.match(manager, /Orders a week: 40 → 50 → 45 → 60 → 64 · this week so far 45/);
});

test("the new commands are strictly for the Owner, Admins and Managers; /fines is open to sales staff for their own", () => {
  const leadershipOnly = ["week", "lastweek", "compare", "reps", "upsells", "products", "trend"] as const;
  for (const key of leadershipOnly) {
    for (const role of ["Owner", "Admin", "Manager"]) assert.equal(commandAllowed(role, key), true, `${role} /${key}`);
    for (const role of ["Sales Rep", "Recovery Rep", "Sales Closer", "Inventory Manager", "Inventory Manager & Logistics Operations", "Marketer"]) {
      assert.equal(commandAllowed(role, key), false, `${role} /${key}`);
    }
  }
  assert.equal(commandAllowed("Sales Rep", "fines"), true);
  assert.equal(commandAllowed("Inventory Manager & Logistics Operations", "fines"), false);
  const enabled = cleanCommandSettings({});
  assert.deepEqual(commandsFor("Sales Rep", enabled).map((row) => row.key), ["help", "myorders", "today", "late", "fines", "stop"]);
  assert.deepEqual(commandsFor("Inventory Manager & Logistics Operations", enabled).map((row) => row.key), ["help", "stock", "stop"]);
  assert.equal(commandsFor("Owner", enabled).length, COMMANDS.length);
  // A switched-off command leaves every menu.
  assert.ok(!commandsFor("Owner", cleanCommandSettings({ trend: false })).some((row) => row.key === "trend"));
});
