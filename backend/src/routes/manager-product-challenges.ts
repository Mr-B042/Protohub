import { Router } from "express";
import { z } from "zod";
import {
  buildChallengeMilestones,
  challengeMilestoneCount,
  evaluateChallengeProgress,
  type ChallengeLifecycleStatus
} from "../lib/manager-product-challenge.js";
import { supabase } from "../lib/supabase.js";
import { humanFieldErrors } from "../lib/validation-message.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { REPORT_ROW_CEILING } from "../lib/query-limits.js";

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
  description: z.string().trim().max(1000).default("")
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
  try {
    const { data: rows, error } = await supabase
      .from("manager_product_challenges")
      .select("*")
      .eq("org_id", req.user!.orgId)
      .order("start_date", { ascending: false });
    if (error) throw error;
    if (!rows?.length) {
      res.json({ challenges: [], canEdit: req.user!.role === "Owner" });
      return;
    }

    const earliest = rows.reduce((value, row) => row.start_date < value ? row.start_date : value, rows[0].start_date);
    const latest = rows.reduce((value, row) => row.end_date > value ? row.end_date : value, rows[0].end_date);
    let ordersQuery = supabase
      .from("orders")
      .select("id, product_id, quantity, status, created_at, delivered_date, assigned_rep_id, review_hold")
      .limit(REPORT_ROW_CEILING)
      .eq("org_id", req.user!.orgId)
      .gte("created_at", toWatUtcIso(earliest, "start"))
      .lte("created_at", toWatUtcIso(latest, "end"))
      .or("review_hold.is.null,review_hold.eq.false");
    if (req.user!.role === "Sales Rep") ordersQuery = ordersQuery.eq("assigned_rep_id", req.user!.id);
    const { data: orders, error: ordersError } = await ordersQuery;
    if (ordersError) throw ordersError;

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
    let fallbackRepCount = 1;
    if (req.user!.role === "Sales Rep" && (!allocationRows || allocationRows.length === 0)) {
      const { count, error: repCountError } = await supabase.from("users").select("id", { count: "exact", head: true }).eq("org_id", req.user!.orgId).eq("role", "Sales Rep").eq("active", true);
      if (repCountError) throw repCountError;
      fallbackRepCount = Math.max(1, count ?? 1);
    }
    const challenges = rows.map((row) => {
      const productOrders = (orders ?? []).filter((order) => order.product_id === row.product_id);
      const matching = (orders ?? []).filter((order) => {
        const deliveredDate = String(order.delivered_date ?? "").slice(0, 10);
        const status = String(order.status ?? "").trim().toLowerCase();
        return order.product_id === row.product_id
          && status === "delivered"
          && deliveredDate >= row.start_date
          && deliveredDate <= row.end_date;
      });
      const teamTargetUnits = Number(row.target_units ?? 0);
      const teamRewardAmount = Number(row.reward_amount ?? 0);
      const allocations = (allocationRows ?? []).filter((allocation) => allocation.challenge_id === row.id);
      const ownAllocation = allocations.find((allocation) => allocation.rep_id === req.user!.id);
      const targetUnits = req.user!.role === "Sales Rep"
        ? Number(ownAllocation?.target_units ?? Math.ceil(teamTargetUnits / Math.max(1, allocations.length || fallbackRepCount)))
        : teamTargetUnits;
      const rewardAmount = req.user!.role === "Sales Rep"
        ? Number(ownAllocation?.reward_amount ?? (teamRewardAmount / Math.max(1, allocations.length || fallbackRepCount)))
        : teamRewardAmount;
      const progressUnits = matching.reduce((sum, order) => sum + Math.max(0, Number(order.quantity ?? 0)), 0);
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
      const confirmedPieces = productOrders.filter((order) => ["Confirmed", "In Process", "Dispatched"].includes(String(order.status))).reduce((sum, order) => sum + Math.max(0, Number(order.quantity ?? 0)), 0);
      const deliveredPieces = matching.reduce((sum, order) => sum + Math.max(0, Number(order.quantity ?? 0)), 0);
      return rowToApi({ ...row, target_units: targetUnits, reward_amount: rewardAmount }, progress, matching.length, milestoneResult, req.user!.role === "Sales Rep" ? {
        teamTargetUnits,
        teamRewardAmount,
        allocationMode: ownAllocation ? "manager_allocated" : "equal_split_fallback",
        allocationTargetUnits: ownAllocation?.target_units ?? null,
        allocationRewardAmount: ownAllocation?.reward_amount ?? null,
        confirmedPieces,
        deliveredPieces,
        awaitingDeliveryPieces: Math.max(0, confirmedPieces + deliveredPieces - deliveredPieces)
      } : {});
    });
    res.json({ challenges, canEdit: req.user!.role === "Owner", allocations: req.user!.role === "Sales Rep" ? [] : (allocationRows ?? []) });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Could not load product challenges." });
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
    const { data: reps, error: repsError } = await supabase.from("users").select("id").eq("org_id", req.user!.orgId).eq("role", "Sales Rep").eq("active", true).in("id", repIds);
    if (repsError) throw repsError;
    if ((reps ?? []).length !== new Set(repIds).size) { res.status(400).json({ error: "Every allocation must belong to an active sales rep in this organization." }); return; }
    const payload = parsed.data.allocations.map((item) => ({ org_id: req.user!.orgId, challenge_id: req.params.id, rep_id: item.repId, target_units: item.targetUnits, reward_amount: item.rewardAmount, milestone_targets: item.milestoneTargets }));
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
