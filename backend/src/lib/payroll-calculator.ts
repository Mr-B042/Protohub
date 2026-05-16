import { supabase } from "./supabase.js";

type BonusRule = { quantity: number; amount: number };
type UpgradeBonusRule = { fromQty: number; toQty: number; amount: number };
type ThresholdBonusRule = { threshold: number; amount: number };
type DeliveryRateBonusRule = { ratePercent: number; amount: number };

type ProductBonusConfig = {
  baseDelivered?: BonusRule[];
  manualOrderBonuses?: BonusRule[];
  upgradeBonuses?: UpgradeBonusRule[];
  crossSellPercent?: number;
  crossSellFixed?: number;
  freeGiftBonus?: number;
  poorDeliveryRatePercent?: number;
  deliveryRateMinOrders?: number;
  upgradeRequiresMinDeliveryRate?: number;
  aovRequiresMinDeliveryRate?: number;
  aovBonuses?: ThresholdBonusRule[];
  deliveryRateBonuses?: DeliveryRateBonusRule[];
};

type PayrollUser = {
  id: string;
  name: string;
  role: string;
};

type PayStructure = {
  user_id: string;
  type: "Per Delivered Order" | "Fixed Salary" | "Hybrid" | "Performance Bonus";
  fixed_salary?: number | null;
  commission_pct?: number | null;
  bonus_tiers?: ThresholdBonusRule[] | null;
};

type PayrollPenalty = {
  rep_id: string;
  amount?: number | null;
};

type PayrollOrder = {
  id: string;
  assigned_rep_id?: string | null;
  status?: string | null;
  amount?: number | null;
  product_id?: string | null;
  quantity?: number | null;
  source?: string | null;
  upsell_from_qty?: number | null;
  upsell_to_qty?: number | null;
  manual_bonus_override?: number | null;
  bonus_manually_adjusted?: boolean | null;
  cross_sell_lines?: unknown;
  free_gift_lines?: unknown;
  delivered_date?: string | null;
  created_at?: string | null;
  date?: string | null;
};

type ProductRecord = {
  id: string;
  bonus_config?: ProductBonusConfig | null;
};

export type PayrollEntry = {
  userId: string;
  name: string;
  delivered: number;
  fixedSalary: number;
  commission: number;
  autoBonus: number;
  deductions: number;
  total: number;
};

export type PayrollTopPerformer = {
  names: string[];
  amountEach: number;
  delivered: number;
};

export type PayrollPreview = {
  period: string;
  rows: PayrollEntry[];
  total: number;
  topPerformer?: PayrollTopPerformer;
};

type PeriodBounds = {
  periodStartDate: string;
  periodEndDate: string;
  periodStartTs: string;
  periodEndTs: string;
};

const defaultBonusConfig = (): Required<ProductBonusConfig> => ({
  baseDelivered: [],
  manualOrderBonuses: [],
  upgradeBonuses: [],
  crossSellPercent: 0,
  crossSellFixed: 0,
  freeGiftBonus: 0,
  poorDeliveryRatePercent: 60,
  deliveryRateMinOrders: 5,
  upgradeRequiresMinDeliveryRate: 60,
  aovRequiresMinDeliveryRate: 60,
  aovBonuses: [],
  deliveryRateBonuses: []
});

const parsePayrollPeriod = (period: string): PeriodBounds | null => {
  const parts = period.trim().split(/\s+/);
  const periodDate = parts.length === 2
    ? new Date(`${parts[0]} 1, ${parts[1]}`)
    : new Date(`${period} 1`);
  if (Number.isNaN(periodDate.getTime())) {
    return null;
  }

  const start = new Date(periodDate.getFullYear(), periodDate.getMonth(), 1);
  const end = new Date(periodDate.getFullYear(), periodDate.getMonth() + 1, 1);
  const periodStartDate = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-01`;
  const periodEndDate = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, "0")}-01`;
  return {
    periodStartDate,
    periodEndDate,
    periodStartTs: `${periodStartDate}T00:00:00`,
    periodEndTs: `${periodEndDate}T00:00:00`
  };
};

const normalizeDateKey = (value?: string | null) => {
  if (!value) return "";
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(parsed.getDate()).padStart(2, "0")}`;
  }
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }
  return "";
};

const orderCreatedKey = (order: PayrollOrder) => normalizeDateKey(order.created_at ?? order.date);
const orderDeliveredKey = (order: PayrollOrder) =>
  order.delivered_date ? normalizeDateKey(order.delivered_date) : (order.status ?? "New") === "Delivered" ? orderCreatedKey(order) : "";

const weekKeyForDateKey = (dateKey: string) => {
  if (!dateKey) return "";
  const date = new Date(`${dateKey}T00:00:00`);
  const yearStart = new Date(date.getFullYear(), 0, 1);
  const weekIdx = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + yearStart.getDay() + 1) / 7);
  return `${date.getFullYear()}-W${weekIdx}`;
};

const quantityForOrder = (order: PayrollOrder) => {
  const quantity = Number(order.quantity ?? 1);
  return Number.isFinite(quantity) && quantity > 0 ? Math.round(quantity) : 1;
};

const normalizedLineAmount = (line: unknown) => {
  if (!line || typeof line !== "object") return 0;
  const raw = (line as Record<string, unknown>).amount;
  const amount = Number(raw ?? 0);
  return Number.isFinite(amount) ? amount : 0;
};

const normalizedLineCount = (lines: unknown) => Array.isArray(lines) ? lines.length : 0;
const normalizedLineTotal = (lines: unknown) => Array.isArray(lines) ? lines.reduce((sum, line) => sum + normalizedLineAmount(line), 0) : 0;

const computeOrderBonus = (
  order: PayrollOrder,
  productMap: Map<string, Required<ProductBonusConfig>>,
  repWeeklyDeliveryRate: number,
  repWeeklyAov: number,
  repWeeklyOrderCount: number
) => {
  const manualOverride = Number(order.manual_bonus_override);
  if (order.bonus_manually_adjusted && Number.isFinite(manualOverride)) {
    return manualOverride;
  }
  if ((order.status ?? "New") !== "Delivered") {
    return 0;
  }

  const cfg = productMap.get(order.product_id ?? "") ?? defaultBonusConfig();
  const qty = quantityForOrder(order);
  const isManualSourced = order.source === "WhatsApp";

  let base = 0;
  if (isManualSourced) {
    const manualRule = cfg.manualOrderBonuses.find((rule) => rule.quantity === qty)
      ?? cfg.manualOrderBonuses.slice().sort((a, b) => Math.abs(a.quantity - qty) - Math.abs(b.quantity - qty))[0];
    base = Number(manualRule?.amount ?? 0);
  } else {
    const baseRule = cfg.baseDelivered.find((rule) => rule.quantity === qty)
      ?? cfg.baseDelivered.slice().sort((a, b) => Math.abs(a.quantity - qty) - Math.abs(b.quantity - qty))[0];
    base = Number(baseRule?.amount ?? 0);
  }

  let upgrade = 0;
  if (
    typeof order.upsell_from_qty === "number"
    && typeof order.upsell_to_qty === "number"
    && order.upsell_to_qty > order.upsell_from_qty
  ) {
    const rule = cfg.upgradeBonuses.find((entry) => entry.fromQty === order.upsell_from_qty && entry.toQty === order.upsell_to_qty);
    const full = Number(rule?.amount ?? 0);
    if (full > 0) {
      const meetsGate = repWeeklyDeliveryRate >= cfg.upgradeRequiresMinDeliveryRate;
      upgrade = meetsGate ? full : Math.round(full / 2);
    }
  }

  const crossSell = Math.round(normalizedLineTotal(order.cross_sell_lines) * (cfg.crossSellPercent / 100))
    + (cfg.crossSellFixed * normalizedLineCount(order.cross_sell_lines));

  const freeGift = cfg.freeGiftBonus * normalizedLineCount(order.free_gift_lines);

  if (repWeeklyOrderCount >= cfg.deliveryRateMinOrders && repWeeklyDeliveryRate < cfg.poorDeliveryRatePercent) {
    return base;
  }

  void repWeeklyAov;
  return base + upgrade + crossSell + freeGift;
};

export const calculatePayrollPreview = async (orgId: string, period: string): Promise<PayrollPreview> => {
  const bounds = parsePayrollPeriod(period);
  if (!bounds) {
    throw new Error(`Invalid period format. Use "Month Year", e.g. "May 2026".`);
  }

  const [
    usersResult,
    structuresResult,
    productsResult,
    orgResult,
    deliveredOrdersResult,
    deliveredFallbackOrdersResult,
    pendingOrdersResult,
    penaltiesResult
  ] = await Promise.all([
    supabase.from("users").select("id, name, role").eq("org_id", orgId).eq("active", true),
    supabase.from("pay_structures").select("*").eq("org_id", orgId),
    supabase.from("products").select("id, bonus_config").eq("org_id", orgId),
    supabase.from("organizations").select("top_performer_bonus_enabled, top_performer_bonus_amount").eq("id", orgId).maybeSingle(),
    supabase
      .from("orders")
      .select("id, assigned_rep_id, status, amount, product_id, quantity, source, upsell_from_qty, upsell_to_qty, manual_bonus_override, bonus_manually_adjusted, cross_sell_lines, free_gift_lines, delivered_date, created_at, date")
      .eq("org_id", orgId)
      .eq("status", "Delivered")
      .gte("delivered_date", bounds.periodStartDate)
      .lt("delivered_date", bounds.periodEndDate),
    supabase
      .from("orders")
      .select("id, assigned_rep_id, status, amount, product_id, quantity, source, upsell_from_qty, upsell_to_qty, manual_bonus_override, bonus_manually_adjusted, cross_sell_lines, free_gift_lines, delivered_date, created_at, date")
      .eq("org_id", orgId)
      .eq("status", "Delivered")
      .is("delivered_date", null)
      .gte("created_at", bounds.periodStartTs)
      .lt("created_at", bounds.periodEndTs),
    supabase
      .from("orders")
      .select("id, assigned_rep_id, status, amount, product_id, quantity, source, upsell_from_qty, upsell_to_qty, manual_bonus_override, bonus_manually_adjusted, cross_sell_lines, free_gift_lines, delivered_date, created_at, date")
      .eq("org_id", orgId)
      .neq("status", "Delivered")
      .gte("created_at", bounds.periodStartTs)
      .lt("created_at", bounds.periodEndTs),
    supabase.from("rep_penalties").select("rep_id, amount").eq("org_id", orgId).eq("period", period)
  ]);

  const settled = [usersResult, structuresResult, productsResult, orgResult, deliveredOrdersResult, deliveredFallbackOrdersResult, pendingOrdersResult, penaltiesResult];
  const firstError = settled.find((result) => result.error);
  if (firstError?.error) {
    throw new Error(firstError.error.message);
  }

  const users = (usersResult.data ?? []) as PayrollUser[];
  const structures = (structuresResult.data ?? []) as PayStructure[];
  const products = (productsResult.data ?? []) as ProductRecord[];
  const org = orgResult.data as { top_performer_bonus_enabled?: boolean | null; top_performer_bonus_amount?: number | null } | null;
  const penalties = (penaltiesResult.data ?? []) as PayrollPenalty[];

  const deliveredOrders = new Map<string, PayrollOrder>();
  for (const order of [...(deliveredOrdersResult.data ?? []), ...(deliveredFallbackOrdersResult.data ?? [])] as PayrollOrder[]) {
    deliveredOrders.set(order.id, order);
  }
  const payrollMonthDelivered = Array.from(deliveredOrders.values());
  const pendingOrders = (pendingOrdersResult.data ?? []) as PayrollOrder[];

  const productMap = new Map<string, Required<ProductBonusConfig>>();
  for (const product of products) {
    productMap.set(product.id, {
      ...defaultBonusConfig(),
      ...(product.bonus_config ?? {})
    });
  }

  const repWeeklyStats = new Map<string, Map<string, { delivered: number; total: number; revenue: number }>>();
  const upsertWeekStat = (repId: string, weekKey: string, patch: Partial<{ delivered: number; total: number; revenue: number }>) => {
    const rep = repWeeklyStats.get(repId) ?? new Map<string, { delivered: number; total: number; revenue: number }>();
    const current = rep.get(weekKey) ?? { delivered: 0, total: 0, revenue: 0 };
    current.delivered += patch.delivered ?? 0;
    current.total += patch.total ?? 0;
    current.revenue += patch.revenue ?? 0;
    rep.set(weekKey, current);
    repWeeklyStats.set(repId, rep);
  };

  for (const order of payrollMonthDelivered) {
    const repId = order.assigned_rep_id;
    const weekKey = weekKeyForDateKey(orderDeliveredKey(order) || orderCreatedKey(order));
    if (!repId || !weekKey) continue;
    upsertWeekStat(repId, weekKey, {
      delivered: 1,
      total: 1,
      revenue: Number(order.amount ?? 0)
    });
  }

  for (const order of pendingOrders) {
    const repId = order.assigned_rep_id;
    const weekKey = weekKeyForDateKey(orderCreatedKey(order));
    if (!repId || !weekKey) continue;
    upsertWeekStat(repId, weekKey, { total: 1 });
  }

  const computeRepAutoBonus = (repId: string) => {
    const orders = payrollMonthDelivered.filter((order) => order.assigned_rep_id === repId);
    if (orders.length === 0) {
      return 0;
    }

    let perOrder = 0;
    for (const order of orders) {
      const weekKey = weekKeyForDateKey(orderDeliveredKey(order) || orderCreatedKey(order));
      const stats = repWeeklyStats.get(repId)?.get(weekKey);
      const rate = stats && stats.total > 0 ? (stats.delivered / stats.total) * 100 : 100;
      const aov = stats && stats.delivered > 0 ? stats.revenue / stats.delivered : 0;
      const count = stats?.total ?? orders.length;
      perOrder += computeOrderBonus(order, productMap, rate, aov, count);
    }

    let weeklyTiers = 0;
    const weeks = repWeeklyStats.get(repId);
    if (weeks) {
      const repProducts = new Set(orders.map((order) => order.product_id).filter((value): value is string => !!value));
      weeks.forEach((weekStats) => {
        if (weekStats.total === 0) return;
        const rate = (weekStats.delivered / weekStats.total) * 100;
        const aov = weekStats.delivered > 0 ? weekStats.revenue / weekStats.delivered : 0;
        repProducts.forEach((productId) => {
          const cfg = productMap.get(productId) ?? defaultBonusConfig();
          if (weekStats.total >= cfg.deliveryRateMinOrders && rate >= cfg.poorDeliveryRatePercent) {
            const deliveryRateTier = cfg.deliveryRateBonuses
              .filter((rule) => rate >= rule.ratePercent)
              .sort((a, b) => b.ratePercent - a.ratePercent)[0];
            if (deliveryRateTier) weeklyTiers += Number(deliveryRateTier.amount ?? 0);
          }
          if (rate >= cfg.aovRequiresMinDeliveryRate) {
            const aovTier = cfg.aovBonuses
              .filter((rule) => aov >= rule.threshold)
              .sort((a, b) => b.threshold - a.threshold)[0];
            if (aovTier) weeklyTiers += Number(aovTier.amount ?? 0);
          }
        });
      });
    }

    return perOrder + weeklyTiers;
  };

  const rows: PayrollEntry[] = users
    .map((user) => {
      const structure = structures.find((entry) => entry.user_id === user.id);
      if (!structure) return null;

      const delivered = payrollMonthDelivered.filter((order) => order.assigned_rep_id === user.id).length;
      const fixedSalary = structure.type === "Per Delivered Order" ? 0 : Number(structure.fixed_salary ?? 0);
      const commissionRate = Number(structure.commission_pct ?? 0);
      const commission = (structure.type === "Per Delivered Order" || structure.type === "Hybrid")
        ? commissionRate * delivered
        : 0;
      const tierBonus = structure.type === "Performance Bonus" && Array.isArray(structure.bonus_tiers)
        ? (structure.bonus_tiers
          .filter((tier) => delivered >= Number(tier.threshold ?? 0))
          .sort((a, b) => Number(b.threshold ?? 0) - Number(a.threshold ?? 0))[0]?.amount ?? 0)
        : 0;
      const autoBonus = (user.role === "Sales Rep" ? computeRepAutoBonus(user.id) : 0) + Number(tierBonus ?? 0);
      const deductions = penalties
        .filter((penalty) => penalty.rep_id === user.id)
        .reduce((sum, penalty) => sum + Number(penalty.amount ?? 0), 0);
      const total = Math.max(0, fixedSalary + commission + autoBonus - deductions);
      return {
        userId: user.id,
        name: user.name,
        delivered,
        fixedSalary,
        commission,
        autoBonus,
        deductions,
        total
      };
    })
    .filter((entry): entry is PayrollEntry => !!entry);

  let topPerformer: PayrollTopPerformer | undefined;
  const topPerformerBonusEnabled = !!org?.top_performer_bonus_enabled;
  const topPerformerBonusAmount = Math.max(0, Number(org?.top_performer_bonus_amount ?? 0));
  if (topPerformerBonusEnabled && topPerformerBonusAmount > 0) {
    const salesRepRows = rows.filter((row) => users.find((user) => user.id === row.userId)?.role === "Sales Rep");
    if (salesRepRows.length > 0) {
      const maxDelivered = Math.max(...salesRepRows.map((row) => row.delivered));
      if (maxDelivered > 0) {
        const winners = salesRepRows.filter((row) => row.delivered === maxDelivered);
        const amountEach = Math.round(topPerformerBonusAmount / winners.length);
        winners.forEach((winner) => {
          winner.autoBonus += amountEach;
          winner.total += amountEach;
        });
        topPerformer = {
          names: winners.map((winner) => winner.name),
          amountEach,
          delivered: maxDelivered
        };
      }
    }
  }

  return {
    period,
    rows,
    total: rows.reduce((sum, row) => sum + row.total, 0),
    topPerformer
  };
};
