import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_LEVELS, bestVoucher, earningFor, lagosDayStart, lagosMonth, levelIndexFor, levelLines, loyaltyTagText, nextLevel, normalizeLevels, pointsFor, spendText,
  voucherNote, voucherOptions, type PointsProgram, type Reward
} from "./loyalty-rules.js";

const NOW = Date.parse("2026-11-08T12:00:00+01:00");
const DAY = 86_400_000;

test("levels: from lifetime delivered spend, the design's three by default", () => {
  assert.equal(levelIndexFor(0, DEFAULT_LEVELS), 0);
  assert.equal(levelIndexFor(49_999, DEFAULT_LEVELS), 0);
  assert.equal(levelIndexFor(50_000, DEFAULT_LEVELS), 1);
  assert.equal(levelIndexFor(430_000, DEFAULT_LEVELS), 2);
  assert.equal(spendText(DEFAULT_LEVELS, 0), "Spend ₦0 – ₦49,999");
  assert.equal(spendText(DEFAULT_LEVELS, 2), "Spend ₦200,000+");
  assert.deepEqual(levelLines(DEFAULT_LEVELS[1], 1), ["Earn 2 points per ₦1,000", "₦1,000 welcome voucher"]);
  assert.deepEqual(levelLines(DEFAULT_LEVELS[0], 1), ["Earn 1 point per ₦1,000"]);
  assert.deepEqual(nextLevel(25_500, DEFAULT_LEVELS), { name: "Silver", gap: 24_500 });
  assert.equal(nextLevel(250_000, DEFAULT_LEVELS), null);
});

test("levels from the browser: sorted, first starts at 0, keys kept on rename, clear problems", () => {
  const { levels, problem } = normalizeLevels([
    { key: "gold", name: "Gold", minSpend: 200000, multiplier: 3 },
    { name: "Starter", minSpend: 500, multiplier: 1, perks: ["  Member-only offers ", ""] }
  ]);
  assert.equal(problem, null);
  assert.deepEqual(levels.map((level) => [level.key, level.minSpend]), [["starter", 0], ["gold", 200000]]);
  assert.deepEqual(levels[0].perks, ["Member-only offers"]);
  assert.match(normalizeLevels([{ name: "Only" }]).problem!, /at least 2/);
  assert.match(normalizeLevels([{ name: "A", minSpend: 0 }, { name: "B", minSpend: 0 }]).problem!, /same spend/);
  assert.match(normalizeLevels([{ name: "" }, { name: "B", minSpend: 10 }]).problem!, /needs a name/);
  assert.deepEqual(normalizeLevels([{ name: "Gold" }, { name: "Gold", minSpend: 5 }]).levels.map((level) => level.key), ["gold", "gold_2"]);
});

test("points: whole thousands, times the rate and the level", () => {
  assert.equal(pointsFor(30_500, 1, 1), 30);
  assert.equal(pointsFor(30_500, 1, 2), 60);
  assert.equal(pointsFor(30_500, 1.5, 1), 45);
  assert.equal(pointsFor(999, 1, 3), 0);
  assert.equal(pointsFor(-5_000, 1, 1), 0);
});

test("earning: running programs that cover the product, counted from the start day in Lagos", () => {
  const base: PointsProgram = { id: "p1", status: "active", rate: 1, productIds: [], startsMs: NOW, endsMs: null };
  const boost: PointsProgram = { id: "p2", status: "active", rate: 1, productIds: ["shelf"], startsMs: NOW, endsMs: NOW + 7 * DAY };
  // Delivered earlier on the start day still counts.
  assert.deepEqual(earningFor({ amount: 20_000, productId: "shelf", atMs: lagosDayStart(NOW) + 60_000 }, [base, boost], 2), { points: 80, rate: 2, programIds: ["p1", "p2"] });
  assert.deepEqual(earningFor({ amount: 20_000, productId: "hanger", atMs: NOW }, [base, boost], 1), { points: 20, rate: 1, programIds: ["p1"] });
  assert.equal(earningFor({ amount: 20_000, productId: "shelf", atMs: NOW + 8 * DAY }, [base, boost], 1).points, 20);
  assert.equal(earningFor({ amount: 20_000, productId: "shelf", atMs: NOW - DAY }, [base, boost], 1).points, 0);
  assert.equal(earningFor({ amount: 20_000, productId: null, atMs: NOW }, [{ ...base, status: "paused" }], 1).points, 0);
});

test("vouchers: rewards the balance covers, welcome only for levels reached after the start, one monthly voucher a month", () => {
  const rewards: Reward[] = [
    { id: "r500", name: "₦500 off", points: 50, value: 500, status: "active" },
    { id: "r1000", name: "₦1,000 off", points: 100, value: 1000, status: "active" },
    { id: "r2500", name: "₦2,500 off", points: 250, value: 2500, status: "paused" }
  ];
  const base = { balance: 120, rewards, pointsLive: true, levels: DEFAULT_LEVELS, levelIndex: 1, levelIndexAtStart: 0, welcomeUsed: new Set<string>(), monthlyUsed: new Set<string>(), nowMs: NOW };
  assert.deepEqual(voucherOptions(base).map((option) => `${option.kind}:${option.value}`), ["reward:500", "reward:1000", "welcome:1000"]);
  // Already Silver when the levels started: no welcome voucher (no day-one cost).
  assert.deepEqual(voucherOptions({ ...base, levelIndexAtStart: 1 }).map((option) => option.kind), ["reward", "reward"]);
  // Used already.
  assert.equal(voucherOptions({ ...base, welcomeUsed: new Set(["silver"]) }).some((option) => option.kind === "welcome"), false);
  // Points paused: rewards can't be spent; levels still give theirs.
  assert.deepEqual(voucherOptions({ ...base, pointsLive: false }).map((option) => option.kind), ["welcome"]);
  // Gold: the monthly voucher, once per Lagos month; jumping from Bronze earns Silver's welcome too.
  const gold = voucherOptions({ ...base, balance: 0, levelIndex: 2, levelIndexAtStart: 0 });
  assert.deepEqual(gold.map((option) => `${option.kind}:${option.levelKey}`), ["welcome:silver", "monthly:gold"]);
  assert.equal(gold[1].month, "2026-11");
  assert.equal(voucherOptions({ ...base, balance: 0, levelIndex: 2, monthlyUsed: new Set([lagosMonth(NOW)]) }).some((option) => option.kind === "monthly"), false);
  // A new customer (not one when the levels started) reaching Bronze gets Bronze's welcome voucher, if it has one.
  const levels = DEFAULT_LEVELS.map((level, i) => (i === 0 ? { ...level, welcomeVoucher: 300 } : level));
  assert.deepEqual(voucherOptions({ ...base, balance: 0, levels, levelIndex: 0, levelIndexAtStart: -1 }).map((option) => option.value), [300]);
  // VIP levels off: none of theirs.
  assert.deepEqual(voucherOptions({ ...base, levels: null }).map((option) => option.kind), ["reward", "reward"]);
});

test("one voucher per order: the biggest, capped at the order, a tie goes to the one that costs no points", () => {
  const options = voucherOptions({ balance: 120, rewards: [{ id: "r1000", name: "₦1,000 off", points: 100, value: 1000, status: "active" }], pointsLive: true, levels: DEFAULT_LEVELS, levelIndex: 1, levelIndexAtStart: 0, welcomeUsed: new Set(), monthlyUsed: new Set(), nowMs: NOW });
  const best = bestVoucher(options, 19_500, 0)!;
  assert.equal(best.kind, "welcome");
  assert.equal(best.discount, 1000);
  assert.equal(voucherNote(best), "₦1,000 off: Silver welcome voucher");
  assert.equal(bestVoucher(options, 600, 0)!.discount, 600);
  const rewardOnly = bestVoucher(options.filter((option) => option.kind === "reward"), 19_500, 0)!;
  assert.equal(voucherNote(rewardOnly), "₦1,000 off: reward for 100 points");
  const named = voucherOptions({ balance: 300, rewards: [{ id: "fd", name: "Free delivery", points: 200, value: 2000, status: "active" }], pointsLive: true, levels: null, levelIndex: 0, levelIndexAtStart: 0, welcomeUsed: new Set(), monthlyUsed: new Set(), nowMs: NOW });
  assert.equal(named[0].label, "reward for 200 points (Free delivery)");
  assert.equal(bestVoucher(options, 19_500, 20_000), null);
  assert.equal(bestVoucher([], 19_500, 0), null);
});

test("email tags read as plain words", () => {
  assert.deepEqual(loyaltyTagText({ balance: 1234, levelName: "Silver", voucher: null, next: { name: "Gold (VIP)", gap: 150000 } }),
    { points: "1,234", level: "Silver", voucher: "no voucher yet", nextLevel: "₦150,000 more to reach Gold (VIP)" });
  assert.equal(loyaltyTagText({ balance: -5, levelName: null, voucher: null, next: null }).points, "0");
});
