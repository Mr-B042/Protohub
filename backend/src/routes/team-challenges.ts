import { Router, type Request } from "express";
import { z } from "zod";
import { supabase } from "../lib/supabase.js";
import { humanFieldErrors } from "../lib/validation-message.js";
import { requireAuth, requireRole, scopeOf } from "../middleware/auth.js";
import {
  DEFAULT_MILESTONES, DEFAULT_SCORING, contributionOf, maxBudget, normaliseMilestones, normaliseScoring, pointsFor, raceResults, splitEqually, teamEntitlements,
  type Milestone, type Scoring
} from "../lib/team-challenge.js";
import { perOrderExpansionBonusBreakdownMapForDeliveredRange } from "../lib/sales-bonus-engine.js";

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

const ORDER_FIELDS = "id, status, product_id, product_name, package_name, amount, currency, original_amount, original_quantity, upsell_from_qty, upsell_to_qty, quantity, cross_sell_lines, free_gift_lines, customer, assigned_rep_id, created_at, delivered_date, remittance_status, review_hold";

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
    ids.length ? supabase.from("order_audit").select("order_id, created_at").eq("org_id", challenge.org_id).eq("to_status", "Delivered").in("order_id", ids) : Promise.resolve({ data: [] as any[] }),
    ids.length ? supabase.from("remittance_transactions").select("order_id, received_at, delta_amount").eq("org_id", challenge.org_id).in("order_id", ids) : Promise.resolve({ data: [] as any[] }),
    costBook(challenge.org_id, productIds),
    relevant.some((order: any) => order.status === "Delivered") ? repBonusByOrder(challenge) : Promise.resolve({} as Record<string, number>)
  ]);
  const existing = new Map((existingRows ?? []).map((row: any) => [String(row.order_id), row]));
  const deliveredAt = new Map<string, string>();
  for (const row of (delivered as any).data ?? []) {
    const key = String(row.order_id);
    if (!deliveredAt.has(key) || Date.parse(row.created_at) > Date.parse(deliveredAt.get(key)!)) deliveredAt.set(key, row.created_at);
  }
  const paidAt = new Map<string, string>();
  for (const row of (paid as any).data ?? []) {
    if (Number(row.delta_amount) <= 0) continue;
    const key = String(row.order_id);
    if (!paidAt.has(key) || Date.parse(row.received_at) > Date.parse(paidAt.get(key)!)) paidAt.set(key, row.received_at);
  }

  const writes: any[] = [];
  const reversals: Array<{ orderId: string; reason: string }> = [];
  for (const order of relevant) {
    const orderId = String(order.id);
    const prior: any = existing.get(orderId) ?? null;
    if (scoring.productIds.length > 0 && !scoring.productIds.includes(order.product_id)) continue;
    const status = String(order.status ?? "");
    const isDelivered = status === "Delivered";
    const delivered = isDelivered ? (deliveredAt.get(orderId) ?? (order.delivered_date ? `${order.delivered_date}T12:00:00+01:00` : null)) : null;
    const paidTime = order.remittance_status === "Paid" ? (paidAt.get(orderId) ?? delivered) : null;
    const final = Boolean(delivered && paidTime);
    const result = contributionOf({
      productId: order.product_id, amount: Number(order.amount) || 0,
      originalAmount: order.original_amount === null ? null : Number(order.original_amount), originalQuantity: order.original_quantity,
      upsellFromQty: order.upsell_from_qty, upsellToQty: order.upsell_to_qty, quantity: order.quantity,
      crossSellLines: Array.isArray(order.cross_sell_lines) ? order.cross_sell_lines : [],
      giftLines: Array.isArray(order.free_gift_lines) ? order.free_gift_lines : [],
      unitCost: (productId) => cost(productId, order.created_at),
      repBonus: isDelivered ? Number((bonuses as Record<string, number>)[orderId] ?? 0) : 0,
      extraLogistics: 0,
      adjustment: Number(prior?.adjustment_amount ?? 0),
      packagingPerUnit: scoring.packagingPerUnit
    });
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

    let auto: string;
    let reason: string | null = null;
    if (["Failed", "Cancelled", "Returned"].includes(status)) { auto = prior?.status === "verified" ? "reversed" : "excluded"; reason = `Order ${status.toLowerCase()}: no contribution, no points.`; }
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
    const breakdown = {
      revenue: result.revenue, productCost: result.productCost, logistics: result.logistics, repBonus: result.repBonus,
      packaging: result.packaging, gifts: result.gifts, adjustment: result.adjustment,
      upgrade: result.upgrade, crossSells: result.crossSellCount
    };
    const row = {
      ...(prior ? { id: prior.id } : {}),
      org_id: challenge.org_id, branch_id: challenge.branch_id, challenge_id: challenge.id, order_id: orderId,
      rep_id: prior?.rep_id ?? owner, team_id: teamId,
      category: result.hasUpsell && result.hasCrossSell ? "both" : result.hasUpsell ? "upsell" : "cross_sell",
      points, rule_version: prior?.status === "verified" ? prior.rule_version : challenge.rule_version,
      rule_label: `${final ? "Final" : "Estimated"} contribution ₦${Math.round(result.contribution).toLocaleString("en-NG")} → ${points} point${points === 1 ? "" : "s"}`,
      original_snapshot: prior?.original_snapshot ?? {
        quantity: order.upsell_from_qty ?? order.original_quantity ?? order.quantity,
        amount: order.original_amount === null ? null : Number(order.original_amount), product: order.product_name, lockedAt: new Date().toISOString()
      },
      revised_snapshot: {
        quantity: order.upsell_to_qty ?? order.quantity, amount: Number(order.amount) || 0, package: order.package_name, product: order.product_name,
        crossSells: (Array.isArray(order.cross_sell_lines) ? order.cross_sell_lines : []).filter((line: any) => Number(line?.amount) > 0)
          .map((line: any) => ({ product: line.productName ?? line.name ?? "Add-on", quantity: line.quantity ?? 1, amount: Number(line.amount) || 0 })),
        gifts: (Array.isArray(order.free_gift_lines) ? order.free_gift_lines : []).map((line: any) => ({ product: line.productName ?? "Gift", quantity: line.quantity ?? 1 }))
      },
      added_value: result.revenue, contribution: result.contribution, contribution_breakdown: breakdown, contribution_final: final,
      delivered_at: delivered, paid_at: paidTime, qualified_at: qualifiedAt,
      status: next, status_reason: nextReason,
      decided_by: prior?.decided_by ?? null, decided_by_name: prior?.decided_by_name ?? null, decided_at: prior?.decided_at ?? null,
      verified_points: prior?.verified_points ?? null, rep_note: prior?.rep_note ?? null, review_requested_at: prior?.review_requested_at ?? null,
      adjustment_amount: prior?.adjustment_amount ?? 0, adjustment_reason: prior?.adjustment_reason ?? null, adjustment_by_name: prior?.adjustment_by_name ?? null, adjusted_at: prior?.adjusted_at ?? null,
      escalated_at: prior?.escalated_at ?? null, escalation_note: prior?.escalation_note ?? null,
      updated_at: new Date().toISOString()
    };
    const changed = !prior || ["points", "category", "status", "status_reason", "delivered_at", "paid_at", "qualified_at", "added_value", "team_id", "contribution", "contribution_final"]
      .some((key) => String((prior as any)[key] ?? "") !== String((row as any)[key] ?? ""));
    if (changed) writes.push(row);
  }
  for (let i = 0; i < writes.length; i += 200) {
    const { error: writeError } = await supabase.from("team_challenge_entries").upsert(writes.slice(i, i + 200), { onConflict: "challenge_id,order_id" });
    if (writeError) throw writeError;
  }
  for (const reversal of reversals) await log(challenge, null, "score_reversed", reversal);
}

const STAGE_COUNTS = ["awaiting_delivery", "awaiting_payment", "awaiting_verification", "correction_requested"];

async function buildDetail(req: Request, challenge: any, teams: any[]) {
  await syncEntries(challenge, teams);
  const leader = isLeader(req);
  const me = scopeOf(req).id;
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

  const teamRows = teams.map((team) => {
    const rows = all.filter((row) => row.team_id === team.id);
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
          pending: rows.filter((row) => row.rep_id === id && STAGE_COUNTS.includes(row.status)).length
        };
      }),
      points, orders: verified.length,
      onePoint: verified.filter((row) => pointsOf(row) === 1).length,
      twoPoint: verified.filter((row) => pointsOf(row) >= 2).length,
      zeroPoint: rows.filter((row) => Number(row.points) === 0 && !["excluded", "reversed"].includes(row.status)).length,
      contribution: verified.reduce((sum, row) => sum + Number(row.contribution || 0), 0),
      reconciliation,
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
        escalatedAt: row.escalated_at, escalationNote: row.escalation_note
      };
    }),
    log: (logRes.data ?? []).map((row: any) => ({ id: row.id, actor: row.actor_name, action: row.action, detail: row.detail, at: row.created_at })),
    me: { id: me, teamId: myTeam?.id ?? null, leader, owner: scopeOf(req).role === "Owner" }
  };
}

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
    packagingPerUnit: z.coerce.number().min(0).max(1_000_000).default(0), productIds: z.array(z.string().uuid()).max(100).default([])
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
    res.json({ ok: true });
  } catch (error: any) { fail(res, error, "Couldn't save the challenge."); }
});

router.delete("/:id", requireRole(...LEADERS), async (req, res) => {
  try {
    const { challenge } = await loadChallenge(req, String(req.params.id));
    if (challenge.status !== "draft") throw httpError(409, "Only a draft can be deleted. Close a running challenge instead.");
    const { error } = await supabase.from("team_challenges").delete().eq("id", challenge.id);
    if (error) throw error;
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
