import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { supabase } from "../lib/supabase.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { logger } from "../lib/logger.js";
import { resolveDateBounds } from "../lib/date-bounds.js";
import { orderInventoryLinesFromRow } from "../lib/order-inventory.js";
import { fetchAllRows } from "../lib/paginated-query.js";
import {
  dueStageFor, lifecycleStageFor, scheduledFollowUpFor, priorityBandFor, compareByPriority, dayKey, daysBetween, NEGATIVE_SATISFACTION_OUTCOMES,
  DEFAULT_RETENTION_TIMING, type LifecycleStage, type RetentionTouchpointRecord, type RetentionTiming
} from "../lib/customer-retention-logic.js";

const router = Router();
router.use(requireAuth);

const RETENTION_ROLES = ["Owner", "Admin", "Manager", "Recovery Rep"] as const;
const RETENTION_SUPERVISOR_ROLES = new Set(["Owner", "Admin", "Manager"]);
const NON_REACH_STATUSES = new Set(["not_reached", "not_reachable", "wrong_number"]);
const ACTION_EVENTS_TABLE = "customer_retention_action_events";
const MANUAL_TASKS_TABLE = "customer_retention_tasks";

function isMissingActionEventsTable(error: { code?: string; message?: string } | null | undefined) {
  if (!error) return false;
  return error.code === "42P01"
    || error.code === "PGRST205"
    || /customer_retention_action_events.*(does not exist|schema cache)/i.test(error.message ?? "");
}

// Same defensive pattern as the action-events table above: the Tasks page
// must keep working (showing derived lifecycle tasks) if migration 178 has
// not reached this environment yet, rather than erroring the whole page.
function isMissingManualTasksTable(error: { code?: string; message?: string } | null | undefined) {
  if (!error) return false;
  return error.code === "42P01"
    || error.code === "PGRST205"
    || /customer_retention_tasks.*(does not exist|schema cache)/i.test(error.message ?? "");
}

function retentionRepScope(role: string, userId: string, requested: unknown): string | null {
  if (!RETENTION_SUPERVISOR_ROLES.has(role)) return userId;
  return typeof requested === "string" && requested !== "" && requested !== "all" ? requested : null;
}

function canAccessAssignedRetentionOrder(role: string, userId: string, assignedRepId: string | null | undefined) {
  return RETENTION_SUPERVISOR_ROLES.has(role) || assignedRepId === userId;
}

type RetentionAssignment = {
  order_id: string;
  recovery_rep_id: string | null;
};

const chunksOf = <T>(items: T[], size = 200) => {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
};

async function soleActiveRecoveryRepId(orgId: string) {
  const { data, error } = await supabase
    .from("users")
    .select("id")
    .eq("org_id", orgId)
    .eq("active", true)
    .eq("role", "Recovery Rep")
    .limit(2);
  if (error) throw new Error(error.message);
  return data?.length === 1 ? data[0].id : null;
}

async function loadRetentionAssignmentMap(orgId: string, orderIds: string[]) {
  if (orderIds.length === 0) return new Map<string, string | null>();
  const assignmentRows: RetentionAssignment[] = [];
  for (const orderIdChunk of chunksOf(orderIds)) {
    const { data, error } = await supabase
      .from("customer_retention_assignments")
      .select("order_id, recovery_rep_id")
      .eq("org_id", orgId)
      .in("order_id", orderIdChunk);
    const assignmentTableMissing = error?.code === "42P01"
      || error?.code === "PGRST205"
      || (/customer_retention_assignments/i.test(error?.message ?? "") && /not find|does not exist|schema cache/i.test(error?.message ?? ""));
    if (assignmentTableMissing) break;
    if (error) throw new Error(error.message);
    assignmentRows.push(...((data as RetentionAssignment[] | null) ?? []));
  }

  const result = new Map(assignmentRows.map((row) => [row.order_id, row.recovery_rep_id]));
  const soleRepId = await soleActiveRecoveryRepId(orgId);
  if (soleRepId) {
    for (const orderId of orderIds) {
      if (!result.get(orderId)) result.set(orderId, soleRepId);
    }
  }
  return result;
}

async function retentionRepForOrder(orgId: string, orderId: string) {
  return (await loadRetentionAssignmentMap(orgId, [orderId])).get(orderId) ?? null;
}

// Real per-order COGS lookup, same pattern as manager-bonuses.ts's
// loadPricingMap/cogsForOrder and recovery-rep-kpi.ts's costForOrders -
// duplicated locally (small, ~20 lines) rather than refactoring those
// working files to export it, to keep this change scoped to retention.
type PricingMap = Map<string, { byCurrency: Map<string, number>; primary: number; hasPrimary: boolean }>;
const numericAmount = (value: unknown) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};
async function loadPricingMap(productIds: string[]): Promise<PricingMap> {
  const map: PricingMap = new Map();
  if (productIds.length === 0) return map;
  const { data } = await supabase.from("product_pricings").select("product_id, currency, unit_cost, is_primary").in("product_id", productIds);
  for (const row of data ?? []) {
    let entry = map.get(row.product_id);
    if (!entry) { entry = { byCurrency: new Map(), primary: 0, hasPrimary: false }; map.set(row.product_id, entry); }
    const cost = numericAmount(row.unit_cost);
    if (row.currency) entry.byCurrency.set(row.currency, cost);
    if (row.is_primary) { entry.primary = cost; entry.hasPrimary = true; }
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
  orderInventoryLinesFromRow(order).reduce((sum, line) => sum + line.quantity * unitCostFor(pricingMap, line.productId, order.currency), 0);

const DEFAULT_BONUS_SETTINGS = {
  satisfactionCheckBonus: 200,
  writtenReviewBonus: 500,
  videoTestimonialBonus: 1500,
  referralBonus: 1000,
  retentionSaleBonusPct: 10,
  customerDiscountPct: 10,
  highValueOrderThreshold: 50000,
  monthlyBonusTarget: 30000
};

async function loadBonusSettings(orgId: string) {
  const { data } = await supabase
    .from("customer_retention_bonus_settings")
    .select("*")
    .eq("org_id", orgId)
    .maybeSingle();
  if (!data) return DEFAULT_BONUS_SETTINGS;
  return {
    satisfactionCheckBonus: Number(data.satisfaction_check_bonus ?? DEFAULT_BONUS_SETTINGS.satisfactionCheckBonus),
    writtenReviewBonus: Number(data.written_review_bonus ?? DEFAULT_BONUS_SETTINGS.writtenReviewBonus),
    videoTestimonialBonus: Number(data.video_testimonial_bonus ?? DEFAULT_BONUS_SETTINGS.videoTestimonialBonus),
    referralBonus: Number(data.referral_bonus ?? DEFAULT_BONUS_SETTINGS.referralBonus),
    retentionSaleBonusPct: Number(data.retention_sale_bonus_pct ?? DEFAULT_BONUS_SETTINGS.retentionSaleBonusPct),
    customerDiscountPct: Number(data.customer_discount_pct ?? DEFAULT_BONUS_SETTINGS.customerDiscountPct),
    highValueOrderThreshold: Number(data.high_value_order_threshold ?? DEFAULT_BONUS_SETTINGS.highValueOrderThreshold),
    monthlyBonusTarget: Number(data.monthly_bonus_target ?? DEFAULT_BONUS_SETTINGS.monthlyBonusTarget)
  };
}

const SATISFACTION_OUTCOMES = [
  "satisfied", "has_not_used_it", "needs_usage_guidance", "wrong_damaged_or_incomplete",
  "not_satisfied", "potential_repeat_buyer", "potential_referral_customer"
] as const;

type WorklistRow = {
  orderId: string; customerName: string; phone: string; deliveredDate: string; daysSinceDelivery: number;
  dueStage: ReturnType<typeof dueStageFor>["dueStage"]; overdueBy: number; priorityBand: ReturnType<typeof priorityBandFor>;
  lifecycleStage: LifecycleStage; stageEnteredDate: string; stageDueDate: string;
  orderAmount: number; orderCurrency: string; productName: string;
  assignedRepId: string | null; assignedRepName: string | null;
  lastTouchpoint: {
    stage: string; loggedAt: string; satisfactionOutcome: string | null; reachStatus: string | null;
    customerResponse: string | null; nextAction: string | null; reviewCollected: boolean;
    referralCollected: boolean; retentionOutcome: string | null;
  } | null;
  lastContactAt: string | null; nextAction: string | null; nextActionAt: string | null; nextActionNote: string | null;
  followUpStatus: "scheduled" | "due" | "overdue" | null;
  discountOwed: boolean; reviewRequested: boolean; reviewCollected: boolean; referralRequested: boolean; referralCollected: boolean;
  doNotContact: boolean;
};

function addDaysToDateKey(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function pipelineStageDates(
  stage: LifecycleStage,
  deliveredDate: string,
  timing: RetentionTiming,
  touchpoints: Array<RetentionTouchpointRecord & Record<string, any>>
) {
  const latestNegative = [...touchpoints].reverse().find((row) =>
    row.stage === "satisfaction_check"
    && row.satisfaction_outcome
    && NEGATIVE_SATISFACTION_OUTCOMES.has(row.satisfaction_outcome)
  );
  if (stage === "needs_resolution") {
    const date = latestNegative?.logged_at?.slice(0, 10) ?? deliveredDate;
    return { stageEnteredDate: date, stageDueDate: date };
  }
  if (stage === "delivered" || stage === "satisfaction_check") {
    return {
      stageEnteredDate: deliveredDate,
      stageDueDate: addDaysToDateKey(deliveredDate, timing.satisfactionDays)
    };
  }
  if (stage === "review_testimonial") {
    return {
      stageEnteredDate: addDaysToDateKey(deliveredDate, timing.satisfactionDays),
      stageDueDate: addDaysToDateKey(deliveredDate, timing.reviewDays)
    };
  }
  if (stage === "referral") {
    return {
      stageEnteredDate: addDaysToDateKey(deliveredDate, timing.reviewDays),
      stageDueDate: addDaysToDateKey(deliveredDate, timing.repeatSaleStartDays)
    };
  }
  if (stage === "repeat_sale") {
    return {
      stageEnteredDate: addDaysToDateKey(deliveredDate, timing.repeatSaleStartDays),
      stageDueDate: addDaysToDateKey(deliveredDate, timing.repeatSaleEndDays)
    };
  }
  return {
    stageEnteredDate: addDaysToDateKey(deliveredDate, timing.repeatSaleEndDays + 1),
    stageDueDate: addDaysToDateKey(deliveredDate, timing.winBackEndDays)
  };
}

// Shared point-in-time worklist computation - used by both /worklist
// (filtered/sorted for the rep-facing queue) and /dashboard-summary (raw
// rows aggregated into KPI/lifecycle-pipeline counts). Kept as one function
// so both endpoints agree on exactly which orders are "in the retention
// lifecycle" and how their due-stage is derived.
async function loadWorklistRows(
  orgId: string,
  settings: Awaited<ReturnType<typeof loadBonusSettings>>,
  options: { includeOptedOut?: boolean } = {}
): Promise<WorklistRow[]> {
  const nowIso = new Date().toISOString();
  const today = dayKey(nowIso);
  const oldestRelevant = new Date();
  oldestRelevant.setUTCDate(oldestRelevant.getUTCDate() - 90);

  const { data: deliveredOrders, error: ordersError } = await fetchAllRows<any>((from, to) => supabase
    .from("orders")
    .select("id, customer, phone, delivered_date, product_id, package_id, amount, currency, product_name")
    .eq("org_id", orgId)
    .eq("status", "Delivered")
    .gte("delivered_date", oldestRelevant.toISOString().slice(0, 10))
    .not("delivered_date", "is", null)
    .order("id", { ascending: true })
    .range(from, to));
  if (ordersError) throw new Error(ordersError.message);
  let orders = deliveredOrders ?? [];
  if (orders.length === 0) return [];

  // Opted-out customers must leave the worklist - blocks_followup already
  // suppresses follow-up obligations elsewhere (customers.ts), but the
  // retention worklist never checked it, so an opted-out phone stayed in
  // the queue forever.
  const { data: optOuts } = await supabase
    .from("customer_flags")
    .select("phone")
    .eq("org_id", orgId)
    .eq("blocks_followup", true);
  const optedOutPhones = new Set((optOuts ?? []).map((f) => f.phone));
  if (!options.includeOptedOut) {
    orders = orders.filter((o) => !optedOutPhones.has(String(o.phone).replace(/\D/g, "")));
  }
  if (orders.length === 0) return [];

  const orderIds = orders.map((o) => o.id);
  const assignmentByOrderId = await loadRetentionAssignmentMap(orgId, orderIds);
  const repIds = [...new Set([...assignmentByOrderId.values()].filter(Boolean))] as string[];
  const { data: repUsers } = repIds.length > 0
    ? await supabase.from("users").select("id, name").in("id", repIds)
    : { data: [] as { id: string; name: string }[] };
  const repNameById = new Map((repUsers ?? []).map((u) => [u.id, u.name]));

  const touchpointRows: any[] = [];
  for (const orderIdChunk of chunksOf(orderIds)) {
    const { data, error } = await fetchAllRows<any>((from, to) => supabase
      .from("customer_retention_touchpoints")
      .select("order_id, stage, satisfaction_outcome, review_collected, referral_collected, review_is_video, review_requested_at, referral_requested_at, retention_outcome, customer_discount_owed, customer_discount_cleared_at, next_action, next_action_at, next_action_note, reach_status, customer_response, logged_at")
      .eq("org_id", orgId)
      .in("order_id", orderIdChunk)
      .order("logged_at", { ascending: true })
      .range(from, to));
    if (error) throw new Error(error.message);
    touchpointRows.push(...(data ?? []));
  }
  touchpointRows.sort((a, b) => String(a.logged_at).localeCompare(String(b.logged_at)));

  const touchpointsByOrder = new Map<string, any[]>();
  for (const row of touchpointRows) {
    const list = touchpointsByOrder.get(row.order_id) ?? [];
    list.push(row);
    touchpointsByOrder.set(row.order_id, list);
  }

  // Per-product configurable lifecycle timing - a product's override
  // (any subset of the 5 fields) merges over the org-wide defaults; a
  // product with no override (the common case) just uses the defaults.
  const productIds = [...new Set(orders.map((o) => o.product_id).filter(Boolean))] as string[];
  const { data: productTimingRows } = productIds.length > 0
    ? await supabase.from("products").select("id, retention_timing_overrides").in("id", productIds)
    : { data: [] as { id: string; retention_timing_overrides: Partial<RetentionTiming> | null }[] };
  const timingByProductId = new Map(
    (productTimingRows ?? []).map((p) => [p.id, { ...DEFAULT_RETENTION_TIMING, ...(p.retention_timing_overrides ?? {}) }])
  );

  return orders.map((order) => {
    const recoveryRepId = assignmentByOrderId.get(order.id) ?? null;
    const tps = (touchpointsByOrder.get(order.id) ?? []) as (RetentionTouchpointRecord & Record<string, any>)[];
    const deliveredKey = String(order.delivered_date).slice(0, 10);
    const timing = (order.product_id && timingByProductId.get(order.product_id)) || DEFAULT_RETENTION_TIMING;
    const lifecycleDue = dueStageFor(deliveredKey, today, tps, timing);
    const lifecycleStage = lifecycleStageFor(deliveredKey, today, tps, timing);
    const stageDates = pipelineStageDates(lifecycleStage, deliveredKey, timing, tps);
    const followUp = scheduledFollowUpFor(tps, nowIso);
    const dueStage = lifecycleDue.dueStage;
    const overdueBy = followUp ? followUp.overdueBy : lifecycleDue.overdueBy;
    const orderAmount = Number(order.amount ?? 0);
    const last = tps.length > 0 ? tps[tps.length - 1] : null;
    let priorityBand = priorityBandFor({ dueStage, overdueBy, orderAmount }, settings);
    if (dueStage !== "needs_resolution" && followUp?.status === "overdue") priorityBand = "overdue";
    const discountOwed = tps.some((t) => t.customer_discount_owed && !t.customer_discount_cleared_at);
    const reviewRequested = tps.some((t) => !!t.review_requested_at);
    const reviewCollected = tps.some((t) => t.review_collected);
    const referralRequested = tps.some((t) => !!t.referral_requested_at);
    const referralCollected = tps.some((t) => t.referral_collected);
    const lastContactAt = tps.length > 0 ? tps.reduce((max, t) => (t.logged_at > max ? t.logged_at : max), tps[0].logged_at) : null;
    return {
      orderId: order.id,
      customerName: order.customer,
      phone: order.phone,
      deliveredDate: deliveredKey,
      daysSinceDelivery: daysBetween(deliveredKey, today),
      dueStage,
      overdueBy,
      priorityBand,
      lifecycleStage,
      ...stageDates,
      orderAmount,
      orderCurrency: order.currency,
      productName: order.product_name,
      assignedRepId: recoveryRepId,
      assignedRepName: recoveryRepId ? (repNameById.get(recoveryRepId) ?? null) : null,
      lastTouchpoint: last ? {
        stage: last.stage,
        loggedAt: last.logged_at,
        satisfactionOutcome: last.satisfaction_outcome,
        reachStatus: last.reach_status ?? null,
        customerResponse: last.customer_response ?? null,
        nextAction: last.next_action ?? null,
        reviewCollected: !!last.review_collected,
        referralCollected: !!last.referral_collected,
        retentionOutcome: last.retention_outcome ?? null
      } : null,
      lastContactAt,
      nextAction: followUp ? "schedule_follow_up" : (last?.next_action ?? null),
      nextActionAt: followUp?.nextActionAt ?? null,
      nextActionNote: followUp?.note ?? null,
      followUpStatus: followUp?.status ?? null,
      discountOwed,
      reviewRequested, reviewCollected, referralRequested, referralCollected,
      doNotContact: optedOutPhones.has(String(order.phone).replace(/\D/g, ""))
    };
  });
}

router.get("/worklist", requireRole(...RETENTION_ROLES), async (req, res) => {
  try {
    const orgId = req.user!.orgId;
    const stageFilter = typeof req.query.stage === "string" ? req.query.stage : "all";
    const search = typeof req.query.search === "string" ? req.query.search.trim().toLowerCase() : "";
    const minValue = typeof req.query.minValue === "string" && !Number.isNaN(Number(req.query.minValue)) ? Number(req.query.minValue) : null;
    const priorityFilter = typeof req.query.priority === "string" && req.query.priority !== "all" ? req.query.priority : null;
    const productFilter = typeof req.query.product === "string" && req.query.product !== "all" ? req.query.product : null;
    const includeAll = req.query.includeAll === "true";
    const assignedRepFilter = retentionRepScope(req.user!.role, req.user!.id, req.query.assignedRepId);

    const settings = await loadBonusSettings(orgId);
    const allRows = await loadWorklistRows(orgId, settings);

    const rows = allRows
      // "all" means "everything actionable" - rows with no due stage (fully
      // progressed / not yet eligible) are noise in a work queue and are
      // still reachable individually via the stage-specific filters.
      .filter((row) =>
        stageFilter === "all"
          ? includeAll || row.dueStage !== null || row.followUpStatus !== null
          : row.dueStage === stageFilter
      )
      .filter((row) => !search || row.customerName.toLowerCase().includes(search) || String(row.phone).includes(search) || row.orderId.toLowerCase().includes(search))
      .filter((row) => minValue === null || row.orderAmount >= minValue)
      .filter((row) => !priorityFilter || row.priorityBand === priorityFilter)
      .filter((row) => !productFilter || row.productName === productFilter)
      .filter((row) => !assignedRepFilter || row.assignedRepId === assignedRepFilter)
      .sort(compareByPriority);

    res.json({ rows });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Failed to load the customer retention worklist." });
  }
});

router.get("/customers", requireRole(...RETENTION_ROLES), async (req, res) => {
  try {
    const orgId = req.user!.orgId;
    const settings = await loadBonusSettings(orgId);
    const requestedRepId = retentionRepScope(req.user!.role, req.user!.id, req.query.repId);
    const worklistRows = await loadWorklistRows(orgId, settings, { includeOptedOut: true });

    const currentByPhone = new Map<string, WorklistRow>();
    for (const row of worklistRows) {
      const phoneKey = String(row.phone).replace(/\D/g, "");
      if (!phoneKey) continue;
      const existing = currentByPhone.get(phoneKey);
      if (!existing || row.deliveredDate > existing.deliveredDate) currentByPhone.set(phoneKey, row);
    }

    const { data: allOrders, error } = await fetchAllRows<any>((from, to) => supabase
      .from("orders")
      .select("id, customer, phone, city, state, product_name, package_name, amount, currency, status, delivered_date, created_at")
      .eq("org_id", orgId)
      .not("phone", "is", null)
      .order("created_at", { ascending: true })
      .range(from, to));
    if (error) throw new Error(error.message);

    const ordersByPhone = new Map<string, any[]>();
    for (const order of allOrders ?? []) {
      const phoneKey = String(order.phone).replace(/\D/g, "");
      if (!phoneKey) continue;
      const rows = ordersByPhone.get(phoneKey) ?? [];
      rows.push(order);
      ordersByPhone.set(phoneKey, rows);
    }

    const customerGroups = [...ordersByPhone.entries()]
      .map(([phoneKey, customerOrders]) => ({
        phoneKey,
        customerOrders,
        deliveredOrders: customerOrders.filter((order) => order.status === "Delivered" && order.delivered_date)
      }))
      .filter((group) => group.deliveredOrders.length > 0);
    if (customerGroups.length === 0) {
      res.json({ rows: [] });
      return;
    }

    const latestDeliveredOrderIds = customerGroups.map((group) => group.deliveredOrders[group.deliveredOrders.length - 1].id);
    const assignmentByOrderId = await loadRetentionAssignmentMap(orgId, latestDeliveredOrderIds);
    const assignedRepIds = [...new Set([...assignmentByOrderId.values()].filter(Boolean))] as string[];
    const { data: assignedReps, error: assignedRepsError } = assignedRepIds.length > 0
      ? await supabase.from("users").select("id, name").eq("org_id", orgId).in("id", assignedRepIds)
      : { data: [] as { id: string; name: string }[], error: null };
    if (assignedRepsError) throw new Error(assignedRepsError.message);
    const assignedRepNameById = new Map((assignedReps ?? []).map((user) => [user.id, user.name]));

    const latestOrderTouchpoints: any[] = [];
    for (const orderIdChunk of chunksOf(latestDeliveredOrderIds)) {
      const { data, error: touchpointError } = await fetchAllRows<any>((from, to) => supabase
        .from("customer_retention_touchpoints")
        .select("order_id, satisfaction_outcome, review_requested_at, review_collected, referral_requested_at, referral_collected, retention_outcome, customer_response, logged_at")
        .eq("org_id", orgId)
        .in("order_id", orderIdChunk)
        .order("logged_at", { ascending: true })
        .range(from, to));
      if (touchpointError) throw new Error(touchpointError.message);
      latestOrderTouchpoints.push(...(data ?? []));
    }
    const touchpointsByOrderId = new Map<string, any[]>();
    for (const touchpoint of latestOrderTouchpoints) {
      const rows = touchpointsByOrderId.get(touchpoint.order_id) ?? [];
      rows.push(touchpoint);
      touchpointsByOrderId.set(touchpoint.order_id, rows);
    }

    const { data: customerFlags, error: customerFlagsError } = await supabase
      .from("customer_flags")
      .select("phone")
      .eq("org_id", orgId)
      .eq("blocks_followup", true);
    if (customerFlagsError) throw new Error(customerFlagsError.message);
    const optedOutPhones = new Set((customerFlags ?? []).map((flag) => String(flag.phone).replace(/\D/g, "")));

    const rows = customerGroups.map(({ phoneKey, customerOrders, deliveredOrders }) => {
      const lifecycle = currentByPhone.get(phoneKey) ?? null;
      const latestOrder = customerOrders[customerOrders.length - 1] ?? null;
      const latestDeliveredOrder = deliveredOrders[deliveredOrders.length - 1];
      const rejectedOrders = customerOrders.filter((order) => ["Cancelled", "Failed", "Rejected"].includes(String(order.status)));
      const totalSpent = deliveredOrders.reduce((sum, order) => sum + Number(order.amount ?? 0), 0);
      const productsPurchased = [...new Set(deliveredOrders.map((order) => String(order.product_name ?? "")).filter(Boolean))];
      const assignedRepId = lifecycle?.assignedRepId ?? assignmentByOrderId.get(latestDeliveredOrder.id) ?? null;
      const assignedRepName = lifecycle?.assignedRepName ?? (assignedRepId ? assignedRepNameById.get(assignedRepId) ?? null : null);
      const touchpoints = touchpointsByOrderId.get(latestDeliveredOrder.id) ?? [];
      const latestTouchpoint = touchpoints[touchpoints.length - 1] ?? null;
      const doNotContact = lifecycle?.doNotContact ?? optedOutPhones.has(phoneKey);
      const complaintOpen = lifecycle?.lifecycleStage === "needs_resolution";
      const lifecycleStage: LifecycleStage = lifecycle?.lifecycleStage ?? "win_back";
      const deliveredKey = String(latestDeliveredOrder.delivered_date).slice(0, 10);
      const inactiveStageDates = pipelineStageDates("win_back", deliveredKey, DEFAULT_RETENTION_TIMING, []);
      const status =
        doNotContact ? "do_not_contact"
        : complaintOpen ? "unresolved_issue"
        : totalSpent >= settings.highValueOrderThreshold ? "high_value"
        : deliveredOrders.length > 1 ? "repeat_customer"
        : "active";
      const nextAction =
        doNotContact ? "Do not contact"
        : lifecycle?.followUpStatus ? "Scheduled follow-up"
        : lifecycleStage === "needs_resolution" ? "Resolve complaint"
        : lifecycleStage === "satisfaction_check" ? "Run satisfaction check"
        : lifecycleStage === "review_testimonial" ? "Request review"
        : lifecycleStage === "referral" ? "Request referral"
        : lifecycleStage === "repeat_sale" ? "Make repeat-sale offer"
        : lifecycleStage === "win_back" ? "Attempt win-back"
        : "Wait for satisfaction window";
      const reviewCollected = lifecycle?.reviewCollected ?? touchpoints.some((row) => row.review_collected);
      const reviewRequested = lifecycle?.reviewRequested ?? touchpoints.some((row) => !!row.review_requested_at);
      const referralCollected = lifecycle?.referralCollected ?? touchpoints.some((row) => row.referral_collected);
      const referralRequested = lifecycle?.referralRequested ?? touchpoints.some((row) => !!row.referral_requested_at);

      return {
        id: phoneKey,
        name: latestOrder?.customer ?? latestDeliveredOrder.customer,
        phone: latestOrder?.phone ?? latestDeliveredOrder.phone,
        city: latestOrder?.city ?? "",
        state: latestOrder?.state ?? "",
        customerSince: customerOrders[0]?.created_at ?? `${deliveredKey}T00:00:00`,
        totalOrders: customerOrders.length,
        deliveredOrders: deliveredOrders.length,
        rejectedOrders: rejectedOrders.length,
        totalSpent,
        currency: latestDeliveredOrder.currency ?? lifecycle?.orderCurrency ?? "NGN",
        lastOrderId: latestDeliveredOrder.id,
        lastProduct: latestDeliveredOrder.product_name ?? lifecycle?.productName ?? "",
        lastPackage: latestDeliveredOrder.package_name ?? "",
        lastOrderDate: latestDeliveredOrder.delivered_date ?? latestDeliveredOrder.created_at,
        productsPurchased,
        lifecycleStage,
        stageEnteredDate: lifecycle?.stageEnteredDate ?? inactiveStageDates.stageEnteredDate,
        stageDueDate: lifecycle?.stageDueDate ?? inactiveStageDates.stageDueDate,
        lastContactAt: lifecycle?.lastContactAt ?? latestTouchpoint?.logged_at ?? null,
        nextAction,
        nextActionAt: lifecycle?.nextActionAt ?? (lifecycle ? `${lifecycle.stageDueDate}T17:00:00` : null),
        nextActionOrderId: lifecycle?.orderId ?? latestDeliveredOrder.id,
        assignedRepId,
        assignedRepName,
        priorityBand: lifecycle?.priorityBand ?? "revenue_opportunity",
        complaintOpen,
        doNotContact,
        activeRetention: !!lifecycle,
        reviewStatus: reviewCollected ? "received" : reviewRequested ? "requested" : "not_requested",
        referralStatus: referralCollected ? "received" : referralRequested ? "requested" : "not_requested",
        repeatSaleStatus: lifecycle?.lastTouchpoint?.retentionOutcome ?? latestTouchpoint?.retention_outcome ?? (lifecycleStage === "repeat_sale" ? "eligible" : "not_due"),
        status,
        lastOutcome: lifecycle?.lastTouchpoint?.customerResponse
          ?? lifecycle?.lastTouchpoint?.satisfactionOutcome
          ?? lifecycle?.lastTouchpoint?.retentionOutcome
          ?? latestTouchpoint?.customer_response
          ?? latestTouchpoint?.satisfaction_outcome
          ?? latestTouchpoint?.retention_outcome
          ?? null
      };
    })
      .filter((row) => !requestedRepId || row.assignedRepId === requestedRepId)
      .sort((a, b) => a.name.localeCompare(b.name));

    res.json({ rows });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Failed to load retention customers." });
  }
});

const RetentionAssignmentSchema = z.object({
  recoveryRepId: z.string().uuid()
});

router.patch("/order/:orderId/assignment", requireRole("Owner", "Admin", "Manager"), async (req, res) => {
  try {
    const parsed = RetentionAssignmentSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten().fieldErrors });
      return;
    }

    const orgId = req.user!.orgId;
    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select("id, status")
      .eq("org_id", orgId)
      .eq("id", req.params.orderId)
      .maybeSingle();
    if (orderError) throw new Error(orderError.message);
    if (!order) {
      res.status(404).json({ error: "Order not found." });
      return;
    }
    if (order.status !== "Delivered") {
      res.status(400).json({ error: "Only Delivered orders can enter the customer-retention queue." });
      return;
    }

    const { data: rep, error: repError } = await supabase
      .from("users")
      .select("id, name, active, role")
      .eq("org_id", orgId)
      .eq("id", parsed.data.recoveryRepId)
      .maybeSingle();
    if (repError) throw new Error(repError.message);
    if (!rep || !rep.active || rep.role !== "Recovery Rep") {
      res.status(400).json({ error: "Choose an active Recovery Rep from this organization." });
      return;
    }

    const now = new Date().toISOString();
    const { data: assignment, error: assignmentError } = await supabase
      .from("customer_retention_assignments")
      .upsert({
        order_id: order.id,
        org_id: orgId,
        recovery_rep_id: rep.id,
        assigned_by: req.user!.id,
        assignment_source: "manual",
        assigned_at: now,
        updated_at: now
      }, { onConflict: "order_id" })
      .select("order_id, recovery_rep_id, assignment_source, assigned_at, updated_at")
      .single();
    if (assignmentError) throw new Error(assignmentError.message);

    res.json({
      assignment: {
        orderId: assignment.order_id,
        recoveryRepId: assignment.recovery_rep_id,
        recoveryRepName: rep.name,
        assignmentSource: assignment.assignment_source,
        assignedAt: assignment.assigned_at,
        updatedAt: assignment.updated_at
      }
    });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Failed to assign the retention order." });
  }
});

const RetentionActionEventSchema = z.object({
  orderId: z.string().min(1),
  actionType: z.enum(["call", "whatsapp"]),
  context: z.string().trim().min(1).max(80).optional()
});

router.post("/action-events", requireRole(...RETENTION_ROLES), async (req, res) => {
  const parsed = RetentionActionEventSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }
  try {
    const orgId = req.user!.orgId;
    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select("id")
      .eq("org_id", orgId)
      .eq("id", parsed.data.orderId)
      .maybeSingle();
    if (orderError) { res.status(500).json({ error: orderError.message }); return; }
    if (!order) { res.status(404).json({ error: "Order not found." }); return; }

    const assignedRepId = await retentionRepForOrder(orgId, parsed.data.orderId);
    if (!canAccessAssignedRetentionOrder(req.user!.role, req.user!.id, assignedRepId)) {
      res.status(403).json({ error: "This retention order is not assigned to you." });
      return;
    }

    const { data, error } = await supabase
      .from(ACTION_EVENTS_TABLE)
      .insert({
        org_id: orgId,
        order_id: parsed.data.orderId,
        action_type: parsed.data.actionType,
        context: parsed.data.context ?? "worklist",
        logged_by: req.user!.id
      })
      .select("id, order_id, action_type, context, logged_by, logged_at")
      .single();
    if (error) {
      if (isMissingActionEventsTable(error)) {
        res.status(503).json({ error: "Retention action auditing is still being activated. The customer contact action was not blocked." });
        return;
      }
      res.status(500).json({ error: error.message });
      return;
    }
    res.status(201).json({ row: data });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Could not record the retention action." });
  }
});

router.get("/order/:orderId/retention-suggestion", requireRole(...RETENTION_ROLES), async (req, res) => {
  try {
    const orgId = req.user!.orgId;
    const { data: order } = await supabase
      .from("orders")
      .select("id, product_id, package_id")
      .eq("org_id", orgId)
      .eq("id", req.params.orderId)
      .maybeSingle();
    const recoveryRepId = order ? await retentionRepForOrder(orgId, order.id) : null;
    if (order && !canAccessAssignedRetentionOrder(req.user!.role, req.user!.id, recoveryRepId)) {
      res.status(403).json({ error: "This retention order is not assigned to you." });
      return;
    }
    if (!order?.package_id) { res.json({ suggestion: null }); return; }
    const { data: pkg } = await supabase
      .from("product_packages")
      .select("companion_products")
      .eq("id", order.package_id)
      .maybeSingle();
    const companions = Array.isArray(pkg?.companion_products) ? pkg!.companion_products : [];
    const first = companions.find((c: any) => c?.active !== false && (c?.productId ?? c?.product_id));
    if (!first) { res.json({ suggestion: null }); return; }
    res.json({ suggestion: { productId: first.productId ?? first.product_id, packageId: first.packageId ?? first.package_id ?? null } });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Failed to load a retention suggestion." });
  }
});

// GET /customer/:phone - Customer Detail Drawer aggregation. No existing
// endpoint does this (customers.ts only does org-list-level aggregation);
// reuses its phone-digits-only normalization convention.
// Itemises what a customer actually bought on one order: the main product,
// any upsell, every cross-sell add-on (and who added it), and the free gifts
// bundled in the package.
//
// The retention rep was previously shown only the headline product against
// the full order total, which hid the add-ons entirely - so a ₦50,000 order
// looked like a single ₦50,000 product when it was ₦39,500 main + a ₦10,500
// cross-sell. Knowing the real basket is what tells the rep how to approach
// the call.
//
// Main-product amount is derived as `amount - crossSellTotal`, NOT from
// `original_amount`. Verified against every order carrying cross-sell lines:
// that subtraction is always positive and lands on the real package price,
// whereas `original_amount` means different things row to row (sometimes the
// pre-cross-sell figure, sometimes the full total, sometimes the pre-upsell
// figure) because it exists for upsell bonus math, not line breakdown.
function orderPurchaseBreakdown(order: any) {
  const lines = Array.isArray(order.cross_sell_lines) ? order.cross_sell_lines : [];
  const crossSells = lines.map((line: any) => ({
    productId: line?.productId ?? null,
    productName: line?.productName ?? "Add-on",
    quantity: Number(line?.quantity ?? 0),
    amount: numericAmount(line?.amount),
    addedByName: line?.addedByName ?? null,
    addedByRole: line?.addedByRole ?? null,
    addedAt: line?.addedAt ?? null,
    // "manual_rep" means a rep pitched it live; other sources come from the
    // order form's own offer slots.
    selectionSource: line?.selectionSource ?? null
  }));
  const crossSellTotal = crossSells.reduce((sum: number, line: any) => sum + line.amount, 0);
  const total = numericAmount(order.amount);

  // Free gifts arrive from two places: components bundled into the package,
  // and standalone gift lines. Neither costs the customer anything, so they
  // never affect the money math - but the rep must know they were promised.
  const componentGifts = (Array.isArray(order.package_components_snapshot) ? order.package_components_snapshot : [])
    .filter((c: any) => c?.isFreeGift && !c?.hiddenFromCustomer)
    .map((c: any) => ({ productName: c?.productName ?? "Gift", quantity: Number(c?.quantity ?? 0), source: "package" as const }));
  const standaloneGifts = (Array.isArray(order.free_gift_lines) ? order.free_gift_lines : [])
    .map((g: any) => ({ productName: g?.productName ?? "Gift", quantity: Number(g?.quantity ?? 0), source: "added" as const }));

  const upsoldFrom = order.upsell_from_qty === null || order.upsell_from_qty === undefined ? null : Number(order.upsell_from_qty);
  const upsoldTo = order.upsell_to_qty === null || order.upsell_to_qty === undefined ? null : Number(order.upsell_to_qty);

  return {
    orderId: order.id,
    product: order.product_name,
    package: order.package_name,
    quantity: Number(order.quantity ?? 0),
    mainAmount: total - crossSellTotal,
    crossSellTotal,
    amount: total,
    currency: order.currency,
    deliveredDate: order.delivered_date,
    createdAt: order.created_at,
    status: order.status,
    crossSells,
    freeGifts: [...componentGifts, ...standaloneGifts],
    upsell: upsoldTo !== null && upsoldTo !== upsoldFrom
      ? { fromQty: upsoldFrom, toQty: upsoldTo, note: order.upsell_note ?? null }
      : null
  };
}

router.get("/customer/:phone", requireRole(...RETENTION_ROLES), async (req, res) => {
  try {
    const orgId = req.user!.orgId;
    const targetPhone = String(req.params.phone).replace(/\D/g, "");
    if (!targetPhone) { res.status(400).json({ error: "Invalid phone." }); return; }

    const { data: allOrders, error } = await fetchAllRows<any>((from, to) => supabase
      .from("orders")
      .select("id, customer, phone, address, city, state, product_id, product_name, package_name, quantity, amount, currency, status, delivered_date, created_at, cross_sell_lines, free_gift_lines, package_components_snapshot, upsell_from_qty, upsell_to_qty, upsell_note")
      .eq("org_id", orgId)
      .order("id", { ascending: true })
      .range(from, to));
    if (error) { res.status(500).json({ error: error.message }); return; }
    const matchingOrders = (allOrders ?? []).filter((o) => String(o.phone).replace(/\D/g, "") === targetPhone);
    if (!RETENTION_SUPERVISOR_ROLES.has(req.user!.role)) {
      const assignmentByOrderId = await loadRetentionAssignmentMap(orgId, matchingOrders.map((o) => o.id));
      const canAccessCustomer = matchingOrders.some((o) => assignmentByOrderId.get(o.id) === req.user!.id);
      if (!canAccessCustomer) {
        res.status(404).json({ error: "No orders found for this customer." });
        return;
      }
    }
    const orders = matchingOrders;
    if (orders.length === 0) { res.status(404).json({ error: "No orders found for this customer." }); return; }

    const byCreatedAsc = [...orders].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    const byCreatedDesc = [...orders].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    const first = byCreatedAsc[0];
    const latestOrder = byCreatedDesc[0];
    const delivered = orders.filter((o) => o.status === "Delivered");
    const totalSpent = delivered.reduce((sum, o) => sum + Number(o.amount ?? 0), 0);

    const orderIds = orders.map((o) => o.id);
    const { data: touchpointRows } = await supabase
      .from("customer_retention_touchpoints")
      .select("order_id, stage, satisfaction_outcome, satisfaction_notes, review_collected, review_is_video, referral_collected, retention_outcome, resulting_order_id, logged_at, reach_status, customer_response, next_action, next_action_at, next_action_note, review_requested_at, referral_requested_at")
      .eq("org_id", orgId)
      .in("order_id", orderIds)
      .order("logged_at", { ascending: true });
    const tps = touchpointRows ?? [];
    const { data: actionEventRows } = await supabase
      .from(ACTION_EVENTS_TABLE)
      .select("order_id, action_type, context, logged_at")
      .eq("org_id", orgId)
      .in("order_id", orderIds)
      .order("logged_at", { ascending: true });
    const actionEvents = actionEventRows ?? [];

    // Decision B: Protohub has no order-level "Returned" concept - this is
    // a real, defensible proxy, never silently labeled "Returns" on the
    // frontend.
    const wrongDamagedReportsCount = tps.filter((t) => t.stage === "satisfaction_check" && t.satisfaction_outcome === "wrong_damaged_or_incomplete").length;

    const timeline: Array<{ type: string; at: string; detail: string }> = [];
    for (const o of delivered) {
      if (o.delivered_date) timeline.push({ type: "order_delivered", at: `${o.delivered_date}T00:00:00`, detail: `Order #${o.id} delivered (${o.product_name})` });
    }
    const ordersWithReportedIssues = new Set<string>();
    for (const t of tps) {
      let hasPrimaryEvent = false;
      if (t.stage === "satisfaction_check" && t.satisfaction_outcome) {
        const outcome = String(t.satisfaction_outcome);
        const isIssue = NEGATIVE_SATISFACTION_OUTCOMES.has(outcome);
        const resolvedEarlierIssue = !isIssue && ordersWithReportedIssues.has(t.order_id);
        if (isIssue) ordersWithReportedIssues.add(t.order_id);
        timeline.push({
          type: isIssue ? "issue_reported" : resolvedEarlierIssue ? "issue_resolved" : "satisfaction_check",
          at: t.logged_at,
          detail: resolvedEarlierIssue
            ? `Issue resolved: ${outcome.replace(/_/g, " ")}${t.satisfaction_notes ? " - " + t.satisfaction_notes : ""}`
            : `Satisfaction check: ${outcome.replace(/_/g, " ")}${t.satisfaction_notes ? " - " + t.satisfaction_notes : ""}`
        });
        hasPrimaryEvent = true;
      } else if (t.stage === "review_referral") {
        // A request and its eventual collection are two distinct moments
        // (Decision D) - show "requested" only while still outstanding, so
        // the exact scenario the spec describes ("Review requested;
        // customer agreed but hasn't sent it") renders correctly instead
        // of falling through to a generic contact-attempt line.
        if (t.review_requested_at && !t.review_collected) timeline.push({ type: "review_requested", at: t.review_requested_at, detail: "Review requested" });
        if (t.referral_requested_at && !t.referral_collected) timeline.push({ type: "referral_requested", at: t.referral_requested_at, detail: "Referral requested" });
        if (t.review_collected) timeline.push({ type: "review_collected", at: t.logged_at, detail: t.review_is_video ? "Video testimonial collected" : "Written review collected" });
        if (t.referral_collected) timeline.push({ type: "referral_collected", at: t.logged_at, detail: "Referral collected" });
        hasPrimaryEvent = !!(t.review_requested_at || t.referral_requested_at || t.review_collected || t.referral_collected);
      } else if (t.stage === "retention_sale" && t.retention_outcome) {
        timeline.push({ type: "retention_sale_attempt", at: t.logged_at, detail: `Retention sale ${t.retention_outcome}${t.resulting_order_id ? " — order #" + t.resulting_order_id : ""}` });
        hasPrimaryEvent = true;
      }

      if (t.next_action === "schedule_follow_up" && t.next_action_at) {
        const scheduledFor = new Date(t.next_action_at).toLocaleString("en-NG", {
          timeZone: "Africa/Lagos",
          dateStyle: "medium",
          timeStyle: "short"
        });
        timeline.push({
          type: "follow_up_scheduled",
          at: t.logged_at,
          detail: `Follow-up scheduled for ${scheduledFor}${t.next_action_note ? " - " + t.next_action_note : ""}`
        });
        hasPrimaryEvent = true;
      } else if (t.next_action === "do_not_contact") {
        timeline.push({ type: "do_not_contact", at: t.logged_at, detail: `Customer marked Do Not Contact${t.next_action_note ? " - " + t.next_action_note : ""}` });
        hasPrimaryEvent = true;
      } else if (t.next_action === "not_interested") {
        timeline.push({ type: "not_interested", at: t.logged_at, detail: `Customer is not interested${t.next_action_note ? " - " + t.next_action_note : ""}` });
        hasPrimaryEvent = true;
      } else if (t.next_action === "needs_resolution" && !hasPrimaryEvent) {
        timeline.push({ type: "issue_reported", at: t.logged_at, detail: `Issue needs resolution${t.next_action_note ? " - " + t.next_action_note : ""}` });
        hasPrimaryEvent = true;
      }

      if (!hasPrimaryEvent && t.reach_status) {
        timeline.push({ type: "contact_attempt", at: t.logged_at, detail: `Contact attempt (${String(t.reach_status).replace(/_/g, " ")})${t.next_action_note ? " - " + t.next_action_note : ""}` });
      } else if (
        hasPrimaryEvent
        && t.stage !== "satisfaction_check"
        && t.next_action_note
        && t.next_action !== "schedule_follow_up"
        && t.next_action !== "do_not_contact"
        && t.next_action !== "not_interested"
      ) {
        timeline.push({ type: "outcome_note", at: t.logged_at, detail: t.next_action_note });
      }
    }
    for (const event of actionEvents) {
      timeline.push({
        type: event.action_type === "whatsapp" ? "whatsapp_opened" : "call_opened",
        at: event.logged_at,
        detail: event.action_type === "whatsapp"
          ? "WhatsApp conversation opened"
          : "Customer call opened"
      });
    }
    timeline.sort((a, b) => a.at.localeCompare(b.at));

    let nextAction: { recommendedText: string; dueStage: string | null; orderId: string | null; dueAt: string | null; source: string } = {
      recommendedText: "No delivered order to follow up on yet.", dueStage: null, orderId: null, dueAt: null, source: "lifecycle"
    };
    if (delivered.length > 0) {
      const nowIso = new Date().toISOString();
      const today = dayKey(nowIso);
      const productIds = [...new Set(delivered.map((order) => order.product_id).filter(Boolean))] as string[];
      const { data: timingRows } = productIds.length > 0
        ? await supabase.from("products").select("id, retention_timing_overrides").in("id", productIds)
        : { data: [] as Array<{ id: string; retention_timing_overrides: Partial<RetentionTiming> | null }> };
      const timingByProductId = new Map(
        (timingRows ?? []).map((product) => [product.id, { ...DEFAULT_RETENTION_TIMING, ...(product.retention_timing_overrides ?? {}) }])
      );
      const actionCandidates = delivered
        .filter((order) => order.delivered_date)
        .map((order) => {
          const relevantTps = tps.filter((t) => t.order_id === order.id) as any;
          const timing = (order.product_id && timingByProductId.get(order.product_id)) || DEFAULT_RETENTION_TIMING;
          const lifecycle = dueStageFor(String(order.delivered_date).slice(0, 10), today, relevantTps, timing);
          const scheduled = scheduledFollowUpFor(relevantTps, nowIso);
          const rank =
            lifecycle.dueStage === "needs_resolution" ? 0
            : scheduled?.status === "overdue" ? 1
            : lifecycle.overdueBy > 0 ? 2
            : scheduled?.status === "due" ? 3
            : lifecycle.dueStage !== null ? 4
            : scheduled?.status === "scheduled" ? 5
            : 6;
          return { order, relevantTps, lifecycle, scheduled, rank };
        })
        .sort((a, b) =>
          a.rank - b.rank
          || b.lifecycle.overdueBy - a.lifecycle.overdueBy
          || String(a.scheduled?.nextActionAt ?? "").localeCompare(String(b.scheduled?.nextActionAt ?? ""))
          || String(b.order.delivered_date).localeCompare(String(a.order.delivered_date))
        );
      const selected = actionCandidates[0];
      const selectedOrder = selected.order;
      const { dueStage, overdueBy } = selected.lifecycle;
      const scheduled = selected.scheduled;
      if (scheduled) {
        const scheduledFor = new Date(scheduled.nextActionAt).toLocaleString("en-NG", {
          timeZone: "Africa/Lagos",
          dateStyle: "medium",
          timeStyle: "short"
        });
        const recommendedText = scheduled.status === "overdue"
          ? `Scheduled follow-up was due ${scheduledFor}. Contact the customer now.`
          : scheduled.status === "due"
            ? `Follow up with this customer today at ${scheduledFor.split(", ").pop() ?? scheduledFor}.`
            : `Follow up with this customer on ${scheduledFor}.`;
        nextAction = {
          recommendedText,
          dueStage,
          orderId: selectedOrder.id,
          dueAt: scheduled.nextActionAt,
          source: "scheduled_follow_up"
        };
      } else {
        const action =
          dueStage === "needs_resolution" ? "Resolve this customer's complaint"
          : dueStage === "satisfaction_check" ? "Run a satisfaction check"
          : dueStage === "review_referral" ? "Ask for a review or referral"
          : dueStage === "retention_sale" ? "Offer a repeat-purchase product"
          : dueStage === "win_back" ? "Attempt a win-back offer"
          : null;
        const recommendedText = action === null ? "No action currently due."
          : dueStage === "needs_resolution" ? `${action} now.`
          : overdueBy > 0 ? `${action} - ${overdueBy}d overdue.`
          : `${action} - due today.`;
        nextAction = { recommendedText, dueStage, orderId: selectedOrder.id, dueAt: null, source: "lifecycle" };
      }
    }

    // Simple, defensible status label (not a stored field) - "Needs
    // Attention" takes priority since an open complaint matters more than
    // order count.
    const customerStatus = nextAction.dueStage === "needs_resolution" ? "Needs Attention" : delivered.length > 1 ? "Repeat Buyer" : "New Customer";

    res.json({
      // Address comes off the LATEST order - if a customer moved, the rep
      // needs where to reach them now, not where their first parcel went.
      customer: { name: first.customer, phone: first.phone, address: latestOrder?.address ?? first.address ?? "", city: first.city, state: first.state, customerSince: first.created_at, status: customerStatus },
      summary: { totalOrders: orders.length, totalSpent, delivered: delivered.length, wrongDamagedReportsCount, ltv: totalSpent },
      latestOrder: latestOrder ? orderPurchaseBreakdown(latestOrder) : null,
      // Every order this customer has placed, itemised the same way, so the
      // rep can see the whole buying history - what was upsold, what was
      // cross-sold and by whom - before making the retention call.
      orderHistory: byCreatedDesc.map(orderPurchaseBreakdown),
      timeline,
      nextAction
    });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Failed to load customer detail." });
  }
});

const OutcomeFields = {
  reachStatus: z.enum(["reached", "not_reached", "not_reachable", "wrong_number"]).optional(),
  customerResponse: z.enum(["satisfied", "neutral", "complaint"]).optional(),
  nextAction: z.enum([
    "request_review", "request_referral", "offer_another_product",
    "schedule_follow_up", "needs_resolution", "not_interested", "do_not_contact"
  ]).optional(),
  nextActionAt: z.string().optional(),
  nextActionNote: z.string().max(500).optional(),
  // Migration 179. Null/absent means "not recorded" - averages skip those
  // rows rather than treating them as a zero-second call.
  callDurationSeconds: z.number().int().min(0).max(86400).nullable().optional()
};

const TouchpointSchema = z.discriminatedUnion("stage", [
  z.object({
    orderId: z.string().min(1),
    stage: z.literal("satisfaction_check"),
    // Optional (not just for the original satisfaction-check flow) - a
    // "Not Reached" attempt against this stage logs reachStatus alone,
    // with no outcome yet.
    satisfactionOutcome: z.enum(SATISFACTION_OUTCOMES).optional(),
    satisfactionNotes: z.string().max(2000).optional(),
    ...OutcomeFields
  }),
  z.object({
    orderId: z.string().min(1),
    stage: z.literal("review_referral"),
    reviewCollected: z.boolean().optional(),
    reviewText: z.string().max(4000).optional(),
    reviewIsVideo: z.boolean().optional(),
    mediaUrls: z.array(z.string().url()).max(10).optional(),
    adPermissionGranted: z.boolean().optional(),
    referralCollected: z.boolean().optional(),
    referralContactName: z.string().max(160).optional(),
    referralContactPhone: z.string().max(40).optional(),
    customerDiscountOwed: z.boolean().optional(),
    customerDiscountNote: z.string().max(300).optional(),
    // Decision D: a request is its own lightweight signal, independent of
    // whether it was also collected in the same visit. Server sets the
    // *_requested_at timestamp itself - never trusts a client-supplied one.
    reviewRequested: z.boolean().optional(),
    referralRequested: z.boolean().optional(),
    ...OutcomeFields
  }),
  z.object({
    orderId: z.string().min(1),
    stage: z.literal("retention_sale"),
    offeredProductId: z.string().uuid().optional(),
    offeredPackageId: z.string().uuid().optional(),
    // Optional for the same reason as satisfactionOutcome above - a
    // "Not Reached" or "Schedule Follow-up" attempt against this stage
    // doesn't have an outcome yet.
    retentionOutcome: z.enum(["accepted", "declined", "no_response"]).optional(),
    resultingOrderId: z.string().optional(),
    ...OutcomeFields
  })
]);

router.post("/touchpoints", requireRole(...RETENTION_ROLES), async (req, res) => {
  const parsed = TouchpointSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }
  const d = parsed.data;
  const orgId = req.user!.orgId;

  const { data: order } = await supabase
    .from("orders")
    .select("id, status")
    .eq("org_id", orgId)
    .eq("id", d.orderId)
    .maybeSingle();
  if (!order) { res.status(404).json({ error: "Order not found." }); return; }
  const recoveryRepId = await retentionRepForOrder(orgId, order.id);
  if (!canAccessAssignedRetentionOrder(req.user!.role, req.user!.id, recoveryRepId)) {
    res.status(403).json({ error: "This retention order is not assigned to you." });
    return;
  }
  if (order.status !== "Delivered") { res.status(400).json({ error: "Only Delivered orders can have a retention touchpoint logged." }); return; }

  const row: Record<string, unknown> = {
    org_id: orgId,
    order_id: d.orderId,
    stage: d.stage,
    logged_by: req.user!.id,
    logged_at: new Date().toISOString(),
    reach_status: d.reachStatus ?? null,
    customer_response: d.customerResponse ?? null,
    next_action: d.nextAction ?? null,
    next_action_at: d.nextActionAt ?? null,
    next_action_note: d.nextActionNote ?? null,
    call_duration_seconds: d.callDurationSeconds ?? null
  };
  if (d.stage === "satisfaction_check") {
    row.satisfaction_outcome = d.satisfactionOutcome ?? null;
    row.satisfaction_notes = d.satisfactionNotes ?? null;
  } else if (d.stage === "review_referral") {
    row.review_collected = d.reviewCollected ?? false;
    row.review_text = d.reviewText ?? null;
    row.review_is_video = d.reviewIsVideo ?? false;
    row.media_urls = d.mediaUrls ?? [];
    row.ad_permission_granted = d.adPermissionGranted ?? false;
    row.referral_collected = d.referralCollected ?? false;
    row.referral_contact_name = d.referralContactName ?? null;
    row.referral_contact_phone = d.referralContactPhone ?? null;
    row.customer_discount_owed = d.customerDiscountOwed ?? false;
    row.customer_discount_note = d.customerDiscountNote ?? null;
    const now = new Date().toISOString();
    row.review_requested_at = d.reviewRequested ? now : null;
    row.referral_requested_at = d.referralRequested ? now : null;
  } else {
    row.offered_product_id = d.offeredProductId ?? null;
    row.offered_package_id = d.offeredPackageId ?? null;
    row.retention_outcome = d.retentionOutcome ?? null;
    row.resulting_order_id = d.resultingOrderId ?? null;
  }

  const { data, error } = await supabase.from("customer_retention_touchpoints").insert(row).select("*").single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.status(201).json({ row: data });
});

const TouchpointPatchSchema = z.object({
  mediaUrls: z.array(z.string().url()).max(10).optional(),
  customerDiscountCleared: z.boolean().optional(),
  resultingOrderId: z.string().optional()
});

router.patch("/touchpoints/:id", requireRole(...RETENTION_ROLES), async (req, res) => {
  const parsed = TouchpointPatchSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten().fieldErrors }); return; }
  const update: Record<string, unknown> = {};
  if (parsed.data.mediaUrls) update.media_urls = parsed.data.mediaUrls;
  if (parsed.data.customerDiscountCleared) update.customer_discount_cleared_at = new Date().toISOString();
  if (parsed.data.resultingOrderId) update.resulting_order_id = parsed.data.resultingOrderId;
  if (Object.keys(update).length === 0) { res.status(400).json({ error: "Nothing to update." }); return; }

  let updateQuery = supabase
    .from("customer_retention_touchpoints")
    .update(update)
    .eq("org_id", req.user!.orgId)
    .eq("id", req.params.id);
  if (!RETENTION_SUPERVISOR_ROLES.has(req.user!.role)) {
    updateQuery = updateQuery.eq("logged_by", req.user!.id);
  }
  const { data, error } = await updateQuery
    .select("*")
    .maybeSingle();
  if (error) { res.status(500).json({ error: error.message }); return; }
  if (!data) { res.status(404).json({ error: "Touchpoint not found." }); return; }
  res.json({ row: data });
});

const VIDEO_MIME_EXT: Record<string, string> = { "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov" };
const IMAGE_MIME_EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/jpg": "jpg", "image/webp": "webp" };

router.post("/media/upload", requireRole(...RETENTION_ROLES), async (req, res) => {
  const dataUrl = typeof req.body?.dataUrl === "string" ? req.body.dataUrl : "";
  const match = dataUrl.match(/^data:((?:image|video)\/[a-z0-9.+-]+);base64,([\s\S]+)$/i);
  if (!match) { res.status(400).json({ error: "Invalid image/video data URL." }); return; }
  const mime = match[1].toLowerCase();
  const isVideo = mime.startsWith("video/");
  const ext = isVideo ? VIDEO_MIME_EXT[mime] : IMAGE_MIME_EXT[mime];
  if (!ext) { res.status(400).json({ error: `Unsupported media type: ${mime}.` }); return; }
  const buffer = Buffer.from(match[2], "base64");
  const maxBytes = isVideo ? 50 * 1024 * 1024 : 10 * 1024 * 1024;
  if (buffer.length > maxBytes) {
    res.status(413).json({ error: isVideo ? "Video exceeds 50MB limit." : "Image exceeds 10MB limit." });
    return;
  }
  const orgId = req.user!.orgId;
  const objectName = `${orgId}/${randomUUID()}.${ext}`;
  const { error: uploadError } = await supabase.storage
    .from("retention-media")
    .upload(objectName, buffer, { contentType: mime, upsert: false });
  if (uploadError) {
    logger.error("retention media upload failed", { orgId, objectName, error: uploadError.message });
    res.status(500).json({ error: uploadError.message });
    return;
  }
  const { data: publicData } = supabase.storage.from("retention-media").getPublicUrl(objectName);
  res.status(201).json({ url: publicData.publicUrl, path: objectName });
});

// Shared bonus-breakdown computation - used by /bonus-summary (single rep,
// "my bonus this period") and /dashboard-summary (org-wide retention
// revenue/ROI, which needs the same total-payout figure as its "cost").
async function computeBonusBreakdown(
  orgId: string,
  settings: Awaited<ReturnType<typeof loadBonusSettings>>,
  start: string,
  exclusiveEnd: string,
  logged_by: string | null
) {
  let query = supabase
    .from("customer_retention_touchpoints")
    .select("stage, satisfaction_outcome, review_collected, review_is_video, referral_collected, retention_outcome, resulting_order_id, logged_by, logged_at")
    .eq("org_id", orgId)
    .gte("logged_at", `${start}T00:00:00`)
    .lt("logged_at", `${exclusiveEnd}T00:00:00`);
  if (logged_by) query = query.eq("logged_by", logged_by);
  const { data: touchpoints, error } = await query;
  if (error) throw new Error(error.message);
  const rows = touchpoints ?? [];

  const satisfactionChecksLogged = rows.filter((r) => r.stage === "satisfaction_check").length;
  const writtenReviewsCollected = rows.filter((r) => r.stage === "review_referral" && r.review_collected && !r.review_is_video).length;
  const videoTestimonialsCollected = rows.filter((r) => r.stage === "review_referral" && r.review_is_video).length;
  const referralsCollected = rows.filter((r) => r.stage === "review_referral" && r.referral_collected).length;
  const retentionSaleRows = rows.filter((r) => r.stage === "retention_sale" && r.retention_outcome === "accepted" && r.resulting_order_id);

  let retentionSaleBonus = 0;
  const retentionSalesConverted: Array<{ resultingOrderId: string; amount: number }> = [];
  if (retentionSaleRows.length > 0) {
    const resultingIds = retentionSaleRows.map((r) => r.resulting_order_id as string);
    const { data: resultOrders } = await supabase.from("orders").select("id, amount").in("id", resultingIds);
    for (const r of retentionSaleRows) {
      const matched = (resultOrders ?? []).find((o) => o.id === r.resulting_order_id);
      const amount = Number(matched?.amount ?? 0);
      retentionSalesConverted.push({ resultingOrderId: r.resulting_order_id as string, amount });
      retentionSaleBonus += Math.round(amount * (settings.retentionSaleBonusPct / 100));
    }
  }

  const satisfactionBonus = satisfactionChecksLogged * settings.satisfactionCheckBonus;
  const reviewBonus = writtenReviewsCollected * settings.writtenReviewBonus;
  const videoBonus = videoTestimonialsCollected * settings.videoTestimonialBonus;
  const referralBonus = referralsCollected * settings.referralBonus;
  const total = satisfactionBonus + reviewBonus + videoBonus + referralBonus + retentionSaleBonus;

  return {
    satisfactionChecksLogged, writtenReviewsCollected, videoTestimonialsCollected, referralsCollected,
    retentionSalesConverted,
    breakdown: { satisfactionBonus, reviewBonus, videoBonus, referralBonus, retentionSaleBonus, total }
  };
}

router.get("/bonus-summary", requireRole(...RETENTION_ROLES), async (req, res) => {
  try {
    const orgId = req.user!.orgId;
    const settings = await loadBonusSettings(orgId);
    const { start, exclusiveEnd } = resolveDateBounds(req.query as Record<string, unknown>);
    const inclusiveEndDate = new Date(`${exclusiveEnd}T00:00:00Z`);
    inclusiveEndDate.setUTCDate(inclusiveEndDate.getUTCDate() - 1);
    const dateTo = inclusiveEndDate.toISOString().slice(0, 10);
    const userId = retentionRepScope(req.user!.role, req.user!.id, req.query.userId) ?? req.user!.id;

    const result = await computeBonusBreakdown(orgId, settings, start, exclusiveEnd, userId);
    res.json({ dateFrom: start, dateTo, userId, ...result });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Failed to load the retention bonus summary." });
  }
});

router.get("/dashboard-summary", requireRole(...RETENTION_ROLES), async (req, res) => {
  try {
    const orgId = req.user!.orgId;
    const settings = await loadBonusSettings(orgId);
    const { start, exclusiveEnd } = resolveDateBounds(req.query as Record<string, unknown>);
    const repId = retentionRepScope(req.user!.role, req.user!.id, req.query.repId);

    // Point-in-time snapshot (NOT date-ranged) - "Due Today"/"Overdue" and
    // the lifecycle pipeline describe the current state of every order in
    // the retention window, same rows the worklist itself uses.
    const allRows = await loadWorklistRows(orgId, settings);
    const scopedRows = repId ? allRows.filter((row) => row.assignedRepId === repId) : allRows;
    const dueToday = scopedRows.filter((r) =>
      r.followUpStatus === "due"
      || (r.followUpStatus === null && r.dueStage !== null && r.dueStage !== "needs_resolution" && r.overdueBy === 0)
    ).length;
    const overdue = scopedRows.filter((r) =>
      r.followUpStatus === "overdue"
      || (r.followUpStatus === null && r.overdueBy > 0)
    ).length;
    const lifecyclePipeline = {
      delivered: scopedRows.length,
      satisfactionDue: scopedRows.filter((r) => r.dueStage === "satisfaction_check").length,
      reviewDue: scopedRows.filter((r) => r.dueStage === "review_referral" && !r.reviewCollected).length,
      // Referral has its own later window (Day 14-30, vs Review's Day 7-14)
      // per the spec's lifecycle model - it only counts as "due" once that
      // window opens, even though both share one underlying touchpoints
      // stage (Decision A).
      referralDue: scopedRows.filter((r) => r.dueStage === "review_referral" && !r.referralCollected && r.daysSinceDelivery >= 14).length,
      retentionSaleDue: scopedRows.filter((r) => r.dueStage === "retention_sale").length,
      winBack: scopedRows.filter((r) => r.dueStage === "win_back").length,
      needsResolution: scopedRows.filter((r) => r.dueStage === "needs_resolution").length
    };

    // Date-range-scoped activity (what actually happened in the selected
    // period), optionally scoped to one rep's own logged_by rows.
    const bonusResult = await computeBonusBreakdown(orgId, settings, start, exclusiveEnd, repId);

    let contactedQuery = supabase
      .from("customer_retention_touchpoints")
      .select("order_id, reach_status, satisfaction_outcome, stage, logged_at, logged_by, retention_outcome, resulting_order_id, review_collected, referral_collected, review_requested_at, referral_requested_at")
      .eq("org_id", orgId)
      .gte("logged_at", `${start}T00:00:00`)
      .lt("logged_at", `${exclusiveEnd}T00:00:00`);
    if (repId) contactedQuery = contactedQuery.eq("logged_by", repId);
    const { data: activityRows, error: activityError } = await contactedQuery;
    if (activityError) { res.status(500).json({ error: activityError.message }); return; }
    const activity = activityRows ?? [];

    // "Contacted" = a real reach happened (rows logged before this
    // migration have no reach_status and represent a real logged
    // touchpoint, so they count too - only an explicit not-reached/
    // not-reachable/wrong-number attempt is excluded).
    const contactedOrderIds = new Set(
      activity.filter((r) => !NON_REACH_STATUSES.has(r.reach_status as string)).map((r) => r.order_id)
    );

    // "Issues Resolved" = a positive satisfaction check logged in this
    // period, for an order that has ALSO had a negative satisfaction
    // outcome at some point (i.e. this check actually resolved a prior
    // complaint, not just a first-time check). Shared between the
    // org-wide figure and the rep-scoped "My Retention Performance" one.
    const deriveIssuesResolved = async (rows: typeof activity): Promise<number> => {
      const positiveIds = [...new Set(
        rows.filter((r) => r.stage === "satisfaction_check" && r.satisfaction_outcome && !NEGATIVE_SATISFACTION_OUTCOMES.has(r.satisfaction_outcome)).map((r) => r.order_id)
      )];
      if (positiveIds.length === 0) return 0;
      const { data: allSatisfactionRows } = await supabase
        .from("customer_retention_touchpoints")
        .select("order_id, satisfaction_outcome")
        .eq("org_id", orgId)
        .eq("stage", "satisfaction_check")
        .in("order_id", positiveIds);
      const everHadNegative = new Set(
        (allSatisfactionRows ?? []).filter((r) => r.satisfaction_outcome && NEGATIVE_SATISFACTION_OUTCOMES.has(r.satisfaction_outcome)).map((r) => r.order_id)
      );
      return positiveIds.filter((id) => everHadNegative.has(id)).length;
    };
    const issuesResolved = await deriveIssuesResolved(activity);

    const reviews = activity.filter((r) => r.stage === "review_referral" && r.review_collected).length;
    const referrals = activity.filter((r) => r.stage === "review_referral" && r.referral_collected).length;

    // Decision D: Reviews and Referrals tracked independently, each with
    // its own requested-to-received conversion rate (a real ask-to-get
    // ratio, not an estimate).
    const reviewsRequested = activity.filter((r) => r.stage === "review_referral" && r.review_requested_at).length;
    const referralsRequested = activity.filter((r) => r.stage === "review_referral" && r.referral_requested_at).length;
    const reviewConversionPct = reviewsRequested > 0 ? Math.round((reviews / reviewsRequested) * 100) : null;
    const referralConversionPct = referralsRequested > 0 ? Math.round((referrals / referralsRequested) * 100) : null;

    const repeatSaleRows = activity.filter((r) => r.stage === "retention_sale" && r.retention_outcome === "accepted" && r.resulting_order_id);
    const repeatSalesRevenue = bonusResult.retentionSalesConverted.reduce((sum, r) => sum + r.amount, 0);
    const repeatCustomers = repeatSaleRows.length;
    const avgRepeatOrder = repeatCustomers > 0 ? Math.round(repeatSalesRevenue / repeatCustomers) : 0;
    const retentionRepCost = bonusResult.breakdown.total;

    // Real Gross Contribution = revenue - COGS - delivery cost, using the
    // same per-order cost lookup already relied on elsewhere (product_pricings
    // .unit_cost + orders.logistics_cost), not a fabricated margin number.
    let cogsAndLogistics = 0;
    const resultingIds = bonusResult.retentionSalesConverted.map((r) => r.resultingOrderId);
    if (resultingIds.length > 0) {
      const { data: resultOrdersFull } = await supabase
        .from("orders")
        .select("id, currency, logistics_cost, product_id, product_name, quantity, package_components_snapshot, cross_sell_lines, free_gift_lines")
        .in("id", resultingIds);
      const productIds = [...new Set((resultOrdersFull ?? []).flatMap((o) => orderInventoryLinesFromRow(o).map((l) => l.productId)))];
      const pricingMap = await loadPricingMap(productIds);
      cogsAndLogistics = (resultOrdersFull ?? []).reduce((sum, o) => sum + cogsForOrder(o, pricingMap) + numericAmount(o.logistics_cost), 0);
    }
    // ROI/"Retention Rep Cost" deliberately does NOT charge a second rep
    // salary - this isn't a new role, and repMonthlySalary is already
    // charged as a cost in the Recovery Rep Overview tab's own net-
    // contribution math. Cost here is the actual bonus paid out for this
    // period's retention work, so this never double-counts.
    const grossContribution = repeatSalesRevenue - cogsAndLogistics;
    const roi = retentionRepCost > 0 ? Math.round((grossContribution / retentionRepCost) * 100) / 100 : null;

    // "My Retention Performance" - always scoped to a specific rep
    // (defaults to the caller), independent of whether the figures above
    // are org-wide (repId omitted) or already rep-scoped.
    const performanceRepId = repId ?? req.user!.id;
    const repActivity = activity.filter((r) => r.logged_by === performanceRepId);
    const repBonusResult = repId === performanceRepId ? bonusResult : await computeBonusBreakdown(orgId, settings, start, exclusiveEnd, performanceRepId);

    const assignedTaskOrderIds = new Set([
      ...allRows
        .filter((row) =>
          row.assignedRepId === performanceRepId
          && (row.dueStage !== null || row.followUpStatus !== null)
        )
        .map((row) => row.orderId),
      ...repActivity.map((row) => row.order_id)
    ]);
    const tasksAssigned = assignedTaskOrderIds.size;
    const completedStageOrderIds = new Set(
      repActivity.filter((r) =>
        (r.stage === "satisfaction_check" && r.satisfaction_outcome) ||
        (r.stage === "review_referral" && (r.review_collected || r.referral_collected)) ||
        (r.stage === "retention_sale" && r.retention_outcome)
      ).map((r) => r.order_id)
    );
    const tasksCompleted = completedStageOrderIds.size;
    const repCustomersReached = new Set(
      repActivity.filter((r) => !NON_REACH_STATUSES.has(r.reach_status as string)).map((r) => r.order_id)
    ).size;
    const repIssuesResolved = await deriveIssuesResolved(repActivity);
    const repReviewsReceived = repActivity.filter((r) => r.stage === "review_referral" && r.review_collected).length;
    const repReferralsGenerated = repActivity.filter((r) => r.stage === "review_referral" && r.referral_collected).length;

    const repRetentionSaleRows = repActivity.filter((r) => r.stage === "retention_sale" && r.retention_outcome === "accepted" && r.resulting_order_id);
    let revenueOverTime: Array<{ label: string; current: number }> = [];
    // Revenue source comes from the resulting order. Older retention orders
    // with no explicit source remain under Repeat Sales instead of being
    // attributed to a referral or review without evidence.
    let revenueBySource: Array<{ label: string; amount: number; pct: number }> = [];
    let repRetentionRevenue = 0;
    if (repRetentionSaleRows.length > 0) {
      const resultingIds = repRetentionSaleRows.map((r) => r.resulting_order_id as string);
      const { data: resultOrders } = await supabase.from("orders").select("id, amount, source").in("id", resultingIds);
      const infoById = new Map((resultOrders ?? []).map((o) => [o.id, {
        amount: Number(o.amount ?? 0),
        source: String(o.source ?? "")
      }]));
      const byDay = new Map<string, number>();
      const bySource = new Map<string, number>();
      for (const r of repRetentionSaleRows) {
        const info = infoById.get(r.resulting_order_id as string);
        if (!info) continue;
        const day = dayKey(r.logged_at);
        byDay.set(day, (byDay.get(day) ?? 0) + info.amount);
        const normalizedSource = info.source.toLowerCase();
        const sourceLabel = normalizedSource.includes("referral")
          ? "Referrals"
          : normalizedSource.includes("review") || normalizedSource.includes("testimonial")
            ? "Reviews"
            : normalizedSource.includes("win")
              ? "Win-back"
              : normalizedSource.includes("cross")
                ? "Retention Cross-sell"
                : "Repeat Sales";
        bySource.set(sourceLabel, (bySource.get(sourceLabel) ?? 0) + info.amount);
        repRetentionRevenue += info.amount;
      }
      revenueOverTime = Array.from(byDay.entries()).sort((a, b) => a[0].localeCompare(b[0])).map(([day, amount]) => ({ label: day.slice(5), current: amount }));
      revenueBySource = Array.from(bySource.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([label, amount]) => ({ label, amount, pct: repRetentionRevenue > 0 ? Math.round((amount / repRetentionRevenue) * 100) : 0 }));
    }
    const repAvgRepeatOrder = repRetentionSaleRows.length > 0 ? Math.round(repRetentionRevenue / repRetentionSaleRows.length) : 0;
    const repRoi = repBonusResult.breakdown.total > 0 ? Math.round((repRetentionRevenue / repBonusResult.breakdown.total) * 100) / 100 : null;

    const repPerformance = {
      tasksAssigned, tasksCompleted,
      completionRatePct: tasksAssigned > 0 ? Math.round((tasksCompleted / tasksAssigned) * 100) : 0,
      customersReached: repCustomersReached,
      contactRatePct: tasksAssigned > 0 ? Math.round((repCustomersReached / tasksAssigned) * 100) : 0,
      issuesResolved: repIssuesResolved,
      reviewsReceived: repReviewsReceived,
      referralsGenerated: repReferralsGenerated,
      repeatPurchases: repRetentionSaleRows.length,
      retentionRevenue: repRetentionRevenue,
      avgRepeatOrder: repAvgRepeatOrder,
      roi: repRoi,
      revenueOverTime,
      revenueBySource
    };

    // Manager/Owner-only cross-rep workload breakdown for the Reports page -
    // reuses the already-fetched `activity` + the resulting-order amounts
    // already looked up for the org-wide bonus breakdown, so no extra
    // per-rep queries beyond one rep-name lookup.
    let repBreakdown: Array<{
      repId: string; repName: string; tasksAssigned: number; tasksCompleted: number; completionRatePct: number;
      issuesResolved: number; reviewConversionPct: number | null; referralConversionPct: number | null; retentionRevenue: number;
    }> | undefined;
    if (["Owner", "Admin", "Manager"].includes(req.user!.role)) {
      const amountByResultingOrderId = new Map(bonusResult.retentionSalesConverted.map((r) => [r.resultingOrderId, r.amount]));
      const distinctReps = [...new Set([
        ...allRows.map((row) => row.assignedRepId).filter(Boolean),
        ...activity.map((r) => r.logged_by).filter(Boolean)
      ])] as string[];
      const { data: breakdownUsers } = distinctReps.length > 0
        ? await supabase.from("users").select("id, name").in("id", distinctReps)
        : { data: [] as { id: string; name: string }[] };
      const breakdownNameById = new Map((breakdownUsers ?? []).map((u) => [u.id, u.name]));
      repBreakdown = await Promise.all(distinctReps.map(async (id) => {
        const rows = activity.filter((r) => r.logged_by === id);
        const assigned = new Set([
          ...allRows
            .filter((row) =>
              row.assignedRepId === id
              && (row.dueStage !== null || row.followUpStatus !== null)
            )
            .map((row) => row.orderId),
          ...rows.map((row) => row.order_id)
        ]).size;
        const completed = new Set(rows.filter((r) =>
          (r.stage === "satisfaction_check" && r.satisfaction_outcome) ||
          (r.stage === "review_referral" && (r.review_collected || r.referral_collected)) ||
          (r.stage === "retention_sale" && r.retention_outcome)
        ).map((r) => r.order_id)).size;
        const repIssuesResolvedForBreakdown = await deriveIssuesResolved(rows);
        const reviewsReq = rows.filter((r) => r.stage === "review_referral" && r.review_requested_at).length;
        const reviewsRecv = rows.filter((r) => r.stage === "review_referral" && r.review_collected).length;
        const referralsReq = rows.filter((r) => r.stage === "review_referral" && r.referral_requested_at).length;
        const referralsRecv = rows.filter((r) => r.stage === "review_referral" && r.referral_collected).length;
        const revenue = rows
          .filter((r) => r.stage === "retention_sale" && r.retention_outcome === "accepted" && r.resulting_order_id)
          .reduce((sum, r) => sum + (amountByResultingOrderId.get(r.resulting_order_id as string) ?? 0), 0);
        return {
          repId: id,
          repName: breakdownNameById.get(id) ?? "Unknown",
          tasksAssigned: assigned,
          tasksCompleted: completed,
          completionRatePct: assigned > 0 ? Math.round((completed / assigned) * 100) : 0,
          issuesResolved: repIssuesResolvedForBreakdown,
          reviewConversionPct: reviewsReq > 0 ? Math.round((reviewsRecv / reviewsReq) * 100) : null,
          referralConversionPct: referralsReq > 0 ? Math.round((referralsRecv / referralsReq) * 100) : null,
          retentionRevenue: revenue
        };
      }));
      repBreakdown.sort((a, b) => b.retentionRevenue - a.retentionRevenue);
    }

    res.json({
      dateFrom: start,
      dateTo: exclusiveEnd,
      kpis: {
        dueToday, overdue,
        contacted: contactedOrderIds.size,
        issuesResolved,
        reviews, referrals,
        repeatCustomers, repeatSalesRevenue
      },
      lifecyclePipeline,
      reviewsReferrals: { reviewsRequested, reviewsReceived: reviews, reviewConversionPct, referralsRequested, referralsReceived: referrals, referralConversionPct },
      retentionRevenue: { repeatSalesRevenue, repeatCustomers, avgRepeatOrder, grossContribution, retentionRepCost, roi },
      repPerformance,
      repBreakdown,
      bonus: {
        earned: bonusResult.breakdown.total,
        target: settings.monthlyBonusTarget,
        progressPct: settings.monthlyBonusTarget > 0 ? Math.min(100, Math.round((bonusResult.breakdown.total / settings.monthlyBonusTarget) * 100)) : 0
      }
    });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Failed to load the customer retention dashboard summary." });
  }
});

// GET /activity-log - every touchpoint logged in the period, newest first,
// joined against orders for display. Backs the Calls & Outcomes, Reviews,
// Referrals, and Repeat Sales sidebar pages (each just passes a different
// `stage`/framing on top of the same feed).
router.get("/activity-log", requireRole(...RETENTION_ROLES), async (req, res) => {
  try {
    const orgId = req.user!.orgId;
    const { start, exclusiveEnd } = resolveDateBounds(req.query as Record<string, unknown>);
    const stageFilter = typeof req.query.stage === "string" ? req.query.stage : null;
    const repId = retentionRepScope(req.user!.role, req.user!.id, req.query.repId);
    const search = typeof req.query.search === "string" ? req.query.search.trim().toLowerCase() : "";

    let query = supabase
      .from("customer_retention_touchpoints")
      .select("id, order_id, stage, logged_by, logged_at, reach_status, customer_response, next_action, next_action_at, next_action_note, call_duration_seconds, satisfaction_outcome, satisfaction_notes, review_requested_at, review_collected, review_is_video, review_text, media_urls, ad_permission_granted, referral_requested_at, referral_collected, referral_contact_name, referral_contact_phone, customer_discount_owed, customer_discount_cleared_at, offered_product_id, offered_package_id, retention_outcome, resulting_order_id")
      .eq("org_id", orgId)
      .gte("logged_at", `${start}T00:00:00`)
      .lt("logged_at", `${exclusiveEnd}T00:00:00`)
      .order("logged_at", { ascending: false })
      .limit(200);
    if (stageFilter) query = query.eq("stage", stageFilter);
    if (repId) query = query.eq("logged_by", repId);
    const { data: touchpoints, error } = await query;
    if (error) { res.status(500).json({ error: error.message }); return; }
    const rows = touchpoints ?? [];

    let actionRows: any[] = [];
    if (!stageFilter) {
      let actionQuery = supabase
        .from(ACTION_EVENTS_TABLE)
        .select("id, order_id, action_type, context, logged_by, logged_at")
        .eq("org_id", orgId)
        .gte("logged_at", `${start}T00:00:00`)
        .lt("logged_at", `${exclusiveEnd}T00:00:00`)
        .order("logged_at", { ascending: false })
        .limit(200);
      if (repId) actionQuery = actionQuery.eq("logged_by", repId);
      const { data: events, error: actionError } = await actionQuery;
      if (actionError && !isMissingActionEventsTable(actionError)) {
        res.status(500).json({ error: actionError.message });
        return;
      }
      actionRows = events ?? [];
    }
    if (rows.length === 0 && actionRows.length === 0) { res.json({ rows: [] }); return; }

    const orderIds = [...new Set([...rows.map((r) => r.order_id), ...actionRows.map((r) => r.order_id)])];
    const { data: orders } = await supabase.from("orders").select("id, customer, phone, product_name, amount, currency").in("id", orderIds);
    const orderById = new Map((orders ?? []).map((o) => [o.id, o]));

    const repIds = [...new Set([...rows.map((r) => r.logged_by), ...actionRows.map((r) => r.logged_by)].filter(Boolean))] as string[];
    const { data: repUsers } = repIds.length > 0 ? await supabase.from("users").select("id, name").in("id", repIds) : { data: [] as { id: string; name: string }[] };
    const repNameById = new Map((repUsers ?? []).map((u) => [u.id, u.name]));

    const touchpointResult = rows
      .map((r) => {
        const order = orderById.get(r.order_id);
        return {
          id: r.id,
          activityType: "outcome",
          orderId: r.order_id,
          customerName: order?.customer ?? "Unknown",
          phone: order?.phone ?? "",
          productName: order?.product_name ?? "",
          orderAmount: numericAmount(order?.amount),
          orderCurrency: order?.currency ?? "NGN",
          stage: r.stage,
          loggedBy: r.logged_by,
          loggedByName: r.logged_by ? (repNameById.get(r.logged_by) ?? "Unknown") : "Unknown",
          loggedAt: r.logged_at,
          reachStatus: r.reach_status,
          customerResponse: r.customer_response,
          nextAction: r.next_action,
          nextActionAt: r.next_action_at ?? null,
          nextActionNote: r.next_action_note,
          callDurationSeconds: r.call_duration_seconds ?? null,
          satisfactionOutcome: r.satisfaction_outcome,
          satisfactionNotes: r.satisfaction_notes,
          reviewRequestedAt: r.review_requested_at,
          reviewCollected: r.review_collected,
          reviewIsVideo: r.review_is_video,
          reviewText: r.review_text,
          mediaUrls: r.media_urls,
          adPermissionGranted: r.ad_permission_granted,
          referralRequestedAt: r.referral_requested_at,
          referralCollected: r.referral_collected,
          referralContactName: r.referral_contact_name,
          referralContactPhone: r.referral_contact_phone,
          customerDiscountOwed: r.customer_discount_owed,
          customerDiscountClearedAt: r.customer_discount_cleared_at,
          offeredProductId: r.offered_product_id,
          offeredPackageId: r.offered_package_id,
          retentionOutcome: r.retention_outcome,
          resultingOrderId: r.resulting_order_id
        };
      });
    const actionResult = actionRows.map((r) => {
      const order = orderById.get(r.order_id);
      return {
        id: r.id,
        activityType: r.action_type,
        orderId: r.order_id,
        customerName: order?.customer ?? "Unknown",
        phone: order?.phone ?? "",
        productName: order?.product_name ?? "",
        orderAmount: numericAmount(order?.amount),
        orderCurrency: order?.currency ?? "NGN",
        stage: null,
        loggedBy: r.logged_by,
        loggedByName: r.logged_by ? (repNameById.get(r.logged_by) ?? "Unknown") : "Unknown",
        loggedAt: r.logged_at,
        context: r.context,
        reachStatus: null,
        customerResponse: null,
        nextAction: null,
        nextActionAt: null,
        nextActionNote: null,
        callDurationSeconds: null,
        satisfactionOutcome: null,
        satisfactionNotes: null,
        reviewRequestedAt: null,
        reviewCollected: false,
        reviewIsVideo: false,
        reviewText: null,
        mediaUrls: [],
        adPermissionGranted: false,
        referralRequestedAt: null,
        referralCollected: false,
        referralContactName: null,
        referralContactPhone: null,
        customerDiscountOwed: false,
        customerDiscountClearedAt: null,
        offeredProductId: null,
        offeredPackageId: null,
        retentionOutcome: null,
        resultingOrderId: null
      };
    });
    const result = [...touchpointResult, ...actionResult]
      .sort((a, b) => String(b.loggedAt).localeCompare(String(a.loggedAt)))
      .slice(0, 200)
      .filter((r) => !search || r.customerName.toLowerCase().includes(search) || r.phone.includes(search) || r.orderId.toLowerCase().includes(search));

    res.json({ rows: result });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Failed to load the retention activity log." });
  }
});

// GET/PATCH /product-timing - per-product lifecycle timing overrides
// (migration 175). Read is available to all retention roles (the worklist
// needs it); write is Owner-only, same gating as the bonus settings.
router.get("/product-timing", requireRole(...RETENTION_ROLES), async (req, res) => {
  try {
    const orgId = req.user!.orgId;
    const { data, error } = await supabase
      .from("products")
      .select("id, name, retention_timing_overrides")
      .eq("org_id", orgId)
      .eq("active", true)
      .order("name", { ascending: true });
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json({
      products: (data ?? []).map((p) => ({ id: p.id, name: p.name, timing: p.retention_timing_overrides ?? null }))
    });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Could not load per-product retention timing." });
  }
});

const ProductTimingSchema = z.object({
  satisfactionDays: z.number().int().min(0).max(365).optional(),
  reviewDays: z.number().int().min(0).max(365).optional(),
  repeatSaleStartDays: z.number().int().min(0).max(365).optional(),
  repeatSaleEndDays: z.number().int().min(0).max(365).optional(),
  winBackEndDays: z.number().int().min(0).max(365).optional()
});

router.patch("/product-timing/:productId", requireRole("Owner"), async (req, res) => {
  const parsed = ProductTimingSchema.safeParse(req.body ?? {});
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten().fieldErrors }); return; }
  const hasAnyOverride = Object.keys(parsed.data).length > 0;
  const { data, error } = await supabase
    .from("products")
    .update({ retention_timing_overrides: hasAnyOverride ? parsed.data : null })
    .eq("org_id", req.user!.orgId)
    .eq("id", req.params.productId)
    .select("id, name, retention_timing_overrides")
    .maybeSingle();
  if (error) { res.status(500).json({ error: error.message }); return; }
  if (!data) { res.status(404).json({ error: "Product not found." }); return; }
  res.json({ product: { id: data.id, name: data.name, timing: data.retention_timing_overrides ?? null } });
});

router.get("/settings", requireRole(...RETENTION_ROLES), async (req, res) => {
  try {
    const settings = await loadBonusSettings(req.user!.orgId);
    res.json({ settings });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Could not load retention bonus settings." });
  }
});

router.patch("/settings", requireRole("Owner"), async (req, res) => {
  const body = req.body ?? {};
  const payload = {
    org_id: req.user!.orgId,
    satisfaction_check_bonus: Number(body.satisfactionCheckBonus ?? DEFAULT_BONUS_SETTINGS.satisfactionCheckBonus),
    written_review_bonus: Number(body.writtenReviewBonus ?? DEFAULT_BONUS_SETTINGS.writtenReviewBonus),
    video_testimonial_bonus: Number(body.videoTestimonialBonus ?? DEFAULT_BONUS_SETTINGS.videoTestimonialBonus),
    referral_bonus: Number(body.referralBonus ?? DEFAULT_BONUS_SETTINGS.referralBonus),
    retention_sale_bonus_pct: Number(body.retentionSaleBonusPct ?? DEFAULT_BONUS_SETTINGS.retentionSaleBonusPct),
    customer_discount_pct: Number(body.customerDiscountPct ?? DEFAULT_BONUS_SETTINGS.customerDiscountPct),
    high_value_order_threshold: Number(body.highValueOrderThreshold ?? DEFAULT_BONUS_SETTINGS.highValueOrderThreshold),
    monthly_bonus_target: Number(body.monthlyBonusTarget ?? DEFAULT_BONUS_SETTINGS.monthlyBonusTarget),
    updated_by: req.user!.id,
    updated_at: new Date().toISOString()
  };
  const { error } = await supabase
    .from("customer_retention_bonus_settings")
    .upsert(payload, { onConflict: "org_id" });
  if (error) { res.status(500).json({ error: error.message }); return; }
  // Re-load through the same camelCase mapping GET uses, so both endpoints
  // return an identical shape - the raw upserted row is snake_case.
  const settings = await loadBonusSettings(req.user!.orgId);
  res.json({ settings });
});

// ---------------------------------------------------------------------------
// Manual retention tasks (migration 178).
//
// These sit ALONGSIDE the derived lifecycle worklist, never replacing it.
// Derived tasks stay the source of truth for bonuses and KPI reporting; a
// manual task is a reminder someone created by hand.
// ---------------------------------------------------------------------------

const MANUAL_TASK_TYPES = [
  "satisfaction_check", "complaint_follow_up", "review_request", "referral_request",
  "repeat_sale_offer", "win_back_call", "scheduled_follow_up", "general_check_in"
] as const;

const ManualTaskSchema = z.object({
  orderId: z.string().trim().min(1).nullable().optional(),
  customerName: z.string().trim().min(1, "Customer name is required."),
  customerPhone: z.string().trim().min(1, "Customer phone is required."),
  taskType: z.enum(MANUAL_TASK_TYPES),
  title: z.string().trim().min(1, "Task title is required."),
  note: z.string().trim().max(2000).nullable().optional(),
  priority: z.enum(["high", "medium", "low"]).default("medium"),
  dueAt: z.string().datetime({ offset: true }),
  assignedRepId: z.string().uuid().nullable().optional()
});

const ManualTaskUpdateSchema = z.object({
  status: z.enum(["pending", "completed", "cancelled"]).optional(),
  priority: z.enum(["high", "medium", "low"]).optional(),
  dueAt: z.string().datetime({ offset: true }).optional(),
  assignedRepId: z.string().uuid().nullable().optional(),
  title: z.string().trim().min(1).optional(),
  note: z.string().trim().max(2000).nullable().optional()
});

const BulkAssignSchema = z.object({
  taskIds: z.array(z.string().uuid()).min(1, "Select at least one task."),
  assignedRepId: z.string().uuid().nullable()
});

const ImportTasksSchema = z.object({
  tasks: z.array(ManualTaskSchema).min(1, "Nothing to import.").max(200, "Import at most 200 tasks at a time.")
});

function manualTaskRow(row: any) {
  return {
    id: row.id,
    orderId: row.order_id ?? null,
    customerName: row.customer_name,
    customerPhone: row.customer_phone,
    taskType: row.task_type,
    title: row.title,
    note: row.note ?? null,
    priority: row.priority,
    status: row.status,
    dueAt: row.due_at,
    assignedRepId: row.assigned_rep_id ?? null,
    assignedRepName: row.assigned_rep?.name ?? null,
    completedAt: row.completed_at ?? null,
    createdAt: row.created_at
  };
}

const MANUAL_TASK_SELECT = "id, order_id, customer_name, customer_phone, task_type, title, note, priority, status, due_at, assigned_rep_id, completed_at, created_at, assigned_rep:users!customer_retention_tasks_assigned_rep_id_fkey(name)";

router.get("/tasks", requireRole(...RETENTION_ROLES), async (req, res) => {
  try {
    const orgId = req.user!.orgId;
    let query = supabase
      .from(MANUAL_TASKS_TABLE)
      .select(MANUAL_TASK_SELECT)
      .eq("org_id", orgId)
      .order("due_at", { ascending: true })
      .limit(500);

    // A Recovery Rep sees their own tasks plus anything still unassigned.
    if (!RETENTION_SUPERVISOR_ROLES.has(req.user!.role)) {
      query = query.or(`assigned_rep_id.eq.${req.user!.id},assigned_rep_id.is.null`);
    }

    const { data, error } = await query;
    if (error) {
      if (isMissingManualTasksTable(error)) { res.json({ rows: [], pendingMigration: true }); return; }
      res.status(500).json({ error: error.message });
      return;
    }
    res.json({ rows: (data ?? []).map(manualTaskRow) });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Could not load manual tasks." });
  }
});

router.post("/tasks", requireRole(...RETENTION_ROLES), async (req, res) => {
  const parsed = ManualTaskSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten().fieldErrors }); return; }
  try {
    const { data, error } = await supabase
      .from(MANUAL_TASKS_TABLE)
      .insert({
        org_id: req.user!.orgId,
        order_id: parsed.data.orderId ?? null,
        customer_name: parsed.data.customerName,
        customer_phone: parsed.data.customerPhone,
        task_type: parsed.data.taskType,
        title: parsed.data.title,
        note: parsed.data.note ?? null,
        priority: parsed.data.priority,
        due_at: parsed.data.dueAt,
        assigned_rep_id: parsed.data.assignedRepId ?? null,
        created_by: req.user!.id
      })
      .select(MANUAL_TASK_SELECT)
      .single();
    if (error) {
      if (isMissingManualTasksTable(error)) { res.status(503).json({ error: "Manual tasks are still being activated on this environment." }); return; }
      res.status(500).json({ error: error.message });
      return;
    }
    res.status(201).json({ row: manualTaskRow(data) });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Could not create the task." });
  }
});

router.patch("/tasks/:id", requireRole(...RETENTION_ROLES), async (req, res) => {
  const parsed = ManualTaskUpdateSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten().fieldErrors }); return; }
  try {
    const orgId = req.user!.orgId;
    const { data: existing, error: findError } = await supabase
      .from(MANUAL_TASKS_TABLE)
      .select("id, assigned_rep_id")
      .eq("org_id", orgId)
      .eq("id", req.params.id)
      .maybeSingle();
    if (findError) {
      if (isMissingManualTasksTable(findError)) { res.status(503).json({ error: "Manual tasks are still being activated on this environment." }); return; }
      res.status(500).json({ error: findError.message });
      return;
    }
    if (!existing) { res.status(404).json({ error: "Task not found." }); return; }
    // A rep may only touch their own task; supervisors may touch any.
    if (!RETENTION_SUPERVISOR_ROLES.has(req.user!.role) && existing.assigned_rep_id && existing.assigned_rep_id !== req.user!.id) {
      res.status(403).json({ error: "This task is not assigned to you." });
      return;
    }

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (parsed.data.status !== undefined) {
      patch.status = parsed.data.status;
      patch.completed_at = parsed.data.status === "completed" ? new Date().toISOString() : null;
      patch.completed_by = parsed.data.status === "completed" ? req.user!.id : null;
    }
    if (parsed.data.priority !== undefined) patch.priority = parsed.data.priority;
    if (parsed.data.dueAt !== undefined) patch.due_at = parsed.data.dueAt;
    if (parsed.data.assignedRepId !== undefined) patch.assigned_rep_id = parsed.data.assignedRepId;
    if (parsed.data.title !== undefined) patch.title = parsed.data.title;
    if (parsed.data.note !== undefined) patch.note = parsed.data.note;

    const { data, error } = await supabase
      .from(MANUAL_TASKS_TABLE)
      .update(patch)
      .eq("org_id", orgId)
      .eq("id", req.params.id)
      .select(MANUAL_TASK_SELECT)
      .single();
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json({ row: manualTaskRow(data) });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Could not update the task." });
  }
});

router.post("/tasks/bulk-assign", requireRole("Owner", "Admin", "Manager"), async (req, res) => {
  const parsed = BulkAssignSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten().fieldErrors }); return; }
  try {
    const { data, error } = await supabase
      .from(MANUAL_TASKS_TABLE)
      .update({ assigned_rep_id: parsed.data.assignedRepId, updated_at: new Date().toISOString() })
      .eq("org_id", req.user!.orgId)
      .in("id", parsed.data.taskIds)
      .select("id");
    if (error) {
      if (isMissingManualTasksTable(error)) { res.status(503).json({ error: "Manual tasks are still being activated on this environment." }); return; }
      res.status(500).json({ error: error.message });
      return;
    }
    res.json({ updated: (data ?? []).length });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Could not reassign the tasks." });
  }
});

router.post("/tasks/import", requireRole("Owner", "Admin", "Manager"), async (req, res) => {
  const parsed = ImportTasksSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten().fieldErrors }); return; }
  try {
    const rows = parsed.data.tasks.map((task) => ({
      org_id: req.user!.orgId,
      order_id: task.orderId ?? null,
      customer_name: task.customerName,
      customer_phone: task.customerPhone,
      task_type: task.taskType,
      title: task.title,
      note: task.note ?? null,
      priority: task.priority,
      due_at: task.dueAt,
      assigned_rep_id: task.assignedRepId ?? null,
      created_by: req.user!.id
    }));
    const { data, error } = await supabase.from(MANUAL_TASKS_TABLE).insert(rows).select("id");
    if (error) {
      if (isMissingManualTasksTable(error)) { res.status(503).json({ error: "Manual tasks are still being activated on this environment." }); return; }
      res.status(500).json({ error: error.message });
      return;
    }
    res.status(201).json({ imported: (data ?? []).length });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Could not import the tasks." });
  }
});

export default router;
