// One customer, two reps (Bright, 26 Nov 2026: "always inform the sales rep
// and head of sales about a customer that placed two different products, so
// they know another rep has the same customer ... this should cover abandoned
// carts as well"). Pure rules here (tested); same-customer-alerts.ts sends.
//
// A different-product repeat is NOT held (public-orders.ts holds same-product
// repeats only), so round-robin can hand it to another rep - #6411 Chelsea /
// #6412 Esther, same phone number, 26 Nov 2026.

export type CustomerRecord = {
  kind: "order" | "cart"; id: string; phone10: string; repId: string; repName: string;
  customer: string; product: string; createdAt: string;
};
export type SplitCustomer = { phone10: string; customer: string; records: CustomerRecord[] };

/** Last 10 digits of a Nigerian number, or "" when there are not 10 digits. */
export const phone10 = (phone: unknown) => {
  const digits = String(phone ?? "").replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : "";
};
export const phoneLabel = (p10: string) => `0${p10}`;

/** Customers (same phone) whose orders / open carts sit with 2+ different reps. */
export function splitCustomers(records: CustomerRecord[]): SplitCustomer[] {
  const byPhone = new Map<string, CustomerRecord[]>();
  for (const r of records) {
    if (!r.phone10 || !r.repId) continue;
    byPhone.set(r.phone10, [...(byPhone.get(r.phone10) ?? []), r]);
  }
  const out: SplitCustomer[] = [];
  for (const [p10, list] of byPhone) {
    if (new Set(list.map((r) => r.repId)).size < 2) continue;
    const sorted = [...list].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    out.push({ phone10: p10, customer: sorted.find((r) => r.customer.trim())?.customer.trim() || "A customer", records: sorted });
  }
  return out;
}

const label = (r: CustomerRecord) => r.kind === "order" ? `order #${r.id}${r.product ? ` (${r.product})` : ""}` : `an abandoned cart${r.product ? ` (${r.product})` : ""}`;
/** Stable id of this exact situation: a new order/cart joining makes a new one. */
export const situationKey = (s: SplitCustomer) => `${s.phone10}:${s.records.map((r) => `${r.kind[0]}${r.id}`).join(",")}`;

/** What one rep is told: who else has this customer, and what to do. */
export function repMessage(s: SplitCustomer, repId: string) {
  const mine = s.records.filter((r) => r.repId === repId);
  const others = s.records.filter((r) => r.repId !== repId);
  const otherReps = [...new Set(others.map((r) => r.repName))];
  return {
    title: `Same customer: ${s.customer} is also with ${otherReps.join(" and ")}`,
    message: `${s.customer} (${phoneLabel(s.phone10)}) has ${mine.map(label).join(" and ")} with you, and ${others.map((r) => `${label(r)} with ${r.repName}`).join(", ")}. Agree with ${otherReps.join(" and ")} who calls them, so the customer gets one call and one delivery.`,
    mine
  };
}

/** What the Head of Sales / Manager is told: the whole picture, to decide. */
export function supervisorMessage(s: SplitCustomer) {
  const reps = [...new Set(s.records.map((r) => r.repName))];
  return {
    title: `${s.customer} is with ${reps.length} reps`,
    message: `${s.customer} (${phoneLabel(s.phone10)}): ${s.records.map((r) => `${r.kind === "order" ? `#${r.id}` : "cart"} ${r.repName}${r.product ? ` (${r.product})` : ""}`).join(" · ")}. Decide who handles this customer and tell the reps.`
  };
}
