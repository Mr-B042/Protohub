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
