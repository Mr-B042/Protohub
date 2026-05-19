import { Router } from "express";
import { z } from "zod";
import { supabase } from "../lib/supabase.js";
import { requireAuth } from "../middleware/auth.js";
import { getOrgPushBranding } from "../lib/push-branding.js";
import {
  getVapidPublicKey,
  isNativePushConfigured,
  isPushConfigured,
  sendNativePushToDevices,
  sendPushToSubscriptions,
  sendPushToUser
} from "../lib/push.js";

const router = Router();
router.use(requireAuth);

const SubscribeSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1)
  }),
  replaceOthers: z.boolean().optional()
});

const NativeSubscribeSchema = z.object({
  token: z.string().min(16).max(4096),
  platform: z.enum(["android", "ios"]),
  provider: z.enum(["fcm", "apns"]).optional(),
  deviceId: z.string().max(191).optional(),
  deviceName: z.string().max(120).optional(),
  appId: z.string().max(191).optional(),
  appVersion: z.string().max(60).optional(),
  replaceOthers: z.boolean().optional()
});

const TestPushSchema = z.object({
  title: z.string().min(1).max(80).optional(),
  body: z.string().min(1).max(240).optional(),
  endpoint: z.string().url().optional(),
  nativeToken: z.string().min(16).max(4096).optional()
});

router.get("/vapid-public-key", (_req, res) => {
  const key = getVapidPublicKey();
  if (!key) {
    res.status(503).json({ error: "Push notifications not configured on this server." });
    return;
  }
  res.json({ publicKey: key });
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
      await supabase.from("push_subscriptions").delete().in("id", duplicateIds);
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

router.post("/native/subscribe", async (req, res) => {
  const parsed = NativeSubscribeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }

  const {
    token,
    platform,
    provider,
    deviceId,
    deviceName,
    appId,
    appVersion,
    replaceOthers
  } = parsed.data;

  const resolvedProvider = provider ?? (platform === "android" ? "fcm" : "apns");
  const nowIso = new Date().toISOString();

  const { data: existingRows, error: existingError } = await supabase
    .from("native_push_devices")
    .select("id")
    .eq("token", token)
    .order("created_at", { ascending: false });

  if (existingError) {
    res.status(500).json({ error: existingError.message });
    return;
  }

  const record = {
    org_id: req.user!.orgId,
    user_id: req.user!.id,
    token,
    platform,
    provider: resolvedProvider,
    device_id: deviceId?.trim() || null,
    device_name: deviceName?.trim() || null,
    app_id: appId?.trim() || null,
    app_version: appVersion?.trim() || null,
    last_seen_at: nowIso,
    disabled_at: null as string | null
  };

  const primary = existingRows?.[0];
  if (primary) {
    const { error: updateError } = await supabase
      .from("native_push_devices")
      .update({
        ...record,
        updated_at: nowIso
      })
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
    const { error } = await supabase
      .from("native_push_devices")
      .insert({
        ...record,
        created_at: nowIso,
        updated_at: nowIso
      });
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
  }

  if (replaceOthers) {
    const query = supabase
      .from("native_push_devices")
      .delete()
      .eq("user_id", req.user!.id)
      .neq("token", token);
    if (deviceId?.trim()) {
      query.eq("platform", platform);
    }
    const { error: pruneError } = await query;
    if (pruneError) {
      res.status(500).json({ error: pruneError.message });
      return;
    }
  }

  res.json({ message: "Native push device saved.", configured: isNativePushConfigured() });
});

router.delete("/subscribe", async (req, res) => {
  const { endpoint } = req.body ?? {};
  if (!endpoint) {
    await supabase.from("push_subscriptions").delete().eq("user_id", req.user!.id);
  } else {
    await supabase
      .from("push_subscriptions")
      .delete()
      .eq("user_id", req.user!.id)
      .eq("endpoint", endpoint);
  }
  res.json({ message: "Subscription removed." });
});

router.delete("/native/subscribe", async (req, res) => {
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
  res.json({ message: "Native device removed." });
});

router.get("/status", async (req, res) => {
  const [webResult, nativeResult] = await Promise.all([
    supabase
      .from("push_subscriptions")
      .select("id, endpoint, created_at", { count: "exact" })
      .eq("user_id", req.user!.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("native_push_devices")
      .select("id, token, platform, provider, device_name, created_at, last_seen_at", { count: "exact" })
      .eq("user_id", req.user!.id)
      .is("disabled_at", null)
      .order("created_at", { ascending: false })
  ]);

  if (webResult.error) {
    res.status(500).json({ error: webResult.error.message });
    return;
  }
  if (nativeResult.error) {
    res.status(500).json({ error: nativeResult.error.message });
    return;
  }

  res.json({
    subscribed: (webResult.count ?? 0) > 0 || (nativeResult.count ?? 0) > 0,
    count: webResult.count ?? 0,
    configured: isPushConfigured(),
    nativeConfigured: isNativePushConfigured(),
    subscriptions: (webResult.data ?? []).map((row) => ({
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
    nativeDevices: (nativeResult.data ?? []).map((row) => ({
      id: row.id,
      token: row.token,
      tokenPreview: `${row.token.slice(0, 10)}…${row.token.slice(-6)}`,
      platform: row.platform,
      provider: row.provider,
      deviceName: row.device_name,
      createdAt: row.created_at,
      lastSeenAt: row.last_seen_at
    }))
  });
});

router.post("/test", async (req, res) => {
  const parsed = TestPushSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }

  const title = parsed.data.title ?? "Protohub Test Push";
  const body = parsed.data.body ?? "Background notifications are working on this device.";
  const branding = await getOrgPushBranding(req.user!.orgId);
  const payload = {
    title,
    body,
    kind: "test_push",
    url: "/dashboard/admin/notifications",
    tag: `protohub-test-${Date.now()}`,
    brandName: branding.brandName,
    brandLogo: branding.brandLogo
  };

  try {
    const endpoint = parsed.data.endpoint?.trim();
    const nativeToken = parsed.data.nativeToken?.trim();

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
            if (!isNativePushConfigured()) {
              throw new Error("Native push provider is not configured on this server yet.");
            }
            const { data: devices, error: nativeError } = await supabase
              .from("native_push_devices")
              .select("id, token, platform, provider, user_id")
              .eq("org_id", req.user!.orgId)
              .eq("user_id", req.user!.id)
              .eq("token", nativeToken)
              .is("disabled_at", null);
            if (nativeError) throw new Error(nativeError.message);
            if (!devices?.length) {
              throw new Error("This mobile device is not the active saved native push target. Re-subscribe here and try again.");
            }
            return sendNativePushToDevices(devices, payload, `user ${req.user!.id} native token`);
          })()
        : await sendPushToUser(req.user!.orgId, req.user!.id, payload);

    if (result.attempted === 0 || result.delivered === 0) {
      res.status(502).json({
        error: endpoint
          ? "No active web push deliveries succeeded for this exact browser. Force Re-subscribe here and try again."
          : nativeToken
            ? "No native push deliveries succeeded for this exact mobile device. Re-subscribe here and try again."
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
