// Manager Funds & Expenses: the maths and the rules (Bright, 1 Oct 2026).
// Pure, tested in manager-funds.test.ts. Routes load rows, ask here, write.
//
//   Opening + Received - Spent - Remitted = Expected closing
//   Variance = Actual - Expected   (negative = money missing; the sign every
//                                   cash screen in Protohub uses)

export type FundKind = "customer_payment" | "owner_funding" | "company_transfer_in" | "other_in" | "expense" | "remittance_out";
export type FundCategory =
  | "logistics" | "meta_ads" | "airtime_data" | "packaging" | "office" | "customer_refund"
  | "staff_expense" | "transportation" | "repairs" | "miscellaneous" | "other" | "waybill";

export const MONEY_IN_KINDS: FundKind[] = ["customer_payment", "owner_funding", "company_transfer_in", "other_in"];

/**
 * Her categories, and the Expenses-ledger category each lands in. Logistics is
 * "Delivery" on purpose: profit already treats Delivery expenses and order
 * delivery fees as either/or, so a rider fee is never counted twice. Stock
 * purchases are NOT a category (Bright, 1 Oct 2026): product cost is counted
 * when an order sells.
 */
export const FUND_CATEGORIES: Record<FundCategory, { label: string; expenseCategory: string }> = {
  logistics: { label: "Logistics / Rider Fees", expenseCategory: "Delivery" },
  // A product's waybill cost (Bright, 9 Oct 2026). Counted once against the
  // product's typed weekly waybill total - see lib/waybill-costs.ts.
  waybill: { label: "Waybill", expenseCategory: "Waybill" },
  meta_ads: { label: "Facebook / Meta Ads", expenseCategory: "Ad Spend" },
  airtime_data: { label: "Airtime / Data", expenseCategory: "Airtime & Data" },
  packaging: { label: "Packaging", expenseCategory: "Other" },
  office: { label: "Office Expenses", expenseCategory: "Other" },
  customer_refund: { label: "Customer Refund", expenseCategory: "Other" },
  staff_expense: { label: "Staff Expense", expenseCategory: "Other" },
  transportation: { label: "Transportation", expenseCategory: "Other" },
  repairs: { label: "Repairs / Maintenance", expenseCategory: "Other" },
  miscellaneous: { label: "Miscellaneous", expenseCategory: "Other" },
  other: { label: "Other", expenseCategory: "Other" }
};

export const KIND_LABEL: Record<FundKind, string> = {
  customer_payment: "Customer Payment",
  owner_funding: "Owner Funding",
  company_transfer_in: "Other Company Funds",
  other_in: "Other Money In",
  expense: "Expense",
  remittance_out: "Remitted to Company"
};

export type FundSettings = {
  expenseProofMin: number;
  remittanceProofRequired: boolean;
  ownerFundingReferenceRequired: boolean;
  otherInProofRequired: boolean;
};

/**
 * Receipts are OPTIONAL by default (Bright, 1 Oct 2026: "they can provide it
 * if available, not strict"). A missing receipt never blocks the week. The
 * owner can still switch a rule on per branch; expenseProofMin 0 = off.
 */
export const DEFAULT_FUND_SETTINGS: FundSettings = {
  expenseProofMin: 0,
  remittanceProofRequired: false,
  ownerFundingReferenceRequired: false,
  otherInProofRequired: false
};

export type FundTxn = {
  id: string;
  kind: FundKind;
  category: FundCategory | null;
  amount: number;
  occurredAt: string;
  status: "recorded" | "returned" | "voided";
  reference?: string | null;
  orderIds?: string[];
  description?: string | null;
  evidenceCount: number;
};

/** What a transaction still needs before the week can go to the owner. */
export function missingProof(txn: FundTxn, settings: FundSettings): string | null {
  if (txn.status === "voided") return null;
  switch (txn.kind) {
    case "customer_payment":
      return (txn.orderIds ?? []).length === 0 ? "Order number required" : null;
    case "owner_funding":
      return settings.ownerFundingReferenceRequired && !String(txn.reference ?? "").trim() && txn.evidenceCount === 0
        ? "Transfer reference or proof required" : null;
    case "other_in":
      if (String(txn.description ?? "").trim().length < 10) return "Explanation required";
      return settings.otherInProofRequired && txn.evidenceCount === 0 ? "Proof required" : null;
    case "remittance_out":
      return settings.remittanceProofRequired && txn.evidenceCount === 0 ? "Transfer proof required" : null;
    case "expense":
      if (txn.category === "other" && String(txn.description ?? "").trim().length < 5) return "Explain what 'Other' was";
      return settings.expenseProofMin > 0 && txn.amount >= settings.expenseProofMin && txn.evidenceCount === 0 ? "Receipt required" : null;
    default:
      return null;
  }
}

const round = (value: number) => Math.round(value * 100) / 100;

export type FundTotals = {
  opening: number;
  received: number;
  receivedBySource: Record<string, number>;
  spent: number;
  spentByCategory: Record<string, number>;
  remitted: number;
  expected: number;
  actual: number | null;
  variance: number | null;
  /** Other money in: not sales income, flagged to the owner. */
  otherIn: number;
  counts: { in: number; expense: number; out: number };
  pending: number;
};

export function fundTotals(opening: number, txns: FundTxn[], actual: number | null, settings: FundSettings): FundTotals {
  const live = txns.filter((txn) => txn.status !== "voided");
  const receivedBySource: Record<string, number> = {};
  const spentByCategory: Record<string, number> = {};
  let received = 0;
  let spent = 0;
  let remitted = 0;
  let otherIn = 0;
  const counts = { in: 0, expense: 0, out: 0 };
  for (const txn of live) {
    if (MONEY_IN_KINDS.includes(txn.kind)) {
      received += txn.amount;
      receivedBySource[txn.kind] = round((receivedBySource[txn.kind] ?? 0) + txn.amount);
      if (txn.kind === "other_in") otherIn += txn.amount;
      counts.in += 1;
    } else if (txn.kind === "expense") {
      spent += txn.amount;
      const key = txn.category ?? "other";
      spentByCategory[key] = round((spentByCategory[key] ?? 0) + txn.amount);
      counts.expense += 1;
    } else if (txn.kind === "remittance_out") {
      remitted += txn.amount;
      counts.out += 1;
    }
  }
  const expected = round(opening + received - spent - remitted);
  return {
    opening: round(opening),
    received: round(received),
    receivedBySource,
    spent: round(spent),
    spentByCategory,
    remitted: round(remitted),
    expected,
    actual: actual === null || actual === undefined ? null : round(actual),
    variance: actual === null || actual === undefined ? null : round(actual - expected),
    otherIn: round(otherIn),
    counts,
    pending: live.filter((txn) => txn.status === "returned" || missingProof(txn, settings) !== null).length
  };
}

/**
 * Can this week's money still be changed? Only while the company week is with
 * the manager. Once it is with the owner, or locked, it is frozen; after a
 * lock, changes go through an adjustment request.
 */
export function fundsEditable(companyStatus: string | null, weekLocked: boolean): { ok: true } | { ok: false; error: string } {
  if (weekLocked || companyStatus === "locked") return { ok: false, error: "This week is locked. Ask the owner for an adjustment instead." };
  if (companyStatus === "submitted_to_owner") return { ok: false, error: "This week is with the owner. Nothing can change until the owner returns it." };
  return { ok: true };
}

/** What blocks "Submit to Owner" on the money side. Empty = ready. */
export function fundsReadiness(totals: FundTotals, varianceExplanation: string | null): string[] {
  const problems: string[] = [];
  if (totals.actual === null) problems.push("Enter the actual balance you are holding.");
  else if (Math.abs(totals.variance ?? 0) >= 0.01 && String(varianceExplanation ?? "").trim().length < 5) {
    problems.push("Explain the difference between the expected and actual balance.");
  }
  if (totals.pending > 0) problems.push(`${totals.pending} transaction${totals.pending === 1 ? " needs" : "s need"} proof or a correction.`);
  return problems;
}

/**
 * What logging a customer payment does to the order, by the SAME rules as the
 * order screen's remittance (backend/src/routes/orders.ts): expected = amount -
 * delivery fee (0 if Failed/Cancelled); any short or excess needs an Admin or
 * the Owner and a reason; a settled order is locked except to the Owner.
 */
export function customerPaymentEffect(input: {
  orderAmount: number;
  logisticsCost: number;
  alreadyRemitted: number;
  orderStatus: string;
  remittanceStatus: string | null;
  editOpen: boolean;
  payment: number;
  role: string;
}): { ok: true; nextRemitted: number; nextStatus: "Paid" | "Partial"; variance: number; needsReason: boolean } | { ok: false; error: string } {
  if (input.remittanceStatus === "Paid" && !input.editOpen && input.role !== "Owner") {
    return { ok: false, error: "This order is already fully paid and locked. Ask the Owner to open it for correction." };
  }
  const failed = input.orderStatus === "Failed" || input.orderStatus === "Cancelled";
  const expected = failed ? 0 : Math.max(0, round(input.orderAmount - input.logisticsCost));
  const nextRemitted = round(input.alreadyRemitted + input.payment);
  const variance = round(nextRemitted - expected);
  const privileged = input.role === "Owner" || input.role === "Admin";
  if (variance !== 0 && !privileged) {
    return {
      ok: false,
      error: variance > 0
        ? `That is more than the order's balance (₦${Math.max(0, round(expected - input.alreadyRemitted)).toLocaleString("en-NG")}). Excess cash must be recorded by an Admin or the Owner.`
        : `That leaves ₦${Math.abs(variance).toLocaleString("en-NG")} unpaid on the order. Part payments must be recorded by an Admin or the Owner.`
    };
  }
  return { ok: true, nextRemitted, nextStatus: nextRemitted >= expected ? "Paid" : "Partial", variance, needsReason: variance !== 0 };
}

/**
 * A rider / logistics fee the manager pays for orders whose delivery fee is
 * already on the order (Bright, 3 Oct 2026). The order's fee is already a
 * "Delivery" expense (EXP-DEL-<order>), so only the part ABOVE the fees still
 * unclaimed is a new cost; the rest is the same money, paid from the wallet.
 * `claimedByOthers` = what other wallet entries already matched to these fees.
 */
export function logisticsSplit(amount: number, orderFees: number, claimedByOthers: number): { counted: number; newCost: number } {
  const pool = Math.max(0, round(orderFees - Math.max(0, claimedByOthers)));
  const counted = round(Math.min(Math.max(0, amount), pool));
  return { counted, newCost: round(Math.max(0, amount) - counted) };
}
