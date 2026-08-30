/**
 * Proposes next period's targets from what the product actually did.
 *
 * ⚠️ SUGGEST AND CONFIRM, NEVER AUTO-APPLY. This returns numbers and the
 * evidence behind them; the Owner still presses save. Same pattern as Batch
 * Economics' "Pull from my data" - a target nobody chose is a target nobody
 * owns, and this one decides someone's pay.
 *
 * ⚠️ EVERYTHING IS NORMALISED PER DAY BEFORE IT IS SCALED. Months are 28 to 31
 * days long, so averaging monthly totals and handing the result to a different
 * month builds a silent 10% error into the target. Daily rates are averaged,
 * then multiplied by the days in the period being planned.
 *
 * ⚠️ A RATE IS NOT AVERAGED THE WAY A TOTAL IS. Delivery rate is recomputed
 * from the pooled totals (all delivered / all placed), not as the mean of each
 * month's percentage - a quiet month would otherwise carry the same weight as
 * a busy one and pull the target somewhere neither month ever was.
 */

export type MonthActual = {
  monthKey: string;
  periodStart: string;
  periodEnd: string;
  days: number;
  contribution: number;
  ordersPlaced: number;
  delivered: number;
  pieces: number;
  adSpend: number;
};

export type SuggestedTargets = {
  contributionTarget: number;
  contributionMinimum: number;
  contributionExceptional: number;
  orderTarget: number;
  deliveredTarget: number;
  piecesTarget: number;
  deliveryRateTarget: number;
  adSpendCeiling: number;
};

export type TargetSuggestion = {
  basedOn: MonthActual[];
  skipped: string[];
  daysInTargetPeriod: number;
  stretchPct: number;
  /** What the same period would look like at the historical run rate. */
  baseline: SuggestedTargets;
  /** Baseline lifted by stretchPct - the numbers offered to the Owner. */
  suggested: SuggestedTargets;
  notes: string[];
};

const daysInclusive = (start: string, end: string) =>
  end < start ? 0 : Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) + 1;

/** Round to a readable figure rather than a false-precision one. */
const roundMoney = (value: number) => {
  if (value <= 0) return 0;
  const step = value >= 1_000_000 ? 50_000 : value >= 100_000 ? 10_000 : 1_000;
  return Math.round(value / step) * step;
};

export function suggestTargets(
  months: MonthActual[],
  periodStart: string,
  periodEnd: string,
  stretchPct = 10,
  levelSpreadPct = 10
): TargetSuggestion {
  const days = daysInclusive(periodStart, periodEnd);
  const notes: string[] = [];

  // A month with no delivered orders tells us nothing about a run rate, and
  // averaging a zero into the baseline would halve the target for no reason.
  const usable = months.filter((m) => m.delivered > 0 || m.ordersPlaced > 0);
  const skipped = months.filter((m) => !usable.includes(m)).map((m) => m.monthKey);
  if (skipped.length > 0) notes.push(`Ignored ${skipped.join(", ")} — no trading activity recorded.`);

  if (usable.length === 0 || days === 0) {
    const empty: SuggestedTargets = {
      contributionTarget: 0, contributionMinimum: 0, contributionExceptional: 0,
      orderTarget: 0, deliveredTarget: 0, piecesTarget: 0,
      deliveryRateTarget: 0, adSpendCeiling: 0
    };
    notes.push("No usable history for this product yet — enter the targets by hand.");
    return { basedOn: [], skipped, daysInTargetPeriod: days, stretchPct, baseline: empty, suggested: empty, notes };
  }

  const totalDays = usable.reduce((s, m) => s + m.days, 0);
  const perDay = (pick: (m: MonthActual) => number) =>
    usable.reduce((s, m) => s + pick(m), 0) / Math.max(1, totalDays);

  // Pooled, not a mean of means - see the header note.
  const pooledPlaced = usable.reduce((s, m) => s + m.ordersPlaced, 0);
  const pooledDelivered = usable.reduce((s, m) => s + m.delivered, 0);
  const deliveryRate = pooledPlaced > 0 ? Math.round((pooledDelivered / pooledPlaced) * 1000) / 10 : 0;

  const scale = (value: number, uplift: number) => value * days * (1 + uplift / 100);

  const build = (uplift: number): SuggestedTargets => {
    const contribution = roundMoney(scale(perDay((m) => m.contribution), uplift));
    return {
      contributionTarget: contribution,
      // The bands sit either side of the target by the same spread, so the
      // ladder stays symmetrical whatever the Owner sets the target to.
      contributionMinimum: roundMoney(contribution * (1 - levelSpreadPct / 100)),
      contributionExceptional: roundMoney(contribution * (1 + levelSpreadPct / 100)),
      orderTarget: Math.round(scale(perDay((m) => m.ordersPlaced), uplift)),
      deliveredTarget: Math.round(scale(perDay((m) => m.delivered), uplift)),
      piecesTarget: Math.round(scale(perDay((m) => m.pieces), uplift)),
      // Held at the historical rate: orders and deliveries are both lifted by
      // the same uplift, so the RATIO between them does not move. Stretching
      // the rate as well would be a second, hidden stretch on top.
      deliveryRateTarget: deliveryRate,
      // Scales with volume: more orders genuinely need more advertising, and a
      // ceiling frozen while volume grows is one nobody can work inside.
      adSpendCeiling: roundMoney(scale(perDay((m) => m.adSpend), uplift))
    };
  };

  const baseline = build(0);
  const suggested = build(stretchPct);

  notes.push(
    `Averaged ${usable.length} month${usable.length === 1 ? "" : "s"} (${totalDays} trading days) as a daily rate, `
    + `then scaled to the ${days} days in this period.`
  );
  notes.push(`Stretch of ${stretchPct}% applied to every volume lever; delivery rate held at the historical ${deliveryRate}%.`);
  if (usable.length === 1) {
    notes.push("Only one month of history — treat this as a starting point rather than a trend.");
  }

  return { basedOn: usable, skipped, daysInTargetPeriod: days, stretchPct, baseline, suggested, notes };
}
