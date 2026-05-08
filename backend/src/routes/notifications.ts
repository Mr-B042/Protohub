import { Router } from "express";
import { z } from "zod";
import { supabase } from "../lib/supabase.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);

router.get("/", async (req, res) => {
  // Return org-wide notifications (recipient_id IS NULL) + those addressed to this user
  const { data, error } = await supabase
    .from("system_notifications")
    .select("*")
    .eq("org_id", req.user!.orgId)
    .or(`recipient_id.is.null,recipient_id.eq.${req.user!.id}`)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(data);
});

// Create notification
router.post("/", async (req, res) => {
  const Schema = z.object({
    type:      z.enum(["low_stock", "remittance_overdue", "info", "order_new", "order_confirmed", "order_delivered", "order_cancelled", "order_failed", "order_rescheduled", "order_assigned"]),
    message:   z.string().min(1),
    productId: z.string().uuid().optional()
  });
  const parsed = Schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }
  const { type, message, productId } = parsed.data;
  const { data, error } = await supabase
    .from("system_notifications")
    .insert({ org_id: req.user!.orgId, type, message, product_id: productId ?? null })
    .select().single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.status(201).json(data);
});

// Mark all as read (org-wide + user's own)
router.patch("/read-all", async (req, res) => {
  const { error } = await supabase
    .from("system_notifications")
    .update({ read: true })
    .eq("org_id", req.user!.orgId)
    .eq("read", false)
    .or(`recipient_id.is.null,recipient_id.eq.${req.user!.id}`);
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ message: "All notifications marked as read." });
});

// Mark single as read
router.patch("/:id/read", async (req, res) => {
  const { data, error } = await supabase
    .from("system_notifications")
    .update({ read: true })
    .eq("id", req.params.id)
    .eq("org_id", req.user!.orgId)
    .select().single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(data);
});

// Delete all read notifications for this org+user
router.delete("/read", async (req, res) => {
  const { error } = await supabase
    .from("system_notifications")
    .delete()
    .eq("org_id", req.user!.orgId)
    .eq("read", true)
    .or(`recipient_id.is.null,recipient_id.eq.${req.user!.id}`);
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.status(204).send();
});

export default router;
