import { supabase } from "./supabase.js";

// ── Alert routing (Bright, 20 Oct 2026) ─────────────────────────────────────
// The Owner picks, per alert, which ROLES get it, whether the rep on the
// order/cart gets it, and whether it pops up on phones (push) or stays in-app
// only. Stored on organizations.notification_routing (migration 309); a
// missing alert falls back to DEFAULTS below, which are exactly what each
// alert did before the setting existed - so nothing changes until edited.

import { ALERTS, cleanRoute, type AlertKey, type AlertRoute } from "./notification-routing-rules.js";
export { ALERTS, ROUTABLE_ROLES, cleanRoute, type AlertKey, type AlertRoute } from "./notification-routing-rules.js";

type OrgRouting = { routing: Record<string, unknown>; adminCartNotifications: boolean };
const cache = new Map<string, { at: number; value: OrgRouting }>();
const CACHE_MS = 30_000;

export function forgetRouting(orgId: string) { cache.delete(orgId); }

async function loadOrgRouting(orgId: string): Promise<OrgRouting> {
  const hit = cache.get(orgId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  const { data } = await supabase.from("organizations").select("notification_routing, admin_cart_notifications").eq("id", orgId).maybeSingle();
  const value: OrgRouting = {
    routing: (data as any)?.notification_routing && typeof (data as any).notification_routing === "object" ? (data as any).notification_routing : {},
    adminCartNotifications: !!(data as any)?.admin_cart_notifications,
  };
  cache.set(orgId, { at: Date.now(), value });
  return value;
}

/** Every alert's route for this org, saved or default. */
export async function getAllRoutes(orgId: string): Promise<Record<AlertKey, AlertRoute>> {
  const org = await loadOrgRouting(orgId);
  const out = {} as Record<AlertKey, AlertRoute>;
  for (const key of Object.keys(ALERTS) as AlertKey[]) out[key] = routeFrom(org, key);
  return out;
}

function routeFrom(org: OrgRouting, key: AlertKey): AlertRoute {
  if (key in org.routing) return cleanRoute(key, org.routing[key]);
  // Before this setting, new-cart alerts were off unless the old
  // "Notify admins on new abandoned carts" switch was on.
  if (key === "cart_new" && !org.adminCartNotifications) return { roles: [], rep: false, push: true };
  return cleanRoute(key, undefined);
}

export async function getRoute(orgId: string, key: AlertKey): Promise<AlertRoute> {
  try { return routeFrom(await loadOrgRouting(orgId), key); }
  catch { return cleanRoute(key, undefined); }
}

/**
 * Who gets this alert: active users in the chosen roles, plus the rep on the
 * order/cart when that is switched on. Map of user id → role.
 */
export async function alertRecipients(orgId: string, key: AlertKey, repId?: string | null): Promise<{ recipients: Map<string, string>; push: boolean }> {
  const route = await getRoute(orgId, key);
  const recipients = new Map<string, string>();
  if (route.roles.length) {
    const { data } = await supabase.from("users").select("id, role").eq("org_id", orgId).eq("active", true).in("role", route.roles);
    for (const u of data ?? []) recipients.set((u as any).id, (u as any).role);
  }
  if (route.rep && repId && !recipients.has(repId)) {
    const { data } = await supabase.from("users").select("id, role").eq("org_id", orgId).eq("active", true).eq("id", repId).maybeSingle();
    if ((data as any)?.id) recipients.set((data as any).id, (data as any).role);
  }
  return { recipients, push: route.push };
}
