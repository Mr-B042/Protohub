/**
 * Loyalty & Rewards (Bright's design 55, 8 Nov 2026): levels, points and
 * which voucher an order gets. Pure; tested in loyalty-rules.test.ts.
 *
 * Bright's calls: a voucher comes off by itself when a member orders again
 * with the same phone (no code box), levels come from past delivered spend,
 * and points count from the day a points program is turned on.
 */

const LAGOS_OFFSET_MS = 60 * 60_000;
export const lagosMonth = (ms: number) => new Date(ms + LAGOS_OFFSET_MS).toISOString().slice(0, 7);
/** Midnight in Lagos of the day `ms` falls on. */
export const lagosDayStart = (ms: number) => Date.parse(`${new Date(ms + LAGOS_OFFSET_MS).toISOString().slice(0, 10)}T00:00:00+01:00`);

const naira = (value: number) => `₦${Math.round(value).toLocaleString("en-NG")}`;
const pointsText = (value: number) => (Number.isInteger(value) ? String(value) : value.toFixed(1));

// ── Levels ────────────────────────────────────────────────────────────

export type Level = {
  key: string;
  name: string;
  /** Lifetime delivered spend (naira) to reach this level. The first level starts at 0. */
  minSpend: number;
  /** Points are multiplied by this at this level (Silver earns 2 for every 1). */
  multiplier: number;
  /** Naira off the next order, once, for reaching this level. */
  welcomeVoucher: number;
  /** Naira off one order each month while at this level. */
  monthlyVoucher: number;
  /** Extra lines written by the business (shown on the level card). */
  perks: string[];
};

/** Bright's design 55. Starts as a draft: nothing is given away until it is turned on. */
export const DEFAULT_LEVELS: Level[] = [
  { key: "bronze", name: "Bronze", minSpend: 0, multiplier: 1, welcomeVoucher: 0, monthlyVoucher: 0, perks: [] },
  { key: "silver", name: "Silver", minSpend: 50_000, multiplier: 2, welcomeVoucher: 1_000, monthlyVoucher: 0, perks: [] },
  { key: "gold", name: "Gold (VIP)", minSpend: 200_000, multiplier: 3, welcomeVoucher: 0, monthlyVoucher: 2_500, perks: [] }
];

const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 24) || "level";
const money = (raw: unknown, max = 10_000_000) => Math.min(max, Math.max(0, Math.round(Number(raw) || 0)));

/** Cleans levels from the browser. Keys stay as they were, so renaming a level never hands out its welcome voucher twice. */
export function normalizeLevels(raw: unknown): { levels: Level[]; problem: string | null } {
  const list = Array.isArray(raw) ? raw : [];
  if (list.length < 2) return { levels: [], problem: "Add at least 2 levels." };
  if (list.length > 5) return { levels: [], problem: "Keep it to 5 levels or fewer." };
  const used = new Set<string>();
  const levels: Level[] = [];
  for (const item of list) {
    const name = String(item?.name ?? "").trim().replace(/\s+/g, " ").slice(0, 30);
    if (!name) return { levels: [], problem: "Every level needs a name." };
    const multiplier = Math.round(Number(item?.multiplier ?? 1) * 10) / 10;
    let key = typeof item?.key === "string" && /^[a-z0-9_]{1,24}$/.test(item.key) ? item.key : slug(name);
    for (let n = 2; used.has(key); n += 1) key = `${slug(name).slice(0, 21)}_${n}`;
    used.add(key);
    levels.push({
      key, name, minSpend: money(item?.minSpend, 1_000_000_000),
      multiplier: Number.isFinite(multiplier) ? Math.min(10, Math.max(0.5, multiplier)) : 1,
      welcomeVoucher: money(item?.welcomeVoucher, 1_000_000), monthlyVoucher: money(item?.monthlyVoucher, 1_000_000),
      perks: (Array.isArray(item?.perks) ? item.perks : []).map((perk: unknown) => String(perk ?? "").trim().slice(0, 60)).filter(Boolean).slice(0, 6)
    });
  }
  levels.sort((a, b) => a.minSpend - b.minSpend);
  levels[0].minSpend = 0;
  for (let i = 1; i < levels.length; i += 1) {
    if (levels[i].minSpend === levels[i - 1].minSpend) return { levels: [], problem: "Two levels can't start at the same spend." };
  }
  return { levels, problem: null };
}

/** The level a lifetime delivered spend sits at (0 = the first level). */
export function levelIndexFor(spend: number, levels: Level[]) {
  let index = 0;
  levels.forEach((level, i) => { if (spend >= level.minSpend) index = i; });
  return index;
}

/** "Spend ₦50,000 – ₦199,999" (the last level: "Spend ₦200,000+"). */
export function spendText(levels: Level[], index: number) {
  const next = levels[index + 1];
  return next ? `Spend ${naira(levels[index].minSpend)} – ${naira(next.minSpend - 1)}` : `Spend ${naira(levels[index].minSpend)}+`;
}

/** The card lines: what the numbers give, then the business's own lines. */
export function levelLines(level: Level, baseRate: number) {
  const lines: string[] = [];
  const rate = baseRate * level.multiplier;
  if (rate > 0) lines.push(`Earn ${pointsText(rate)} ${rate === 1 ? "point" : "points"} per ₦1,000`);
  if (level.welcomeVoucher > 0) lines.push(`${naira(level.welcomeVoucher)} welcome voucher`);
  if (level.monthlyVoucher > 0) lines.push(`${naira(level.monthlyVoucher)} monthly voucher`);
  return [...lines, ...level.perks];
}

/** How far a member is from the next level; null at the top. */
export function nextLevel(spend: number, levels: Level[]) {
  const index = levelIndexFor(spend, levels);
  const next = levels[index + 1];
  return next ? { name: next.name, gap: Math.max(0, next.minSpend - spend) } : null;
}

// ── Points ────────────────────────────────────────────────────────────

export type PointsProgram = { id: string; status: string; rate: number; productIds: string[]; startsMs: number | null; endsMs: number | null };

export function normalizePointsConfig(raw: any) {
  const rate = Math.round(Number(raw?.rate ?? 1) * 100) / 100;
  return {
    rate: Number.isFinite(rate) ? Math.min(100, Math.max(0.1, rate)) : 1,
    productIds: (Array.isArray(raw?.productIds) ? raw.productIds : []).map(String).filter((id: string) => /^[0-9a-f-]{36}$/i.test(id)).slice(0, 200) as string[]
  };
}

/** Turned on, and `atMs` falls between its start day (Lagos) and its end. */
export const programRunning = (program: Pick<PointsProgram, "status" | "startsMs" | "endsMs">, atMs: number) =>
  program.status === "active" && program.startsMs !== null && atMs >= lagosDayStart(program.startsMs) && (program.endsMs === null || atMs < program.endsMs);

/** "1 point per ₦1,000": whole thousands only (₦30,500 → 30), times the rate and the level's multiplier. */
export function pointsFor(amount: number, rate: number, multiplier: number) {
  if (!(amount > 0) || !(rate > 0) || !(multiplier > 0)) return 0;
  return Math.floor(Math.floor(amount / 1000) * rate * multiplier + 1e-9);
}

/** What a delivered order earns: every running points program that covers its product adds its rate. */
export function earningFor(order: { amount: number; productId: string | null; atMs: number }, programs: PointsProgram[], multiplier: number) {
  const covering = programs.filter((program) => programRunning(program, order.atMs) && (!program.productIds.length || (!!order.productId && program.productIds.includes(order.productId))));
  const rate = Math.round(covering.reduce((sum, program) => sum + program.rate, 0) * 100) / 100;
  return { points: pointsFor(order.amount, rate, multiplier), rate, programIds: covering.map((program) => program.id) };
}

// ── Vouchers ──────────────────────────────────────────────────────────

/** A voucher on an order that ends like this comes back to the member. */
export const RETURNS_VOUCHER = new Set(["Failed", "Cancelled"]);

export type Reward = { id: string; name: string; points: number; value: number; status: string };
export type VoucherKind = "reward" | "welcome" | "monthly";
export type VoucherOption = { kind: VoucherKind; value: number; points: number; rewardId: string | null; levelKey: string | null; month: string | null; label: string };

/** Every voucher a member could use right now. */
export function voucherOptions(input: {
  balance: number;
  rewards: Reward[];
  /** A points program is turned on (points can be spent). */
  pointsLive: boolean;
  /** The VIP levels, when turned on. */
  levels: Level[] | null;
  levelIndex: number;
  /** The level when the VIP levels were turned on; -1 = not a customer yet then. */
  levelIndexAtStart: number;
  welcomeUsed: Set<string>;
  monthlyUsed: Set<string>;
  nowMs: number;
}): VoucherOption[] {
  const options: VoucherOption[] = [];
  if (input.pointsLive) {
    for (const reward of input.rewards) {
      if (reward.status === "active" && reward.points > 0 && reward.points <= input.balance) {
        // "reward for 100 points"; a name that isn't just the amount ("Free delivery") is added.
        const named = reward.name.trim() && !/^₦/.test(reward.name.trim()) ? ` (${reward.name.trim()})` : "";
        options.push({ kind: "reward", value: reward.value, points: reward.points, rewardId: reward.id, levelKey: null, month: null, label: `reward for ${reward.points} points${named}` });
      }
    }
  }
  const levels = input.levels;
  if (levels && levels[input.levelIndex]) {
    // Welcome vouchers only for levels reached after the levels were turned
    // on, so the day they start costs nothing. Jumping two levels earns both.
    for (let i = Math.max(-1, input.levelIndexAtStart) + 1; i <= input.levelIndex; i += 1) {
      const level = levels[i];
      if (level && level.welcomeVoucher > 0 && !input.welcomeUsed.has(level.key)) {
        options.push({ kind: "welcome", value: level.welcomeVoucher, points: 0, rewardId: null, levelKey: level.key, month: null, label: `${level.name} welcome voucher` });
      }
    }
    const level = levels[input.levelIndex];
    const month = lagosMonth(input.nowMs);
    if (level.monthlyVoucher > 0 && !input.monthlyUsed.has(month)) {
      options.push({ kind: "monthly", value: level.monthlyVoucher, points: 0, rewardId: null, levelKey: level.key, month, label: `${level.name} monthly voucher` });
    }
  }
  return options;
}

/** One voucher per order: the one that takes the most off (a tie goes to the one that costs no points). */
export function bestVoucher(options: VoucherOption[], amount: number, minOrder: number) {
  if (!(amount > 0) || amount < minOrder) return null;
  let best: (VoucherOption & { discount: number }) | null = null;
  for (const option of options) {
    const discount = Math.min(amount, Math.round(option.value));
    if (discount <= 0) continue;
    if (!best || discount > best.discount || (discount === best.discount && option.points < best.points)) best = { ...option, discount };
  }
  return best;
}

/** The line on the order the rep reads out: "₦1,000 off: Silver welcome voucher". */
export const voucherNote = (voucher: { discount: number; label: string }) => `${naira(voucher.discount)} off: ${voucher.label}`;

/** {{Points}}, {{Level}}, {{Voucher}}, {{Next Level}} in an email. */
export function loyaltyTagText(state: { balance: number; levelName: string | null; voucher: VoucherOption | null; next: { name: string; gap: number } | null }) {
  return {
    points: Math.max(0, Math.round(state.balance)).toLocaleString("en-NG"),
    level: state.levelName ?? "Member",
    voucher: state.voucher ? `${naira(state.voucher.value)} off` : "no voucher yet",
    nextLevel: state.next ? `${naira(state.next.gap)} more to reach ${state.next.name}` : "already at the top level"
  };
}
