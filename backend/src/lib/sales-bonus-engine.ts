import { supabase } from "./supabase.js";

export type SalesBonusRuleType =
  | "upgrade_count"
  | "cross_sell_count"
  | "upfront_percent"
  | "delivery_rate_per_delivered";

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
  potentialAmount: number;
  remainingPotential: number;
  progressCurrent: number;
  progressTarget: number;
  progressPercent: number;
  completed: boolean;
  helper: string;
  qualifiedOrderIds: string[];
  config: Record<string, unknown>;
};

export type SalesBonusOrderOpportunity = {
  orderId: string;
  customerName?: string;
  packageName?: string;
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
    }>;
    totalProgramBonus: number;
    manualAdjustments: number;
  };
};

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;
const TERMINAL_LOST_STATUSES = new Set(["Cancelled", "Failed", "Rejected"]);

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

export const currentSalesBonusWeekStart = () => sundayWeekStartForDateKey(lagosDateKey());

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
    let qualifiedOrderIds: string[] = [];

    if (rule.type === "upgrade_count") {
      const fromQty = Math.max(1, Math.round(toNumber(cfg.fromQty, 3)));
      const toQtyMin = Math.max(fromQty + 1, Math.round(toNumber(cfg.toQtyMin ?? cfg.toQty, fromQty + 1)));
      const targetCount = Math.max(1, Math.round(toNumber(cfg.targetCount, 1)));
      const amount = positiveAmount(cfg.amount);
      const qualifying = deliveredOrders.filter((order) => {
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
      helper = `${qualifying.length} / ${targetCount} upgrades from ${fromQty}pcs to ${toQtyMin}+pcs`;
    } else if (rule.type === "cross_sell_count") {
      const targetCount = Math.max(1, Math.round(toNumber(cfg.targetCount, 1)));
      const amount = positiveAmount(cfg.amount);
      const repDrivenOnly = cfg.repDrivenOnly !== false;
      const qualifying = deliveredOrders.filter((order) => {
        const lines = arrayValue(order.cross_sell_lines);
        return repDrivenOnly
          ? lines.some(isRepDrivenCrossSellLine)
          : lines.length > 0;
      });
      progressCurrent = qualifying.length;
      progressTarget = targetCount;
      qualifiedOrderIds = qualifying.map((order) => order.id);
      completed = qualifying.length >= targetCount;
      earnedAmount = active ? countEarnedForTarget(qualifying.length, targetCount, amount, cfg.repeatMode) : 0;
      potentialAmount = amount;
      helper = `${qualifying.length} / ${targetCount} delivered cross-sell customers`;
    } else if (rule.type === "upfront_percent") {
      const percent = Math.max(0, toNumber(cfg.percent, 0));
      const qualifying = deliveredOrders.filter((order) => order.full_upfront_paid === true);
      const amount = qualifying.reduce((sum, order) => sum + Math.round(orderAmount(order) * (percent / 100)), 0);
      progressCurrent = qualifying.length;
      progressTarget = Math.max(1, qualifying.length);
      qualifiedOrderIds = qualifying.map((order) => order.id);
      completed = qualifying.length > 0;
      earnedAmount = active ? amount : 0;
      potentialAmount = amount;
      helper = `${percent}% on ${qualifying.length} delivered upfront-paid order${qualifying.length === 1 ? "" : "s"}`;
    } else if (rule.type === "delivery_rate_per_delivered") {
      const minOrders = Math.max(0, Math.round(toNumber(cfg.minOrders, 50)));
      const targetRatePercent = Math.max(0, toNumber(cfg.targetRatePercent, 70));
      const fallbackPerDelivered = positiveAmount(cfg.fallbackPerDelivered ?? 200);
      const qualifiedPerDelivered = positiveAmount(cfg.qualifiedPerDelivered ?? 400);
      const qualified = assignedCount >= minOrders && deliveryRate >= targetRatePercent;
      const rate = qualified ? qualifiedPerDelivered : fallbackPerDelivered;
      progressCurrent = deliveryRate;
      progressTarget = targetRatePercent;
      qualifiedOrderIds = deliveredOrders.map((order) => order.id);
      completed = qualified;
      earnedAmount = active ? deliveredCount * rate : 0;
      potentialAmount = deliveredCount * qualifiedPerDelivered;
      helper = qualified
        ? `${deliveryRate}% delivery rate unlocked ₦${qualifiedPerDelivered.toLocaleString("en-NG")} per delivered order`
        : `${deliveryRate}% / ${targetRatePercent}% delivery rate · ${assignedCount} / ${minOrders} assigned orders`;
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
      qualifiedOrderIds,
      config: cfg
    });
  }

  const manualAdjustments = deliveredOrders.reduce((sum, order) => {
    const manual = toNumber(order.manual_bonus_override, 0);
    return order.bonus_manually_adjusted && Number.isFinite(manual) ? sum + Math.round(manual) : sum;
  }, 0);

  const earnedFromRules = rules.reduce((sum, rule) => sum + rule.earnedAmount, 0);
  const potentialFromRules = rules.reduce((sum, rule) => sum + rule.potentialAmount, 0);
  const opportunities = openOrders.flatMap((order): SalesBonusOrderOpportunity[] => {
    const entries: SalesBonusOrderOpportunity[] = [];
    const qty = quantityForOrder(order);
    if (qty <= 3) {
      entries.push({
        orderId: order.id,
        customerName: order.customer ?? undefined,
        packageName: order.package_name ?? undefined,
        amount: 0,
        reason: "Can help upgrade-count bonus if moved from 3pcs to a higher package and delivered.",
        type: "upgrade"
      });
    }
    if (arrayValue(order.cross_sell_lines).length === 0) {
      entries.push({
        orderId: order.id,
        customerName: order.customer ?? undefined,
        packageName: order.package_name ?? undefined,
        amount: 0,
        reason: "Can help cross-sell bonus if the customer accepts an add-on and the order delivers.",
        type: "cross_sell"
      });
    }
    entries.push({
      orderId: order.id,
      customerName: order.customer ?? undefined,
      packageName: order.package_name ?? undefined,
      amount: 0,
      reason: "A successful delivery improves this week’s delivery-rate pay.",
      type: "delivery_rate"
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
      .select("id, assigned_rep_id, customer, phone, status, amount, quantity, product_id, product_name, package_id, package_name, source, upsell_from_qty, upsell_to_qty, manual_bonus_override, bonus_manually_adjusted, cross_sell_lines, full_upfront_paid, full_upfront_paid_at, created_at, updated_at, delivered_date, review_hold")
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
  const repProgress = reps.map((rep) => computeSalesBonusForRep({
    rep,
    weekStart,
    programs: flattened.programs,
    rules: flattened.rules,
    orders
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
    starts.push(cursor);
    cursor = addDaysToDateKey(cursor, 7);
  }
  return Array.from(new Set(starts));
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
        rules: rep.rules
      });
      rows.set(rep.repId, current);
    }
  }

  return rows;
};
