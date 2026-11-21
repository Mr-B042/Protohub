/**
 * Words for customer order emails (21 Nov 2026, "open rate is low").
 * Customers don't know "Protohub": subjects name THEM and THEIR product,
 * in plain words, instead of "Protohub update — order 6037 is now Postponed".
 */

export function firstNameOf(customer: string | null | undefined) {
  const first = String(customer ?? "").trim().split(/\s+/)[0] ?? "";
  // "Mrs", "Mr", "Dr" alone isn't a name to greet someone by.
  if (!first || /^(mr|mrs|ms|miss|dr|engr|chief|pastor|madam|sir)\.?$/i.test(first)) return "";
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}

const lead = (first: string, rest: string) =>
  first ? `${first}, ${rest}` : rest.charAt(0).toUpperCase() + rest.slice(1);

/** Subject for an order status email. */
export function statusSubject(customer: string | null | undefined, product: string, status: string) {
  const first = firstNameOf(customer);
  const item = product.trim() || "order";
  switch (status.trim().toLowerCase()) {
    case "confirmed": return lead(first, `your ${item} order is confirmed ✓`);
    case "postponed": return lead(first, `your ${item} has a new delivery day`);
    case "failed": return lead(first, `we couldn't deliver your ${item}`);
    case "cancelled": return lead(first, `your ${item} order was cancelled`);
    default: return lead(first, `an update on your ${item} order`);
  }
}

/** Subject for the plain "we got your order" email (used when the e-receipt can't be made). */
export const newOrderSubject = (customer: string | null | undefined, product: string) =>
  lead(firstNameOf(customer), `we got your ${product.trim() || "order"} order ✓`);

/** Subject for the plain "delivered" email (used when the e-receipt can't be made). */
export const deliveredSubject = (customer: string | null | undefined, product: string) =>
  lead(firstNameOf(customer), `your ${product.trim() || "order"} has been delivered 💙`);

/** Mailjet soft bounces (full inbox, server down) before we stop emailing that address. */
export const SOFT_BOUNCE_LIMIT = 3;
