// ProtoHub Service Worker — Push Notifications
const CACHE_NAME = "protohub-v2";

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

// ── Push ─────────────────────────────────────────────────
self.addEventListener("push", (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: "Protohub", body: event.data.text() };
  }

  const title = payload.title || "Protohub";
  const options = {
    body: payload.body || "",
    icon: payload.icon || "/icons/icon-192.svg",
    badge: payload.badge || "/icons/badge-72.svg",
    tag: payload.tag || "protohub-notification",
    renotify: true,
    data: {
      url: payload.url || "/"
    },
    actions: [
      { action: "open", title: "Open" },
      { action: "dismiss", title: "Dismiss" }
    ]
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
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
