// Delivery rate goals for the Manager Dashboard's product cards.
//
// A product card shows how many of the orders PLACED in a window have been
// delivered, against a primary target and a stretch target. The useful part is
// not the percentage - the card already shows that - it is "how many more
// deliveries do we need", because that is a number someone can act on today.

/** Which orders a goal is measured over. */
export type DeliveryGoalBasis = "period" | "month" | "all_time";

export const DELIVERY_GOAL_BASES: DeliveryGoalBasis[] = ["period", "month", "all_time"];

export type DeliveryGoalSettings = {
  useCustomGoals: boolean;
  primaryTarget: number;
  stretchTarget: number;
  goalBasis: DeliveryGoalBasis;
  showProgressBar: boolean;
};

export const COMPANY_DEFAULT_PRIMARY = 65;
export const COMPANY_DEFAULT_STRETCH = 70;

/**
 * How many MORE delivered orders are needed to hit a target rate.
 *
 * Delivering does not change the denominator - these orders are already
 * placed - so this is simply "how many of the ones we already have still need
 * to land". Rounded UP, because 19.2 orders is not a thing you can deliver:
 * at 32 placed and an 60% target you need 20 delivered, not 19.
 *
 * Returns 0 once the target is met, never a negative.
 */
export function deliveriesNeededFor(placed: number, delivered: number, targetPct: number): number {
  const total = Math.max(0, Math.floor(Number(placed) || 0));
  const done = Math.max(0, Math.floor(Number(delivered) || 0));
  const target = Math.min(100, Math.max(0, Number(targetPct) || 0));
  if (total === 0) return 0;
  const required = Math.ceil((target / 100) * total);
  return Math.max(0, required - done);
}

/** Delivery rate as a whole percentage. 0 placed reads 0, never NaN. */
export function deliveryRatePct(placed: number, delivered: number): number {
  const total = Math.max(0, Math.floor(Number(placed) || 0));
  const done = Math.max(0, Math.floor(Number(delivered) || 0));
  if (total === 0) return 0;
  return Math.round((done / total) * 100);
}

export type DeliveryGoalProgress = {
  ratePct: number;
  primaryTarget: number;
  stretchTarget: number;
  primaryMet: boolean;
  stretchMet: boolean;
  toPrimary: number;
  toStretch: number;
  /** 0-100 width for the filled part of the bar. */
  barPct: number;
  /** 0-100 positions for the two target ticks. */
  primaryMarkerPct: number;
  stretchMarkerPct: number;
};

/**
 * Everything the progress bar needs, in one shape.
 *
 * The bar is scaled so the STRETCH target sits at ~85% of the track rather
 * than at the far right. A bar that ends exactly on the goal makes a rate
 * above the goal impossible to draw, and beating the stretch target is
 * precisely the thing worth showing.
 */
export function deliveryGoalProgress(
  placed: number,
  delivered: number,
  primaryTargetPct: number,
  stretchTargetPct: number
): DeliveryGoalProgress {
  const ratePct = deliveryRatePct(placed, delivered);
  const primaryTarget = Math.min(100, Math.max(0, Math.round(Number(primaryTargetPct) || 0)));
  // A stretch below the primary would draw its marker behind the primary one.
  const stretchTarget = Math.min(100, Math.max(primaryTarget, Math.round(Number(stretchTargetPct) || 0)));

  // Full scale keeps a little headroom past the stretch target so exceeding it
  // is visible. Guarded against a 0% stretch, which would divide by zero.
  const scale = Math.max(1, Math.round(stretchTarget / 0.85));
  const clampToTrack = (value: number) => Math.min(100, Math.max(0, Math.round((value / scale) * 100)));

  return {
    ratePct,
    primaryTarget,
    stretchTarget,
    primaryMet: ratePct >= primaryTarget,
    stretchMet: ratePct >= stretchTarget,
    toPrimary: deliveriesNeededFor(placed, delivered, primaryTarget),
    toStretch: deliveriesNeededFor(placed, delivered, stretchTarget),
    barPct: clampToTrack(ratePct),
    primaryMarkerPct: clampToTrack(primaryTarget),
    stretchMarkerPct: clampToTrack(stretchTarget)
  };
}

/** The goals actually in force for a product, after the default/custom choice. */
export function resolveDeliveryGoals(
  product: Partial<DeliveryGoalSettings> | null | undefined,
  companyPrimary: number = COMPANY_DEFAULT_PRIMARY,
  companyStretch: number = COMPANY_DEFAULT_STRETCH
): DeliveryGoalSettings {
  const fallbackPrimary = Math.min(100, Math.max(0, Math.round(Number(companyPrimary) || COMPANY_DEFAULT_PRIMARY)));
  const fallbackStretch = Math.min(100, Math.max(fallbackPrimary, Math.round(Number(companyStretch) || COMPANY_DEFAULT_STRETCH)));

  if (!product || product.useCustomGoals === false) {
    return {
      useCustomGoals: false,
      primaryTarget: fallbackPrimary,
      stretchTarget: fallbackStretch,
      goalBasis: product?.goalBasis ?? "period",
      // A product following the company default still gets to hide its own bar.
      showProgressBar: product?.showProgressBar !== false
    };
  }

  const primary = Math.min(100, Math.max(0, Math.round(Number(product.primaryTarget) || fallbackPrimary)));
  const stretch = Math.min(100, Math.max(primary, Math.round(Number(product.stretchTarget) || fallbackStretch)));
  return {
    useCustomGoals: true,
    primaryTarget: primary,
    stretchTarget: stretch,
    goalBasis: product.goalBasis ?? "period",
    showProgressBar: product.showProgressBar !== false
  };
}

/**
 * The sentence under the bar, in the order a manager reads it: what has been
 * achieved first, then what is still outstanding.
 */
export function deliveryGoalMessages(progress: DeliveryGoalProgress): { achieved: string[]; remaining: string[] } {
  const orders = (count: number) => `${count} more successful deliver${count === 1 ? "y" : "ies"}`;
  const achieved: string[] = [];
  const remaining: string[] = [];

  if (progress.stretchMet) {
    achieved.push(`${progress.stretchTarget}% stretch goal achieved`);
  } else if (progress.primaryMet) {
    achieved.push(`${progress.primaryTarget}% delivery goal achieved`);
    remaining.push(`${orders(progress.toStretch)} to reach ${progress.stretchTarget}%`);
  } else {
    remaining.push(`${orders(progress.toPrimary)} to reach ${progress.primaryTarget}%`);
    // Only worth stating separately when it is a different number.
    if (progress.toStretch > progress.toPrimary) {
      remaining.push(`${progress.toStretch} more to reach ${progress.stretchTarget}%`);
    }
  }
  return { achieved, remaining };
}
