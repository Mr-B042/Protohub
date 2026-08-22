// Bank accounts: where the cash actually sits.
//
// Protohub takes agent remittances into more than one account (Opay and
// Moniepoint both), so "how much cash do we have" is a per-account question
// with a total on top, not a single running figure.

export type BankAccountKind = "bank" | "cash";

export type AccountMovement = {
  accountId: string | null;
  cashIn: number;
  cashOut: number;
};

export type AccountTransfer = {
  fromAccountId: string;
  toAccountId: string;
  amount: number;
  /** Null while the money is still in flight between our own accounts. */
  clearedAt: string | null;
};

export type AccountBalance = {
  accountId: string;
  /** Opening balance plus everything that has settled. */
  currentBalance: number;
  /** Current balance minus money committed but not yet cleared. */
  availableBalance: number;
  /** Outbound transfers that have left but not been confirmed received. */
  pendingOut: number;
  /** Inbound transfers not yet confirmed - counted in current, not available. */
  pendingIn: number;
};

/**
 * Balances for every account.
 *
 * ⚠️ A transfer between our OWN accounts is not cash flow - nothing entered or
 * left the business - but it absolutely moves an account balance, so it is
 * applied here while being excluded from cash in/out totals elsewhere.
 *
 * An uncleared transfer has already left the sending account (the money is
 * gone) but must not be spendable on the receiving side yet. So it reduces the
 * sender's current balance immediately, and is held out of the receiver's
 * AVAILABLE balance until it clears.
 */
export function computeAccountBalances(
  accounts: Array<{ id: string; openingBalance: number }>,
  movements: AccountMovement[],
  transfers: AccountTransfer[]
): AccountBalance[] {
  const state = new Map<string, AccountBalance>();
  accounts.forEach((account) => state.set(account.id, {
    accountId: account.id,
    currentBalance: Number(account.openingBalance) || 0,
    availableBalance: Number(account.openingBalance) || 0,
    pendingOut: 0,
    pendingIn: 0
  }));

  movements.forEach((movement) => {
    // Unassigned money belongs to no account; it still counts in the company
    // total but cannot be attributed to a balance.
    if (!movement.accountId) return;
    const row = state.get(movement.accountId);
    if (!row) return;
    const delta = (Number(movement.cashIn) || 0) - (Number(movement.cashOut) || 0);
    row.currentBalance += delta;
    row.availableBalance += delta;
  });

  transfers.forEach((transfer) => {
    const amount = Number(transfer.amount) || 0;
    if (amount <= 0) return;
    const from = state.get(transfer.fromAccountId);
    const to = state.get(transfer.toAccountId);
    // The money has left the sender either way.
    if (from) {
      from.currentBalance -= amount;
      from.availableBalance -= amount;
      if (!transfer.clearedAt) from.pendingOut += amount;
    }
    if (to) {
      to.currentBalance += amount;
      if (transfer.clearedAt) to.availableBalance += amount;
      else to.pendingIn += amount;
    }
  });

  return [...state.values()];
}

export type AccountTotals = {
  totalLiquid: number;
  totalBank: number;
  cashInHand: number;
  pendingToClear: number;
};

/**
 * The summary strip. Cash in hand is split out from bank balances because it
 * is counted by hand rather than read off a statement, and the two carry very
 * different confidence.
 */
export function summariseAccounts(
  accounts: Array<{ id: string; kind: BankAccountKind }>,
  balances: AccountBalance[]
): AccountTotals {
  const kindById = new Map(accounts.map((account) => [account.id, account.kind]));
  return balances.reduce<AccountTotals>((totals, row) => {
    const kind = kindById.get(row.accountId) ?? "bank";
    totals.totalLiquid += row.currentBalance;
    if (kind === "cash") totals.cashInHand += row.currentBalance;
    else totals.totalBank += row.currentBalance;
    // Counted once, on the receiving side: it is the same money in flight.
    totals.pendingToClear += row.pendingIn;
    return totals;
  }, { totalLiquid: 0, totalBank: 0, cashInHand: 0, pendingToClear: 0 });
}

/**
 * Cash that has not been attributed to any account.
 *
 * Every row recorded before accounts existed has no account, and guessing one
 * would invent a bank history. This is what the page reports as "Unassigned"
 * so the difference between the ledger and the account balances is always
 * explained rather than just missing.
 */
export function unassignedTotal(movements: AccountMovement[]): number {
  return movements
    .filter((movement) => !movement.accountId)
    .reduce((total, movement) => total + (Number(movement.cashIn) || 0) - (Number(movement.cashOut) || 0), 0);
}
