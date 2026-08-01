// Which Personal Delivery Agents may take a given order.
//
// Every rule here exists because breaking it costs something real: sending an
// order to an unapproved agent puts stock and cash with an unverified stranger;
// sending it to someone without the product guarantees a failed trip; sending
// it to someone already over their cash limit compounds an exposure we cannot
// yet collect.
//
// The result is a list of REASONS rather than a boolean, so a dispatcher
// looking at an empty candidate list can see why every agent was excluded
// instead of concluding the system is broken.

export const OPERATIONAL_ACCOUNT_STATUSES = ["Approved", "Probation", "Active"];

export type CandidateAgent = {
  id: string;
  fullName: string;
  accountStatus: string;
  availability: string;
  trustLevel: string;
  state?: string | null;
  serviceAreas?: string[] | null;
  maxActiveOrders?: number | null;
  maxCodExposure?: number | null;
  /** Live figures for this agent. */
  activeOrders: number;
  cashOutstanding: number;
  availableStock: number;
};

export type CandidateOrder = {
  state?: string | null;
  quantity: number;
  amount: number;
};

export type CandidateResult = {
  agentId: string;
  fullName: string;
  eligible: boolean;
  /** Empty when eligible. */
  reasons: string[];
  /** Ranks eligible agents; lower is a better fit. */
  score: number;
};

/** Loose state comparison - "Rivers" and "Rivers State" are the same place. */
function sameState(a?: string | null, b?: string | null): boolean {
  const norm = (value?: string | null) =>
    (value ?? "").toLowerCase().replace(/\s*state\s*$/i, "").trim();
  const left = norm(a);
  const right = norm(b);
  return left.length > 0 && left === right;
}

export function agentCoversState(agent: CandidateAgent, state?: string | null): boolean {
  if (!state) return true;
  if (sameState(agent.state, state)) return true;
  return (agent.serviceAreas ?? []).some((area) => sameState(area, state));
}

/** Why this agent cannot take this order. Empty means they can. */
export function candidateBlockers(agent: CandidateAgent, order: CandidateOrder): string[] {
  const reasons: string[] = [];

  if (!OPERATIONAL_ACCOUNT_STATUSES.includes(agent.accountStatus)) {
    reasons.push(`Account is ${agent.accountStatus}`);
  }
  if (agent.availability !== "Available") {
    reasons.push(`Marked ${agent.availability.toLowerCase()}`);
  }
  if (!agentCoversState(agent, order.state)) {
    reasons.push(`Does not cover ${order.state}`);
  }
  // Dispatching a product the agent does not physically hold guarantees a
  // failed delivery, so it is a hard block rather than a warning.
  if (agent.availableStock < order.quantity) {
    reasons.push(`Holds ${agent.availableStock} of the ${order.quantity} needed`);
  }
  if (agent.maxActiveOrders && agent.activeOrders >= agent.maxActiveOrders) {
    reasons.push(`Already on ${agent.activeOrders} of ${agent.maxActiveOrders} active orders`);
  }
  if (agent.maxCodExposure && agent.cashOutstanding + order.amount > agent.maxCodExposure) {
    reasons.push(`Holding ${Math.round(agent.cashOutstanding)} in company cash, over their limit with this order`);
  }
  return reasons;
}

/**
 * Ranks eligible agents. Lower is better.
 *
 * Preference order: fewer active orders first (spreads the work and gets the
 * customer seen sooner), then less of our cash in hand, then higher trust.
 * Deliberately NOT "most stock first" - that would pile every order onto one
 * well-stocked agent and starve everyone else of work.
 */
export function candidateScore(agent: CandidateAgent): number {
  const trustRank = agent.trustLevel === "Trusted" ? 0 : agent.trustLevel === "Verified" ? 1 : 2;
  return agent.activeOrders * 1000 + Math.round(agent.cashOutstanding / 1000) * 10 + trustRank;
}

export function rankCandidates(agents: CandidateAgent[], order: CandidateOrder): CandidateResult[] {
  return agents
    .map((agent) => {
      const reasons = candidateBlockers(agent, order);
      return {
        agentId: agent.id,
        fullName: agent.fullName,
        eligible: reasons.length === 0,
        reasons,
        score: candidateScore(agent)
      };
    })
    .sort((a, b) => {
      if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
      return a.score - b.score;
    });
}
