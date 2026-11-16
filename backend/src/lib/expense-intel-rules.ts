/**
 * Expense & Cost Intelligence rules (Bright, 16 Nov 2026). Pure, tested.
 *
 * Who may record vs request, who may approve what, and how a saved expense is
 * marked. Owner/Admin/Manager record with no approval; an Accountant's expense
 * waits as a request until an allowed approver decides it.
 */

export const APPROVER_ROLES = ["Owner", "Admin", "Manager"] as const;
export type ApproverRole = (typeof APPROVER_ROLES)[number];
export type ApprovalRule = { upTo: number | null; role: ApproverRole };

export const DEFAULT_APPROVAL_RULES: ApprovalRule[] = [
  { upTo: 25_000, role: "Manager" },
  { upTo: 100_000, role: "Admin" },
  { upTo: null, role: "Owner" }
];

const RANK: Record<ApproverRole, number> = { Manager: 1, Admin: 2, Owner: 3 };

/** The lowest role that may approve this amount (the first rule it fits). */
export function approverFor(amount: number, rules: ApprovalRule[] = DEFAULT_APPROVAL_RULES): ApproverRole {
  const sorted = [...rules].sort((a, b) => (a.upTo ?? Infinity) - (b.upTo ?? Infinity));
  for (const rule of sorted) if (rule.upTo === null || amount <= rule.upTo) return rule.role;
  return "Owner";
}

/** A higher role can always approve what a lower one may. */
export function canApprove(role: string, amount: number, rules?: ApprovalRule[]) {
  if (!(APPROVER_ROLES as readonly string[]).includes(role)) return false;
  return RANK[role as ApproverRole] >= RANK[approverFor(amount, rules)];
}

/** Booked by the system from its own source record. */
const AUTO_PREFIXES = ["EXP-DEL-", "ads-auto-", "ads-tiktok-", "incentive-", "SAL-WEEKLY-", "EXP-WB-"];
export const isAutoExpense = (id: string) => AUTO_PREFIXES.some((p) => id.startsWith(p));

/** How a newly saved expense is marked. */
export function checkStatusFor(id: string, role: string): "auto" | "verified" | "unchecked" {
  if (isAutoExpense(id)) return "auto";
  return (APPROVER_ROLES as readonly string[]).includes(role) ? "verified" : "unchecked";
}

/** Where the money came from, read from how the row was made. */
export function paymentSourceOf(row: { id: string; paid_by?: string | null; category?: string | null }) {
  const id = row.id;
  if (id.startsWith("MGRF-")) return "Manager Wallet";
  if (id.startsWith("EXP-DEL-")) return "Agent";
  if (id.startsWith("ads-auto-") || id.startsWith("ads-tiktok-")) return "Company";
  if (id.startsWith("SAL-WEEKLY-") || id.startsWith("incentive-")) return "Payroll";
  const paid = String(row.paid_by ?? "").trim();
  if (/supplier/i.test(paid)) return "Supplier";
  if (/agent/i.test(paid)) return "Agent";
  if (/wallet/i.test(paid)) return "Manager Wallet";
  return "Company";
}

export const PAYMENT_SOURCES = ["Company", "Manager Wallet", "Agent", "Supplier", "Payroll"] as const;
export const DEPARTMENTS = ["Operations & Fulfillment", "Marketing & Growth", "Sales & Customer Support", "Administration", "Inventory & Procurement", "Others"] as const;

/** Default department of a category (Owner can change it in settings). */
export function departmentOf(category: string, overrides: Record<string, string> = {}) {
  if (overrides[category]) return overrides[category];
  const c = category.toLowerCase();
  if (/delivery|waybill|logistic|pickup/.test(c)) return "Operations & Fulfillment";
  if (/ad spend|advert|marketing/.test(c)) return "Marketing & Growth";
  if (/salary|bonus|incentive|commission/.test(c)) return "Sales & Customer Support";
  if (/clearing|shipping|stock|cogs|procure|purchase/.test(c)) return "Inventory & Procurement";
  if (/airtime|data|office|utilit|software|subscription|rent/.test(c)) return "Administration";
  return "Others";
}

/** Next request code: EXP-REQ-0001, EXP-REQ-0002, … */
export function nextRequestCode(existing: string[]) {
  const max = existing.reduce((m, code) => { const n = Number(/^EXP-REQ-(\d+)$/.exec(code)?.[1] ?? 0); return n > m ? n : m; }, 0);
  return `EXP-REQ-${String(max + 1).padStart(4, "0")}`;
}

export type ImportRow = { date: string; category: string; amount: number; description: string; productName?: string; paidBy?: string };

/**
 * One CSV line per expense: date, category, amount, description[, product][, paid by].
 * Header row optional. Returns rows and plain problems by line number.
 */
export function parseExpenseCsv(text: string): { rows: ImportRow[]; problems: string[] } {
  const rows: ImportRow[] = [];
  const problems: string[] = [];
  const lines = text.replace(/\r/g, "").split("\n");
  lines.forEach((raw, index) => {
    const line = raw.trim();
    if (!line) return;
    const cells = splitCsv(line);
    if (index === 0 && /date/i.test(cells[0] ?? "") && /amount/i.test(cells.join(","))) return;
    const [date, category, amountText, description = "", productName = "", paidBy = ""] = cells.map((c) => c.trim());
    const n = index + 1;
    const iso = toIsoDate(date ?? "");
    const amount = Number(String(amountText ?? "").replace(/[₦,\s]/g, ""));
    if (!iso) { problems.push(`Line ${n}: date "${date}" — use YYYY-MM-DD or DD/MM/YYYY.`); return; }
    if (!category) { problems.push(`Line ${n}: no category.`); return; }
    if (!(amount > 0)) { problems.push(`Line ${n}: amount "${amountText}" is not a number above 0.`); return; }
    rows.push({ date: iso, category, amount, description, productName: productName || undefined, paidBy: paidBy || undefined });
  });
  return { rows, problems };
}

function splitCsv(line: string) {
  const out: string[] = [];
  let cur = "", quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') { if (quoted && line[i + 1] === '"') { cur += '"'; i += 1; } else quoted = !quoted; }
    else if (ch === "," && !quoted) { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

function toIsoDate(text: string) {
  const t = text.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return null;
}
