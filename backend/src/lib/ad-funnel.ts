/**
 * Ad funnel (Bright, 15 Nov 2026, release 3 of his ad framework):
 * impressions → link clicks → page loads → orders → confirmed → delivered,
 * and ONE plain line saying where a row loses people. Never decides on CPC:
 * it only says which stage to look at.
 *
 * "Weak" is judged against the period's OWN average (all rows together), not
 * outside benchmarks: a stage is weak below 70% of the average (above 130%
 * for cost per 1,000 views), confirm/delivery 15 points under it.
 */

export type FunnelPiece = { spend: number; impressions?: number | null; linkClicks?: number | null; landingPageViews?: number | null };

export type Funnel = {
  impressions: number | null; linkClicks: number | null; landingPageViews: number | null;
  cpm: number | null; ctr: number | null; cpc: number | null; loadRate: number | null; convRate: number | null;
};

/** Share of spend a number must cover to be shown (days read before a field existed are blank). */
const COVERAGE = 0.95;

export function funnelOf(pieces: FunnelPiece[], orders: number): Funnel {
  const spend = pieces.reduce((s, p) => s + p.spend, 0);
  const total = (key: "impressions" | "linkClicks" | "landingPageViews") => {
    let value = 0, covered = 0;
    for (const p of pieces) { const v = p[key]; if (v !== null && v !== undefined) { value += v; covered += p.spend; } }
    return spend > 0 && covered / spend >= COVERAGE ? value : spend > 0 ? null : (covered ? value : null);
  };
  const impressions = total("impressions"), linkClicks = total("linkClicks"), landingPageViews = total("landingPageViews");
  return {
    impressions, linkClicks, landingPageViews,
    cpm: impressions ? (spend / impressions) * 1000 : null,
    ctr: impressions && linkClicks !== null ? (linkClicks / impressions) * 100 : null,
    cpc: linkClicks ? spend / linkClicks : null,
    loadRate: linkClicks && landingPageViews !== null ? Math.min(100, (landingPageViews / linkClicks) * 100) : null,
    convRate: landingPageViews ? (orders / landingPageViews) * 100 : null
  };
}

export type DiagnoseRow = Funnel & { orders: number; confirmRate: number | null; deliveryRate: number | null; confirmed: number };

/** The first stage (top of the funnel down) clearly behind the period's average; null = nothing stands out. */
export function whereItBreaks(row: DiagnoseRow, avg: DiagnoseRow): string | null {
  const enough = (row.impressions ?? 0) >= 1000 || (row.linkClicks ?? 0) >= 30;
  if (!enough) return null;
  const low = (v: number | null, a: number | null) => v !== null && a !== null && a > 0 && v < a * 0.7;
  const high = (v: number | null, a: number | null) => v !== null && a !== null && a > 0 && v > a * 1.3;
  const pct = (v: number | null) => (v === null ? "—" : `${v.toFixed(v < 10 ? 1 : 0)}%`);
  const naira = (v: number | null) => (v === null ? "—" : `₦${Math.round(v).toLocaleString("en-NG")}`);
  if (low(row.ctr, avg.ctr) && high(row.cpm, avg.cpm)) return `Weak ad or costly audience: ${pct(row.ctr)} click (average ${pct(avg.ctr)}) and ${naira(row.cpm)} per 1,000 views (average ${naira(avg.cpm)}). Try a new picture/video or a wider audience.`;
  if (low(row.ctr, avg.ctr)) return `The ad isn't catching interest: ${pct(row.ctr)} click (average ${pct(avg.ctr)}). Change the picture/video or the first line.`;
  if (high(row.cpm, avg.cpm)) return `Costly audience: ${naira(row.cpm)} per 1,000 views (average ${naira(avg.cpm)}), though people do click. Try a wider audience.`;
  if ((row.linkClicks ?? 0) >= 30 && low(row.loadRate, avg.loadRate)) return `Many clicks, few page loads: only ${pct(row.loadRate)} of clicks loaded the page (average ${pct(avg.loadRate)}). The order page may be slow or broken.`;
  if ((row.linkClicks ?? 0) >= 50 && row.orders === 0) return "People click and the page loads, but nobody orders: check the offer, price and order form.";
  if ((row.landingPageViews ?? 0) >= 50 && low(row.convRate, avg.convRate)) return `The page loads but few order: ${pct(row.convRate)} of visitors ordered (average ${pct(avg.convRate)}). Check the offer, price and order form.`;
  if (row.orders >= 5 && row.confirmRate !== null && avg.confirmRate !== null && row.confirmRate < avg.confirmRate - 15) return `Many orders, few confirmed: ${pct(row.confirmRate)} (average ${pct(avg.confirmRate)}). Poor lead quality, or the ad promises something different.`;
  if (row.confirmed >= 5 && row.deliveryRate !== null && avg.deliveryRate !== null && row.deliveryRate < avg.deliveryRate - 15) return `Confirmed but not delivered: ${pct(row.deliveryRate)} delivered (average ${pct(avg.deliveryRate)}). A delivery or customer-availability problem.`;
  return null;
}
