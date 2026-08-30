import { Router } from "express";
import { z } from "zod";
import { supabase } from "../lib/supabase.js";
import { humanFieldErrors } from "../lib/validation-message.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { REPORT_ROW_CEILING } from "../lib/query-limits.js";
import { loadTargetProgress, loadTargetActuals } from "../lib/target-progress-loader.js";
import { suggestTargets, completeMonthsBefore, daysInWindow } from "../lib/target-suggestion.js";
import { lagosTodayKey } from "../lib/salary-spread.js";
import { SALES_BONUS_LAUNCH_WEEK_START } from "../lib/sales-bonus-engine.js";

/**
 * Monthly product contribution targets and the manager incentive on them.
 *
 * ⚠️ "CONTRIBUTION" IS NOT THE P&L's DIRECT PROFIT. See migration 242 for the
 * full reasoning and the measured numbers. Short version: this figure deducts
 * ADVERTISING as a direct cost and Direct Profit does not, and on Edge Brusher
 * for Aug 2026 that is the difference between ₦2.5m (~81% of a ₦3.1m target)
 * and ~₦8.4m (a target passed weeks earlier). Never present it as "profit".
 *
 * ⚠️ READING IS WIDE, WRITING IS OWNER-ONLY. A target is what the team is
 * judged against and the incentive is someone's pay, so moving either is the
 * Owner's call - not an Admin's and never the manager being measured. Same
 * split as delivery-goals (migration 226), enforced per-route below.
 */
const router = Router();
router.use(requireAuth, requireRole("Owner", "Admin", "Manager"));

const TargetFields = z.object({
  productId: z.string().uuid(),
  name: z.string().max(120).default(""),
  periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date."),
  periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date."),
  contributionMinimum: z.coerce.number().min(0).default(0),
  contributionTarget: z.coerce.number().positive("The target must be more than zero."),
  contributionExceptional: z.coerce.number().min(0).default(0),
  orderTarget: z.coerce.number().int().min(0).default(0),
  deliveredTarget: z.coerce.number().int().min(0).default(0),
  piecesTarget: z.coerce.number().int().min(0).default(0),
  deliveryRateTarget: z.coerce.number().min(0).max(100).default(0),
  adSpendCeiling: z.coerce.number().min(0).default(0)
}).strict();

/**
 * Cross-field checks mirroring the database CHECKs, so a bad combination comes
 * back as a sentence the Owner can act on rather than a constraint violation.
 *
 * Written against a PARTIAL shape because the PATCH route reuses it: a field
 * absent from a patch keeps its stored value, and only the pairs actually
 * present in this request can be compared here. The database constraints stay
 * the real guarantee for the pairs that span request and stored state.
 */
const refineTargetLevels = (
  value: Partial<z.infer<typeof TargetFields>>,
  context: z.RefinementCtx
) => {
  if (value.periodStart != null && value.periodEnd != null && value.periodEnd < value.periodStart) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["periodEnd"],
      message: "The period cannot end before it starts." });
  }
  if (value.contributionMinimum != null && value.contributionTarget != null
      && value.contributionMinimum > 0 && value.contributionMinimum > value.contributionTarget) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["contributionMinimum"],
      message: "The minimum level cannot be above the target." });
  }
  if (value.contributionExceptional != null && value.contributionTarget != null
      && value.contributionExceptional > 0 && value.contributionExceptional < value.contributionTarget) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["contributionExceptional"],
      message: "The exceptional level cannot be below the target." });
  }
};

const TargetSchema = TargetFields.superRefine(refineTargetLevels);
const TargetPatchSchema = TargetFields.partial().superRefine(refineTargetLevels);

const IncentiveSchema = z.object({
  managerId: z.string().uuid().nullable().default(null),
  baseReward: z.coerce.number().min(0).default(0),
  minimumMultiplier: z.coerce.number().min(0).default(50),
  targetMultiplier: z.coerce.number().min(0).default(100),
  exceptionalMultiplier: z.coerce.number().min(0).default(125)
}).strict().superRefine((value, context) => {
  if (!(value.exceptionalMultiplier >= value.targetMultiplier && value.targetMultiplier >= value.minimumMultiplier)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["targetMultiplier"],
      message: "Multipliers must rise: minimum ≤ target ≤ exceptional." });
  }
});

const rowToTarget = (row: any) => ({
  id: row.id,
  productId: row.product_id,
  productName: row.products?.name ?? null,
  name: row.name ?? "",
  periodStart: row.period_start,
  periodEnd: row.period_end,
  contributionMinimum: Number(row.contribution_minimum ?? 0),
  contributionTarget: Number(row.contribution_target ?? 0),
  contributionExceptional: Number(row.contribution_exceptional ?? 0),
  orderTarget: Number(row.order_target ?? 0),
  deliveredTarget: Number(row.delivered_target ?? 0),
  piecesTarget: Number(row.pieces_target ?? 0),
  deliveryRateTarget: Number(row.delivery_rate_target ?? 0),
  adSpendCeiling: Number(row.ad_spend_ceiling ?? 0),
  status: row.status ?? "draft",
  incentive: row.incentive_rules?.[0] ? {
    id: row.incentive_rules[0].id,
    managerId: row.incentive_rules[0].manager_id,
    baseReward: Number(row.incentive_rules[0].base_reward ?? 0),
    minimumMultiplier: Number(row.incentive_rules[0].minimum_multiplier ?? 50),
    targetMultiplier: Number(row.incentive_rules[0].target_multiplier ?? 100),
    exceptionalMultiplier: Number(row.incentive_rules[0].exceptional_multiplier ?? 125),
    verificationStatus: row.incentive_rules[0].verification_status ?? "provisional",
    verificationGates: row.incentive_rules[0].verification_gates ?? {},
    finalPayout: row.incentive_rules[0].final_payout == null ? null : Number(row.incentive_rules[0].final_payout)
  } : null
});

const SELECT = "*, products(name), incentive_rules(*)";

// ── GET / ─────────────────────────────────────────────────
router.get("/", async (req, res) => {
  const { data, error } = await supabase
    .from("target_periods")
    .select(SELECT)
    .limit(REPORT_ROW_CEILING)
    .eq("org_id", req.user!.orgId)
    .order("period_start", { ascending: false })
    .order("id", { ascending: false });
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ targets: (data ?? []).map(rowToTarget) });
});

// ── GET /suggest ── Owner only ───────────────────────────
/**
 * Proposes a period's targets from the product's own recent months.
 *
 * ⚠️ MUST BE DECLARED BEFORE ANY "/:id" ROUTE. Express matches in order, so a
 * later "/:id" would happily treat "suggest" as an id.
 *
 * ⚠️ MEASURED THROUGH loadTargetActuals, THE SAME PATH THE TAB USES. A bespoke
 * history query here would be a second definition of contribution, and the
 * suggested target would then be built on numbers that never appear on screen.
 */
router.get("/suggest", requireRole("Owner"), async (req, res) => {
  const parsed = z.object({
    productId: z.string().uuid(),
    periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    months: z.coerce.number().int().min(1).max(12).default(2),
    stretch: z.coerce.number().min(-50).max(200).default(10)
  }).safeParse(req.query ?? {});
  if (!parsed.success) { res.status(400).json({ error: humanFieldErrors(parsed.error) }); return; }
  const { productId, periodStart, periodEnd, months, stretch } = parsed.data;

  const { data: product } = await supabase.from("products")
    .select("id, name").eq("org_id", req.user!.orgId).eq("id", productId).maybeSingle();
  if (!product) { res.status(404).json({ error: "That product does not exist here." }); return; }

  try {
    // The COMPLETE months immediately before the period being planned. The
    // current, part-finished month is never used - a half month masquerading
    // as a full one would drag every suggestion down.
    const windows = completeMonthsBefore(periodStart, months, lagosTodayKey());

    const actuals = await Promise.all(windows.map(async (window) => {
      const progress = await loadTargetActuals(
        req.user!.orgId,
        productId,
        {
          periodStart: window.start, periodEnd: window.end,
          contributionTarget: 0, orderTarget: 0, deliveredTarget: 0,
          piecesTarget: 0, deliveryRateTarget: 0, adSpendCeiling: 0
        },
        // Treat the month as finished, so nothing is forecast forward.
        window.end
      );
      return {
        monthKey: window.monthKey,
        periodStart: window.start,
        periodEnd: window.end,
        days: daysInWindow(window),
        contribution: progress.breakdown.contribution,
        ordersPlaced: progress.ordersPlaced.actual,
        delivered: progress.delivered.actual,
        pieces: progress.pieces.actual,
        adSpend: progress.breakdown.adSpend
      };
    }));

    res.json({
      productId,
      productName: product.name,
      ...suggestTargets(actuals, periodStart, periodEnd, stretch, 10, SALES_BONUS_LAUNCH_WEEK_START)
    });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Could not build a suggestion." });
  }
});

// ── POST / ── Owner only ─────────────────────────────────
router.post("/", requireRole("Owner"), async (req, res) => {
  const parsed = TargetSchema.safeParse(req.body ?? {});
  if (!parsed.success) { res.status(400).json({ error: humanFieldErrors(parsed.error) }); return; }
  const orgId = req.user!.orgId;
  const t = parsed.data;

  // The product must belong to this org - a uuid from elsewhere would
  // otherwise be written in and quietly measure nothing.
  const { data: product } = await supabase.from("products")
    .select("id").eq("org_id", orgId).eq("id", t.productId).maybeSingle();
  if (!product) { res.status(404).json({ error: "That product does not exist here." }); return; }

  const { data, error } = await supabase.from("target_periods").insert({
    org_id: orgId,
    product_id: t.productId,
    name: t.name,
    period_start: t.periodStart,
    period_end: t.periodEnd,
    contribution_minimum: t.contributionMinimum,
    contribution_target: t.contributionTarget,
    contribution_exceptional: t.contributionExceptional,
    order_target: t.orderTarget,
    delivered_target: t.deliveredTarget,
    pieces_target: t.piecesTarget,
    delivery_rate_target: t.deliveryRateTarget,
    ad_spend_ceiling: t.adSpendCeiling,
    created_by: req.user!.id,
    updated_by: req.user!.id
  }).select(SELECT).single();

  if (error) {
    // 23505 is the (org, product, period_start) unique index - a real message
    // beats "duplicate key value violates unique constraint".
    if ((error as any).code === "23505") {
      res.status(409).json({ error: "That product already has a target for this period. Edit the existing one instead." });
      return;
    }
    res.status(500).json({ error: error.message });
    return;
  }
  res.status(201).json({ target: rowToTarget(data) });
});

// ── PATCH /:id ── Owner only ─────────────────────────────
router.patch("/:id", requireRole("Owner"), async (req, res) => {
  const parsed = TargetPatchSchema.safeParse(req.body ?? {});
  if (!parsed.success) { res.status(400).json({ error: humanFieldErrors(parsed.error) }); return; }
  const t = parsed.data;

  const { data: existing } = await supabase.from("target_periods")
    .select("id, status").eq("org_id", req.user!.orgId).eq("id", req.params.id).maybeSingle();
  if (!existing) { res.status(404).json({ error: "That target does not exist here." }); return; }
  // ⚠️ A settled period is the record of what was actually paid. Editing its
  // targets afterwards would rewrite the basis of a settled payout.
  if (existing.status === "settled") {
    res.status(409).json({ error: "This period is settled. Reopen it before changing the targets." });
    return;
  }

  const patch: Record<string, unknown> = { updated_by: req.user!.id, updated_at: new Date().toISOString() };
  if (t.name !== undefined) patch.name = t.name;
  if (t.periodStart !== undefined) patch.period_start = t.periodStart;
  if (t.periodEnd !== undefined) patch.period_end = t.periodEnd;
  if (t.contributionMinimum !== undefined) patch.contribution_minimum = t.contributionMinimum;
  if (t.contributionTarget !== undefined) patch.contribution_target = t.contributionTarget;
  if (t.contributionExceptional !== undefined) patch.contribution_exceptional = t.contributionExceptional;
  if (t.orderTarget !== undefined) patch.order_target = t.orderTarget;
  if (t.deliveredTarget !== undefined) patch.delivered_target = t.deliveredTarget;
  if (t.piecesTarget !== undefined) patch.pieces_target = t.piecesTarget;
  if (t.deliveryRateTarget !== undefined) patch.delivery_rate_target = t.deliveryRateTarget;
  if (t.adSpendCeiling !== undefined) patch.ad_spend_ceiling = t.adSpendCeiling;

  const { data, error } = await supabase.from("target_periods")
    .update(patch).eq("org_id", req.user!.orgId).eq("id", req.params.id).select(SELECT).single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ target: rowToTarget(data) });
});

// ── PUT /:id/status ── Owner only ────────────────────────
router.put("/:id/status", requireRole("Owner"), async (req, res) => {
  const parsed = z.object({ status: z.enum(["draft", "active", "closed", "settled"]) })
    .strict().safeParse(req.body ?? {});
  if (!parsed.success) { res.status(400).json({ error: humanFieldErrors(parsed.error) }); return; }

  // ⚠️ Settling the PERIOD does not settle the PAYOUT. The incentive carries
  // its own verification_status and its own gates precisely because
  // contribution keeps moving after month end - late ad invoices, returns,
  // unreconciled agent cash. Closing the month is step one of several.
  const { data, error } = await supabase.from("target_periods")
    .update({ status: parsed.data.status, updated_by: req.user!.id, updated_at: new Date().toISOString() })
    .eq("org_id", req.user!.orgId).eq("id", req.params.id).select(SELECT).maybeSingle();
  if (error) { res.status(500).json({ error: error.message }); return; }
  if (!data) { res.status(404).json({ error: "That target does not exist here." }); return; }
  res.json({ target: rowToTarget(data) });
});

// ── PUT /:id/incentive ── Owner only ─────────────────────
router.put("/:id/incentive", requireRole("Owner"), async (req, res) => {
  const parsed = IncentiveSchema.safeParse(req.body ?? {});
  if (!parsed.success) { res.status(400).json({ error: humanFieldErrors(parsed.error) }); return; }
  const orgId = req.user!.orgId;
  const i = parsed.data;

  const { data: period } = await supabase.from("target_periods")
    .select("id").eq("org_id", orgId).eq("id", req.params.id).maybeSingle();
  if (!period) { res.status(404).json({ error: "That target does not exist here." }); return; }

  if (i.managerId) {
    const { data: manager } = await supabase.from("users")
      .select("id").eq("org_id", orgId).eq("id", i.managerId).maybeSingle();
    if (!manager) { res.status(404).json({ error: "That manager does not exist here." }); return; }
  }

  // ⚠️ Never overwrite a SETTLED incentive. final_payout is the record of what
  // was actually paid; re-running the rules over it would erase that.
  //
  // ⚠️ .eq(col, null) MATCHES NOTHING in PostgREST - null needs .is(). manager_id
  // is nullable (the Owner may set targets before deciding who owns them), and
  // an upsert on (target_period_id, manager_id) cannot help either: SQL treats
  // NULLs as distinct, so the unique index does not fire and every save would
  // append another unassigned row. Hence an explicit find-then-update/insert
  // rather than upsert.
  let lookup = supabase.from("incentive_rules")
    .select("id, verification_status").eq("target_period_id", req.params.id);
  lookup = i.managerId ? lookup.eq("manager_id", i.managerId) : lookup.is("manager_id", null);
  const { data: current } = await lookup.maybeSingle();

  if (current?.verification_status === "settled") {
    res.status(409).json({ error: "This incentive is already settled and cannot be changed." });
    return;
  }

  const fields = {
    org_id: orgId,
    target_period_id: req.params.id,
    manager_id: i.managerId,
    base_reward: i.baseReward,
    minimum_multiplier: i.minimumMultiplier,
    target_multiplier: i.targetMultiplier,
    exceptional_multiplier: i.exceptionalMultiplier,
    updated_at: new Date().toISOString()
  };
  const { data, error } = current?.id
    ? await supabase.from("incentive_rules").update(fields).eq("id", current.id).select("*").single()
    : await supabase.from("incentive_rules").insert(fields).select("*").single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ incentive: data });
});

// ── GET /:id/progress ────────────────────────────────────
/**
 * Actuals for one target period.
 *
 * ⚠️ COMMISSIONS ARE ATTRIBUTED PER ORDER, NOT PER REP. A rep's bonus is earned
 * across every product they sell, so a rep-level total cannot be charged to one
 * product's target. perOrderBonusSettlementMapForDeliveredRange already splits
 * the settled bonus down to the order that earned it, so only the orders for
 * THIS product in THIS period are counted. Anything else would load one
 * product's contribution with another product's commission.
 */
// ── DELETE /:id ── Owner only ────────────────────────────
/**
 * ⚠️ THIS CASCADES. incentive_rules, daily_target_snapshots and
 * recovery_actions all reference target_periods ON DELETE CASCADE, so removing
 * a target takes its whole daily trail and any assigned recovery work with it.
 * That is right for a mistyped target and wrong for a month someone was paid
 * against, which is why both settled states below refuse.
 */
router.delete("/:id", requireRole("Owner"), async (req, res) => {
  const orgId = req.user!.orgId;
  const { data: target } = await supabase.from("target_periods")
    .select("id, status").eq("org_id", orgId).eq("id", req.params.id).maybeSingle();
  if (!target) { res.status(404).json({ error: "That target does not exist here." }); return; }

  if (target.status === "settled") {
    res.status(409).json({
      error: "This period is settled - it is the record of what was paid. Reopen it first if it really must go."
    });
    return;
  }

  // A settled incentive can exist under an unsettled period, and final_payout
  // is the only record of what was actually paid.
  const { data: settledIncentive } = await supabase.from("incentive_rules")
    .select("id").eq("target_period_id", req.params.id).eq("verification_status", "settled").limit(1).maybeSingle();
  if (settledIncentive) {
    res.status(409).json({
      error: "An incentive on this target is already settled, so deleting it would erase a paid record."
    });
    return;
  }

  const { count } = await supabase.from("daily_target_snapshots")
    .select("id", { count: "exact", head: true }).eq("target_period_id", req.params.id);

  const { error } = await supabase.from("target_periods")
    .delete().eq("org_id", orgId).eq("id", req.params.id);
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ deleted: true, snapshotsRemoved: count ?? 0 });
});

router.get("/:id/progress", async (req, res) => {
  const orgId = req.user!.orgId;
  const { data: target, error: targetError } = await supabase
    .from("target_periods").select("*").eq("org_id", orgId).eq("id", req.params.id).maybeSingle();
  if (targetError) { res.status(500).json({ error: targetError.message }); return; }
  if (!target) { res.status(404).json({ error: "That target does not exist here." }); return; }

  try {
    res.json(await loadTargetProgress(orgId, target));
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Could not load target progress." });
  }
});

export default router;
