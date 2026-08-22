// What agents are actually holding that belongs to the company.
//
// ⚠️ An agent DEDUCTS their delivery fee before remitting. On a settled order
// `amount − remitted` is therefore the agent's own fee, not money owed. Reading
// that gap as unremitted cash was reporting ₦8.19m of fees the agents were
// entitled to keep as if it were missing: 1,711 of 1,723 settled orders had a
// gap equal to logistics_cost to the naira.
//
// ⚠️ Only a RECORDED fee is netted off, never an estimate. Monthly-remit agents
// do not produce their fees until month end, so their delivered orders carry no
// logistics_cost for weeks - and until the real figure lands they owe the FULL
// amount. Netting a provisional estimate here would quietly forgive a debt that
// has not been settled, which is exactly why the provisional logistics accrual
// is barred from touching remittance.

export type AgentOrderRow = {
  orderId: string;
  agentId: string | null;
  agentName: string;
  amount: number;
  amountRemitted: number;
  /** Recorded fee only. 0/null means "not yet priced", NOT "no fee". */
  logisticsCost: number;
  remittanceStatus: string | null;
  settledOn: string | null;
};

const num = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

/** An order the business has marked Paid is settled, whatever the arithmetic says. */
export function isSettled(row: Pick<AgentOrderRow, "remittanceStatus">): boolean {
  return String(row.remittanceStatus ?? "").trim().toLowerCase() === "paid";
}

/**
 * What one order still owes the company.
 *
 * Floored at zero per order: an agent who over-remitted on one delivery has
 * not thereby paid off another, and letting a negative offset a real debt
 * elsewhere would understate the exposure.
 */
export function owedOnOrder(row: AgentOrderRow): number {
  if (isSettled(row)) return 0;
  return Math.max(0, num(row.amount) - num(row.logisticsCost) - num(row.amountRemitted));
}

export type AgentReceivable = {
  agentId: string | null;
  agentName: string;
  orders: number;
  owed: number;
  /** Orders still waiting on a delivery fee - they owe gross until it lands. */
  ordersAwaitingFee: number;
  oldestSettledOn: string | null;
};

export type ReceivablesSummary = {
  totalOwed: number;
  orderCount: number;
  agentCount: number;
  ordersAwaitingFee: number;
  byAgent: AgentReceivable[];
};

/**
 * Everything outstanding, worst agent first.
 *
 * Settled orders are dropped entirely rather than contributing zero, so the
 * order count means "deliveries still owing" and not "deliveries ever made".
 */
export function summariseReceivables(rows: AgentOrderRow[]): ReceivablesSummary {
  const outstanding = (rows ?? []).filter((row) => owedOnOrder(row) > 0);
  const byAgentKey = new Map<string, AgentReceivable>();

  outstanding.forEach((row) => {
    const key = row.agentId ?? "__unassigned__";
    const entry = byAgentKey.get(key) ?? {
      agentId: row.agentId ?? null,
      agentName: row.agentName || "Unassigned",
      orders: 0, owed: 0, ordersAwaitingFee: 0, oldestSettledOn: null
    };
    entry.orders += 1;
    entry.owed += owedOnOrder(row);
    if (num(row.logisticsCost) === 0) entry.ordersAwaitingFee += 1;
    if (row.settledOn && (!entry.oldestSettledOn || row.settledOn < entry.oldestSettledOn)) {
      entry.oldestSettledOn = row.settledOn;
    }
    byAgentKey.set(key, entry);
  });

  const byAgent = [...byAgentKey.values()].sort((left, right) => right.owed - left.owed);
  return {
    totalOwed: byAgent.reduce((sum, entry) => sum + entry.owed, 0),
    orderCount: outstanding.length,
    agentCount: byAgent.length,
    ordersAwaitingFee: outstanding.filter((row) => num(row.logisticsCost) === 0).length,
    byAgent
  };
}
