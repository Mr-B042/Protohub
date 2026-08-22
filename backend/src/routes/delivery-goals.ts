import { Router } from "express";
import { z } from "zod";
import { supabase } from "../lib/supabase.js";
import { humanFieldErrors } from "../lib/validation-message.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { REPORT_ROW_CEILING } from "../lib/query-limits.js";

// Kept here rather than imported from the client's delivery-goals module: the
// maths that draws the bar belongs with the UI that draws it, and the server
// only needs to know what it is allowed to store. These three values mirror
// the database defaults and CHECK constraint in migration 226.
const COMPANY_DEFAULT_PRIMARY = 65;
const COMPANY_DEFAULT_STRETCH = 70;
const DELIVERY_GOAL_BASES = ["period", "month", "all_time"] as const;

const router = Router();
// Reading is open to everyone who can see the Manager Dashboard - the bars are
// part of the page. WRITING is Owner-only (see the routes below): a delivery
// target is what the team is judged against, so moving it is the Owner's call,
// not an Admin's.
router.use(requireAuth, requireRole("Owner", "Admin", "Manager"));

const GoalSchema = z.object({
  productId: z.string().uuid(),
  useCustomGoals: z.boolean().default(true),
  primaryTarget: z.coerce.number().int().min(0).max(100),
  stretchTarget: z.coerce.number().int().min(0).max(100),
  goalBasis: z.enum(DELIVERY_GOAL_BASES).default("period"),
  showProgressBar: z.boolean().default(true)
}).strict().superRefine((value, context) => {
  // Mirrors the database CHECK, so the message is a sentence rather than a
  // constraint violation.
  if (value.stretchTarget < value.primaryTarget) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "The stretch goal cannot be lower than the main goal.",
      path: ["stretchTarget"]
    });
  }
});

const CompanyDefaultSchema = z.object({
  primaryTarget: z.coerce.number().int().min(0).max(100),
  stretchTarget: z.coerce.number().int().min(0).max(100)
}).strict().superRefine((value, context) => {
  if (value.stretchTarget < value.primaryTarget) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "The stretch goal cannot be lower than the main goal.",
      path: ["stretchTarget"]
    });
  }
});

const rowToGoal = (row: any) => ({
  productId: row.product_id,
  useCustomGoals: row.use_custom_goals !== false,
  primaryTarget: Number(row.primary_target ?? COMPANY_DEFAULT_PRIMARY),
  stretchTarget: Number(row.stretch_target ?? COMPANY_DEFAULT_STRETCH),
  goalBasis: String(row.goal_basis ?? "period"),
  showProgressBar: row.show_progress_bar !== false,
  updatedAt: row.updated_at ?? null
});

// ── GET /api/delivery-goals ───────────────────────────────
// The company default plus every product that has its own settings. Products
// without a row simply follow the default, so the absence of a row is the
// normal case rather than something to backfill.
router.get("/", async (req, res) => {
  try {
    const orgId = req.user!.orgId;
    const [{ data: org }, { data: rows, error }] = await Promise.all([
      supabase.from("organizations")
        .select("delivery_goal_primary_target, delivery_goal_stretch_target")
        .eq("id", orgId).maybeSingle(),
      supabase.from("product_delivery_goals")
        .select("product_id, use_custom_goals, primary_target, stretch_target, goal_basis, show_progress_bar, updated_at")
        .eq("org_id", orgId).limit(REPORT_ROW_CEILING)
    ]);
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json({
      companyDefault: {
        primaryTarget: Number(org?.delivery_goal_primary_target ?? COMPANY_DEFAULT_PRIMARY),
        stretchTarget: Number(org?.delivery_goal_stretch_target ?? COMPANY_DEFAULT_STRETCH)
      },
      products: (rows ?? []).map(rowToGoal)
    });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Could not load delivery goals." });
  }
});

// ── PUT /api/delivery-goals/product ───────────────────────
router.put("/product", requireRole("Owner"), async (req, res) => {
  try {
    const parsed = GoalSchema.safeParse(req.body ?? {});
    if (!parsed.success) { res.status(400).json({ error: humanFieldErrors(parsed.error) }); return; }
    const orgId = req.user!.orgId;
    const goal = parsed.data;

    // The product must belong to this org - a uuid from another org would
    // otherwise be written into our settings and silently ignored forever.
    const { data: product } = await supabase.from("products")
      .select("id").eq("org_id", orgId).eq("id", goal.productId).maybeSingle();
    if (!product) { res.status(404).json({ error: "That product does not exist here." }); return; }

    const { data, error } = await supabase.from("product_delivery_goals")
      .upsert({
        org_id: orgId,
        product_id: goal.productId,
        use_custom_goals: goal.useCustomGoals,
        primary_target: goal.primaryTarget,
        stretch_target: goal.stretchTarget,
        goal_basis: goal.goalBasis,
        show_progress_bar: goal.showProgressBar,
        updated_by: req.user!.id,
        updated_at: new Date().toISOString()
      }, { onConflict: "org_id,product_id" })
      .select("product_id, use_custom_goals, primary_target, stretch_target, goal_basis, show_progress_bar, updated_at")
      .single();
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json({ goal: rowToGoal(data) });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Could not save that goal." });
  }
});

// ── PUT /api/delivery-goals/company-default ───────────────
// Owner-only: this moves the target for every product that has not set its
// own, so it is a company-wide decision rather than a per-product tweak.
router.put("/company-default", requireRole("Owner"), async (req, res) => {
  try {
    const parsed = CompanyDefaultSchema.safeParse(req.body ?? {});
    if (!parsed.success) { res.status(400).json({ error: humanFieldErrors(parsed.error) }); return; }
    const { error } = await supabase.from("organizations")
      .update({
        delivery_goal_primary_target: parsed.data.primaryTarget,
        delivery_goal_stretch_target: parsed.data.stretchTarget
      })
      .eq("id", req.user!.orgId);
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json({ companyDefault: parsed.data });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Could not save the company default." });
  }
});

export default router;
