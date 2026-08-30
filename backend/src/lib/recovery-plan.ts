import type { TargetDefinition, TargetProgress } from "./target-progress.js";

/**
 * Turns "you are behind" into "here is what to do about it".
 *
 * ⚠️ THIS IS THE POINT OF THE WHOLE FEATURE. A dashboard that reports "orders
 * are behind" is a report. One that says "behind by 54 - add 2 orders a day,
 * OR lift pieces per delivery from 4.2 to 4.7, OR recover 12 pending
 * deliveries" is a management system. Every action below therefore carries a
 * NUMBER, and every number is derived from the same figures on screen so a
 * manager can check it by hand.
 *
 * ⚠️ THE WEAKEST LEVER IS CHOSEN BY MEASUREMENT, NOT BY A FIXED PRECEDENCE.
 * Ranking the levers by projected attainment and taking the lowest means the
 * plan follows the data. A hard-coded order (orders, then deliveries, then
 * pieces) would keep recommending the same fix regardless of which one is
 * actually failing.
 */

export type RecoveryAction = {
  label: string;
  detail: string;
  /** Contribution this action is worth if completed, so actions can be ranked. */
  impact: number;
};

export type RecoveryPlan = {
  planCode: "A" | "B" | "C" | "D" | "E";
  problem: "none" | "orders" | "delivery_rate" | "pieces" | "contribution";
  headline: string;
  actions: RecoveryAction[];
};

const safeDiv = (a: number, b: number) => (b > 0 ? a / b : 0);
const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * ⚠️ CEIL AFTER TRIMMING FLOAT NOISE. (4.2 - 3.9) * 500 evaluates to
 * 150.00000000000014, and a bare Math.ceil turns that into 151 - telling the
 * manager to upgrade one more customer than the arithmetic actually requires,
 * every single time. The counts here are also derived from the ROUNDED figures
 * shown on screen, so a manager checking the maths by hand gets the same
 * answer the app did.
 */
const ceilExact = (n: number) => Math.ceil(Number(n.toFixed(6)));

export function buildRecoveryPlan(target: TargetDefinition, progress: TargetProgress): RecoveryPlan {
  const { forecast, requiredPace } = progress;
  const delivered = progress.delivered.actual;
  const placed = progress.ordersPlaced.actual;

  // Per-delivery economics, both where we are and where the target implies.
  const piecesPerDelivery = round1(safeDiv(progress.pieces.actual, delivered));
  const targetPiecesPerDelivery = round1(safeDiv(target.piecesTarget, target.deliveredTarget));
  const contributionPerDelivery = Math.round(safeDiv(progress.breakdown.contribution, delivered));
  const targetContributionPerDelivery = Math.round(safeDiv(target.contributionTarget, target.deliveredTarget));

  // ── Plan A: nothing is wrong ───────────────────────────
  if (forecast.status === "achieved" || forecast.status === "on_track") {
    return {
      planCode: "A",
      problem: "none",
      headline: forecast.status === "achieved"
        ? "Target achieved. Hold the current pace to bank the exceptional tier."
        : "On track. Holding the current pace finishes at or above target.",
      actions: [
        {
          label: "Hold the daily pace",
          detail: `${requiredPace.ordersPerDay} orders, ${requiredPace.deliveredPerDay} deliveries and `
            + `${requiredPace.piecesPerDay} pieces a day keeps this on target.`,
          impact: 0
        },
        {
          label: "Protect the delivery rate",
          detail: `Currently ${progress.deliveryRate.actual}% against a ${target.deliveryRateTarget}% target.`,
          impact: 0
        }
      ]
    };
  }

  // ── Which lever is actually weakest? ───────────────────
  const attainment = [
    { key: "orders" as const, pct: safeDiv(forecast.projectedOrders, target.orderTarget) * 100 },
    { key: "delivery_rate" as const, pct: safeDiv(progress.deliveryRate.actual, target.deliveryRateTarget) * 100 },
    { key: "pieces" as const, pct: safeDiv(piecesPerDelivery, targetPiecesPerDelivery) * 100 }
  ].filter((row) => row.pct > 0);

  const weakest = attainment.sort((a, b) => a.pct - b.pct)[0] ?? null;
  const contributionShortfall = Math.max(0, target.contributionTarget - forecast.projectedContribution);

  // ⚠️ PLAN E IS THE "ACTIVITY IS FINE, MONEY IS NOT" CASE. If every activity
  // lever is at or above its target and contribution is STILL behind, telling
  // someone to sell more is the wrong instruction - the problem is margin, not
  // volume. Checked before the volume plans for exactly that reason.
  const activityHealthy = attainment.every((row) => row.pct >= 99.5);
  if (!weakest || activityHealthy) {
    const actions: RecoveryAction[] = [
      {
        label: "Lift contribution per delivery",
        detail: `Each delivery is returning ${contributionPerDelivery.toLocaleString("en-NG")} against `
          + `${targetContributionPerDelivery.toLocaleString("en-NG")} implied by the target.`,
        impact: contributionShortfall
      }
    ];
    if (progress.adSpend.overCeiling) {
      const over = progress.adSpend.actual - progress.adSpend.target;
      actions.unshift({
        label: "Advertising is over its ceiling",
        detail: `${Math.round(over).toLocaleString("en-NG")} above the ceiling. Every naira cut here is a naira of contribution.`,
        impact: Math.round(over)
      });
    }
    return {
      planCode: "E",
      problem: "contribution",
      headline: `Activity is on target but contribution is projected ${Math.round(contributionShortfall).toLocaleString("en-NG")} short. `
        + "The gap is margin, not volume.",
      actions
    };
  }

  // ── Plan C: delivery rate ──────────────────────────────
  if (weakest.key === "delivery_rate") {
    // How many more of the orders ALREADY PLACED must land to hit the rate.
    const neededDelivered = Math.ceil((target.deliveryRateTarget / 100) * placed);
    const recoverable = Math.max(0, neededDelivered - delivered);
    return {
      planCode: "C",
      problem: "delivery_rate",
      headline: `Delivery rate is ${progress.deliveryRate.actual}% against a ${target.deliveryRateTarget}% target.`,
      actions: [
        {
          label: `Recover ${recoverable} pending deliver${recoverable === 1 ? "y" : "ies"}`,
          detail: `${delivered} of ${placed} placed orders have landed. ${neededDelivered} would hit the target rate `
            + "- these are orders already paid for in advertising.",
          impact: Math.round(recoverable * contributionPerDelivery)
        },
        {
          label: `Each recovered delivery is worth about ${contributionPerDelivery.toLocaleString("en-NG")}`,
          detail: "A recovered delivery costs no new ad spend, so it converts straight to contribution. "
            + "Work the rescheduled and pending queues first.",
          impact: contributionPerDelivery
        }
      ]
    };
  }

  // ── Plan D: pieces per delivery ────────────────────────
  if (weakest.key === "pieces") {
    const gap = Math.max(0, targetPiecesPerDelivery - piecesPerDelivery);
    const upgradesNeeded = ceilExact(gap * delivered);
    return {
      planCode: "D",
      problem: "pieces",
      headline: `Average is ${piecesPerDelivery} pieces per delivery against a target of ${targetPiecesPerDelivery}.`,
      actions: [
        {
          label: `Upgrade ${upgradesNeeded} customer${upgradesNeeded === 1 ? "" : "s"} to a larger package`,
          detail: `Lifting the average from ${piecesPerDelivery} to ${targetPiecesPerDelivery} closes the piece gap `
            + "without a single extra order.",
          impact: Math.round(contributionShortfall)
        },
        {
          label: `Check the package mix across ${delivered} deliveries`,
          detail: `At ${piecesPerDelivery} pieces against a ${targetPiecesPerDelivery} target, upselling costs no `
            + "advertising - it is the cheapest contribution available.",
          impact: 0
        }
      ]
    };
  }

  // ── Plan B: order volume ───────────────────────────────
  const orderShortfall = Math.max(0, target.orderTarget - forecast.projectedOrders);
  const currentDaily = forecast.dailyAverageOrders;
  const requiredDaily = requiredPace.ordersPerDay;
  // The upsell alternative: same contribution gap, closed through bigger
  // orders instead of more of them.
  const piecesAlternative = round1(
    piecesPerDelivery + safeDiv(orderShortfall * piecesPerDelivery, Math.max(1, delivered))
  );
  return {
    planCode: "B",
    problem: "orders",
    headline: `Orders are projected to finish ${orderShortfall} below target.`,
    actions: [
      {
        label: `Raise daily orders from ${currentDaily} to ${requiredDaily}`,
        detail: `${requiredPace.remainingOrders} orders remain across `
          + `${requiredPace.daysRemainingInclusive} day${requiredPace.daysRemainingInclusive === 1 ? "" : "s"}.`,
        impact: Math.round(contributionShortfall)
      },
      {
        label: `Or raise pieces per delivery from ${piecesPerDelivery} to ${piecesAlternative}`,
        detail: "Bigger orders close the same gap without buying more traffic.",
        impact: Math.round(contributionShortfall)
      },
      {
        label: `Or recover ${orderShortfall} abandoned cart${orderShortfall === 1 ? "" : "s"} or dormant lead${orderShortfall === 1 ? "" : "s"}`,
        detail: "Already-paid-for demand: recovering the shortfall this way costs no new advertising.",
        impact: Math.round(orderShortfall * contributionPerDelivery)
      }
    ]
  };
}
