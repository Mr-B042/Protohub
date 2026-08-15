// Weekly bonus levels for the Head of Sales Rep, mirroring evaluateManagerBonus's
// gate-then-tier shape (manager-bonus.ts) - except gated on Team AOV + Team
// Delivery Rate together, and Level 2/3 additionally require a qualitative,
// human-confirmed check (measurable upsell/cross-sell improvement; successful
// initiative implementation) that no formula can certify on its own.
//
// No persistence yet - Stage 10 adds an Owner-editable settings table and a
// weekly Pending/Paid record. Until then this is a read-only preview off
// these defaults, same bootstrapping manager-bonus.ts does with
// DEFAULT_MANAGER_BONUS_SETTINGS before a settings row exists.
//
// These specific numbers (5k/10k/15k, AOV 19.5k/21k/23k, delivery 60/60/65%)
// are not invented placeholders - they're the exact structure the Owner
// worked out and supplied for this feature.
export type HeadOfSalesBonusTierId = "level1" | "level2" | "level3";

export type HeadOfSalesBonusTier = {
  id: HeadOfSalesBonusTierId;
  label: string;
  amount: number;
  minTeamAov: number;
  minDeliveryRate: number;
  requiresUpsellImprovement?: boolean;
  requiresInitiativeSuccess?: boolean;
};

export type HeadOfSalesBonusSettings = {
  currency: "NGN" | "USD" | "GBP";
  tiers: HeadOfSalesBonusTier[];
};

export const DEFAULT_HEAD_OF_SALES_BONUS_SETTINGS: HeadOfSalesBonusSettings = {
  currency: "NGN",
  tiers: [
    { id: "level1", label: "Level 1 - Meets Standard", amount: 5_000, minTeamAov: 19_500, minDeliveryRate: 60 },
    { id: "level2", label: "Level 2 - Strong Performance", amount: 10_000, minTeamAov: 21_000, minDeliveryRate: 60, requiresUpsellImprovement: true },
    { id: "level3", label: "Level 3 - Excellent Performance", amount: 15_000, minTeamAov: 23_000, minDeliveryRate: 65, requiresInitiativeSuccess: true }
  ]
};

export type HeadOfSalesQualitativeFlags = {
  upsellImprovement: boolean;
  initiativeSuccess: boolean;
};

export type HeadOfSalesBonusEvaluation = {
  amount: number;
  level: HeadOfSalesBonusTierId | "none";
  label: string;
  matchedTier: HeadOfSalesBonusTier | null;
  // What's still missing to reach the NEXT tier up, so the UI can say why -
  // not just show a number.
  nextTier: HeadOfSalesBonusTier | null;
};

export function evaluateHeadOfSalesBonus(
  settings: HeadOfSalesBonusSettings,
  teamAov: number,
  teamDeliveryRate: number,
  qualitative: HeadOfSalesQualitativeFlags = { upsellImprovement: false, initiativeSuccess: false }
): HeadOfSalesBonusEvaluation {
  // Highest threshold first - meeting Level 3's numbers also clears Level 2's
  // and Level 1's, so checking top-down finds the correct (highest) match.
  const highestFirst = [...settings.tiers].sort((a, b) => b.minTeamAov - a.minTeamAov);
  const lowestFirst = [...settings.tiers].sort((a, b) => a.minTeamAov - b.minTeamAov);
  for (const tier of highestFirst) {
    const meetsNumeric = teamAov >= tier.minTeamAov && teamDeliveryRate >= tier.minDeliveryRate;
    const meetsQualitative = (!tier.requiresUpsellImprovement || qualitative.upsellImprovement)
      && (!tier.requiresInitiativeSuccess || qualitative.initiativeSuccess);
    if (meetsNumeric && meetsQualitative) {
      // The tier immediately above this one, not just any higher tier -
      // .find() on the ascending list stops at the first (smallest) one
      // that clears the current threshold.
      const nextTier = lowestFirst.find((candidate) => candidate.minTeamAov > tier.minTeamAov) ?? null;
      return { amount: tier.amount, level: tier.id, label: tier.label, matchedTier: tier, nextTier };
    }
  }
  return { amount: 0, level: "none", label: "Below Level 1", matchedTier: null, nextTier: lowestFirst[0] ?? null };
}
