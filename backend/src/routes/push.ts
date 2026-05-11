import { Router } from "express";
import { z } from "zod";
import { supabase } from "../lib/supabase.js";
import { requireAuth } from "../middleware/auth.js";
import { getOrgPushBranding } from "../lib/push-branding.js";
import {
  getNativePushConfigStatus,
  getVapidPublicKey,
  isAnyPushDeliveryConfigured,
  isPushConfigured,
  sendNativePushToDevices,
  sendPushToSubscriptions,
  sendPushToUser
} from "../lib/push.js";

const router = Router();
router.use(requireAuth);

const NativePlatformSchema = z.enum(["android", "ios"]);

// ── GET /api/push/vapid-public-key ───────────────────────
// Returns the VAPID public key so the frontend can subscribe
router.get("/vapid-public-key", (_req, res) => {
  const key = getVapidPublicKey();
  if (!key) {
    res.status(503).json({ error: "Push notifications not configured on this server." });
    return;
  }
  res.json({ publicKey: key });
});

// ── POST /api/push/subscribe ─────────────────────────────
// Save a push subscription for the authenticated user
const SubscribeSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1)
  }),
  replaceOthers: z.boolean().optional()
});

const NativeRegisterSchema = z.object({
  token: z.string().min(20),
  platform: NativePlatformSchema,
  replaceOthers: z.boolean().optional(),
  deviceName: z.string().max(120).optional(),
  appId: z.string().max(120).optional(),
  appVersion: z.string().max(80).optional()
});

const TestPushSchema = z.object({
  title: z.string().min(1).max(80).optional(),
  body: z.string().min(1).max(240).optional(),
  endpoint: z.string().url().optional(),
  nativeToken: z.string().min(20).optional()
}).refine((value) => !(value.endpoint && value.nativeToken), {
  message: "Provide either a web endpoint or a native token, not both.",
  path: ["endpoint"]
});

router.post("/subscribe", async (req, res) => {
  if (!isPushConfigured()) {
    res.status(503).json({ error: "Push not configured." });
    return;
  }

  const parsed = SubscribeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }

  const { endpoint, keys, replaceOthers } = parsed.data;

  // Upsert by endpoint so the same browser/device registration gets reused
  // even if it is re-sent later or previously attached to a stale row.
  const { data: existingRows, error: existingError } = await supabase
    .from("push_subscriptions")
    .select("id")
    .eq("endpoint", endpoint)
    .order("created_at", { ascending: false });

  if (existingError) {
    res.status(500).json({ error: existingError.message });
    return;
  }

  const primary = existingRows?.[0];

  if (primary) {
    const { error: updateError } = await supabase
      .from("push_subscriptions")
      .update({
        org_id: req.user!.orgId,
        user_id: req.user!.id,
        p256dh: keys.p256dh,
        auth: keys.auth
      })
      .eq("id", primary.id);
    if (updateError) {
      res.status(500).json({ error: updateError.message });
      return;
    }

    const duplicateIds = (existingRows ?? []).slice(1).map((row) => row.id);
    if (duplicateIds.length > 0) {
      await supabase
        .from("push_subscriptions")
        .delete()
        .in("id", duplicateIds);
    }
  } else {
    const { error } = await supabase
      .from("push_subscriptions")
      .insert({
        org_id: req.user!.orgId,
        user_id: req.user!.id,
        endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth
      });
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
  }

  if (replaceOthers) {
    const { error: pruneError } = await supabase
      .from("push_subscriptions")
      .delete()
      .eq("user_id", req.user!.id)
      .neq("endpoint", endpoint);
    if (pruneError) {
      res.status(500).json({ error: pruneError.message });
      return;
    }
  }

  res.json({ message: "Push subscription saved." });
});

// ── POST /api/push/native/register ───────────────────────
// Save a native device token for the authenticated user
router.post("/native/register", async (req, res) => {
  const nativeConfig = getNativePushConfigStatus();
  const parsed = NativeRegisterSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }

  const { token, platform, replaceOthers, deviceName, appId, appVersion } = parsed.data;
  if (!nativeConfig[platform]) {
    res.status(503).json({ error: `${platform === "ios" ? "iOS" : "Android"} native push is not configured on this server.` });
    return;
  }

  const { data: existingRows, error: existingError } = await supabase
    .from("native_push_devices")
    .select("id")
    .eq("org_id", req.user!.orgId)
    .eq("token", token)
    .order("updated_at", { ascending: false });

  if (existingError) {
    res.status(500).json({ error: existingError.message });
    return;
  }

  const rowPayload = {
    org_id: req.user!.orgId,
    user_id: req.user!.id,
    token,
    platform,
    active: true,
    device_name: deviceName?.trim() ?? "",
    app_id: appId?.trim() ?? "",
    app_version: appVersion?.trim() ?? "",
    last_seen_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  const primary = existingRows?.[0];
  if (primary) {
    const { error: updateError } = await supabase
      .from("native_push_devices")
      .update(rowPayload)
      .eq("id", primary.id);
    if (updateError) {
      res.status(500).json({ error: updateError.message });
      return;
    }

    const duplicateIds = (existingRows ?? []).slice(1).map((row) => row.id);
    if (duplicateIds.length > 0) {
      await supabase.from("native_push_devices").delete().in("id", duplicateIds);
    }
  } else {
    const { error: insertError } = await supabase
      .from("native_push_devices")
      .insert(rowPayload);
    if (insertError) {
      res.status(500).json({ error: insertError.message });
      return;
    }
  }

  if (replaceOthers) {
    const { error: pruneError } = await supabase
      .from("native_push_devices")
      .delete()
      .eq("user_id", req.user!.id)
      .neq("token", token);
    if (pruneError) {
      res.status(500).json({ error: pruneError.message });
      return;
    }
  }

  res.json({ message: "Native push device saved." });
});

// ── DELETE /api/push/native/register ─────────────────────
router.delete("/native/register", async (req, res) => {
  const { token } = req.body ?? {};
  if (!token) {
    await supabase.from("native_push_devices").delete().eq("user_id", req.user!.id);
  } else {
    await supabase
      .from("native_push_devices")
      .delete()
      .eq("user_id", req.user!.id)
      .eq("token", token);
  }
  res.json({ message: "Native push device removed." });
});

// ── DELETE /api/push/subscribe ────────────────────────────
// Remove push subscription (user disabled notifications)
router.delete("/subscribe", async (req, res) => {
  const { endpoint } = req.body ?? {};
  if (!endpoint) {
    // Remove all subscriptions for this user
    await supabase
      .from("push_subscriptions")
      .delete()
      .eq("user_id", req.user!.id);
  } else {
    await supabase
      .from("push_subscriptions")
      .delete()
      .eq("user_id", req.user!.id)
      .eq("endpoint", endpoint);
  }
  res.json({ message: "Subscription removed." });
});

// ── GET /api/push/status ─────────────────────────────────
// Check if the current user has any active subscriptions
router.get("/status", async (req, res) => {
  const nativeConfig = getNativePushConfigStatus();
  const [{ data, count, error }, nativeDevicesResult] = await Promise.all([
    supabase
      .from("push_subscriptions")
      .select("id, endpoint, created_at", { count: "exact" })
      .eq("user_id", req.user!.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("native_push_devices")
      .select("id, platform, token, created_at, updated_at")
      .eq("user_id", req.user!.id)
      .eq("active", true)
      .order("updated_at", { ascending: false })
  ]);
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  if (nativeDevicesResult.error) {
    res.status(500).json({ error: nativeDevicesResult.error.message });
    return;
  }
  res.json({
    subscribed: (count ?? 0) > 0,
    count: count ?? 0,
    configured: isPushConfigured(),
    subscriptions: (data ?? []).map((row) => ({
      id: row.id,
      endpoint: row.endpoint,
      createdAt: row.created_at,
      host: (() => {
        try {
          return new URL(row.endpoint).host;
        } catch {
          return "unknown";
        }
      })()
    })),
    nativeConfigured: nativeConfig.android || nativeConfig.ios,
    nativePlatforms: nativeConfig,
    nativeDevices: (nativeDevicesResult.data ?? []).map((row) => ({
      id: row.id,
      platform: row.platform,
      token: row.token,
      tokenSuffix: row.token.slice(-12),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }))
  });
});

// ── POST /api/push/test ──────────────────────────────────
// Queue a real push notification to the current user so they can verify
// background delivery on the current device.
router.post("/test", async (req, res) => {
  if (!isAnyPushDeliveryConfigured()) {
    res.status(503).json({ error: "Push not configured." });
    return;
  }

  const parsed = TestPushSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }

  const [webCountResult, nativeCountResult] = await Promise.all([
    supabase
      .from("push_subscriptions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", req.user!.id),
    supabase
      .from("native_push_devices")
      .select("id", { count: "exact", head: true })
      .eq("user_id", req.user!.id)
      .eq("active", true)
  ]);

  if (webCountResult.error) {
    res.status(500).json({ error: webCountResult.error.message });
    return;
  }
  if (nativeCountResult.error) {
    res.status(500).json({ error: nativeCountResult.error.message });
    return;
  }

  if ((webCountResult.count ?? 0) === 0 && (nativeCountResult.count ?? 0) === 0) {
    res.status(409).json({ error: "This user has no active push subscriptions yet." });
    return;
  }

  const title = parsed.data.title ?? "Protohub Test Push";
  const body = parsed.data.body ?? "Background notifications are working on this device.";
  try {
    const branding = await getOrgPushBranding(req.user!.orgId);
    const endpoint = parsed.data.endpoint?.trim();
    const nativeToken = parsed.data.nativeToken?.trim();
    const payload = {
      title,
      body,
      kind: "test_push",
      url: "/dashboard/admin/notifications",
      tag: `protohub-test-${Date.now()}`,
      brandName: branding.brandName,
      brandLogo: branding.brandLogo
    };
    const result = endpoint
      ? await (async () => {
          const { data: subscriptions, error: subError } = await supabase
            .from("push_subscriptions")
            .select("id, endpoint, p256dh, auth")
            .eq("org_id", req.user!.orgId)
            .eq("user_id", req.user!.id)
            .eq("endpoint", endpoint);
          if (subError) throw new Error(subError.message);
          if (!subscriptions?.length) {
            throw new Error("This device is not the active saved push endpoint. Force Re-subscribe here and try again.");
          }
          return sendPushToSubscriptions(subscriptions, payload, `user ${req.user!.id} endpoint ${endpoint}`);
        })()
      : nativeToken
        ? await (async () => {
            const { data: devices, error: deviceError } = await supabase
              .from("native_push_devices")
              .select("id, platform, token")
              .eq("org_id", req.user!.orgId)
              .eq("user_id", req.user!.id)
              .eq("token", nativeToken)
              .eq("active", true);
            if (deviceError) throw new Error(deviceError.message);
            if (!devices?.length) {
              throw new Error("This device is not the active saved native push token. Re-enable notifications here and try again.");
            }
            return sendNativePushToDevices(
              devices as Array<{ id: string; platform: "android" | "ios"; token: string }>,
              payload,
              `user ${req.user!.id} native token`
            );
          })()
      : await sendPushToUser(req.user!.orgId, req.user!.id, payload);
    if (result.attempted === 0 || result.delivered === 0) {
      res.status(502).json({
        error: endpoint
          ? "No active push deliveries succeeded for this exact device. Force Re-subscribe here and try again."
          : nativeToken
            ? "No native push deliveries succeeded for this exact device token. Re-enable notifications here and try again."
          : "No active push deliveries succeeded for this account. Re-subscribe on this device and try again."
      });
      return;
    }
  } catch (error: any) {
    res.status(502).json({ error: error?.message ?? "Failed to queue test push." });
    return;
  }

  res.json({ message: "Test push queued." });
});

export default router;
