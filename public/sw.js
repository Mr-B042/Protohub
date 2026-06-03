// ProtoHub Service Worker — Push Notifications + WebAPK install criteria
const CACHE_NAME = "protohub-v9-simple-push-handler";
const PUSH_BRANDING_CACHE = "protohub-push-branding-v1";
const PUSH_BRANDING_KEY = "/__protohub_push_branding__";
const DEFAULT_BRAND_NAME = "Protohub";
const DEFAULT_BADGE = "/icons/icon-72.png";
const DYNAMIC_MANIFEST_PATH = "/org-manifest.webmanifest";
const DYNAMIC_ICON_192_PATH = "/org-icons/app-192";
const DYNAMIC_ICON_512_PATH = "/org-icons/app-512";

const PUSH_PRESENTATION = {
  order_new:               { icon: "/icons/notifications/order-new.png",            color: "#1F8FE0", requireInteraction: false, vibrate: [120, 50, 120],  defaultTitle: "New Order" },
  order_confirmed:         { icon: "/icons/notifications/order-confirmed.png",      color: "#0F9F6E", requireInteraction: false, vibrate: [100, 40, 100],  defaultTitle: "Order Confirmed" },
  order_delivered:         { icon: "/icons/notifications/order-delivered.png",      color: "#11935A", requireInteraction: false, vibrate: [160, 60, 140],  defaultTitle: "Order Delivered" },
  order_cancelled:         { icon: "/icons/notifications/order-cancelled.png",      color: "#D14343", requireInteraction: true,  vibrate: [200, 70, 200],  defaultTitle: "Order Cancelled" },
  order_failed:            { icon: "/icons/notifications/order-failed.png",         color: "#C43C4E", requireInteraction: true,  vibrate: [220, 80, 220],  defaultTitle: "Order Failed" },
  order_rescheduled:       { icon: "/icons/notifications/order-rescheduled.png",    color: "#7A4FE0", requireInteraction: false, vibrate: [120, 50, 180],  defaultTitle: "Order Rescheduled" },
  order_assigned:          { icon: "/icons/notifications/order-assigned.png",       color: "#0C7B93", requireInteraction: false, vibrate: [90, 40, 90],    defaultTitle: "Order Assigned" },
  low_stock:               { icon: "/icons/notifications/low-stock.png",            color: "#D97706", requireInteraction: true,  vibrate: [240, 90, 180],  defaultTitle: "Low Stock Alert" },
  remittance_overdue:      { icon: "/icons/notifications/remittance-overdue.png",   color: "#C2410C", requireInteraction: true,  vibrate: [260, 100, 200], defaultTitle: "Remittance Overdue" },
  stale_carts:             { icon: "/icons/notifications/stale-carts.png",          color: "#C26B14", requireInteraction: true,  vibrate: [200, 80, 160],  defaultTitle: "Stale Abandoned Carts" },
  abandoned_cart_new:      { icon: "/icons/notifications/stale-carts.png",          color: "#F59E0B", requireInteraction: false, vibrate: [120, 50, 120],  defaultTitle: "Abandoned Cart" },
  waybill_dispatched:      { icon: "/icons/notifications/waybill.png",              color: "#3F5CE8", requireInteraction: false, vibrate: [110, 40, 110],  defaultTitle: "Waybill Dispatched" },
  waybill_updated:         { icon: "/icons/notifications/waybill.png",              color: "#3F5CE8", requireInteraction: false, vibrate: [110, 40, 110],  defaultTitle: "Waybill Updated" },
  waybill_status_changed:  { icon: "/icons/notifications/waybill.png",              color: "#3F5CE8", requireInteraction: false, vibrate: [110, 40, 110],  defaultTitle: "Waybill Update" },
  test_push:               { icon: "/icons/notifications/test-push.png",            color: "#1F8FE0", requireInteraction: false, vibrate: [80, 40, 80],    defaultTitle: "Test Push" },
  info:                    { icon: "/icons/notifications/info.png",                 color: "#1F8FE0", requireInteraction: false, vibrate: [90, 40, 90],    defaultTitle: "Notification" }
};

function sanitizeBrandLogo(value) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("data:image/") || /^https?:\/\//i.test(trimmed) || trimmed.startsWith("/")) {
    return trimmed;
  }
  return "";
}

function presentationForKind(kind) {
  return PUSH_PRESENTATION[kind] || PUSH_PRESENTATION.info;
}

function withBrandTitle(title, brandName) {
  if (!brandName) return title;
  if (title.startsWith(`${brandName} · `)) return title;
  return `${brandName} · ${title}`;
}

async function readPushBranding() {
  const cache = await caches.open(PUSH_BRANDING_CACHE);
  const response = await cache.match(PUSH_BRANDING_KEY);
  if (!response) return { brandName: DEFAULT_BRAND_NAME, logoUrl: "" };
  try {
    const data = await response.json();
    return {
      brandName: typeof data?.brandName === "string" && data.brandName.trim() ? data.brandName.trim() : DEFAULT_BRAND_NAME,
      logoUrl: sanitizeBrandLogo(data?.logoUrl)
    };
  } catch {
    return { brandName: DEFAULT_BRAND_NAME, logoUrl: "" };
  }
}

async function writePushBranding(branding) {
  const cache = await caches.open(PUSH_BRANDING_CACHE);
  await cache.put(
    PUSH_BRANDING_KEY,
    new Response(JSON.stringify({
      brandName: typeof branding?.brandName === "string" && branding.brandName.trim() ? branding.brandName.trim() : DEFAULT_BRAND_NAME,
      logoUrl: sanitizeBrandLogo(branding?.logoUrl)
    }), {
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
    })
  );
}

function pwaManifestName(brandName) {
  return brandName ? `${brandName} — Order & Inventory Management` : "Protohub — Order & Inventory Management";
}

function pwaShortName(brandName) {
  return (brandName || DEFAULT_BRAND_NAME).slice(0, 32);
}

function brandingVersionToken(branding) {
  return `${(branding?.brandName || DEFAULT_BRAND_NAME).length}-${(branding?.logoUrl || "").length}`;
}

function parseDataUrlImage(dataUrl) {
  if (typeof dataUrl !== "string") return null;
  const match = dataUrl.match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i);
  if (!match) return null;
  try {
    const binary = atob(match[2]);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return { contentType: match[1], bytes };
  } catch {
    return null;
  }
}

async function brandImageResponse(logoUrl, fallbackPath) {
  const normalized = sanitizeBrandLogo(logoUrl);
  if (!normalized) {
    return fetch(fallbackPath);
  }

  const dataUrl = parseDataUrlImage(normalized);
  if (dataUrl) {
    return new Response(dataUrl.bytes, {
      headers: {
        "Content-Type": dataUrl.contentType,
        "Cache-Control": "no-store"
      }
    });
  }

  try {
    const response = await fetch(normalized, { mode: normalized.startsWith("/") ? "same-origin" : "cors" });
    if (response.ok) return response;
  } catch {
    // fall through to static fallback
  }
  return fetch(fallbackPath);
}

async function dynamicManifestResponse() {
  const branding = await readPushBranding();
  const brandName = branding.brandName || DEFAULT_BRAND_NAME;
  const version = encodeURIComponent(brandingVersionToken(branding));
  const hasDynamicLogo = Boolean(sanitizeBrandLogo(branding.logoUrl));
  const manifest = {
    name: pwaManifestName(brandName),
    short_name: pwaShortName(brandName),
    description: "Nigerian POD CRM for managing orders, agents, inventory, and deliveries",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#1F8FE0",
    orientation: "portrait-primary",
    categories: ["business", "productivity"],
    prefer_related_applications: false,
    icons: hasDynamicLogo
      ? [
          { src: `${DYNAMIC_ICON_192_PATH}.png?v=${version}`, sizes: "192x192", purpose: "any" },
          { src: `${DYNAMIC_ICON_192_PATH}.png?v=${version}`, sizes: "192x192", purpose: "maskable" },
          { src: `${DYNAMIC_ICON_512_PATH}.png?v=${version}`, sizes: "512x512", purpose: "any" },
          { src: `${DYNAMIC_ICON_512_PATH}.png?v=${version}`, sizes: "512x512", purpose: "maskable" }
        ]
      : [
          { src: "/icons/icon-72.png", sizes: "72x72", type: "image/png" },
          { src: "/icons/icon-96.png", sizes: "96x96", type: "image/png" },
          { src: "/icons/icon-128.png", sizes: "128x128", type: "image/png" },
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" }
        ]
  };
  return new Response(JSON.stringify(manifest), {
    headers: {
      "Content-Type": "application/manifest+json",
      "Cache-Control": "no-store"
    }
  });
}

// ── Install ──────────────────────────────────────────────
self.addEventListener("install", (event) => {
  // Activate immediately without waiting for existing tabs to close
  self.skipWaiting();
});

// ── Activate ─────────────────────────────────────────────
self.addEventListener("activate", (event) => {
  // Claim all clients so the SW takes effect immediately
  event.waitUntil(self.clients.claim());
});

// ── Fetch ────────────────────────────────────────────────
// REQUIRED for Chrome WebAPK install criteria. Without this listener
// Chrome won't offer "Install app" — it falls back to the inferior
// "Add to Home Screen" shortcut. Network-first pass-through; we don't
// cache anything to keep API responses fresh.
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  if (event.request.method === "GET" && url.origin === self.location.origin && url.pathname === DYNAMIC_MANIFEST_PATH) {
    event.respondWith(dynamicManifestResponse());
    return;
  }

  if (event.request.method === "GET" && url.origin === self.location.origin && url.pathname === `${DYNAMIC_ICON_192_PATH}.png`) {
    event.respondWith(readPushBranding().then((branding) => brandImageResponse(branding.logoUrl, "/icons/icon-192.png")));
    return;
  }

  if (event.request.method === "GET" && url.origin === self.location.origin && url.pathname === `${DYNAMIC_ICON_512_PATH}.png`) {
    event.respondWith(readPushBranding().then((branding) => brandImageResponse(branding.logoUrl, "/icons/icon-512.png")));
    return;
  }

  // Pass through — let the browser handle it normally.
  event.respondWith(fetch(event.request).catch(() => Response.error()));
});

self.addEventListener("message", (event) => {
  if (event.data?.type !== "SET_PUSH_BRANDING") return;
  const branding = {
    brandName: event.data.brandName,
    logoUrl: event.data.logoUrl
  };
  if (typeof event.waitUntil === "function") {
    event.waitUntil(writePushBranding(branding));
    return;
  }
  void writePushBranding(branding);
});

// ── Push ─────────────────────────────────────────────────
self.addEventListener("push", (event) => {
  // Android Chrome is STRICT: the showNotification promise must be the
  // direct argument to event.waitUntil(). Wrapping in async/await or
  // deferring via .catch() makes Chrome treat the push as "no
  // notification shown" and silently drops the OS banner (only the
  // in-app notification fires when the page is open). Keep this dead
  // simple — one waitUntil(showNotification(...)). No cache reads, no
  // branding enrichment, nothing async before the show call.

  let payload = { title: DEFAULT_BRAND_NAME, body: "" };
  if (event.data) {
    try {
      payload = event.data.json();
    } catch {
      try {
        payload = { title: DEFAULT_BRAND_NAME, body: event.data.text() };
      } catch {
        // keep empty payload defaults
      }
    }
  }

  const kind = typeof payload.kind === "string" && payload.kind ? payload.kind : "info";
  const presentation = presentationForKind(kind);
  const brandName = typeof payload.brandName === "string" && payload.brandName.trim()
    ? payload.brandName.trim()
    : DEFAULT_BRAND_NAME;
  const brandLogo = sanitizeBrandLogo(payload.brandLogo);
  // Per-event glyph is the MAIN icon (so a delivery looks different from a failure
  // at a glance); the brand logo rides along as the expanded image (see options.image
  // below) + the brand name in the title, so identity is kept without hiding the glyph.
  const iconCandidate = payload.icon || presentation.icon || brandLogo || "/icons/icon-192.png";
  const title = withBrandTitle(payload.title || presentation.defaultTitle || DEFAULT_BRAND_NAME, brandName);
  const options = {
    body: payload.body || "",
    icon: iconCandidate,
    image: payload.image || brandLogo || undefined,
    badge: payload.badge || DEFAULT_BADGE,
    tag: payload.tag || `protohub-${kind}`,
    renotify: true,
    requireInteraction: typeof payload.requireInteraction === "boolean" ? payload.requireInteraction : !!presentation.requireInteraction,
    vibrate: Array.isArray(payload.vibrate) ? payload.vibrate : presentation.vibrate,
    timestamp: typeof payload.timestamp === "number" ? payload.timestamp : Date.now(),
    data: {
      url: payload.url || "/",
      kind,
      brandName
    }
  };

  // Single waitUntil wrapping showNotification directly. Match Ordello's
  // pattern exactly — this is the form Android Chrome reliably honors.
  event.waitUntil(self.registration.showNotification(title, options));
});

// ── Notification Click ───────────────────────────────────
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  if (event.action === "dismiss") return;

  const targetUrl = event.notification.data?.url || "/";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      // If an existing window is open, focus it and navigate
      for (const client of clients) {
        if (client.url.includes(self.location.origin)) {
          client.focus();
          client.postMessage({ type: "NAVIGATE", url: targetUrl });
          return;
        }
      }
      // Otherwise open a new window
      return self.clients.openWindow(targetUrl);
    })
  );
});

// ── Background Sync (future) ─────────────────────────────
self.addEventListener("sync", (event) => {
  // Placeholder for offline sync support
});
