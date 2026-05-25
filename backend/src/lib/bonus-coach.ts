import {
  buildProductBonusConfigMap,
  computeOrderBonus,
  defaultBonusConfig,
  type PayStructure,
  type PayrollOrder,
  type ProductBonusConfig,
  type ProductRecord
} from "./payroll-calculator.js";
import { supabase } from "./supabase.js";

type BonusCoachOrder = PayrollOrder & {
  customer?: string | null;
  package_name?: string | null;
  updated_at?: string | null;
};

type OrgBonusSettings = {
  top_performer_bonus_enabled?: boolean | null;
  top_performer_bonus_amount?: number | null;
};

type RepUser = {
  id: string;
  org_id: string;
  name: string;
  role: string;
  active?: boolean | null;
};

type WeeklyStats = {
  delivered: number;
  total: number;
  revenue: number;
};

export type RepBonusSnapshot = {
  weekStart: string;
  weekEnd: string;
  deliveredCount: number;
  deliveredRevenue: number;
  deliveryRate: number;
  currentBonusEarned: number;
  projectedBonusOpenPipeline: number;
  nextTierTarget: number | null;
  ordersNeededForNextTier: number | null;
  nextDeliveryRateTarget: number | null;
  deliveriesNeededForRateTarget: number | null;
  topPerformerGap: number | null;
  topPerformerRank: number | null;
};

export type RepBonusMotivator = {
  type:
    | "next_delivered_unlock"
    | "delivery_rate_unlock"
    | "upsell_opportunity"
    | "cross_sell_opportunity"
    | "top_performer_race"
    | "bonus_at_risk";
  title: string;
  subtitle?: string;
  amount?: number;
  targetRate?: number;
  orderId?: string;
  customerName?: string;
  priority: number;
};

export type RepBonusOrderOpportunity = {
  orderId: string;
  customerName?: string;
  packageName?: string;
  amount: number;
  type: "upsell_opportunity" | "cross_sell_opportunity" | "bonus_opportunity";
  subtitle?: string;
};

export type RepBonusCoachResponse = {
  snapshot: RepBonusSnapshot;
  motivators: RepBonusMotivator[];
  orderOpportunities: RepBonusOrderOpportunity[];
};

type BonusCoachContext = {
  structure: PayStructure | null;
  productMap: Map<string, Required<ProductBonusConfig>>;
  orgSettings: OrgBonusSettings | null;
  rep: RepUser;
  deliveredOrders: BonusCoachOrder[];
  openOrders: BonusCoachOrder[];
  repStats: WeeklyStats;
  currentBonusEarned: number;
  projectedBonusOpenPipeline: number;
  nextTierTarget: number | null;
  ordersNeededForNextTier: number | null;
  nextTierAmount: number | null;
  nextDeliveryRateTarget: number | null;
  deliveriesNeededForRateTarget: number | null;
  topPerformerGap: number | null;
  topPerformerRank: number | null;
};

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ACTIVE_ORDER_STATUSES = ["New", "Confirmed", "In Process", "Dispatched", "Postponed"] as const;

const addDaysToDateKey = (dateKey: string, days: number) => {
  const date = new Date(`${dateKey}T00:00:00`);
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

const weekEndFromStart = (weekStart: string) => addDaysToDateKey(weekStart, 6);

const formatAmount = (value: number) => {
  const safe = Number.isFinite(value) ? value : 0;
  return `₦${Math.round(safe).toLocaleString("en-NG")}`;
};

const buildWeeklyStats = (deliveredOrders: BonusCoachOrder[], pendingOrders: BonusCoachOrder[]) => {
  const stats: WeeklyStats = { delivered: 0, total: 0, revenue: 0 };
  for (const order of deliveredOrders) {
    stats.delivered += 1;
    stats.total += 1;
    stats.revenue += Number(order.amount ?? 0);
  }
  for (const _order of pendingOrders) {
    stats.total += 1;
  }
  return stats;
};

const computeWeeklyTierBonus = (
  productMap: Map<string, Required<ProductBonusConfig>>,
  deliveredOrders: BonusCoachOrder[],
  stats: WeeklyStats
) => {
  if (deliveredOrders.length === 0 || stats.total === 0) return 0;
  const rate = stats.total > 0 ? (stats.delivered / stats.total) * 100 : 0;
  const aov = stats.delivered > 0 ? stats.revenue / stats.delivered : 0;
  const repProducts = new Set(deliveredOrders.map((order) => order.product_id).filter((value): value is string => !!value));
  let total = 0;
  repProducts.forEach((productId) => {
    const cfg = productMap.get(productId) ?? defaultBonusConfig();
    if (stats.total >= cfg.deliveryRateMinOrders && rate >= cfg.poorDeliveryRatePercent) {
      const deliveryRateTier = cfg.deliveryRateBonuses
        .filter((rule) => rate >= rule.ratePercent)
        .sort((a, b) => b.ratePercent - a.ratePercent)[0];
      if (deliveryRateTier) total += Number(deliveryRateTier.amount ?? 0);
    }
    if (rate >= cfg.aovRequiresMinDeliveryRate) {
      const aovTier = cfg.aovBonuses
        .filter((rule) => aov >= rule.threshold)
        .sort((a, b) => b.threshold - a.threshold)[0];
      if (aovTier) total += Number(aovTier.amount ?? 0);
    }
  });
  return total;
};

const computePerformanceTierBonus = (structure: PayStructure | null, deliveredCount: number) => {
  if (!structure || structure.type !== "Performance Bonus" || !Array.isArray(structure.bonus_tiers)) {
    return 0;
  }
  const tier = structure.bonus_tiers
    .filter((entry) => deliveredCount >= Number(entry.threshold ?? 0))
    .sort((a, b) => Number(b.threshold ?? 0) - Number(a.threshold ?? 0))[0];
  return Number(tier?.amount ?? 0);
};

const nextPerformanceTier = (structure: PayStructure | null, deliveredCount: number) => {
  if (!structure || structure.type !== "Performance Bonus" || !Array.isArray(structure.bonus_tiers)) {
    return { nextTierTarget: null, ordersNeededForNextTier: null, nextTierAmount: null };
  }
  const nextTier = structure.bonus_tiers
    .filter((entry) => Number(entry.threshold ?? 0) > deliveredCount)
    .sort((a, b) => Number(a.threshold ?? 0) - Number(b.threshold ?? 0))[0];
  if (!nextTier) {
    return { nextTierTarget: null, ordersNeededForNextTier: null, nextTierAmount: null };
  }
  const threshold = Number(nextTier.threshold ?? 0);
  return {
    nextTierTarget: threshold,
    ordersNeededForNextTier: Math.max(1, threshold - deliveredCount),
    nextTierAmount: Number(nextTier.amount ?? 0)
  };
};

const nextDeliveryRateGoal = (
  productMap: Map<string, Required<ProductBonusConfig>>,
  relevantProductIds: string[],
  deliveredCount: number,
  totalCount: number
) => {
  const targets = Array.from(new Set(
    relevantProductIds.flatMap((productId) => {
      const cfg = productMap.get(productId) ?? defaultBonusConfig();
      return [
        cfg.poorDeliveryRatePercent,
        cfg.upgradeRequiresMinDeliveryRate,
        cfg.aovRequiresMinDeliveryRate,
        ...cfg.deliveryRateBonuses.map((entry) => entry.ratePercent)
      ]
        .map((value) => Number(value ?? 0))
        .filter((value) => value > 0 && value <= 100);
    })
  )).sort((a, b) => a - b);

  if (targets.length === 0 || totalCount <= 0) {
    return { nextDeliveryRateTarget: null, deliveriesNeededForRateTarget: null };
  }

  const currentRate = totalCount > 0 ? (deliveredCount / totalCount) * 100 : 0;
  const target = targets.find((value) => value > currentRate + 0.001);
  if (!target) {
    return { nextDeliveryRateTarget: null, deliveriesNeededForRateTarget: null };
  }

  const needed = Math.max(1, Math.ceil(((target / 100) * totalCount) - deliveredCount));
  return {
    nextDeliveryRateTarget: target,
    deliveriesNeededForRateTarget: needed
  };
};

const computeTopPerformerPosition = (
  repId: string,
  orgSettings: OrgBonusSettings | null,
  deliveredOrders: BonusCoachOrder[]
) => {
  if (!orgSettings?.top_performer_bonus_enabled || Number(orgSettings.top_performer_bonus_amount ?? 0) <= 0) {
    return { topPerformerGap: null, topPerformerRank: null };
  }
  const deliveredByRep = new Map<string, number>();
  for (const order of deliveredOrders) {
    const assignedRepId = order.assigned_rep_id ?? "";
    if (!assignedRepId) continue;
    deliveredByRep.set(assignedRepId, (deliveredByRep.get(assignedRepId) ?? 0) + 1);
  }
  const sorted = Array.from(deliveredByRep.entries()).sort((a, b) => b[1] - a[1]);
  const currentDelivered = deliveredByRep.get(repId) ?? 0;
  const leaderDelivered = sorted[0]?.[1] ?? currentDelivered;
  const rankIndex = sorted.findIndex(([candidateId]) => candidateId === repId);
  return {
    topPerformerGap: leaderDelivered > currentDelivered ? leaderDelivered - currentDelivered : 0,
    topPerformerRank: rankIndex >= 0 ? rankIndex + 1 : null
  };
};

const projectedBonusForOpenOrder = (
  order: BonusCoachOrder,
  productMap: Map<string, Required<ProductBonusConfig>>,
  rate: number,
  aov: number,
  totalCount: number
) => computeOrderBonus(
  { ...order, status: "Delivered" },
  productMap,
  rate,
  aov,
  totalCount
);

export const buildRepBonusSnapshot = async (
  orgId: string,
  repId: string,
  weekStart: string
): Promise<BonusCoachContext> => {
  if (!DATE_KEY_PATTERN.test(weekStart)) {
    throw new Error("weekStart must be in YYYY-MM-DD format.");
  }

  const weekEnd = weekEndFromStart(weekStart);
  const nextWeekStart = addDaysToDateKey(weekEnd, 1);
  const weekStartTs = `${weekStart}T00:00:00`;
  const nextWeekStartTs = `${nextWeekStart}T00:00:00`;

  const [
    repResult,
    structureResult,
    productsResult,
    orgResult,
    deliveredResult,
    deliveredFallbackResult,
    pendingWeekResult,
    openOrdersResult
  ] = await Promise.all([
    supabase
      .from("users")
      .select("id, org_id, name, role, active")
      .eq("org_id", orgId)
      .eq("id", repId)
      .single(),
    supabase
      .from("pay_structures")
      .select("*")
      .eq("org_id", orgId)
      .eq("user_id", repId)
      .maybeSingle(),
    supabase
      .from("products")
      .select("id, bonus_config")
      .eq("org_id", orgId),
    supabase
      .from("organizations")
      .select("top_performer_bonus_enabled, top_performer_bonus_amount")
      .eq("id", orgId)
      .maybeSingle(),
    supabase
      .from("orders")
      .select("id, assigned_rep_id, status, amount, product_id, quantity, source, upsell_from_qty, upsell_to_qty, manual_bonus_override, bonus_manually_adjusted, cross_sell_lines, free_gift_lines, delivered_date, created_at, updated_at, date, customer, package_name")
      .eq("org_id", orgId)
      .eq("status", "Delivered")
      .gte("delivered_date", weekStart)
      .lt("delivered_date", nextWeekStart),
    supabase
      .from("orders")
      .select("id, assigned_rep_id, status, amount, product_id, quantity, source, upsell_from_qty, upsell_to_qty, manual_bonus_override, bonus_manually_adjusted, cross_sell_lines, free_gift_lines, delivered_date, created_at, updated_at, date, customer, package_name")
      .eq("org_id", orgId)
      .eq("status", "Delivered")
      .is("delivered_date", null)
      .gte("updated_at", weekStartTs)
      .lt("updated_at", nextWeekStartTs),
    supabase
      .from("orders")
      .select("id, assigned_rep_id, status, amount, product_id, quantity, source, upsell_from_qty, upsell_to_qty, manual_bonus_override, bonus_manually_adjusted, cross_sell_lines, free_gift_lines, delivered_date, created_at, updated_at, date, customer, package_name")
      .eq("org_id", orgId)
      .eq("assigned_rep_id", repId)
      .neq("status", "Delivered")
      .gte("created_at", weekStartTs)
      .lt("created_at", nextWeekStartTs),
    supabase
      .from("orders")
      .select("id, assigned_rep_id, status, amount, product_id, quantity, source, upsell_from_qty, upsell_to_qty, manual_bonus_override, bonus_manually_adjusted, cross_sell_lines, free_gift_lines, delivered_date, created_at, updated_at, date, customer, package_name")
      .eq("org_id", orgId)
      .eq("assigned_rep_id", repId)
      .in("status", [...ACTIVE_ORDER_STATUSES])
      .order("created_at", { ascending: false })
  ]);

  const settled = [repResult, structureResult, productsResult, orgResult, deliveredResult, deliveredFallbackResult, pendingWeekResult, openOrdersResult];
  const firstError = settled.find((result) => result.error);
  if (firstError?.error) {
    throw new Error(firstError.error.message);
  }

  const rep = repResult.data as RepUser | null;
  if (!rep) {
    throw new Error("Sales rep not found.");
  }

  const structure = (structureResult.data as PayStructure | null) ?? null;
  const productMap = buildProductBonusConfigMap((productsResult.data ?? []) as ProductRecord[]);
  const orgSettings = (orgResult.data as OrgBonusSettings | null) ?? null;

  const deliveredMap = new Map<string, BonusCoachOrder>();
  for (const order of [...(deliveredResult.data ?? []), ...(deliveredFallbackResult.data ?? [])] as BonusCoachOrder[]) {
    deliveredMap.set(order.id, order);
  }
  const allDeliveredThisWeek = Array.from(deliveredMap.values());
  const repDeliveredOrders = allDeliveredThisWeek.filter((order) => order.assigned_rep_id === repId);
  const repPendingWeekOrders = (pendingWeekResult.data ?? []) as BonusCoachOrder[];
  const openOrders = (openOrdersResult.data ?? []) as BonusCoachOrder[];

  const repStats = buildWeeklyStats(repDeliveredOrders, repPendingWeekOrders);
  const currentRate = repStats.total > 0 ? (repStats.delivered / repStats.total) * 100 : 0;
  const currentAov = repStats.delivered > 0 ? repStats.revenue / repStats.delivered : 0;

  const deliveredOrderBonus = repDeliveredOrders.reduce((sum, order) => (
    sum + computeOrderBonus(order, productMap, currentRate, currentAov, repStats.total)
  ), 0);
  const weeklyTierBonus = computeWeeklyTierBonus(productMap, repDeliveredOrders, repStats);
  const performanceTierBonus = computePerformanceTierBonus(structure, repStats.delivered);
  const currentBonusEarned = deliveredOrderBonus + weeklyTierBonus + performanceTierBonus;

  const projectedOpenBonus = openOrders.reduce((sum, order) => (
    sum + projectedBonusForOpenOrder(order, productMap, currentRate, currentAov, repStats.total)
  ), 0);
  const projectedDeliveredCount = repStats.delivered + openOrders.length;
  const projectedPerformanceTierBonus = computePerformanceTierBonus(structure, projectedDeliveredCount);
  const projectedBonusOpenPipeline = deliveredOrderBonus + weeklyTierBonus + projectedOpenBonus + projectedPerformanceTierBonus;

  const { nextTierTarget, ordersNeededForNextTier, nextTierAmount } = nextPerformanceTier(structure, repStats.delivered);
  const relevantProductIds = Array.from(new Set(
    [...repDeliveredOrders, ...openOrders]
      .map((order) => order.product_id)
      .filter((value): value is string => !!value)
  ));
  const { nextDeliveryRateTarget, deliveriesNeededForRateTarget } = nextDeliveryRateGoal(
    productMap,
    relevantProductIds,
    repStats.delivered,
    repStats.total
  );
  const { topPerformerGap, topPerformerRank } = computeTopPerformerPosition(repId, orgSettings, allDeliveredThisWeek);

  return {
    structure,
    productMap,
    orgSettings,
    rep,
    deliveredOrders: repDeliveredOrders,
    openOrders,
    repStats,
    currentBonusEarned,
    projectedBonusOpenPipeline,
    nextTierTarget,
    ordersNeededForNextTier,
    nextTierAmount,
    nextDeliveryRateTarget,
    deliveriesNeededForRateTarget,
    topPerformerGap,
    topPerformerRank
  };
};

export const buildRepBonusMotivators = (context: BonusCoachContext): RepBonusMotivator[] => {
  const motivators: RepBonusMotivator[] = [];
  const rate = context.repStats.total > 0 ? (context.repStats.delivered / context.repStats.total) * 100 : 0;
  const aov = context.repStats.delivered > 0 ? context.repStats.revenue / context.repStats.delivered : 0;

  const productIds = Array.from(new Set(
    [...context.deliveredOrders, ...context.openOrders]
      .map((order) => order.product_id)
      .filter((value): value is string => !!value)
  ));

  const weakThresholds = productIds
    .map((productId) => (context.productMap.get(productId) ?? defaultBonusConfig()).poorDeliveryRatePercent)
    .filter((value) => Number.isFinite(value) && value > 0);
  const weakThreshold = weakThresholds.length > 0 ? Math.min(...weakThresholds) : null;

  if (weakThreshold !== null && context.repStats.total >= 1 && rate < weakThreshold) {
    motivators.push({
      type: "bonus_at_risk",
      title: `Your delivery rate is ${Math.round(rate)}% this week`,
      subtitle: `Reach ${weakThreshold}% so you do not get stuck on base-only bonus.`,
      targetRate: weakThreshold,
      priority: 110
    });
  }

  if (context.nextTierTarget && context.ordersNeededForNextTier && context.nextTierAmount) {
    motivators.push({
      type: "next_delivered_unlock",
      title: `Deliver ${context.ordersNeededForNextTier} more order${context.ordersNeededForNextTier === 1 ? "" : "s"} to unlock ${formatAmount(context.nextTierAmount)}`,
      subtitle: `Next milestone is ${context.nextTierTarget} delivered orders this week.`,
      amount: context.nextTierAmount,
      priority: 100
    });
  }

  if (context.nextDeliveryRateTarget && context.deliveriesNeededForRateTarget) {
    motivators.push({
      type: "delivery_rate_unlock",
      title: `Complete ${context.deliveriesNeededForRateTarget} more successful deliver${context.deliveriesNeededForRateTarget === 1 ? "y" : "ies"} to reach ${context.nextDeliveryRateTarget}%`,
      subtitle: `You are currently at ${Math.round(rate)}% for this bonus week.`,
      targetRate: context.nextDeliveryRateTarget,
      priority: 90
    });
  }

  const projectedOrders = context.openOrders
    .map((order) => {
      const projected = projectedBonusForOpenOrder(order, context.productMap, rate, aov, context.repStats.total);
      return { order, projected };
    })
    .filter((entry) => entry.projected > 0)
    .sort((a, b) => b.projected - a.projected);

  const bestNamedOpportunity = projectedOrders.find(({ order }) => {
    const hasUpgrade = typeof order.upsell_from_qty === "number" && typeof order.upsell_to_qty === "number" && order.upsell_to_qty > order.upsell_from_qty;
    const hasCrossSell = Array.isArray(order.cross_sell_lines) && order.cross_sell_lines.length > 0;
    return hasUpgrade || hasCrossSell;
  });

  if (bestNamedOpportunity) {
    const { order, projected } = bestNamedOpportunity;
    const hasUpgrade = typeof order.upsell_from_qty === "number" && typeof order.upsell_to_qty === "number" && order.upsell_to_qty > order.upsell_from_qty;
    motivators.push({
      type: hasUpgrade ? "upsell_opportunity" : "cross_sell_opportunity",
      title: `${hasUpgrade ? "Close" : "Recover"} ${order.customer ?? "this customer"}${hasUpgrade ? "'s upsell" : "'s add-on order"} for about ${formatAmount(projected)} bonus`,
      subtitle: order.package_name ? `${order.package_name} is already the selected package.` : "This order already has extra bonus value attached.",
      amount: projected,
      orderId: order.id,
      customerName: order.customer ?? undefined,
      priority: 95
    });
  }

  if ((context.orgSettings?.top_performer_bonus_enabled ?? false) && Number(context.orgSettings?.top_performer_bonus_amount ?? 0) > 0 && context.topPerformerGap !== null) {
    if (context.topPerformerGap <= 2) {
      motivators.push({
        type: "top_performer_race",
        title: context.topPerformerGap === 0
          ? `You are currently leading for the ${formatAmount(Number(context.orgSettings?.top_performer_bonus_amount ?? 0))} top performer bonus`
          : `${context.topPerformerGap} more deliver${context.topPerformerGap === 1 ? "y" : "ies"} can put you in first place`,
        subtitle: context.topPerformerGap === 0
          ? "Keep the pace so you hold the weekly top-performer slot."
          : `The weekly winner bonus is ${formatAmount(Number(context.orgSettings?.top_performer_bonus_amount ?? 0))}.`,
        amount: Number(context.orgSettings?.top_performer_bonus_amount ?? 0),
        priority: context.topPerformerGap === 0 ? 70 : 85
      });
    }
  }

  return motivators
    .sort((a, b) => b.priority - a.priority)
    .slice(0, 3);
};

export const getRepBonusCoach = async (
  orgId: string,
  repId: string,
  weekStart: string
): Promise<RepBonusCoachResponse> => {
  const context = await buildRepBonusSnapshot(orgId, repId, weekStart);
  const rate = context.repStats.total > 0 ? (context.repStats.delivered / context.repStats.total) * 100 : 0;
  const aov = context.repStats.delivered > 0 ? context.repStats.revenue / context.repStats.delivered : 0;
  const snapshot: RepBonusSnapshot = {
    weekStart,
    weekEnd: weekEndFromStart(weekStart),
    deliveredCount: context.repStats.delivered,
    deliveredRevenue: context.repStats.revenue,
    deliveryRate: context.repStats.total > 0 ? Math.round((context.repStats.delivered / context.repStats.total) * 100) : 0,
    currentBonusEarned: context.currentBonusEarned,
    projectedBonusOpenPipeline: context.projectedBonusOpenPipeline,
    nextTierTarget: context.nextTierTarget,
    ordersNeededForNextTier: context.ordersNeededForNextTier,
    nextDeliveryRateTarget: context.nextDeliveryRateTarget,
    deliveriesNeededForRateTarget: context.deliveriesNeededForRateTarget,
    topPerformerGap: context.topPerformerGap,
    topPerformerRank: context.topPerformerRank
  };
  const orderOpportunities: RepBonusOrderOpportunity[] = context.openOrders
    .flatMap((order) => {
      const projected = projectedBonusForOpenOrder(order, context.productMap, rate, aov, context.repStats.total);
      if (!(projected > 0)) {
        return [];
      }
      const hasUpgrade = typeof order.upsell_from_qty === "number"
        && typeof order.upsell_to_qty === "number"
        && order.upsell_to_qty > order.upsell_from_qty;
      const hasCrossSell = Array.isArray(order.cross_sell_lines) && order.cross_sell_lines.length > 0;
      const opportunityType: RepBonusOrderOpportunity["type"] = hasUpgrade
        ? "upsell_opportunity"
        : hasCrossSell
          ? "cross_sell_opportunity"
          : "bonus_opportunity";
      return [{
        orderId: order.id,
        customerName: order.customer ?? undefined,
        packageName: order.package_name ?? undefined,
        amount: projected,
        type: opportunityType,
        subtitle: hasUpgrade
          ? `Upsell ${order.customer ?? "this customer"} from ${order.upsell_from_qty} to ${order.upsell_to_qty} pcs to grow this bonus.`
          : hasCrossSell
            ? `${order.customer ?? "This customer"} already has add-ons attached that can convert into bonus on delivery.`
            : "A clean delivery on this order still adds to your weekly bonus progress."
      }];
    })
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 12);
  return {
    snapshot,
    motivators: buildRepBonusMotivators(context),
    orderOpportunities
  };
};
