export type ManagerBonusTier = {
  id?: string;
  label: string;
  minRate: number;
  maxRate: number | null;
  amount: number;
};

export type ManagerBonusSettings = {
  title: string;
  description: string;
  profitGateAmount: number;
  supportBonusAmount: number;
  belowTierAmount: number;
  currency: "NGN" | "USD" | "GBP";
  tiers: ManagerBonusTier[];
  gateMissMessage: string;
  gateMetMessage: string;
  belowTierMessage: string;
};

export type ManagerBonusEvaluation = {
  amount: number;
  status: "support_only" | "delivery_bonus" | "below_delivery_floor";
  label: string;
  message: string;
  matchedTier: ManagerBonusTier | null;
  profitGateMet: boolean;
};

export const DEFAULT_MANAGER_BONUS_SETTINGS: ManagerBonusSettings = {
  title: "Manager Bonus (Fixed + Profit-Safe)",
  description: "Profit gate protects the company first. If weekly Net Profit (Ops) is below the gate, the manager gets support only. Once the gate is met, payout follows total company delivery rate across all products.",
  profitGateAmount: 150_000,
  supportBonusAmount: 10_000,
  belowTierAmount: 0,
  currency: "NGN",
  gateMissMessage: "Profit gate was not met, so only support bonus applies.",
  gateMetMessage: "Profit gate was met, so delivery-rate bonus applies.",
  belowTierMessage: "Profit gate was met, but delivery rate is below the first bonus tier.",
  tiers: [
    { id: "tier-55", label: "55% - 59.9%", minRate: 55, maxRate: 59.9, amount: 15_000 },
    { id: "tier-60", label: "60% - 64.9%", minRate: 60, maxRate: 64.9, amount: 20_000 },
    { id: "tier-65", label: "65% - 69.9%", minRate: 65, maxRate: 69.9, amount: 25_000 },
    { id: "tier-70", label: "70% - 74.9%", minRate: 70, maxRate: 74.9, amount: 30_000 },
    { id: "tier-75", label: "75%+", minRate: 75, maxRate: null, amount: 40_000 }
  ]
};

const asNumber = (value: unknown, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const normalizeTier = (tier: Partial<ManagerBonusTier>, index: number): ManagerBonusTier | null => {
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

export const normalizeManagerBonusSettings = (input: Partial<ManagerBonusSettings> | null | undefined): ManagerBonusSettings => {
  const source = input ?? {};
  const tiers = Array.isArray(source.tiers)
    ? source.tiers.map(normalizeTier).filter((tier): tier is ManagerBonusTier => Boolean(tier))
    : DEFAULT_MANAGER_BONUS_SETTINGS.tiers;
  return {
    title: String(source.title ?? DEFAULT_MANAGER_BONUS_SETTINGS.title).trim() || DEFAULT_MANAGER_BONUS_SETTINGS.title,
    description: String(source.description ?? DEFAULT_MANAGER_BONUS_SETTINGS.description).trim() || DEFAULT_MANAGER_BONUS_SETTINGS.description,
    profitGateAmount: Math.max(0, Math.round(asNumber(source.profitGateAmount, DEFAULT_MANAGER_BONUS_SETTINGS.profitGateAmount))),
    supportBonusAmount: Math.max(0, Math.round(asNumber(source.supportBonusAmount, DEFAULT_MANAGER_BONUS_SETTINGS.supportBonusAmount))),
    belowTierAmount: Math.max(0, Math.round(asNumber(source.belowTierAmount, DEFAULT_MANAGER_BONUS_SETTINGS.belowTierAmount))),
    currency: source.currency === "USD" || source.currency === "GBP" ? source.currency : "NGN",
    gateMissMessage: String(source.gateMissMessage ?? DEFAULT_MANAGER_BONUS_SETTINGS.gateMissMessage).trim() || DEFAULT_MANAGER_BONUS_SETTINGS.gateMissMessage,
    gateMetMessage: String(source.gateMetMessage ?? DEFAULT_MANAGER_BONUS_SETTINGS.gateMetMessage).trim() || DEFAULT_MANAGER_BONUS_SETTINGS.gateMetMessage,
    belowTierMessage: String(source.belowTierMessage ?? DEFAULT_MANAGER_BONUS_SETTINGS.belowTierMessage).trim() || DEFAULT_MANAGER_BONUS_SETTINGS.belowTierMessage,
    tiers: tiers
      .slice()
      .sort((left, right) => left.minRate - right.minRate || (left.maxRate ?? 101) - (right.maxRate ?? 101))
  };
};

export const evaluateManagerBonus = (
  rawSettings: Partial<ManagerBonusSettings>,
  netProfitOps: number,
  deliveryRate: number
): ManagerBonusEvaluation => {
  const settings = normalizeManagerBonusSettings(rawSettings);
  const profitGateMet = netProfitOps >= settings.profitGateAmount;
  if (!profitGateMet) {
    return {
      amount: settings.supportBonusAmount,
      status: "support_only",
      label: "Support only",
      message: settings.gateMissMessage,
      matchedTier: null,
      profitGateMet: false
    };
  }

  const rate = Math.max(0, Math.min(100, asNumber(deliveryRate, 0)));
  const matchedTier = settings.tiers.find((tier) =>
    rate >= tier.minRate && (tier.maxRate == null || rate <= tier.maxRate)
  ) ?? null;

  if (matchedTier) {
    return {
      amount: matchedTier.amount,
      status: "delivery_bonus",
      label: matchedTier.label,
      message: settings.gateMetMessage,
      matchedTier,
      profitGateMet: true
    };
  }

  return {
    amount: settings.belowTierAmount,
    status: "below_delivery_floor",
    label: "Below delivery floor",
    message: settings.belowTierMessage,
    matchedTier: null,
    profitGateMet: true
  };
};
