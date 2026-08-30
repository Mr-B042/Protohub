import { Router } from "express";
import { z } from "zod";
import { supabase } from "../lib/supabase.js";
import { humanFieldErrors } from "../lib/validation-message.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { REPORT_ROW_CEILING, fetchAllRowsOrThrow } from "../lib/query-limits.js";
import { computeTargetProgress, deliveredOrdersIn, type TargetOrder, type DatedAmount } from "../lib/target-progress.js";
import { perOrderBonusMapForDeliveredRange } from "../lib/sales-bonus-engine.js";
import { buildRecoveryPlan } from "../lib/recovery-plan.js";
import { computeIncentive } from "../lib/manager-incentive.js";

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
router.get("/:id/progress", async (req, res) => {
  const orgId = req.user!.orgId;
  const { data: target, error: targetError } = await supabase
    .from("target_periods").select("*").eq("org_id", orgId).eq("id", req.params.id).maybeSingle();
  if (targetError) { res.status(500).json({ error: targetError.message }); return; }
  if (!target) { res.status(404).json({ error: "That target does not exist here." }); return; }

  const start = String(target.period_start).slice(0, 10);
  const end = String(target.period_end).slice(0, 10);
  // created_at is a timestamp, so the upper bound is exclusive of the day AFTER
  // the period - `lte end` would drop everything after 00:00:00 on the last day.
  const endExclusive = new Date(Date.parse(`${end}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  const ORDER_COLUMNS = "id, status, amount, quantity, cogs_snapshot, logistics_cost, created_at, delivered_date, review_hold";

  try {
    // ⚠️ TWO QUERIES, NOT ONE. An order created in July and delivered in August
    // belongs to August's throughput but not its placed cohort, so neither date
    // alone finds every row that matters. Merged by id below.
    const [placedRows, deliveredRows, adRows, deliveryExpenseRows] = await Promise.all([
      fetchAllRowsOrThrow<any>(() => supabase.from("orders").select(ORDER_COLUMNS)
        .eq("org_id", orgId).eq("product_id", target.product_id)
        .gte("created_at", `${start}T00:00:00.000Z`).lt("created_at", `${endExclusive}T00:00:00.000Z`)
        .order("created_at", { ascending: true }).order("id", { ascending: true })),
      fetchAllRowsOrThrow<any>(() => supabase.from("orders").select(ORDER_COLUMNS)
        .eq("org_id", orgId).eq("product_id", target.product_id).eq("status", "Delivered")
        .gte("delivered_date", start).lte("delivered_date", end)
        .order("delivered_date", { ascending: true }).order("id", { ascending: true })),
      // expenses.product_id is TEXT while products.id is uuid - the cast is
      // required or Postgres refuses the comparison outright.
      fetchAllRowsOrThrow<any>(() => supabase.from("expenses").select("date, amount")
        .eq("org_id", orgId).eq("product_id", String(target.product_id)).eq("category", "Ad Spend")
        .gte("date", start).lte("date", end)
        .order("date", { ascending: true }).order("id", { ascending: true })),
      fetchAllRowsOrThrow<any>(() => supabase.from("expenses").select("date, amount")
        .eq("org_id", orgId).eq("product_id", String(target.product_id))
        .in("category", ["Delivery", "Waybill", "Failed Delivery"])
        .gte("date", start).lte("date", end)
        .order("date", { ascending: true }).order("id", { ascending: true }))
    ]);

    const byId = new Map<string, TargetOrder>();
    for (const row of [...placedRows, ...deliveredRows]) byId.set(row.id, row as TargetOrder);

    // Bonus settled per order across the whole org for this delivered range,
    // then narrowed to this product's delivered orders only.
    const bonusByOrderId = await perOrderBonusMapForDeliveredRange(orgId, start, end);
    const productDelivered = deliveredOrdersIn(Array.from(byId.values()), start, end);
    let commissions = 0;
    const commissionsByDay = new Map<string, number>();
    for (const order of productDelivered) {
      const payable = Number(bonusByOrderId[String(order.id)] ?? 0);
      if (!payable) continue;
      commissions += payable;
      const day = String(order.delivered_date ?? "").slice(0, 10);
      if (day) commissionsByDay.set(day, (commissionsByDay.get(day) ?? 0) + payable);
    }

    const adSpendRows: DatedAmount[] = adRows.map((r: any) => ({ date: String(r.date), amount: Number(r.amount ?? 0) }));
    const deliveryExpenseFallback = deliveryExpenseRows.reduce((s: number, r: any) => s + Number(r.amount ?? 0), 0);

    const progress = computeTargetProgress(
      {
        periodStart: start,
        periodEnd: end,
        contributionTarget: Number(target.contribution_target ?? 0),
        orderTarget: Number(target.order_target ?? 0),
        deliveredTarget: Number(target.delivered_target ?? 0),
        piecesTarget: Number(target.pieces_target ?? 0),
        deliveryRateTarget: Number(target.delivery_rate_target ?? 0),
        adSpendCeiling: Number(target.ad_spend_ceiling ?? 0)
      },
      Array.from(byId.values()),
      adSpendRows,
      commissions,
      deliveryExpenseFallback,
      commissionsByDay
    );

    const definition = {
      periodStart: start,
      periodEnd: end,
      contributionTarget: Number(target.contribution_target ?? 0),
      orderTarget: Number(target.order_target ?? 0),
      deliveredTarget: Number(target.delivered_target ?? 0),
      piecesTarget: Number(target.pieces_target ?? 0),
      deliveryRateTarget: Number(target.delivery_rate_target ?? 0),
      adSpendCeiling: Number(target.ad_spend_ceiling ?? 0)
    };
    const recoveryPlan = buildRecoveryPlan(definition, progress);

    // The incentive is optional: a target can exist before anyone is put on it.
    const { data: rule } = await supabase.from("incentive_rules")
      .select("*").eq("target_period_id", target.id).limit(1).maybeSingle();
    const incentive = rule
      ? computeIncentive(
          progress.breakdown.contribution,
          progress.forecast.projectedContribution,
          {
            minimum: Number(target.contribution_minimum ?? 0),
            target: Number(target.contribution_target ?? 0),
            exceptional: Number(target.contribution_exceptional ?? 0)
          },
          {
            baseReward: Number(rule.base_reward ?? 0),
            minimumMultiplier: Number(rule.minimum_multiplier ?? 50),
            targetMultiplier: Number(rule.target_multiplier ?? 100),
            exceptionalMultiplier: Number(rule.exceptional_multiplier ?? 125),
            verificationGates: rule.verification_gates ?? {},
            verificationStatus: rule.verification_status ?? "provisional"
          },
          progress.forecast.daysRemainingInclusive
        )
      : null;

    res.json({
      targetId: target.id,
      periodStart: start,
      periodEnd: end,
      commissionsIncluded: true,
      ...progress,
      recoveryPlan,
      incentive,
      incentiveStatus: rule?.verification_status ?? null
    });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Could not load target progress." });
  }
});

export default router;
