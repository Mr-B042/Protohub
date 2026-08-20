export const uniqueMergedCartIds = (
  values: unknown[],
  survivorId: string
): string[] => {
  const unique = new Set<string>();

  for (const value of values) {
    if (typeof value !== "string") continue;
    const cartId = value.trim();
    if (!cartId || cartId === survivorId) continue;
    unique.add(cartId);
  }

  return Array.from(unique);
};

/**
 * Is this phone value usable as an IDENTITY for merging two carts?
 *
 * ⚠️ The order form writes a human placeholder when the shopper has not typed
 * a number yet. That sentence was being stored in `abandoned_carts.phone` and
 * then matched like a real number, so every phoneless cart looked like the
 * same person: on 2026-08-20 one shopper's cart absorbed a completely separate
 * session that arrived 42 minutes later from a different IP on a different
 * Instagram campaign, and was then marked Converted against a stranger's order.
 *
 * A partial number is just as dangerous - "080" matches nothing useful and
 * everything badly - so the bar is a full subscriber number's worth of digits.
 * This is the same rule the late-phone dedupe already applied; it simply was
 * not applied at insert time, which is where the damage happened.
 */
export const MIN_DEDUP_PHONE_DIGITS = 10;

export const isDedupablePhone = (phone: unknown): boolean =>
  String(phone ?? "").replace(/\D/g, "").length >= MIN_DEDUP_PHONE_DIGITS;
