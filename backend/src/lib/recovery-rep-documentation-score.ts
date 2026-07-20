// Documentation-completeness scoring for the Recovery Rep KPI dashboard - a
// pure read-time rubric over data that's already collected elsewhere
// (contact attempts, call outcome, follow-up scheduling, order status), not
// a new data-entry requirement. Mirrors the terminal-outcome detection
// already used by follow-up-kpi.ts rather than inventing new heuristics.

const TERMINAL_STATUSES = new Set(["Delivered", "Cancelled", "Failed"]);

export type DocumentationScoreOrder = {
  id: string;
  status?: string | null;
  call_outcome?: string | null;
  next_follow_up_at?: string | null;
  scheduled_at?: string | null;
  scheduled_date?: string | null;
};

export type DocumentationScoreResult = {
  scoredCount: number;
  passingCount: number;
  ratePct: number;
};

// hasContactAttempt: pass a Set of order ids known to have >=1 logged
// contact attempt (caller already has this from a single query - avoids a
// per-order round trip here).
export const scoreOrderDocumentation = (
  orders: DocumentationScoreOrder[],
  orderIdsWithContactAttempt: Set<string>
): DocumentationScoreResult => {
  let passingCount = 0;
  for (const order of orders) {
    const hasAttempt = orderIdsWithContactAttempt.has(order.id);
    const hasOutcome = Boolean((order.call_outcome ?? "").trim());
    const hasFollowUpOrTerminal =
      Boolean(order.next_follow_up_at || order.scheduled_at || order.scheduled_date)
      || TERMINAL_STATUSES.has(order.status ?? "");
    if (hasAttempt && hasOutcome && hasFollowUpOrTerminal) passingCount += 1;
  }
  const scoredCount = orders.length;
  return {
    scoredCount,
    passingCount,
    ratePct: scoredCount > 0 ? Math.round((passingCount / scoredCount) * 1000) / 10 : 100
  };
};
