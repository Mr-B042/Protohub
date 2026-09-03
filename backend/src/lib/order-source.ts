export const ORDER_SOURCES = ["TikTok", "Facebook", "Instagram", "Messenger", "Audience Network", "Threads", "WhatsApp", "Website", "Direct"] as const;
export type OrderSource = typeof ORDER_SOURCES[number];

// Map a UTM source to an order source. Meta ads run across placements — the
// utm_source carries Facebook's {{site_source_name}} macro: fb=Facebook,
// ig=Instagram, an=Audience Network, th=Threads, ms=Messenger. Recognise each
// (exact short code first, then full names) so paid-ad orders aren't all
// collapsed into "Website". Mirrors the frontend orderSourceFromUtm.
export function sourceFromUtm(utm: string | undefined): OrderSource {
  const s = (utm ?? "").trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
  if (s === "tt" || s.includes("tiktok")) return "TikTok";
  if (s === "ig" || s.includes("instagram") || s.includes("insta")) return "Instagram";
  if (s === "an" || s.includes("audience network")) return "Audience Network";
  if (s === "ms" || s.includes("messenger")) return "Messenger";
  if (s === "th" || s.includes("threads")) return "Threads";
  if (s === "wa" || s.includes("whatsapp")) return "WhatsApp";
  if (s === "fb" || s.includes("facebook") || s.includes("meta")) return "Facebook";
  if (s.includes("web") || s.includes("organic") || s.includes("embed")) return "Website";
  if (!s || s === "direct" || s === "none") return "Direct";
  return "Website";
}

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

/**
 * The network a click ID proves the visit came from.
 *
 * ⚠️ ONLY CONSULTED WHEN THE LINK CARRIED NO utm_source. An ad link tagged with
 * Facebook's {{site_source_name}} macro says fb / ig / an / ms / th exactly, and
 * that always wins - a click ID cannot tell those apart. This is the floor, not
 * the preference.
 *
 * Why it exists: an ad pointed at an untagged embed URL still arrives with the
 * click ID Facebook appends itself, so the visit is provably NOT direct. Order
 * 3992 landed on
 *   .../embed?product=...&embed_label=FX2+Edge+Brusher+Max&fbclid=IwAR78...
 * with no utm_source at all, defaulted to "direct", and was filed as a Direct
 * order despite Facebook's own click ID sitting in the same query string.
 * 54 orders since 14 June went that way.
 *
 * fbclid is stamped across every Meta surface, so it proves the family and not
 * the placement: these land as Facebook, which is how this file already treats
 * a bare "meta". Exact placement needs the macro on the link.
 */
export function sourceFromClickIds(clickIds: {
  fbclid?: unknown; gclid?: unknown; gbraid?: unknown; wbraid?: unknown;
  ttclid?: unknown; msclkid?: unknown;
}): OrderSource | null {
  const present = (value: unknown) => typeof value === "string" && value.trim().length > 0;
  if (present(clickIds.ttclid)) return "TikTok";
  if (present(clickIds.fbclid)) return "Facebook";
  // Google and Microsoft have no source of their own in ORDER_SOURCES, but
  // they are still not Direct - Website is the honest bucket for them.
  if (present(clickIds.gclid) || present(clickIds.gbraid) || present(clickIds.wbraid) || present(clickIds.msclkid)) return "Website";
  return null;
}

/**
 * The order's source, using the click IDs the form captured as a fallback.
 * A tagged link always decides; an untagged one falls back to what the click ID
 * proves; only a visit with neither is Direct.
 */
export function resolveOrderSource(utm: string | undefined, formContext: unknown): OrderSource {
  const fromUtm = sourceFromUtm(utm);
  if (fromUtm !== "Direct") return fromUtm;
  const context = asRecord(formContext);
  return sourceFromClickIds({
    fbclid: context.fbclid, gclid: context.gclid, gbraid: context.gbraid,
    wbraid: context.wbraid, ttclid: context.ttclid, msclkid: context.msclkid
  }) ?? fromUtm;
}
