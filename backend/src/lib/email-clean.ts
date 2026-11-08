// ── A customer's email from the order form (Bright, 8 Nov 2026) ───────────
// The Email box is optional, so a mistyped address ("ada@gmail", "ada gmail.com")
// is dropped, never a reason to refuse the order or lose the cart. Used by the
// order and cart routes and by Email Marketing.

/** The same test as the email_contacts check in the Email Marketing migration. */
export const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/;

/** A usable email, lower-cased, or null. */
export function cleanEmail(raw: unknown): string | null {
  const value = String(raw ?? "").trim().toLowerCase();
  if (!value || value.length > 254) return null;
  return EMAIL_PATTERN.test(value) ? value : null;
}
