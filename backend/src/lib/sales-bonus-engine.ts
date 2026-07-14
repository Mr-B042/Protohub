import { supabase } from "./supabase.js";
import { salesExpansionComplianceForRepWeek, type SalesExpansionCompliance } from "./sales-expansion.js";

export type SalesBonusRuleType =
  | "upgrade_count"
  | "cross_sell_count"
  | "upfront_percent"
  | "delivery_rate_per_delivered"
  | "cross_sell_offer";

export type SalesBonusProgramStatus = "draft" | "active" | "paused" | "deleted";
export type SalesBonusRuleStatus = "active" | "paused" | "deleted";

export type SalesBonusProgram = {
  id: string;
  org_id: string;
  name: string;
  description?: string | null;
  status: SalesBonusProgramStatus;
  recurrence?: "weekly" | null;
  timezone?: string | null;
  week_start_day?: number | null;
  starts_on?: string | null;
  ends_on?: string | null;
  applies_to_user_ids?: string[] | null;
  created_by?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  deleted_at?: string | null;
};

export type SalesBonusRule = {
  id: string;
  org_id: string;
  program_id: string;
  name: string;
  type: SalesBonusRuleType;
  status: SalesBonusRuleStatus;
  config?: Record<string, unknown> | null;
  display_order?: number | null;
  created_at?: string | null;
  updated_at?: string | null;
  deleted_at?: string | null;
};

export type SalesBonusRep = {
  id: string;
  name: string;
  email?: string | null;
  role?: string | null;
  active?: boolean | null;
};

export type SalesBonusOrder = {
  id: string;
  assigned_rep_id?: string | null;
  customer?: string | null;
  phone?: string | null;
  status?: string | null;
  amount?: number | null;
  quantity?: number | null;
  product_id?: string | null;
  product_name?: string | null;
  package_id?: string | null;
  package_name?: string | null;
  source?: string | null;
  embed_label?: string | null;
  upsell_from_qty?: number | null;
  upsell_to_qty?: number | null;
  manual_bonus_override?: number | null;
  bonus_manually_adjusted?: boolean | null;
  cross_sell_lines?: unknown;
  full_upfront_paid?: boolean | null;
  full_upfront_paid_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  delivered_date?: string | null;
  review_hold?: boolean | null;
};

export type SalesBonusRuleProgress = {
  ruleId: string;
  programId: string;
  name: string;
  type: SalesBonusRuleType;
  status: SalesBonusRuleStatus;
  programStatus: SalesBonusProgramStatus;
  active: boolean;
  earnedAmount: number;
  earnedAmountBeforeCompliance?: number;
  complianceReductionAmount?: number;
  potentialAmount: number;
  remainingPotential: number;
  progressCurrent: number;
  progressTarget: number;
  progressPercent: number;
  completed: boolean;
  helper: string;
  scopeLabel: string;
  qualifiedOrderIds: string[];
  config: Record<string, unknown>;
};

export type SalesBonusOrderOpportunity = {
  orderId: string;
  customerName?: string;
  packageName?: string;
  productName?: string;
  scopeLabel?: string;
  amount: number;
  reason: string;
  type: "upgrade" | "cross_sell" | "delivery_rate" | "upfront";
};

export type SalesBonusRepProgress = {
  repId: string;
  repName: string;
  weekStart: string;
  weekEnd: string;
  assignedCount: number;
  deliveredCount: number;
  deliveredRevenue: number;
  deliveryRate: number;
  totalAvailable: number;
  earnedSoFar: number;
  pendingPotential: number;
  lockedAmount: number;
  manualAdjustments: number;
  rules: SalesBonusRuleProgress[];
  opportunities: SalesBonusOrderOpportunity[];
  salesExpansionCompliance?: SalesExpansionCompliance;
  performanceBonusBeforeCompliance?: number;
  complianceReductionAmount?: number;
};

export type SalesBonusProgressResponse = {
  weekStart: string;
  weekEnd: string;
  generatedAt: string;
  programs: Array<SalesBonusProgram & { rules: SalesBonusRule[] }>;
  reps: SalesBonusRepProgress[];
  totals: {
    totalAvailable: number;
    earnedSoFar: number;
    pendingPotential: number;
    lockedAmount: number;
  };
};

export type SalesBonusPayrollRow = {
  repId: string;
  autoBonus: number;
  bonusBreakdown: {
    weeks: Array<{
      weekStart: string;
      weekEnd: string;
      earnedSoFar: number;
      manualAdjustments: number;
      rules: SalesBonusRuleProgress[];
      salesExpansionCompliance?: SalesExpansionCompliance;
      performanceBonusBeforeCompliance?: number;
      complianceReductionAmount?: number;
    }>;
    totalProgramBonus: number;
    manualAdjustments: number;
  };
};

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;
const TERMINAL_LOST_STATUSES = new Set(["Cancelled", "Failed", "Rejected"]);
export const SALES_BONUS_LAUNCH_WEEK_START = "2026-07-05";

export const addDaysToDateKey = (dateKey: string, days: number) => {
  const date = new Date(`${dateKey}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

export const weekEndFromStart = (weekStart: string) => addDaysToDateKey(weekStart, 6);
export const nextWeekStart = (weekStart: string) => addDaysToDateKey(weekStart, 7);

export const lagosDateKey = (value: Date | string = new Date()) => {
  const date = typeof value === "string" ? new Date(value) : value;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Lagos",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const lookup = new Map(parts.map((part) => [part.type, part.value]));
  return `${lookup.get("year")}-${lookup.get("month")}-${lookup.get("day")}`;
};

export const sundayWeekStartForDateKey = (dateKey: string) => {
  if (!DATE_KEY_PATTERN.test(dateKey)) return "";
  const date = new Date(`${dateKey}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - date.getUTCDay());
  return date.toISOString().slice(0, 10);
};

export const currentSalesBonusWeekStart = () => {
  const current = sundayWeekStartForDateKey(lagosDateKey());
  return current && current < SALES_BONUS_LAUNCH_WEEK_START ? SALES_BONUS_LAUNCH_WEEK_START : current;
};

const toNumber = (value: unknown, fallback = 0) => {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const positiveAmount = (value: unknown) => Math.max(0, Math.round(toNumber(value)));
const clampPercent = (value: number) => Math.max(0, Math.min(100, Math.round(value)));

const asConfig = (rule: SalesBonusRule) =>
  rule.config && typeof rule.config === "object" && !Array.isArray(rule.config)
    ? rule.config as Record<string, unknown>
    : {};

const arrayValue = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const stringArrayValue = (value: unknown): string[] =>
  Array.isArray(value) ? value.map((item) => String(item ?? "").trim()).filter(Boolean) : [];

const cleanText = (value: unknown) => String(value ?? "").trim();
const normalizeText = (value: unknown) => cleanText(value).toLowerCase();

const configStringValues = (config: Record<string, unknown>, keys: string[]) => {
  const values: string[] = [];
  for (const key of keys) {
    const value = config[key];
    if (Array.isArray(value)) values.push(...stringArrayValue(value));
    else {
      const text = cleanText(value);
      if (text) values.push(text);
    }
  }
  return Array.from(new Set(values));
};

const textMatchesAny = (value: unknown, allowed: string[]) => {
  if (allowed.length === 0) return true;
  const normalizedValue = normalizeText(value);
  if (!normalizedValue) return false;
  return allowed.some((candidate) => {
    const normalizedCandidate = normalizeText(candidate);
    return normalizedCandidate
      && (
        normalizedValue === normalizedCandidate
        || normalizedValue.includes(normalizedCandidate)
        || normalizedCandidate.includes(normalizedValue)
      );
  });
};

const scopedDimensionMatches = (
  idValue: unknown,
  nameValue: unknown,
  ids: string[],
  names: string[]
) => {
  if (ids.length === 0 && names.length === 0) return true;
  const idMatch = ids.length > 0 && textMatchesAny(idValue, ids);
  const nameMatch = names.length > 0 && textMatchesAny(nameValue, names);
  return idMatch || nameMatch;
};

const ruleScope = (config: Record<string, unknown>) => ({
  productIds: configStringValues(config, ["scopeProductId", "scopeProductIds", "productId", "productIds"]),
  packageIds: configStringValues(config, ["scopePackageId", "scopePackageIds", "packageId", "packageIds"]),
  productNames: configStringValues(config, ["scopeProductName", "scopeProductNames", "productName", "productNames"]),
  packageNames: configStringValues(config, ["scopePackageName", "scopePackageNames", "packageName", "packageNames"]),
  embedLabels: configStringValues(config, ["scopeEmbedLabel", "scopeEmbedLabels", "embedLabel", "embedLabels"])
});

const ruleScopeLabel = (config: Record<string, unknown>) => {
  const scope = ruleScope(config);
  const product = cleanText(config.scopeProductName)
    || cleanText(config.productName)
    || (scope.productIds.length === 1 ? `Product ${scope.productIds[0]}` : "");
  const pkg = cleanText(config.scopePackageName)
    || cleanText(config.packageName)
    || (scope.packageIds.length === 1 ? `Package ${scope.packageIds[0]}` : "");
  const embed = scope.embedLabels.length === 1 ? scope.embedLabels[0] : "";
  if (!product && !pkg && !embed) return "All products / generated links";
  return [
    product ? `Product: ${product}` : "",
    pkg ? `Package: ${pkg}` : "",
    embed ? `Embed: ${embed}` : ""
  ].filter(Boolean).join(" · ");
};

const orderMatchesRuleScope = (order: SalesBonusOrder, config: Record<string, unknown>) => {
  const scope = ruleScope(config);
  return scopedDimensionMatches(order.product_id, order.product_name, scope.productIds, scope.productNames)
    && scopedDimensionMatches(order.package_id, order.package_name, scope.packageIds, scope.packageNames)
    && textMatchesAny(order.embed_label, scope.embedLabels);
};

const crossSellLineMatchesRuleScope = (line: unknown, config: Record<string, unknown>) => {
  if (!line || typeof line !== "object") return false;
  const record = line as Record<string, unknown>;
  const scope = ruleScope(config);
  const hasProductScope = scope.productIds.length > 0 || scope.productNames.length > 0;
  const hasPackageScope = scope.packageIds.length > 0 || scope.packageNames.length > 0;
  if (!hasProductScope && !hasPackageScope) return true;
  const productId = record.productId ?? record.product_id ?? record.companionProductId ?? record.companion_product_id;
  const packageId = record.packageId ?? record.package_id ?? record.companionPackageId ?? record.companion_package_id;
  const productName = record.productName ?? record.product_name ?? record.name ?? record.label;
  const packageName = record.packageName ?? record.package_name ?? record.packageLabel ?? record.package_label;
  return scopedDimensionMatches(productId, productName, scope.productIds, scope.productNames)
    && scopedDimensionMatches(packageId, packageName, scope.packageIds, scope.packageNames);
};

const selectionSource = (line: unknown) => {
  if (!line || typeof line !== "object") return "";
  const record = line as Record<string, unknown>;
  const raw = record.selectionSource ?? record.selection_source;
  return typeof raw === "string" ? raw : "";
};

const isRepDrivenCrossSellLine = (line: unknown) => {
  const source = selectionSource(line);
  return source !== "public_form" && source !== "public_upsell" && source !== "auto_include";
};

const quantityForOrder = (order: SalesBonusOrder) => {
  const qty = Math.round(toNumber(order.quantity, 1));
  return qty > 0 ? qty : 1;
};

const orderAmount = (order: SalesBonusOrder) => positiveAmount(order.amount);

const isDelivered = (order: SalesBonusOrder) => (order.status ?? "") === "Delivered";
const isOpenOrder = (order: SalesBonusOrder) =>
  !isDelivered(order) && !TERMINAL_LOST_STATUSES.has(order.status ?? "") && order.review_hold !== true;

const appliesToRep = (program: SalesBonusProgram, repId: string) => {
  const ids = Array.isArray(program.applies_to_user_ids) ? program.applies_to_user_ids : [];
  return ids.length === 0 || ids.includes(repId);
};

const programCoversWeek = (program: SalesBonusProgram, weekStart: string) => {
  if (weekStart < SALES_BONUS_LAUNCH_WEEK_START) return false;
  const start = program.starts_on ?? "";
  const end = program.ends_on ?? "";
  if (start && weekStart < start) return false;
  if (end && weekStart > end) return false;
  return true;
};

const ruleIsActiveForRep = (
  program: SalesBonusProgram,
  rule: SalesBonusRule,
  repId: string,
  weekStart: string
) =>
  program.status === "active"
  && rule.status === "active"
  && appliesToRep(program, repId)
  && programCoversWeek(program, weekStart);

const progress = (current: number, target: number) => {
  if (!(target > 0)) return current > 0 ? 100 : 0;
  return clampPercent((current / target) * 100);
};

const countEarnedForTarget = (
  current: number,
  target: number,
  amount: number,
  repeatMode: unknown
) => {
  if (!(target > 0) || !(amount > 0) || current < target) return 0;
  if (repeatMode === "every_target_count") return Math.floor(current / target) * amount;
  return amount;
};

export const computeSalesBonusForRep = (input: {
  rep: SalesBonusRep;
  weekStart: string;
  programs: SalesBonusProgram[];
  rules: SalesBonusRule[];
  orders: SalesBonusOrder[];
}): SalesBonusRepProgress => {
  const weekEnd = weekEndFromStart(input.weekStart);
  const repOrders = input.orders.filter((order) => order.assigned_rep_id === input.rep.id && order.review_hold !== true);
  const deliveredOrders = repOrders.filter(isDelivered);
  const openOrders = repOrders.filter(isOpenOrder);
  const deliveredRevenue = deliveredOrders.reduce((sum, order) => sum + orderAmount(order), 0);
  const assignedCount = repOrders.length;
  const deliveredCount = deliveredOrders.length;
  const deliveryRate = assignedCount > 0 ? Math.round((deliveredCount / assignedCount) * 100) : 0;

  const rules: SalesBonusRuleProgress[] = [];

  for (const rule of input.rules.slice().sort((a, b) => toNumber(a.display_order) - toNumber(b.display_order))) {
    const program = input.programs.find((candidate) => candidate.id === rule.program_id);
    if (!program || program.status === "deleted" || rule.status === "deleted") continue;

    const cfg = asConfig(rule);
    const active = ruleIsActiveForRep(program, rule, input.rep.id, input.weekStart);
    let earnedAmount = 0;
    let potentialAmount = 0;
    let progressCurrent = 0;
    let progressTarget = 1;
    let completed = false;
    let helper = "";
    const scopeLabel = ruleScopeLabel(cfg);
    const scopedRepOrders = repOrders.filter((order) => orderMatchesRuleScope(order, cfg));
    const scopedDeliveredOrders = scopedRepOrders.filter(isDelivered);
    const scopedAssignedCount = scopedRepOrders.length;
    const scopedDeliveredCount = scopedDeliveredOrders.length;
    const scopedDeliveryRate = scopedAssignedCount > 0 ? Math.round((scopedDeliveredCount / scopedAssignedCount) * 100) : 0;
    let qualifiedOrderIds: string[] = [];

    if (rule.type === "upgrade_count") {
      const fromQty = Math.max(1, Math.round(toNumber(cfg.fromQty, 3)));
      const toQtyMin = Math.max(fromQty + 1, Math.round(toNumber(cfg.toQtyMin ?? cfg.toQty, fromQty + 1)));
      const targetCount = Math.max(1, Math.round(toNumber(cfg.targetCount, 1)));
      const amount = positiveAmount(cfg.amount);
      const qualifying = scopedDeliveredOrders.filter((order) => {
        const from = typeof order.upsell_from_qty === "number" ? order.upsell_from_qty : null;
        const to = typeof order.upsell_to_qty === "number" ? order.upsell_to_qty : null;
        return from === fromQty && to !== null && to >= toQtyMin;
      });
      progressCurrent = qualifying.length;
      progressTarget = targetCount;
      qualifiedOrderIds = qualifying.map((order) => order.id);
      completed = qualifying.length >= targetCount;
      earnedAmount = active ? countEarnedForTarget(qualifying.length, targetCount, amount, cfg.repeatMode) : 0;
      potentialAmount = amount;
      helper = `${qualifying.length} / ${targetCount} scoped upgrades from ${fromQty}pcs to ${toQtyMin}+pcs`;
    } else if (rule.type === "cross_sell_count") {
      const targetCount = Math.max(1, Math.round(toNumber(cfg.targetCount, 1)));
      const amount = positiveAmount(cfg.amount);
      const repDrivenOnly = cfg.repDrivenOnly !== false;
      const embedScoped = ruleScope(cfg).embedLabels.length > 0;
      const qualifying = deliveredOrders.filter((order) => {
        const lines = arrayValue(order.cross_sell_lines);
        const baseOrderMatches = orderMatchesRuleScope(order, cfg);
        const scopedLines = lines.filter((line) => crossSellLineMatchesRuleScope(line, cfg));
        const lineMatches = scopedLines.length > 0;
        const scopeMatches = baseOrderMatches || (!embedScoped && lineMatches);
        if (!scopeMatches) return false;
        const linesToCheck = baseOrderMatches ? lines : scopedLines;
        return repDrivenOnly
          ? linesToCheck.some(isRepDrivenCrossSellLine)
          : linesToCheck.length > 0;
      });
      progressCurrent = qualifying.length;
      progressTarget = targetCount;
      qualifiedOrderIds = qualifying.map((order) => order.id);
      completed = qualifying.length >= targetCount;
      earnedAmount = active ? countEarnedForTarget(qualifying.length, targetCount, amount, cfg.repeatMode) : 0;
      potentialAmount = amount;
      helper = `${qualifying.length} / ${targetCount} scoped delivered cross-sell customers`;
    } else if (rule.type === "cross_sell_offer") {
      // Bonuses a SPECIFIC pre-vetted cross-sell deal (product/package scope +
      // minimum quantity + minimum price), not just "any cross-sell happened"
      // like cross_sell_count. Scope names the companion/cross-sell product
      // itself, so this checks line-level scope directly rather than falling
      // back to the order's own product (unlike cross_sell_count's dual
      // fallback) — an Edge Brusher order cross-selling a Shark Soap Holder
      // should match on the soap holder, not on Edge Brusher.
      const offerQty = Math.max(1, Math.round(toNumber(cfg.offerQty, 1)));
      const offerAmount = positiveAmount(cfg.offerAmount);
      const targetCount = Math.max(1, Math.round(toNumber(cfg.targetCount, 1)));
      const amount = positiveAmount(cfg.amount);
      const repDrivenOnly = cfg.repDrivenOnly !== false;
      const scope = ruleScope(cfg);
      const lineMeetsOffer = (line: unknown) => {
        if (!crossSellLineMatchesRuleScope(line, cfg)) return false;
        const record = (line && typeof line === "object") ? line as Record<string, unknown> : {};
        const qty = Math.round(toNumber(record.quantity, 1));
        const lineAmount = positiveAmount(record.amount);
        if (qty < offerQty || lineAmount < offerAmount) return false;
        return repDrivenOnly ? isRepDrivenCrossSellLine(line) : true;
      };
      const qualifying = deliveredOrders.filter((order) => {
        if (scope.embedLabels.length > 0 && !textMatchesAny(order.embed_label, scope.embedLabels)) return false;
        return arrayValue(order.cross_sell_lines).some(lineMeetsOffer);
      });
      progressCurrent = qualifying.length;
      progressTarget = targetCount;
      qualifiedOrderIds = qualifying.map((order) => order.id);
      completed = qualifying.length >= targetCount;
      earnedAmount = active ? countEarnedForTarget(qualifying.length, targetCount, amount, cfg.repeatMode) : 0;
      potentialAmount = amount;
      const offerProductLabel = cleanText(cfg.scopeProductName) || "scoped";
      helper = `${qualifying.length} / ${targetCount} customers took the ₦${offerAmount.toLocaleString("en-NG")} ${offerQty}pcs ${offerProductLabel} deal`;
    } else if (rule.type === "upfront_percent") {
      const percent = Math.max(0, toNumber(cfg.percent, 0));
      const qualifying = scopedDeliveredOrders.filter((order) => order.full_upfront_paid === true);
      const amount = qualifying.reduce((sum, order) => sum + Math.round(orderAmount(order) * (percent / 100)), 0);
      progressCurrent = qualifying.length;
      progressTarget = Math.max(1, qualifying.length);
      qualifiedOrderIds = qualifying.map((order) => order.id);
      completed = qualifying.length > 0;
      earnedAmount = active ? amount : 0;
      potentialAmount = amount;
      helper = `${percent}% on ${qualifying.length} scoped delivered upfront-paid order${qualifying.length === 1 ? "" : "s"}`;
    } else if (rule.type === "delivery_rate_per_delivered") {
      const minOrders = Math.max(0, Math.round(toNumber(cfg.minOrders, 50)));
      const targetRatePercent = Math.max(0, toNumber(cfg.targetRatePercent, 70));
      const fallbackPerDelivered = positiveAmount(cfg.fallbackPerDelivered ?? 200);
      const qualifiedPerDelivered = positiveAmount(cfg.qualifiedPerDelivered ?? 400);
      const qualified = scopedAssignedCount >= minOrders && scopedDeliveryRate >= targetRatePercent;
      const rate = qualified ? qualifiedPerDelivered : fallbackPerDelivered;
      progressCurrent = scopedDeliveryRate;
      progressTarget = targetRatePercent;
      qualifiedOrderIds = scopedDeliveredOrders.map((order) => order.id);
      completed = qualified;
      earnedAmount = active ? scopedDeliveredCount * rate : 0;
      potentialAmount = scopedDeliveredCount * qualifiedPerDelivered;
      helper = qualified
        ? `${scopedDeliveryRate}% scoped delivery rate unlocked ₦${qualifiedPerDelivered.toLocaleString("en-NG")} per delivered order`
        : `${scopedDeliveryRate}% / ${targetRatePercent}% scoped delivery rate · ${scopedAssignedCount} / ${minOrders} assigned orders`;
    }

    const safePotential = Math.max(earnedAmount, potentialAmount);
    rules.push({
      ruleId: rule.id,
      programId: program.id,
      name: rule.name,
      type: rule.type,
      status: rule.status,
      programStatus: program.status,
      active,
      earnedAmount,
      potentialAmount: safePotential,
      remainingPotential: Math.max(0, safePotential - earnedAmount),
      progressCurrent,
      progressTarget,
      progressPercent: progress(progressCurrent, progressTarget),
      completed,
      helper,
      scopeLabel,
      qualifiedOrderIds,
      config: cfg
    });
  }

  const manualAdjustments = input.weekStart < SALES_BONUS_LAUNCH_WEEK_START
    ? 0
    : deliveredOrders.reduce((sum, order) => {
      const manual = toNumber(order.manual_bonus_override, 0);
      return order.bonus_manually_adjusted && Number.isFinite(manual) ? sum + Math.round(manual) : sum;
    }, 0);

  const earnedFromRules = rules.reduce((sum, rule) => sum + rule.earnedAmount, 0);
  const potentialFromRules = rules.reduce((sum, rule) => sum + rule.potentialAmount, 0);
  const activeRules = rules.filter((rule) => rule.active);
  const seenOpportunityKeys = new Set<string>();
  const pushOpportunity = (
    entries: SalesBonusOrderOpportunity[],
    key: string,
    opportunity: SalesBonusOrderOpportunity
  ) => {
    if (seenOpportunityKeys.has(key)) return;
    seenOpportunityKeys.add(key);
    entries.push(opportunity);
  };
  const opportunities = activeRules.flatMap((rule): SalesBonusOrderOpportunity[] => {
    const cfg = rule.config ?? {};
    const scopedOpenOrders = openOrders.filter((order) => orderMatchesRuleScope(order, cfg));
    const entries: SalesBonusOrderOpportunity[] = [];
    scopedOpenOrders.forEach((order) => {
      const base = {
        orderId: order.id,
        customerName: order.customer ?? undefined,
        productName: order.product_name ?? undefined,
        packageName: order.package_name ?? undefined,
        amount: 0,
        scopeLabel: rule.scopeLabel
      };
      if (rule.type === "upgrade_count") {
        const fromQty = Math.max(1, Math.round(toNumber(cfg.fromQty, 3)));
        const qty = quantityForOrder(order);
        if (qty <= fromQty) {
          pushOpportunity(entries, `${order.id}:${rule.ruleId}:upgrade`, {
            ...base,
            reason: `Can help "${rule.name}" if moved from ${fromQty}pcs to a higher scoped package and delivered.`,
            type: "upgrade"
          });
        }
      } else if (rule.type === "cross_sell_count") {
        if (arrayValue(order.cross_sell_lines).length === 0) {
          pushOpportunity(entries, `${order.id}:${rule.ruleId}:cross_sell`, {
            ...base,
            reason: `Can help "${rule.name}" if the customer accepts an add-on and the order delivers.`,
            type: "cross_sell"
          });
        }
      } else if (rule.type === "delivery_rate_per_delivered") {
        pushOpportunity(entries, `${order.id}:${rule.ruleId}:delivery_rate`, {
          ...base,
          reason: `A successful delivery improves "${rule.name}" for this scoped product/package.`,
          type: "delivery_rate"
        });
      } else if (rule.type === "upfront_percent" && order.full_upfront_paid !== true) {
        pushOpportunity(entries, `${order.id}:${rule.ruleId}:upfront`, {
          ...base,
          reason: `Can help "${rule.name}" if full upfront payment is owner/admin marked and the order delivers.`,
          type: "upfront"
        });
      }
    });
    return entries;
  }).slice(0, 12);

  return {
    repId: input.rep.id,
    repName: input.rep.name,
    weekStart: input.weekStart,
    weekEnd,
    assignedCount,
    deliveredCount,
    deliveredRevenue,
    deliveryRate,
    totalAvailable: potentialFromRules + manualAdjustments,
    earnedSoFar: earnedFromRules + manualAdjustments,
    pendingPotential: Math.max(0, potentialFromRules - earnedFromRules),
    lockedAmount: earnedFromRules + manualAdjustments,
    manualAdjustments,
    rules,
    opportunities
  };
};

export const buildProgramsWithRules = (programs: SalesBonusProgram[], rules: SalesBonusRule[]) =>
  programs
    .filter((program) => program.status !== "deleted")
    .map((program) => ({
      ...program,
      rules: rules
        .filter((rule) => rule.program_id === program.id && rule.status !== "deleted")
        .sort((a, b) => toNumber(a.display_order) - toNumber(b.display_order))
    }));

export const listSalesBonusPrograms = async (orgId: string, includeDeleted = false) => {
  const [programsResult, rulesResult] = await Promise.all([
    supabase
      .from("sales_bonus_programs")
      .select("*")
      .eq("org_id", orgId)
      .order("created_at", { ascending: false }),
    supabase
      .from("sales_bonus_rules")
      .select("*")
      .eq("org_id", orgId)
      .order("display_order", { ascending: true })
  ]);

  if (programsResult.error) throw new Error(programsResult.error.message);
  if (rulesResult.error) throw new Error(rulesResult.error.message);

  const programs = (programsResult.data ?? []) as SalesBonusProgram[];
  const rules = (rulesResult.data ?? []) as SalesBonusRule[];
  return buildProgramsWithRules(
    includeDeleted ? programs : programs.filter((program) => program.status !== "deleted"),
    includeDeleted ? rules : rules.filter((rule) => rule.status !== "deleted")
  );
};

const flattenPrograms = (programs: Array<SalesBonusProgram & { rules: SalesBonusRule[] }>) => ({
  programs: programs.map(({ rules: _rules, ...program }) => program),
  rules: programs.flatMap((program) => program.rules)
});

export const getSalesBonusProgress = async (
  orgId: string,
  weekStart: string,
  options: { repId?: string; includeDeleted?: boolean } = {}
): Promise<SalesBonusProgressResponse> => {
  if (!DATE_KEY_PATTERN.test(weekStart)) {
    throw new Error("weekStart must be in YYYY-MM-DD format.");
  }
  const weekEnd = weekEndFromStart(weekStart);
  const nextWeek = nextWeekStart(weekStart);

  const [programs, usersResult, ordersResult] = await Promise.all([
    listSalesBonusPrograms(orgId, options.includeDeleted ?? false),
    supabase
      .from("users")
      .select("id, name, email, role, active")
      .eq("org_id", orgId)
      .eq("role", "Sales Rep")
      .eq("active", true),
    supabase
      .from("orders")
      .select("id, assigned_rep_id, customer, phone, status, amount, quantity, product_id, product_name, package_id, package_name, source, embed_label, upsell_from_qty, upsell_to_qty, manual_bonus_override, bonus_manually_adjusted, cross_sell_lines, full_upfront_paid, full_upfront_paid_at, created_at, updated_at, delivered_date, review_hold")
      .eq("org_id", orgId)
      .gte("created_at", `${weekStart}T00:00:00`)
      .lt("created_at", `${nextWeek}T00:00:00`)
  ]);

  if (usersResult.error) throw new Error(usersResult.error.message);
  if (ordersResult.error) throw new Error(ordersResult.error.message);

  const reps = ((usersResult.data ?? []) as SalesBonusRep[])
    .filter((rep) => !options.repId || rep.id === options.repId);
  const flattened = flattenPrograms(programs);
  const orders = (ordersResult.data ?? []) as SalesBonusOrder[];
  const repProgress = await Promise.all(reps.map(async (rep) => {
    const progress = computeSalesBonusForRep({
      rep,
      weekStart,
      programs: flattened.programs,
      rules: flattened.rules,
      orders
    });
    const compliance = await salesExpansionComplianceForRepWeek(orgId, rep.id, weekStart);
    const performanceBonusBeforeCompliance = progress.earnedSoFar - progress.manualAdjustments;
    const adjustedRules = progress.rules.map((rule) => {
      const earnedAmountBeforeCompliance = rule.earnedAmount;
      if (!rule.active || rule.earnedAmount <= 0 || compliance.bonusMultiplier >= 1) {
        return {
          ...rule,
          earnedAmountBeforeCompliance,
          complianceReductionAmount: 0
        };
      }
      const earnedAmount = Math.round(rule.earnedAmount * compliance.bonusMultiplier);
      return {
        ...rule,
        earnedAmount,
        earnedAmountBeforeCompliance,
        complianceReductionAmount: Math.max(0, earnedAmountBeforeCompliance - earnedAmount),
        remainingPotential: Math.max(0, rule.potentialAmount - earnedAmount),
        helper: `${rule.helper} Sales-log compliance applied: ${compliance.compliancePct}% (${compliance.reductionPct}% performance-bonus reduction).`
      };
    });
    const adjustedRuleEarnings = adjustedRules.reduce((sum, rule) => sum + rule.earnedAmount, 0);
    const adjustedEarned = adjustedRuleEarnings + progress.manualAdjustments;
    return {
      ...progress,
      rules: adjustedRules,
      earnedSoFar: adjustedEarned,
      lockedAmount: adjustedEarned,
      pendingPotential: Math.max(0, progress.totalAvailable - adjustedEarned),
      salesExpansionCompliance: compliance,
      performanceBonusBeforeCompliance,
      complianceReductionAmount: Math.max(0, performanceBonusBeforeCompliance - adjustedRuleEarnings)
    };
  }));

  const totals = repProgress.reduce((acc, rep) => {
    acc.totalAvailable += rep.totalAvailable;
    acc.earnedSoFar += rep.earnedSoFar;
    acc.pendingPotential += rep.pendingPotential;
    acc.lockedAmount += rep.lockedAmount;
    return acc;
  }, { totalAvailable: 0, earnedSoFar: 0, pendingPotential: 0, lockedAmount: 0 });

  return {
    weekStart,
    weekEnd,
    generatedAt: new Date().toISOString(),
    programs,
    reps: repProgress,
    totals
  };
};

export const salesBonusWeekStartsForPeriod = (periodStartDate: string, periodEndDate: string) => {
  const starts: string[] = [];
  let cursor = sundayWeekStartForDateKey(periodStartDate);
  while (cursor && cursor < periodEndDate) {
    if (cursor >= SALES_BONUS_LAUNCH_WEEK_START) starts.push(cursor);
    cursor = addDaysToDateKey(cursor, 7);
  }
  return Array.from(new Set(starts));
};

// ── Net Profit / break-even integration ────────────────────────────────────
// Every rule already tracks qualifiedOrderIds - the specific delivered orders
// that earned its earnedAmount - so unlike salary (which has no natural
// per-order basis and gets day-smoothed instead), a new-engine bonus CAN be
// attributed back to real orders for P&L purposes. Only ever reads
// rule.earnedAmount/qualifiedOrderIds - NEVER rep.manualAdjustments or
// rep.earnedSoFar as a whole. manual_bonus_override/bonus_manually_adjusted
// are the same order columns the legacy per-order bonus calc already fully
// absorbs for that order; folding the new engine's manual-adjustment reducer
// in here too would double-pay every manually-adjusted order.
export const attributeRuleEarningsToOrders = (
  rule: SalesBonusRuleProgress,
  orderAmountById: Map<string, number>
): Map<string, number> => {
  const result = new Map<string, number>();
  if (!rule.active || rule.earnedAmount <= 0 || rule.qualifiedOrderIds.length === 0) return result;
  if (rule.type === "upfront_percent") {
    // Exact, not an estimate: earnedAmount is already the sum of
    // round(order.amount * percent/100) over these same orders.
    const percent = Math.max(0, toNumber(rule.config.percent, 0));
    for (const orderId of rule.qualifiedOrderIds) {
      result.set(orderId, Math.round((orderAmountById.get(orderId) ?? 0) * (percent / 100)));
    }
    return result;
  }
  // delivery_rate_per_delivered: every qualifying order earns the identical
  // flat rate, so an even split recovers the exact per-order amount.
  // upgrade_count / cross_sell_count / cross_sell_offer: earnedAmount is a
  // step-function payout (paid once a target count is reached), not
  // naturally per-order - even split here is a documented accrual estimate,
  // attributing the cost across the orders that drove earning it.
  const perOrderShare = rule.earnedAmount / rule.qualifiedOrderIds.length;
  for (const orderId of rule.qualifiedOrderIds) result.set(orderId, perOrderShare);
  return result;
};

export type SalesBonusOrderSettlement = {
  earnedBeforeCompliance: number;
  payable: number;
  complianceReduction: number;
};

export const attributeRuleSettlementToOrders = (
  rule: SalesBonusRuleProgress,
  orderAmountById: Map<string, number>
): Map<string, SalesBonusOrderSettlement> => {
  const payableByOrder = attributeRuleEarningsToOrders(rule, orderAmountById);
  const earnedAmountBeforeCompliance = rule.earnedAmountBeforeCompliance ?? rule.earnedAmount;
  const earnedByOrder = attributeRuleEarningsToOrders(
    earnedAmountBeforeCompliance === rule.earnedAmount
      ? rule
      : { ...rule, earnedAmount: earnedAmountBeforeCompliance },
    orderAmountById
  );
  const orderIds = new Set([...earnedByOrder.keys(), ...payableByOrder.keys()]);
  const result = new Map<string, SalesBonusOrderSettlement>();
  for (const orderId of orderIds) {
    const earnedBeforeCompliance = earnedByOrder.get(orderId) ?? 0;
    const payable = payableByOrder.get(orderId) ?? 0;
    result.set(orderId, {
      earnedBeforeCompliance,
      payable,
      complianceReduction: Math.max(0, earnedBeforeCompliance - payable)
    });
  }
  return result;
};

// Anchors the week search on each delivered order's OWN created_at (the
// engine's actual cohort key) rather than the requested range - an order
// created weeks before the range but delivered inside it still needs its
// creation week queried, or its contribution is silently missed.
export const perOrderBonusSettlementMapForDeliveredRange = async (
  orgId: string,
  deliveredFromDateInclusive: string,
  deliveredToDateInclusive: string,
  options: { repId?: string } = {}
): Promise<Record<string, SalesBonusOrderSettlement>> => {
  const clampedFrom = deliveredFromDateInclusive < SALES_BONUS_LAUNCH_WEEK_START
    ? SALES_BONUS_LAUNCH_WEEK_START
    : deliveredFromDateInclusive;
  const exclusiveTo = addDaysToDateKey(deliveredToDateInclusive, 1);
  if (clampedFrom >= exclusiveTo) return {};

  const { data, error } = await supabase
    .from("orders")
    .select("id, amount, created_at")
    .eq("org_id", orgId)
    .eq("status", "Delivered")
    .gte("delivered_date", clampedFrom)
    .lt("delivered_date", exclusiveTo);
  if (error) throw new Error(error.message);

  const inRangeOrders = (data ?? []) as { id: string; amount: number | null; created_at: string | null }[];
  if (inRangeOrders.length === 0) return {};
  const inRangeIds = new Set(inRangeOrders.map((order) => order.id));
  const orderAmountById = new Map(inRangeOrders.map((order) => [order.id, positiveAmount(order.amount)]));

  const weeks = new Set<string>();
  for (const order of inRangeOrders) {
    if (!order.created_at) continue;
    const weekStart = sundayWeekStartForDateKey(order.created_at.slice(0, 10));
    if (weekStart && weekStart >= SALES_BONUS_LAUNCH_WEEK_START) weeks.add(weekStart);
  }

  const totals = new Map<string, SalesBonusOrderSettlement>();
  for (const weekStart of weeks) {
    // Passing repId here (not just filtering the output afterward) scopes
    // progress.reps to that one rep, so a Sales Rep caller only ever sees
    // their own orders' attribution - never another rep's compensation.
    const progress = await getSalesBonusProgress(orgId, weekStart, options.repId ? { repId: options.repId } : {});
    for (const rep of progress.reps) {
      for (const rule of rep.rules) {
        for (const [orderId, settlement] of attributeRuleSettlementToOrders(rule, orderAmountById)) {
          if (!inRangeIds.has(orderId)) continue;
          const current = totals.get(orderId) ?? { earnedBeforeCompliance: 0, payable: 0, complianceReduction: 0 };
          totals.set(orderId, {
            earnedBeforeCompliance: current.earnedBeforeCompliance + settlement.earnedBeforeCompliance,
            payable: current.payable + settlement.payable,
            complianceReduction: current.complianceReduction + settlement.complianceReduction
          });
        }
      }
    }
  }
  return Object.fromEntries(totals);
};

export const perOrderBonusMapForDeliveredRange = async (
  orgId: string,
  deliveredFromDateInclusive: string,
  deliveredToDateInclusive: string,
  options: { repId?: string } = {}
): Promise<Record<string, number>> => {
  const settlements = await perOrderBonusSettlementMapForDeliveredRange(
    orgId,
    deliveredFromDateInclusive,
    deliveredToDateInclusive,
    options
  );
  return Object.fromEntries(Object.entries(settlements).map(([orderId, settlement]) => [orderId, settlement.payable]));
};

// Itemized, single-order counterpart to perOrderBonusMapForDeliveredRange -
// that function is deliberately a flat sum (it's consumed as a plain number
// in several bulk-total call sites), so a rule-by-rule breakdown for one
// specific order lives here instead of changing that shape.
export type SalesBonusOrderBreakdownItem = {
  ruleName: string;
  ruleType: SalesBonusRuleType;
  amount: number;
  earnedBeforeCompliance: number;
  complianceReduction: number;
};

export const perOrderSalesBonusBreakdown = async (
  orgId: string,
  orderId: string
): Promise<SalesBonusOrderBreakdownItem[]> => {
  const { data: order, error } = await supabase
    .from("orders")
    .select("id, assigned_rep_id, amount, created_at")
    .eq("org_id", orgId)
    .eq("id", orderId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!order?.assigned_rep_id || !order.created_at) return [];

  const weekStart = sundayWeekStartForDateKey(order.created_at.slice(0, 10));
  if (!weekStart || weekStart < SALES_BONUS_LAUNCH_WEEK_START) return [];

  const progress = await getSalesBonusProgress(orgId, weekStart, { repId: order.assigned_rep_id });
  const rep = progress.reps[0];
  if (!rep) return [];

  const orderAmountById = new Map([[order.id, positiveAmount(order.amount)]]);
  const items: SalesBonusOrderBreakdownItem[] = [];
  for (const rule of rep.rules) {
    if (!rule.qualifiedOrderIds.includes(order.id)) continue;
    const settlement = attributeRuleSettlementToOrders(rule, orderAmountById).get(order.id);
    if (settlement && settlement.earnedBeforeCompliance > 0) {
      items.push({
        ruleName: rule.name,
        ruleType: rule.type,
        amount: settlement.payable,
        earnedBeforeCompliance: settlement.earnedBeforeCompliance,
        complianceReduction: settlement.complianceReduction
      });
    }
  }
  return items;
};

export const calculateSalesBonusPayroll = async (
  orgId: string,
  periodBounds: { periodStartDate: string; periodEndDate: string }
) => {
  const rows = new Map<string, SalesBonusPayrollRow>();
  const weekStarts = salesBonusWeekStartsForPeriod(periodBounds.periodStartDate, periodBounds.periodEndDate);

  for (const weekStart of weekStarts) {
    const progress = await getSalesBonusProgress(orgId, weekStart);
    for (const rep of progress.reps) {
      const current = rows.get(rep.repId) ?? {
        repId: rep.repId,
        autoBonus: 0,
        bonusBreakdown: {
          weeks: [],
          totalProgramBonus: 0,
          manualAdjustments: 0
        }
      };
      current.autoBonus += rep.earnedSoFar;
      current.bonusBreakdown.totalProgramBonus += rep.earnedSoFar - rep.manualAdjustments;
      current.bonusBreakdown.manualAdjustments += rep.manualAdjustments;
      current.bonusBreakdown.weeks.push({
        weekStart: rep.weekStart,
        weekEnd: rep.weekEnd,
        earnedSoFar: rep.earnedSoFar,
        manualAdjustments: rep.manualAdjustments,
        rules: rep.rules,
        salesExpansionCompliance: rep.salesExpansionCompliance,
        performanceBonusBeforeCompliance: rep.performanceBonusBeforeCompliance,
        complianceReductionAmount: rep.complianceReductionAmount
      });
      rows.set(rep.repId, current);
    }
  }

  return rows;
};
