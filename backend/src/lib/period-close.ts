// Weekly close: is this week actually finished?
//
// ⚠️ Two kinds of check, and the difference is the point.
//
// COMPUTED checks are facts read from live data - "agent remittances
// reconciled" goes green only when they really are. They cannot be ticked by
// hand and are never stored, so a week can never be closed on a green light
// nobody earned.
//
// MANUAL checks are claims - "inventory count reviewed" has no data source, so
// someone asserts it and their name is recorded against it. They are shown as
// claims, not facts, so a reader can tell which greens are which.

export type CheckKind = "computed" | "manual";

export type CheckGroupKey =
  | "trading" | "cash_in" | "cash_out" | "bank_cash" | "agents_cod" | "inventory"
  | "receivables" | "payables" | "reserves" | "reports" | "variance" | "admin";

export const CHECK_GROUP_LABEL: Record<CheckGroupKey, string> = {
  trading: "Trading",
  cash_in: "Cash In",
  cash_out: "Cash Out",
  bank_cash: "Bank & Cash",
  agents_cod: "Agents & COD",
  inventory: "Inventory",
  receivables: "Receivables",
  payables: "Payables & Commitments",
  reserves: "Reserves",
  reports: "Reports & Analysis",
  variance: "Variance & Reconciliation",
  admin: "Admin & Control"
};

export type CheckDefinition = {
  key: string;
  group: CheckGroupKey;
  label: string;
  kind: CheckKind;
  /** A failed REQUIRED check blocks the close. Advisory ones only warn. */
  required: boolean;
};

export const CLOSE_CHECKS: CheckDefinition[] = [
  { key: "revenue_verified", group: "trading", label: "Revenue verified", kind: "computed", required: true },
  { key: "delivered_finalised", group: "trading", label: "Delivered orders finalised", kind: "computed", required: true },
  { key: "cogs_posted", group: "trading", label: "COGS posted", kind: "computed", required: true },

  { key: "opening_cash_counted", group: "cash_in", label: "Opening cash counted", kind: "computed", required: true },
  { key: "cash_in_recorded", group: "cash_in", label: "Cash in ledger complete", kind: "computed", required: true },
  { key: "remittances_reconciled", group: "cash_in", label: "Agent remittances reconciled", kind: "computed", required: false },

  { key: "cash_out_recorded", group: "cash_out", label: "Cash out ledger complete", kind: "computed", required: true },
  { key: "ad_spend_verified", group: "cash_out", label: "Ad spend verified", kind: "computed", required: false },
  { key: "opex_recorded", group: "cash_out", label: "Operating expenses recorded", kind: "computed", required: false },
  { key: "stock_purchases_recorded", group: "cash_out", label: "Stock purchases recorded", kind: "computed", required: false },

  { key: "bank_balances_verified", group: "bank_cash", label: "Bank balances verified", kind: "computed", required: true },
  { key: "cash_in_hand_counted", group: "bank_cash", label: "Cash in hand counted", kind: "computed", required: false },
  { key: "transfers_reviewed", group: "bank_cash", label: "Account transfers reviewed", kind: "manual", required: false },
  { key: "bank_fees_accounted", group: "bank_cash", label: "Bank fees accounted for", kind: "manual", required: false },

  { key: "cod_reconciled", group: "agents_cod", label: "COD with agents reconciled", kind: "computed", required: false },
  { key: "agent_balances_reviewed", group: "agents_cod", label: "Agent balances reviewed", kind: "manual", required: false },

  { key: "inventory_counted", group: "inventory", label: "Inventory count reviewed", kind: "manual", required: false },
  { key: "inventory_valued", group: "inventory", label: "Inventory value updated", kind: "computed", required: true },

  { key: "receivables_reviewed", group: "receivables", label: "Receivables reviewed", kind: "manual", required: false },
  { key: "aging_updated", group: "receivables", label: "Aging analysis updated", kind: "manual", required: false },

  { key: "payables_reviewed", group: "payables", label: "Payables reviewed", kind: "manual", required: false },
  { key: "upcoming_payments_checked", group: "payables", label: "Upcoming payments checked", kind: "manual", required: false },

  { key: "payroll_reserve_reviewed", group: "reserves", label: "Payroll reserve reviewed", kind: "computed", required: false },
  { key: "reserves_not_overcommitted", group: "reserves", label: "Reserves within available cash", kind: "computed", required: true },

  { key: "profitability_reviewed", group: "reports", label: "Profitability reviewed", kind: "manual", required: false },
  { key: "cash_flow_reviewed", group: "reports", label: "Cash flow analysis reviewed", kind: "manual", required: false },

  { key: "variance_investigated", group: "variance", label: "Cash variance investigated", kind: "computed", required: true },
  { key: "variances_resolved", group: "variance", label: "All variances resolved or explained", kind: "computed", required: true },

  { key: "notes_added", group: "admin", label: "Notes & explanations added", kind: "computed", required: true },
  { key: "manager_review", group: "admin", label: "Manager review completed", kind: "manual", required: false }
];

export type EvaluatedCheck = CheckDefinition & {
  done: boolean;
  /** What the figure actually was. Empty for a manual check nobody has ticked. */
  evidence: string;
  doneByName?: string;
  doneAt?: string | null;
};

export type CloseProgress = {
  checks: EvaluatedCheck[];
  total: number;
  completed: number;
  /** Required checks still failing. Non-empty means the week cannot close. */
  blocking: EvaluatedCheck[];
  computedTotal: number;
  computedDone: number;
  manualTotal: number;
  manualDone: number;
  progressPct: number;
  canClose: boolean;
};

/**
 * Roll the evaluated checks into the close decision.
 *
 * ⚠️ `canClose` turns ONLY on required checks. An advisory check left red -
 * "stock purchases recorded", which has no data source at all - warns without
 * blocking, because a gap the business has never tracked must not make the
 * week uncloseable forever. Required checks have no such escape.
 */
export function summariseClose(checks: EvaluatedCheck[]): CloseProgress {
  const rows = checks ?? [];
  const completed = rows.filter((row) => row.done).length;
  const computed = rows.filter((row) => row.kind === "computed");
  const manual = rows.filter((row) => row.kind === "manual");
  return {
    checks: rows,
    total: rows.length,
    completed,
    blocking: rows.filter((row) => row.required && !row.done),
    computedTotal: computed.length,
    computedDone: computed.filter((row) => row.done).length,
    manualTotal: manual.length,
    manualDone: manual.filter((row) => row.done).length,
    progressPct: rows.length > 0 ? Math.round((completed / rows.length) * 100) : 0,
    canClose: rows.filter((row) => row.required && !row.done).length === 0
  };
}

export type CashPosition = {
  totalLiquidCash: number;
  codWithAgents: number;
  inventoryAtCost: number;
  reservedCash: number;
  freeOperatingCash: number;
};

/**
 * What the business can actually spend on Monday morning.
 *
 * ⚠️ Inventory and COD with agents are deliberately EXCLUDED from free
 * operating cash. Both are real assets and both are shown, but neither can pay
 * a bill this week: stock has to sell first, and cash sitting with an agent is
 * exactly the money that has historically never arrived. Counting them as
 * spendable is how a business with no money believes it is solvent.
 */
export function freeOperatingCash(input: {
  totalLiquidCash: number; reservedCash: number;
}): number {
  return (Number(input.totalLiquidCash) || 0) - (Number(input.reservedCash) || 0);
}

export type ProfitSummary = {
  totalRevenue: number;
  totalCogs: number;
  grossProfit: number;
  operatingExpenses: number;
  netProfit: number;
  netMarginPct: number;
};

/**
 * The week's P&L on an ACCRUAL basis - recognised when delivered, not when the
 * cash arrives. It will not match the cash figures beside it, and that gap is
 * the whole reason both are shown.
 */
export function summariseProfit(input: {
  totalRevenue: unknown; totalCogs: unknown; operatingExpenses: unknown;
}): ProfitSummary {
  const revenue = Number(input.totalRevenue) || 0;
  const cogs = Number(input.totalCogs) || 0;
  const opex = Number(input.operatingExpenses) || 0;
  const gross = revenue - cogs;
  const net = gross - opex;
  return {
    totalRevenue: revenue,
    totalCogs: cogs,
    grossProfit: gross,
    operatingExpenses: opex,
    netProfit: net,
    netMarginPct: revenue > 0 ? Math.round((net / revenue) * 10000) / 100 : 0
  };
}
