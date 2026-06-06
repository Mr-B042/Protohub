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
  scalarFields: string[]
) => {
  const variants = marketerScopeVariants(tags);
  if (variants.length === 0) {
    // Safe default: a Marketer without configured tags should see nothing.
    return query.eq("id", "__marketer_without_attribution_tags__");
  }

  const filters = variants.flatMap((tag) => {
    const safe = tag.replace(/[%_.,()"\\]/g, "");
    if (!safe) return [];
    const scalarFilters = scalarFields.map((field) => `${field}.ilike.%${safe}%`);
    const jsonFilters = MARKETING_JSON_KEYS.map((key) => `${jsonColumn}->>${key}.ilike.%${safe}%`);
    return [...scalarFilters, ...jsonFilters];
  });

  if (filters.length === 0) return query.eq("id", "__marketer_without_valid_attribution_tags__");
  return query.or(filters.join(","));
};

export const applyOrderMarketingScope = (query: any, tags: unknown) =>
  applyMarketingScope(query, tags, "form_context", MARKETING_ORDER_SCOPE_FIELDS);

export const applyCartMarketingScope = (query: any, tags: unknown) =>
  applyMarketingScope(query, tags, "capture_payload", MARKETING_CART_SCOPE_FIELDS);
