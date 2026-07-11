import { Router } from "express";
import { z } from "zod";
import {
  DEFAULT_MANAGER_BONUS_SETTINGS,
  evaluateManagerBonus,
  normalizeManagerBonusSettings,
  type ManagerBonusSettings
} from "../lib/manager-bonus.js";
import { orderInventoryLinesFromRow } from "../lib/order-inventory.js";
import { supabase } from "../lib/supabase.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth, requireRole("Owner", "Admin", "Manager"));

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const QuerySchema = z.object({
  weekStart: z.string().regex(DATE_KEY_PATTERN)
});

const TierSchema = z.object({
  id: z.string().trim().max(80).optional(),
  label: z.string().trim().max(120).optional(),
  minRate: z.coerce.number().min(0).max(100),
  maxRate: z.coerce.number().min(0).max(100).nullable().optional(),
  amount: z.coerce.number().min(0).max(1_000_000_000)
});

const SettingsPatchSchema = z.object({
  title: z.string().trim().min(1).max(160).optional(),
  description: z.string().trim().min(1).max(2000).optional(),
  profitGateAmount: z.coerce.number().min(0).max(1_000_000_000).optional(),
  supportBonusAmount: z.coerce.number().min(0).max(1_000_000_000).optional(),
  belowTierAmount: z.coerce.number().min(0).max(1_000_000_000).optional(),
  currency: z.enum(["NGN", "USD", "GBP"]).optional(),
  gateMissMessage: z.string().trim().min(1).max(500).optional(),
  gateMetMessage: z.string().trim().min(1).max(500).optional(),
  belowTierMessage: z.string().trim().min(1).max(500).optional(),
  tiers: z.array(TierSchema).min(1).max(20).optional()
}).strict();

type PricingMap = Map<string, { byCurrency: Map<string, number>; primary: number; hasPrimary: boolean }>;

const addDays = (dateKey: string, days: number) => {
  const date = new Date(`${dateKey}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

const toWatUtcIso = (dateKey: string, time: "start" | "end") =>
  new Date(`${dateKey}T${time === "start" ? "00:00:00.000" : "23:59:59.999"}+01:00`).toISOString();

const numericAmount = (value: unknown) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const settingsFromRow = (row: any): ManagerBonusSettings => normalizeManagerBonusSettings(row ? {
  title: row.title,
  description: row.description,
  profitGateAmount: row.profit_gate_amount,
  supportBonusAmount: row.support_bonus_amount,
  belowTierAmount: row.below_tier_amount,
  currency: row.currency,
  gateMissMessage: row.gate_miss_message,
  gateMetMessage: row.gate_met_message,
  belowTierMessage: row.below_tier_message,
  tiers: row.delivery_rate_tiers
} : DEFAULT_MANAGER_BONUS_SETTINGS);

const settingsToRow = (orgId: string, settings: ManagerBonusSettings, updatedBy: string) => ({
  org_id: orgId,
  title: settings.title,
  description: settings.description,
  profit_gate_amount: settings.profitGateAmount,
  support_bonus_amount: settings.supportBonusAmount,
  below_tier_amount: settings.belowTierAmount,
  currency: settings.currency,
  delivery_rate_tiers: settings.tiers,
  gate_miss_message: settings.gateMissMessage,
  gate_met_message: settings.gateMetMessage,
  below_tier_message: settings.belowTierMessage,
  updated_by: updatedBy,
  updated_at: new Date().toISOString()
});

async function loadSettings(orgId: string): Promise<{ settings: ManagerBonusSettings; isDefault: boolean }> {
  const { data, error } = await supabase
    .from("manager_bonus_settings")
    .select("*")
    .eq("org_id", orgId)
    .maybeSingle();
  if (error) throw error;
  return { settings: settingsFromRow(data), isDefault: !data };
}

async function loadPricingMap(productIds: string[]): Promise<PricingMap> {
  const map: PricingMap = new Map();
  if (productIds.length === 0) return map;
  const { data, error } = await supabase
    .from("product_pricings")
    .select("product_id, currency, unit_cost, is_primary")
    .in("product_id", productIds);
  if (error) throw error;

  for (const row of data ?? []) {
    let entry = map.get(row.product_id);
    if (!entry) {
      entry = { byCurrency: new Map(), primary: 0, hasPrimary: false };
      map.set(row.product_id, entry);
    }
    const cost = numericAmount(row.unit_cost);
    if (row.currency) entry.byCurrency.set(row.currency, cost);
    if (row.is_primary) {
      entry.primary = cost;
      entry.hasPrimary = true;
    }
  }
  return map;
}

const unitCostFor = (pricingMap: PricingMap, productId?: string | null, currency?: string | null) => {
  if (!productId) return 0;
  const entry = pricingMap.get(productId);
  if (!entry) return 0;
  if (currency && entry.byCurrency.has(currency)) return entry.byCurrency.get(currency) ?? 0;
  if (entry.hasPrimary) return entry.primary;
  const first = entry.byCurrency.values().next();
  return first.done ? 0 : first.value;
};

const cogsForOrder = (order: any, pricingMap: PricingMap) =>
  orderInventoryLinesFromRow(order).reduce(
    (sum, line) => sum + line.quantity * unitCostFor(pricingMap, line.productId, order.currency),
    0
  );

router.get("/settings", async (req, res) => {
  try {
    const { settings, isDefault } = await loadSettings(req.user!.orgId);
    res.json({ settings, isDefault, canEdit: req.user!.role === "Owner" });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Could not load manager bonus settings." });
  }
});

router.patch("/settings", requireRole("Owner"), async (req, res) => {
  const parsed = SettingsPatchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }

  try {
    const existing = await loadSettings(req.user!.orgId);
    const patch: Partial<ManagerBonusSettings> = {
      ...parsed.data,
      tiers: parsed.data.tiers?.map((tier, index) => ({
        id: tier.id ?? `tier-${index + 1}`,
        label: tier.label ?? "",
        minRate: tier.minRate,
        maxRate: tier.maxRate ?? null,
        amount: tier.amount
      }))
    };
    const settings = normalizeManagerBonusSettings({ ...existing.settings, ...patch });
    const { data, error } = await supabase
      .from("manager_bonus_settings")
      .upsert(settingsToRow(req.user!.orgId, settings, req.user!.id), { onConflict: "org_id" })
      .select("*")
      .single();
    if (error) throw error;
    res.json({ settings: settingsFromRow(data), isDefault: false, canEdit: true });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Could not save manager bonus settings." });
  }
});

router.get("/summary", async (req, res) => {
  const parsed = QuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }

  const weekStart = parsed.data.weekStart;
  const weekEnd = addDays(weekStart, 6);
  const createdFrom = toWatUtcIso(weekStart, "start");
  const createdTo = toWatUtcIso(weekEnd, "end");

  try {
    const [
      settingsResult,
      cohortOrdersResult,
      deliveredOrdersResult,
      expensesResult
    ] = await Promise.all([
      loadSettings(req.user!.orgId),
      supabase
        .from("orders")
        .select("id, status, amount, quantity, currency, created_at, delivered_date, product_id, product_name, package_components_snapshot, cross_sell_lines, free_gift_lines, logistics_cost, review_hold")
        .eq("org_id", req.user!.orgId)
        .gte("created_at", createdFrom)
        .lte("created_at", createdTo)
        .or("review_hold.is.null,review_hold.eq.false"),
      supabase
        .from("orders")
        .select("id, status, amount, quantity, currency, created_at, delivered_date, product_id, product_name, package_components_snapshot, cross_sell_lines, free_gift_lines, logistics_cost, review_hold")
        .eq("org_id", req.user!.orgId)
        .eq("status", "Delivered")
        .gte("delivered_date", weekStart)
        .lte("delivered_date", weekEnd),
      supabase
        .from("expenses")
        .select("id, date, category, amount, currency")
        .eq("org_id", req.user!.orgId)
        .gte("date", weekStart)
        .lte("date", weekEnd)
    ]);

    if (cohortOrdersResult.error) throw cohortOrdersResult.error;
    if (deliveredOrdersResult.error) throw deliveredOrdersResult.error;
    if (expensesResult.error) throw expensesResult.error;

    const cohortOrders = cohortOrdersResult.data ?? [];
    const deliveredOrders = deliveredOrdersResult.data ?? [];
    const productIds = Array.from(new Set(
      deliveredOrders.flatMap((order) =>
        orderInventoryLinesFromRow(order).map((line) => line.productId)
      ).filter(Boolean)
    ));
    const pricingMap = await loadPricingMap(productIds);

    const deliveredInCohort = cohortOrders.filter((order) => order.status === "Delivered").length;
    const cancelledFailed = cohortOrders.filter((order) => order.status === "Cancelled" || order.status === "Failed").length;
    // Throughput rate, matching the main Dashboard's "Fulfillment Rate" card:
    // delivered-by-delivery-date over orders-created-in-period, not a single
    // cohort's own delivered share. Kept in sync deliberately so the Manager
    // Dashboard's bonus gates never disagree with the number managers already
    // see on the Dashboard.
    const deliveryRate = cohortOrders.length > 0 ? Math.round((deliveredOrders.length / cohortOrders.length) * 1000) / 10 : 0;
    const revenue = deliveredOrders.reduce((sum, order) => sum + numericAmount(order.amount), 0);
    const cogs = deliveredOrders.reduce((sum, order) => sum + cogsForOrder(order, pricingMap), 0);
    const logisticsFromOrders = deliveredOrders.reduce((sum, order) => sum + numericAmount(order.logistics_cost), 0);
    const expenses = expensesResult.data ?? [];
    const recordedDeliveryExpense = expenses
      .filter((expense) => String(expense.category ?? "") === "Delivery")
      .reduce((sum, expense) => sum + numericAmount(expense.amount), 0);
    const recognizedLogistics = logisticsFromOrders > 0 ? logisticsFromOrders : recordedDeliveryExpense;
    const operatingExpenses = expenses
      .filter((expense) => String(expense.category ?? "") !== "Delivery")
      .reduce((sum, expense) => sum + numericAmount(expense.amount), 0);
    const netProfitOps = revenue - cogs - recognizedLogistics - operatingExpenses;
    const evaluation = evaluateManagerBonus(settingsResult.settings, netProfitOps, deliveryRate);

    res.json({
      weekStart,
      weekEnd,
      generatedAt: new Date().toISOString(),
      settings: settingsResult.settings,
      settingsIsDefault: settingsResult.isDefault,
      canEdit: req.user!.role === "Owner",
      evaluation,
      metrics: {
        cohortOrders: cohortOrders.length,
        deliveredInCohort,
        deliveredThisWeek: deliveredOrders.length,
        cancelledFailed,
        deliveryRate,
        revenue,
        cogs,
        logistics: recognizedLogistics,
        operatingExpenses,
        netProfitOps
      }
    });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Could not load manager bonus summary." });
  }
});

export default router;
