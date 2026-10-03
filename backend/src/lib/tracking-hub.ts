// Tracking Hub rules (Bright, 2 Oct 2026). Pure, tested in tracking-hub.test.ts.
// The routes load and save; every number and verdict on the hub comes from here.

export type PurchaseStatus = "deduped" | "server_only" | "browser_only" | "capi_failed" | "test" | "not_tracked";

export const PURCHASE_STATUS_LABEL: Record<PurchaseStatus, string> = {
  deduped: "Deduped",
  server_only: "Server only",
  browser_only: "Browser only",
  capi_failed: "CAPI failed",
  test: "Test",
  not_tracked: "Not tracked"
};

const SENT = new Set(["sent"]);
const FAILED = new Set(["rejected", "failed", "missing_config"]);

/**
 * One order's Purchase, from what Protohub knows: the server send
 * (meta_capi_events) and the browser Pixel the WordPress embed reported
 * (tracking_browser_events). Browser and server with the SAME event id are
 * one Purchase in Meta ("deduped").
 */
export function purchaseStatus(input: { serverStatus: string | null; serverEventId: string | null; browserEventId: string | null; serverTest?: boolean }): PurchaseStatus {
  const server = input.serverStatus;
  if (server === "dry_run" || (server && SENT.has(server) && input.serverTest)) return "test";
  const serverSent = Boolean(server && SENT.has(server));
  const browser = Boolean(input.browserEventId);
  if (serverSent && browser) return input.serverEventId === input.browserEventId ? "deduped" : "server_only";
  if (serverSent) return "server_only";
  if (server && FAILED.has(server)) return "capi_failed";
  if (browser) return "browser_only";
  return "not_tracked";
}

/**
 * Meta's errors in plain words, with what to do. Bright: "Don't tell the
 * owner 'Error 190 OAuthException'. Tell them 'CAPI connection expired'."
 */
export function humanMetaError(message: string | null | undefined, httpStatus?: number | null): { title: string; action: string } {
  const text = String(message ?? "").toLowerCase();
  if (text.includes("oauth") || text.includes("access token") || text.includes("session has expired") || text.includes("code 190")) {
    return { title: "The Meta connection is not working (token expired or wrong)", action: "Create a new System User token in Meta Business Settings and paste it in Tracking Hub → Data Sources (Replace token on the connection)." };
  }
  if (text.includes("permission") || text.includes("not authorized") || text.includes("does not have permission")) {
    return { title: "The Meta token is missing a permission", action: "Give the System User access to this Pixel / ad account (ads_management or ads_read) and try again." };
  }
  if (text.includes("does not exist") || text.includes("unsupported get request") || text.includes("object with id")) {
    return { title: "Meta cannot find this Pixel or ad account", action: "Check the Pixel ID / ad account ID on the data source." };
  }
  if (text.includes("event_time") || text.includes("too old") || text.includes("in the future")) {
    return { title: "Meta refused the event's time", action: "Events older than 7 days cannot be sent. Nothing to fix unless it keeps happening." };
  }
  if (text.includes("missing") && text.includes("token")) {
    return { title: "No Meta token saved", action: "Connect your Meta Business in Tracking Hub → Data Sources, or give this Pixel its own token." };
  }
  if (httpStatus && httpStatus >= 500) return { title: "Meta was down when we sent", action: "It is retried automatically for delivered events; Purchase is not resent." };
  if (!text) return { title: "Could not reach Meta", action: "Usually a network problem. Check again later." };
  return { title: "Meta refused the event", action: String(message).slice(0, 200) };
}

// -------------------------------------------------------------- attribution

const isMetaId = (value: unknown) => typeof value === "string" && /^\d{10,22}$/.test(value.trim());

/**
 * Campaign / ad set / ad ids for an order. Ads pass them as campaign_id /
 * adset_id / ad_id, or (how Bright's ads do it today) as utm_id = campaign,
 * utm_term = ad set, utm_content = ad.
 */
/** Orders from these ad platforms carry their own long numeric ids (TikTok's
 *  utm_id 1877402734527570) that look like Meta ids but never are. */
const NON_META_SOURCE = /tiktok|google|youtube|snap|twitter|bing|pinterest/i;

export function orderAdIds(order: { form_context?: Record<string, unknown> | null; utm_content?: string | null; utm_term?: string | null; utm_campaign?: string | null; utm_source?: string | null }) {
  const ctx = order.form_context ?? {};
  if (NON_META_SOURCE.test(String(order.utm_source ?? "")) || (typeof ctx.ttclid === "string" && ctx.ttclid)) {
    return { campaignId: null, adsetId: null, adId: null };
  }
  const pick = (...values: unknown[]) => {
    for (const value of values) if (isMetaId(value)) return String(value).trim();
    return null;
  };
  return {
    campaignId: pick(ctx.campaignId, ctx.campaign_id, ctx.utmId, order.utm_campaign),
    adsetId: pick(ctx.adsetId, ctx.adset_id, order.utm_term),
    adId: pick(ctx.adId, ctx.ad_id, order.utm_content)
  };
}

export const ATTRIBUTION_FIELDS = [
  { key: "fbclid", label: "fbclid" },
  { key: "fbp_fbc", label: "_fbp / _fbc" },
  { key: "campaign", label: "Campaign ID" },
  { key: "adset", label: "Ad Set ID" },
  { key: "ad", label: "Ad ID" },
  { key: "utm", label: "UTM Parameters" },
  { key: "landing", label: "Landing Page URL" },
  { key: "device", label: "Referrer & Device Info" }
] as const;

/** Share of ad orders where each piece of attribution was captured. */
export function attributionCapture(orders: Array<{ form_context?: Record<string, unknown> | null; utm_source?: string | null; utm_content?: string | null; utm_term?: string | null; utm_campaign?: string | null; referrer?: string | null }>) {
  const fromAds = orders.filter((order) => {
    const ctx = order.form_context ?? {};
    return Boolean(ctx.fbclid || ctx.utmId || ctx.campaignId) || /^(fb|ig|facebook|instagram|meta|an|msg)$/i.test(String(order.utm_source ?? ""));
  });
  const total = fromAds.length;
  const has = (test: (order: typeof orders[number]) => boolean) => (total ? Math.round((fromAds.filter(test).length / total) * 1000) / 10 : 0);
  const ctx = (order: typeof orders[number]) => order.form_context ?? {};
  const urlHas = (order: typeof orders[number], key: string) => String(ctx(order).landingUrl ?? "").includes(`${key}=`);
  return {
    orders: total,
    fields: {
      fbclid: has((order) => Boolean(ctx(order).fbclid) || urlHas(order, "fbclid")),
      fbp_fbc: has((order) => Boolean(ctx(order).fbp || ctx(order).fbc) || urlHas(order, "fbp") || urlHas(order, "fbc")),
      campaign: has((order) => Boolean(orderAdIds(order).campaignId)),
      adset: has((order) => Boolean(orderAdIds(order).adsetId)),
      ad: has((order) => Boolean(orderAdIds(order).adId)),
      utm: has((order) => Boolean(order.utm_source && order.utm_campaign)),
      landing: has((order) => Boolean(order.referrer || ctx(order).landingPageUrl)),
      device: has((order) => Boolean(ctx(order).userAgent || ctx(order).deviceType))
    } as Record<typeof ATTRIBUTION_FIELDS[number]["key"], number>
  };
}

export function domainOf(url: string | null | undefined): string | null {
  const raw = String(url ?? "").trim();
  if (!raw) return null;
  try {
    return new URL(raw.includes("://") ? raw : `https://${raw}`).hostname.replace(/^www\./, "").toLowerCase() || null;
  } catch {
    return null;
  }
}

export function pathOf(url: string | null | undefined): string | null {
  try {
    const parsed = new URL(String(url ?? ""));
    // "/shelf/" and "/shelf" are the same page (the page-view count drops the slash too).
    return parsed.pathname.replace(/\/+$/, "") || "/";
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------- health

export type HealthItem = { key: string; label: string; total: number; healthy: number; detail: string };

/** Share of healthy items across every check (sources, websites, links, dedup, CAPI). */
export function healthScore(items: HealthItem[]): number {
  const total = items.reduce((sum, item) => sum + item.total, 0);
  if (total === 0) return 0;
  return Math.round((items.reduce((sum, item) => sum + Math.min(item.healthy, item.total), 0) / total) * 1000) / 10;
}

// ----------------------------------------------------------- reconciliation

/**
 * Why Protohub and Meta differ for a campaign. Bright: a difference should
 * start an investigation, not be called a Pixel error - Meta applies its own
 * attribution, Protohub records the order and the ids it carried.
 */
export function reconciliationVerdict(input: {
  protohubOrders: number; purchaseEvents: number; sentToMeta: number; duplicates: number; metaPurchases: number | null;
}): { tone: "ok" | "warn" | "info"; conclusion: string; likely: string } {
  if (input.metaPurchases === null) {
    return { tone: "info", conclusion: "Meta's number is not loaded for this campaign.", likely: "Refresh from Meta, or check the ad account is on a data source." };
  }
  const diff = input.metaPurchases - input.protohubOrders;
  const tolerance = Math.max(1, Math.round(input.protohubOrders * 0.05));
  if (Math.abs(diff) <= tolerance) {
    return { tone: "ok", conclusion: `Meta and Protohub agree within ${tolerance}.`, likely: "Nothing to investigate." };
  }
  if (diff > 0) {
    const extraFromUs = Math.max(0, input.sentToMeta - input.protohubOrders) + input.duplicates;
    if (extraFromUs === 0) {
      return {
        tone: "warn",
        conclusion: `Protohub did not generate ${diff} additional Purchase event${diff === 1 ? "" : "s"}.`,
        likely: "Meta attribution (view-through or a different window) or another source firing Purchase, such as a thank-you page Pixel."
      };
    }
    return { tone: "warn", conclusion: `${extraFromUs} of the ${diff} extra purchases may come from repeat sends.`, likely: "Check the repeat events in the ledger." };
  }
  const notSent = Math.max(0, input.protohubOrders - input.sentToMeta);
  return {
    tone: "warn",
    conclusion: `Meta shows ${-diff} fewer purchase${diff === -1 ? "" : "s"} than Protohub orders.`,
    likely: notSent > 0
      ? `${notSent} order${notSent === 1 ? " was" : "s were"} not sent to Meta by the server - check the CAPI status in the ledger.`
      : "Meta could not match some purchases to an ad click (missing fbclid/fbp), or counts them under another campaign."
  };
}

// ── Which product a Meta campaign is for (Bright, 3 Oct 2026) ────────────────
// Used for the Reconciliation "By product" totals when no order ties a
// campaign to a product. ⚠️ Reconciliation shows FACTS only: it never guesses
// which campaign Meta credited a sale to (Meta does not say).

const wordsOf = (text: string) => [
  // "5-in-1" is one word: the 5 alone also names "5-Slot Toothbrush Holder".
  ...(text.toLowerCase().match(/\d+\s*-?\s*in\s*-?\s*\d+/g) ?? []).map((phrase) => phrase.replace(/[^a-z0-9]/g, "")),
  ...(text.toLowerCase().match(/[a-z]+|\d+/g) ?? [])
    .map((word) => (word.length > 3 && word.endsWith("s") ? word.slice(0, -1) : word))
    .filter((word) => word.length >= 3 || /^\d+$/.test(word))
];

/** The product a campaign / ad name points at, by words only that product has. */
export function productFromName(name: string | null | undefined, products: Array<{ id: string; name: string }>): string | null {
  if (!name) return null;
  const counts = new Map<string, number>();
  const tokens = products.map((product) => new Set(wordsOf(product.name)));
  for (const set of tokens) for (const word of set) counts.set(word, (counts.get(word) ?? 0) + 1);
  const wanted = new Set(wordsOf(name));
  let best: string | null = null;
  let bestScore = 0;
  let tie = false;
  products.forEach((product, index) => {
    const score = Array.from(tokens[index]).filter((word) => counts.get(word) === 1 && wanted.has(word)).length;
    if (score > bestScore) { best = product.id; bestScore = score; tie = false; } else if (score > 0 && score === bestScore) tie = true;
  });
  return bestScore > 0 && !tie ? best : null;
}
