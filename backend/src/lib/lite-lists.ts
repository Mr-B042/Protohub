/**
 * Lighter order / cart lists (Bright, 30 Oct 2026: "the web app is slow and
 * hangs on low-end phones and laptops"). Every device loaded all orders and
 * all carts with every field - about 50 MB, growing daily. The biggest part is
 * the order form's context: the full landing link, the browser's description
 * of itself and a few session details, shown ONLY in the order / cart detail
 * window. With ?lite=1 the lists leave those out and say so
 * (form_context_trimmed); the detail window fetches the full record by id.
 */
export const DISPLAY_ONLY_FORM_KEYS = [
  "landingUrl", "userAgent", "formVersion", "clientTimezone", "clientLocale", "contextEvent", "deviceType",
  // Not read by any screen.
  "metaLeadEventId", "productCacheStatus", "settingsCacheStatus", "visitorId"
] as const;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

export function trimFormContext(context: unknown): unknown {
  if (!isPlainObject(context)) return context;
  const copy: Record<string, unknown> = { ...context };
  for (const key of DISPLAY_ONLY_FORM_KEYS) delete copy[key];
  return copy;
}

export const liteOrder = (row: any) => (isPlainObject(row?.form_context)
  ? { ...row, form_context: trimFormContext(row.form_context), form_context_trimmed: true }
  : row);

export const liteCart = (row: any) => (isPlainObject(row?.capture_payload) && isPlainObject(row.capture_payload.formContext)
  ? { ...row, capture_payload: { ...row.capture_payload, formContext: trimFormContext(row.capture_payload.formContext) }, form_context_trimmed: true }
  : row);
