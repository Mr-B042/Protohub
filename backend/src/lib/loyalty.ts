import { supabase } from "./supabase.js";
import { logger } from "./logger.js";
import { fetchAllRowsOrThrow, selectByIdBatches } from "./query-limits.js";
import { DAY_MS, lagosDay, phoneKey } from "./email-marketing-rules.js";
import { EmailMarketingError } from "./email-marketing.js";
import {
  DEFAULT_LEVELS, RETURNS_VOUCHER, bestVoucher, earningFor, lagosDayStart, lagosMonth, levelIndexFor, levelLines, loyaltyTagText, nextLevel, normalizeLevels,
  normalizePointsConfig, spendText, voucherNote, voucherOptions, type Level, type PointsProgram, type Reward, type VoucherKind, type VoucherOption
} from "./loyalty-rules.js";

/**
 * Loyalty & Rewards (Bright's design 55, 8 Nov 2026), part 1: points and VIP
 * levels. A member is a phone with a delivered order. Nothing is stored per
 * member: levels and balances come from orders plus the earnings,
 * redemptions and adjustments rows, so a voucher on an order that fails,
 * is cancelled or is deleted comes back by itself. Rules: loyalty-rules.ts.
 */

const change = (now: number, before: number) => (before > 0 ? Math.round(((now - before) / before) * 1000) / 10 : null);
const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null);
const ANY_AMOUNT = Number.MAX_SAFE_INTEGER;
const naira = (value: number) => `₦${Math.round(value).toLocaleString("en-NG")}`;

/**
 * orders.delivered_date is a calendar day: the start of that day in Lagos.
 * (Noon, as email-marketing-rules uses, puts a delivery made this morning
 * "in the future", so it missed every count until midday.)
 */
const deliveredMsOf = (row: { delivered_date?: string | null; created_at: string }) =>
  row.delivered_date && /^\d{4}-\d{2}-\d{2}/.test(row.delivered_date) ? Date.parse(`${row.delivered_date.slice(0, 10)}T00:00:00+01:00`) : Date.parse(row.created_at);

// ── Programs ──────────────────────────────────────────────────────────

export function programRow(row: any) {
  const type: "points" | "tier" = row.type === "tier" ? "tier" : "points";
  const points = normalizePointsConfig(row.config);
  const stored = type === "tier" ? normalizeLevels(row.config?.levels).levels : [];
  return {
    id: String(row.id), type, name: String(row.name ?? ""), description: String(row.description ?? ""),
    status: row.status as "draft" | "active" | "paused" | "archived",
    startsAt: (row.starts_at ?? null) as string | null, endsAt: (row.ends_at ?? null) as string | null,
    startsMs: row.starts_at ? Date.parse(row.starts_at) : null, endsMs: row.ends_at ? Date.parse(row.ends_at) : null,
    rate: points.rate, productIds: points.productIds, levels: type === "tier" ? (stored.length ? stored : DEFAULT_LEVELS) : ([] as Level[]),
    createdAt: String(row.created_at ?? ""), updatedAt: String(row.updated_at ?? ""), createdByName: String(row.created_by_name ?? "")
  };
}
type Program = ReturnType<typeof programRow>;

/** Turned on and not past its end. */
const isLive = (program: Program | null | undefined, nowMs: number) => !!program && program.status === "active" && (program.endsMs === null || nowMs < program.endsMs);
export const programState = (program: Program, nowMs: number) =>
  program.status === "active" ? (program.endsMs !== null && nowMs >= program.endsMs ? "ended" : "live") : program.status;
const asPointsProgram = (program: Program): PointsProgram => ({ id: program.id, status: program.status, rate: program.rate, productIds: program.productIds, startsMs: program.startsMs, endsMs: program.endsMs });

/** A branch's first visit: the design's two programs as drafts (nothing is given away until they are turned on) and three rewards. */
async function ensureLoyaltyDefaults(orgId: string, branchId: string) {
  const { data: created, error } = await supabase.from("loyalty_settings").upsert({ branch_id: branchId, org_id: orgId }, { onConflict: "branch_id", ignoreDuplicates: true }).select("branch_id");
  if (error) throw new Error(error.message);
  if (!created?.length) return;
  const { error: programError } = await supabase.from("loyalty_programs").insert([
    { org_id: orgId, branch_id: branchId, type: "tier", name: "VIP Club", description: "Levels by delivered spend: Bronze, Silver and Gold.", status: "draft", config: { levels: DEFAULT_LEVELS } },
    { org_id: orgId, branch_id: branchId, type: "points", name: "Points Rewards", description: "Earn points on every delivered order.", status: "draft", config: { rate: 1, productIds: [] } }
  ]);
  if (programError) logger.warn("loyalty: setting up the starter programs failed", { branchId, error: programError.message });
  const { error: rewardError } = await supabase.from("loyalty_rewards").insert([
    { org_id: orgId, branch_id: branchId, name: "₦500 off", points: 50, value: 500 },
    { org_id: orgId, branch_id: branchId, name: "₦1,000 off", points: 100, value: 1_000 },
    { org_id: orgId, branch_id: branchId, name: "₦2,500 off", points: 250, value: 2_500 }
  ]);
  if (rewardError) logger.warn("loyalty: setting up the starter rewards failed", { branchId, error: rewardError.message });
}

// ── One member, worked out from their rows ───────────────────────────

type RedemptionLite = { order_id: string; kind: VoucherKind; points: number; level_key: string | null; month: string | null };

function settleMember(input: {
  delivered: Array<{ amount: number; deliveredMs: number }>;
  earnings: Array<{ order_id: string; points: number }>;
  redemptions: RedemptionLite[];
  adjustments: Array<{ points: number }>;
  /** The order's status now; null = deleted (or a Silent Test order). */
  statusOf: (orderId: string) => string | null;
  levels: Level[];
  tierLive: boolean;
  tierStartMs: number | null;
  pointsLive: boolean;
  rewards: Reward[];
  nowMs: number;
}) {
  const spend = input.delivered.reduce((sum, order) => sum + order.amount, 0);
  const levelIndex = levelIndexFor(spend, input.levels);
  const before = input.tierStartMs === null ? null : input.delivered.filter((order) => order.deliveredMs < input.tierStartMs!);
  const levelIndexAtStart = before === null ? levelIndex : before.length ? levelIndexFor(before.reduce((sum, order) => sum + order.amount, 0), input.levels) : -1;
  // Points count while their order is still delivered; a voucher is spent while its order has not failed, been cancelled or been deleted.
  const earned = input.earnings.filter((row) => input.statusOf(String(row.order_id)) === "Delivered").reduce((sum, row) => sum + (Number(row.points) || 0), 0);
  const live = input.redemptions.filter((row) => { const status = input.statusOf(String(row.order_id)); return status !== null && !RETURNS_VOUCHER.has(status); });
  const spent = live.reduce((sum, row) => sum + (Number(row.points) || 0), 0);
  const adjusted = input.adjustments.reduce((sum, row) => sum + (Number(row.points) || 0), 0);
  const balance = earned - spent + adjusted;
  const options = voucherOptions({
    balance, rewards: input.rewards, pointsLive: input.pointsLive, levels: input.tierLive ? input.levels : null, levelIndex, levelIndexAtStart,
    welcomeUsed: new Set(live.filter((row) => row.kind === "welcome" && row.level_key).map((row) => row.level_key!)),
    monthlyUsed: new Set(live.filter((row) => row.kind === "monthly" && row.month).map((row) => row.month!)),
    nowMs: input.nowMs
  });
  return { spend, levelIndex, levelIndexAtStart, earned, spent, adjusted, balance, options, best: bestVoucher(options, ANY_AMOUNT, 0) };
}

// ── The branch's loyalty data (the page) ─────────────────────────────

type OrderLite = { id: string; key: string; phone: string; name: string; status: string; amount: number; productId: string | null; createdMs: number; deliveredMs: number };
type Member = ReturnType<typeof settleMember> & { key: string; name: string; phone: string; delivered: OrderLite[]; firstMs: number; lastMs: number };

async function buildWorld(orgId: string, branchId: string) {
  await ensureLoyaltyDefaults(orgId, branchId);
  const nowMs = Date.now();
  const [orderRows, programResult, rewardResult, settingsResult, earnings, redemptions, adjustments] = await Promise.all([
    fetchAllRowsOrThrow<any>(() => supabase.from("orders").select("id, phone, customer, status, amount, product_id, created_at, delivered_date")
      // launch-safe: Silent Test orders are test orders: they earn nothing and count for no level.
      .eq("org_id", orgId).eq("branch_id", branchId).neq("launch_stage", "silent").order("created_at", { ascending: true }).order("id", { ascending: true })),
    supabase.from("loyalty_programs").select("*").eq("org_id", orgId).eq("branch_id", branchId).order("created_at", { ascending: true }),
    supabase.from("loyalty_rewards").select("*").eq("org_id", orgId).eq("branch_id", branchId).order("points", { ascending: true }),
    supabase.from("loyalty_settings").select("min_order").eq("branch_id", branchId).maybeSingle(),
    fetchAllRowsOrThrow<any>(() => supabase.from("loyalty_earnings").select("order_id, phone_key, points, rate, multiplier, level_key, amount, program_ids, delivered_at, created_at")
      .eq("org_id", orgId).eq("branch_id", branchId).order("created_at", { ascending: true }).order("id", { ascending: true })),
    fetchAllRowsOrThrow<any>(() => supabase.from("loyalty_redemptions").select("*").eq("org_id", orgId).eq("branch_id", branchId).order("created_at", { ascending: true }).order("id", { ascending: true })),
    fetchAllRowsOrThrow<any>(() => supabase.from("loyalty_adjustments").select("*").eq("org_id", orgId).eq("branch_id", branchId).order("created_at", { ascending: true }).order("id", { ascending: true }))
  ]);
  for (const result of [programResult, rewardResult, settingsResult]) if (result.error) throw new Error(result.error.message);
  const programs = (programResult.data ?? []).map(programRow);
  const points = programs.find((program) => program.type === "points" && program.status !== "archived") ?? null;
  const tier = programs.find((program) => program.type === "tier" && program.status !== "archived") ?? null;
  const levels = tier?.levels ?? DEFAULT_LEVELS;
  const rewards: Reward[] = (rewardResult.data ?? []).map((row: any) => ({ id: row.id, name: row.name, points: Number(row.points) || 0, value: Number(row.value) || 0, status: row.status }));

  const orders = new Map<string, OrderLite>();
  const names = new Map<string, { name: string; phone: string }>();
  const deliveredBy = new Map<string, OrderLite[]>();
  for (const row of orderRows) {
    const key = phoneKey(row.phone);
    const order: OrderLite = {
      id: String(row.id), key, phone: String(row.phone ?? ""), name: String(row.customer ?? ""), status: String(row.status ?? ""), amount: Number(row.amount) || 0,
      productId: row.product_id ?? null, createdMs: Date.parse(row.created_at), deliveredMs: deliveredMsOf(row)
    };
    orders.set(order.id, order);
    if (!key) continue;
    if (order.name.trim()) names.set(key, { name: order.name.trim(), phone: order.phone });
    if (order.status === "Delivered") { if (!deliveredBy.has(key)) deliveredBy.set(key, []); deliveredBy.get(key)!.push(order); }
  }
  const group = <T extends { phone_key: string }>(rows: T[]) => {
    const map = new Map<string, T[]>();
    for (const row of rows) { if (!map.has(row.phone_key)) map.set(row.phone_key, []); map.get(row.phone_key)!.push(row); }
    return map;
  };
  const earningsBy = group(earnings), redemptionsBy = group(redemptions), adjustmentsBy = group(adjustments);
  const statusOf = (orderId: string) => orders.get(orderId)?.status ?? null;
  const pointsLive = isLive(points, nowMs), tierLive = isLive(tier, nowMs);
  const members = new Map<string, Member>();
  for (const [key, delivered] of deliveredBy) {
    delivered.sort((a, b) => a.deliveredMs - b.deliveredMs || a.createdMs - b.createdMs);
    const settled = settleMember({
      delivered, earnings: earningsBy.get(key) ?? [], redemptions: redemptionsBy.get(key) ?? [], adjustments: adjustmentsBy.get(key) ?? [], statusOf,
      levels, tierLive, tierStartMs: tier?.startsMs ?? null, pointsLive, rewards, nowMs
    });
    const who = names.get(key);
    members.set(key, { ...settled, key, name: who?.name || "Customer", phone: who?.phone || delivered[delivered.length - 1].phone, delivered, firstMs: delivered[0].deliveredMs, lastMs: delivered[delivered.length - 1].deliveredMs });
  }
  return {
    nowMs, orders, members, programs, points, tier, levels, rewards, pointsLive, tierLive,
    minOrder: Number(settingsResult.data?.min_order) || 0, earnings, redemptions, adjustments
  };
}
type World = Awaited<ReturnType<typeof buildWorld>>;

const worldCache = new Map<string, { at: number; world: Promise<World> }>();
const WORLD_TTL_MS = 45_000;
export const forgetLoyalty = (branchId: string) => { worldCache.delete(branchId); };
function loyaltyWorld(orgId: string, branchId: string, fresh = false): Promise<World> {
  const cached = worldCache.get(branchId);
  if (!fresh && cached && Date.now() - cached.at < WORLD_TTL_MS) return cached.world;
  const world = buildWorld(orgId, branchId);
  worldCache.set(branchId, { at: Date.now(), world });
  world.catch(() => worldCache.delete(branchId));
  return world;
}

const levelOf = (world: World, member: Member) => world.levels[member.levelIndex] ?? world.levels[0];
const voucherDto = (voucher: VoucherOption | null) => (voucher ? { kind: voucher.kind, value: voucher.value, points: voucher.points, label: voucher.label } : null);
const memberDto = (world: World, member: Member) => {
  const level = levelOf(world, member);
  return {
    key: member.key, name: member.name, phone: member.phone, levelKey: level.key, levelName: level.name, delivered: member.delivered.length, spend: member.spend,
    balance: member.balance, earned: member.earned, spent: member.spent, adjusted: member.adjusted, voucher: voucherDto(member.best), vouchers: member.options.length,
    firstAt: new Date(member.firstMs).toISOString(), lastAt: new Date(member.lastMs).toISOString()
  };
};

type Range = { fromMs: number; toMs: number };
/** When an order's points count: its delivery day, never later than when they were given. */
const earnedAtMs = (row: { delivered_at?: string | null; created_at: string }) => Math.min(Date.parse(row.delivered_at ?? row.created_at), Date.parse(row.created_at));
const inRange = (ms: number, range: Range) => ms >= range.fromMs && ms < range.toMs;
const lastMonths = (nowMs: number, n: number) => {
  const [year, month] = lagosMonth(nowMs).split("-").map(Number);
  return Array.from({ length: n }, (_, i) => { const d = new Date(Date.UTC(year, month - 1 - (n - 1 - i), 1)); return d.toISOString().slice(0, 7); });
};
/** Midnight Lagos on the 1st of the month after `month` (2026-06 → 1 Jul). */
const monthEndMs = (month: string) => {
  const [year, m] = month.split("-").map(Number);
  return Date.parse(`${new Date(Date.UTC(year, m, 1)).toISOString().slice(0, 7)}-01T00:00:00+01:00`);
};

/** The page (design 55): tiles, programs, levels, the impact card. */
export async function loyaltyPage(orgId: string, branchId: string, range: Range) {
  const world = await loyaltyWorld(orgId, branchId);
  const nowMs = Date.now();
  const length = Math.max(DAY_MS, range.toMs - range.fromMs);
  const before: Range = { fromMs: range.fromMs - length, toMs: range.fromMs };
  const members = [...world.members.values()];
  const membersAt = (atMs: number) => members.filter((member) => member.firstMs < atMs);
  const activeAt = (atMs: number) => members.filter((member) => member.delivered.some((order) => order.deliveredMs < atMs && order.deliveredMs >= atMs - 90 * DAY_MS)).length;
  const repeatAt = (atMs: number) => {
    const list = membersAt(atMs);
    return pct(list.filter((member) => member.delivered.filter((order) => order.deliveredMs < atMs).length >= 2).length, list.length);
  };
  const counted = world.earnings.filter((row) => world.orders.get(String(row.order_id))?.status === "Delivered");
  const issued = (r: Range) => counted.filter((row) => inRange(earnedAtMs(row), r)).reduce((sum, row) => sum + (Number(row.points) || 0), 0);
  const live = world.redemptions.filter((row) => { const order = world.orders.get(String(row.order_id)); return !!order && !RETURNS_VOUCHER.has(order.status); });
  const redeemed = (r: Range) => live.filter((row) => inRange(Date.parse(row.created_at), r)).reduce((sum, row) => sum + (Number(row.discount) || 0), 0);
  const revenueOf = (rows: any[]) => rows.reduce((sum, row) => { const order = world.orders.get(String(row.order_id)); return sum + (order?.status === "Delivered" ? order.amount : 0); }, 0);
  // Revenue from Loyalty: delivered repeat orders by members (their 2nd order on), the thing loyalty is there to grow.
  const repeatRevenue = (test: (ms: number) => boolean) => members.reduce((sum, member) => sum + member.delivered.slice(1).filter((order) => test(order.deliveredMs)).reduce((s, order) => s + order.amount, 0), 0);
  const repeatNow = repeatAt(range.toMs), repeatBefore = repeatAt(range.fromMs);
  const activeNow = activeAt(range.toMs);
  const earners = new Set(counted.filter((row) => Number(row.points) > 0).map((row) => row.phone_key)).size;

  return {
    live: { points: world.pointsLive, tier: world.tierLive },
    kpis: {
      members: { value: membersAt(range.toMs).length, change: change(membersAt(range.toMs).length, membersAt(range.fromMs).length) },
      active: { value: activeNow, percent: pct(activeNow, membersAt(range.toMs).length), change: change(activeNow, activeAt(range.fromMs)) },
      pointsIssued: { value: issued(range), change: change(issued(range), issued(before)) },
      redeemed: { value: redeemed(range), change: change(redeemed(range), redeemed(before)) },
      repeatRate: { value: repeatNow, changePp: repeatNow !== null && repeatBefore !== null ? Math.round((repeatNow - repeatBefore) * 10) / 10 : null }
    },
    programs: world.programs.map((program) => {
      const mine = (r: Range) => live.filter((row) => inRange(Date.parse(row.created_at), r) && (program.type === "points" ? row.kind === "reward" : row.kind !== "reward") && program.status !== "archived");
      const now = mine(range), prev = mine(before);
      return {
        id: program.id, type: program.type, name: program.name, description: program.description, status: program.status, state: programState(program, nowMs),
        startsAt: program.startsAt, endsAt: program.endsAt, rate: program.rate, productIds: program.productIds, levels: program.levels,
        members: program.type === "tier" ? members.length : earners,
        redemptions: now.length, revenue: revenueOf(now), revenueChange: change(revenueOf(now), revenueOf(prev)),
        // Used = it can no longer be deleted (its history is kept by archiving instead).
        used: program.type === "points"
          ? world.earnings.some((row) => Number(row.points) > 0 && Array.isArray(row.program_ids) && row.program_ids.includes(program.id))
          : world.redemptions.some((row) => row.program_id === program.id)
      };
    }),
    levels: world.levels.map((level, i) => ({
      ...level, members: members.filter((member) => member.levelIndex === i).length, spendText: spendText(world.levels, i), lines: levelLines(level, world.points?.rate ?? 1)
    })),
    impact: {
      revenue: { value: repeatRevenue((ms) => inRange(ms, range)), change: change(repeatRevenue((ms) => inRange(ms, range)), repeatRevenue((ms) => inRange(ms, before))) },
      repeatRate: { value: repeatNow, changePp: repeatNow !== null && repeatBefore !== null ? Math.round((repeatNow - repeatBefore) * 10) / 10 : null },
      monthly: lastMonths(nowMs, 6).map((month) => ({ month, revenue: repeatRevenue((ms) => lagosMonth(ms) === month) }))
    },
    rewards: world.rewards.map((reward) => ({
      ...reward, used: live.filter((row) => row.reward_id === reward.id).length, allTime: world.redemptions.filter((row) => row.reward_id === reward.id).length,
      canAfford: members.filter((member) => member.balance >= reward.points).length
    })),
    settings: { minOrder: world.minOrder },
    analytics: {
      months: lastMonths(nowMs, 6).map((month) => ({
        month,
        issued: counted.filter((row) => lagosMonth(earnedAtMs(row)) === month).reduce((sum, row) => sum + (Number(row.points) || 0), 0),
        used: live.filter((row) => row.kind === "reward" && lagosMonth(Date.parse(row.created_at)) === month).reduce((sum, row) => sum + (Number(row.points) || 0), 0),
        // As at the end of the month (this month: as at now).
        repeatRate: repeatAt(Math.min(nowMs, monthEndMs(month))),
        voucherNaira: live.filter((row) => lagosMonth(Date.parse(row.created_at)) === month).reduce((sum, row) => sum + (Number(row.discount) || 0), 0)
      })),
      top: [...members].sort((a, b) => b.spend - a.spend).slice(0, 10).map((member) => memberDto(world, member)),
      outstanding: members.reduce((sum, member) => sum + Math.max(0, member.balance), 0),
      withVoucher: members.filter((member) => member.best).length
    }
  };
}

// ── Members, one member, the points history ──────────────────────────

export async function loyaltyMembers(orgId: string, branchId: string, q: { query: string; level: string; voucher: boolean; sort: string; page: number; all: boolean }) {
  const world = await loyaltyWorld(orgId, branchId);
  const text = q.query.trim().toLowerCase(), digits = q.query.replace(/\D/g, "");
  let list = [...world.members.values()];
  if (text) list = list.filter((member) => member.name.toLowerCase().includes(text) || (digits.length >= 3 && member.phone.replace(/\D/g, "").includes(digits)));
  if (q.level) list = list.filter((member) => levelOf(world, member).key === q.level);
  if (q.voucher) list = list.filter((member) => member.best);
  const by: Record<string, (a: Member, b: Member) => number> = {
    spend: (a, b) => b.spend - a.spend, points: (a, b) => b.balance - a.balance, orders: (a, b) => b.delivered.length - a.delivered.length, recent: (a, b) => b.lastMs - a.lastMs
  };
  list.sort(by[q.sort] ?? by.spend);
  const perPage = 20;
  const pages = Math.max(1, Math.ceil(list.length / perPage));
  const page = Math.min(Math.max(1, q.page), pages);
  return {
    total: list.length, page, pages,
    rows: (q.all ? list : list.slice((page - 1) * perPage, page * perPage)).map((member) => memberDto(world, member)),
    levels: world.levels.map((level, i) => ({ key: level.key, name: level.name, members: [...world.members.values()].filter((member) => member.levelIndex === i).length }))
  };
}

type LedgerRow = { id: string; at: string; kind: "earned" | "used" | "added" | "removed"; key: string; points: number; discount: number; orderId: string | null; note: string; counted: boolean };

function ledgerRows(world: World): LedgerRow[] {
  const rows: LedgerRow[] = [];
  const levelName = (key: string | null) => world.levels.find((level) => level.key === key)?.name ?? null;
  const rewardName = new Map(world.rewards.map((reward) => [reward.id, reward.name]));
  for (const row of world.earnings) {
    if (!(Number(row.points) > 0)) continue;
    const counted = world.orders.get(String(row.order_id))?.status === "Delivered";
    const name = levelName(row.level_key);
    rows.push({
      id: `e:${row.order_id}`, at: new Date(earnedAtMs(row)).toISOString(), kind: "earned", key: row.phone_key, points: Number(row.points), discount: 0, orderId: String(row.order_id),
      note: counted ? `${Number(row.rate)} per ₦1,000${Number(row.multiplier) !== 1 ? ` × ${Number(row.multiplier)}` : ""}${name ? ` (${name})` : ""}` : "Not counted: the order is no longer delivered", counted
    });
  }
  for (const row of world.redemptions) {
    const order = world.orders.get(String(row.order_id));
    const back = !order || RETURNS_VOUCHER.has(order.status);
    const label = row.kind === "reward" ? `reward for ${row.points} points${rewardName.get(row.reward_id) && !/^₦/.test(rewardName.get(row.reward_id)!) ? ` (${rewardName.get(row.reward_id)})` : ""}` : `${levelName(row.level_key) ?? "Level"} ${row.kind === "welcome" ? "welcome" : "monthly"} voucher`;
    rows.push({
      id: `r:${row.order_id}`, at: row.created_at, kind: "used", key: row.phone_key, points: Number(row.points) > 0 ? -Number(row.points) : 0, discount: Number(row.discount) || 0, orderId: String(row.order_id),
      note: back ? `${label}. Given back: the order ${order ? `is ${order.status.toLowerCase()}` : "was deleted"}` : `${naira(Number(row.discount) || 0)} off: ${label}`, counted: !back
    });
  }
  for (const row of world.adjustments) {
    rows.push({ id: `a:${row.id}`, at: row.created_at, kind: Number(row.points) > 0 ? "added" : "removed", key: row.phone_key, points: Number(row.points) || 0, discount: 0, orderId: null, note: `${row.reason}${row.created_by_name ? ` (by ${row.created_by_name})` : ""}`, counted: true });
  }
  return rows.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

const withWho = (world: World, row: LedgerRow) => { const member = world.members.get(row.key); return { ...row, name: member?.name ?? "Customer", phone: member?.phone ?? "" }; };

export async function memberHistory(orgId: string, branchId: string, key: string) {
  const world = await loyaltyWorld(orgId, branchId);
  const member = world.members.get(key);
  if (!member) throw new EmailMarketingError(404, "Member not found.");
  return {
    member: { ...memberDto(world, member), next: nextLevel(member.spend, world.levels), options: member.options.map(voucherDto) },
    orders: [...member.delivered].reverse().map((order) => ({ id: order.id, amount: order.amount, deliveredAt: new Date(order.deliveredMs).toISOString() })),
    ledger: ledgerRows(world).filter((row) => row.key === key).map((row) => withWho(world, row))
  };
}

export async function loyaltyTransactions(orgId: string, branchId: string, range: Range, q: { kind: string; query: string; page: number; all: boolean }) {
  const world = await loyaltyWorld(orgId, branchId);
  const inPeriod = ledgerRows(world).filter((row) => inRange(Date.parse(row.at), range));
  const summary = {
    earned: inPeriod.filter((row) => row.kind === "earned" && row.counted).reduce((sum, row) => sum + row.points, 0),
    used: inPeriod.filter((row) => row.kind === "used" && row.counted).reduce((sum, row) => sum - row.points, 0),
    givenBack: inPeriod.filter((row) => row.kind === "used" && !row.counted).reduce((sum, row) => sum - row.points, 0),
    adjusted: inPeriod.filter((row) => row.kind === "added" || row.kind === "removed").reduce((sum, row) => sum + row.points, 0)
  };
  const text = q.query.trim().toLowerCase(), digits = q.query.replace(/\D/g, "");
  let rows = inPeriod.map((row) => withWho(world, row));
  if (q.kind === "adjusted") rows = rows.filter((row) => row.kind === "added" || row.kind === "removed");
  else if (q.kind) rows = rows.filter((row) => row.kind === q.kind);
  if (text) rows = rows.filter((row) => row.name.toLowerCase().includes(text) || (row.orderId ?? "").toLowerCase().includes(text) || (digits.length >= 3 && row.phone.replace(/\D/g, "").includes(digits)));
  const perPage = 25;
  const pages = Math.max(1, Math.ceil(rows.length / perPage));
  const page = Math.min(Math.max(1, q.page), pages);
  return { summary, total: rows.length, page, pages, rows: q.all ? rows : rows.slice((page - 1) * perPage, page * perPage) };
}

// ── Saving ────────────────────────────────────────────────────────────

export type ProgramInput = { type: "points" | "tier"; name: string; description: string; rate: number; productIds: string[]; levels: unknown; endsAt: string | null; status: "draft" | "active" };

export async function saveProgram(orgId: string, branchId: string, user: { id: string; name?: string | null }, id: string | null, input: ProgramInput) {
  let config: Record<string, unknown>;
  if (input.type === "tier") {
    const { levels, problem } = normalizeLevels(input.levels);
    if (problem) throw new EmailMarketingError(400, problem);
    config = { levels };
  } else {
    const points = normalizePointsConfig({ rate: input.rate, productIds: input.productIds });
    if (points.productIds.length) {
      const { data } = await supabase.from("products").select("id").eq("org_id", orgId).in("id", points.productIds);
      if ((data ?? []).length !== points.productIds.length) throw new EmailMarketingError(400, "One of the products was not found.");
    }
    config = points;
  }
  if (input.endsAt && Date.parse(input.endsAt) <= Date.now()) throw new EmailMarketingError(400, "The end date has to be in the future.");
  const nowIso = new Date().toISOString();
  const columns = { name: input.name, description: input.description, config, ends_at: input.endsAt, updated_at: nowIso };
  const taken = input.type === "tier" ? "This branch already has VIP levels. Edit them on the Tiers (VIP) tab." : "This branch already has a points program. Edit it instead.";
  if (id) {
    const { data, error } = await supabase.from("loyalty_programs").update(columns).eq("org_id", orgId).eq("branch_id", branchId).eq("id", id).eq("type", input.type).select("id").maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new EmailMarketingError(404, "Program not found.");
    forgetLoyalty(branchId);
    return id;
  }
  const { data, error } = await supabase.from("loyalty_programs").insert({
    ...columns, type: input.type, status: input.status, starts_at: input.status === "active" ? nowIso : null, org_id: orgId, branch_id: branchId, created_by: user.id, created_by_name: user.name ?? ""
  }).select("id").single();
  if (error) throw error.code === "23505" ? new EmailMarketingError(409, taken) : new Error(error.message);
  forgetLoyalty(branchId);
  return data.id as string;
}

export async function setProgramStatus(orgId: string, branchId: string, id: string, action: "launch" | "pause" | "resume" | "archive" | "unarchive") {
  const { data: row, error: readError } = await supabase.from("loyalty_programs").select("id, starts_at").eq("org_id", orgId).eq("branch_id", branchId).eq("id", id).maybeSingle();
  if (readError) throw new Error(readError.message);
  if (!row) throw new EmailMarketingError(404, "Program not found.");
  const status = action === "pause" ? "paused" : action === "archive" ? "archived" : action === "unarchive" ? "paused" : "active";
  const nowIso = new Date().toISOString();
  // The first switch-on sets the start: points count from that day, welcome vouchers only for levels reached after it.
  const patch = { status, updated_at: nowIso, ...(status === "active" && !row.starts_at ? { starts_at: nowIso } : {}) };
  const { error } = await supabase.from("loyalty_programs").update(patch).eq("org_id", orgId).eq("branch_id", branchId).eq("id", id);
  if (error) throw error.code === "23505" ? new EmailMarketingError(409, "There is already one of these. Archive the other one first.") : new Error(error.message);
  forgetLoyalty(branchId);
}

export async function deleteProgram(orgId: string, branchId: string, id: string) {
  const [{ count: earned }, { count: vouchers }] = await Promise.all([
    supabase.from("loyalty_earnings").select("id", { count: "exact", head: true }).eq("branch_id", branchId).gt("points", 0).contains("program_ids", [id]),
    supabase.from("loyalty_redemptions").select("id", { count: "exact", head: true }).eq("branch_id", branchId).eq("program_id", id)
  ]);
  if (earned || vouchers) throw new EmailMarketingError(409, "Members have earned or used this program. Archive it instead, so their history is kept.");
  const { error } = await supabase.from("loyalty_programs").delete().eq("org_id", orgId).eq("branch_id", branchId).eq("id", id);
  if (error) throw new Error(error.message);
  forgetLoyalty(branchId);
}

export type RewardInput = { name: string; points: number; value: number; status: "active" | "paused" };

export async function saveReward(orgId: string, branchId: string, id: string | null, input: RewardInput) {
  const columns = { name: input.name, points: Math.round(input.points), value: Math.round(input.value), updated_at: new Date().toISOString() };
  if (id) {
    const { data, error } = await supabase.from("loyalty_rewards").update(columns).eq("org_id", orgId).eq("branch_id", branchId).eq("id", id).select("id").maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new EmailMarketingError(404, "Reward not found.");
    forgetLoyalty(branchId);
    return id;
  }
  const { data, error } = await supabase.from("loyalty_rewards").insert({ ...columns, status: input.status, org_id: orgId, branch_id: branchId }).select("id").single();
  if (error) throw new Error(error.message);
  forgetLoyalty(branchId);
  return data.id as string;
}

export async function setRewardStatus(orgId: string, branchId: string, id: string, action: "pause" | "resume" | "archive" | "unarchive") {
  const status = action === "pause" || action === "unarchive" ? "paused" : action === "archive" ? "archived" : "active";
  const { data, error } = await supabase.from("loyalty_rewards").update({ status, updated_at: new Date().toISOString() }).eq("org_id", orgId).eq("branch_id", branchId).eq("id", id).select("id").maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new EmailMarketingError(404, "Reward not found.");
  forgetLoyalty(branchId);
}

export async function deleteReward(orgId: string, branchId: string, id: string) {
  const { count } = await supabase.from("loyalty_redemptions").select("id", { count: "exact", head: true }).eq("branch_id", branchId).eq("reward_id", id);
  if (count) throw new EmailMarketingError(409, "Members have used this reward. Archive it instead, so their history is kept.");
  const { error } = await supabase.from("loyalty_rewards").delete().eq("org_id", orgId).eq("branch_id", branchId).eq("id", id);
  if (error) throw new Error(error.message);
  forgetLoyalty(branchId);
}

export async function saveLoyaltySettings(orgId: string, branchId: string, input: { minOrder: number }) {
  const { error } = await supabase.from("loyalty_settings").upsert({ branch_id: branchId, org_id: orgId, min_order: Math.max(0, Math.round(input.minOrder)), updated_at: new Date().toISOString() }, { onConflict: "branch_id" });
  if (error) throw new Error(error.message);
  forgetLoyalty(branchId);
}

/** Points added or taken away by hand, always with a reason. */
export async function adjustPoints(orgId: string, branchId: string, user: { id: string; name?: string | null }, input: { key: string; points: number; reason: string }) {
  const world = await loyaltyWorld(orgId, branchId, true);
  if (!world.members.has(input.key)) throw new EmailMarketingError(404, "Member not found.");
  const { error } = await supabase.from("loyalty_adjustments").insert({
    org_id: orgId, branch_id: branchId, phone_key: input.key, points: Math.round(input.points), reason: input.reason, created_by: user.id, created_by_name: user.name ?? ""
  });
  if (error) throw new Error(error.message);
  forgetLoyalty(branchId);
}

// ── Points for delivered orders (every 10 minutes) ───────────────────

/**
 * Gives each newly delivered order its points, once. An order delivered on
 * or after the points program's start day earns from the program as it is
 * when the order is first seen (a paused program gives 0, kept as 0), at the
 * member's level BEFORE that order.
 */
export async function runLoyaltyEarning() {
  const { data, error } = await supabase.from("loyalty_programs").select("*").eq("type", "points").neq("status", "archived").not("starts_at", "is", null);
  if (error) throw new Error(error.message);
  let given = 0;
  for (const row of data ?? []) {
    try { given += await earnBranch(String(row.org_id), String(row.branch_id), programRow(row)); }
    catch (err) { logger.warn("loyalty: giving points failed", { branchId: row.branch_id, error: (err as Error).message }); }
  }
  return given;
}

const ORDER_COLUMNS = "id, phone, amount, product_id, created_at, delivered_date";

async function earnBranch(orgId: string, branchId: string, program: Program) {
  const startMs = lagosDayStart(program.startsMs!);
  const [dated, undated] = await Promise.all([
    // launch-safe: Silent Test orders are test orders and earn nothing.
    fetchAllRowsOrThrow<any>(() => supabase.from("orders").select(ORDER_COLUMNS).eq("org_id", orgId).eq("branch_id", branchId).eq("status", "Delivered").neq("launch_stage", "silent")
      .gte("delivered_date", lagosDay(startMs)).order("id", { ascending: true })),
    fetchAllRowsOrThrow<any>(() => supabase.from("orders").select(ORDER_COLUMNS).eq("org_id", orgId).eq("branch_id", branchId).eq("status", "Delivered").neq("launch_stage", "silent")
      .is("delivered_date", null).gte("created_at", new Date(startMs).toISOString()).order("id", { ascending: true }))
  ]);
  const candidates = [...dated, ...undated];
  if (!candidates.length) return 0;
  const done = new Set((await selectByIdBatches<any>(candidates.map((row) => String(row.id)), (batch) => supabase.from("loyalty_earnings").select("order_id").in("order_id", batch))).map((row) => String(row.order_id)));
  const fresh = candidates.filter((row) => !done.has(String(row.id))).slice(0, 300);
  if (!fresh.length) return 0;
  const { data: tierRow } = await supabase.from("loyalty_programs").select("*").eq("org_id", orgId).eq("branch_id", branchId).eq("type", "tier").eq("status", "active").maybeSingle();
  const levels = tierRow ? programRow(tierRow).levels : null;
  const history = new Map<string, Array<{ id: string; amount: number; deliveredMs: number; createdMs: number }>>();
  const deliveredOf = async (key: string) => {
    if (history.has(key)) return history.get(key)!;
    const { data: rows, error } = await supabase.from("orders").select("id, phone, amount, created_at, delivered_date")
      // launch-safe: one customer's own delivered orders, for their level (Silent Test orders left out).
      .eq("org_id", orgId).eq("branch_id", branchId).eq("status", "Delivered").neq("launch_stage", "silent").like("phone", `%${key.slice(-10)}`).limit(1000);
    if (error) throw new Error(error.message);
    const list = (rows ?? []).filter((row: any) => phoneKey(row.phone) === key).map((row: any) => ({ id: String(row.id), amount: Number(row.amount) || 0, deliveredMs: deliveredMsOf(row), createdMs: Date.parse(row.created_at) }));
    history.set(key, list);
    return list;
  };
  let given = 0;
  for (const row of fresh) {
    const key = phoneKey(row.phone);
    const atMs = deliveredMsOf(row), createdMs = Date.parse(row.created_at);
    let multiplier = 1, levelKey: string | null = null;
    if (key && levels) {
      // The level before this order: the order that lifts someone to Silver still earns at Bronze.
      const spendBefore = (await deliveredOf(key)).filter((order) => order.id !== String(row.id) && (order.deliveredMs < atMs || (order.deliveredMs === atMs && order.createdMs < createdMs)))
        .reduce((sum, order) => sum + order.amount, 0);
      const level = levels[levelIndexFor(spendBefore, levels)];
      multiplier = level.multiplier; levelKey = level.key;
    }
    const earning = key ? earningFor({ amount: Number(row.amount) || 0, productId: row.product_id ?? null, atMs }, [asPointsProgram(program)], multiplier) : { points: 0, rate: 0, programIds: [] as string[] };
    const { error } = await supabase.from("loyalty_earnings").insert({
      org_id: orgId, branch_id: branchId, order_id: String(row.id), phone_key: key, points: earning.points, rate: earning.rate, multiplier, level_key: levelKey,
      amount: Number(row.amount) || 0, program_ids: earning.programIds, delivered_at: new Date(atMs).toISOString()
    });
    if (error && error.code !== "23505") throw new Error(error.message);
    if (!error && earning.points > 0) given += 1;
  }
  if (given) forgetLoyalty(branchId);
  return given;
}

// ── At order save: the voucher comes off by itself (Bright) ──────────

/** One member, read fresh (order save and email sending). Null = not a member, or loyalty is off. */
async function memberStateFor(orgId: string, branchId: string, key: string, nowMs: number) {
  const { data: programRows, error } = await supabase.from("loyalty_programs").select("*").eq("org_id", orgId).eq("branch_id", branchId).eq("status", "active");
  if (error) throw new Error(error.message);
  const programs = (programRows ?? []).map(programRow);
  const points = programs.find((program) => program.type === "points" && isLive(program, nowMs)) ?? null;
  const tier = programs.find((program) => program.type === "tier") ?? null;
  if (!points && !tier) return null;
  const [deliveredResult, earningsResult, redemptionsResult, adjustmentsResult, rewardsResult, settingsResult] = await Promise.all([
    supabase.from("orders").select("id, phone, amount, created_at, delivered_date")
      // launch-safe: one customer's own delivered orders, for their level (Silent Test orders left out).
      .eq("org_id", orgId).eq("branch_id", branchId).eq("status", "Delivered").neq("launch_stage", "silent").like("phone", `%${key.slice(-10)}`).limit(1000),
    supabase.from("loyalty_earnings").select("order_id, points").eq("branch_id", branchId).eq("phone_key", key),
    supabase.from("loyalty_redemptions").select("order_id, kind, points, level_key, month").eq("branch_id", branchId).eq("phone_key", key),
    supabase.from("loyalty_adjustments").select("points").eq("branch_id", branchId).eq("phone_key", key),
    supabase.from("loyalty_rewards").select("id, name, points, value, status").eq("branch_id", branchId).eq("status", "active"),
    supabase.from("loyalty_settings").select("min_order").eq("branch_id", branchId).maybeSingle()
  ]);
  for (const result of [deliveredResult, earningsResult, redemptionsResult, adjustmentsResult, rewardsResult, settingsResult]) if (result.error) throw new Error(result.error.message);
  const delivered = (deliveredResult.data ?? []).filter((row: any) => phoneKey(row.phone) === key)
    .map((row: any) => ({ amount: Number(row.amount) || 0, deliveredMs: deliveredMsOf(row) }));
  // Not a member yet: their first delivered order makes them one (and earns), the next order can use a voucher.
  if (!delivered.length) return null;
  const earnings = (earningsResult.data ?? []) as Array<{ order_id: string; points: number }>;
  const redemptions = (redemptionsResult.data ?? []) as RedemptionLite[];
  const ids = [...new Set([...earnings.map((row) => String(row.order_id)), ...redemptions.map((row) => String(row.order_id))])];
  const statusRows = ids.length ? await selectByIdBatches<any>(ids, (batch) => supabase.from("orders").select("id, status").neq("launch_stage", "silent").in("id", batch)) : [];
  const status = new Map(statusRows.map((row) => [String(row.id), String(row.status)]));
  const levels = tier?.levels ?? DEFAULT_LEVELS;
  const rewards: Reward[] = (rewardsResult.data ?? []).map((row: any) => ({ id: row.id, name: row.name, points: Number(row.points) || 0, value: Number(row.value) || 0, status: row.status }));
  const settled = settleMember({
    delivered, earnings, redemptions, adjustments: (adjustmentsResult.data ?? []) as Array<{ points: number }>, statusOf: (id) => status.get(id) ?? null,
    levels, tierLive: !!tier, tierStartMs: tier?.startsMs ?? null, pointsLive: !!points, rewards, nowMs
  });
  return { ...settled, levels, tier, points, minOrder: Number(settingsResult.data?.min_order) || 0 };
}

export type AppliedLoyalty = {
  orgId: string; branchId: string; key: string; kind: VoucherKind; rewardId: string | null; programId: string | null; levelKey: string | null; month: string | null;
  points: number; discount: number; note: string;
};

/**
 * At order save (order form and cart auto-submit): the voucher this member's
 * order gets, worked out on the server. Never throws: an order is always
 * saved, at full price when anything is off.
 */
export async function applyLoyalty(input: { orgId: string; productId: string | null; phone: unknown; amount: number }): Promise<AppliedLoyalty | null> {
  try {
    const key = phoneKey(input.phone);
    if (!key || !input.productId || !(input.amount > 0)) return null;
    const { data: product } = await supabase.from("products").select("branch_id").eq("id", input.productId).eq("org_id", input.orgId).maybeSingle();
    const branchId = product?.branch_id ? String(product.branch_id) : null;
    if (!branchId) return null;
    const state = await memberStateFor(input.orgId, branchId, key, Date.now());
    if (!state) return null;
    const best = bestVoucher(state.options, input.amount, state.minOrder);
    if (!best) return null;
    return {
      orgId: input.orgId, branchId, key, kind: best.kind, rewardId: best.rewardId, programId: best.kind === "reward" ? state.points?.id ?? null : state.tier?.id ?? null,
      levelKey: best.levelKey, month: best.month, points: best.points, discount: best.discount, note: voucherNote(best)
    };
  } catch (error) {
    logger.warn("loyalty check failed: order saved at full price", { error: (error as Error).message });
    return null;
  }
}

/** After the order is saved: the voucher is marked used (once per order). */
export async function recordLoyaltyRedemption(applied: AppliedLoyalty, orderId: string, amountBefore: number) {
  const { error } = await supabase.from("loyalty_redemptions").upsert({
    org_id: applied.orgId, branch_id: applied.branchId, order_id: String(orderId), phone_key: applied.key, kind: applied.kind, reward_id: applied.rewardId,
    program_id: applied.programId, level_key: applied.levelKey, month: applied.month, points: applied.points, discount: applied.discount, amount_before: amountBefore
  }, { onConflict: "order_id", ignoreDuplicates: true });
  if (error) logger.warn("loyalty: saving the voucher use failed", { orderId, error: error.message });
  forgetLoyalty(applied.branchId);
}

/** The order fields for a used voucher (orders.amount is the lower amount). */
export const loyaltyColumns = (applied: AppliedLoyalty | null) => (applied ? { loyalty_discount: applied.discount, loyalty_note: applied.note } : {});

/** {{Points}}, {{Level}}, {{Voucher}}, {{Next Level}} for one email. Null = not a member (the email shows plain fallbacks). */
export async function loyaltyTagsFor(orgId: string, branchId: string, phone: unknown) {
  try {
    const key = phoneKey(phone);
    if (!key) return null;
    const state = await memberStateFor(orgId, branchId, key, Date.now());
    if (!state) return null;
    return loyaltyTagText({ balance: state.balance, levelName: state.levels[state.levelIndex]?.name ?? null, voucher: state.best, next: nextLevel(state.spend, state.levels) });
  } catch (error) {
    logger.warn("loyalty: email tags failed", { error: (error as Error).message });
    return null;
  }
}
