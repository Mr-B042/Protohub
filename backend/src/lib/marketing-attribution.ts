const MARKETING_ORDER_SCOPE_FIELDS = [
  "utm_source",
  "utm_campaign",
  "utm_medium",
  "utm_content",
  "utm_term"
];

const MARKETING_CART_SCOPE_FIELDS = ["source"];

const MARKETING_JSON_KEYS = [
  "media_buyer",
  "mediaBuyer",
  "media_buyer_id",
  "mediaBuyerId",
  "buyer",
  "buyer_id",
  "buyerId"
];

const MARKETING_USER_ID_JSON_KEYS = [
  "media_buyer_id",
  "mediaBuyerId",
  "marketer_user_id",
  "marketerUserId",
  "buyer_id",
  "buyerId"
];

const unique = (values: string[]) => Array.from(new Set(values));

export const sanitizeMarketingAttributionTags = (value: unknown): string[] => {
  const source = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[,;\n]/)
      : [];
  return unique(
    source
      .map((item) => String(item ?? "").trim())
      .filter(Boolean)
      .map((item) => item.slice(0, 80))
  ).slice(0, 40);
};

const marketerScopeVariants = (tags: unknown): string[] => {
  const variants = sanitizeMarketingAttributionTags(tags).flatMap((tag) => {
    const lower = tag.toLowerCase();
    const hyphen = lower.replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    const underscore = lower.replace(/[^a-z0-9]+/g, "_").replace(/(^_|_$)/g, "");
    return [lower, hyphen, underscore].filter(Boolean);
  });
  return unique(variants).slice(0, 80);
};

const applyMarketingScope = (
  query: any,
  tags: unknown,
  jsonColumn: "form_context" | "capture_payload",
  scalarFields: string[],
  userId?: string | null
) => {
  const variants = marketerScopeVariants(tags);
  const directUserFilters = userId
    ? MARKETING_USER_ID_JSON_KEYS.map((key) => `${jsonColumn}->>${key}.eq.${userId}`)
    : [];

  const filters = variants.flatMap((tag) => {
    // Keep common generated-link separators (`_` and `-`) intact, but avoid
    // broad contains matches. A marketer tag `chelsea` should match
    // `chelsea-main-page`, not `not_chelsea` or `chelsea2`.
    const safe = tag.replace(/[%.,()"\\]/g, "").trim();
    if (!safe) return [];
    const scalarFilters = scalarFields.flatMap((field) => [
      `${field}.ilike.${safe}`,
      `${field}.ilike.${safe}-%`,
      `${field}.ilike.${safe}_%`
    ]);
    const jsonFilters = MARKETING_JSON_KEYS.map((key) => `${jsonColumn}->>${key}.ilike.${safe}`);
    return [...scalarFilters, ...jsonFilters];
  });
  filters.push(...directUserFilters);

  if (filters.length === 0) {
    // Safe default: a Marketer without configured tags/user-id attribution should see nothing.
    return query.eq("id", "__marketer_without_valid_attribution__");
  }
  return query.or(filters.join(","));
};

export const applyOrderMarketingScope = (query: any, tags: unknown, userId?: string | null) =>
  applyMarketingScope(query, tags, "form_context", MARKETING_ORDER_SCOPE_FIELDS, userId);

export const applyCartMarketingScope = (query: any, tags: unknown, userId?: string | null) =>
  applyMarketingScope(query, tags, "capture_payload", MARKETING_CART_SCOPE_FIELDS, userId);
