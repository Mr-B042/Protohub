import { Router, type Request } from "express";
import { z } from "zod";
import { supabase } from "../lib/supabase.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import {
  addDaysToDateKey,
  computeRepWeekMetrics,
  computeTeamWeekMetrics,
  computeTrailingBaseline,
  lagosDateKey,
  sundayWeekStartForDateKey,
  weekEndFromStart,
  type HeadOfSalesOrder
} from "../lib/head-of-sales-metrics.js";
import { evaluateHeadOfSalesBonus } from "../lib/head-of-sales-bonus.js";
import { classifyRepInfluence, headBonusHold, HOLD_REASON_TEXT, orderHasRepExpansion } from "../lib/head-of-sales-script.js";
import { loadHeadOfSalesBonusSettings, loadOrdersSince, loadTeam } from "./head-of-sales-rep.js";
import { notifyHeadOfSales } from "../lib/weekly-report-notifications.js";

// Head of Sales weekly script, the rep's "I used the script" tick, and the
// Owner's release of the Head of Sales bonus (Bright, 1 Oct 2026). The rules
// live in lib/head-of-sales-script.ts; this file only loads and saves.
const router = Router();
router.use(requireAuth);

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
const LEADERSHIP = ["Owner", "Admin", "Manager"];
const httpError = (status: number, message: string) => Object.assign(new Error(message), { status });
const fail = (res: any, error: any, fallback: string) => res.status(error?.status ?? 500).json({ error: error?.message ?? fallback });
const thisWeekStart = () => sundayWeekStartForDateKey(lagosDateKey());
const weekOf = (value: unknown) => {
  const raw = typeof value === "string" && DATE_KEY.test(value) ? value : lagosDateKey();
  return sundayWeekStartForDateKey(raw);
};
const branchOf = (req: Request) => {
  const branchId = req.user!.branchId;
  if (!branchId) throw httpError(400, "Open a branch first.");
  return branchId;
};

async function audit(req: Request, branchId: string, weekStart: string, action: string, detail: Record<string, unknown>) {
  await supabase.from("weekly_report_audit").insert({
    org_id: req.user!.orgId, branch_id: branchId, week_start: weekStart,
    rep_id: (detail.repId as string) ?? null,
    actor_id: req.user!.id, actor_name: req.user!.name ?? null, actor_role: req.user!.role, action, detail
  });
}

async function activeHead(orgId: string) {
  const { data, error } = await supabase
    .from("users")
    .select("id, name, head_of_sales_rep_appointed_at")
    .eq("org_id", orgId)
    .eq("role", "Sales Rep")
    .eq("is_head_of_sales_rep", true)
    .eq("active", true)
    .order("head_of_sales_rep_appointed_at", { ascending: false })
    .limit(1);
  if (error) throw error;
  return (data?.[0] ?? null) as { id: string; name: string } | null;
}

async function scriptFor(orgId: string, branchId: string, weekStart: string) {
  const { data, error } = await supabase
    .from("sales_scripts")
    .select("id, head_of_sales_rep_id, week_start, upsell_script, cross_sell_script, submitted_at, updated_at")
    .eq("org_id", orgId).eq("branch_id", branchId).eq("week_start", weekStart)
    .maybeSingle();
  if (error) throw error;
  return data;
}

const mapScript = (row: any) => row ? {
  id: row.id,
  weekStart: row.week_start,
  headId: row.head_of_sales_rep_id,
  upsellScript: row.upsell_script ?? "",
  crossSellScript: row.cross_sell_script ?? "",
  submittedAt: row.submitted_at,
  updatedAt: row.updated_at
} : null;

async function releaseFor(orgId: string, headId: string, weekStart: string) {
  const { data, error } = await supabase
    .from("head_of_sales_bonus_releases")
    .select("decision, was_held, hold_reasons, bonus_level, amount, note, decided_by_name, decided_at")
    .eq("org_id", orgId).eq("head_of_sales_rep_id", headId).eq("week_start", weekStart)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// ---------------------------------------------------------------- the script

router.get("/week", async (req, res) => {
  try {
    const orgId = req.user!.orgId;
    const branchId = branchOf(req);
    const weekStart = weekOf(req.query.weekStart);
    const [script, head] = await Promise.all([scriptFor(orgId, branchId, weekStart), activeHead(orgId)]);
    const isHead = req.user!.role === "Sales Rep" && head?.id === req.user!.id;
    res.json({
      weekStart,
      script: mapScript(script),
      head,
      // Only this week or next: a script written after the week is over could
      // not have helped anyone sell.
      canEdit: isHead && weekStart >= thisWeekStart() && weekStart <= addDaysToDateKey(thisWeekStart(), 7)
    });
  } catch (error: any) {
    fail(res, error, "Could not load the script.");
  }
});

const ScriptSchema = z.object({
  weekStart: z.string().regex(DATE_KEY),
  upsellScript: z.string().trim().max(4000),
  crossSellScript: z.string().trim().max(4000)
});

router.put("/week", requireRole("Sales Rep"), async (req, res) => {
  const parsed = ScriptSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Write the upsell and cross-sell script." }); return; }
  try {
    const orgId = req.user!.orgId;
    const branchId = branchOf(req);
    const head = await activeHead(orgId);
    if (head?.id !== req.user!.id) throw httpError(403, "Only the Head of Sales Rep writes the weekly script.");
    const weekStart = sundayWeekStartForDateKey(parsed.data.weekStart);
    if (weekStart < thisWeekStart() || weekStart > addDaysToDateKey(thisWeekStart(), 7)) {
      throw httpError(400, "You can only write the script for this week or next week.");
    }
    if (parsed.data.upsellScript.length < 10 && parsed.data.crossSellScript.length < 10) {
      throw httpError(400, "Write at least one of the two scripts (10 characters or more).");
    }
    const existing = await scriptFor(orgId, branchId, weekStart);
    const now = new Date().toISOString();
    if (existing) {
      const { error } = await supabase.from("sales_scripts")
        .update({ upsell_script: parsed.data.upsellScript, cross_sell_script: parsed.data.crossSellScript, updated_at: now })
        .eq("id", existing.id);
      if (error) throw error;
    } else {
      const { error } = await supabase.from("sales_scripts").insert({
        org_id: orgId, branch_id: branchId, head_of_sales_rep_id: req.user!.id, week_start: weekStart,
        upsell_script: parsed.data.upsellScript, cross_sell_script: parsed.data.crossSellScript, submitted_at: now
      });
      if (error) throw error;
    }
    await audit(req, branchId, weekStart, existing ? "sales_script_updated" : "sales_script_submitted", { repId: req.user!.id });
    if (!existing) {
      const team = (await loadTeam(orgId)).map((user) => user.id).filter((id) => id !== req.user!.id);
      void notifyHeadOfSales(orgId, branchId, { kind: "script_submitted", headName: head.name, weekStart, repIds: team });
    }
    res.json({ script: mapScript(await scriptFor(orgId, branchId, weekStart)) });
  } catch (error: any) {
    fail(res, error, "Could not save the script.");
  }
});

// ------------------------------------------------------- the rep's order tick

async function loadOrder(orgId: string, orderId: string) {
  const { data, error } = await supabase
    .from("orders")
    .select("id, assigned_rep_id, created_at, upsell_from_qty, upsell_to_qty, cross_sell_lines")
    .eq("org_id", orgId).eq("id", orderId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw httpError(404, "Order not found.");
  return data;
}

router.get("/orders/:orderId", async (req, res) => {
  try {
    const orgId = req.user!.orgId;
    const branchId = branchOf(req);
    const order = await loadOrder(orgId, String(req.params.orderId));
    const weekStart = sundayWeekStartForDateKey(order.created_at ? lagosDateKey(order.created_at) : lagosDateKey());
    const [script, useRow] = await Promise.all([
      scriptFor(orgId, branchId, weekStart),
      supabase.from("order_script_uses").select("created_at, rep_id").eq("org_id", orgId).eq("order_id", order.id).maybeSingle()
    ]);
    if (useRow.error) throw useRow.error;
    res.json({
      weekStart,
      eligible: orderHasRepExpansion(order),
      script: mapScript(script),
      used: Boolean(useRow.data),
      usedAt: useRow.data?.created_at ?? null,
      canTick: req.user!.role === "Sales Rep" && order.assigned_rep_id === req.user!.id
    });
  } catch (error: any) {
    fail(res, error, "Could not load the script for this order.");
  }
});

router.post("/orders/:orderId/use", requireRole("Sales Rep"), async (req, res) => {
  const parsed = z.object({ used: z.boolean() }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Say whether you used the script." }); return; }
  try {
    const orgId = req.user!.orgId;
    const branchId = branchOf(req);
    const order = await loadOrder(orgId, String(req.params.orderId));
    if (order.assigned_rep_id !== req.user!.id) throw httpError(403, "Only the rep on this order can tick it.");
    if (!orderHasRepExpansion(order)) throw httpError(400, "Add the upsell or cross-sell first, then tick the script.");
    const weekStart = sundayWeekStartForDateKey(order.created_at ? lagosDateKey(order.created_at) : lagosDateKey());
    const script = await scriptFor(orgId, branchId, weekStart);
    if (!script) throw httpError(400, "There is no script for this order's week yet.");
    const head = await activeHead(orgId);
    if (head && await releaseFor(orgId, head.id, weekStart)) throw httpError(409, "This week's Head of Sales bonus is already decided, so script ticks are closed.");

    if (parsed.data.used) {
      const { error } = await supabase.from("order_script_uses").upsert({
        org_id: orgId, branch_id: branchId, order_id: order.id, rep_id: req.user!.id, script_id: script.id, week_start: weekStart
      }, { onConflict: "org_id,order_id", ignoreDuplicates: true });
      if (error) throw error;
    } else {
      const { error } = await supabase.from("order_script_uses").delete().eq("org_id", orgId).eq("order_id", order.id);
      if (error) throw error;
    }
    await audit(req, branchId, weekStart, parsed.data.used ? "sales_script_used" : "sales_script_unticked", { repId: req.user!.id, orderId: order.id });
    res.json({ used: parsed.data.used });
  } catch (error: any) {
    fail(res, error, "Could not save the script tick.");
  }
});

// ------------------------------------------ the bonus review on the weekly report

const cohortWeekKey = (order: HeadOfSalesOrder) => order.created_at ? lagosDateKey(order.created_at) : "";

export async function buildHeadReview(orgId: string, branchId: string, weekStart: string) {
  const head = await activeHead(orgId);
  if (!head) return { weekStart, head: null };
  const weekEnd = weekEndFromStart(weekStart);
  const team = await loadTeam(orgId);
  const repIds = team.map((user) => user.id);
  const nameOf = new Map(team.map((user) => [user.id, String(user.name ?? "")]));
  const [orders, settings, script, release, recordRes, usesRes] = await Promise.all([
    loadOrdersSince(orgId, repIds, addDaysToDateKey(weekStart, -28), weekEnd),
    loadHeadOfSalesBonusSettings(orgId),
    scriptFor(orgId, branchId, weekStart),
    releaseFor(orgId, head.id, weekStart),
    supabase.from("head_of_sales_bonus_weekly_records")
      .select("upsell_improvement, initiative_success, bonus_level, amount, status, paid_at")
      .eq("org_id", orgId).eq("head_of_sales_rep_id", head.id).eq("week_start", weekStart).maybeSingle(),
    supabase.from("order_script_uses").select("order_id, rep_id").eq("org_id", orgId).eq("branch_id", branchId).eq("week_start", weekStart)
  ]);
  if (recordRes.error) throw recordRes.error;
  if (usesRes.error) throw usesRes.error;
  const record = recordRes.data;
  const tickedOrderIds = new Set((usesRes.data ?? []).map((row) => String(row.order_id)));

  const teamWeek = computeTeamWeekMetrics(orders, repIds, weekStart);
  const teamBaseline = computeTrailingBaseline(orders, repIds, weekStart, 4);
  const qualitative = { upsellImprovement: Boolean(record?.upsell_improvement), initiativeSuccess: Boolean(record?.initiative_success) };
  const evaluation = evaluateHeadOfSalesBonus(settings, teamWeek.team.aov, teamWeek.team.deliveryRate, qualitative);

  const reps = repIds.map((repId) => {
    const week = computeRepWeekMetrics(orders, repId, weekStart);
    const baseline = computeTrailingBaseline(orders, [repId], weekStart, 4).team;
    const expansion = orders.filter((order) => order.assigned_rep_id === repId && order.review_hold !== true
      && cohortWeekKey(order) >= weekStart && cohortWeekKey(order) <= weekEnd && orderHasRepExpansion(order as any));
    const scriptOrders = expansion.filter((order) => tickedOrderIds.has(String(order.id))).length;
    const influence = classifyRepInfluence({
      upsellRate: week.upsellRate, crossSellRate: week.crossSellRate,
      baselineUpsellRate: baseline.upsellRate, baselineCrossSellRate: baseline.crossSellRate,
      expansionOrders: expansion.length, scriptOrders
    });
    return {
      repId, repName: nameOf.get(repId) ?? "", isHead: repId === head.id,
      upsellRate: week.upsellRate, baselineUpsellRate: baseline.upsellRate,
      crossSellRate: week.crossSellRate, baselineCrossSellRate: baseline.crossSellRate,
      expansionOrders: expansion.length, scriptOrders, ...influence
    };
  }).sort((a, b) => Number(a.isHead) - Number(b.isHead) || a.repName.localeCompare(b.repName));

  // Her own book is in the team numbers (Bright, 20 Aug), but the question
  // here is whether she lifted the OTHERS, so script use counts other reps.
  const othersUses = reps.filter((rep) => !rep.isHead).reduce((sum, rep) => sum + rep.scriptOrders, 0);
  const hold = headBonusHold({ amount: evaluation.amount, scriptSubmitted: Boolean(script), scriptUses: othersUses });

  return {
    weekStart,
    head,
    script: mapScript(script),
    team: {
      aov: teamWeek.team.aov, deliveryRate: teamWeek.team.deliveryRate,
      upsellRate: teamWeek.team.upsellRate, crossSellRate: teamWeek.team.crossSellRate,
      baselineUpsellRate: teamBaseline.team.upsellRate, baselineCrossSellRate: teamBaseline.team.crossSellRate
    },
    evaluation: { level: evaluation.level, label: evaluation.label, amount: evaluation.amount },
    qualitative,
    // A hint for the Level 2 check, never a decision: did the team's upsell or
    // cross-sell rate beat its own last 4 weeks?
    teamImproved: teamWeek.team.upsellRate > teamBaseline.team.upsellRate || teamWeek.team.crossSellRate > teamBaseline.team.crossSellRate,
    reps,
    scriptUses: othersUses,
    hold: { held: hold.held, reasons: hold.reasons.map((reason) => HOLD_REASON_TEXT[reason]) },
    record: record ? { status: record.status, amount: Number(record.amount), level: record.bonus_level, paidAt: record.paid_at } : null,
    release: release ? {
      decision: release.decision, wasHeld: release.was_held, level: release.bonus_level, amount: Number(release.amount),
      note: release.note, decidedBy: release.decided_by_name, decidedAt: release.decided_at
    } : null,
    weekOver: weekEnd < lagosDateKey()
  };
}

router.get("/head-review", async (req, res) => {
  try {
    const orgId = req.user!.orgId;
    const branchId = branchOf(req);
    const weekStart = weekOf(req.query.weekStart);
    const review = await buildHeadReview(orgId, branchId, weekStart);
    const isLeader = LEADERSHIP.includes(req.user!.role);
    if (!isLeader && review.head?.id !== req.user!.id) throw httpError(403, "Only leadership or the Head of Sales Rep can see this.");
    res.json(review);
  } catch (error: any) {
    fail(res, error, "Could not load the Head of Sales review.");
  }
});

const ReleaseSchema = z.object({
  weekStart: z.string().regex(DATE_KEY),
  decision: z.enum(["release", "withhold"]),
  upsellImprovement: z.boolean().optional(),
  initiativeSuccess: z.boolean().optional(),
  note: z.string().trim().max(2000).optional()
});

router.post("/head-review/release", requireRole("Owner"), async (req, res) => {
  const parsed = ReleaseSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Choose release or withhold." }); return; }
  try {
    const orgId = req.user!.orgId;
    const branchId = branchOf(req);
    const weekStart = sundayWeekStartForDateKey(parsed.data.weekStart);
    const review = await buildHeadReview(orgId, branchId, weekStart);
    if (!review.head) throw httpError(404, "Nobody is Head of Sales Rep.");
    const head = review.head;
    if (!("weekOver" in review) || !review.weekOver) throw httpError(400, "Wait until the week is over before deciding the bonus.");
    if (review.record?.status === "Paid") throw httpError(409, "This week's bonus is already paid.");
    const note = parsed.data.note?.trim() || null;
    if (parsed.data.decision === "withhold" && (!note || note.length < 5)) throw httpError(400, "Say why the bonus is withheld.");
    if (parsed.data.decision === "release" && review.hold.held && (!note || note.length < 5)) {
      throw httpError(400, "This bonus is on hold. Say why you are releasing it anyway.");
    }

    const settings = await loadHeadOfSalesBonusSettings(orgId);
    const qualitative = {
      upsellImprovement: parsed.data.upsellImprovement ?? review.qualitative.upsellImprovement,
      initiativeSuccess: parsed.data.initiativeSuccess ?? review.qualitative.initiativeSuccess
    };
    const evaluation = evaluateHeadOfSalesBonus(settings, review.team.aov, review.team.deliveryRate, qualitative);
    const released = parsed.data.decision === "release";
    const amount = released ? evaluation.amount : 0;
    if (released && amount <= 0) throw httpError(400, "There is no bonus to release this week.");

    // The payout record the Bonus & Payouts page already reads and pays from.
    const recordRow = {
      org_id: orgId, branch_id: branchId, head_of_sales_rep_id: head.id, week_start: weekStart,
      team_aov: review.team.aov, team_delivery_rate: review.team.deliveryRate,
      upsell_improvement: qualitative.upsellImprovement, initiative_success: qualitative.initiativeSuccess,
      bonus_level: released ? evaluation.level : "none", amount,
      notes: released ? (note ? `Released by Owner: ${note}` : "Released by Owner on the weekly report.") : `Withheld by Owner: ${note}`,
      updated_at: new Date().toISOString()
    };
    const { error: recordError } = await supabase.from("head_of_sales_bonus_weekly_records")
      .upsert(recordRow, { onConflict: "org_id,head_of_sales_rep_id,week_start" });
    if (recordError) throw recordError;

    const { error: releaseError } = await supabase.from("head_of_sales_bonus_releases").upsert({
      org_id: orgId, branch_id: branchId, head_of_sales_rep_id: head.id, week_start: weekStart,
      decision: released ? "released" : "withheld", was_held: review.hold.held, hold_reasons: review.hold.reasons,
      bonus_level: evaluation.level, amount, note,
      decided_by: req.user!.id, decided_by_name: req.user!.name ?? null, decided_at: new Date().toISOString()
    }, { onConflict: "org_id,head_of_sales_rep_id,week_start" });
    if (releaseError) throw releaseError;

    await audit(req, branchId, weekStart, released ? "head_of_sales_bonus_released" : "head_of_sales_bonus_withheld", {
      repId: head.id, amount, level: evaluation.level, wasHeld: review.hold.held, note
    });
    void notifyHeadOfSales(orgId, branchId, { kind: "bonus_decided", headId: head.id, weekStart, amount, released, note });
    res.json(await buildHeadReview(orgId, branchId, weekStart));
  } catch (error: any) {
    fail(res, error, "Could not save the decision.");
  }
});

export default router;
