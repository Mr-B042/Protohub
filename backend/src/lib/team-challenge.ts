// Team Challenges (Bright, 3 Oct 2026) - the rules, kept pure so they can be
// tested on their own.
//
// SCORE: one order = one score from its added contribution (below).
// RACE: a team's milestone time is the qualification time (the later of
// delivered and paid) of the verified order that takes its running total to
// the target or past it - never the time a manager happened to review it.
// REWARDS: cumulative entitlements per milestone. First team to a milestone:
// its winner amount; the other team reaching it before the close: its
// runner-up amount. Payable = entitlement − what the team was already paid.

// PROFIT-WEIGHTED POINTS (Bright, 3 Oct 2026). A transaction scores by the
// ADDED CONTRIBUTION it created, not by what kind of sale it was:
//   additional amount collected − added product cost − extra logistics
//   − rep bonus − packaging − gifts  (+ a manager adjustment, with a reason)
// ₦10,000–₦49,999 = 1 point, ₦50,000+ = 2, below ₦10,000 = 0 (still shown).
// One transaction = one score, two points at most, upsell and cross-sell
// assessed together.
export type Scoring = {
  onePointFrom: number;
  twoPointsFrom: number;
  packagingPerUnit: number;
  productIds: string[];
};
export const DEFAULT_SCORING: Scoring = { onePointFrom: 10_000, twoPointsFrom: 50_000, packagingPerUnit: 500, productIds: [] };

export type Milestone = { key: string; target: number; winnerAmount: number; runnerUpAmount: number; minPerMember: number };
export const DEFAULT_MILESTONES: Milestone[] = [
  { key: "m1", target: 50, winnerAmount: 50_000, runnerUpAmount: 10_000, minPerMember: 10 },
  { key: "m2", target: 100, winnerAmount: 150_000, runnerUpAmount: 40_000, minPerMember: 20 }
];

const money = (value: unknown) => Math.round((Number(value) || 0) * 100) / 100;
const positive = (value: unknown) => Math.max(0, money(value));

export function normaliseScoring(raw: unknown): Scoring {
  const value = (raw ?? {}) as Partial<Scoring>;
  const amount = (v: unknown, fallback: number) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? money(v) : fallback);
  const one = amount(value.onePointFrom, DEFAULT_SCORING.onePointFrom);
  return {
    onePointFrom: one,
    twoPointsFrom: Math.max(one, amount(value.twoPointsFrom, DEFAULT_SCORING.twoPointsFrom)),
    packagingPerUnit: amount(value.packagingPerUnit, DEFAULT_SCORING.packagingPerUnit),
    productIds: Array.isArray(value.productIds) ? value.productIds.map(String) : []
  };
}

export function normaliseMilestones(raw: unknown): Milestone[] {
  const list = Array.isArray(raw) ? raw : [];
  const rows = list.map((item: any, index) => ({
    key: String(item?.key || `m${index + 1}`),
    target: Math.max(1, Math.round(Number(item?.target) || 0)),
    winnerAmount: positive(item?.winnerAmount),
    runnerUpAmount: positive(item?.runnerUpAmount),
    minPerMember: Math.max(0, Math.round(Number(item?.minPerMember) || 0))
  })).filter((row) => row.target > 0).sort((a, b) => a.target - b.target);
  return rows.length ? rows : DEFAULT_MILESTONES;
}

export type ContributionInput = {
  productId: string | null;
  amount: number;
  originalAmount: number | null;
  originalQuantity: number | null;
  upsellFromQty: number | null;
  upsellToQty: number | null;
  quantity: number | null;
  crossSellLines: Array<{ amount?: number | string | null; quantity?: number | null; productId?: string | null; addedById?: string | null }>;
  giftLines: Array<{ quantity?: number | null; productId?: string | null }>;
  /** Unit cost of a product on the order's day (Product Master + cost history). */
  unitCost: (productId: string | null | undefined) => number;
  /** The rep's upsell / cross-sell bonus for this order (bonus engine); 0 until delivered. */
  repBonus: number;
  /** Extra delivery cost the upgrade created (known only when recorded). */
  extraLogistics: number;
  /** Manager adjustment, signed, with a reason recorded elsewhere. */
  adjustment: number;
  packagingPerUnit: number;
};

export type Contribution = {
  hasUpsell: boolean; hasCrossSell: boolean; upgrade: { from: number; to: number } | null; crossSellCount: number;
  revenue: number; productCost: number; logistics: number; repBonus: number; packaging: number; gifts: number; adjustment: number;
  contribution: number; crossSellOwner: string | null;
};

/** The added contribution of an order, or null when the rep added nothing (no upgrade, no paid add-on). */
export function contributionOf(input: ContributionInput): Contribution | null {
  const paidLines = (input.crossSellLines ?? []).filter((line) => positive(line.amount) > 0);
  const from = Number(input.upsellFromQty) || 0;
  const to = Number(input.upsellToQty) || 0;
  const hasUpsell = from > 0 && to > from;
  const hasCrossSell = paidLines.length > 0;
  if (!hasUpsell && !hasCrossSell) return null;
  const crossSellRevenue = paidLines.reduce((sum, line) => sum + positive(line.amount), 0);
  const upgradeUnits = hasUpsell ? to - from : 0;
  let revenue: number;
  if (input.originalAmount !== null && Number(input.originalAmount) > 0) revenue = money(input.amount - Number(input.originalAmount));
  else if (hasUpsell) revenue = money((input.amount - crossSellRevenue) * (upgradeUnits / to) + crossSellRevenue);
  else revenue = crossSellRevenue;
  revenue = Math.max(0, revenue);
  const productCost = money(upgradeUnits * input.unitCost(input.productId)
    + paidLines.reduce((sum, line) => sum + Math.max(0, Number(line.quantity) || 1) * input.unitCost(line.productId), 0));
  const gifts = money((input.giftLines ?? []).reduce((sum, line) => sum + Math.max(0, Number(line.quantity) || 1) * input.unitCost(line.productId), 0));
  const packaging = money(input.packagingPerUnit * (upgradeUnits + paidLines.length));
  const logistics = positive(input.extraLogistics);
  const repBonus = positive(input.repBonus);
  const adjustment = money(input.adjustment);
  return {
    hasUpsell, hasCrossSell, upgrade: hasUpsell ? { from, to } : null, crossSellCount: paidLines.length,
    revenue, productCost, logistics, repBonus, packaging, gifts, adjustment,
    contribution: money(revenue - productCost - logistics - repBonus - packaging - gifts + adjustment),
    crossSellOwner: paidLines.find((line) => line.addedById)?.addedById ?? null
  };
}

/** 0, 1 or 2 points - two at most, whatever the transaction contains. */
export function pointsFor(contribution: number, scoring: Scoring) {
  if (contribution >= scoring.twoPointsFrom) return 2;
  if (contribution >= scoring.onePointFrom) return 1;
  return 0;
}

export type RaceEntry = { teamId: string; repId: string | null; points: number; qualifiedAt: string; status: string };
export type MilestoneResult = {
  key: string; target: number; winnerAmount: number; runnerUpAmount: number; minPerMember: number;
  reached: Array<{ teamId: string; at: string }>;
  /** Target reached but a member is short of the per-member minimum. */
  memberPending: Array<{ teamId: string; short: Array<{ repId: string; need: number }> }>;
  winnerTeamIds: string[];
  runnerUpTeamIds: string[];
  tie: boolean;
  provisional: boolean;
};

/**
 * Who reached each milestone and when, from verified entries in qualification
 * order. A team reaches it when its total is at the target or past it AND
 * every member has at least the per-member minimum - at the time of the
 * entry that satisfies both.
 */
export function raceResults(teams: Array<{ id: string; memberIds: string[] }>, entries: RaceEntry[], milestones: Milestone[], closeAt: string | null): MilestoneResult[] {
  const verified = entries.filter((entry) => entry.status === "verified" && entry.points > 0)
    .sort((a, b) => Date.parse(a.qualifiedAt) - Date.parse(b.qualifiedAt));
  const pending = entries.filter((entry) => entry.status === "awaiting_verification" || entry.status === "correction_requested");
  return milestones.map((milestone) => {
    const reached: Array<{ teamId: string; at: string }> = [];
    const memberPending: MilestoneResult["memberPending"] = [];
    for (const team of teams) {
      let total = 0;
      const perMember = new Map(team.memberIds.map((id) => [id, 0]));
      let hit: string | null = null;
      for (const entry of verified.filter((row) => row.teamId === team.id)) {
        total += entry.points;
        if (entry.repId && perMember.has(entry.repId)) perMember.set(entry.repId, (perMember.get(entry.repId) ?? 0) + entry.points);
        const membersOk = Array.from(perMember.values()).every((value) => value >= milestone.minPerMember);
        if (total >= milestone.target && membersOk) { hit = entry.qualifiedAt; break; }
      }
      if (hit && (!closeAt || Date.parse(hit) <= Date.parse(closeAt))) reached.push({ teamId: team.id, at: hit });
      else if (!hit && total >= milestone.target) {
        memberPending.push({ teamId: team.id, short: Array.from(perMember.entries()).filter(([, value]) => value < milestone.minPerMember).map(([repId, value]) => ({ repId, need: milestone.minPerMember - value })) });
      }
    }
    reached.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    const first = reached[0];
    const tie = reached.length > 1 && reached[1].at === first?.at;
    const winnerTeamIds = first ? reached.filter((row) => row.at === first.at).map((row) => row.teamId) : [];
    const runnerUpTeamIds = reached.filter((row) => !winnerTeamIds.includes(row.teamId)).map((row) => row.teamId);
    // A pending entry that qualified before the winner's time could still change who got there first.
    const provisional = Boolean(first) && pending.some((entry) => Date.parse(entry.qualifiedAt) <= Date.parse(first!.at));
    return { ...milestone, reached, memberPending, winnerTeamIds, runnerUpTeamIds, tie, provisional };
  });
}

/** A team's entitlement at each milestone it reached (cumulative), and the step owed at each. */
export function teamEntitlements(teamId: string, results: MilestoneResult[]) {
  let previous = 0;
  return results.map((result) => {
    const reached = result.reached.some((row) => row.teamId === teamId);
    let entitlement = 0;
    let place: "winner" | "runner_up" | "tie" | null = null;
    if (reached) {
      if (result.tie && result.winnerTeamIds.includes(teamId)) {
        entitlement = Math.round(((result.winnerAmount + result.runnerUpAmount) / 2) * 100) / 100;
        place = "tie";
      } else if (result.winnerTeamIds.includes(teamId)) { entitlement = result.winnerAmount; place = "winner"; }
      else { entitlement = result.runnerUpAmount; place = "runner_up"; }
    }
    const step = reached ? Math.max(0, Math.round((entitlement - previous) * 100) / 100) : 0;
    if (reached) previous = Math.max(previous, entitlement);
    return { key: result.key, target: result.target, reached, place, entitlement: reached ? entitlement : 0, step, provisional: reached && result.provisional };
  });
}

/** Everything a challenge could pay at most: every milestone's winner + runner-up at the top milestone. */
export function maxBudget(milestones: Milestone[]) {
  const top = milestones[milestones.length - 1];
  return top ? top.winnerAmount + top.runnerUpAmount : 0;
}

/** Equal split of an amount among members, kobo-exact (the remainder goes to the first). */
export function splitEqually(amount: number, memberIds: string[]) {
  if (memberIds.length === 0) return [];
  const kobo = Math.round(amount * 100);
  const each = Math.floor(kobo / memberIds.length);
  return memberIds.map((id, index) => ({ repId: id, amount: (each + (index === 0 ? kobo - each * memberIds.length : 0)) / 100 }));
}
