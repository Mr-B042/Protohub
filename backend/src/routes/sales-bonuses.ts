import { Router } from "express";
import { z } from "zod";
import {
  SALES_BONUS_LAUNCH_WEEK_START,
  currentSalesBonusWeekStart,
  getSalesBonusProgress,
  listSalesBonusPrograms,
  perOrderBonusMapForDeliveredRange,
  perOrderSalesBonusBreakdown,
  type SalesBonusRuleType
} from "../lib/sales-bonus-engine.js";
import { supabase } from "../lib/supabase.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const ProgramBodySchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(600).optional().default(""),
  status: z.enum(["draft", "active", "paused"]).optional().default("draft"),
  startsOn: z.string().regex(DATE_KEY_PATTERN).optional(),
  endsOn: z.string().regex(DATE_KEY_PATTERN).nullable().optional(),
  appliesToUserIds: z.array(z.string().uuid()).optional().default([])
});

const ProgramPatchSchema = ProgramBodySchema.partial().extend({
  status: z.enum(["draft", "active", "paused", "deleted"]).optional()
});

const RuleBodySchema = z.object({
  name: z.string().trim().min(2).max(120),
  type: z.enum(["upgrade_count", "cross_sell_count", "upfront_percent", "delivery_rate_per_delivered", "cross_sell_offer"]),
  status: z.enum(["active", "paused"]).optional().default("active"),
  config: z.record(z.unknown()).optional().default({}),
  displayOrder: z.number().int().min(0).max(10_000).optional().default(100)
});

const RulePatchSchema = RuleBodySchema.partial().extend({
  status: z.enum(["active", "paused", "deleted"]).optional()
});

const QuerySchema = z.object({
  weekStart: z.string().regex(DATE_KEY_PATTERN).optional(),
  includeDeleted: z.string().optional()
});

const UuidParamsSchema = z.object({
  id: z.string().uuid()
});

const RepParamsSchema = z.object({
  repId: z.string().uuid()
});

const ownerAdminOnly = requireRole("Owner", "Admin");
const coachViewer = requireRole("Owner", "Admin", "Manager", "Sales Rep");
const allRepViewer = requireRole("Owner", "Admin", "Manager");
const clampSalesRepWeekStart = (role: string, weekStart: string) =>
  role === "Sales Rep" && weekStart < SALES_BONUS_LAUNCH_WEEK_START
    ? SALES_BONUS_LAUNCH_WEEK_START
    : weekStart;

const normalizeProgramInsert = (orgId: string, userId: string, body: z.infer<typeof ProgramBodySchema>) => ({
  org_id: orgId,
  name: body.name,
  description: body.description ?? "",
  status: body.status ?? "draft",
  recurrence: "weekly",
  timezone: "Africa/Lagos",
  week_start_day: 0,
  starts_on: body.startsOn ?? new Date().toISOString().slice(0, 10),
  ends_on: body.endsOn ?? null,
  applies_to_user_ids: body.appliesToUserIds ?? [],
  created_by: userId
});

const normalizeProgramPatch = (body: z.infer<typeof ProgramPatchSchema>) => {
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.name !== undefined) patch.name = body.name;
  if (body.description !== undefined) patch.description = body.description ?? "";
  if (body.status !== undefined) {
    patch.status = body.status;
    patch.deleted_at = body.status === "deleted" ? new Date().toISOString() : null;
  }
  if (body.startsOn !== undefined) patch.starts_on = body.startsOn;
  if (body.endsOn !== undefined) patch.ends_on = body.endsOn;
  if (body.appliesToUserIds !== undefined) patch.applies_to_user_ids = body.appliesToUserIds;
  return patch;
};

const normalizeRuleInsert = (orgId: string, programId: string, body: z.infer<typeof RuleBodySchema>) => ({
  org_id: orgId,
  program_id: programId,
  name: body.name,
  type: body.type as SalesBonusRuleType,
  status: body.status ?? "active",
  config: body.config ?? {},
  display_order: body.displayOrder ?? 100
});

const normalizeRulePatch = (body: z.infer<typeof RulePatchSchema>) => {
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.name !== undefined) patch.name = body.name;
  if (body.type !== undefined) patch.type = body.type;
  if (body.status !== undefined) {
    patch.status = body.status;
    patch.deleted_at = body.status === "deleted" ? new Date().toISOString() : null;
  }
  if (body.config !== undefined) patch.config = body.config ?? {};
  if (body.displayOrder !== undefined) patch.display_order = body.displayOrder;
  return patch;
};

router.get("/programs", coachViewer, async (req, res) => {
  const parsed = QuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }
  try {
    const includeDeleted = parsed.data.includeDeleted === "1" && ["Owner", "Admin"].includes(req.user!.role);
    res.json(await listSalesBonusPrograms(req.user!.orgId, includeDeleted));
  } catch (error: any) {
    res.status(400).json({ error: error?.message ?? "Failed to load bonus programs." });
  }
});

router.post("/programs", ownerAdminOnly, async (req, res) => {
  const parsed = ProgramBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }
  const { data, error } = await supabase
    .from("sales_bonus_programs")
    .insert(normalizeProgramInsert(req.user!.orgId, req.user!.id, parsed.data))
    .select()
    .single();
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.status(201).json(data);
});

router.patch("/programs/:id", ownerAdminOnly, async (req, res) => {
  const parsedParams = UuidParamsSchema.safeParse(req.params);
  const parsedBody = ProgramPatchSchema.safeParse(req.body);
  if (!parsedParams.success || !parsedBody.success) {
    res.status(400).json({
      error: {
        ...(!parsedParams.success ? parsedParams.error.flatten().fieldErrors : {}),
        ...(!parsedBody.success ? parsedBody.error.flatten().fieldErrors : {})
      }
    });
    return;
  }
  const { data, error } = await supabase
    .from("sales_bonus_programs")
    .update(normalizeProgramPatch(parsedBody.data))
    .eq("id", parsedParams.data.id)
    .eq("org_id", req.user!.orgId)
    .select()
    .single();
  if (error) {
    res.status(error.code === "PGRST116" ? 404 : 500).json({ error: error.code === "PGRST116" ? "Program not found." : error.message });
    return;
  }
  res.json(data);
});

router.delete("/programs/:id", ownerAdminOnly, async (req, res) => {
  const parsed = UuidParamsSchema.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("sales_bonus_programs")
    .update({ status: "deleted", deleted_at: now, updated_at: now })
    .eq("id", parsed.data.id)
    .eq("org_id", req.user!.orgId);
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.status(204).send();
});

router.post("/programs/:id/duplicate", ownerAdminOnly, async (req, res) => {
  const parsed = UuidParamsSchema.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }
  const { data: program, error: programError } = await supabase
    .from("sales_bonus_programs")
    .select("*")
    .eq("id", parsed.data.id)
    .eq("org_id", req.user!.orgId)
    .single();
  if (programError || !program) {
    res.status(404).json({ error: "Program not found." });
    return;
  }
  const { data: rules, error: rulesError } = await supabase
    .from("sales_bonus_rules")
    .select("*")
    .eq("program_id", parsed.data.id)
    .eq("org_id", req.user!.orgId)
    .neq("status", "deleted");
  if (rulesError) {
    res.status(500).json({ error: rulesError.message });
    return;
  }
  const { data: copy, error: copyError } = await supabase
    .from("sales_bonus_programs")
    .insert({
      org_id: req.user!.orgId,
      name: `${program.name} copy`,
      description: program.description ?? "",
      status: "draft",
      recurrence: "weekly",
      timezone: program.timezone ?? "Africa/Lagos",
      week_start_day: program.week_start_day ?? 0,
      starts_on: program.starts_on ?? new Date().toISOString().slice(0, 10),
      ends_on: program.ends_on ?? null,
      applies_to_user_ids: program.applies_to_user_ids ?? [],
      created_by: req.user!.id
    })
    .select()
    .single();
  if (copyError || !copy) {
    res.status(500).json({ error: copyError?.message ?? "Failed to duplicate program." });
    return;
  }
  if (rules?.length) {
    const { error: insertRulesError } = await supabase
      .from("sales_bonus_rules")
      .insert(rules.map((rule: any) => ({
        org_id: req.user!.orgId,
        program_id: copy.id,
        name: rule.name,
        type: rule.type,
        status: rule.status === "paused" ? "paused" : "active",
        config: rule.config ?? {},
        display_order: rule.display_order ?? 100
      })));
    if (insertRulesError) {
      res.status(500).json({ error: insertRulesError.message });
      return;
    }
  }
  res.status(201).json(copy);
});

router.post("/programs/:id/rules", ownerAdminOnly, async (req, res) => {
  const parsedParams = UuidParamsSchema.safeParse(req.params);
  const parsedBody = RuleBodySchema.safeParse(req.body);
  if (!parsedParams.success || !parsedBody.success) {
    res.status(400).json({
      error: {
        ...(!parsedParams.success ? parsedParams.error.flatten().fieldErrors : {}),
        ...(!parsedBody.success ? parsedBody.error.flatten().fieldErrors : {})
      }
    });
    return;
  }
  const { data: program } = await supabase
    .from("sales_bonus_programs")
    .select("id")
    .eq("id", parsedParams.data.id)
    .eq("org_id", req.user!.orgId)
    .neq("status", "deleted")
    .maybeSingle();
  if (!program) {
    res.status(404).json({ error: "Program not found." });
    return;
  }
  const { data, error } = await supabase
    .from("sales_bonus_rules")
    .insert(normalizeRuleInsert(req.user!.orgId, parsedParams.data.id, parsedBody.data))
    .select()
    .single();
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.status(201).json(data);
});

router.patch("/rules/:id", ownerAdminOnly, async (req, res) => {
  const parsedParams = UuidParamsSchema.safeParse(req.params);
  const parsedBody = RulePatchSchema.safeParse(req.body);
  if (!parsedParams.success || !parsedBody.success) {
    res.status(400).json({
      error: {
        ...(!parsedParams.success ? parsedParams.error.flatten().fieldErrors : {}),
        ...(!parsedBody.success ? parsedBody.error.flatten().fieldErrors : {})
      }
    });
    return;
  }
  const { data, error } = await supabase
    .from("sales_bonus_rules")
    .update(normalizeRulePatch(parsedBody.data))
    .eq("id", parsedParams.data.id)
    .eq("org_id", req.user!.orgId)
    .select()
    .single();
  if (error) {
    res.status(error.code === "PGRST116" ? 404 : 500).json({ error: error.code === "PGRST116" ? "Rule not found." : error.message });
    return;
  }
  res.json(data);
});

router.delete("/rules/:id", ownerAdminOnly, async (req, res) => {
  const parsed = UuidParamsSchema.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("sales_bonus_rules")
    .update({ status: "deleted", deleted_at: now, updated_at: now })
    .eq("id", parsed.data.id)
    .eq("org_id", req.user!.orgId);
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.status(204).send();
});

router.get("/progress", coachViewer, async (req, res) => {
  const parsed = QuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }
  try {
    const weekStart = clampSalesRepWeekStart(req.user!.role, parsed.data.weekStart ?? currentSalesBonusWeekStart());
    const repId = req.user!.role === "Sales Rep"
      ? (req.user!.effectiveUserId ?? req.user!.id)
      : undefined;
    res.json(await getSalesBonusProgress(req.user!.orgId, weekStart, { repId }));
  } catch (error: any) {
    res.status(400).json({ error: error?.message ?? "Failed to calculate bonus progress." });
  }
});

router.get("/progress/:repId", allRepViewer, async (req, res) => {
  const parsedQuery = QuerySchema.safeParse(req.query);
  const parsedParams = RepParamsSchema.safeParse(req.params);
  if (!parsedQuery.success || !parsedParams.success) {
    res.status(400).json({
      error: {
        ...(!parsedQuery.success ? parsedQuery.error.flatten().fieldErrors : {}),
        ...(!parsedParams.success ? parsedParams.error.flatten().fieldErrors : {})
      }
    });
    return;
  }
  try {
    const weekStart = parsedQuery.data.weekStart ?? currentSalesBonusWeekStart();
    res.json(await getSalesBonusProgress(req.user!.orgId, weekStart, { repId: parsedParams.data.repId }));
  } catch (error: any) {
    res.status(400).json({ error: error?.message ?? "Failed to calculate bonus progress." });
  }
});

// Maps {orderId -> attributed new-engine bonus amount} for delivered orders
// in the given date range - lets Net Profit / break-even views fold the new
// engine's cost in without re-deriving rule logic. See
// perOrderBonusMapForDeliveredRange in sales-bonus-engine.ts for the model.
const OrderBonusMapQuerySchema = z.object({
  dateFrom: z.string().regex(DATE_KEY_PATTERN).optional(),
  dateTo: z.string().regex(DATE_KEY_PATTERN)
});

// coachViewer (not allRepViewer) so a Sales Rep can see their own per-order
// attribution on their own order detail view - self-scoped below via repId,
// same pattern as /progress, since perOrderBonusMapForDeliveredRange is
// otherwise org-wide across every rep.
router.get("/order-bonus-map", coachViewer, async (req, res) => {
  const parsed = OrderBonusMapQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }
  const dateFrom = parsed.data.dateFrom ?? SALES_BONUS_LAUNCH_WEEK_START;
  if (dateFrom > parsed.data.dateTo) {
    res.status(400).json({ error: "dateFrom must be on or before dateTo." });
    return;
  }
  const repId = req.user!.role === "Sales Rep" ? (req.user!.effectiveUserId ?? req.user!.id) : undefined;
  try {
    res.json(await perOrderBonusMapForDeliveredRange(req.user!.orgId, dateFrom, parsed.data.dateTo, { repId }));
  } catch (error: any) {
    res.status(400).json({ error: error?.message ?? "Failed to calculate order bonus map." });
  }
});

// Order ids in this app are plain text/numeric (e.g. "1992"), not UUIDs -
// do not reuse UuidParamsSchema here.
const OrderIdParamsSchema = z.object({ orderId: z.string().min(1) });

router.get("/order-attribution/:orderId", coachViewer, async (req, res) => {
  const parsed = OrderIdParamsSchema.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid order id." });
    return;
  }
  try {
    const items = await perOrderSalesBonusBreakdown(req.user!.orgId, parsed.data.orderId);
    // Self-scope: a Sales Rep may only see their OWN order's breakdown - if
    // the order isn't assigned to them, treat it as empty rather than
    // leaking another rep's compensation figures.
    if (req.user!.role === "Sales Rep" && items.length > 0) {
      const { data: order } = await supabase
        .from("orders")
        .select("assigned_rep_id")
        .eq("org_id", req.user!.orgId)
        .eq("id", parsed.data.orderId)
        .maybeSingle();
      if (order?.assigned_rep_id !== (req.user!.effectiveUserId ?? req.user!.id)) {
        res.json([]);
        return;
      }
    }
    res.json(items);
  } catch (error: any) {
    res.status(400).json({ error: error?.message ?? "Failed to load order bonus breakdown." });
  }
});

export default router;
