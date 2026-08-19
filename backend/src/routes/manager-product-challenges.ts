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
router.use(requireAuth, requireRole("Owner", "Admin", "Manager"));

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
  milestoneResult: ReturnType<typeof buildChallengeMilestones>
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
    const { data: orders, error: ordersError } = await supabase
      .from("orders")
      .select("id, product_id, quantity, status, created_at, review_hold")
      .limit(REPORT_ROW_CEILING)
      .eq("org_id", req.user!.orgId)
      .gte("created_at", toWatUtcIso(earliest, "start"))
      .lte("created_at", toWatUtcIso(latest, "end"))
      .or("review_hold.is.null,review_hold.eq.false");
    if (ordersError) throw ordersError;

    const today = todayInLagos();
    const challenges = rows.map((row) => {
      const matching = (orders ?? []).filter((order) => {
        const createdDate = lagosDateKeyFromIso(String(order.created_at ?? ""));
        return order.product_id === row.product_id
          && createdDate >= row.start_date
          && createdDate <= row.end_date
          && !["Cancelled", "Failed"].includes(order.status ?? "");
      });
      const progressUnits = matching.reduce((sum, order) => sum + Math.max(0, Number(order.quantity ?? 0)), 0);
      const progress = evaluateChallengeProgress({
        startDate: row.start_date,
        endDate: row.end_date,
        targetUnits: Number(row.target_units),
        progressUnits,
        status: row.status as ChallengeLifecycleStatus,
        today
      });
      const milestoneResult = buildChallengeMilestones({
        cadence: row.cadence,
        startDate: row.start_date,
        endDate: row.end_date,
        targetUnits: Number(row.target_units),
        rewardAmount: Number(row.reward_amount ?? 0),
        milestoneMode: row.milestone_mode ?? "none",
        milestoneDistribution: row.milestone_distribution ?? "even",
        milestoneTargets: Array.isArray(row.milestone_targets) ? row.milestone_targets.map(Number) : [],
        status: row.status as ChallengeLifecycleStatus,
        today,
        orders: matching.map((order) => ({
          dateKey: lagosDateKeyFromIso(String(order.created_at ?? "")),
          units: Number(order.quantity ?? 0)
        }))
      });
      return rowToApi(row, progress, matching.length, milestoneResult);
    });
    res.json({ challenges, canEdit: req.user!.role === "Owner" });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Could not load product challenges." });
  }
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
