// Team Challenges (Bright, 3 Oct 2026) - the rules, kept pure so they can be
// tested on their own.
//
// SCORE: one order = one score, the HIGHEST qualifying category (a 1→2
// upgrade with a small add-on scores 2, not 3). Points come from the
// challenge's scoring table; the rep never picks a category.
// RACE: a team's milestone time is the qualification time (the later of
// delivered and paid) of the verified order that takes its running total to
// the target or past it - never the time a manager happened to review it.
// REWARDS: cumulative entitlements per milestone. First team to a milestone:
// its winner amount; the other team reaching it before the close: its
// runner-up amount. Payable = entitlement − what the team was already paid.

export type Scoring = {
  crossSell: number;
  upgradePlusOne: number;
  upgradePlusTwo: number;
  minAddedValue: number;
  productIds: string[];
};
export const DEFAULT_SCORING: Scoring = { crossSell: 1, upgradePlusOne: 2, upgradePlusTwo: 3, minAddedValue: 0, productIds: [] };

export type Milestone = { key: string; target: number; winnerAmount: number; runnerUpAmount: number };
export const DEFAULT_MILESTONES: Milestone[] = [
  { key: "m1", target: 50, winnerAmount: 50_000, runnerUpAmount: 20_000 },
  { key: "m2", target: 100, winnerAmount: 150_000, runnerUpAmount: 60_000 }
];

export type ScoreOrderInput = {
  productId: string | null;
  amount: number;
  originalAmount: number | null;
  upsellFromQty: number | null;
  upsellToQty: number | null;
  quantity: number | null;
  crossSellLines: Array<{ amount?: number | string | null; quantity?: number | null; productId?: string | null; productName?: string | null; addedById?: string | null; addedAt?: string | null }>;
};

export type OrderScore = {
  category: "upsell" | "cross_sell" | "both";
  points: number;
  label: string;
  addedValue: number;
  upgrade: { from: number; to: number } | null;
  crossSellValue: number;
  crossSellOwner: string | null;
};

const money = (value: unknown) => Math.max(0, Math.round((Number(value) || 0) * 100) / 100);

export function normaliseScoring(raw: unknown): Scoring {
  const value = (raw ?? {}) as Partial<Scoring>;
  const int = (v: unknown, fallback: number) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.round(Number(v)) : fallback);
  return {
    crossSell: int(value.crossSell, DEFAULT_SCORING.crossSell),
    upgradePlusOne: int(value.upgradePlusOne, DEFAULT_SCORING.upgradePlusOne),
    upgradePlusTwo: int(value.upgradePlusTwo, DEFAULT_SCORING.upgradePlusTwo),
    minAddedValue: money(value.minAddedValue ?? 0),
    productIds: Array.isArray(value.productIds) ? value.productIds.map(String) : []
  };
}

export function normaliseMilestones(raw: unknown): Milestone[] {
  const list = Array.isArray(raw) ? raw : [];
  const rows = list.map((item: any, index) => ({
    key: String(item?.key || `m${index + 1}`),
    target: Math.max(1, Math.round(Number(item?.target) || 0)),
    winnerAmount: money(item?.winnerAmount),
    runnerUpAmount: money(item?.runnerUpAmount)
  })).filter((row) => row.target > 0).sort((a, b) => a.target - b.target);
  return rows.length ? rows : DEFAULT_MILESTONES;
}

/** The score an order earns, or null when nothing the rep added qualifies. Free gifts never count. */
export function scoreOrder(order: ScoreOrderInput, scoring: Scoring): OrderScore | null {
  if (scoring.productIds.length > 0 && (!order.productId || !scoring.productIds.includes(order.productId))) return null;
  const paidLines = (order.crossSellLines ?? []).filter((line) => money(line.amount) > 0);
  const crossSellValue = paidLines.reduce((sum, line) => sum + money(line.amount), 0);
  const from = Number(order.upsellFromQty) || 0;
  const to = Number(order.upsellToQty) || 0;
  const upgraded = from > 0 && to > from;
  let upgradeValue = 0;
  if (upgraded) {
    const mainNow = money(order.amount) - crossSellValue;
    upgradeValue = order.originalAmount !== null && Number(order.originalAmount) > 0
      ? Math.max(0, money(mainNow - Number(order.originalAmount)))
      : money(mainNow * ((to - from) / to));
  }
  const upgradePoints = upgraded ? (to - from >= 2 ? scoring.upgradePlusTwo : scoring.upgradePlusOne) : 0;
  const crossPoints = crossSellValue > 0 ? scoring.crossSell : 0;
  if (upgradePoints === 0 && crossPoints === 0) return null;
  const addedValue = money(upgradeValue + crossSellValue);
  if (addedValue < scoring.minAddedValue) return null;
  const category = upgradePoints > 0 && crossPoints > 0 ? "both" : upgradePoints > 0 ? "upsell" : "cross_sell";
  const points = Math.max(upgradePoints, crossPoints);
  const label = upgradePoints >= crossPoints
    ? `Upgrade ${from} → ${to}${crossPoints > 0 ? " + cross-sell (scored once, highest)" : ""}`
    : "Cross-sell";
  return {
    category, points, label, addedValue, upgrade: upgraded ? { from, to } : null, crossSellValue,
    crossSellOwner: paidLines.find((line) => line.addedById)?.addedById ?? null
  };
}

export type RaceEntry = { teamId: string; points: number; qualifiedAt: string; status: string };
export type MilestoneResult = {
  key: string; target: number; winnerAmount: number; runnerUpAmount: number;
  reached: Array<{ teamId: string; at: string }>;
  winnerTeamIds: string[];
  runnerUpTeamIds: string[];
  tie: boolean;
  provisional: boolean;
};

/** Who reached each milestone and when, from verified entries in qualification order. */
export function raceResults(teamIds: string[], entries: RaceEntry[], milestones: Milestone[], closeAt: string | null): MilestoneResult[] {
  const verified = entries.filter((entry) => entry.status === "verified" && entry.points > 0)
    .sort((a, b) => Date.parse(a.qualifiedAt) - Date.parse(b.qualifiedAt));
  const pending = entries.filter((entry) => entry.status === "awaiting_verification" || entry.status === "correction_requested");
  return milestones.map((milestone) => {
    const reached: Array<{ teamId: string; at: string }> = [];
    for (const teamId of teamIds) {
      let total = 0;
      for (const entry of verified.filter((row) => row.teamId === teamId)) {
        total += entry.points;
        if (total >= milestone.target) {
          if (!closeAt || Date.parse(entry.qualifiedAt) <= Date.parse(closeAt)) reached.push({ teamId, at: entry.qualifiedAt });
          break;
        }
      }
    }
    reached.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    const first = reached[0];
    const tie = reached.length > 1 && reached[1].at === first?.at;
    const winnerTeamIds = first ? reached.filter((row) => row.at === first.at).map((row) => row.teamId) : [];
    const runnerUpTeamIds = reached.filter((row) => !winnerTeamIds.includes(row.teamId)).map((row) => row.teamId);
    // A pending entry that qualified before the winner's time could still change who got there first.
    const provisional = Boolean(first) && pending.some((entry) => Date.parse(entry.qualifiedAt) <= Date.parse(first!.at));
    return { ...milestone, reached, winnerTeamIds, runnerUpTeamIds, tie, provisional };
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
