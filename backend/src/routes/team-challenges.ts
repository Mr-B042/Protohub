import { Router, type Request } from "express";
import { z } from "zod";
import { selectByIdBatches } from "../lib/query-limits.js";
import { supabase } from "../lib/supabase.js";
import { humanFieldErrors } from "../lib/validation-message.js";
import { requireAuth, requireRole, scopeOf } from "../middleware/auth.js";
import {
  DEFAULT_MILESTONES, DEFAULT_SCORING, contributionOf, maxBudget, normaliseMilestones, normaliseScoring, pointsFor, raceResults, splitEqually, teamEntitlements,
  type Milestone, type Scoring, needsManager } from "../lib/team-challenge.js";
import { perOrderExpansionBonusBreakdownMapForDeliveredRange } from "../lib/sales-bonus-engine.js";
import { notifyTeamChallenge } from "../lib/team-challenge-notifications.js";

// Team Challenges (Bright, 3 Oct 2026). Two teams race to point milestones
// made of verified upsells and cross-sells. The ledger (team_challenge_entries)
// is built from real orders on every read - one row per order, its score from
// the challenge's scoring table - and only a Manager/Admin/Owner verification
// lets points count. The Owner approves the (personally funded) prize budget
// before reps see the challenge, approves every payout, and must approve any
// change to the rules once it is running.

const router = Router();
router.use(requireAuth, requireRole("Owner", "Admin", "Manager", "Sales Rep"));

const LEADERS = ["Owner", "Admin", "Manager"];
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
const httpError = (status: number, message: string) => Object.assign(new Error(message), { status });
const fail = (res: any, error: any, fallback: string) => {
  const status = Number(error?.status) || 500;
  res.status(status).json({ error: status >= 500 ? `${fallback}${error?.message ? ` (${error.message})` : ""}` : error.message });
};
const branchOf = (req: Request) => {
  const branchId = req.user!.branchId;
  if (!branchId) throw httpError(400, "Open a branch first.");
  return branchId;
};
const isLeader = (req: Request) => LEADERS.includes(scopeOf(req).role);
const actor = (req: Request) => ({ id: req.user!.id, name: req.user!.name ?? req.user!.role });
// Lagos has no daylight saving: +01:00 all year.
const lagosStart = (day: string) => `${day}T00:00:00+01:00`;
const lagosEnd = (day: string) => `${day}T23:59:59.999+01:00`;
const addDays = (day: string, days: number) => new Date(Date.parse(`${day}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const lagosToday = () => new Date(Date.now() + 3_600_000).toISOString().slice(0, 10);

async function log(challenge: any, req: Request | null, action: string, detail: Record<string, unknown> = {}) {
  await supabase.from("team_challenge_log").insert({
    org_id: challenge.org_id, branch_id: challenge.branch_id, challenge_id: challenge.id,
    actor_id: req ? req.user!.id : null, actor_name: req ? (req.user!.name ?? req.user!.role) : "Protohub", action, detail
  });
}

async function loadChallenge(req: Request, id: string) {
  const { data, error } = await supabase.from("team_challenges").select("*")
    .eq("id", id).eq("org_id", req.user!.orgId).eq("branch_id", branchOf(req)).maybeSingle();
  if (error) throw error;
  if (!data) throw httpError(404, "That challenge was not found.");
  const { data: teams, error: teamsError } = await supabase.from("team_challenge_teams").select("*").eq("challenge_id", id).order("sort_order");
  if (teamsError) throw teamsError;
  return { challenge: data as any, teams: (teams ?? []) as any[] };
}

/** Where the challenge is in its life: selling, delivery period, closed. */
function phaseOf(challenge: any) {
  if (challenge.status === "draft") return "draft";
  if (challenge.status === "closed") return "closed";
  if (challenge.status === "paused") return "paused";
  const today = lagosToday();
  if (today < challenge.sell_from) return "scheduled";
  if (today <= challenge.sell_to) return "selling";
  if (today <= addDays(challenge.sell_to, challenge.grace_days)) return "grace";
  return "finalising";
}

const ORDER_FIELDS = "id, status, phone, product_id, product_name, package_name, amount, currency, original_amount, original_quantity, upsell_from_qty, upsell_to_qty, quantity, cross_sell_lines, free_gift_lines, customer, assigned_rep_id, created_at, delivered_date, remittance_status, review_hold";

/**
 * Unit cost of a product on a given day: the Product Master price, rolled
 * back through product_cost_changes so a later cost edit never restates an
 * old sale (see project memory "COGS freeze").
 */
async function costBook(orgId: string, productIds: string[]) {
  const ids = Array.from(new Set(productIds.filter(Boolean)));
  if (ids.length === 0) return () => 0;
  const [{ data: pricings }, { data: changes }] = await Promise.all([
    supabase.from("product_pricings").select("product_id, currency, unit_cost, is_primary").in("product_id", ids),
    supabase.from("product_cost_changes").select("product_id, currency, previous_unit_cost, created_at").eq("org_id", orgId).in("product_id", ids).order("created_at")
  ]);
  const current = new Map<string, number>();
  for (const row of pricings ?? []) {
    if (row.is_primary || !current.has(row.product_id)) current.set(row.product_id, Number(row.unit_cost) || 0);
  }
  return (productId: string | null | undefined, asOf: string) => {
    if (!productId) return 0;
    const later = (changes ?? []).find((row: any) => row.product_id === productId && Date.parse(row.created_at) > Date.parse(asOf));
    return later ? Number(later.previous_unit_cost) || 0 : current.get(productId) ?? 0;
  };
}

/** The rep's upsell / cross-sell bonus per delivered order (bonus engine), cached briefly per challenge. */
const bonusCache = new Map<string, { at: number; map: Record<string, number> }>();
async function repBonusByOrder(challenge: any) {
  const cached = bonusCache.get(challenge.id);
  if (cached && Date.now() - cached.at < 3 * 60_000) return cached.map;
  const to = [lagosToday(), addDays(challenge.sell_to, challenge.grace_days)].sort()[0];
  const breakdown = await perOrderExpansionBonusBreakdownMapForDeliveredRange(challenge.org_id, challenge.sell_from, to).catch(() => ({} as Record<string, Array<{ amount: number }>>));
  const map = Object.fromEntries(Object.entries(breakdown).map(([orderId, items]) => [orderId, items.reduce((sum, item) => sum + (Number(item.amount) || 0), 0)]));
  bonusCache.set(challenge.id, { at: Date.now(), map });
  return map;
}

/**
 * Bring the ledger up to date with the orders. Each order's ADDED
 * CONTRIBUTION decides its points (0 / 1 / 2): an estimate until it is
 * delivered and paid, then the final figure from the amount collected.
 * Automatic stages follow the order; a manager's decision is kept - except a
 * verified order that is later cancelled is REVERSED, and a verified order
 * whose points change (partial delivery, edited amount) goes back for
 * verification.
 */
async function syncEntries(challenge: any, teams: any[]) {
  if (challenge.status === "draft") return;
  const teamOf = new Map<string, string>();
  for (const team of teams) for (const id of team.member_ids ?? []) teamOf.set(String(id), team.id);
  const members = Array.from(teamOf.keys());
  if (members.length === 0) return;
  const scoring = normaliseScoring(challenge.scoring);
  const closeAt = lagosEnd(addDays(challenge.sell_to, challenge.grace_days));

  const { data: orders, error } = await supabase.from("orders").select(ORDER_FIELDS)
    .eq("org_id", challenge.org_id).eq("branch_id", challenge.branch_id).in("assigned_rep_id", members)
    .gte("created_at", lagosStart(challenge.sell_from)).lte("created_at", lagosEnd(challenge.sell_to)).limit(5000);
  if (error) throw error;
  const relevant = ((orders ?? []) as any[]).filter((order) => {
    const lines = Array.isArray(order.cross_sell_lines) ? order.cross_sell_lines : [];
    return (Number(order.upsell_to_qty) || 0) > (Number(order.upsell_from_qty) || 0) || lines.length > 0;
  });
  const ids = relevant.map((row: any) => String(row.id));
  const productIds = relevant.flatMap((order: any) => [order.product_id,
    ...(Array.isArray(order.cross_sell_lines) ? order.cross_sell_lines : []).map((line: any) => line?.productId),
    ...(Array.isArray(order.free_gift_lines) ? order.free_gift_lines : []).map((line: any) => line?.productId)]);
  const [{ data: existingRows }, delivered, paid, cost, bonuses] = await Promise.all([
    supabase.from("team_challenge_entries").select("*").eq("challenge_id", challenge.id),
    // Batched: one long id list is refused ("URI too long") and would leave paid orders stuck (see selectByIdBatches).
    selectByIdBatches<any>(ids, (batch) => supabase.from("order_audit").select("order_id, created_at, from_status, to_status").eq("org_id", challenge.org_id).in("order_id", batch)).then((data) => ({ data })),
    selectByIdBatches<any>(ids, (batch) => supabase.from("remittance_transactions").select("order_id, received_at, delta_amount").eq("org_id", challenge.org_id).in("order_id", batch)).then((data) => ({ data })),
    costBook(challenge.org_id, productIds),
    relevant.some((order: any) => order.status === "Delivered") ? repBonusByOrder(challenge) : Promise.resolve({} as Record<string, number>)
  ]);
  const existing = new Map((existingRows ?? []).map((row: any) => [String(row.order_id), row]));
  const deliveredAt = new Map<string, string>();
  for (const row of ((delivered as any).data ?? []).filter((item: any) => item.to_status === "Delivered")) {
    const key = String(row.order_id);
    if (!deliveredAt.has(key) || Date.parse(row.created_at) > Date.parse(deliveredAt.get(key)!)) deliveredAt.set(key, row.created_at);
  }
  // An edit made while the order was already Delivered (status unchanged, after the delivery time).
  const editedAfterDelivery = new Set<string>();
  for (const row of (delivered as any).data ?? []) {
    const key = String(row.order_id);
    const at = deliveredAt.get(key);
    if (at && row.from_status === row.to_status && Date.parse(row.created_at) > Date.parse(at)) editedAfterDelivery.add(key);
  }
  const autoVerified: Array<{ orderId: string; repId: string; points: number; contribution: number }> = [];
  const paidAt = new Map<string, string>();
  for (const row of (paid as any).data ?? []) {
    if (Number(row.delta_amount) <= 0) continue;
    const key = String(row.order_id);
    if (!paidAt.has(key) || Date.parse(row.received_at) > Date.parse(paidAt.get(key)!)) paidAt.set(key, row.received_at);
  }

  const writes: any[] = [];
  const reversals: Array<{ orderId: string; reason: string }> = [];

  // Pass 1: each order on its own - contribution, delivery and payment.
  type Info = { order: any; orderId: string; prior: any; status: string; delivered: string | null; paidTime: string | null; cancelled: boolean; result: ReturnType<typeof contributionOf> };
  const infos: Info[] = [];
  for (const order of relevant) {
    if (scoring.productIds.length > 0 && !scoring.productIds.includes(order.product_id)) continue;
    const orderId = String(order.id);
    const prior: any = existing.get(orderId) ?? null;
    const status = String(order.status ?? "");
    const delivered = status === "Delivered" ? (deliveredAt.get(orderId) ?? (order.delivered_date ? `${order.delivered_date}T12:00:00+01:00` : null)) : null;
    const paidTime = order.remittance_status === "Paid" ? (paidAt.get(orderId) ?? delivered) : null;
    const result = contributionOf({
      productId: order.product_id, amount: Number(order.amount) || 0,
      originalAmount: order.original_amount === null ? null : Number(order.original_amount), originalQuantity: order.original_quantity,
      upsellFromQty: order.upsell_from_qty, upsellToQty: order.upsell_to_qty, quantity: order.quantity,
      crossSellLines: Array.isArray(order.cross_sell_lines) ? order.cross_sell_lines : [],
      giftLines: Array.isArray(order.free_gift_lines) ? order.free_gift_lines : [],
      unitCost: (productId) => cost(productId, order.created_at),
      repBonus: delivered ? Number((bonuses as Record<string, number>)[orderId] ?? 0) : 0,
      extraLogistics: 0,
      adjustment: Number(prior?.adjustment_amount ?? 0),
      packagingPerUnit: scoring.packagingPerUnit
    });
    infos.push({ order, orderId, prior, status, delivered, paidTime, cancelled: ["Failed", "Cancelled", "Returned"].includes(status), result });
  }

  // Pass 2: ONE TRANSACTION PER CUSTOMER VISIT (Bright, 5 Oct 2026). Orders
  // for the same phone placed within the link window are assessed together -
  // scored once, on the first order, from their combined contribution - so a
  // sale can't be split into several orders to multiply points.
  const windowMs = scoring.linkWindowHours * 3_600_000;
  const phoneKey = (order: any) => String(order.phone ?? "").replace(/\D/g, "").slice(-10);
  const groups: Info[][] = [];
  const byPhone = new Map<string, Info[]>();
  for (const info of infos) {
    const key = phoneKey(info.order);
    if (!key || windowMs <= 0) { groups.push([info]); continue; }
    byPhone.set(key, [...(byPhone.get(key) ?? []), info]);
  }
  for (const list of byPhone.values()) {
    list.sort((a, b) => Date.parse(a.order.created_at) - Date.parse(b.order.created_at));
    let current: Info[] = [];
    for (const info of list) {
      if (current.length && Date.parse(info.order.created_at) - Date.parse(current[0].order.created_at) > windowMs) { groups.push(current); current = []; }
      current.push(info);
    }
    if (current.length) groups.push(current);
  }

  const latest = (values: Array<string | null>) => values.reduce<string | null>((max, value) => (value && (!max || Date.parse(value) > Date.parse(max)) ? value : max), null);
  for (const group of groups) {
    const live = group.filter((info) => info.result && !info.cancelled);
    const primary = live[0] ?? group[0];
    const linked = group.filter((info) => info !== primary);
    // Linked orders: no score of their own.
    for (const info of linked) {
      const prior = info.prior;
      const reason = `Same customer as #${primary.orderId} within ${scoring.linkWindowHours} hours: one transaction, scored on #${primary.orderId}.`;
      if (prior?.status === "linked" && prior.linked_to_order_id === primary.orderId) continue;
      if (prior?.status === "verified") reversals.push({ orderId: info.orderId, reason: `linked into #${primary.orderId}` });
      writes.push({
        ...(prior ? { id: prior.id } : {}),
        org_id: challenge.org_id, branch_id: challenge.branch_id, challenge_id: challenge.id, order_id: info.orderId,
        rep_id: prior?.rep_id ?? String(info.order.assigned_rep_id), team_id: prior?.team_id ?? teamOf.get(String(info.order.assigned_rep_id)) ?? null,
        category: info.result ? (info.result.hasUpsell && info.result.hasCrossSell ? "both" : info.result.hasUpsell ? "upsell" : "cross_sell") : (prior?.category ?? "cross_sell"),
        points: 0, rule_version: challenge.rule_version, rule_label: reason,
        contribution: info.result?.contribution ?? 0, added_value: info.result?.revenue ?? 0, contribution_final: Boolean(info.delivered && info.paidTime),
        delivered_at: info.delivered, paid_at: info.paidTime, qualified_at: null,
        status: "linked", status_reason: reason, linked_to_order_id: primary.orderId, updated_at: new Date().toISOString()
      });
    }

    const order = primary.order;
    const orderId = primary.orderId;
    const prior: any = primary.prior;
    // Combined contribution of every live order in the transaction.
    const parts = live.map((info) => info.result!);
    const result = parts.length === 0 ? primary.result : parts.length === 1 ? parts[0] : {
      ...parts[0],
      hasUpsell: parts.some((part) => part.hasUpsell), hasCrossSell: parts.some((part) => part.hasCrossSell),
      crossSellCount: parts.reduce((sum, part) => sum + part.crossSellCount, 0),
      revenue: parts.reduce((sum, part) => sum + part.revenue, 0), productCost: parts.reduce((sum, part) => sum + part.productCost, 0),
      logistics: parts.reduce((sum, part) => sum + part.logistics, 0), repBonus: parts.reduce((sum, part) => sum + part.repBonus, 0),
      packaging: parts.reduce((sum, part) => sum + part.packaging, 0), gifts: parts.reduce((sum, part) => sum + part.gifts, 0),
      adjustment: parts.reduce((sum, part) => sum + part.adjustment, 0), contribution: parts.reduce((sum, part) => sum + part.contribution, 0)
    };
    const allDelivered = live.length > 0 && live.every((info) => info.delivered);
    const allPaid = live.length > 0 && live.every((info) => info.paidTime);
    const delivered = live.length > 1 ? (allDelivered ? latest(live.map((info) => info.delivered)) : null) : primary.delivered;
    const paidTime = live.length > 1 ? (allPaid ? latest(live.map((info) => info.paidTime)) : null) : primary.paidTime;
    const final = Boolean(delivered && paidTime);
    const status = primary.status;
    const owner = result && !result.hasUpsell && result.crossSellOwner && teamOf.has(result.crossSellOwner) ? result.crossSellOwner : String(order.assigned_rep_id);
    const teamId = prior?.team_id ?? teamOf.get(owner) ?? null;

    if (!result || !teamId) {
      if (prior && prior.status === "verified") {
        writes.push({ ...prior, status: "reversed", status_reason: "The order no longer has an upgrade or a paid add-on.", updated_at: new Date().toISOString() });
        reversals.push({ orderId, reason: "no longer qualifies" });
      } else if (prior && !["excluded", "reversed"].includes(prior.status)) {
        writes.push({ ...prior, status: "excluded", status_reason: "The order no longer has an upgrade or a paid add-on.", updated_at: new Date().toISOString() });
      }
      continue;
    }
    const points = pointsFor(result.contribution, scoring);
    const qualifiedAt = final ? (Date.parse(paidTime!) > Date.parse(delivered!) ? paidTime : delivered) : null;
    const linkedNote = linked.length ? ` Includes linked order${linked.length === 1 ? "" : "s"} ${linked.map((info) => `#${info.orderId}`).join(", ")} (same customer).` : "";

    let auto: string;
    let reason: string | null = null;
    if (primary.cancelled) { auto = prior?.status === "verified" ? "reversed" : "excluded"; reason = `Order ${status.toLowerCase()}: no contribution, no points.`; }
    else if (order.review_hold) { auto = "excluded"; reason = "Held for review as a possible duplicate order."; }
    else if (!delivered) { auto = "awaiting_delivery"; }
    else if (!paidTime) { auto = "awaiting_payment"; }
    else if (Date.parse(qualifiedAt!) > Date.parse(closeAt)) { auto = "excluded"; reason = "Delivered and paid after the delivery period closed."; }
    else auto = "awaiting_verification";

    let next = auto;
    let nextReason = reason;
    if (prior) {
      const manual = Boolean(prior.decided_by) && ["verified", "excluded", "correction_requested"].includes(prior.status);
      if (auto === "awaiting_verification") {
        if (prior.status === "verified") {
          const approved = Number(prior.verified_points ?? prior.points);
          if (points !== approved) { next = "awaiting_verification"; nextReason = `Points changed from ${approved} to ${points} after verification (final contribution ${Math.round(result.contribution).toLocaleString("en-NG")}) - check again.`; }
          else { next = "verified"; nextReason = prior.status_reason; }
        } else if (manual) { next = prior.status; nextReason = prior.status_reason; }
      } else if ((auto === "awaiting_delivery" || auto === "awaiting_payment") && manual && prior.status !== "verified") {
        next = prior.status; nextReason = prior.status_reason;
      }
      if (next === "reversed" && prior.status !== "reversed") reversals.push({ orderId, reason: reason ?? "" });
    }
    // Delivered + paid + nothing unusual = verified by itself; otherwise say why a manager is needed.
    let autoDecision = false;
    if (next === "awaiting_verification" && scoring.autoVerifyClean && !(prior && Boolean(prior.decided_by))) {
      const why = needsManager({
        linkedOrders: linked.length, adjustment: Number(prior?.adjustment_amount ?? 0), editedAfterDelivery: live.some((info) => editedAfterDelivery.has(info.orderId)),
        hasNoteOrEscalation: Boolean(prior?.escalated_at || prior?.review_requested_at || prior?.rep_note),
        pointsChangedAfterVerification: Boolean(prior && prior.verified_points !== null && prior.verified_points !== undefined && Number(prior.verified_points) !== points)
      });
      if (why.length === 0) { next = "verified"; nextReason = "Verified automatically: delivered, paid, nothing unusual."; autoDecision = true; }
      else if (!nextReason) nextReason = `Needs a manager: ${why.join("; ")}.`;
    }
    const breakdown = {
      revenue: result.revenue, productCost: result.productCost, logistics: result.logistics, repBonus: result.repBonus,
      packaging: result.packaging, gifts: result.gifts, adjustment: result.adjustment,
      upgrade: result.upgrade, crossSells: result.crossSellCount, linkedOrders: linked.map((info) => info.orderId)
    };
    const row = {
      ...(prior ? { id: prior.id } : {}),
      org_id: challenge.org_id, branch_id: challenge.branch_id, challenge_id: challenge.id, order_id: orderId,
      rep_id: prior?.rep_id ?? owner, team_id: teamId,
      category: result.hasUpsell && result.hasCrossSell ? "both" : result.hasUpsell ? "upsell" : "cross_sell",
      points, rule_version: prior?.status === "verified" ? prior.rule_version : challenge.rule_version,
      rule_label: `${final ? "Final" : "Estimated"} contribution ₦${Math.round(result.contribution).toLocaleString("en-NG")} → ${points} point${points === 1 ? "" : "s"}.${linkedNote}`,
      original_snapshot: prior?.original_snapshot ?? {
        quantity: order.upsell_from_qty ?? order.original_quantity ?? order.quantity,
        amount: order.original_amount === null ? null : Number(order.original_amount), product: order.product_name, lockedAt: new Date().toISOString()
      },
      revised_snapshot: {
        quantity: order.upsell_to_qty ?? order.quantity, amount: Number(order.amount) || 0, package: order.package_name, product: order.product_name,
        crossSells: (Array.isArray(order.cross_sell_lines) ? order.cross_sell_lines : []).filter((line: any) => Number(line?.amount) > 0)
          .map((line: any) => ({ product: line.productName ?? line.name ?? "Add-on", quantity: line.quantity ?? 1, amount: Number(line.amount) || 0 })),
        gifts: (Array.isArray(order.free_gift_lines) ? order.free_gift_lines : []).map((line: any) => ({ product: line.productName ?? "Gift", quantity: line.quantity ?? 1 })),
        linkedOrders: linked.map((info) => ({ orderId: info.orderId, amount: Number(info.order.amount) || 0, product: info.order.product_name, status: info.status }))
      },
      added_value: result.revenue, contribution: result.contribution, contribution_breakdown: breakdown, contribution_final: final,
      delivered_at: delivered, paid_at: paidTime, qualified_at: qualifiedAt,
      status: next, status_reason: nextReason, linked_to_order_id: null,
      decided_by: autoDecision ? null : prior?.decided_by ?? null,
      decided_by_name: autoDecision ? "Protohub (automatic)" : prior?.decided_by_name ?? null,
      decided_at: autoDecision ? new Date().toISOString() : prior?.decided_at ?? null,
      verified_points: autoDecision ? points : prior?.verified_points ?? null, rep_note: prior?.rep_note ?? null, review_requested_at: prior?.review_requested_at ?? null,
      adjustment_amount: prior?.adjustment_amount ?? 0, adjustment_reason: prior?.adjustment_reason ?? null, adjustment_by_name: prior?.adjustment_by_name ?? null, adjusted_at: prior?.adjusted_at ?? null,
      escalated_at: prior?.escalated_at ?? null, escalation_note: prior?.escalation_note ?? null,
      updated_at: new Date().toISOString()
    };
    const changed = !prior || ["points", "category", "status", "status_reason", "delivered_at", "paid_at", "qualified_at", "added_value", "team_id", "contribution", "contribution_final", "rule_label"]
      .some((key) => String((prior as any)[key] ?? "") !== String((row as any)[key] ?? ""));
    if (changed) writes.push(row);
    if (autoDecision && prior?.status !== "verified") autoVerified.push({ orderId, repId: String(row.rep_id), points, contribution: result.contribution });
  }
  // Every row in a batch must carry the same columns: a bulk upsert fills a
  // column one row lacks with NULL, which breaks the NOT NULL ones.
  const COLUMNS: Record<string, unknown> = {
    org_id: null, branch_id: null, challenge_id: null, order_id: null, rep_id: null, team_id: null, category: "cross_sell", points: 0,
    rule_version: 1, rule_label: null, original_snapshot: null, revised_snapshot: null, added_value: 0, contribution: null,
    contribution_breakdown: null, contribution_final: false, delivered_at: null, paid_at: null, qualified_at: null, status: "awaiting_delivery",
    status_reason: null, linked_to_order_id: null, decided_by: null, decided_by_name: null, decided_at: null, verified_points: null, rep_note: null,
    review_requested_at: null, adjustment_amount: 0, adjustment_reason: null, adjustment_by_name: null, adjusted_at: null, escalated_at: null,
    escalation_note: null, updated_at: new Date().toISOString()
  };
  const normalised = writes.map((row) => Object.fromEntries(Object.entries(COLUMNS).map(([key, fallback]) => [key, row[key] ?? fallback])));
  for (let i = 0; i < normalised.length; i += 200) {
    const { error: writeError } = await supabase.from("team_challenge_entries").upsert(normalised.slice(i, i + 200), { onConflict: "challenge_id,order_id" });
    if (writeError) throw writeError;
  }
  for (const reversal of reversals) await log(challenge, null, "score_reversed", reversal);
  // Same record and alert as a manager's verification, marked automatic.
  for (const item of autoVerified) {
    await log(challenge, null, "entry_auto_verified", { orderId: item.orderId, points: item.points });
    void notifyTeamChallenge(ctxOf(challenge), { kind: "entry_decided", repId: item.repId, orderId: item.orderId, status: "verified" as any, points: item.points, contribution: item.contribution, note: "Verified automatically: delivered, paid, nothing unusual." });
  }
}

const STAGE_COUNTS = ["awaiting_delivery", "awaiting_payment", "awaiting_verification", "correction_requested"];

/** Who is looking: a request's user, or the scheduler (sees everything, as the Owner). */
type Viewer = { leader: boolean; id: string; owner: boolean };
const viewerOf = (req: Request): Viewer => ({ leader: isLeader(req), id: scopeOf(req).id, owner: scopeOf(req).role === "Owner" });
const SYSTEM_VIEWER: Viewer = { leader: true, id: "", owner: true };

async function buildDetail(req: Request | Viewer, challenge: any, teams: any[]) {
  await syncEntries(challenge, teams);
  const viewer = "leader" in req ? req : viewerOf(req);
  const leader = viewer.leader;
  const me = viewer.id;
  const milestones = normaliseMilestones(challenge.milestones);
  const scoring = normaliseScoring(challenge.scoring);
  const memberIds = Array.from(new Set(teams.flatMap((team) => team.member_ids ?? [])));
  const [{ data: entries }, { data: users }, { data: payouts }, logRes] = await Promise.all([
    supabase.from("team_challenge_entries").select("*").eq("challenge_id", challenge.id),
    memberIds.length ? supabase.from("users").select("id, name").in("id", memberIds) : Promise.resolve({ data: [] as any[] }),
    supabase.from("team_challenge_payouts").select("*").eq("challenge_id", challenge.id),
    leader ? supabase.from("team_challenge_log").select("*").eq("challenge_id", challenge.id).order("created_at", { ascending: false }).limit(300) : Promise.resolve({ data: [] as any[] })
  ]);
  const nameOf = new Map((users ?? []).map((row: any) => [row.id, row.name ?? "Rep"]));
  const all = (entries ?? []) as any[];
  const counted = (row: any) => row.status === "verified";
  const pointsOf = (row: any) => Number(row.verified_points ?? row.points) || 0;
  const closeAt = lagosEnd(addDays(challenge.sell_to, challenge.grace_days));
  const results = raceResults(teams.map((team) => ({ id: team.id, memberIds: (team.member_ids ?? []).map(String) })), all.filter((row) => row.qualified_at).map((row) => ({
    teamId: row.team_id, repId: row.rep_id, points: counted(row) ? pointsOf(row) : 0, qualifiedAt: row.qualified_at, status: row.status
  })), milestones, closeAt);

  // Lead allocation (Bright, 5 Oct 2026): how many orders each rep was given
  // in the selling period and on which products, so a points gap can be read
  // against opportunity. Context only - never part of the race score.
  const { data: assignedRows } = memberIds.length ? await supabase.from("orders").select("assigned_rep_id, product_name, review_hold")
    .eq("org_id", challenge.org_id).eq("branch_id", challenge.branch_id).in("assigned_rep_id", memberIds)
    .gte("created_at", lagosStart(challenge.sell_from)).lte("created_at", lagosEnd(challenge.sell_to)).limit(10000) : { data: [] as any[] };
  const assigned = ((assignedRows ?? []) as any[]).filter((row) => row.review_hold !== true);
  const assignedTotal = assigned.length;

  const teamRows = teams.map((team) => {
    const rows = all.filter((row) => row.team_id === team.id);
    const teamAssigned = assigned.filter((row) => (team.member_ids ?? []).includes(row.assigned_rep_id));
    const mix = new Map<string, number>();
    for (const row of teamAssigned) mix.set(row.product_name ?? "Other", (mix.get(row.product_name ?? "Other") ?? 0) + 1);
    const verified = rows.filter(counted);
    const points = verified.reduce((sum, row) => sum + pointsOf(row), 0);
    const entitlements = teamEntitlements(team.id, results).map((item) => {
      const payout: any = (payouts ?? []).find((row: any) => row.team_id === team.id && row.milestone_key === item.key) ?? null;
      return { ...item, payout: payout ? { id: payout.id, amount: Number(payout.amount), perRep: payout.per_rep, approvedAt: payout.approved_at, approvedBy: payout.approved_by_name, paidAt: payout.paid_at, reference: payout.paid_reference } : null };
    });
    const entitled = entitlements.reduce((sum, item) => sum + item.step, 0);
    // Paid more than the ledger now entitles (a later return or reversal):
    // the payment stays on record and the Owner reviews it - nothing is
    // deducted automatically.
    const paidSoFar = entitlements.reduce((sum, item) => sum + (item.payout?.paidAt ? item.payout.amount : 0), 0);
    const reconciliation = paidSoFar > entitled + 0.5 ? { paid: paidSoFar, entitled, over: Math.round((paidSoFar - entitled) * 100) / 100 } : null;
    const approved = entitlements.reduce((sum, item) => sum + (item.payout?.amount ?? 0), 0);
    const paidTotal = entitlements.reduce((sum, item) => sum + (item.payout?.paidAt ? item.payout.amount : 0), 0);
    const next = milestones.find((milestone) => points < milestone.target) ?? null;
    return {
      id: team.id, name: team.name, color: team.color,
      members: (team.member_ids ?? []).map((id: string) => {
        const mine = verified.filter((row) => row.rep_id === id);
        return {
          id, name: nameOf.get(id) ?? "Rep",
          points: mine.reduce((sum, row) => sum + pointsOf(row), 0), orders: mine.length,
          upsells: mine.filter((row) => row.category !== "cross_sell").length, crossSells: mine.filter((row) => row.category !== "upsell").length,
          onePoint: mine.filter((row) => pointsOf(row) === 1).length, twoPoint: mine.filter((row) => pointsOf(row) >= 2).length,
          contribution: mine.reduce((sum, row) => sum + Number(row.contribution || 0), 0),
          assigned: teamAssigned.filter((row) => row.assigned_rep_id === id).length,
          pending: rows.filter((row) => row.rep_id === id && STAGE_COUNTS.includes(row.status)).length
        };
      }),
      points, orders: verified.length,
      onePoint: verified.filter((row) => pointsOf(row) === 1).length,
      twoPoint: verified.filter((row) => pointsOf(row) >= 2).length,
      zeroPoint: rows.filter((row) => Number(row.points) === 0 && !["excluded", "reversed", "linked"].includes(row.status)).length,
      linked: rows.filter((row) => row.status === "linked").length,
      contribution: verified.reduce((sum, row) => sum + Number(row.contribution || 0), 0),
      reconciliation,
      opportunity: {
        assigned: teamAssigned.length,
        share: assignedTotal > 0 ? Math.round((teamAssigned.length / assignedTotal) * 1000) / 10 : 0,
        conversion: teamAssigned.length > 0 ? Math.round((rows.filter((row) => row.status === "verified").length / teamAssigned.length) * 1000) / 10 : 0,
        pointsPer100: teamAssigned.length > 0 ? Math.round((rows.filter((row) => row.status === "verified").reduce((sum, row) => sum + (Number(row.verified_points ?? row.points) || 0), 0) / teamAssigned.length) * 1000) / 10 : 0,
        products: Array.from(mix.entries()).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([name, count]) => ({ name, count }))
      },
      memberPending: results.map((result) => {
        const pending = result.memberPending.find((item) => item.teamId === team.id);
        return pending ? { key: result.key, target: result.target, short: pending.short.map((item) => ({ ...item, name: nameOf.get(item.repId) ?? "Rep" })) } : null;
      }).filter(Boolean),
      upsells: verified.filter((row) => row.category !== "cross_sell").length,
      crossSells: verified.filter((row) => row.category !== "upsell").length,
      addedValue: verified.reduce((sum, row) => sum + Number(row.added_value || 0), 0),
      awaitingDelivery: rows.filter((row) => row.status === "awaiting_delivery").length,
      awaitingPayment: rows.filter((row) => row.status === "awaiting_payment").length,
      awaitingVerification: rows.filter((row) => row.status === "awaiting_verification" || row.status === "correction_requested").length,
      nextMilestone: next ? { key: next.key, target: next.target, away: next.target - points } : null,
      entitlements, entitled, approved, paid: paidTotal, outstanding: Math.max(0, entitled - paidTotal)
    };
  });
  const leaderTeam = [...teamRows].sort((a, b) => b.points - a.points)[0];
  const second = [...teamRows].sort((a, b) => b.points - a.points)[1];

  const summaryAll = closureSummary(challenge, teamRows, results, all, nameOf as Map<string, string>, milestones);
  // Reps see the totals, never other reps' orders.
  const summary = leader ? summaryAll : { ...summaryAll, exceptions: summaryAll.exceptions.filter((row) => all.some((entry) => entry.order_id === row.orderId && entry.rep_id === me)) };

  // Reps see only their own orders (never the rival team's customers).
  const myTeam = teams.find((team) => (team.member_ids ?? []).includes(me)) ?? null;
  const visible = leader ? all : all.filter((row) => row.rep_id === me);
  const orderIds = visible.map((row) => row.order_id);
  const { data: orderRows } = orderIds.length ? await supabase.from("orders").select("id, customer, product_name, package_name, status").in("id", orderIds) : { data: [] as any[] };
  const orderOf = new Map((orderRows ?? []).map((row: any) => [String(row.id), row]));

  return {
    challenge: {
      id: challenge.id, name: challenge.name, status: challenge.status, phase: phaseOf(challenge),
      sellFrom: challenge.sell_from, sellTo: challenge.sell_to, graceDays: challenge.grace_days, graceUntil: addDays(challenge.sell_to, challenge.grace_days),
      milestones, scoring, ruleVersion: challenge.rule_version, sponsorNote: challenge.sponsor_note,
      approvedBy: challenge.approved_by_name, approvedAt: challenge.approved_at, maxBudget: maxBudget(milestones), createdAt: challenge.created_at,
      baseline: challenge.baseline ?? null
    },
    teams: teamRows,
    race: {
      leaderTeamId: leaderTeam && second && leaderTeam.points > second.points ? leaderTeam.id : null,
      gap: leaderTeam && second ? leaderTeam.points - second.points : 0,
      results: results.map((result) => ({ key: result.key, target: result.target, winnerAmount: result.winnerAmount, runnerUpAmount: result.runnerUpAmount, reached: result.reached, winnerTeamIds: result.winnerTeamIds, runnerUpTeamIds: result.runnerUpTeamIds, tie: result.tie, provisional: result.provisional }))
    },
    kpis: {
      verifiedPoints: teamRows.reduce((sum, team) => sum + team.points, 0),
      verifiedOrders: teamRows.reduce((sum, team) => sum + team.orders, 0),
      awaitingDelivery: all.filter((row) => row.status === "awaiting_delivery" || row.status === "awaiting_payment").length,
      awaitingVerification: all.filter((row) => row.status === "awaiting_verification" || row.status === "correction_requested").length,
      addedRevenue: teamRows.reduce((sum, team) => sum + team.addedValue, 0),
      addedContribution: teamRows.reduce((sum, team) => sum + team.contribution, 0),
      escalated: all.filter((row) => row.escalated_at).length,
      prizeBudget: maxBudget(milestones)
    },
    entries: visible.sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at)).map((row) => {
      const order: any = orderOf.get(String(row.order_id));
      return {
        id: row.id, orderId: row.order_id, repId: row.rep_id, repName: nameOf.get(row.rep_id) ?? "Rep", teamId: row.team_id,
        customer: order?.customer ?? null, product: order?.product_name ?? null, packageName: order?.package_name ?? null, orderStatus: order?.status ?? null,
        category: row.category, points: row.points, verifiedPoints: row.verified_points, ruleLabel: row.rule_label, ruleVersion: row.rule_version,
        original: row.original_snapshot, revised: row.revised_snapshot, addedValue: Number(row.added_value || 0),
        deliveredAt: row.delivered_at, paidAt: row.paid_at, qualifiedAt: row.qualified_at,
        status: row.status, reason: row.status_reason, decidedBy: row.decided_by_name, decidedAt: row.decided_at,
        repNote: row.rep_note, reviewRequestedAt: row.review_requested_at, updatedAt: row.updated_at,
        contribution: row.contribution === null ? null : Number(row.contribution), breakdown: row.contribution_breakdown, final: Boolean(row.contribution_final),
        adjustment: Number(row.adjustment_amount || 0), adjustmentReason: row.adjustment_reason, adjustmentBy: row.adjustment_by_name, adjustedAt: row.adjusted_at,
        escalatedAt: row.escalated_at, escalationNote: row.escalation_note, linkedTo: row.linked_to_order_id ?? null
      };
    }),
    log: (logRes.data ?? []).map((row: any) => ({ id: row.id, actor: row.actor_name, action: row.action, detail: row.detail, at: row.created_at })),
    me: { id: me, teamId: myTeam?.id ?? null, leader, owner: viewer.owner },
    summary
  };
}

/**
 * The challenge in one page (Bright's closure summary): points, transactions,
 * contribution, winners with times, exclusions and reversals, prizes earned,
 * paid and outstanding, and the result against the pre-challenge baseline.
 */
function closureSummary(challenge: any, teamRows: any[], results: any[], all: any[], nameOf: Map<string, string>, milestones: Milestone[]) {
  const teamName = new Map(teamRows.map((team) => [team.id, team.name]));
  const days = Math.max(1, Math.round((Date.parse(`${challenge.sell_to}T12:00:00Z`) - Date.parse(`${challenge.sell_from}T12:00:00Z`)) / 86_400_000) + 1);
  const totalPoints = teamRows.reduce((sum, team) => sum + team.points, 0);
  const baselineMonthly = Number(challenge.baseline?.averagePoints ?? 0) || null;
  const challengeMonthly = Math.round((totalPoints / days) * 30 * 10) / 10;
  return {
    sellingDays: days,
    teams: teamRows.map((team) => ({
      id: team.id, name: team.name, points: team.points, transactions: team.orders, onePoint: team.onePoint, twoPoint: team.twoPoint,
      contribution: team.contribution, revenue: team.addedValue, assigned: team.opportunity.assigned, conversion: team.opportunity.conversion,
      entitled: team.entitled, paid: team.paid, outstanding: team.outstanding,
      members: team.members.map((member: any) => ({ id: member.id, name: member.name, points: member.points, transactions: member.orders, contribution: member.contribution }))
    })),
    milestones: results.map((result) => ({
      target: result.target,
      winners: result.winnerTeamIds.map((id: string) => ({ team: teamName.get(id) ?? "Team", at: result.reached.find((row: any) => row.teamId === id)?.at ?? null })),
      others: result.runnerUpTeamIds.map((id: string) => ({ team: teamName.get(id) ?? "Team", at: result.reached.find((row: any) => row.teamId === id)?.at ?? null })),
      provisional: result.provisional, tie: result.tie
    })),
    excluded: all.filter((row) => row.status === "excluded").length,
    reversed: all.filter((row) => row.status === "reversed").length,
    linked: all.filter((row) => row.status === "linked").length,
    exceptions: all.filter((row) => row.status === "excluded" || row.status === "reversed").slice(0, 30).map((row) => ({ orderId: row.order_id, rep: nameOf.get(row.rep_id) ?? "Rep", status: row.status, reason: row.status_reason })),
    entitled: teamRows.reduce((sum, team) => sum + team.entitled, 0),
    paid: teamRows.reduce((sum, team) => sum + team.paid, 0),
    outstanding: teamRows.reduce((sum, team) => sum + team.outstanding, 0),
    maxBudget: maxBudget(milestones),
    baselineMonthly, challengeMonthly,
    uplift: baselineMonthly ? Math.round(((challengeMonthly - baselineMonthly) / baselineMonthly) * 1000) / 10 : null
  };
}

// ── Alerts ───────────────────────────────────────────────────────────────────

const ctxOf = (challenge: any) => ({ orgId: challenge.org_id, branchId: challenge.branch_id, challengeId: challenge.id, name: challenge.name });
const allMembers = (teams: any[]) => teams.flatMap((team) => (team.member_ids ?? []).map(String));

/**
 * Announce what changed since last time - lead changes, milestones
 * (provisional, then confirmed), linked orders, deadline reminders - each
 * once (team_challenges.notify_state). Runs every 15 minutes and after a
 * verification or payout.
 */
// One check per challenge at a time (the 15-minute job and the check after a
// decision can overlap): each re-reads notify_state inside the lock, so an
// alert is never announced twice.
const watchLocks = new Map<string, Promise<void>>();
export function watchChallenge(challenge: any, teams: any[]): Promise<void> {
  const previous = watchLocks.get(challenge.id) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(async () => {
    const { data: fresh } = await supabase.from("team_challenges").select("*").eq("id", challenge.id).maybeSingle();
    if (fresh) await watchChallengeNow(fresh, teams);
  });
  watchLocks.set(challenge.id, next);
  void next.finally(() => { if (watchLocks.get(challenge.id) === next) watchLocks.delete(challenge.id); }).catch(() => undefined);
  return next;
}

async function watchChallengeNow(challenge: any, teams: any[]) {
  if (!["active", "paused"].includes(challenge.status)) return;
  const detail = await buildDetail(SYSTEM_VIEWER, challenge, teams);
  const state: Record<string, any> = { ...(challenge.notify_state ?? {}) };
  const before = JSON.stringify(state);
  const ctx = ctxOf(challenge);
  const members = allMembers(teams);
  const teamById = new Map(detail.teams.map((team) => [team.id, team]));

  const leaderId = detail.race.leaderTeamId;
  if (leaderId && state.leader !== leaderId) {
    const leaderTeam = teamById.get(leaderId)!;
    const other = detail.teams.find((team) => team.id !== leaderId);
    if (state.leader !== undefined || leaderTeam.points > 0) {
      await notifyTeamChallenge(ctx, { kind: "lead_changed", repIds: members, leader: leaderTeam.name, leaderPoints: leaderTeam.points, other: other?.name ?? "the other team", otherPoints: other?.points ?? 0 });
    }
    state.leader = leaderId;
  }
  state.milestones = { ...(state.milestones ?? {}) };
  for (const result of detail.race.results) {
    for (const reached of result.reached) {
      const key = `${result.key}:${reached.teamId}`;
      const now = result.provisional ? "provisional" : "confirmed";
      if (state.milestones[key] === now || state.milestones[key] === "confirmed") continue;
      const team = teamById.get(reached.teamId);
      const entitlement = team?.entitlements.find((item: any) => item.key === result.key);
      await notifyTeamChallenge(ctx, { kind: "milestone", repIds: members, team: team?.name ?? "A team", target: result.target, confirmed: now === "confirmed", first: result.winnerTeamIds.includes(reached.teamId), amount: entitlement?.entitlement ?? 0 });
      state.milestones[key] = now;
    }
  }
  const announced = new Set<string>(state.linked ?? []);
  for (const entry of detail.entries.filter((row) => row.status === "linked" && row.linkedTo && !announced.has(row.orderId))) {
    await notifyTeamChallenge(ctx, { kind: "entry_linked", repId: entry.repId, orderId: entry.orderId, primaryOrderId: entry.linkedTo! });
    announced.add(entry.orderId);
  }
  state.linked = Array.from(announced).slice(-500);
  const today = lagosToday();
  const daysTo = (day: string) => Math.round((Date.parse(`${day}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000);
  const sellLeft = daysTo(challenge.sell_to);
  if (sellLeft >= 0 && sellLeft <= 2 && !state.sellingReminder) {
    await notifyTeamChallenge(ctx, { kind: "deadline", repIds: members, which: "selling", date: challenge.sell_to, daysLeft: Math.max(1, sellLeft), pendingVerification: 0 });
    state.sellingReminder = today;
  }
  const graceUntil = addDays(challenge.sell_to, challenge.grace_days);
  const graceLeft = daysTo(graceUntil);
  if (sellLeft < 0 && graceLeft >= 0 && graceLeft <= 2 && !state.deliveryReminder) {
    await notifyTeamChallenge(ctx, { kind: "deadline", repIds: members, which: "delivery", date: graceUntil, daysLeft: Math.max(1, graceLeft), pendingVerification: detail.kpis.awaitingVerification });
    state.deliveryReminder = today;
  }
  if (JSON.stringify(state) !== before) await supabase.from("team_challenges").update({ notify_state: state }).eq("id", challenge.id);
}

/** Every running challenge, every 15 minutes (index.ts cron). */
export async function runTeamChallengeWatch() {
  const { data: challenges, error } = await supabase.from("team_challenges").select("*").in("status", ["active", "paused"]);
  if (error) throw error;
  for (const challenge of challenges ?? []) {
    try {
      const { data: teams } = await supabase.from("team_challenge_teams").select("*").eq("challenge_id", challenge.id).order("sort_order");
      await watchChallenge(challenge, teams ?? []);
    } catch (watchError: any) {
      console.warn("[team-challenges] watch failed:", challenge.id, watchError?.message ?? watchError);
    }
  }
}
const watchSoon = (challenge: any, teams: any[]) => {
  // After a decision: announce what changed (alerts never fail the action).
  void watchChallenge(challenge, teams).catch(() => undefined);
};

// ── Read ─────────────────────────────────────────────────────────────────────

router.get("/", async (req, res) => {
  try {
    const branchId = branchOf(req);
    const { data, error } = await supabase.from("team_challenges").select("id, name, status, sell_from, sell_to, grace_days, milestones, created_at")
      .eq("org_id", req.user!.orgId).eq("branch_id", branchId).order("sell_from", { ascending: false });
    if (error) throw error;
    let rows = (data ?? []) as any[];
    if (!isLeader(req)) {
      const me = scopeOf(req).id;
      const { data: teams } = await supabase.from("team_challenge_teams").select("challenge_id, member_ids").eq("branch_id", branchId);
      const mine = new Set((teams ?? []).filter((team: any) => (team.member_ids ?? []).includes(me)).map((team: any) => team.challenge_id));
      rows = rows.filter((row) => row.status !== "draft" && mine.has(row.id));
    }
    res.json({ challenges: rows.map((row) => ({ id: row.id, name: row.name, status: row.status, phase: phaseOf(row), sellFrom: row.sell_from, sellTo: row.sell_to, maxBudget: maxBudget(normaliseMilestones(row.milestones)) })) });
  } catch (error: any) { fail(res, error, "Couldn't load the team challenges."); }
});

router.get("/:id", async (req, res) => {
  try {
    const { challenge, teams } = await loadChallenge(req, String(req.params.id));
    if (!isLeader(req)) {
      const me = scopeOf(req).id;
      if (challenge.status === "draft" || !teams.some((team) => (team.member_ids ?? []).includes(me))) throw httpError(404, "That challenge was not found.");
    }
    res.json(await buildDetail(req, challenge, teams));
  } catch (error: any) { fail(res, error, "Couldn't load the challenge."); }
});

// ── Create / edit ────────────────────────────────────────────────────────────

const MilestoneSchema = z.object({ key: z.string().trim().max(10).optional(), target: z.coerce.number().int().min(1).max(100_000), winnerAmount: z.coerce.number().min(0).max(100_000_000), runnerUpAmount: z.coerce.number().min(0).max(100_000_000), minPerMember: z.coerce.number().int().min(0).max(100_000).default(0) });
const ChallengeSchema = z.object({
  name: z.string().trim().min(3).max(120),
  sellFrom: z.string().regex(DATE_KEY), sellTo: z.string().regex(DATE_KEY),
  graceDays: z.coerce.number().int().min(0).max(30).default(7),
  milestones: z.array(MilestoneSchema).min(1).max(4),
  scoring: z.object({
    onePointFrom: z.coerce.number().min(0).max(100_000_000), twoPointsFrom: z.coerce.number().min(0).max(100_000_000),
    extraPointEvery: z.coerce.number().min(0).max(100_000_000).default(50_000),
    packagingPerUnit: z.coerce.number().min(0).max(1_000_000).default(0), linkWindowHours: z.coerce.number().int().min(0).max(336).default(72), productIds: z.array(z.string().uuid()).max(100).default([]), autoVerifyClean: z.boolean().default(true)
  }),
  sponsorNote: z.string().trim().max(200).optional(),
  teams: z.array(z.object({ id: z.string().uuid().optional(), name: z.string().trim().min(1).max(40), color: z.string().trim().max(20).default("violet"), memberIds: z.array(z.string().uuid()).min(1).max(10) })).min(2).max(4),
  reason: z.string().trim().max(400).optional()
}).superRefine((value, ctx) => {
  if (value.sellTo < value.sellFrom) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "The selling period must end on or after it starts.", path: ["sellTo"] });
  if (value.scoring.twoPointsFrom < value.scoring.onePointFrom) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "The 2-point level must be at least the 1-point level.", path: ["scoring"] });
  const members = value.teams.flatMap((team) => team.memberIds);
  if (new Set(members).size !== members.length) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "A rep can only be on one team.", path: ["teams"] });
});

const milestoneRows = (list: z.infer<typeof MilestoneSchema>[]): Milestone[] =>
  [...list].sort((a, b) => a.target - b.target).map((row, index) => ({ key: `m${index + 1}`, target: row.target, winnerAmount: row.winnerAmount, runnerUpAmount: row.runnerUpAmount, minPerMember: row.minPerMember }));

async function saveTeams(challenge: any, teams: z.infer<typeof ChallengeSchema>["teams"]) {
  const { data: current } = await supabase.from("team_challenge_teams").select("id").eq("challenge_id", challenge.id);
  const keep = new Set(teams.map((team) => team.id).filter(Boolean));
  const remove = (current ?? []).map((row: any) => row.id).filter((id: string) => !keep.has(id));
  if (remove.length) await supabase.from("team_challenge_teams").delete().in("id", remove);
  for (const [index, team] of teams.entries()) {
    const row = { org_id: challenge.org_id, branch_id: challenge.branch_id, challenge_id: challenge.id, name: team.name, color: team.color, member_ids: team.memberIds, sort_order: index };
    const { error } = team.id
      ? await supabase.from("team_challenge_teams").update(row).eq("id", team.id).eq("challenge_id", challenge.id)
      : await supabase.from("team_challenge_teams").insert(row);
    if (error) throw error;
  }
}

router.post("/", requireRole(...LEADERS), async (req, res) => {
  const parsed = ChallengeSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: humanFieldErrors(parsed.error) }); return; }
  try {
    const body = parsed.data;
    const { data, error } = await supabase.from("team_challenges").insert({
      org_id: req.user!.orgId, branch_id: branchOf(req), name: body.name, status: "draft",
      sell_from: body.sellFrom, sell_to: body.sellTo, grace_days: body.graceDays, milestones: milestoneRows(body.milestones),
      scoring: normaliseScoring(body.scoring), sponsor_note: body.sponsorNote || "Sponsored by the Owner · Personal funds", created_by: req.user!.id
    }).select("*").single();
    if (error) throw error;
    await saveTeams(data, body.teams);
    await log(data, req, "draft_created", { name: body.name });
    res.status(201).json({ id: data.id });
  } catch (error: any) { fail(res, error, "Couldn't create the challenge."); }
});

/** A draft changes freely. Once running, only the Owner changes the rules - with a reason, as a new rule version, and team membership is locked. */
router.put("/:id", requireRole(...LEADERS), async (req, res) => {
  const parsed = ChallengeSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: humanFieldErrors(parsed.error) }); return; }
  try {
    const { challenge, teams } = await loadChallenge(req, String(req.params.id));
    const body = parsed.data;
    if (challenge.status === "closed") throw httpError(409, "This challenge is closed.");
    const running = challenge.status !== "draft";
    if (running) {
      if (scopeOf(req).role !== "Owner") throw httpError(403, "Once a challenge is running, only the Owner can change its rules.");
      if (!body.reason || body.reason.length < 5) throw httpError(400, "Give a reason for changing a running challenge (the reps are told).");
      const sameTeams = body.teams.length === teams.length && body.teams.every((team) => {
        const current = teams.find((row) => row.id === team.id);
        return current && [...current.member_ids].sort().join() === [...team.memberIds].sort().join();
      });
      if (!sameTeams) throw httpError(409, "Teams are locked once the challenge starts.");
    }
    const update = {
      name: body.name, sell_from: body.sellFrom, sell_to: body.sellTo, grace_days: body.graceDays,
      milestones: milestoneRows(body.milestones), scoring: normaliseScoring(body.scoring), sponsor_note: body.sponsorNote || challenge.sponsor_note,
      rule_version: running ? Number(challenge.rule_version) + 1 : challenge.rule_version, updated_at: new Date().toISOString()
    };
    const { error } = await supabase.from("team_challenges").update(update).eq("id", challenge.id);
    if (error) throw error;
    if (!running) await saveTeams(challenge, body.teams);
    else await Promise.all(body.teams.map((team) => supabase.from("team_challenge_teams").update({ name: team.name, color: team.color }).eq("id", team.id!).eq("challenge_id", challenge.id)));
    await log(challenge, req, running ? "rules_changed" : "draft_edited", running ? {
      reason: body.reason, ruleVersion: update.rule_version,
      before: { milestones: challenge.milestones, scoring: challenge.scoring, sellFrom: challenge.sell_from, sellTo: challenge.sell_to, graceDays: challenge.grace_days },
      after: { milestones: update.milestones, scoring: update.scoring, sellFrom: update.sell_from, sellTo: update.sell_to, graceDays: update.grace_days }
    } : {});
    if (running) void notifyTeamChallenge(ctxOf(challenge), { kind: "rules_changed", repIds: allMembers(teams), reason: body.reason ?? "", ruleVersion: update.rule_version });
    res.json({ ok: true });
  } catch (error: any) { fail(res, error, "Couldn't save the challenge."); }
});

/**
 * Delete a challenge (Bright, 5 Oct 2026: "no place to delete a challenge we
 * don't want"). A draft: any leader. Running or closed: the Owner only, and
 * never once a prize was approved or paid - that is a payment record; close
 * it instead. Reps on a running challenge are told it was cancelled.
 */
router.delete("/:id", requireRole(...LEADERS), async (req, res) => {
  try {
    const { challenge, teams } = await loadChallenge(req, String(req.params.id));
    if (challenge.status !== "draft" && scopeOf(req).role !== "Owner") throw httpError(403, "Only the Owner can delete a challenge that has started.");
    const { count, error: payoutError } = await supabase.from("team_challenge_payouts").select("id", { count: "exact", head: true }).eq("challenge_id", challenge.id);
    if (payoutError) throw payoutError;
    if ((count ?? 0) > 0) throw httpError(409, "A prize was already approved or paid on this challenge, so it can't be deleted. Close it instead.");
    const { error } = await supabase.from("team_challenges").delete().eq("id", challenge.id);
    if (error) throw error;
    if (challenge.status === "active" || challenge.status === "paused") {
      void notifyTeamChallenge(ctxOf(challenge), { kind: "cancelled", repIds: allMembers(teams) });
    }
    res.json({ ok: true });
  } catch (error: any) { fail(res, error, "Couldn't delete the challenge."); }
});

/** The Owner approves the personally funded budget; the challenge then goes live to the reps. */
router.post("/:id/publish", requireRole("Owner"), async (req, res) => {
  try {
    const { challenge, teams } = await loadChallenge(req, String(req.params.id));
    if (challenge.status !== "draft") throw httpError(409, "Already published.");
    if (teams.length < 2 || teams.some((team) => (team.member_ids ?? []).length === 0)) throw httpError(400, "Set up at least two teams with members first.");
    const budget = maxBudget(normaliseMilestones(challenge.milestones));
    const { error } = await supabase.from("team_challenges").update({
      status: "active", approved_by: req.user!.id, approved_by_name: req.user!.name ?? "Owner", approved_at: new Date().toISOString(), updated_at: new Date().toISOString()
    }).eq("id", challenge.id);
    if (error) throw error;
    await log(challenge, req, "published", { maxBudget: budget });
    const { data: users } = await supabase.from("users").select("id, name").in("id", allMembers(teams));
    const nameOf = new Map((users ?? []).map((row: any) => [row.id, row.name ?? "Rep"]));
    const milestones = normaliseMilestones(challenge.milestones);
    void notifyTeamChallenge(ctxOf(challenge), {
      kind: "published", firstTarget: milestones[0]?.target ?? 0, firstPrize: milestones[0]?.winnerAmount ?? 0, sellFrom: challenge.sell_from, sellTo: challenge.sell_to,
      teams: teams.map((team) => ({ name: team.name, memberIds: (team.member_ids ?? []).map(String), memberNames: (team.member_ids ?? []).map((id: string) => nameOf.get(id) ?? "Rep") }))
    });
    res.json({ ok: true });
  } catch (error: any) { fail(res, error, "Couldn't publish the challenge."); }
});

router.post("/:id/status", requireRole(...LEADERS), async (req, res) => {
  const parsed = z.object({ status: z.enum(["paused", "active", "closed"]), reason: z.string().trim().max(400).optional() }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: humanFieldErrors(parsed.error) }); return; }
  try {
    const { challenge } = await loadChallenge(req, String(req.params.id));
    if (challenge.status === "draft") throw httpError(409, "Publish the challenge first.");
    if (challenge.status === "closed") throw httpError(409, "This challenge is closed.");
    if (parsed.data.status === "closed" && scopeOf(req).role !== "Owner") throw httpError(403, "Only the Owner closes a challenge.");
    const { error } = await supabase.from("team_challenges").update({ status: parsed.data.status, updated_at: new Date().toISOString() }).eq("id", challenge.id);
    if (error) throw error;
    await log(challenge, req, `status_${parsed.data.status}`, { reason: parsed.data.reason ?? null });
    if (parsed.data.status === "closed") {
      const { data: teamRows } = await supabase.from("team_challenge_teams").select("*").eq("challenge_id", challenge.id).order("sort_order");
      const detail = await buildDetail(SYSTEM_VIEWER, { ...challenge, status: "closed" }, teamRows ?? []);
      const lines = detail.summary.teams.map((team: any) => `${team.name} ${team.points} points (${team.transactions} sales)`);
      for (const m of detail.summary.milestones) if (m.winners.length) lines.push(`${m.target} points: ${m.winners.map((w: any) => w.team).join(" & ")} first`);
      void notifyTeamChallenge(ctxOf(challenge), { kind: "closed", repIds: allMembers(teamRows ?? []), lines });
    }
    res.json({ ok: true });
  } catch (error: any) { fail(res, error, "Couldn't change the challenge status."); }
});

// ── Verification ─────────────────────────────────────────────────────────────

router.post("/:id/entries/:entryId/decision", requireRole(...LEADERS), async (req, res) => {
  const parsed = z.object({ action: z.enum(["verify", "correction", "exclude"]), note: z.string().trim().max(500).optional() }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: humanFieldErrors(parsed.error) }); return; }
  try {
    const { challenge } = await loadChallenge(req, String(req.params.id));
    const { data: entry, error } = await supabase.from("team_challenge_entries").select("*").eq("id", String(req.params.entryId)).eq("challenge_id", challenge.id).maybeSingle();
    if (error) throw error;
    if (!entry) throw httpError(404, "That order is not in this challenge.");
    if (entry.rep_id === req.user!.id) throw httpError(403, "You can't verify your own score.");
    const { action, note } = parsed.data;
    if (action === "verify" && entry.status === "verified" && entry.escalated_at) {
      // The Owner agrees with an already verified order: close the escalation.
      if (scopeOf(req).role !== "Owner") throw httpError(403, "This order was escalated to the Owner, who decides it.");
      await supabase.from("team_challenge_entries").update({ escalated_at: null, status_reason: note || entry.status_reason, updated_at: new Date().toISOString() }).eq("id", entry.id);
      await log(challenge, req, "escalation_resolved", { orderId: entry.order_id, kept: true, note: note ?? null });
      res.json({ ok: true });
      return;
    }
    if (action === "verify" && !["awaiting_verification", "correction_requested", "excluded"].includes(entry.status)) {
      throw httpError(409, entry.status === "verified" ? "Already verified." : "It can only be verified once it is delivered and paid.");
    }
    if (action === "verify" && (!entry.delivered_at || !entry.paid_at)) throw httpError(409, "It can only be verified once it is delivered and paid.");
    if (action !== "verify" && (!note || note.length < 3)) throw httpError(400, "Say why, so the rep can see it.");
    const status = action === "verify" ? "verified" : action === "correction" ? "correction_requested" : (entry.status === "verified" ? "reversed" : "excluded");
    if (entry.escalated_at && scopeOf(req).role !== "Owner") throw httpError(403, "This order was escalated to the Owner, who decides it.");
    const { error: updateError } = await supabase.from("team_challenge_entries").update({
      status, status_reason: note || null, verified_points: action === "verify" ? entry.points : entry.verified_points, escalated_at: null,
      decided_by: req.user!.id, decided_by_name: req.user!.name ?? req.user!.role, decided_at: new Date().toISOString(), updated_at: new Date().toISOString()
    }).eq("id", entry.id);
    if (updateError) throw updateError;
    await log(challenge, req, `entry_${status}`, { orderId: entry.order_id, points: entry.points, note: note ?? null });
    void notifyTeamChallenge(ctxOf(challenge), { kind: "entry_decided", repId: entry.rep_id, orderId: entry.order_id, status: status as any, points: entry.points, contribution: entry.contribution === null ? null : Number(entry.contribution), note: note ?? null });
    const { data: teamRows } = await supabase.from("team_challenge_teams").select("*").eq("challenge_id", challenge.id).order("sort_order");
    watchSoon(challenge, teamRows ?? []);
    res.json({ ok: true });
  } catch (error: any) { fail(res, error, "Couldn't save the decision."); }
});

/** The rep's side: answer a correction request or ask for an excluded score to be reviewed. */
router.post("/:id/entries/:entryId/respond", async (req, res) => {
  const parsed = z.object({ note: z.string().trim().min(3, "Write what the manager should know.").max(500), requestReview: z.boolean().default(false) }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: humanFieldErrors(parsed.error) }); return; }
  try {
    const { challenge } = await loadChallenge(req, String(req.params.id));
    const { data: entry } = await supabase.from("team_challenge_entries").select("*").eq("id", String(req.params.entryId)).eq("challenge_id", challenge.id).maybeSingle();
    if (!entry) throw httpError(404, "That order is not in this challenge.");
    if (entry.rep_id !== scopeOf(req).id) throw httpError(403, "You can only answer for your own orders.");
    const reopen = entry.status === "correction_requested" || (parsed.data.requestReview && ["excluded", "reversed"].includes(entry.status) && entry.delivered_at && entry.paid_at);
    const { error } = await supabase.from("team_challenge_entries").update({
      rep_note: parsed.data.note, review_requested_at: new Date().toISOString(),
      ...(reopen ? { status: "awaiting_verification", decided_by: null, decided_by_name: null, decided_at: null } : {}),
      updated_at: new Date().toISOString()
    }).eq("id", entry.id);
    if (error) throw error;
    await log(challenge, req, parsed.data.requestReview ? "review_requested" : "rep_responded", { orderId: entry.order_id, note: parsed.data.note });
    void notifyTeamChallenge(ctxOf(challenge), { kind: "rep_responded", repName: req.user!.name ?? "A rep", orderId: entry.order_id, review: parsed.data.requestReview });
    res.json({ ok: true });
  } catch (error: any) { fail(res, error, "Couldn't send that."); }
});

/** A manager adjustment to an order's contribution (e.g. the upgrade raised the delivery cost). Reason required; logged; re-verified. */
router.post("/:id/entries/:entryId/adjust", requireRole(...LEADERS), async (req, res) => {
  const parsed = z.object({ amount: z.coerce.number().min(-10_000_000).max(10_000_000), reason: z.string().trim().min(5, "Give the reason for the adjustment.").max(400) }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: humanFieldErrors(parsed.error) }); return; }
  try {
    const { challenge } = await loadChallenge(req, String(req.params.id));
    const { data: entry } = await supabase.from("team_challenge_entries").select("*").eq("id", String(req.params.entryId)).eq("challenge_id", challenge.id).maybeSingle();
    if (!entry) throw httpError(404, "That order is not in this challenge.");
    if (entry.rep_id === req.user!.id) throw httpError(403, "You can't adjust your own score.");
    const { error } = await supabase.from("team_challenge_entries").update({
      adjustment_amount: parsed.data.amount, adjustment_reason: parsed.data.reason, adjustment_by_name: req.user!.name ?? req.user!.role, adjusted_at: new Date().toISOString(),
      ...(entry.status === "verified" ? { status: "awaiting_verification", status_reason: "Contribution adjusted after verification - check again.", decided_by: null, decided_by_name: null, decided_at: null } : {}),
      updated_at: new Date().toISOString()
    }).eq("id", entry.id);
    if (error) throw error;
    await log(challenge, req, "contribution_adjusted", { orderId: entry.order_id, amount: parsed.data.amount, previous: Number(entry.adjustment_amount || 0), reason: parsed.data.reason });
    res.json({ ok: true });
  } catch (error: any) { fail(res, error, "Couldn't save the adjustment."); }
});

/** Send an unusual order to the Owner; only the Owner then decides it. */
router.post("/:id/entries/:entryId/escalate", requireRole(...LEADERS), async (req, res) => {
  const parsed = z.object({ note: z.string().trim().min(3, "Say what the Owner should look at.").max(500) }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: humanFieldErrors(parsed.error) }); return; }
  try {
    const { challenge } = await loadChallenge(req, String(req.params.id));
    const { data: entry } = await supabase.from("team_challenge_entries").select("id, order_id").eq("id", String(req.params.entryId)).eq("challenge_id", challenge.id).maybeSingle();
    if (!entry) throw httpError(404, "That order is not in this challenge.");
    const { error } = await supabase.from("team_challenge_entries").update({ escalated_at: new Date().toISOString(), escalation_note: parsed.data.note, updated_at: new Date().toISOString() }).eq("id", entry.id);
    if (error) throw error;
    await log(challenge, req, "escalated_to_owner", { orderId: entry.order_id, note: parsed.data.note });
    void notifyTeamChallenge(ctxOf(challenge), { kind: "escalated", orderId: entry.order_id, by: req.user!.name ?? "A manager", note: parsed.data.note });
    res.json({ ok: true });
  } catch (error: any) { fail(res, error, "Couldn't escalate it."); }
});

/**
 * The last three full months run through the same rule (delivered and paid
 * orders, added contribution → 0 / 1 / 2 points), per team and rep - the
 * baseline the challenge should beat. Stored on the challenge.
 */
router.post("/:id/baseline", requireRole(...LEADERS), async (req, res) => {
  try {
    const { challenge, teams } = await loadChallenge(req, String(req.params.id));
    const scoring = normaliseScoring(challenge.scoring);
    const months: Array<{ key: string; from: string; to: string }> = [];
    const [year, month] = challenge.sell_from.split("-").map(Number);
    for (let back = 3; back >= 1; back -= 1) {
      const start = new Date(Date.UTC(year, month - 1 - back, 1));
      const end = new Date(Date.UTC(year, month - back, 0));
      months.push({ key: start.toISOString().slice(0, 7), from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) });
    }
    const teamOf = new Map<string, string>();
    for (const team of teams) for (const id of team.member_ids ?? []) teamOf.set(String(id), team.id);
    const members = Array.from(teamOf.keys());
    if (members.length === 0) throw httpError(400, "Put reps on the teams first.");
    const { data: orders, error } = await supabase.from("orders").select(ORDER_FIELDS)
      .eq("org_id", challenge.org_id).eq("branch_id", challenge.branch_id).in("assigned_rep_id", members).eq("status", "Delivered").eq("remittance_status", "Paid")
      .gte("created_at", lagosStart(months[0].from)).lte("created_at", lagosEnd(months[2].to)).limit(10000);
    if (error) throw error;
    const relevant = ((orders ?? []) as any[]).filter((order) => (Number(order.upsell_to_qty) || 0) > (Number(order.upsell_from_qty) || 0) || (Array.isArray(order.cross_sell_lines) && order.cross_sell_lines.length > 0));
    const cost = await costBook(challenge.org_id, relevant.flatMap((order: any) => [order.product_id, ...(order.cross_sell_lines ?? []).map((line: any) => line?.productId), ...(order.free_gift_lines ?? []).map((line: any) => line?.productId)]));
    const bonusItems = await perOrderExpansionBonusBreakdownMapForDeliveredRange(challenge.org_id, months[0].from, addDays(months[2].to, 30)).catch(() => ({} as Record<string, Array<{ amount: number }>>));
    const rows = months.map((m) => ({ month: m.key, transactions: 0, points: 0, contribution: 0, byTeam: {} as Record<string, { transactions: number; points: number; contribution: number }>, byRep: {} as Record<string, { transactions: number; points: number }> }));
    for (const order of relevant) {
      const monthKey = new Date(Date.parse(order.created_at) + 3_600_000).toISOString().slice(0, 7);
      const row = rows.find((item) => item.month === monthKey);
      if (!row) continue;
      const result = contributionOf({
        productId: order.product_id, amount: Number(order.amount) || 0, originalAmount: order.original_amount === null ? null : Number(order.original_amount), originalQuantity: order.original_quantity,
        upsellFromQty: order.upsell_from_qty, upsellToQty: order.upsell_to_qty, quantity: order.quantity,
        crossSellLines: order.cross_sell_lines ?? [], giftLines: order.free_gift_lines ?? [], unitCost: (productId) => cost(productId, order.created_at),
        repBonus: (bonusItems[String(order.id)] ?? []).reduce((sum: number, item: any) => sum + (Number(item.amount) || 0), 0), extraLogistics: 0, adjustment: 0, packagingPerUnit: scoring.packagingPerUnit
      });
      if (!result) continue;
      const points = pointsFor(result.contribution, scoring);
      const teamId = teamOf.get(String(order.assigned_rep_id))!;
      row.transactions += 1; row.points += points; row.contribution += result.contribution;
      row.byTeam[teamId] = row.byTeam[teamId] ?? { transactions: 0, points: 0, contribution: 0 };
      row.byTeam[teamId].transactions += 1; row.byTeam[teamId].points += points; row.byTeam[teamId].contribution += result.contribution;
      row.byRep[order.assigned_rep_id] = row.byRep[order.assigned_rep_id] ?? { transactions: 0, points: 0 };
      row.byRep[order.assigned_rep_id].transactions += 1; row.byRep[order.assigned_rep_id].points += points;
    }
    const baseline = { computedAt: new Date().toISOString(), months: rows, averagePoints: Math.round((rows.reduce((sum, row) => sum + row.points, 0) / rows.length) * 10) / 10 };
    const { error: saveError } = await supabase.from("team_challenges").update({ baseline }).eq("id", challenge.id);
    if (saveError) throw saveError;
    await log(challenge, req, "baseline_calculated", { averagePoints: baseline.averagePoints });
    res.json(baseline);
  } catch (error: any) { fail(res, error, "Couldn't calculate the baseline."); }
});

// ── Rewards ──────────────────────────────────────────────────────────────────

/** Owner approves what a team is owed at a milestone (computed here, never typed). */
router.post("/:id/payouts", requireRole("Owner"), async (req, res) => {
  const parsed = z.object({ teamId: z.string().uuid(), milestoneKey: z.string().trim().max(10) }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: humanFieldErrors(parsed.error) }); return; }
  try {
    const { challenge, teams } = await loadChallenge(req, String(req.params.id));
    const detail = await buildDetail(req, challenge, teams);
    const team = detail.teams.find((row) => row.id === parsed.data.teamId);
    const item = team?.entitlements.find((row) => row.key === parsed.data.milestoneKey);
    if (!team || !item) throw httpError(404, "Not found.");
    if (!item.reached || item.step <= 0) throw httpError(409, "This team has nothing owed at that milestone.");
    if (item.provisional) throw httpError(409, "Still provisional: earlier qualifying orders are waiting for verification. Verify those first.");
    if (item.payout) throw httpError(409, "Already approved.");
    const teamRow = teams.find((row) => row.id === team.id);
    const perRep = splitEqually(item.step, teamRow?.member_ids ?? []).map((share) => ({ ...share, name: team.members.find((member: any) => member.id === share.repId)?.name ?? "Rep" }));
    const { error } = await supabase.from("team_challenge_payouts").insert({
      org_id: challenge.org_id, branch_id: challenge.branch_id, challenge_id: challenge.id, team_id: team.id, milestone_key: item.key,
      amount: item.step, per_rep: perRep, approved_by: req.user!.id, approved_by_name: req.user!.name ?? "Owner"
    });
    if (error) throw error;
    await log(challenge, req, "payout_approved", { team: team.name, milestone: item.target, amount: item.step, perRep });
    void notifyTeamChallenge(ctxOf(challenge), { kind: "payout", repIds: (teamRow?.member_ids ?? []).map(String), team: team.name, target: item.target, amount: item.step, perRep: perRep[0]?.amount ?? item.step, paid: false });
    res.json({ ok: true });
  } catch (error: any) { fail(res, error, "Couldn't approve the payout."); }
});

router.post("/:id/payouts/:payoutId/paid", requireRole("Owner"), async (req, res) => {
  const parsed = z.object({ reference: z.string().trim().max(120).optional() }).safeParse(req.body ?? {});
  if (!parsed.success) { res.status(400).json({ error: humanFieldErrors(parsed.error) }); return; }
  try {
    const { challenge } = await loadChallenge(req, String(req.params.id));
    const { data: payout } = await supabase.from("team_challenge_payouts").select("*").eq("id", String(req.params.payoutId)).eq("challenge_id", challenge.id).maybeSingle();
    if (!payout) throw httpError(404, "Not found.");
    if (payout.paid_at) throw httpError(409, "Already marked paid.");
    const { error } = await supabase.from("team_challenge_payouts").update({ paid_at: new Date().toISOString(), paid_reference: parsed.data.reference || null }).eq("id", payout.id);
    if (error) throw error;
    await log(challenge, req, "payout_paid", { amount: Number(payout.amount), reference: parsed.data.reference ?? null });
    const { data: paidTeam } = await supabase.from("team_challenge_teams").select("name, member_ids").eq("id", payout.team_id).maybeSingle();
    const target = normaliseMilestones(challenge.milestones).find((m) => m.key === payout.milestone_key)?.target ?? 0;
    void notifyTeamChallenge(ctxOf(challenge), { kind: "payout", repIds: (paidTeam?.member_ids ?? []).map(String), team: paidTeam?.name ?? "Team", target, amount: Number(payout.amount), perRep: Number((payout.per_rep as any[])?.[0]?.amount ?? payout.amount), paid: true });
    res.json({ ok: true });
  } catch (error: any) { fail(res, error, "Couldn't mark it paid."); }
});

/** Who can be put on a team: active sales reps in this branch. */
router.get("/meta/reps", requireRole(...LEADERS), async (req, res) => {
  try {
    const branchId = branchOf(req);
    const [{ data: users }, { data: members }, { data: products }] = await Promise.all([
      supabase.from("users").select("id, name, role").eq("org_id", req.user!.orgId).eq("active", true).eq("role", "Sales Rep").order("name"),
      supabase.from("branch_memberships").select("user_id").eq("branch_id", branchId),
      supabase.from("products").select("id, name, active").eq("org_id", req.user!.orgId).eq("active", true).order("name")
    ]);
    const inBranch = new Set((members ?? []).map((row: any) => row.user_id));
    res.json({
      reps: (users ?? []).filter((row: any) => inBranch.has(row.id)).map((row: any) => ({ id: row.id, name: row.name ?? "Rep" })),
      products: (products ?? []).map((row: any) => ({ id: row.id, name: row.name })),
      defaults: { milestones: DEFAULT_MILESTONES, scoring: DEFAULT_SCORING as Scoring }
    });
  } catch (error: any) { fail(res, error, "Couldn't load the reps."); }
});

export default router;
