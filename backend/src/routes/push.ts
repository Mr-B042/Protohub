import { Router } from "express";
import { z } from "zod";
import { supabase } from "../lib/supabase.js";
import { requireAuth } from "../middleware/auth.js";
import { getVapidPublicKey, isPushConfigured } from "../lib/push.js";

const router = Router();
router.use(requireAuth);

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
  })
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

  const { endpoint, keys } = parsed.data;

  // Upsert: if this endpoint already exists for this user, update keys
  const { data: existing } = await supabase
    .from("push_subscriptions")
    .select("id")
    .eq("user_id", req.user!.id)
    .eq("endpoint", endpoint)
    .single();

  if (existing) {
    await supabase
      .from("push_subscriptions")
      .update({ p256dh: keys.p256dh, auth: keys.auth })
      .eq("id", existing.id);
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

  res.json({ message: "Push subscription saved." });
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
  const { count } = await supabase
    .from("push_subscriptions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", req.user!.id);
  res.json({ subscribed: (count ?? 0) > 0, count: count ?? 0 });
});

export default router;
