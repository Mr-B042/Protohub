// Cash-on-delivery reconciliation for Personal Delivery Agents.
//
// ⚠️ The rule everything here depends on: an agent NEVER nets their delivery
// fee off the customer's cash. They collect the full amount, remit the full
// amount, and are paid separately.
//
// If netting were allowed, "agent correctly kept their ₦4,500 fee" and "agent
// is ₦4,500 short" would look identical in the books. Keeping the two flows
// apart is what makes a shortage visible at all.

export type ReconciliationStatus =
  | "Awaiting Collection Confirmation" | "Cash Held by Agent" | "Partially Remitted"
  | "Fully Remitted" | "Under Review" | "Short Payment" | "Overpayment"
  | "Reconciled" | "Nothing to Remit";

export type AssignmentCash = {
  deliveryStatus: string;
  /** What the customer actually handed over. NOT reduced by the agent's fee. */
  amountCollected?: number | null;
  amountRemitted?: number | null;
  deliveryFee?: number | null;
};

/** Rounds to whole naira - kobo drift shouldn't create phantom ₦0.01 shortfalls. */
const money = (value: number) => Math.round(value);

/**
 * How much of the customer's cash the agent still owes.
 *
 * Deliberately the FULL collected amount minus what has been handed over. The
 * delivery fee is not subtracted: it is a separate debt the company owes the
 * agent, not a discount on what the agent owes the company.
 */
export function outstandingForAssignment(row: AssignmentCash): number {
  if (row.deliveryStatus !== "Delivered") return 0;
  const collected = money(Number(row.amountCollected ?? 0));
  const remitted = money(Number(row.amountRemitted ?? 0));
  return Math.max(0, collected - remitted);
}

/** Where an order sits in the cash cycle. */
export function reconciliationStatusFor(row: AssignmentCash): ReconciliationStatus {
  if (row.deliveryStatus !== "Delivered") return "Awaiting Collection Confirmation";

  const collected = money(Number(row.amountCollected ?? 0));
  const remitted = money(Number(row.amountRemitted ?? 0));

  // A genuinely prepaid or free delivery collects nothing, so there is nothing
  // to chase. Distinct from "collected but not yet handed over".
  if (collected === 0) return remitted > 0 ? "Overpayment" : "Nothing to Remit";

  if (remitted === 0) return "Cash Held by Agent";
  if (remitted > collected) return "Overpayment";
  if (remitted === collected) return "Reconciled";
  return "Partially Remitted";
}

/**
 * When the agent's fee becomes payable.
 *
 * Only once the customer's cash is fully in. Paying a fee on an order whose
 * cash is still outstanding means paying someone for money we have not
 * received - and removes the incentive to hand it over.
 */
export function earningStatusFor(row: AssignmentCash, currentStatus?: string): "Pending" | "Available" | "Paid" | "Withheld" {
  if (currentStatus === "Paid") return "Paid";
  if (currentStatus === "Withheld") return "Withheld";
  if (row.deliveryStatus !== "Delivered") return "Pending";
  const status = reconciliationStatusFor(row);
  return status === "Reconciled" || status === "Nothing to Remit" || status === "Overpayment"
    ? "Available"
    : "Pending";
}

export type AgentCashPosition = {
  /** Company money the agent is holding right now. */
  outstanding: number;
  /** Fees earned but not yet payable, because the cash is not in. */
  pendingEarnings: number;
  /** Fees the company owes and can pay now. */
  availableEarnings: number;
  deliveredOrders: number;
  ordersWithCashOutstanding: number;
};

export function cashPositionFor(rows: AssignmentCash[], earningStatuses: string[] = []): AgentCashPosition {
  let outstanding = 0;
  let pendingEarnings = 0;
  let availableEarnings = 0;
  let deliveredOrders = 0;
  let ordersWithCashOutstanding = 0;

  rows.forEach((row, index) => {
    if (row.deliveryStatus !== "Delivered") return;
    deliveredOrders += 1;
    const owed = outstandingForAssignment(row);
    if (owed > 0) { outstanding += owed; ordersWithCashOutstanding += 1; }

    const fee = money(Number(row.deliveryFee ?? 0));
    const status = earningStatusFor(row, earningStatuses[index]);
    if (status === "Available") availableEarnings += fee;
    else if (status === "Pending") pendingEarnings += fee;
  });

  return { outstanding, pendingEarnings, availableEarnings, deliveredOrders, ordersWithCashOutstanding };
}

/**
 * Why this agent should not be given another cash-on-delivery order.
 *
 * An agent already holding more of our money than their approved limit is the
 * clearest signal to stop adding to it - the exposure compounds silently
 * otherwise.
 */
export function codAssignmentBlockers(
  position: Pick<AgentCashPosition, "outstanding">,
  maxCodExposure?: number | null,
  incomingOrderValue = 0
): string[] {
  if (!maxCodExposure || maxCodExposure <= 0) return [];
  const projected = position.outstanding + Math.max(0, money(incomingOrderValue));
  if (projected <= maxCodExposure) return [];
  return [
    `This agent is holding ${money(position.outstanding)} of company money. `
    + `Adding this order would take them to ${projected}, above their approved limit of ${money(maxCodExposure)}.`
  ];
}

/**
 * Splits a payment across the orders it settles, oldest debt first.
 * Returns what could not be allocated, so an overpayment is visible rather
 * than silently absorbed.
 */
export function allocateRemittance(
  amount: number,
  debts: Array<{ assignmentId: string; outstanding: number }>
): { allocations: Array<{ assignmentId: string; amount: number }>; unallocated: number } {
  let remaining = money(amount);
  const allocations: Array<{ assignmentId: string; amount: number }> = [];
  for (const debt of debts) {
    if (remaining <= 0) break;
    const owed = money(debt.outstanding);
    if (owed <= 0) continue;
    const applied = Math.min(remaining, owed);
    allocations.push({ assignmentId: debt.assignmentId, amount: applied });
    remaining -= applied;
  }
  return { allocations, unallocated: Math.max(0, remaining) };
}
