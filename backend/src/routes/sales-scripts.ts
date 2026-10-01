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

// The Head of Sales bonus on the weekly report and the Owner's release of it
// (Bright, 1 Oct 2026). Since Sales Scripting replaced the single weekly
// script, "was a script used" reads the script library's usage records
// (sales_script_uses); the old weekly script tables (276) are no longer used.
// Rules live in lib/head-of-sales-script.ts.
const router = Router();
router.use(requireAuth);

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
const LEADERSHIP = ["Owner", "Admin", "Manager"];
const httpError = (status: number, message: string) => Object.assign(new Error(message), { status });
const fail = (res: any, error: any, fallback: string) => res.status(error?.status ?? 500).json({ error: error?.message ?? fallback });
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

export async function activeHead(orgId: string) {
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

export async function releaseFor(orgId: string, headId: string, weekStart: string) {
  const { data, error } = await supabase
    .from("head_of_sales_bonus_releases")
    .select("decision, was_held, hold_reasons, bonus_level, amount, note, decided_by_name, decided_at")
    .eq("org_id", orgId).eq("head_of_sales_rep_id", headId).eq("week_start", weekStart)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// ------------------------------------------ the bonus review on the weekly report

const cohortWeekKey = (order: HeadOfSalesOrder) => order.created_at ? lagosDateKey(order.created_at) : "";

// Scripts that were live (approved, not switched off) at some point in the week.
async function liveScriptsDuring(orgId: string, branchId: string, weekStart: string, weekEnd: string) {
  const { data, error } = await supabase.from("sales_script_versions")
    .select("script_id, title, approved_at, archived_at, sales_script_items!inner(product_id, deactivated_at, products(name))")
    .eq("org_id", orgId).eq("branch_id", branchId).not("approved_at", "is", null)
    .lte("approved_at", `${weekEnd}T23:59:59+01:00`);
  if (error) throw error;
  const startIso = new Date(`${weekStart}T00:00:00+01:00`).toISOString();
  const seen = new Map<string, { scriptId: string; title: string; productName: string }>();
  for (const row of (data ?? []) as any[]) {
    const item = row.sales_script_items;
    if (row.archived_at && row.archived_at < startIso) continue;
    if (item?.deactivated_at && item.deactivated_at < startIso) continue;
    seen.set(row.script_id, { scriptId: row.script_id, title: row.title, productName: item?.products?.name ?? "" });
  }
  return Array.from(seen.values());
}

async function scriptTitles(ids: string[]) {
  const { data, error } = await supabase.from("sales_script_versions")
    .select("script_id, title, version_no, sales_script_items!inner(products(name))").in("script_id", ids).order("version_no", { ascending: false });
  if (error) throw error;
  const out = new Map<string, { scriptId: string; title: string; productName: string }>();
  for (const row of (data ?? []) as any[]) if (!out.has(row.script_id)) out.set(row.script_id, { scriptId: row.script_id, title: row.title, productName: row.sales_script_items?.products?.name ?? "" });
  return Array.from(out.values());
}

export async function buildHeadReview(orgId: string, branchId: string, weekStart: string) {
  const head = await activeHead(orgId);
  if (!head) return { weekStart, head: null };
  const weekEnd = weekEndFromStart(weekStart);
  const team = await loadTeam(orgId);
  const repIds = team.map((user) => user.id);
  const nameOf = new Map(team.map((user) => [user.id, String(user.name ?? "")]));
  const [orders, settings, liveScripts, release, recordRes, usesRes] = await Promise.all([
    loadOrdersSince(orgId, repIds, addDaysToDateKey(weekStart, -28), weekEnd),
    loadHeadOfSalesBonusSettings(orgId),
    liveScriptsDuring(orgId, branchId, weekStart, weekEnd),
    releaseFor(orgId, head.id, weekStart),
    supabase.from("head_of_sales_bonus_weekly_records")
      .select("upsell_improvement, initiative_success, bonus_level, amount, status, paid_at")
      .eq("org_id", orgId).eq("head_of_sales_rep_id", head.id).eq("week_start", weekStart).maybeSingle(),
    supabase.from("sales_script_uses").select("order_id, rep_id, script_id, version_id, category, outcome").eq("org_id", orgId).eq("branch_id", branchId).eq("week_start", weekStart)
  ]);
  if (recordRes.error) throw recordRes.error;
  if (usesRes.error) throw usesRes.error;
  const record = recordRes.data;
  const uses = usesRes.data ?? [];
  // Orders where the rep recorded an approved upsell or cross-sell script
  // (Bright: the influence question is about upsell and cross-sell).
  const tickedOrderIds = new Set(uses.filter((row) => row.category === "upsell" || row.category === "cross_sell").map((row) => String(row.order_id)));

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
  const hold = headBonusHold({ amount: evaluation.amount, scriptSubmitted: liveScripts.length > 0, scriptUses: othersUses });

  // Which approved scripts the reps used this week, and how often the customer said yes.
  const usedScripts = new Map<string, { scriptId: string; category: string; used: number; accepted: number; byOthers: number }>();
  for (const use of uses) {
    const entry = usedScripts.get(use.script_id) ?? { scriptId: use.script_id, category: use.category, used: 0, accepted: 0, byOthers: 0 };
    entry.used += 1;
    if (use.outcome === "accepted") entry.accepted += 1;
    if (use.rep_id !== head.id) entry.byOthers += 1;
    usedScripts.set(use.script_id, entry);
  }
  const titleOf = new Map(liveScripts.map((row) => [row.scriptId, row]));
  const missingIds = Array.from(usedScripts.keys()).filter((id) => !titleOf.has(id));
  if (missingIds.length > 0) {
    for (const row of await scriptTitles(missingIds)) titleOf.set(row.scriptId, row);
  }

  return {
    weekStart,
    head,
    scripts: {
      live: liveScripts.length,
      used: Array.from(usedScripts.values()).map((entry) => ({
        ...entry, title: titleOf.get(entry.scriptId)?.title ?? "Script", productName: titleOf.get(entry.scriptId)?.productName ?? ""
      })).sort((a, b) => b.used - a.used)
    },
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
