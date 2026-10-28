import { supabase } from "./supabase.js";
import { weekEndFromStart } from "./sales-bonus-engine.js";
import { MISSING_FEE_TYPE, type MissingFeeOrder } from "./missing-fee-penalty.js";
import { LATE_SEND_FINE_TYPE, type LateSendOrder } from "./late-send.js";

// ── A decision on every flagged order of the weekly review (Bright, 28 Oct 2026)
// "No fee" and "Late send" orders are listed against a rep. Leadership must
// either CHARGE each one (an amount they type) or SKIP it (with a reason)
// before the rep's report can be approved. A charge is also an ordinary fine
// (rep_penalties, linked by order_id), so the rep sees it and payroll takes it
// off. A skip stays with leadership. Table: weekly_review_order_decisions
// (migration 311).

export type DecisionKind = "missing_fee" | "late_send";
export const DECISION_KINDS: DecisionKind[] = ["missing_fee", "late_send"];
/** The fine type a "No fee" charge is saved as. Not MISSING_FEE_TYPE: that one is hidden from reps. */
export const NO_FEE_CHARGE_TYPE = "no_delivery_fee";

export type OrderDecision = {
  id: string | null;
  decision: "charged" | "skipped";
  amount: number;
  reason: string;
  byName: string;
  byRole: string | null;
  at: string;
  /** Charged before per-order decisions existed (old automatic charge or a lump late-send fine). Cannot be undone here. */
  earlier?: boolean;
};

type LateSendMap = Record<string, { orders: Array<LateSendOrder & { decision?: OrderDecision | null }>; fines: Array<{ id: string; amount: number; reason: string; byName: string; createdAt: string }> }>;
type MissingFeeMap = Record<string, { orders: Array<MissingFeeOrder & { decision?: OrderDecision | null }> }>;

function mapDecision(row: any): OrderDecision {
  return {
    id: String(row.id), decision: row.decision, amount: Number(row.amount ?? 0), reason: String(row.reason ?? ""),
    byName: String(row.decided_by_name ?? ""), byRole: row.decided_by_role ?? null, at: String(row.created_at)
  };
}

/** Puts each order's decision (or null) on the two lists, in place. */
export async function attachDecisions(orgId: string, missingFees: MissingFeeMap, lateSends: LateSendMap) {
  const feeIds = Object.values(missingFees).flatMap((week) => week.orders.map((order) => order.orderId));
  const lateIds = Object.values(lateSends).flatMap((week) => week.orders.map((order) => order.orderId));
  const allIds = [...new Set([...feeIds, ...lateIds])];
  const decided = new Map<string, OrderDecision>();
  const oldCharges = new Map<string, OrderDecision>();
  for (let i = 0; i < allIds.length; i += 200) {
    const chunk = allIds.slice(i, i + 200);
    const [rows, old] = await Promise.all([
      supabase.from("weekly_review_order_decisions").select("id, kind, order_id, decision, amount, reason, decided_by_name, decided_by_role, created_at")
        .eq("org_id", orgId).in("order_id", chunk),
      // The ₦500 charges the old automatic rule made (week of 11 Oct).
      supabase.from("rep_penalties").select("order_id, amount, by_name, created_at").eq("org_id", orgId).eq("type", MISSING_FEE_TYPE).in("order_id", chunk)
    ]);
    if (rows.error) throw rows.error;
    if (old.error) throw old.error;
    for (const row of rows.data ?? []) decided.set(`${row.kind}:${row.order_id}`, mapDecision(row));
    for (const row of old.data ?? []) oldCharges.set(String(row.order_id), {
      id: null, decision: "charged", amount: Number(row.amount ?? 0), reason: "Charged by the old automatic rule",
      byName: String(row.by_name ?? "System"), byRole: null, at: String(row.created_at), earlier: true
    });
  }
  for (const week of Object.values(missingFees)) {
    for (const order of week.orders) order.decision = decided.get(`missing_fee:${order.orderId}`) ?? oldCharges.get(order.orderId) ?? null;
  }
  for (const week of Object.values(lateSends)) {
    // Lump fines added before per-order decisions name their orders in the reason ("#5443, #5451").
    const lump = new Map<string, OrderDecision>();
    for (const fine of week.fines) {
      for (const match of fine.reason.matchAll(/#([A-Za-z0-9-]+)/g)) {
        lump.set(match[1], { id: null, decision: "charged", amount: fine.amount, reason: "Part of an earlier fine for several orders", byName: fine.byName, byRole: null, at: fine.createdAt, earlier: true });
      }
    }
    for (const order of week.orders) order.decision = decided.get(`late_send:${order.orderId}`) ?? lump.get(order.orderId) ?? null;
  }
}

/** Orders on this rep's week with no decision yet. */
export function undecidedFor(repId: string, missingFees: MissingFeeMap, lateSends: LateSendMap) {
  return [
    ...(missingFees[repId]?.orders ?? []).filter((order) => !order.decision).map((order) => ({ kind: "missing_fee" as const, orderId: order.orderId })),
    ...(lateSends[repId]?.orders ?? []).filter((order) => !order.decision).map((order) => ({ kind: "late_send" as const, orderId: order.orderId }))
  ];
}

const lateText = (minutes: number) => minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes} min`;

/** The line the rep reads on their fine. */
export function chargeReason(kind: DecisionKind, orderId: string, detail: { workingMinutesLate?: number; deliveredDate?: string }, note?: string) {
  const base = kind === "missing_fee"
    ? `Order #${orderId} delivered${detail.deliveredDate ? ` ${detail.deliveredDate}` : ""} with no delivery fee entered`
    : `Order #${orderId} not sent out within 15 minutes${detail.workingMinutesLate ? ` (${lateText(detail.workingMinutesLate)} late, working time)` : ""}`;
  return `${base}${note ? ` - ${note}` : ""}`.slice(0, 1000);
}

export async function saveDecision(args: {
  orgId: string; branchId: string; weekStart: string; repId: string; repName: string;
  kind: DecisionKind; orderId: string; decision: "charged" | "skipped"; amount?: number; reason?: string;
  chargeLine: string;
  user: { id: string; name: string | null; role: string };
}) {
  let penaltyId: string | null = null;
  if (args.decision === "charged") {
    const { data, error } = await supabase.from("rep_penalties").insert({
      org_id: args.orgId, branch_id: args.branchId, rep_id: args.repId, rep_name: args.repName,
      type: args.kind === "missing_fee" ? NO_FEE_CHARGE_TYPE : LATE_SEND_FINE_TYPE,
      amount: args.amount, remove_all_bonuses: false, order_id: args.orderId,
      period: weekEndFromStart(args.weekStart).slice(0, 7), week_start: args.weekStart,
      reason: args.chargeLine, by_name: args.user.name ?? args.user.role
    }).select("id").single();
    if (error) throw error;
    penaltyId = String(data.id);
  }
  const { error } = await supabase.from("weekly_review_order_decisions").insert({
    org_id: args.orgId, branch_id: args.branchId, week_start: args.weekStart, rep_id: args.repId,
    kind: args.kind, order_id: args.orderId, decision: args.decision,
    amount: args.decision === "charged" ? args.amount : null,
    reason: args.reason?.trim() || null, penalty_id: penaltyId,
    decided_by: args.user.id, decided_by_name: args.user.name ?? null, decided_by_role: args.user.role
  });
  if (error) {
    // Do not leave a fine with no decision behind it.
    if (penaltyId) await supabase.from("rep_penalties").delete().eq("id", penaltyId);
    throw error;
  }
}

/** Undo: the decision goes, and its fine with it. */
export async function removeDecision(orgId: string, id: string) {
  const { data, error } = await supabase.from("weekly_review_order_decisions").select("id, penalty_id, week_start, branch_id, rep_id")
    .eq("org_id", orgId).eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  if (data.penalty_id) {
    const { error: fineError } = await supabase.from("rep_penalties").delete().eq("org_id", orgId).eq("id", data.penalty_id);
    if (fineError) throw fineError;
  }
  const { error: deleteError } = await supabase.from("weekly_review_order_decisions").delete().eq("org_id", orgId).eq("id", id);
  if (deleteError) throw deleteError;
  return { weekStart: String(data.week_start), branchId: String(data.branch_id), repId: String(data.rep_id) };
}
