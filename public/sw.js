// ProtoHub Service Worker — Push Notifications + WebAPK install criteria
const CACHE_NAME = "protohub-v6-auto-update";
const PUSH_BRANDING_CACHE = "protohub-push-branding-v1";
const PUSH_BRANDING_KEY = "/__protohub_push_branding__";
const DEFAULT_BRAND_NAME = "Protohub";
const DEFAULT_BADGE = "/icons/icon-72.png";

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
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: "Protohub", body: event.data.text() };
  }

  event.waitUntil((async () => {
    const branding = await readPushBranding();
    const kind = typeof payload.kind === "string" && payload.kind ? payload.kind : "info";
    const presentation = presentationForKind(kind);
    const brandName = typeof payload.brandName === "string" && payload.brandName.trim()
      ? payload.brandName.trim()
      : branding.brandName || DEFAULT_BRAND_NAME;
    const brandLogo = sanitizeBrandLogo(payload.brandLogo) || branding.logoUrl;
    const presentationIcon = payload.icon || presentation.icon || "/icons/icon-192.png";
    const title = withBrandTitle(payload.title || presentation.defaultTitle || DEFAULT_BRAND_NAME, brandName);
    const options = {
      body: payload.body || "",
      icon: brandLogo || presentationIcon,
      badge: payload.badge || DEFAULT_BADGE,
      image: payload.image || (brandLogo ? presentationIcon : undefined),
      tag: payload.tag || `protohub-${kind}`,
      renotify: true,
      requireInteraction: typeof payload.requireInteraction === "boolean" ? payload.requireInteraction : !!presentation.requireInteraction,
      vibrate: Array.isArray(payload.vibrate) ? payload.vibrate : presentation.vibrate,
      timestamp: typeof payload.timestamp === "number" ? payload.timestamp : Date.now(),
      data: {
        url: payload.url || "/",
        kind,
        brandName
      },
      actions: [
        { action: "open", title: "Open" },
        { action: "dismiss", title: "Dismiss" }
      ]
    };
    if (payload.color || presentation.color) {
      options.color = payload.color || presentation.color;
    }
    await self.registration.showNotification(title, options);
  })());
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
