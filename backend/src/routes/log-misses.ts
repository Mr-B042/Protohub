import { Router, type Request } from "express";
import { z } from "zod";
import { humanFieldErrors } from "../lib/validation-message.js";
import { supabase } from "../lib/supabase.js";
import { requireAuth, requireRole, scopeOf } from "../middleware/auth.js";
import { addDaysToDateKey, lagosDateKey, sundayWeekStartForDateKey, weekEndFromStart } from "../lib/sales-bonus-engine.js";
import { FOLLOW_UP_KPI_START_DATE, isWorkingDay } from "../lib/follow-up-kpi.js";
import { CART_LOG_PENALTY_START_DATE } from "../lib/cart-log-penalty.js";
import { checkCartDay, checkFollowUpMiss, dayLabel, type CheckResult } from "../lib/log-miss-check.js";
import { computeCartLogBoard } from "./carts.js";
import { notifyLogMiss } from "../lib/weekly-report-notifications.js";

// Missed-log charges on the weekly report, and disputes (Bright, 1 Oct 2026).
//
// Both charges already exist and keep their rules ("Owner approves first,
// never auto-deduct" - Bright confirmed again 1 Oct 2026):
//   follow-up: N50 per order per working day   (follow_up_misses, nightly)
//   cart log:  N500 per cart per working day    (derived live; cart_log_misses
//                                                holds the Owner's decision)
// The weekly report shows them in the week they HAPPENED. Only approved ones
// are deducted; pending ones show as "waiting for owner approval".
//
// Dispute: the rep asks the system to check -> it shows what they logged that
// day -> wrong charges go to the manager automatically; confirmed ones can be
// escalated with a reason. Manager cancels or keeps. An already-approved
// charge can only be cancelled by the Owner.
const router = Router();
router.use(requireAuth);

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
const httpError = (status: number, message: string) => Object.assign(new Error(message), { status });
const sendError = (res: any, error: any, fallback: string) => res.status(error?.status ?? 500).json({ error: error?.message ?? fallback });
const lagosStart = (dateKey: string) => new Date(`${dateKey}T00:00:00+01:00`).toISOString();
const lagosEnd = (dateKey: string) => new Date(`${dateKey}T23:59:59.999+01:00`).toISOString();
const lagosHM = (iso: string) => {
  const date = new Date(new Date(iso).getTime() + 60 * 60 * 1000);
  return { hour: date.getUTCHours(), minute: date.getUTCMinutes() };
};
const timeText = (iso: string) => {
  const { hour, minute } = lagosHM(iso);
  return `${hour % 12 === 0 ? 12 : hour % 12}:${String(minute).padStart(2, "0")} ${hour < 12 ? "AM" : "PM"}`;
};

export type LogMissRow = {
  kind: "follow_up" | "cart_log";
  ref: string;
  repId: string;
  missDate: string;
  amount: number;
  status: "pending" | "approved" | "waived";
  label: string;
  orderId?: string | null;
  cartsMissed?: number;
};

/**
 * Every missed-log charge for the week, by the day it happened. Cart days run
 * up to yesterday at most: today is still being worked.
 */
export async function logMissesForWeek(orgId: string, repIds: string[] | null, weekStart: string): Promise<LogMissRow[]> {
  const weekEnd = weekEndFromStart(weekStart);
  const rows: LogMissRow[] = [];

  let followQuery = supabase.from("follow_up_misses")
    .select("id, rep_id, order_id, miss_date, slot, amount, state")
    .eq("org_id", orgId).gte("miss_date", weekStart).lte("miss_date", weekEnd)
    .order("miss_date", { ascending: true }).limit(5000);
  if (repIds) followQuery = followQuery.in("rep_id", repIds);
  const { data: follow, error } = await followQuery;
  if (error) throw error;
  for (const row of follow ?? []) {
    if (!row.rep_id) continue;
    rows.push({
      kind: "follow_up", ref: row.id, repId: row.rep_id, missDate: row.miss_date, amount: Number(row.amount ?? 0),
      status: (row.state === "approved" || row.state === "waived" ? row.state : "pending") as LogMissRow["status"],
      orderId: row.order_id,
      label: `Missed follow-up log${row.slot && row.slot !== "day" ? ` (${row.slot === "morning" ? "morning" : "later"} try)` : ""}: order #${row.order_id}, ${dayLabel(row.miss_date)}`
    });
  }

  const yesterday = addDaysToDateKey(lagosDateKey(), -1);
  const from = weekStart > CART_LOG_PENALTY_START_DATE ? weekStart : CART_LOG_PENALTY_START_DATE;
  const to = weekEnd < yesterday ? weekEnd : yesterday;
  if (to >= from) {
    const repList = repIds ?? [null];
    for (const repId of repList) {
      const board = await computeCartLogBoard(orgId, repId, from, to);
      for (const miss of board.misses as any[]) {
        if (repIds && !repIds.includes(miss.repId)) continue;
        if (!(Number(miss.amount) > 0) && miss.status !== "waived") continue;
        rows.push({
          kind: "cart_log", ref: `${miss.repId}|${miss.missDate}`, repId: miss.repId, missDate: miss.missDate,
          amount: Number(miss.amount ?? 0), status: miss.status, cartsMissed: miss.cartsMissed,
          label: `Missed cart logs: ${miss.cartsMissed} cart${miss.cartsMissed === 1 ? "" : "s"}, ${dayLabel(miss.missDate)}`
        });
      }
    }
  }
  return rows.sort((a, b) => a.missDate.localeCompare(b.missDate) || a.kind.localeCompare(b.kind));
}

// ── Facts + check ────────────────────────────────────────────────────────────

async function checkMiss(orgId: string, kind: "follow_up" | "cart_log", ref: string, requesterRepId: string | null) {
  if (kind === "follow_up") {
    const { data: miss, error } = await supabase.from("follow_up_misses").select("*").eq("id", ref).eq("org_id", orgId).maybeSingle();
    if (error) throw error;
    if (!miss) throw httpError(404, "That missed log was not found.");
    if (requesterRepId && miss.rep_id !== requesterRepId) throw httpError(403, "That charge is not yours.");
    const [{ data: attempts, error: aError }, { data: order }, { data: dayAttempts }] = await Promise.all([
      supabase.from("order_contact_attempts").select("attempted_at, channels, channel, outcome_note")
        .eq("org_id", orgId).eq("order_id", miss.order_id)
        .gte("attempted_at", lagosStart(miss.miss_date)).lte("attempted_at", lagosEnd(miss.miss_date))
        .order("attempted_at", { ascending: true }),
      supabase.from("orders").select("assigned_rep_id").eq("id", miss.order_id).eq("org_id", orgId).maybeSingle(),
      supabase.from("order_contact_attempts").select("order_id").eq("org_id", orgId).eq("rep_id", miss.rep_id)
        .gte("attempted_at", lagosStart(miss.miss_date)).lte("attempted_at", lagosEnd(miss.miss_date)).limit(5000)
    ]);
    if (aError) throw aError;
    const others = new Set((dayAttempts ?? []).map((row: any) => row.order_id).filter((id: string) => id !== miss.order_id));
    const result = checkFollowUpMiss({
      orderId: miss.order_id, missDate: miss.miss_date, slot: miss.slot ?? "day",
      workingDay: isWorkingDay(miss.miss_date), startDate: FOLLOW_UP_KPI_START_DATE,
      assignedToRepNow: order?.assigned_rep_id === miss.rep_id,
      attemptsThatDay: (attempts ?? []).map((row: any) => {
        const { hour, minute } = lagosHM(row.attempted_at);
        const channels = Array.isArray(row.channels) && row.channels.length ? row.channels : row.channel ? [row.channel] : [];
        return { lagosHour: hour, lagosMinute: minute, channels, note: row.outcome_note ?? null };
      }),
      otherOrdersLoggedThatDay: others.size
    });
    return { result, repId: miss.rep_id as string, missDate: miss.miss_date as string, amount: Number(miss.amount ?? 0), orderId: miss.order_id as string, status: miss.state as string, penaltyId: miss.penalty_id as string | null };
  }

  const [repId, missDate] = ref.split("|");
  if (!repId || !DATE_KEY.test(missDate ?? "")) throw httpError(400, "That cart day was not found.");
  if (requesterRepId && repId !== requesterRepId) throw httpError(403, "That charge is not yours.");
  const board = await computeCartLogBoard(orgId, repId, missDate, missDate);
  const miss = (board.misses as any[]).find((row) => row.repId === repId && row.missDate === missDate);
  const { data: decision } = await supabase.from("cart_log_misses").select("amount, status")
    .eq("org_id", orgId).eq("rep_id", repId).eq("miss_date", missDate).maybeSingle();
  const { data: attempts } = await supabase.from("cart_contact_attempts").select("cart_id, attempted_at")
    .eq("org_id", orgId).eq("rep_id", repId)
    .gte("attempted_at", lagosStart(missDate)).lte("attempted_at", lagosEnd(missDate)).order("attempted_at", { ascending: true });
  const cartIds = Array.from(new Set((attempts ?? []).map((row: any) => row.cart_id).filter(Boolean)));
  const { data: carts } = cartIds.length
    ? await supabase.from("abandoned_carts").select("id, customer").in("id", cartIds)
    : { data: [] as any[] };
  const nameOf = new Map((carts ?? []).map((row: any) => [row.id, String(row.customer ?? "Customer")]));
  const firstTime = new Map<string, string>();
  for (const row of attempts ?? []) if (!firstTime.has(row.cart_id)) firstTime.set(row.cart_id, timeText(row.attempted_at));
  // The board only carries cart ids; look up who each missed cart was for.
  const missedIds = (miss?.affectedCarts ?? []).map((cart: any) => cart.id).filter(Boolean);
  const { data: missedRows } = missedIds.length
    ? await supabase.from("abandoned_carts").select("id, customer, product_name, package_name").in("id", missedIds)
    : { data: [] as any[] };
  const missedInfo = new Map((missedRows ?? []).map((row: any) => [row.id, { customer: String(row.customer ?? "Customer"), product: String(row.product_name ?? row.package_name ?? "Cart") }]));
  const charged = Number(decision?.amount ?? miss?.amount ?? 0);
  const result = checkCartDay({
    missDate,
    amountCharged: charged,
    cartsDueNow: Number(miss?.cartsDue ?? 0),
    cartsMissedNow: Number(miss?.cartsMissed ?? 0),
    amountNow: Number(miss?.amount ?? 0),
    loggedCarts: cartIds.map((id) => ({ customer: nameOf.get(id) ?? "Customer", time: firstTime.get(id) ?? "" })),
    missedCarts: (miss?.affectedCarts ?? []).map((cart: any) => missedInfo.get(cart.id) ?? { customer: cart.customer, product: cart.productName })
  });
  return { result, repId, missDate, amount: charged, orderId: null, status: (decision?.status ?? miss?.status ?? "pending") as string, penaltyId: null };
}

async function audit(req: Request, branchId: string, missDate: string, action: string, detail: Record<string, unknown>) {
  await supabase.from("weekly_report_audit").insert({
    org_id: req.user!.orgId, branch_id: branchId, week_start: sundayWeekStartForDateKey(missDate),
    rep_id: (detail.repId as string) ?? null,
    actor_id: req.user!.id, actor_name: req.user!.name ?? null, actor_role: req.user!.role, action, detail
  });
}

const RefSchema = z.object({ kind: z.enum(["follow_up", "cart_log"]), ref: z.string().min(3).max(120) });

async function openDispute(req: Request, kind: "follow_up" | "cart_log", ref: string, facts: Awaited<ReturnType<typeof checkMiss>>, reason: string | null) {
  const branchId = req.user!.branchId;
  if (!branchId) throw httpError(400, "Open a branch first.");
  const { data, error } = await supabase.from("log_miss_disputes").insert({
    org_id: req.user!.orgId, branch_id: branchId, rep_id: facts.repId, kind, miss_ref: ref,
    miss_date: facts.missDate, amount: facts.amount, order_id: facts.orderId,
    check_verdict: facts.result.verdict, check_result: { ...facts.result, checkedAt: new Date().toISOString() },
    rep_reason: reason
  }).select("id").single();
  if (error) {
    if ((error as any).code === "23505") throw httpError(409, "This charge is already with the manager.");
    throw error;
  }
  await audit(req, branchId, facts.missDate, "log_miss_disputed", {
    repId: facts.repId, disputeId: data.id, kind, ref, amount: facts.amount, verdict: facts.result.verdict, reason
  });
  void notifyLogMiss(req.user!.orgId, branchId, {
    kind: "dispute_opened", repName: req.user!.name ?? "A rep", amount: facts.amount, missDate: facts.missDate,
    systemSupportsRep: facts.result.verdict === "miss_wrong"
  });
  return data.id as string;
}

// ── Rep: check, then (maybe) escalate ───────────────────────────────────────

router.post("/check", requireRole("Sales Rep", "Owner", "Admin", "Manager"), async (req, res) => {
  const parsed = RefSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: humanFieldErrors(parsed.error) }); return; }
  try {
    const scope = scopeOf(req);
    const repOnly = scope.role === "Sales Rep" ? scope.id : null;
    const facts = await checkMiss(req.user!.orgId, parsed.data.kind, parsed.data.ref, repOnly);
    let disputeId: string | null = null;
    // A charge the system itself finds wrong goes to the manager straight away
    // - but only when the rep asked (not a manager just looking), and only once.
    if (facts.result.verdict === "miss_wrong" && req.user!.role === "Sales Rep" && facts.status !== "waived") {
      try { disputeId = await openDispute(req, parsed.data.kind, parsed.data.ref, facts, null); }
      catch (error: any) { if (error?.status !== 409) throw error; }
    } else if (req.user!.branchId) {
      await audit(req, req.user!.branchId, facts.missDate, "log_miss_checked", { repId: facts.repId, kind: parsed.data.kind, ref: parsed.data.ref, verdict: facts.result.verdict });
    }
    res.json({ ...facts.result, status: facts.status, amount: facts.amount, disputeId });
  } catch (error: any) {
    sendError(res, error, "Could not check this charge.");
  }
});

router.post("/escalate", requireRole("Sales Rep"), async (req, res) => {
  const parsed = RefSchema.extend({ reason: z.string().trim().min(5, "Say why you think it is wrong.").max(1000) }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: humanFieldErrors(parsed.error) }); return; }
  try {
    const facts = await checkMiss(req.user!.orgId, parsed.data.kind, parsed.data.ref, req.user!.id);
    if (facts.status === "waived") throw httpError(409, "This charge was already cancelled.");
    const id = await openDispute(req, parsed.data.kind, parsed.data.ref, facts, parsed.data.reason);
    res.status(201).json({ id });
  } catch (error: any) {
    sendError(res, error, "Could not send this to your manager.");
  }
});

// ── Leadership: list + decide ───────────────────────────────────────────────

const DISPUTE_COLUMNS = "id, rep_id, kind, miss_ref, miss_date, amount, order_id, check_verdict, check_result, rep_reason, status, decided_by_name, decided_at, decision_note, created_at";
export const mapDispute = (row: any) => ({
  id: row.id, repId: row.rep_id, kind: row.kind, ref: row.miss_ref, missDate: row.miss_date, amount: Number(row.amount ?? 0),
  orderId: row.order_id ?? null, checkVerdict: row.check_verdict, checkResult: row.check_result ?? {}, repReason: row.rep_reason ?? null,
  status: row.status, decidedByName: row.decided_by_name ?? null, decidedAt: row.decided_at ?? null, decisionNote: row.decision_note ?? null,
  createdAt: row.created_at
});

export async function disputesForWeek(orgId: string, branchId: string, repIds: string[] | null, weekStart: string) {
  let query = supabase.from("log_miss_disputes").select(DISPUTE_COLUMNS)
    .eq("org_id", orgId).eq("branch_id", branchId)
    .or(`status.in.(open,awaiting_owner),and(miss_date.gte.${weekStart},miss_date.lte.${weekEndFromStart(weekStart)})`)
    .order("created_at", { ascending: false }).limit(500);
  if (repIds) query = query.in("rep_id", repIds);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map(mapDispute);
}

router.post("/disputes/:id/decide", requireRole("Manager", "Admin", "Owner"), async (req, res) => {
  const parsed = z.object({ outcome: z.enum(["cancel", "keep"]), note: z.string().trim().min(3, "Tell the rep what you found.").max(1000) }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: humanFieldErrors(parsed.error) }); return; }
  try {
    const orgId = req.user!.orgId;
    const branchId = req.user!.branchId;
    if (!branchId) throw httpError(400, "Open a branch first.");
    const { data: dispute, error } = await supabase.from("log_miss_disputes").select("*")
      .eq("id", String(req.params.id)).eq("org_id", orgId).eq("branch_id", branchId).maybeSingle();
    if (error) throw error;
    if (!dispute) throw httpError(404, "Not found.");
    if (dispute.status !== "open" && dispute.status !== "awaiting_owner") throw httpError(409, "Already decided.");
    if (dispute.status === "awaiting_owner" && req.user!.role !== "Owner") throw httpError(403, "This one is waiting for the Owner.");
    const isOwner = req.user!.role === "Owner";
    const now = new Date().toISOString();
    let nextStatus: "cancelled" | "kept" | "awaiting_owner" = parsed.data.outcome === "keep" ? "kept" : "cancelled";

    if (parsed.data.outcome === "cancel") {
      if (dispute.kind === "follow_up") {
        const { data: miss } = await supabase.from("follow_up_misses").select("id, state, penalty_id").eq("id", dispute.miss_ref).eq("org_id", orgId).maybeSingle();
        if (miss?.state === "approved" && !isOwner) {
          nextStatus = "awaiting_owner";
        } else if (miss && miss.state !== "waived") {
          if (miss.penalty_id) {
            const { error: delError } = await supabase.from("rep_penalties").delete().eq("id", miss.penalty_id).eq("org_id", orgId);
            if (delError) throw delError;
          }
          const { error: waiveError } = await supabase.from("follow_up_misses")
            .update({ state: "waived", penalty_id: null, reviewed_by: req.user!.name, reviewed_at: now }).eq("id", miss.id);
          if (waiveError) throw waiveError;
        }
      } else {
        const [repId, missDate] = String(dispute.miss_ref).split("|");
        const { data: decision } = await supabase.from("cart_log_misses").select("status").eq("org_id", orgId).eq("rep_id", repId).eq("miss_date", missDate).maybeSingle();
        if (decision?.status === "approved" && !isOwner) {
          nextStatus = "awaiting_owner";
        } else if (decision?.status !== "waived") {
          const { data: rep } = await supabase.from("users").select("name").eq("id", repId).maybeSingle();
          const { error: waiveError } = await supabase.from("cart_log_misses").upsert({
            org_id: orgId, branch_id: branchId, rep_id: repId, rep_name: rep?.name ?? "", miss_date: missDate,
            amount: Number(dispute.amount ?? 0), carts_due: 0, status: "waived",
            reviewed_by: req.user!.id, reviewed_by_name: req.user!.name ?? null, reviewed_at: now,
            review_note: `Dispute: ${parsed.data.note}`.slice(0, 250)
          }, { onConflict: "org_id,rep_id,miss_date" });
          if (waiveError) throw waiveError;
        }
      }
    }

    const { data: updated, error: updateError } = await supabase.from("log_miss_disputes").update({
      status: nextStatus, decided_by: req.user!.id, decided_by_name: req.user!.name ?? null, decided_at: now,
      decision_note: parsed.data.note, updated_at: now
    }).eq("id", dispute.id).in("status", ["open", "awaiting_owner"]).select("id");
    if (updateError) throw updateError;
    if (!updated || updated.length === 0) throw httpError(409, "This dispute changed while you were deciding. Reload and try again.");
    await audit(req, branchId, dispute.miss_date, "log_miss_decided", {
      repId: dispute.rep_id, disputeId: dispute.id, kind: dispute.kind, amount: Number(dispute.amount), outcome: nextStatus, note: parsed.data.note
    });
    void notifyLogMiss(orgId, branchId, nextStatus === "awaiting_owner"
      ? { kind: "needs_owner", amount: Number(dispute.amount), missDate: dispute.miss_date }
      : { kind: "dispute_decided", repId: dispute.rep_id, cancelled: nextStatus === "cancelled", amount: Number(dispute.amount), missDate: dispute.miss_date });
    res.json({ ok: true, status: nextStatus });
  } catch (error: any) {
    sendError(res, error, "Could not record the decision.");
  }
});

export default router;
