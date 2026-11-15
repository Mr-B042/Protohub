import assert from "node:assert/strict";
import test from "node:test";
import { funnelOf, whereItBreaks, type DiagnoseRow } from "./ad-funnel.js";

test("funnel numbers, and blanks when a field covers too little of the spend", () => {
  const f = funnelOf([{ spend: 10000, impressions: 5000, linkClicks: 100, landingPageViews: 80 }], 4);
  assert.equal(f.cpm, 2000);
  assert.equal(f.ctr, 2);
  assert.equal(f.cpc, 100);
  assert.equal(f.loadRate, 80);
  assert.equal(f.convRate, 5);
  // Page views read only for half the spend (older days): not shown.
  const partial = funnelOf([{ spend: 5000, impressions: 2500, linkClicks: 50, landingPageViews: 40 }, { spend: 5000, impressions: 2500, linkClicks: 50, landingPageViews: null }], 4);
  assert.equal(partial.landingPageViews, null);
  assert.equal(partial.convRate, null);
  assert.equal(partial.ctr, 2);
});

test("where it breaks: top of the funnel first, judged against the period's average", () => {
  const avg: DiagnoseRow = { ...funnelOf([{ spend: 100000, impressions: 50000, linkClicks: 1000, landingPageViews: 800 }], 40), orders: 40, confirmed: 32, confirmRate: 80, deliveryRate: 75 };
  const row = (over: Partial<DiagnoseRow>): DiagnoseRow => ({ ...avg, ...over });
  assert.match(whereItBreaks(row({ ctr: 1, cpm: 3000 }), avg)!, /Weak ad or costly audience/);
  assert.match(whereItBreaks(row({ ctr: 1 }), avg)!, /isn't catching interest/);
  assert.match(whereItBreaks(row({ loadRate: 40 }), avg)!, /few page loads/);
  assert.match(whereItBreaks(row({ orders: 0 }), avg)!, /nobody orders/);
  assert.match(whereItBreaks(row({ convRate: 2 }), avg)!, /few order/);
  assert.match(whereItBreaks(row({ confirmRate: 55 }), avg)!, /few confirmed/);
  assert.match(whereItBreaks(row({ deliveryRate: 50 }), avg)!, /not delivered/);
  assert.equal(whereItBreaks(avg, avg), null);
  // Too little data: say nothing.
  assert.equal(whereItBreaks(row({ impressions: 500, linkClicks: 10, ctr: 0.2 }), avg), null);
  // Expensive clicks alone never flag a row that converts well.
  assert.equal(whereItBreaks(row({ cpc: 400 }), avg), null);
});
