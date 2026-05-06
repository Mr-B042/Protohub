// Deep snake_case → camelCase converter for API responses.
// Backend (Supabase / Postgres) returns columns like `created_at`, `product_id`.
// The frontend types are camelCase (`createdAt`, `productId`). This helper
// renames keys recursively so responses match expected shapes without each
// caller having to remap by hand.
//
// Only object KEYS are converted. String/number/boolean values are left as-is,
// so values that happen to contain underscores (e.g. utm tags like `summer_sale`)
// are preserved exactly.
//
// Already-camelCase responses are no-ops because the regex only matches `_x`.

const camelKey = (key: string): string =>
  key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

export function snakeToCamel<T = unknown>(value: unknown): T {
  if (Array.isArray(value)) {
    return value.map((item) => snakeToCamel(item)) as T;
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[camelKey(k)] = snakeToCamel(v);
    }
    return out as T;
  }
  return value as T;
}
