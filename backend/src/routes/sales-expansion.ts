import { Router } from "express";
import { z } from "zod";
import { dailyComplianceBreakdownForWeek, defaultSalesExpansionSettings, loadSalesExpansionSettings, salesExpansionComplianceForRepWeek, salesExpansionSettingsFromRow, salesExpansionSummaryFromRows } from "../lib/sales-expansion.js";
import { supabase } from "../lib/supabase.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);

const SettingsSchema = z.object({
  enabled: z.boolean().optional(),
  enforcementMode: z.enum(["block_confirmation", "flag_only", "measure_only"]).optional(),
  enforcementStartsAt: z.string().datetime().optional(),
  attemptTargetPct: z.number().min(0).max(100).optional(),
  loggingTargetPct: z.number().min(0).max(100).optional(),
  crossSellConversionTargetPct: z.number().min(0).max(100).optional(),
  auditSamplePct: z.number().min(0).max(100).optional(),
  fullBonusCompliancePct: z.number().min(0).max(100).optional(),
  warningCompliancePct: z.number().min(0).max(100).optional(),
  minimumCompliancePct: z.number().min(0).max(100).optional(),
  warningReductionPct: z.number().min(0).max(100).optional(),
  minimumReductionPct: z.number().min(0).max(100).optional(),
  pipConsecutiveWeeks: z.number().int().min(1).max(12).optional(),
  title: z.string().min(1).max(160).optional(),
  guidance: z.string().min(1).max(2000).optional()
});

router.get("/settings", async (req, res) => {
  try {
    const result = await loadSalesExpansionSettings(req.user!.orgId);
    res.json({ ...result, canEdit: req.user!.role === "Owner" });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Could not load sales expansion settings." });
  }
});

router.patch("/settings", requireRole("Owner"), async (req, res) => {
  const parsed = SettingsSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten().fieldErrors }); return; }
  try {
    const current = await loadSalesExpansionSettings(req.user!.orgId).catch(() => ({ settings: defaultSalesExpansionSettings(), isDefault: true }));
    const next = { ...current.settings, ...parsed.data };
    if (!(next.fullBonusCompliancePct >= next.warningCompliancePct && next.warningCompliancePct >= next.minimumCompliancePct)) {
      res.status(400).json({ error: "Compliance thresholds must descend from full bonus to warning to minimum." });
      return;
    }
    const { data, error } = await supabase.from("sales_expansion_settings").upsert({
      org_id: req.user!.orgId,
      enabled: next.enabled,
      enforcement_mode: next.enforcementMode,
      enforcement_starts_at: next.enforcementStartsAt,
      attempt_target_pct: next.attemptTargetPct,
      logging_target_pct: next.loggingTargetPct,
      cross_sell_conversion_target_pct: next.crossSellConversionTargetPct,
      audit_sample_pct: next.auditSamplePct,
      full_bonus_compliance_pct: next.fullBonusCompliancePct,
      warning_compliance_pct: next.warningCompliancePct,
      minimum_compliance_pct: next.minimumCompliancePct,
      warning_reduction_pct: next.warningReductionPct,
      minimum_reduction_pct: next.minimumReductionPct,
      pip_consecutive_weeks: next.pipConsecutiveWeeks,
      title: next.title,
      guidance: next.guidance,
      updated_by: req.user!.id,
      updated_at: new Date().toISOString()
    }, { onConflict: "org_id" }).select("*").single();
    if (error) throw error;
    res.json({ settings: salesExpansionSettingsFromRow(data), isDefault: false, canEdit: true });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Could not save sales expansion settings." });
  }
});

const applyAttemptFilters = (query: any, req: any) => {
  const role = req.user!.effectiveUserRole ?? req.user!.role;
  const userId = req.user!.effectiveUserId ?? req.user!.id;
  let next = query.eq("org_id", req.user!.orgId).order("attempted_at", { ascending: false });
  if (role === "Sales Rep") next = next.eq("rep_id", userId);
  else if (req.query.repId) next = next.eq("rep_id", String(req.query.repId));
  if (req.query.dateFrom) next = next.gte("attempted_at", `${req.query.dateFrom}T00:00:00.000Z`);
  if (req.query.dateTo) next = next.lte("attempted_at", `${req.query.dateTo}T23:59:59.999Z`);
  if (req.query.eligibility) next = next.eq("eligibility", String(req.query.eligibility));
  if (req.query.auditStatus) next = next.eq("audit_status", String(req.query.auditStatus));
  return next;
};

router.get("/attempts", async (req, res) => {
  try {
    const query = applyAttemptFilters(
      supabase.from("order_sales_expansion_attempts").select("*, offer_lines:order_sales_expansion_offer_lines(*)"), req
    );
    const { data, error } = await query.limit(Math.min(1000, Math.max(1, Number(req.query.limit ?? 250))));
    if (error) throw error;
    const attempts = data ?? [];
    const orderIds = [...new Set(attempts.map((row: any) => row.order_id))];
    const repIds = [...new Set(attempts.map((row: any) => row.rep_id))];
    const [{ data: orders }, { data: users }] = await Promise.all([
      orderIds.length ? supabase.from("orders").select("id, customer, product_id, product_name, package_name, status, amount, currency, cross_sell_lines, delivered_date").eq("org_id", req.user!.orgId).in("id", orderIds) : Promise.resolve({ data: [] } as any),
      repIds.length ? supabase.from("users").select("id, name").eq("org_id", req.user!.orgId).in("id", repIds) : Promise.resolve({ data: [] } as any)
    ]);
    const orderMap = new Map((orders ?? []).map((row: any) => [row.id, row]));
    const userMap = new Map((users ?? []).map((row: any) => [row.id, row.name]));
    res.json(attempts.map((attempt: any) => ({ ...attempt, order: orderMap.get(attempt.order_id) ?? null, repName: userMap.get(attempt.rep_id) ?? "Unknown rep" })));
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Could not load sales expansion attempts." });
  }
});

router.get("/summary", async (req, res) => {
  try {
    const settingsResult = await loadSalesExpansionSettings(req.user!.orgId);
    const attemptQuery = applyAttemptFilters(supabase.from("order_sales_expansion_attempts").select("*"), req);
    const { data: attempts, error } = await attemptQuery.limit(5000);
    if (error) throw error;
    const orderIds = [...new Set((attempts ?? []).map((row: any) => row.order_id))];
    const [{ data: orders }, { data: lines }] = await Promise.all([
      orderIds.length ? supabase.from("orders").select("id, status, cross_sell_lines, amount, product_id, product_name, assigned_rep_id, created_at").eq("org_id", req.user!.orgId).in("id", orderIds) : Promise.resolve({ data: [] } as any),
      orderIds.length ? supabase.from("order_sales_expansion_offer_lines").select("*").eq("org_id", req.user!.orgId).in("order_id", orderIds) : Promise.resolve({ data: [] } as any)
    ]);
    const base = salesExpansionSummaryFromRows(attempts ?? [], orders ?? [], lines ?? []);
    const orderMap = new Map((orders ?? []).map((order: any) => [order.id, order]));
    const deliveredAcceptedLines = (lines ?? []).filter((line: any) => {
      if (line.offer_type !== "cross_sell" || line.response !== "accepted") return false;
      const order = orderMap.get(line.order_id) as any;
      return order?.status === "Delivered" && (order.cross_sell_lines ?? []).some((item: any) => item.id === line.linked_order_item_id);
    });
    const inventoryComponents = deliveredAcceptedLines.flatMap((line: any) => {
      const snapshot = line.offer_snapshot?.packageComponentsSnapshot ?? line.offer_snapshot?.package_components_snapshot ?? [];
      if (Array.isArray(snapshot) && snapshot.length > 0) return snapshot;
      return line.offered_product_id ? [{ productId: line.offered_product_id, quantity: line.offered_quantity ?? 1 }] : [];
    });
    const costProductIds = [...new Set(inventoryComponents.map((item: any) => item.productId ?? item.product_id).filter(Boolean))];
    const { data: pricingRows } = costProductIds.length
      ? await supabase.from("product_pricings").select("product_id, unit_cost, is_primary").in("product_id", costProductIds)
      : { data: [] as any[] };
    const unitCostByProduct = new Map<string, number>();
    for (const row of (pricingRows ?? []).sort((a: any, b: any) => Number(a.is_primary) - Number(b.is_primary))) {
      unitCostByProduct.set(row.product_id, Number(row.unit_cost ?? 0));
    }
    const deliveredAddOnCogs = inventoryComponents.reduce((sum: number, item: any) => {
      const productId = item.productId ?? item.product_id;
      return sum + (unitCostByProduct.get(productId) ?? 0) * Math.max(1, Number(item.quantity ?? 1));
    }, 0);
    const refusalCounts = new Map<string, number>();
    const pairingCounts = new Map<string, { offered: number; accepted: number; delivered: number; value: number }>();
    for (const line of lines ?? []) {
      if (line.refusal_reason) refusalCounts.set(line.refusal_reason, (refusalCounts.get(line.refusal_reason) ?? 0) + 1);
      const key = `${line.offer_type}:${line.offered_product_name ?? line.offered_package_name ?? "Unconfigured offer"}`;
      const current = pairingCounts.get(key) ?? { offered: 0, accepted: 0, delivered: 0, value: 0 };
      current.offered += line.response === "waived_no_offer" ? 0 : 1;
      if (line.response === "accepted") current.accepted += 1;
      if (deliveredAcceptedLines.some((candidate: any) => candidate.id === line.id)) {
        current.delivered += 1;
        current.value += Number(line.accepted_amount ?? 0);
      }
      pairingCounts.set(key, current);
    }

    let confirmedQuery = supabase.from("orders").select("id, assigned_rep_id, customer, product_name, created_at", { count: "exact" })
      .eq("org_id", req.user!.orgId).gte("created_at", settingsResult.settings.enforcementStartsAt).in("status", ["Confirmed", "In Process", "Dispatched", "Delivered"]);
    const role = req.user!.effectiveUserRole ?? req.user!.role;
    const userId = req.user!.effectiveUserId ?? req.user!.id;
    if (role === "Sales Rep") confirmedQuery = confirmedQuery.eq("assigned_rep_id", userId);
    else if (req.query.repId) confirmedQuery = confirmedQuery.eq("assigned_rep_id", String(req.query.repId));
    if (req.query.dateFrom) confirmedQuery = confirmedQuery.gte("created_at", `${req.query.dateFrom}T00:00:00.000Z`);
    if (req.query.dateTo) confirmedQuery = confirmedQuery.lte("created_at", `${req.query.dateTo}T23:59:59.999Z`);
    const { data: confirmed, count: confirmedCount } = await confirmedQuery.limit(5000);
    const attemptedIds = new Set((attempts ?? []).filter((row: any) => row.record_status === "active").map((row: any) => row.order_id));
    const missingLogs = (confirmed ?? []).filter((order: any) => !attemptedIds.has(order.id));
    const eligibleConfirmedCount = confirmedCount ?? (confirmed ?? []).length;
    const repIds = [...new Set([...(confirmed ?? []).map((order: any) => order.assigned_rep_id), ...(attempts ?? []).map((attempt: any) => attempt.rep_id)].filter(Boolean))];
    const { data: repRows } = repIds.length ? await supabase.from("users").select("id, name").eq("org_id", req.user!.orgId).in("id", repIds) : { data: [] as any[] };
    const attemptById = new Map((attempts ?? []).map((attempt: any) => [attempt.id, attempt]));
    const repPerformance = repIds.map((repId: any) => {
      const repAttempts = (attempts ?? []).filter((attempt: any) => attempt.rep_id === repId && attempt.record_status === "active");
      const repConfirmed = (confirmed ?? []).filter((order: any) => order.assigned_rep_id === repId);
      const repLines = (lines ?? []).filter((line: any) => (attemptById.get(line.attempt_id) as any)?.rep_id === repId);
      const accepted = repLines.filter((line: any) => line.offer_type === "cross_sell" && line.response === "accepted");
      const delivered = accepted.filter((line: any) => deliveredAcceptedLines.some((candidate: any) => candidate.id === line.id));
      return {
        repId,
        repName: (repRows ?? []).find((rep: any) => rep.id === repId)?.name ?? "Unknown rep",
        eligibleConfirmed: repConfirmed.length,
        logged: repAttempts.length,
        attemptRatePct: repConfirmed.length > 0 ? Math.round((repAttempts.length / repConfirmed.length) * 1000) / 10 : 100,
        exemptions: repAttempts.filter((attempt: any) => attempt.eligibility === "exempt").length,
        crossSellAccepted: accepted.length,
        crossSellDelivered: delivered.length,
        deliveredValue: delivered.reduce((sum: number, line: any) => sum + Number(line.accepted_amount ?? 0), 0),
        flagged: repAttempts.filter((attempt: any) => attempt.audit_status === "flagged").length
      };
    }).sort((a, b) => b.attemptRatePct - a.attemptRatePct || b.deliveredValue - a.deliveredValue);
    res.json({
      settings: settingsResult.settings,
      ...base,
      deliveredAddOnCogs,
      deliveredContributionProfit: Math.max(0, base.deliveredAddOnValue - deliveredAddOnCogs),
      refusalReasons: [...refusalCounts.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count),
      pairingPerformance: [...pairingCounts.entries()].map(([pairing, metrics]) => ({ pairing, ...metrics })).sort((a, b) => b.delivered - a.delivered || b.accepted - a.accepted),
      repPerformance,
      eligibleConfirmedCount,
      attemptRatePct: eligibleConfirmedCount > 0 ? Math.round((base.attemptCount / eligibleConfirmedCount) * 1000) / 10 : 0,
      loggingCompliancePct: eligibleConfirmedCount > 0 ? Math.round(((eligibleConfirmedCount - missingLogs.length) / eligibleConfirmedCount) * 1000) / 10 : 100,
      missingLogs
    });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Could not load sales expansion summary." });
  }
});

const WEEK_START_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const ComplianceWaiverParamsSchema = z.object({
  repId: z.string().uuid(),
  weekStart: z.string().regex(WEEK_START_PATTERN)
});
const ComplianceWaiverBodySchema = z.object({
  active: z.boolean(),
  reason: z.string().trim().min(5).max(2000)
});

router.put("/compliance-waivers/:repId/:weekStart", requireRole("Owner"), async (req, res) => {
  const parsedParams = ComplianceWaiverParamsSchema.safeParse(req.params);
  const parsedBody = ComplianceWaiverBodySchema.safeParse(req.body);
  if (!parsedParams.success || !parsedBody.success) {
    res.status(400).json({
      error: {
        ...(!parsedParams.success ? parsedParams.error.flatten().fieldErrors : {}),
        ...(!parsedBody.success ? parsedBody.error.flatten().fieldErrors : {})
      }
    });
    return;
  }
  try {
    const { data: rep, error: repError } = await supabase
      .from("users")
      .select("id, name, role")
      .eq("org_id", req.user!.orgId)
      .eq("id", parsedParams.data.repId)
      .maybeSingle();
    if (repError) throw repError;
    if (!rep || rep.role !== "Sales Rep") {
      res.status(404).json({ error: "Sales rep not found in this organization." });
      return;
    }
    const { data, error } = await supabase
      .from("sales_expansion_compliance_waivers")
      .insert({
        org_id: req.user!.orgId,
        rep_id: rep.id,
        week_start: parsedParams.data.weekStart,
        active: parsedBody.data.active,
        reason: parsedBody.data.reason,
        created_by: req.user!.id,
        created_by_name: req.user!.name
      })
      .select("*")
      .single();
    if (error) throw error;
    const compliance = await salesExpansionComplianceForRepWeek(req.user!.orgId, rep.id, parsedParams.data.weekStart);
    res.json({ waiver: data, compliance });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Could not update the compliance deduction waiver." });
  }
});

router.get("/daily-compliance", async (req, res) => {
  const weekStart = typeof req.query.weekStart === "string" && WEEK_START_PATTERN.test(req.query.weekStart) ? req.query.weekStart : null;
  if (!weekStart) { res.status(400).json({ error: "weekStart (YYYY-MM-DD) is required." }); return; }
  const role = req.user!.effectiveUserRole ?? req.user!.role;
  const userId = req.user!.effectiveUserId ?? req.user!.id;
  const repId = role === "Sales Rep" ? userId : (typeof req.query.repId === "string" ? req.query.repId : null);
  try {
    const days = await dailyComplianceBreakdownForWeek(req.user!.orgId, weekStart, repId);
    res.json({ weekStart, days });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Could not load daily compliance breakdown." });
  }
});

const AuditSchema = z.object({ status: z.enum(["verified", "flagged"]), note: z.string().min(1).max(2000) });
router.patch("/attempts/:id/audit", requireRole("Owner", "Admin", "Manager"), async (req, res) => {
  const parsed = AuditSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten().fieldErrors }); return; }
  try {
    const { data, error } = await supabase.from("order_sales_expansion_attempts").update({
      audit_status: parsed.data.status,
      audit_note: parsed.data.note,
      audited_by: req.user!.id,
      audited_at: new Date().toISOString()
    }).eq("org_id", req.user!.orgId).eq("id", req.params.id).select("*").maybeSingle();
    if (error) throw error;
    if (!data) { res.status(404).json({ error: "Sales expansion log not found." }); return; }
    await supabase.from("order_audit").insert({
      org_id: req.user!.orgId,
      order_id: data.order_id,
      changed_by: req.user!.id,
      from_status: null,
      to_status: null,
      note: `Sales expansion log ${parsed.data.status} by ${req.user!.name}. ${parsed.data.note}`
    });
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Could not audit the sales expansion log." });
  }
});

const CorrectionSchema = z.object({ reason: z.string().min(5).max(2000) });
router.patch("/attempts/:id/correction", requireRole("Owner", "Admin", "Manager"), async (req, res) => {
  const parsed = CorrectionSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten().fieldErrors }); return; }
  try {
    const { data, error } = await supabase.from("order_sales_expansion_attempts").update({
      record_status: "voided",
      correction_reason: parsed.data.reason,
      audit_status: "flagged",
      audit_note: `Voided for correction: ${parsed.data.reason}`,
      audited_by: req.user!.id,
      audited_at: new Date().toISOString()
    }).eq("org_id", req.user!.orgId).eq("id", req.params.id).eq("record_status", "active").select("*").maybeSingle();
    if (error) throw error;
    if (!data) { res.status(404).json({ error: "Active sales expansion log not found." }); return; }
    await supabase.from("order_audit").insert({
      org_id: req.user!.orgId,
      order_id: data.order_id,
      changed_by: req.user!.id,
      from_status: null,
      to_status: null,
      note: `Sales expansion log voided for correction by ${req.user!.name}. Reason: ${parsed.data.reason}. Order items were not silently changed.`
    });
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Could not void this log for correction." });
  }
});

export default router;
