import { Router } from "express";
import { z } from "zod";
import {
  buildChallengeMilestones,
  repCheckpoint,
  challengeMilestoneCount,
  evaluateChallengeProgress,
  type ChallengeLifecycleStatus
} from "../lib/manager-product-challenge.js";
import { supabase } from "../lib/supabase.js";
import { humanFieldErrors } from "../lib/validation-message.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { REPORT_ROW_CEILING } from "../lib/query-limits.js";
import { logger } from "../lib/logger.js";
import { INCENTIVE_EXPENSE_CATEGORY, calendarMonthOf, challengeWeekStarts, incentiveExpenseIdPrefix, incentiveExpenseSplit, incentiveTier, incentiveWindow, monthlyDeliveryRate, payableAmount } from "../lib/challenge-incentive.js";

const router = Router();
router.use(requireAuth, requireRole("Owner", "Admin", "Manager", "Sales Rep"));

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ChallengeFields = z.object({
  productId: z.string().uuid(),
  name: z.string().trim().min(2).max(160),
  cadence: z.enum(["weekly", "monthly", "quarterly"]),
  targetUnits: z.coerce.number().int().min(1).max(10_000_000),
  startDate: z.string().regex(DATE_KEY_PATTERN),
  endDate: z.string().regex(DATE_KEY_PATTERN),
  rewardAmount: z.coerce.number().min(0).max(1_000_000_000),
  currency: z.enum(["NGN", "GHS", "USD", "GBP", "EUR"]).default("NGN"),
  milestoneMode: z.enum(["none", "weekly"]).default("none"),
  milestoneDistribution: z.enum(["even", "custom"]).default("even"),
  milestoneTargets: z.array(z.coerce.number().int().min(1).max(10_000_000)).max(24).default([]),
  status: z.enum(["draft", "active", "paused", "completed"]).default("active"),
  description: z.string().trim().max(1000).default(""),
  managerRewardAmount: z.coerce.number().min(0).max(1_000_000_000).default(0)
}).strict();

const ChallengeSchema = ChallengeFields.superRefine((value, context) => {
  if (value.endDate < value.startDate) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "End date must be on or after the start date.", path: ["endDate"] });
  }
  if (value.milestoneMode === "weekly" && value.milestoneDistribution === "custom") {
    const count = challengeMilestoneCount(value.cadence);
    if (value.targetUnits < count) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: `The challenge target must be at least ${count} pieces when weekly milestones are enabled.`, path: ["targetUnits"] });
    } else if (value.milestoneTargets.length !== count) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: `Enter exactly ${count} weekly milestone targets.`, path: ["milestoneTargets"] });
    } else if (value.milestoneTargets.reduce((sum, target) => sum + target, 0) !== value.targetUnits) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Weekly milestone targets must add up to the full challenge target.", path: ["milestoneTargets"] });
    }
  }
  if (value.milestoneMode === "weekly" && value.milestoneDistribution === "even" && value.targetUnits < challengeMilestoneCount(value.cadence)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: `The challenge target must be at least ${challengeMilestoneCount(value.cadence)} pieces when weekly milestones are enabled.`, path: ["targetUnits"] });
  }
});

const PatchSchema = ChallengeFields.partial().strict();

const AllocationSchema = z.object({
  repId: z.string().uuid(),
  targetUnits: z.coerce.number().int().min(1).max(10_000_000),
  rewardAmount: z.coerce.number().min(0).max(1_000_000_000),
  milestoneTargets: z.array(z.coerce.number().int().min(1).max(10_000_000)).max(24).default([])
}).strict();
const AllocationsSchema = z.object({ allocations: z.array(AllocationSchema).min(1).max(500) }).strict();

const todayInLagos = () => new Date(Date.now() + 3_600_000).toISOString().slice(0, 10);
const lagosDateKeyFromIso = (value: string) => {
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? new Date(timestamp + 3_600_000).toISOString().slice(0, 10) : "";
};
const toWatUtcIso = (dateKey: string, edge: "start" | "end") =>
  new Date(`${dateKey}T${edge === "start" ? "00:00:00.000" : "23:59:59.999"}+01:00`).toISOString();
const distributeWholeNumber = (total: number, count: number) => {
  const base = Math.floor(Math.max(0, total) / Math.max(1, count));
  const remainder = Math.max(0, total) - base * Math.max(1, count);
  return Array.from({ length: Math.max(1, count) }, (_, index) => base + (index < remainder ? 1 : 0));
};
const distributeMoney = (total: number, count: number) => {
  const cents = Math.round(Math.max(0, total) * 100);
  return distributeWholeNumber(cents, count).map((value) => value / 100);
};

const rowToApi = (
  row: any,
  progress: ReturnType<typeof evaluateChallengeProgress>,
  qualifiedOrders: number,
  milestoneResult: ReturnType<typeof buildChallengeMilestones>,
  overrides: Record<string, unknown> = {}
) => ({
  id: row.id,
  productId: row.product_id,
  name: row.name,
  cadence: row.cadence,
  targetUnits: Number(row.target_units ?? 0),
  startDate: row.start_date,
  endDate: row.end_date,
  rewardAmount: Number(row.reward_amount ?? 0),
  currency: row.currency,
  milestoneMode: row.milestone_mode ?? "none",
  milestoneDistribution: row.milestone_distribution ?? "even",
  milestoneTargets: Array.isArray(row.milestone_targets) ? row.milestone_targets.map(Number) : [],
  milestones: milestoneResult.milestones,
  earnedRewardAmount: milestoneResult.earnedRewardAmount,
  status: row.status,
  description: row.description ?? "",
  managerRewardAmount: Number(row.manager_reward_amount ?? 0),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  qualifiedOrders,
  ...progress
  ,...overrides
});

const rowPayload = (value: z.infer<typeof ChallengeSchema>, req: any) => ({
  org_id: req.user.orgId,
  product_id: value.productId,
  name: value.name,
  cadence: value.cadence,
  target_units: value.targetUnits,
  start_date: value.startDate,
  end_date: value.endDate,
  reward_amount: value.rewardAmount,
  currency: value.currency,
  milestone_mode: value.milestoneMode,
  milestone_distribution: value.milestoneDistribution,
  milestone_targets: value.milestoneMode === "weekly" && value.milestoneDistribution === "custom" ? value.milestoneTargets : [],
  status: value.status,
  description: value.description,
  manager_reward_amount: value.managerRewardAmount,
  updated_by: req.user.id,
  updated_at: new Date().toISOString()
});

async function verifyProduct(orgId: string, productId: string) {
  const { data, error } = await supabase.from("products").select("id").eq("org_id", orgId).eq("id", productId).maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

async function hasOverlap(orgId: string, productId: string, startDate: string, endDate: string, excludeId?: string) {
  let query = supabase
    .from("manager_product_challenges")
    .select("id")
    .eq("org_id", orgId)
    .eq("product_id", productId)
    .eq("status", "active")
    .lte("start_date", endDate)
    .gte("end_date", startDate)
    .limit(1);
  if (excludeId) query = query.neq("id", excludeId);
  const { data, error } = await query;
  if (error) throw error;
  return Boolean(data?.length);
}

router.get("/", async (req, res) => {
  res.set("Cache-Control", "no-store, max-age=0");
  // ⚠️ VIEW-AS. An Owner previewing a rep sends X-Spy-User-Id and the middleware
  // sets effectiveUserRole/effectiveUserId; req.user.role stays "Owner". Reading
  // req.user directly here showed the Owner the TEAM figures and dropped every
  // personal field, so the preview rendered zeros for a rep who had deliveries.
  const scopeRole = req.user!.effectiveUserRole ?? req.user!.role;
  const scopeId = req.user!.effectiveUserId ?? req.user!.id;
  // The dashboard's period filter. It NEVER changes target, progress or pace -
  // a monthly challenge scoped to "Today" would read 0/2,727 and "Behind",
  // which is a false alarm, not information. It only adds "delivered in this
  // window" alongside the running total.
  const dateKey = (value: unknown) => (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null);
  const windowFrom = dateKey(req.query.from);
  const windowTo = dateKey(req.query.to);
  if (req.headers["x-spy-user-id"]) {
    logger.info("challenge_view_as_scope", {
      realRole: req.user!.role,
      effectiveRole: req.user!.effectiveUserRole ?? null,
      scopeRole,
      spiedAsRep: scopeRole === "Sales Rep",
      scopeIdTail: scopeId.slice(-6),
      realIdTail: req.user!.id.slice(-6)
    });
  }
  try {
    const { data: rows, error } = await supabase
      .from("manager_product_challenges")
      .select("*")
      .eq("org_id", req.user!.orgId)
      .order("start_date", { ascending: false });
    if (error) throw error;
    if (!rows?.length) {
      res.json({ challenges: [], canEdit: scopeRole === "Owner" });
      return;
    }

    const earliest = rows.reduce((value, row) => row.start_date < value ? row.start_date : value, rows[0].start_date);
    const latest = rows.reduce((value, row) => row.end_date > value ? row.end_date : value, rows[0].end_date);
    const deliveredOrdersQuery = supabase
      .from("orders")
      .select("id, product_id, quantity, status, created_at, delivered_date, assigned_rep_id, review_hold")
      .limit(REPORT_ROW_CEILING)
      .eq("org_id", req.user!.orgId)
      // ⚠️ status is the order_status ENUM, not text. ilike compiles to ~~*,
      // which Postgres defines for text only, so it errors instead of matching.
      // Case is normalised in JS below, where the real matching happens.
      .eq("status", "Delivered")
      .gte("delivered_date", earliest)
      .lte("delivered_date", latest)
      .or("review_hold.is.null,review_hold.eq.false");
    const activityOrdersQuery = supabase
      .from("orders")
      .select("id, product_id, quantity, status, created_at, delivered_date, assigned_rep_id, review_hold")
      .limit(REPORT_ROW_CEILING)
      .eq("org_id", req.user!.orgId)
      .gte("created_at", toWatUtcIso(earliest, "start"))
      .lte("created_at", toWatUtcIso(latest, "end"))
      .or("review_hold.is.null,review_hold.eq.false");
    const [{ data: deliveredOrders, error: deliveredOrdersError }, { data: activityOrders, error: activityOrdersError }] = await Promise.all([deliveredOrdersQuery, activityOrdersQuery]);
    if (deliveredOrdersError) throw deliveredOrdersError;
    if (activityOrdersError) throw activityOrdersError;
    // A delivery can be created before the target period and completed inside it.
    // Merge by id so delivered-date recognition never loses backdated orders.
    const orders = Array.from(new Map([...(activityOrders ?? []), ...(deliveredOrders ?? [])].map((order) => [order.id, order])).values());

    const today = todayInLagos();
    const challengeIds = rows.map((row) => row.id);
    const { data: allocationRows, error: allocationError } = await supabase
      .from("manager_product_challenge_allocations")
      .select("challenge_id, rep_id, target_units, reward_amount, milestone_targets")
      .eq("org_id", req.user!.orgId)
      .in("challenge_id", challengeIds);
    // Keep the existing challenge view available while the additive allocation
    // migration rolls through environments. Equal split is explicitly marked
    // as a fallback; it is never persisted or treated as manager allocation.
    if (allocationError && !/relation .*manager_product_challenge_allocations.*does not exist/i.test(allocationError.message ?? "")) throw allocationError;
    const { data: activeReps, error: repsError } = await supabase.from("users")
      .select("id, name, email")
      .eq("org_id", req.user!.orgId).eq("role", "Sales Rep").eq("active", true)
      .order("name", { ascending: true });
    if (repsError) throw repsError;
    const fallbackRepCount = Math.max(1, activeReps?.length ?? 0);

    // ── Monthly incentive (Bright, 3 Oct 2026) ──
    // Each product challenge pays its earned reward the first week after the
    // calendar month, cut by the person's delivery rate for that month.
    // Rate (Bright, 3 Oct 2026): the WHOLE calendar month the challenge ends
    // in (1 - 30 Sept for a 30 Aug - 26 Sept challenge), Orders page formula:
    // orders placed in the month that are delivered / orders placed in the
    // month, all products; a rep's own, the whole company for the manager.
    // Pieces and weekly targets stay on the challenge's own dates.
    const rateMonths = rows.map((row) => calendarMonthOf(row.end_date));
    const rateFrom = rateMonths.reduce((value, month) => month.from < value ? month.from : value, rateMonths[0].from);
    const rateTo = rateMonths.reduce((value, month) => month.to > value ? month.to : value, rateMonths[0].to);
    const { data: rateOrders, error: rateOrdersError } = await supabase
      .from("orders")
      .select("id, status, created_at, assigned_rep_id")
      .limit(REPORT_ROW_CEILING)
      .eq("org_id", req.user!.orgId)
      .gte("created_at", toWatUtcIso(rateFrom, "start"))
      .lte("created_at", toWatUtcIso(rateTo, "end"))
      .or("review_hold.is.null,review_hold.eq.false");
    if (rateOrdersError) throw rateOrdersError;
    const { data: payoutRows, error: payoutError } = await supabase.from("challenge_incentive_payouts").select("*")
      .eq("org_id", req.user!.orgId).in("challenge_id", challengeIds);
    if (payoutError && !/relation .*challenge_incentive_payouts.*does not exist/i.test(payoutError.message ?? "")) throw payoutError;
    const { data: leaders } = await supabase.from("users").select("id, name, role")
      .eq("org_id", req.user!.orgId).in("role", ["Manager", "Admin"]).eq("active", true).order("name", { ascending: true });
    // The manager reward goes to the active Manager; with none, the Admin who runs the team.
    const managerRecipient = (leaders ?? []).find((user) => user.role === "Manager") ?? (leaders ?? [])[0] ?? null;
    const lagosDay = (iso: unknown) => (iso ? new Date(String(iso)).toLocaleDateString("en-CA", { timeZone: "Africa/Lagos" }) : "");
    const monthRate = (from: string, to: string, repId: string | null) => {
      const placedOrders = (rateOrders ?? []).filter((order) => (!repId || order.assigned_rep_id === repId)
        && lagosDay(order.created_at) >= from && lagosDay(order.created_at) <= to);
      const delivered = placedOrders.filter((order) => String(order.status ?? "").trim().toLowerCase() === "delivered").length;
      return { placed: placedOrders.length, delivered, rate: monthlyDeliveryRate(placedOrders.length, delivered) };
    };
    const payoutFor = (challengeId: string, kind: "rep" | "manager", personId: string | null) => {
      const paid: any = (payoutRows ?? []).find((item: any) => item.challenge_id === challengeId && item.person_kind === kind && (kind === "manager" || item.person_id === personId));
      return paid ? { paidAt: paid.paid_at, paidBy: paid.paid_by_name, amount: Number(paid.payable_amount), earned: Number(paid.earned_amount), rate: paid.delivery_rate === null ? null : Number(paid.delivery_rate), tierPercent: paid.tier_percent, personName: paid.person_name, note: paid.note } : null;
    };
    type IncentiveDetail = {
      targetUnits: number; deliveredUnits: number;
      milestones: Array<{ index: number; startDate: string; endDate: string; targetUnits: number; progressUnits: number; rewardAmount: number; earnedRewardAmount: number; status: string }>;
    };
    const incentiveLine = (challengeId: string, kind: "rep" | "manager", personId: string | null, personName: string, earned: number, rewardAmount: number, endDate: string, detail?: IncentiveDetail) => {
      const calendar = calendarMonthOf(endDate);
      const month = monthRate(calendar.from, calendar.to, kind === "rep" ? personId : null);
      const tier = incentiveTier(month.rate);
      return {
        kind, personId, personName, rewardAmount, earned: Math.round(earned * 100) / 100,
        placed: month.placed, delivered: month.delivered, rate: month.rate, tier,
        payable: payableAmount(earned, tier.percent), paid: payoutFor(challengeId, kind, personId),
        // The detailed breakdown (Bright, 3 Oct 2026): pieces against the
        // product target and each weekly milestone, so a rep can see how the
        // earned figure was made.
        targetUnits: detail?.targetUnits ?? 0,
        deliveredUnits: detail?.deliveredUnits ?? 0,
        milestones: (detail?.milestones ?? []).map((milestone) => ({
          index: milestone.index, startDate: milestone.startDate, endDate: milestone.endDate, targetUnits: milestone.targetUnits,
          progressUnits: milestone.progressUnits, rewardAmount: milestone.rewardAmount, earnedRewardAmount: milestone.earnedRewardAmount, status: milestone.status
        }))
      };
    };

    const challenges = rows.map((row) => {
      const teamProductOrders = (orders ?? []).filter((order) => order.product_id === row.product_id);
      const teamMatching = (orders ?? []).filter((order) => {
        const deliveredDate = String(order.delivered_date ?? "").slice(0, 10);
        const status = String(order.status ?? "").trim().toLowerCase();
        return order.product_id === row.product_id
          && status === "delivered"
          && deliveredDate >= row.start_date
          && deliveredDate <= row.end_date;
      });
      const teamTargetUnits = Number(row.target_units ?? 0);
      const teamRewardAmount = Number(row.reward_amount ?? 0);
      const storedAllocations = (allocationRows ?? []).filter((allocation) => allocation.challenge_id === row.id);
      const targetShares = distributeWholeNumber(teamTargetUnits, fallbackRepCount);
      const rewardShares = distributeMoney(teamRewardAmount, fallbackRepCount);
      const allocations = storedAllocations.length > 0 ? storedAllocations : (activeReps ?? []).map((rep, index) => ({
        challenge_id: row.id,
        rep_id: rep.id,
        target_units: targetShares[index] ?? 0,
        reward_amount: rewardShares[index] ?? 0,
        milestone_targets: []
      }));
      const ownAllocation = allocations.find((allocation) => allocation.rep_id === scopeId);
      const targetUnits = scopeRole === "Sales Rep"
        ? Number(ownAllocation?.target_units ?? Math.ceil(teamTargetUnits / Math.max(1, allocations.length || fallbackRepCount)))
        : teamTargetUnits;
      const rewardAmount = scopeRole === "Sales Rep"
        ? Number(ownAllocation?.reward_amount ?? (teamRewardAmount / Math.max(1, allocations.length || fallbackRepCount)))
        : teamRewardAmount;
      const matching = scopeRole === "Sales Rep" ? teamMatching.filter((order) => order.assigned_rep_id === scopeId) : teamMatching;
      const productOrders = scopeRole === "Sales Rep" ? teamProductOrders.filter((order) => order.assigned_rep_id === scopeId) : teamProductOrders;
      const progressUnits = matching.reduce((sum, order) => sum + Math.max(0, Number(order.quantity ?? 0)), 0);
      const inWindow = (order: { delivered_date?: string | null }) => {
        if (!windowFrom || !windowTo) return false;
        const deliveredDate = String(order.delivered_date ?? "").slice(0, 10);
        return deliveredDate >= windowFrom && deliveredDate <= windowTo;
      };
      const windowOrders = windowFrom && windowTo ? matching.filter(inWindow) : [];
      const windowDeliveredPieces = windowOrders.reduce((sum, order) => sum + Math.max(0, Number(order.quantity ?? 0)), 0);
      const progress = evaluateChallengeProgress({
        startDate: row.start_date,
        endDate: row.end_date,
        targetUnits,
        progressUnits,
        status: row.status as ChallengeLifecycleStatus,
        today
      });
      const milestoneResult = buildChallengeMilestones({
        cadence: row.cadence,
        startDate: row.start_date,
        endDate: row.end_date,
        targetUnits,
        rewardAmount,
        milestoneMode: row.milestone_mode ?? "none",
        milestoneDistribution: row.milestone_distribution ?? "even",
        milestoneTargets: Array.isArray(row.milestone_targets) ? row.milestone_targets.map(Number) : [],
        status: row.status as ChallengeLifecycleStatus,
        today,
        orders: matching.map((order) => ({
          dateKey: String(order.delivered_date ?? "").slice(0, 10),
          units: Number(order.quantity ?? 0)
        }))
      });
      const managerMilestoneResult = buildChallengeMilestones({
        cadence: row.cadence,
        startDate: row.start_date,
        endDate: row.end_date,
        targetUnits: teamTargetUnits,
        rewardAmount: Number(row.manager_reward_amount ?? 0),
        milestoneMode: row.milestone_mode ?? "none",
        milestoneDistribution: row.milestone_distribution ?? "even",
        milestoneTargets: Array.isArray(row.milestone_targets) ? row.milestone_targets.map(Number) : [],
        status: row.status as ChallengeLifecycleStatus,
        today,
        orders: teamMatching.map((order) => ({
          dateKey: String(order.delivered_date ?? "").slice(0, 10),
          units: Number(order.quantity ?? 0)
        }))
      });
      const confirmedPieces = productOrders.filter((order) => ["confirmed", "in process", "dispatched"].includes(String(order.status ?? "").trim().toLowerCase())).reduce((sum, order) => sum + Math.max(0, Number(order.quantity ?? 0)), 0);
      const deliveredPieces = matching.reduce((sum, order) => sum + Math.max(0, Number(order.quantity ?? 0)), 0);
      // ⚠️ THE CHECKPOINT TODAY FALLS IN, then the first one still open.
      //
      // The order used to be the other way round, and "In Progress" is a REWARD
      // state here, not a date: buildChallengeMilestones keeps a checkpoint
      // "In Progress" until the cumulative total clears it, and only calls it
      // "Missed" once the whole challenge has ended. So an uncleared week 1
      // stayed "the current milestone" for the rest of the month - and once its
      // own end date passed, days-left floored at 0, which made "needed daily"
      // 0 pcs/day and told the rep to deliver nothing while they were behind.
      //
      // Nothing is lost by preferring the date: while week 1 is genuinely live
      // both lookups return it, and after it closes the honest question is what
      // is owed by the NEXT checkpoint - which, being cumulative, already
      // carries week 1's shortfall.
      const currentMilestone = milestoneResult.milestones.find((milestone) => today >= milestone.startDate && today <= milestone.endDate)
        ?? milestoneResult.milestones.find((milestone) => milestone.status === "In Progress");
      const allocationDetails = allocations.map((allocation) => {
        const rep = (activeReps ?? []).find((item) => item.id === allocation.rep_id);
        const repDeliveredOrders = teamMatching.filter((order) => order.assigned_rep_id === allocation.rep_id);
        const repDeliveredPieces = repDeliveredOrders.reduce((sum, order) => sum + Math.max(0, Number(order.quantity ?? 0)), 0);
        const repConfirmedPieces = teamProductOrders.filter((order) => order.assigned_rep_id === allocation.rep_id && ["confirmed", "in process", "dispatched"].includes(String(order.status ?? "").trim().toLowerCase())).reduce((sum, order) => sum + Math.max(0, Number(order.quantity ?? 0)), 0);
        const allocationTarget = Number(allocation.target_units ?? 0);
        // ⚠️ SCALE AGAINST THE BASE THE MILESTONE LADDER WAS BUILT FROM, which
        // is `targetUnits` - the team total for a manager, this rep's own total
        // when a rep (or an Owner previewing one) is the scope. See repCheckpoint
        // for what dividing by teamTargetUnits regardless of scope did to the
        // rep's own dashboard.
        //
        // In rep scope only the scope rep's own row is returned (`allocations`
        // is emptied below), so no other rep is measured against a base that is
        // not theirs.
        const checkpoint = repCheckpoint({
          milestone: currentMilestone,
          milestoneScaleBase: targetUnits,
          allocationTarget,
          challengeStartDate: row.start_date,
          today,
          orders: repDeliveredOrders.map((order) => ({
            dateKey: String(order.delivered_date ?? "").slice(0, 10),
            units: Number(order.quantity ?? 0)
          }))
        });
        // ── Day-by-day, for the calendar behind each rep card ──
        //
        // ⚠️ THE PACE HERE IS THE ORIGINAL FLAT ONE, NOT requiredPace.
        // requiredPace is forward-looking - remaining ÷ days left - so it RISES
        // every time a day is missed. Judging Monday against a pace that only
        // became that high because Monday was missed marks a rep behind twice
        // for one miss. A calendar of past days needs the pace that was true
        // when the day happened, which is the flat target ÷ window.
        const windowDayCount = Math.max(1, Math.round(
          (new Date(`${row.end_date}T12:00:00Z`).getTime() - new Date(`${row.start_date}T12:00:00Z`).getTime()) / 86_400_000) + 1);
        const dailyTargetPace = allocationTarget > 0 ? allocationTarget / windowDayCount : 0;
        const piecesByDay = new Map<string, number>();
        repDeliveredOrders.forEach((order) => {
          const key = String(order.delivered_date ?? "").slice(0, 10);
          if (!key) return;
          piecesByDay.set(key, (piecesByDay.get(key) ?? 0) + Math.max(0, Number(order.quantity ?? 0)));
        });
        // Every day in the window, including the empty ones - a calendar that
        // omits blank days hides exactly the days worth looking at.
        const dailyProgress: Array<{ dateKey: string; pieces: number }> = [];
        for (let offset = 0; offset < windowDayCount; offset += 1) {
          const cursor = new Date(`${row.start_date}T12:00:00Z`);
          cursor.setUTCDate(cursor.getUTCDate() + offset);
          const key = cursor.toISOString().slice(0, 10);
          dailyProgress.push({ dateKey: key, pieces: piecesByDay.get(key) ?? 0 });
        }

        // ⚠️ ADDITIVE, exactly like the challenge-level window figures: the
        // period filter reports what this rep did INSIDE it and never rescopes
        // targetUnits, progressPercent or requiredPace. Scoping a monthly
        // challenge to "Today" would read 0 / 2,727 and "Behind", which is a
        // false alarm rather than information.
        //
        // Without these the filter had no visible effect on the rep cards at
        // all - the challenge tile changed and the rep cards below it did not,
        // which is why it looked like the filter was being ignored.
        const repWindowOrders = windowFrom && windowTo
          ? repDeliveredOrders.filter((order) => {
            const deliveredDate = String(order.delivered_date ?? "").slice(0, 10);
            return deliveredDate >= windowFrom && deliveredDate <= windowTo;
          })
          : [];
        // This rep's own milestones, for the reward they have earned so far.
        const repMilestones = buildChallengeMilestones({
          cadence: row.cadence, startDate: row.start_date, endDate: row.end_date,
          targetUnits: allocationTarget, rewardAmount: Number(allocation.reward_amount ?? 0),
          milestoneMode: row.milestone_mode ?? "none", milestoneDistribution: row.milestone_distribution ?? "even",
          milestoneTargets: Array.isArray(allocation.milestone_targets) && allocation.milestone_targets.length ? allocation.milestone_targets.map(Number) : [],
          status: row.status as ChallengeLifecycleStatus, today,
          orders: repDeliveredOrders.map((order) => ({ dateKey: String(order.delivered_date ?? "").slice(0, 10), units: Number(order.quantity ?? 0) }))
        });
        return {
          repId: allocation.rep_id,
          repName: rep?.name ?? rep?.email ?? "Sales rep",
          earnedRewardAmount: repMilestones.earnedRewardAmount,
          incentiveDetail: { targetUnits: allocationTarget, deliveredUnits: repDeliveredPieces, milestones: repMilestones.milestones } as IncentiveDetail,
          dailyTargetPace: Math.round(dailyTargetPace * 100) / 100,
          dailyProgress,
          windowDeliveredPieces: repWindowOrders.reduce((sum, order) => sum + Math.max(0, Number(order.quantity ?? 0)), 0),
          windowQualifiedOrders: repWindowOrders.length,
          targetUnits: allocationTarget,
          rewardAmount: Number(allocation.reward_amount ?? 0),
          milestoneTargets: Array.isArray(allocation.milestone_targets) ? allocation.milestone_targets.map(Number) : [],
          deliveredPieces: repDeliveredPieces,
          confirmedPieces: repConfirmedPieces,
          awaitingDeliveryPieces: repConfirmedPieces,
          qualifiedOrders: repDeliveredOrders.length,
          progressPercent: allocationTarget > 0 ? Math.min(100, Math.round((repDeliveredPieces / allocationTarget) * 100)) : 0,
          requiredPace: row.end_date >= today ? Math.ceil(Math.max(0, allocationTarget - repDeliveredPieces) / Math.max(1, progress.daysLeft)) : 0,
          currentWeekTarget: checkpoint.targetUnits,
          currentWeekDelivered: checkpoint.deliveredUnits,
          // The checkpoint being counted, so the panel can name it instead of
          // saying "this week" over a figure that runs from the challenge start.
          currentWeekIndex: checkpoint.index,
          currentWeekEndDate: checkpoint.endDate,
          currentWeekRemaining: checkpoint.remainingUnits,
          currentWeekDaysLeft: checkpoint.daysLeft,
          currentWeekWorkingDaysLeft: checkpoint.workingDaysLeft,
          todayDeliveredPieces: repDeliveredOrders.filter((order) => String(order.delivered_date ?? "").slice(0, 10) === today).reduce((sum, order) => sum + Math.max(0, Number(order.quantity ?? 0)), 0),
          persisted: storedAllocations.length > 0
        };
      });
      const ownAllocationDetails = allocationDetails.find((allocation) => allocation.repId === scopeId);
      const window = incentiveWindow(row.end_date, today);
      const repLines = allocationDetails.map((detail) => incentiveLine(row.id, "rep", detail.repId, detail.repName, detail.earnedRewardAmount, detail.rewardAmount, row.end_date, detail.incentiveDetail));
      const rateMonth = calendarMonthOf(row.end_date);
      const incentive = {
        from: row.start_date, to: row.end_date, rateFrom: rateMonth.from, rateTo: rateMonth.to, dueFrom: window.dueFrom, dueBy: window.dueBy, status: window.status,
        manager: scopeRole === "Sales Rep" ? null : incentiveLine(row.id, "manager", managerRecipient?.id ?? null, managerRecipient?.name ?? "Manager",
          managerMilestoneResult.earnedRewardAmount, Number(row.manager_reward_amount ?? 0), row.end_date, {
            targetUnits: teamTargetUnits,
            deliveredUnits: teamMatching.reduce((sum, order) => sum + Math.max(0, Number(order.quantity ?? 0)), 0),
            milestones: managerMilestoneResult.milestones
          }),
        reps: scopeRole === "Sales Rep" ? repLines.filter((line) => line.personId === scopeId) : repLines
      };
      return rowToApi({ ...row, target_units: targetUnits, reward_amount: rewardAmount }, progress, matching.length, milestoneResult, {
        allocations: scopeRole === "Sales Rep" ? [] : allocationDetails.map(({ incentiveDetail: _detail, ...rest }) => rest),
        allocationMode: storedAllocations.length > 0 ? "manager_allocated" : "equal_split_fallback",
        teamProgressUnits: teamMatching.reduce((sum, order) => sum + Math.max(0, Number(order.quantity ?? 0)), 0),
        teamQualifiedOrders: teamMatching.length,
        teamTargetUnits,
        teamRewardAmount,
        managerRewardAmount: Number(row.manager_reward_amount ?? 0),
        managerEarnedRewardAmount: managerMilestoneResult.earnedRewardAmount,
        incentive,
        windowFrom,
        windowTo,
        windowDeliveredPieces,
        windowQualifiedOrders: windowOrders.length,
        // Lagos' today, not the browser's. The calendar rings the same day the
        // progress maths above counted up to.
        today,
        // ⚠️ WHICH FIGURES THESE ARE. The rep-only fields (currentWeek*,
        // dailyProgress) exist ONLY in the Sales Rep branch below, so a team
        // payload reaching a rep's panel makes every one of them fall back to
        // 0 - "This week: 0 pcs, 0 needed, 0 days left" on a challenge that is
        // behind. That is indistinguishable from a maths bug unless the payload
        // says what it is, which is what this field is for.
        scope: scopeRole === "Sales Rep" ? "rep" : "team",
        ...(scopeRole === "Sales Rep" ? {
        teamTargetUnits,
        teamRewardAmount,
        allocationMode: storedAllocations.length > 0 && ownAllocation ? "manager_allocated" : "equal_split_fallback",
        allocationTargetUnits: ownAllocation?.target_units ?? null,
        allocationRewardAmount: ownAllocation?.reward_amount ?? null,
        confirmedPieces,
        deliveredPieces,
        awaitingDeliveryPieces: confirmedPieces
        ,currentWeekTarget: ownAllocationDetails?.currentWeekTarget ?? 0
        ,currentWeekDelivered: ownAllocationDetails?.currentWeekDelivered ?? 0
        ,currentWeekRemaining: ownAllocationDetails?.currentWeekRemaining ?? 0
        ,currentWeekDaysLeft: ownAllocationDetails?.currentWeekDaysLeft ?? 0
        ,currentWeekWorkingDaysLeft: ownAllocationDetails?.currentWeekWorkingDaysLeft ?? 0
        ,currentWeekIndex: ownAllocationDetails?.currentWeekIndex ?? 0
        ,currentWeekEndDate: ownAllocationDetails?.currentWeekEndDate ?? null
        ,todayDeliveredPieces: ownAllocationDetails?.todayDeliveredPieces ?? 0
        // The rep's own day-by-day. It was computed for every allocation
        // already but only ever reached a manager, because `allocations` is
        // emptied for a rep - so the rep could not see the calendar of their
        // own days that their manager could.
        ,dailyTargetPace: ownAllocationDetails?.dailyTargetPace ?? 0
        ,dailyProgress: ownAllocationDetails?.dailyProgress ?? []
        } : {})
      });
    });
    res.json({ challenges, canEdit: scopeRole === "Owner", reps: scopeRole === "Sales Rep" ? [] : (activeReps ?? []) });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Could not load product challenges." });
  }
});

// ── Monthly incentive: mark paid (Bright, 3 Oct 2026) ──
// Manager, Admin or Owner records each payment (one person, or everyone at
// once). The amounts are the ones shown on the card; the server re-checks the
// tier from the rate so a payment always matches the 70 / 65 / 60 rule, and
// only once the month has ended. Undo is Owner only.
// Each payment is also booked as a "Bonuses & Incentives" expense spread over
// the challenge's weeks (Bright, 3 Oct 2026), and undo removes those rows.
const PaidSchema = z.object({
  note: z.string().trim().max(300).optional(),
  people: z.array(z.object({
    kind: z.enum(["rep", "manager"]),
    personId: z.string().uuid().nullable(),
    personName: z.string().trim().max(120),
    earned: z.number().min(0).max(100_000_000),
    rate: z.number().min(0).max(100).nullable()
  })).min(1).max(100)
});

router.post("/:id/incentive/paid", requireRole("Manager", "Admin", "Owner"), async (req, res) => {
  const parsed = PaidSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: humanFieldErrors(parsed.error) }); return; }
  try {
    const { data: challenge, error } = await supabase.from("manager_product_challenges").select("id, start_date, end_date, branch_id, name")
      .eq("org_id", req.user!.orgId).eq("id", String(req.params.id)).maybeSingle();
    if (error) throw error;
    if (!challenge) { res.status(404).json({ error: "Challenge not found." }); return; }
    const window = incentiveWindow(challenge.end_date, todayInLagos());
    if (window.status === "accruing") { res.status(400).json({ error: `This month's incentive can be paid from ${window.dueFrom}, after the month ends.` }); return; }
    const { data: actor } = await supabase.from("users").select("name").eq("id", req.user!.id).maybeSingle();
    const rows = parsed.data.people.map((person) => {
      const tier = incentiveTier(person.rate);
      return {
        org_id: req.user!.orgId, branch_id: challenge.branch_id ?? null, challenge_id: challenge.id, person_kind: person.kind,
        person_id: person.personId, person_name: person.personName, earned_amount: person.earned, delivery_rate: person.rate,
        tier_percent: tier.percent, payable_amount: payableAmount(person.earned, tier.percent), note: parsed.data.note ?? null,
        paid_by: req.user!.id, paid_by_name: actor?.name ?? null, paid_at: new Date().toISOString()
      };
    });
    // Already-paid people are left as they were (paying twice is refused).
    const { data: existing } = await supabase.from("challenge_incentive_payouts").select("person_kind, person_id").eq("challenge_id", challenge.id);
    const fresh = rows.filter((row) => !(existing ?? []).some((item: any) => item.person_kind === row.person_kind && (row.person_kind === "manager" || item.person_id === row.person_id)));
    if (fresh.length) {
      const insert = await supabase.from("challenge_incentive_payouts").insert(fresh).select("id, person_name, payable_amount");
      if (insert.error) throw insert.error;
      // Book the money as expenses, a share in each challenge week.
      const weeks = challengeWeekStarts(challenge.start_date, challenge.end_date);
      const monthLabel = new Date(`${calendarMonthOf(challenge.end_date).from}T12:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
      const productLabel = String(challenge.name ?? "").replace(/\s*-\s*Monthly Challenge\s*$/i, "");
      const expenseRows = (insert.data ?? []).flatMap((payout: any) => {
        const amount = Number(payout.payable_amount ?? 0);
        if (amount <= 0) return [];
        return incentiveExpenseSplit(amount, weeks.length).map((share, index) => ({
          id: `${incentiveExpenseIdPrefix(payout.id)}${index + 1}`,
          org_id: req.user!.orgId, branch_id: challenge.branch_id ?? null, date: weeks[index],
          category: INCENTIVE_EXPENSE_CATEGORY,
          description: `${monthLabel} incentive · ${payout.person_name} · ${productLabel} · week ${index + 1} of ${weeks.length}`,
          amount: share, currency: "NGN", paid_by: actor?.name ?? null
        }));
      });
      if (expenseRows.length) {
        const booked = await supabase.from("expenses").insert(expenseRows);
        if (booked.error) {
          // Never leave a payment marked without its expense: take it back.
          await supabase.from("challenge_incentive_payouts").delete().in("id", (insert.data ?? []).map((payout: any) => payout.id));
          throw booked.error;
        }
      }
    }
    res.json({ paid: fresh.length, alreadyPaid: rows.length - fresh.length, total: fresh.reduce((sum, row) => sum + row.payable_amount, 0) });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Could not record the payment." });
  }
});

router.delete("/:id/incentive/paid", requireRole("Owner"), async (req, res) => {
  const parsed = z.object({ kind: z.enum(["rep", "manager"]), personId: z.string().uuid().nullable() }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Which payment?" }); return; }
  try {
    let find = supabase.from("challenge_incentive_payouts").select("id").eq("org_id", req.user!.orgId).eq("challenge_id", String(req.params.id)).eq("person_kind", parsed.data.kind);
    if (parsed.data.kind === "rep") find = find.eq("person_id", parsed.data.personId);
    const { data: payouts, error: findError } = await find;
    if (findError) throw findError;
    for (const payout of payouts ?? []) {
      // The weekly expense rows this payment booked go with it.
      const removed = await supabase.from("expenses").delete().eq("org_id", req.user!.orgId).like("id", `${incentiveExpenseIdPrefix(payout.id)}%`);
      if (removed.error) throw removed.error;
      const { error } = await supabase.from("challenge_incentive_payouts").delete().eq("org_id", req.user!.orgId).eq("id", payout.id);
      if (error) throw error;
    }
    res.json({ ok: true });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Could not undo the payment." });
  }
});

router.put("/:id/allocations", requireRole("Owner"), async (req, res) => {
  const parsed = AllocationsSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: humanFieldErrors(parsed.error) }); return; }
  try {
    const { data: challenge, error: challengeError } = await supabase.from("manager_product_challenges")
      .select("id, target_units, reward_amount, milestone_mode, cadence")
      .eq("id", req.params.id).eq("org_id", req.user!.orgId).maybeSingle();
    if (challengeError) throw challengeError;
    if (!challenge) { res.status(404).json({ error: "Challenge not found." }); return; }
    const targetTotal = parsed.data.allocations.reduce((sum, item) => sum + item.targetUnits, 0);
    const rewardTotal = parsed.data.allocations.reduce((sum, item) => sum + item.rewardAmount, 0);
    if (targetTotal !== Number(challenge.target_units)) { res.status(400).json({ error: `Rep allocations must total ${challenge.target_units} pieces.` }); return; }
    if (Math.abs(rewardTotal - Number(challenge.reward_amount)) > 0.01) { res.status(400).json({ error: `Rep rewards must total ${challenge.reward_amount}.` }); return; }
    const repIds = parsed.data.allocations.map((item) => item.repId);
    if (new Set(repIds).size !== repIds.length) { res.status(400).json({ error: "Each sales rep can only have one allocation." }); return; }
    const { data: reps, error: repsError } = await supabase.from("users").select("id").eq("org_id", req.user!.orgId).eq("role", "Sales Rep").eq("active", true).in("id", repIds);
    if (repsError) throw repsError;
    if ((reps ?? []).length !== new Set(repIds).size) { res.status(400).json({ error: "Every allocation must belong to an active sales rep in this organization." }); return; }
    const payload = parsed.data.allocations.map((item) => ({ org_id: req.user!.orgId, challenge_id: req.params.id, rep_id: item.repId, target_units: item.targetUnits, reward_amount: item.rewardAmount, milestone_targets: item.milestoneTargets }));
    const { error: pruneError } = await supabase.from("manager_product_challenge_allocations").delete().eq("org_id", req.user!.orgId).eq("challenge_id", req.params.id).not("rep_id", "in", `(${repIds.join(",")})`);
    if (pruneError) throw pruneError;
    const { data, error } = await supabase.from("manager_product_challenge_allocations").upsert(payload, { onConflict: "challenge_id,rep_id" }).select("*");
    if (error) throw error;
    res.json({ allocations: data ?? [] });
  } catch (error: any) { res.status(500).json({ error: error?.message ?? "Could not save rep allocations." }); }
});

router.post("/", requireRole("Owner"), async (req, res) => {
  const parsed = ChallengeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: humanFieldErrors(parsed.error) });
    return;
  }
  try {
    if (!(await verifyProduct(req.user!.orgId, parsed.data.productId))) {
      res.status(400).json({ error: "Choose a product that belongs to this organization." });
      return;
    }
    if (parsed.data.status === "active" && await hasOverlap(req.user!.orgId, parsed.data.productId, parsed.data.startDate, parsed.data.endDate)) {
      res.status(409).json({ error: "This product already has an active challenge covering part of that date range." });
      return;
    }
    const { data, error } = await supabase
      .from("manager_product_challenges")
      .insert({ ...rowPayload(parsed.data, req), created_by: req.user!.id })
      .select("*")
      .single();
    if (error) throw error;
    const progress = evaluateChallengeProgress({ ...parsed.data, progressUnits: 0, today: todayInLagos() });
    const milestoneResult = buildChallengeMilestones({ ...parsed.data, today: todayInLagos(), orders: [] });
    res.status(201).json(rowToApi(data, progress, 0, milestoneResult));
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Could not create product challenge." });
  }
});

router.patch("/:id", requireRole("Owner"), async (req, res) => {
  const parsed = PatchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: humanFieldErrors(parsed.error) });
    return;
  }
  try {
    const { data: existing, error: existingError } = await supabase
      .from("manager_product_challenges")
      .select("*")
      .eq("org_id", req.user!.orgId)
      .eq("id", req.params.id)
      .maybeSingle();
    if (existingError) throw existingError;
    if (!existing) {
      res.status(404).json({ error: "Product challenge not found." });
      return;
    }
    const mergedResult = ChallengeSchema.safeParse({
      productId: existing.product_id,
      name: existing.name,
      cadence: existing.cadence,
      targetUnits: existing.target_units,
      startDate: existing.start_date,
      endDate: existing.end_date,
      rewardAmount: existing.reward_amount,
      currency: existing.currency,
      milestoneMode: existing.milestone_mode ?? "none",
      milestoneDistribution: existing.milestone_distribution ?? "even",
      milestoneTargets: Array.isArray(existing.milestone_targets) ? existing.milestone_targets.map(Number) : [],
      status: existing.status,
      description: existing.description ?? "",
      managerRewardAmount: existing.manager_reward_amount ?? 0,
      ...parsed.data
    });
    if (!mergedResult.success) {
      res.status(400).json({ error: humanFieldErrors(mergedResult.error) });
      return;
    }
    const merged = mergedResult.data;
    if (!(await verifyProduct(req.user!.orgId, merged.productId))) {
      res.status(400).json({ error: "Choose a product that belongs to this organization." });
      return;
    }
    if (merged.status === "active" && await hasOverlap(req.user!.orgId, merged.productId, merged.startDate, merged.endDate, existing.id)) {
      res.status(409).json({ error: "This product already has an active challenge covering part of that date range." });
      return;
    }
    const { data, error } = await supabase
      .from("manager_product_challenges")
      .update(rowPayload(merged, req))
      .eq("org_id", req.user!.orgId)
      .eq("id", existing.id)
      .select("*")
      .single();
    if (error) throw error;
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Could not update product challenge." });
  }
});

router.delete("/:id", requireRole("Owner"), async (req, res) => {
  try {
    const { error } = await supabase
      .from("manager_product_challenges")
      .delete()
      .eq("org_id", req.user!.orgId)
      .eq("id", req.params.id);
    if (error) throw error;
    res.status(204).send();
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Could not delete product challenge." });
  }
});

export default router;
