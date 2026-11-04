import { Router, type Request } from "express";
import { z } from "zod";
import { humanFieldErrors } from "../lib/validation-message.js";
import { supabase } from "../lib/supabase.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { lagosDateKey, sundayWeekStartForDateKey } from "../lib/sales-bonus-engine.js";
import { MISSING_FEE_TYPE } from "../lib/missing-fee-penalty.js";
import { LATE_SEND_FINE_TYPE } from "../lib/late-send.js";
import { NO_FEE_CHARGE_TYPE } from "../lib/review-order-decisions.js";
import { HELD, canStillAppeal, cancelOutcome, snapshotWithFine } from "../lib/fine-appeal-rules.js";
import { deliver, leadershipRecipients } from "../lib/weekly-report-notifications.js";

/**
 * Fine appeals (Bright, 4 Nov 2026). A rep says why a fine should not stand;
 * the Manager/Admin keeps or cancels it (a fine the Owner charged: the Owner
 * cancels). While open it is not deducted. Missed-log charges keep their own
 * dispute (routes/log-misses.ts) and are not appealed here.
 */
const router = Router();
router.use(requireAuth);

const httpError = (status: number, message: string) => Object.assign(new Error(message), { status });
const sendError = (res: any, error: any, fallback: string) => res.status(error?.status ?? 500).json({ error: error?.message ?? fallback });
const naira = (value: number) => `₦${Math.round(value).toLocaleString("en-NG")}`;
const NOT_APPEALED_HERE = ["follow_up_miss", MISSING_FEE_TYPE];

/** The fine's line, as the weekly report shows it. */
export const fineLabel = (row: { type?: string | null; reason?: string | null }) =>
  [row.type === LATE_SEND_FINE_TYPE ? "Late order send" : row.type === NO_FEE_CHARGE_TYPE ? "No delivery fee" : row.type, row.reason].filter(Boolean).join(" - ");

const COLUMNS = "id, rep_id, penalty_id, week_start, amount, fine_type, fine_label, charged_by_name, charged_at, rep_reason, status, decided_by_name, decided_at, decision_note, created_at";
export const mapAppeal = (row: any) => ({
  id: row.id, repId: row.rep_id, penaltyId: row.penalty_id, weekStart: row.week_start, amount: Number(row.amount ?? 0),
  fineType: row.fine_type ?? null, fineLabel: row.fine_label, chargedByName: row.charged_by_name ?? null, chargedAt: row.charged_at ?? null,
  repReason: row.rep_reason, status: row.status, decidedByName: row.decided_by_name ?? null, decidedAt: row.decided_at ?? null,
  decisionNote: row.decision_note ?? null, createdAt: row.created_at
});

/** Appeals on the week's fines (any status), for the weekly report screens. */
export async function appealsForWeek(orgId: string, branchId: string, repIds: string[] | null, weekStart: string) {
  let query = supabase.from("fine_appeals").select(COLUMNS).eq("org_id", orgId).eq("branch_id", branchId).eq("week_start", weekStart)
    .order("created_at", { ascending: false }).limit(500);
  if (repIds) query = query.in("rep_id", repIds);
  const { data, error } = await query;
  if (error) throw error;
  const repIdsSeen = [...new Set((data ?? []).map((row: any) => String(row.rep_id)))];
  const { data: people } = repIdsSeen.length ? await supabase.from("users").select("id, name").in("id", repIdsSeen) : { data: [] as any[] };
  const nameOf = new Map((people ?? []).map((row: any) => [String(row.id), String(row.name ?? "")]));
  return (data ?? []).map((row: any) => ({ ...mapAppeal(row), repName: nameOf.get(String(row.rep_id)) || null }));
}

/** Fines whose appeal is still undecided: not deducted until it is. */
export async function heldPenaltyIds(orgId: string, penaltyIds: string[]): Promise<Set<string>> {
  const held = new Set<string>();
  for (let i = 0; i < penaltyIds.length; i += 200) {
    const { data, error } = await supabase.from("fine_appeals").select("penalty_id").eq("org_id", orgId)
      .in("penalty_id", penaltyIds.slice(i, i + 200)).in("status", HELD);
    if (error) throw error;
    for (const row of data ?? []) held.add(String((row as any).penalty_id));
  }
  return held;
}

/** Undecided appeals of the week: the report cannot go to the Owner with any. */
export async function undecidedAppealCount(orgId: string, branchId: string, weekStart: string) {
  const { count, error } = await supabase.from("fine_appeals").select("id", { count: "exact", head: true })
    .eq("org_id", orgId).eq("branch_id", branchId).eq("week_start", weekStart).in("status", HELD);
  if (error) throw error;
  return count ?? 0;
}

async function companyStatusFor(orgId: string, branchId: string, weekStart: string) {
  const { data, error } = await supabase.from("company_weekly_reports").select("status").eq("org_id", orgId).eq("branch_id", branchId).eq("week_start", weekStart).maybeSingle();
  if (error) throw error;
  return (data?.status as string | undefined) ?? null;
}

/** A report the rep already sent holds its figures: take the fine out or put it back. */
async function reflectInSentReport(orgId: string, branchId: string, repId: string, weekStart: string, fine: { id: string; label: string; amount: number; date: string }, include: boolean) {
  const { data: report, error } = await supabase.from("rep_weekly_reports").select("id, status, snapshot")
    .eq("org_id", orgId).eq("branch_id", branchId).eq("rep_id", repId).eq("week_start", weekStart).maybeSingle();
  if (error) throw error;
  if (!report || !report.snapshot || !["submitted", "manager_approved", "returned"].includes(String(report.status))) return;
  const next = snapshotWithFine(report.snapshot, fine, include);
  if (next === report.snapshot) return;
  const { error: updateError } = await supabase.from("rep_weekly_reports").update({ snapshot: next, updated_at: new Date().toISOString() }).eq("id", report.id);
  if (updateError) throw updateError;
}

async function audit(req: Request, branchId: string, weekStart: string, repId: string, action: string, detail: Record<string, unknown>) {
  await supabase.from("weekly_report_audit").insert({
    org_id: req.user!.orgId, branch_id: branchId, week_start: weekStart, rep_id: repId,
    actor_id: req.user!.id, actor_name: req.user!.name ?? null, actor_role: req.user!.role, action, detail
  });
}

// ── Rep: appeal ─────────────────────────────────────────────────────────────

router.post("/", requireRole("Sales Rep"), async (req, res) => {
  const parsed = z.object({
    penaltyId: z.string().uuid(),
    reason: z.string().trim().min(5, "Say why this fine should not stand.").max(1000)
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: humanFieldErrors(parsed.error) }); return; }
  try {
    const orgId = req.user!.orgId;
    const branchId = req.user!.branchId;
    if (!branchId) throw httpError(400, "Open a branch first.");
    const { data: fine, error } = await supabase.from("rep_penalties").select("id, rep_id, type, amount, reason, by_name, created_at")
      .eq("id", parsed.data.penaltyId).eq("org_id", orgId).maybeSingle();
    if (error) throw error;
    if (!fine || fine.rep_id !== req.user!.id) throw httpError(404, "That fine was not found.");
    if (NOT_APPEALED_HERE.includes(String(fine.type))) throw httpError(400, "Missed-log charges are disputed from My Missed Logs.");
    const weekStart = sundayWeekStartForDateKey(lagosDateKey(String(fine.created_at)));
    if (!canStillAppeal(await companyStatusFor(orgId, branchId, weekStart))) throw httpError(409, "This week's report is already with the owner, so its fines can no longer be appealed.");
    const label = fineLabel(fine);
    const amount = Number(fine.amount ?? 0);
    const { data: appeal, error: insertError } = await supabase.from("fine_appeals").insert({
      org_id: orgId, branch_id: branchId, rep_id: req.user!.id, penalty_id: fine.id, week_start: weekStart,
      amount, fine_type: fine.type ?? null, fine_label: label, charged_by_name: fine.by_name ?? null, charged_at: fine.created_at,
      rep_reason: parsed.data.reason
    }).select("id").single();
    if (insertError) {
      if ((insertError as any).code === "23505") throw httpError(409, "You already appealed this fine.");
      throw insertError;
    }
    await reflectInSentReport(orgId, branchId, req.user!.id, weekStart, { id: fine.id, label, amount, date: String(fine.created_at).slice(0, 10) }, false);
    await audit(req, branchId, weekStart, req.user!.id, "fine_appealed", { appealId: appeal.id, penaltyId: fine.id, amount, label, reason: parsed.data.reason });
    void deliver(orgId, branchId, await leadershipRecipients(orgId, branchId, ["Admin", "Manager"]), {
      title: `${req.user!.name ?? "A rep"} appealed a ${naira(amount)} fine`,
      message: `${label}. "${parsed.data.reason.slice(0, 140)}" Keep or cancel it in the weekly report.`,
      kind: "fine_appeal", tag: `fine-appeal-${appeal.id}`, type: "warning"
    }).catch(() => undefined);
    res.status(201).json({ id: appeal.id });
  } catch (error: any) {
    sendError(res, error, "Could not send your appeal.");
  }
});

// ── Leadership: decide ──────────────────────────────────────────────────────

router.post("/:id/decide", requireRole("Manager", "Admin", "Owner"), async (req, res) => {
  const parsed = z.object({ outcome: z.enum(["cancel", "keep"]), note: z.string().trim().min(3, "Tell the rep what you found.").max(1000) }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: humanFieldErrors(parsed.error) }); return; }
  try {
    const orgId = req.user!.orgId;
    const branchId = req.user!.branchId;
    if (!branchId) throw httpError(400, "Open a branch first.");
    const { data: appeal, error } = await supabase.from("fine_appeals").select("*").eq("id", String(req.params.id)).eq("org_id", orgId).eq("branch_id", branchId).maybeSingle();
    if (error) throw error;
    if (!appeal) throw httpError(404, "That appeal was not found.");
    if (!HELD.includes(appeal.status)) throw httpError(409, "Already decided.");
    const isOwner = req.user!.role === "Owner";
    if (appeal.status === "awaiting_owner" && !isOwner) throw httpError(403, "This one is waiting for the owner.");

    let next: "kept" | "cancelled" | "awaiting_owner" = "kept";
    if (parsed.data.outcome === "cancel") {
      const { data: owners } = await supabase.from("users").select("name").eq("org_id", orgId).eq("role", "Owner");
      const chargedByOwner = (owners ?? []).some((row: any) => row.name && row.name === appeal.charged_by_name);
      next = cancelOutcome(chargedByOwner, isOwner);
    }
    const now = new Date().toISOString();
    const { data: updated, error: updateError } = await supabase.from("fine_appeals").update({
      status: next, decided_by: req.user!.id, decided_by_name: req.user!.name ?? null, decided_at: now, decision_note: parsed.data.note, updated_at: now
    }).eq("id", appeal.id).in("status", HELD).select("id");
    if (updateError) throw updateError;
    if (!updated || updated.length === 0) throw httpError(409, "This appeal changed while you were deciding. Reload and try again.");

    const fine = { id: String(appeal.penalty_id), label: String(appeal.fine_label), amount: Number(appeal.amount ?? 0), date: String(appeal.charged_at ?? appeal.created_at).slice(0, 10) };
    // The appeal is claimed above (so two people cannot decide it at once); if
    // carrying the decision out fails, it goes back to how it was.
    try {
      if (next === "cancelled") {
        // A "Late send" / "No fee" charge was a decision on an order: it becomes "not charged".
        const { error: decisionError } = await supabase.from("weekly_review_order_decisions")
          .update({ decision: "skipped", amount: null, penalty_id: null, reason: `Fine cancelled on appeal: ${parsed.data.note}`.slice(0, 500) })
          .eq("org_id", orgId).eq("penalty_id", appeal.penalty_id);
        if (decisionError) throw decisionError;
        const { error: deleteError } = await supabase.from("rep_penalties").delete().eq("id", appeal.penalty_id).eq("org_id", orgId);
        if (deleteError) throw deleteError;
      } else if (next === "kept") {
        await reflectInSentReport(orgId, branchId, appeal.rep_id, appeal.week_start, fine, true);
      }
    } catch (sideError) {
      await supabase.from("fine_appeals").update({
        status: appeal.status, decided_by: appeal.decided_by ?? null, decided_by_name: appeal.decided_by_name ?? null,
        decided_at: appeal.decided_at ?? null, decision_note: appeal.decision_note ?? null, updated_at: new Date().toISOString()
      }).eq("id", appeal.id);
      throw sideError;
    }
    await audit(req, branchId, appeal.week_start, appeal.rep_id, "fine_appeal_decided", { appealId: appeal.id, penaltyId: appeal.penalty_id, amount: fine.amount, label: fine.label, outcome: next, note: parsed.data.note });

    if (next === "awaiting_owner") {
      void deliver(orgId, branchId, (await leadershipRecipients(orgId, branchId)).filter((user) => user.role === "Owner"), {
        title: "A fine you charged is asked to be cancelled",
        message: `${naira(fine.amount)}: ${fine.label}. The manager agrees with the rep's appeal; only you can cancel it.`,
        kind: "fine_appeal_owner", tag: `fine-appeal-owner-${appeal.id}`, type: "warning"
      }).catch(() => undefined);
    } else {
      void deliver(orgId, branchId, [{ id: appeal.rep_id, role: "Sales Rep" }], {
        title: next === "cancelled" ? "Your fine was cancelled" : "Your fine stays",
        message: next === "cancelled"
          ? `${naira(fine.amount)} (${fine.label}) will not be taken off your bonus.`
          : `${naira(fine.amount)} (${fine.label}): "${parsed.data.note.slice(0, 140)}"`,
        kind: "fine_appeal_decided", tag: `fine-appeal-decided-${appeal.id}`, type: next === "cancelled" ? "success" : "info"
      }).catch(() => undefined);
    }
    res.json({ ok: true, status: next });
  } catch (error: any) {
    sendError(res, error, "Could not record the decision.");
  }
});

export default router;
