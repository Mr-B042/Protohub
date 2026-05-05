import { Router } from "express";
import { supabase } from "../lib/supabase.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);

router.get("/", async (req, res) => {
  const { data, error } = await supabase
    .from("system_notifications")
    .select("*")
    .eq("org_id", req.user!.orgId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(data);
});

// Mark all as read
router.patch("/read-all", async (req, res) => {
  const { error } = await supabase
    .from("system_notifications")
    .update({ read: true })
    .eq("org_id", req.user!.orgId)
    .eq("read", false);
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

export default router;
