// ── Telegram commands for leadership: the numbers (Bright, 6 Nov 2026) ─────
// /week /lastweek /compare /reps /upsells /fines /products /trend.
// Wording, and which app page each number follows: telegram-insights-rules.ts.
// telegram.ts passes who is asking and the branches they may see, so this
// file never imports telegram.ts back.

import { supabase } from "./supabase.js";
import { logger } from "./logger.js";
import { arrivedAtMs, LATE_SEND_FINE_TYPE, lateSendsFor } from "./late-send.js";
import { LATE_SEND_FROM, lateSendWindow } from "./late-send-rules.js";
import { addDaysToDateKey, lagosDateKey, sundayWeekStartForDateKey } from "./sales-bonus-engine.js";
import { MISSING_FEE_TYPE, missingFeesFor } from "./missing-fee-penalty.js";
import { NO_FEE_CHARGE_TYPE, attachDecisions, undecidedFor } from "./review-order-decisions.js";
import { judgeProductWeek, weekFigures, type WeeklyAdDay, type WeeklyOrder } from "./product-weekly.js";
import { LEADERSHIP_ROLES, commandDeniedText, seesBusinessMoney, type BusinessReport, type CommandKey } from "./telegram-rules.js";
import {
  compareDraft, finesLeaderDraft, finesRepDraft, fineTotals, productsDraft, rankReps, rangeLabel, repsDraft, trendDraft, upsellsDraft,
  wantsLastWeek, weekDraft, weekPeriods,
  type FineItem, type MissedLogs, type Period, type ProductRow, type Reply, type RepRow, type TrendRow, type UpsellRow, type WaitingItem, type WaitingRow
} from "./telegram-insights-rules.js";

type Person = { userId: string; role: string; name: string };

export type InsightContext = {
  orgId: string;
  person: Person;
  /** null = every branch (the Owner); otherwise the branches this person works in. */
  branches: string[] | null;
  /** Active staff. */
  people: Map<string, Person>;
  /** Branch memberships by user: a Manager only sees the reps of their own branches. */
  memberships: Map<string, Set<string>>;
  businessReport: (orgId: string, from: string, to: string, branchIds: string[] | null) => Promise<BusinessReport>;
};

const NO_BRANCH = "00000000-0000-0000-0000-000000000000";
const startIso = (day: string) => new Date(`${day}T00:00:00+01:00`).toISOString();
const endIso = (day: string) => new Date(`${day}T23:59:59.999+01:00`).toISOString();

/** Only the asker's branches (any: the query builder's types are too deep to pass through a helper). */
const scopedTo = (ctx: InsightContext) => (query: any): any =>
  ctx.branches === null ? query : query.in("branch_id", ctx.branches.length ? ctx.branches : [NO_BRANCH]);

const repInScope = (ctx: InsightContext, repId: string) =>
  ctx.branches === null || [...(ctx.memberships.get(repId) ?? [])].some((branch) => ctx.branches!.includes(branch));

const salesRepsOf = (ctx: InsightContext) => [...ctx.people.values()].filter((person) => person.role === "Sales Rep" && repInScope(ctx, person.userId));

// ── Fines (the weekly report's rule) ────────────────────────────────────────

/**
 * Fines logged in [from, to], as the weekly report counts them (routes/
 * weekly-reports.ts finesForWeek): by the day logged; missed follow-up fines
 * are counted from follow_up_misses instead, and the old automatic no-fee
 * charges (stopped 23 Oct 2026) stay out. A fine under appeal is marked held:
 * it is not taken off until it is decided.
 */
async function finesBetween(ctx: InsightContext, from: string, to: string, repId: string | null): Promise<FineItem[]> {
  let query = supabase.from("rep_penalties").select("id, rep_id, rep_name, type, amount, reason, remove_all_bonuses, created_at")
    .eq("org_id", ctx.orgId).neq("type", "follow_up_miss").neq("type", MISSING_FEE_TYPE)
    .gte("created_at", startIso(from)).lte("created_at", endIso(to)).order("created_at", { ascending: true }).limit(2000);
  if (repId) query = query.eq("rep_id", repId);
  const { data, error } = await query;
  if (error) throw error;
  const rows = ((data ?? []) as any[]).filter((row) => repId !== null || repInScope(ctx, String(row.rep_id)));
  const { heldPenaltyIds } = await import("../routes/fine-appeals.js");
  const held = await heldPenaltyIds(ctx.orgId, rows.map((row) => String(row.id)));
  return rows.map((row) => ({
    repId: String(row.rep_id),
    repName: ctx.people.get(String(row.rep_id))?.name ?? String(row.rep_name ?? "Former rep"),
    amount: Number(row.amount ?? 0),
    label: [row.type === LATE_SEND_FINE_TYPE ? "Late order send" : row.type === NO_FEE_CHARGE_TYPE ? "No delivery fee" : row.type === "waybill_follow_up_miss" ? "Waybill follow-up missed" : row.type, row.reason].filter(Boolean).join(" - ")
      + (row.remove_all_bonuses ? " (removes all bonuses at payroll)" : ""),
    date: lagosDateKey(String(row.created_at)),
    held: held.has(String(row.id))
  }));
}

/** Missed follow-up and cart logs of the week (the weekly report's own list). */
async function missedLogs(ctx: InsightContext, weekStart: string, repId: string | null): Promise<MissedLogs | null> {
  try {
    const { logMissesForWeek } = await import("../routes/log-misses.js");
    const rows = (await logMissesForWeek(ctx.orgId, repId ? [repId] : null, weekStart))
      .filter((row) => (repId ? row.repId === repId : repInScope(ctx, row.repId)));
    const sum = (status: string) => rows.filter((row) => row.status === status).reduce((total, row) => total + (Number(row.amount) || 0), 0);
    return { approved: sum("approved"), pending: sum("pending") };
  } catch (error) {
    logger.warn("telegram /fines missed logs failed", { orgId: ctx.orgId, error: String((error as Error)?.message ?? error) });
    return null;
  }
}

/**
 * The weekly review's list still to decide: late send-outs and no-fee orders
 * nobody has charged or skipped yet (the "SENT LATE 2 waiting" / "FEE
 * MISSING 1 waiting" chips). Same lists and decisions as the review page.
 */
async function waitingDecisions(ctx: InsightContext, weekStart: string, onlyRepId: string | null = null): Promise<WaitingRow[]> {
  const [missingFees, lateSends] = await Promise.all([missingFeesFor(ctx.orgId, weekStart), lateSendsFor(ctx.orgId, weekStart)]);
  if (!(await attachDecisions(ctx.orgId, missingFees, lateSends))) return [];
  const rows: WaitingRow[] = [];
  for (const repId of new Set([...Object.keys(missingFees), ...Object.keys(lateSends)])) {
    // A rep asking about their own: just theirs. Leadership: the reps of their branches.
    if (onlyRepId ? repId !== onlyRepId : !repInScope(ctx, repId)) continue;
    const late = new Map((lateSends[repId]?.orders ?? []).map((order) => [order.orderId, order]));
    const fees = new Map((missingFees[repId]?.orders ?? []).map((order) => [order.orderId, order]));
    const items: WaitingItem[] = undecidedFor(repId, missingFees, lateSends).map((item) => {
      if (item.kind === "late_send") {
        const order = late.get(item.orderId);
        return { kind: "late_send", orderId: item.orderId, minutesLate: order?.workingMinutesLate, stillNew: order ? !order.sentAt : undefined };
      }
      return { kind: "missing_fee", orderId: item.orderId, deliveredDate: fees.get(item.orderId)?.deliveredDate };
    });
    const lateCount = items.filter((item) => item.kind === "late_send").length;
    const noFee = items.length - lateCount;
    if (items.length) rows.push({ repId, repName: ctx.people.get(repId)?.name ?? "Former rep", lateSends: lateCount, noFee, items });
  }
  return rows;
}

// ── Reps (the Manager Dashboard's rule) ─────────────────────────────────────

async function repRows(ctx: InsightContext, period: Period, fines: FineItem[]): Promise<RepRow[]> {
  const scope = scopedTo(ctx);
  const [placed, sent] = await Promise.all([
    scope(supabase.from("orders").select("id, assigned_rep_id, status, review_hold").eq("org_id", ctx.orgId).neq("launch_stage", "silent")
      .not("assigned_rep_id", "is", null).gte("created_at", startIso(period.from)).lte("created_at", endIso(period.to))).limit(20000),
    scope(supabase.from("orders").select("id, assigned_rep_id, created_at, original_created_at, assigned_at, revealed_at, sent_out_at").eq("org_id", ctx.orgId).neq("launch_stage", "silent")
      .not("assigned_rep_id", "is", null).gte("sent_out_at", startIso(period.from)).lte("sent_out_at", endIso(period.to))).limit(20000)
  ]);
  if (placed.error) throw placed.error;
  if (sent.error) throw sent.error;
  const rows = new Map<string, RepRow>(salesRepsOf(ctx).map((rep) => [rep.userId, { repId: rep.userId, name: rep.name, orders: 0, delivered: 0, lateSends: 0, finesAmount: 0 }]));
  // Held repeat orders are out of every conversion report.
  for (const order of ((placed.data ?? []) as any[]).filter((row) => row.review_hold !== true)) {
    const row = rows.get(String(order.assigned_rep_id));
    if (!row) continue;
    row.orders += 1;
    if (order.status === "Delivered") row.delivered += 1;
  }
  const lateFrom = Date.parse(`${LATE_SEND_FROM}T00:00:00+01:00`);
  for (const order of (sent.data ?? []) as any[]) {
    const row = rows.get(String(order.assigned_rep_id));
    const arrived = arrivedAtMs(order);
    if (!row || !Number.isFinite(arrived) || arrived < lateFrom) continue;
    if (Date.parse(order.sent_out_at) > lateSendWindow(arrived).deadlineMs) row.lateSends += 1;
  }
  for (const fine of fines) {
    const row = rows.get(fine.repId);
    if (row && !fine.held) row.finesAmount += fine.amount;
  }
  return [...rows.values()].filter((row) => row.orders > 0 || row.lateSends > 0 || row.finesAmount > 0);
}

// ── Upsells (the Upsell Performance page's rule) ───────────────────────────

async function upsellRows(ctx: InsightContext, period: Period): Promise<UpsellRow[]> {
  const { data, error } = await scopedTo(ctx)(supabase.from("orders").select("id, assigned_rep_id, upsell_from_qty, upsell_to_qty, cross_sell_lines, review_hold")
    .eq("org_id", ctx.orgId).neq("launch_stage", "silent").eq("status", "Delivered").gte("delivered_date", period.from).lte("delivered_date", period.to)).limit(20000);
  if (error) throw error;
  const reps = new Map(salesRepsOf(ctx).map((rep) => [rep.userId, rep]));
  const OTHER = "__other__";
  const rows = new Map<string, UpsellRow>();
  for (const order of ((data ?? []) as any[]).filter((row) => row.review_hold !== true)) {
    const rep = reps.get(String(order.assigned_rep_id));
    const key = rep ? rep.userId : OTHER;
    const row = rows.get(key) ?? { repId: key, name: rep ? rep.name : "Other staff", salesRep: Boolean(rep), delivered: 0, upsell: 0, cross: 0, either: 0 };
    const fromQty = Number(order.upsell_from_qty) || 0;
    const toQty = Number(order.upsell_to_qty) || 0;
    const upsold = Boolean(fromQty && toQty && toQty > fromQty);
    const crossSold = Array.isArray(order.cross_sell_lines) && order.cross_sell_lines.length > 0;
    row.delivered += 1;
    if (upsold) row.upsell += 1;
    if (crossSold) row.cross += 1;
    if (upsold || crossSold) row.either += 1;
    rows.set(key, row);
  }
  return [...rows.values()];
}

// ── Products (Product Trend's rule) ─────────────────────────────────────────

async function productNames(orgId: string) {
  const { data, error } = await supabase.from("products").select("id, name").eq("org_id", orgId);
  if (error) throw error;
  return new Map(((data ?? []) as any[]).map((row) => [String(row.id), String(row.name ?? "Product")]));
}

async function productRows(ctx: InsightContext, period: Period, before: Period): Promise<ProductRow[]> {
  const scope = scopedTo(ctx);
  const [now, earlier, names] = await Promise.all([
    scope(supabase.from("orders").select("id, product_id, product_name, status, amount, review_hold").eq("org_id", ctx.orgId).neq("launch_stage", "silent")
      .gte("created_at", startIso(period.from)).lte("created_at", endIso(period.to))).limit(20000),
    scope(supabase.from("orders").select("id, product_id, product_name, review_hold").eq("org_id", ctx.orgId).neq("launch_stage", "silent")
      .gte("created_at", startIso(before.from)).lte("created_at", endIso(before.to))).limit(20000),
    productNames(ctx.orgId)
  ]);
  if (now.error) throw now.error;
  if (earlier.error) throw earlier.error;
  const keyOf = (order: any) => (order.product_id ? String(order.product_id) : `name:${String(order.product_name ?? "").trim().toLowerCase()}`);
  const rows = new Map<string, ProductRow>();
  const rowFor = (order: any) => {
    const key = keyOf(order);
    const row = rows.get(key) ?? { name: (order.product_id && names.get(String(order.product_id))) || String(order.product_name ?? "Other"), orders: 0, delivered: 0, revenue: 0, ordersBefore: 0 };
    rows.set(key, row);
    return row;
  };
  for (const order of ((now.data ?? []) as any[]).filter((row) => row.review_hold !== true)) {
    const row = rowFor(order);
    row.orders += 1;
    if (order.status === "Delivered") { row.delivered += 1; row.revenue += Number(order.amount) || 0; }
  }
  for (const order of ((earlier.data ?? []) as any[]).filter((row) => row.review_hold !== true)) rowFor(order).ordersBefore += 1;
  return [...rows.values()];
}

// ── Trends (the Weekly Check-up's rule) ─────────────────────────────────────

async function trendRows(ctx: InsightContext, today: string): Promise<{ rows: TrendRow[]; lastWeekLabel: string; ageDays: number }> {
  const thisWeek = sundayWeekStartForDateKey(today);
  const week = addDaysToDateKey(thisWeek, -7);
  const weekEnd = addDaysToDateKey(week, 6);
  const weeks = [28, 21, 14, 7, 0].map((back) => addDaysToDateKey(week, -back));
  const from = weeks[0];
  // Like for like: every week counted this many days after it ended.
  const ageDays = Math.max(0, Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${weekEnd}T00:00:00Z`)) / 86_400_000));
  const cutoffOf = (start: string) => { const c = addDaysToDateKey(addDaysToDateKey(start, 6), ageDays); return c > today ? today : c; };
  const scope = scopedTo(ctx);
  const money = seesBusinessMoney(ctx.person.role);
  const [orderRes, expenseRes, names] = await Promise.all([
    scope(supabase.from("orders").select("id, created_at, product_id, status, delivered_date, amount, cogs_snapshot, logistics_cost, state, upsell_from_qty, upsell_to_qty, call_outcome, review_hold")
      .eq("org_id", ctx.orgId).neq("launch_stage", "silent").not("product_id", "is", null).gte("created_at", startIso(from)).lte("created_at", endIso(today))).limit(20000),
    // Ad spend only for those who may see it (it decides the verdict and the profit).
    money
      ? scope(supabase.from("expenses").select("id, product_id, date, amount").eq("org_id", ctx.orgId).eq("category", "Ad Spend").not("product_id", "is", null).gte("date", from).lte("date", weekEnd)).limit(20000)
      : Promise.resolve({ data: [], error: null }),
    productNames(ctx.orgId)
  ]);
  if (orderRes.error) throw orderRes.error;
  if (expenseRes.error) throw expenseRes.error;
  const orders: WeeklyOrder[] = [];
  const thisWeekOrders = new Map<string, number>();
  for (const row of (orderRes.data ?? []) as any[]) {
    if (row.review_hold === true || !row.product_id) continue;
    const placedWeek = sundayWeekStartForDateKey(lagosDateKey(String(row.created_at)));
    if (placedWeek === thisWeek) { thisWeekOrders.set(String(row.product_id), (thisWeekOrders.get(String(row.product_id)) ?? 0) + 1); continue; }
    const fromQty = Number(row.upsell_from_qty) || 0, toQty = Number(row.upsell_to_qty) || 0;
    orders.push({
      productId: String(row.product_id), week: placedWeek, placedAt: Date.parse(row.created_at),
      status: String(row.status ?? ""), deliveredDate: row.delivered_date ? String(row.delivered_date).slice(0, 10) : null,
      amount: Number(row.amount) || 0, productCost: Number(row.cogs_snapshot) || 0, deliveryFee: Number(row.logistics_cost) || 0,
      state: row.state ? String(row.state) : null, upsold: toQty > fromQty && fromQty > 0,
      failReason: row.call_outcome ? String(row.call_outcome) : null
    });
  }
  const ads: WeeklyAdDay[] = ((expenseRes.data ?? []) as any[]).map((row) => ({ productId: String(row.product_id), day: String(row.date).slice(0, 10), spend: Number(row.amount) || 0 }));
  const productIds = new Set<string>([...orders.map((order) => order.productId), ...ads.map((row) => row.productId), ...thisWeekOrders.keys()]);
  const rows: TrendRow[] = [];
  for (const id of productIds) {
    const own = orders.filter((order) => order.productId === id);
    const ownAds = ads.filter((row) => row.productId === id);
    const figures = weeks.map((start) => weekFigures({
      week: start, weekEnd: addDaysToDateKey(start, 6), cutoff: cutoffOf(start),
      orders: own.filter((order) => order.week === start), ads: ownAds, clicks: [], carts: 0
    }));
    // Stock-outs and fail reasons only change the Check-up's advice, not its verdict.
    const judged = judgeProductWeek({ week: figures[4], previous: figures.slice(0, 4), targetCpa: null, stockOuts: [], failReasons: [], ageDays });
    const last = figures[4];
    const soFar = thisWeekOrders.get(id) ?? 0;
    if (last.orders === 0 && last.adSpend === 0 && (judged.usual?.orders ?? 0) === 0 && soFar === 0) continue;
    rows.push({
      name: names.get(id) ?? "Product",
      weeks: figures.map((figure) => figure.orders),
      thisWeekSoFar: soFar,
      last: { orders: last.orders, rate: last.rate, profit: last.profit },
      usual: judged.usual ? { orders: judged.usual.orders, rate: judged.usual.rate, profit: judged.usual.profit } : null,
      verdict: judged.verdict
    });
  }
  return { rows, lastWeekLabel: rangeLabel(week, weekEnd), ageDays };
}

// ── The commands ────────────────────────────────────────────────────────────

export const INSIGHT_COMMANDS: CommandKey[] = ["fines", "week", "lastweek", "compare", "reps", "upsells", "products", "trend"];

async function weekReply(ctx: InsightContext, period: Period, heading: string, live: boolean): Promise<Reply> {
  const [report, fines, waiting] = await Promise.all([
    ctx.businessReport(ctx.orgId, period.from, period.to, ctx.branches),
    finesBetween(ctx, period.from, period.to, null),
    waitingDecisions(ctx, period.from)
  ]);
  const reps = await repRows(ctx, period, fines);
  const top = rankReps(reps).ranked[0] ?? null;
  const waitingOrders = waiting.reduce((sum, row) => sum + row.lateSends + row.noFee, 0);
  return weekDraft({ heading, period, report, fines: fineTotals(fines), topRep: top && top.delivered > 0 ? { name: top.name, orders: top.orders, delivered: top.delivered } : null, live, waitingOrders }, ctx.person.role);
}

/** The answer to one of the leadership commands (and /fines), or null for any other command. */
export async function insightAnswer(ctx: InsightContext, command: CommandKey, args: string): Promise<Reply | null> {
  if (!INSIGHT_COMMANDS.includes(command)) return null;
  const leadership = LEADERSHIP_ROLES.includes(ctx.person.role);
  // Strictly leadership (Bright, 6 Nov 2026); /fines is the one others may use, for their own fines only.
  if (!leadership && command !== "fines") return { text: commandDeniedText(command) };
  const p = weekPeriods(lagosDateKey());
  const last = wantsLastWeek(args);
  const period = last ? p.lastWeek : p.thisWeek;
  const when = last ? "last week" : "this week so far";

  if (command === "week") return weekReply(ctx, p.thisWeek, "This week so far", true);
  if (command === "lastweek") return weekReply(ctx, p.lastWeek, "Last week", false);

  if (command === "compare") {
    // Default: this week so far against the SAME days of last week (a fair race).
    // "/compare full": last week against the week before, both whole.
    const [now, before] = last ? [p.lastWeek, p.weekBefore] : [p.thisWeek, p.sameDaysLastWeek];
    const [nowReport, beforeReport, nowFines, beforeFines] = await Promise.all([
      ctx.businessReport(ctx.orgId, now.from, now.to, ctx.branches),
      ctx.businessReport(ctx.orgId, before.from, before.to, ctx.branches),
      finesBetween(ctx, now.from, now.to, null),
      finesBetween(ctx, before.from, before.to, null)
    ]);
    return compareDraft({
      heading: last ? "Last week vs the week before" : "This week vs last week",
      nowLabel: now.label,
      beforeLabel: last ? before.label : `${before.label} (same days)`,
      nowColumn: last ? "Last wk" : "This wk",
      beforeColumn: last ? "Prev wk" : "Last wk",
      now: { ...nowReport, finesAmount: fineTotals(nowFines).amount },
      before: { ...beforeReport, finesAmount: fineTotals(beforeFines).amount }
    }, ctx.person.role);
  }

  if (command === "reps") {
    const [fines, waiting] = await Promise.all([finesBetween(ctx, period.from, period.to, null), waitingDecisions(ctx, period.from)]);
    const waitingBy = new Map(waiting.map((row) => [row.repId, row.lateSends + row.noFee]));
    const rows = (await repRows(ctx, period, fines)).map((row) => ({ ...row, waitingOrders: waitingBy.get(row.repId) ?? 0 }));
    return repsDraft({ heading: `Sales reps · ${when}`, period, rows });
  }

  if (command === "upsells") {
    return upsellsDraft({ heading: `Upsells & cross-sells · ${when}`, period, rows: await upsellRows(ctx, period) });
  }

  if (command === "products") {
    const before = last ? p.weekBefore : p.sameDaysLastWeek;
    return productsDraft({ heading: `Best products · ${when}`, period, beforeLabel: last ? "the week before" : "the same days last week", rows: await productRows(ctx, period, before) }, ctx.person.role);
  }

  if (command === "trend") {
    const trend = await trendRows(ctx, p.today);
    return trendDraft(trend, ctx.person.role);
  }

  // /fines: leadership see every rep in their branches; anyone else only their own.
  const own = leadership ? null : ctx.person.userId;
  const previousPeriod = last ? p.weekBefore : p.lastWeek;
  const [fines, previousFines, logs, waiting] = await Promise.all([
    finesBetween(ctx, period.from, period.to, own),
    finesBetween(ctx, previousPeriod.from, previousPeriod.to, own),
    missedLogs(ctx, period.from, own),
    // Still to charge or skip: leadership see every rep's, a rep only their own (Bright, 7 Nov 2026).
    waitingDecisions(ctx, period.from, own)
  ]);
  const input = { period, fines, logs, previous: { label: last ? "The week before" : "Last week", fines: previousFines } };
  return leadership
    ? finesLeaderDraft({ heading: `Fines · ${when}`, ...input, waiting })
    : finesRepDraft({ heading: `Your fines · ${when}`, ...input, waiting: waiting.flatMap((row) => row.items ?? []) });
}
