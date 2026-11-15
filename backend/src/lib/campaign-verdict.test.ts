import assert from "node:assert/strict";
import test from "node:test";
import { campaignVerdicts, type VerdictCampaign } from "./campaign-verdict.js";

const base: VerdictCampaign = { campaignId: "C", campaignName: "X", platform: "meta", accountName: "A", productName: "Rack", running: true, target: 6000, targetSource: "worked_out", spend: 0, orders: 0, delivered: 0, marginPerDelivery: 12000 };
const run = (c: Partial<VerdictCampaign>, spend: Record<string, number>, orders: Record<string, number> = {}, extra: { platform?: Record<string, number> } = {}) => {
  const last = Object.keys(orders).sort().pop();
  return campaignVerdicts({
    today: "2026-11-15", campaigns: [{ ...base, ...c }],
    lastOrderDay: new Map(last ? [["C", last]] : []), ordersByDay: new Map([["C", new Map(Object.entries(orders))]]),
    spendByDay: new Map([["C", new Map(Object.entries(spend))]]), platformByDay: new Map([["C", new Map(Object.entries(extra.platform ?? {}))]]), spendFrom: "2026-10-09"
  })[0];
};

test("one campaign gets ONE decision: worth it since start but now dry -> by break-even", () => {
  // ₦4,839 per order since start (fine) but ₦13,183 since the last order with none, break-even ₦6,000 -> 2.2× -> turn off.
  const v = run({ spend: 300000, orders: 62, delivered: 45 }, { "2026-11-11": 2000, "2026-11-12": 5000, "2026-11-13": 4000, "2026-11-14": 4156, "2026-11-15": 27 }, { "2026-11-11": 1 });
  assert.equal(v.verdict, "turn_off");
  assert.equal(Math.round(v.spendSinceLastOrder), 13183);
  assert.match(v.reason, /2\.2× its break-even/);
});

test("1.5× with no order = pause; more than 1× = watch; break-even unknown uses ₦7,500", () => {
  assert.equal(run({ spend: 90000, orders: 20 }, { "2026-11-13": 5000, "2026-11-14": 4500 }, { "2026-11-12": 1 }).verdict, "pause");
  assert.equal(run({ spend: 90000, orders: 20 }, { "2026-11-13": 3000, "2026-11-14": 3500 }, { "2026-11-12": 1 }).verdict, "watch");
  const unknown = run({ target: null, spend: 90000, orders: 20 }, { "2026-11-13": 5000, "2026-11-14": 4500 }, { "2026-11-12": 1 });
  assert.equal(unknown.verdict, "watch");
  assert.match(unknown.reason, /₦7,500 is used/);
});

test("consistently above break-even = turn off; one bad patch while fine overall = watch", () => {
  assert.equal(run({ spend: 120000, orders: 12 }, { "2026-11-12": 9000, "2026-11-13": 9000, "2026-11-14": 9000 }, { "2026-11-12": 1, "2026-11-13": 1, "2026-11-14": 1 }).verdict, "turn_off");
  assert.equal(run({ spend: 120000, orders: 30 }, { "2026-11-12": 9000, "2026-11-13": 9000, "2026-11-14": 9000 }, { "2026-11-12": 1, "2026-11-13": 1, "2026-11-14": 1 }).verdict, "watch");
});

test("scale, keep, delivery losing money, tracking", () => {
  assert.equal(run({ spend: 100000, orders: 40 }, { "2026-11-12": 4000, "2026-11-13": 4000, "2026-11-14": 4000 }, { "2026-11-12": 1, "2026-11-13": 2, "2026-11-14": 2 }).verdict, "scale");
  assert.equal(run({ spend: 100000, orders: 25 }, { "2026-11-12": 5000, "2026-11-13": 5000, "2026-11-14": 5000 }, { "2026-11-12": 1, "2026-11-13": 1, "2026-11-14": 1 }).verdict, "keep");
  const loss = run({ spend: 100000, orders: 25, delivered: 6, marginPerDelivery: 12000 }, { "2026-11-12": 5000, "2026-11-13": 5000, "2026-11-14": 5000 }, { "2026-11-12": 1, "2026-11-13": 1, "2026-11-14": 1 });
  assert.equal(loss.verdict, "pause");
  assert.match(loss.reason, /6 of 25 orders delivered/);
  assert.equal(run({ spend: 90000, orders: 20 }, { "2026-11-13": 9000, "2026-11-14": 9000 }, { "2026-11-12": 1 }, { platform: { "2026-11-14": 2 } }).verdict, "check_tracking");
  assert.equal(run({ running: false }, { "2026-11-14": 50000 }), undefined);
});
