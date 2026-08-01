// Working out what a delivery should pay.
//
// Several rules can match one order - a state rate, a city rate, a distance
// band. Rather than "last one wins", the MOST SPECIFIC match wins, so adding a
// city rate never silently changes every other city in that state.

export type FeeScope = "default" | "state" | "city" | "zone" | "distance" | "product";

export type FeeRule = {
  id: string;
  scope: FeeScope;
  matchValue?: string | null;
  distanceMinKm?: number | null;
  distanceMaxKm?: number | null;
  fee: number;
  sameDaySurcharge?: number | null;
  active?: boolean;
};

export type FeeContext = {
  state?: string | null;
  city?: string | null;
  zone?: string | null;
  productId?: string | null;
  distanceKm?: number | null;
  sameDay?: boolean;
};

/**
 * How specific each scope is. A city rate beats a state rate, which beats a
 * zone rate, and the default only applies when nothing else matches.
 */
const SPECIFICITY: Record<FeeScope, number> = {
  city: 5, state: 4, distance: 3, zone: 2, product: 1, default: 0
};

const norm = (value?: string | null) =>
  (value ?? "").toLowerCase().replace(/\s*state\s*$/i, "").trim();

export function ruleMatches(rule: FeeRule, context: FeeContext): boolean {
  if (rule.active === false) return false;
  switch (rule.scope) {
    case "default": return true;
    // Same loose comparison used when matching agents to orders: "Rivers" and
    // "Rivers State" must not price differently.
    case "state": return norm(rule.matchValue) === norm(context.state) && norm(context.state) !== "";
    case "city": return norm(rule.matchValue) === norm(context.city) && norm(context.city) !== "";
    case "zone": return norm(rule.matchValue) === norm(context.zone) && norm(context.zone) !== "";
    case "product": return String(rule.matchValue ?? "") === String(context.productId ?? "")
      && Boolean(context.productId);
    case "distance": {
      const km = context.distanceKm;
      if (km === null || km === undefined || !Number.isFinite(km)) return false;
      const min = rule.distanceMinKm ?? 0;
      const max = rule.distanceMaxKm ?? Number.POSITIVE_INFINITY;
      return km >= min && km <= max;
    }
    default: return false;
  }
}

export type FeeResolution = {
  fee: number;
  surcharge: number;
  total: number;
  /** Which rule decided it, so the number is never unexplained. */
  ruleId: string | null;
  scope: FeeScope | null;
  reason: string;
};

/**
 * Resolves the standard fee for an order.
 *
 * Returns the deciding rule alongside the amount: a delivery fee somebody
 * cannot explain is one they will argue about later.
 */
export function resolveStandardFee(rules: FeeRule[], context: FeeContext): FeeResolution {
  const matching = rules
    .filter((rule) => ruleMatches(rule, context))
    .sort((a, b) => {
      const bySpecificity = SPECIFICITY[b.scope] - SPECIFICITY[a.scope];
      if (bySpecificity !== 0) return bySpecificity;
      // Two rules of equal specificity: the cheaper one, so a duplicate never
      // silently costs more than the rate already agreed.
      return a.fee - b.fee;
    });

  const winner = matching[0];
  if (!winner) {
    return {
      fee: 0, surcharge: 0, total: 0, ruleId: null, scope: null,
      reason: "No fee rule matches this order. Set a default rate so nothing is dispatched unpriced."
    };
  }

  const surcharge = context.sameDay ? Math.max(0, Number(winner.sameDaySurcharge ?? 0)) : 0;
  const label = winner.scope === "default"
    ? "the default rate"
    : winner.scope === "distance"
      ? `the ${winner.distanceMinKm ?? 0}-${winner.distanceMaxKm ?? "+"}km band`
      : `the ${winner.scope} rate for ${winner.matchValue}`;

  return {
    fee: Math.round(winner.fee),
    surcharge: Math.round(surcharge),
    total: Math.round(winner.fee + surcharge),
    ruleId: winner.id,
    scope: winner.scope,
    reason: surcharge > 0 ? `${label}, plus a same-day surcharge` : label
  };
}

/** Trust levels are only meaningful if the limits they imply are enforced. */
export type TrustLimits = { maxStock: number; maxCod: number; maxActiveOrders: number };

export function limitsForTrustLevel(
  trustLevel: string,
  settings: {
    probationMaxStock: number; probationMaxCod: number; probationMaxActiveOrders: number;
    verifiedMaxStock: number; verifiedMaxCod: number; verifiedMaxActiveOrders: number;
    trustedMaxStock: number; trustedMaxCod: number; trustedMaxActiveOrders: number;
  }
): TrustLimits {
  if (trustLevel === "Trusted") {
    return { maxStock: settings.trustedMaxStock, maxCod: settings.trustedMaxCod, maxActiveOrders: settings.trustedMaxActiveOrders };
  }
  if (trustLevel === "Verified") {
    return { maxStock: settings.verifiedMaxStock, maxCod: settings.verifiedMaxCod, maxActiveOrders: settings.verifiedMaxActiveOrders };
  }
  // Anything unrecognised falls to the tightest limits rather than the loosest -
  // an unknown trust level must never accidentally grant more exposure.
  return { maxStock: settings.probationMaxStock, maxCod: settings.probationMaxCod, maxActiveOrders: settings.probationMaxActiveOrders };
}
