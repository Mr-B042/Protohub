export type UpsellBonusTier = {
  id?: string;
  label: string;
  minRate: number;
  maxRate: number | null;
  amount: number;
};

export type UpsellBonusSettings = {
  title: string;
  description: string;
  profitGateAmount: number;
  deliveryRateGatePct: number;
  contributionCapPct: number;
  currency: "NGN" | "USD" | "GBP";
  tiers: UpsellBonusTier[];
  profitGateMissMessage: string;
  deliveryGateMissMessage: string;
  gatesMetMessage: string;
  belowTierMessage: string;
};

export type UpsellBonusEvaluation = {
  tierAmount: number;
  cappedAmount: number;
  finalAmount: number;
  status: "profit_gate_miss" | "delivery_gate_miss" | "below_tier" | "tier_bonus";
  label: string;
  message: string;
  matchedTier: UpsellBonusTier | null;
  profitGateMet: boolean;
  deliveryGateMet: boolean;
  capApplied: boolean;
};

export const DEFAULT_UPSELL_BONUS_SETTINGS: UpsellBonusSettings = {
  title: "Upselling & Cross-Selling Growth Bonus",
  description: "Rewards the manager for growing the share of delivered orders with a verified upsell, package upgrade, or cross-sell - gated on its own profit and delivery-rate floors, and capped so the bonus can never exceed a share of the real profit those add-ons generated.",
  profitGateAmount: 250_000,
  deliveryRateGatePct: 60,
  contributionCapPct: 20,
  currency: "NGN",
  profitGateMissMessage: "Weekly Net Profit (Ops) is below the ₦250,000 gate, so no Upselling & Cross-Selling Bonus applies this week.",
  deliveryGateMissMessage: "Company delivery rate is below 60%, so the Upselling & Cross-Selling Bonus is withheld this week to avoid encouraging add-ons customers may reject.",
  gatesMetMessage: "Both gates are met - payout follows the Delivered Sales Expansion Rate, capped at a share of real contribution profit.",
  belowTierMessage: "Both gates are met, but the Delivered Sales Expansion Rate is below the first bonus tier.",
  tiers: [
    { id: "tier-10", label: "10% - 14.9%", minRate: 10, maxRate: 14.9, amount: 5_000 },
    { id: "tier-15", label: "15% - 19.9%", minRate: 15, maxRate: 19.9, amount: 10_000 },
    { id: "tier-20", label: "20% - 24.9%", minRate: 20, maxRate: 24.9, amount: 15_000 },
    { id: "tier-25", label: "25% - 29.9%", minRate: 25, maxRate: 29.9, amount: 20_000 },
    { id: "tier-30", label: "30%+", minRate: 30, maxRate: null, amount: 25_000 }
  ]
};

const asNumber = (value: unknown, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const normalizeTier = (tier: Partial<UpsellBonusTier>, index: number): UpsellBonusTier | null => {
  const minRate = Math.max(0, Math.min(100, asNumber(tier.minRate, Number.NaN)));
  if (!Number.isFinite(minRate)) return null;
  const maxRateInput = (tier as Record<string, unknown>).maxRate;
  const rawMax = maxRateInput == null || maxRateInput === "" ? null : Math.max(0, Math.min(100, asNumber(maxRateInput, Number.NaN)));
  const maxRate = rawMax == null || !Number.isFinite(rawMax) ? null : Math.max(minRate, rawMax);
  const label = String(tier.label ?? "").trim()
    || `${minRate}%${maxRate == null ? "+" : ` - ${maxRate}%`}`;
  return {
    id: String(tier.id ?? `tier-${index + 1}`).trim() || `tier-${index + 1}`,
    label,
    minRate,
    maxRate,
    amount: Math.max(0, Math.round(asNumber(tier.amount, 0)))
  };
};

export const normalizeUpsellBonusSettings = (input: Partial<UpsellBonusSettings> | null | undefined): UpsellBonusSettings => {
  const source = input ?? {};
  const tiers = Array.isArray(source.tiers)
    ? source.tiers.map(normalizeTier).filter((tier): tier is UpsellBonusTier => Boolean(tier))
    : DEFAULT_UPSELL_BONUS_SETTINGS.tiers;
  return {
    title: String(source.title ?? DEFAULT_UPSELL_BONUS_SETTINGS.title).trim() || DEFAULT_UPSELL_BONUS_SETTINGS.title,
    description: String(source.description ?? DEFAULT_UPSELL_BONUS_SETTINGS.description).trim() || DEFAULT_UPSELL_BONUS_SETTINGS.description,
    profitGateAmount: Math.max(0, Math.round(asNumber(source.profitGateAmount, DEFAULT_UPSELL_BONUS_SETTINGS.profitGateAmount))),
    deliveryRateGatePct: Math.max(0, Math.min(100, asNumber(source.deliveryRateGatePct, DEFAULT_UPSELL_BONUS_SETTINGS.deliveryRateGatePct))),
    contributionCapPct: Math.max(0, Math.min(100, asNumber(source.contributionCapPct, DEFAULT_UPSELL_BONUS_SETTINGS.contributionCapPct))),
    currency: source.currency === "USD" || source.currency === "GBP" ? source.currency : "NGN",
    profitGateMissMessage: String(source.profitGateMissMessage ?? DEFAULT_UPSELL_BONUS_SETTINGS.profitGateMissMessage).trim() || DEFAULT_UPSELL_BONUS_SETTINGS.profitGateMissMessage,
    deliveryGateMissMessage: String(source.deliveryGateMissMessage ?? DEFAULT_UPSELL_BONUS_SETTINGS.deliveryGateMissMessage).trim() || DEFAULT_UPSELL_BONUS_SETTINGS.deliveryGateMissMessage,
    gatesMetMessage: String(source.gatesMetMessage ?? DEFAULT_UPSELL_BONUS_SETTINGS.gatesMetMessage).trim() || DEFAULT_UPSELL_BONUS_SETTINGS.gatesMetMessage,
    belowTierMessage: String(source.belowTierMessage ?? DEFAULT_UPSELL_BONUS_SETTINGS.belowTierMessage).trim() || DEFAULT_UPSELL_BONUS_SETTINGS.belowTierMessage,
    tiers: tiers
      .slice()
      .sort((left, right) => left.minRate - right.minRate || (left.maxRate ?? 101) - (right.maxRate ?? 101))
  };
};

// Both gates must be met (profit AND delivery rate) before any tier applies -
// unlike the existing Delivery Rate Bonus, there's no "support only" fallback
// here: missing either gate means zero for this bonus, by design (Bright:
// "This prevents the manager from encouraging reps to force unnecessary
// add-ons that customers may later reject").
export const evaluateUpsellBonus = (
  rawSettings: Partial<UpsellBonusSettings>,
  netProfitOps: number,
  deliveryRatePct: number,
  expansionRatePct: number,
  contributionProfit: number
): UpsellBonusEvaluation => {
  const settings = normalizeUpsellBonusSettings(rawSettings);
  const profitGateMet = netProfitOps >= settings.profitGateAmount;
  const deliveryGateMet = deliveryRatePct >= settings.deliveryRateGatePct;

  if (!profitGateMet) {
    return {
      tierAmount: 0, cappedAmount: 0, finalAmount: 0,
      status: "profit_gate_miss", label: "Profit gate not met",
      message: settings.profitGateMissMessage,
      matchedTier: null, profitGateMet: false, deliveryGateMet, capApplied: false
    };
  }
  if (!deliveryGateMet) {
    return {
      tierAmount: 0, cappedAmount: 0, finalAmount: 0,
      status: "delivery_gate_miss", label: "Delivery-rate gate not met",
      message: settings.deliveryGateMissMessage,
      matchedTier: null, profitGateMet: true, deliveryGateMet: false, capApplied: false
    };
  }

  const rate = Math.max(0, Math.min(100, asNumber(expansionRatePct, 0)));
  const matchedTier = settings.tiers.find((tier) =>
    rate >= tier.minRate && (tier.maxRate == null || rate <= tier.maxRate)
  ) ?? null;

  if (!matchedTier) {
    return {
      tierAmount: 0, cappedAmount: 0, finalAmount: 0,
      status: "below_tier", label: "Below first tier",
      message: settings.belowTierMessage,
      matchedTier: null, profitGateMet: true, deliveryGateMet: true, capApplied: false
    };
  }

  const tierAmount = matchedTier.amount;
  const cap = Math.max(0, Math.round(contributionProfit * (settings.contributionCapPct / 100)));
  const cappedAmount = Math.max(0, Math.min(tierAmount, cap));
  return {
    tierAmount, cappedAmount, finalAmount: cappedAmount,
    status: "tier_bonus", label: matchedTier.label,
    message: settings.gatesMetMessage,
    matchedTier, profitGateMet: true, deliveryGateMet: true,
    capApplied: cappedAmount < tierAmount
  };
};
