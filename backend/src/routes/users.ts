import { Router } from "express";
import { z } from "zod";
import { supabase } from "../lib/supabase.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);

// ── GET /api/users ───────────────────────────────────────
// Returns all users in the caller's org.
router.get("/", async (req, res) => {
  const { data, error } = await supabase
    .from("users")
    .select("id, name, email, role, active, created_at")
    .eq("org_id", req.user!.orgId)
    .order("created_at", { ascending: true });
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(data);
});

// ── PATCH /api/users/:id ─────────────────────────────────
// Owner/Admin can update name, email, active status of any org member.
const UserPatchSchema = z.object({
  name:   z.string().min(1).max(120).optional(),
  email:  z.string().email().optional(),
  active: z.boolean().optional()
}).strict();

router.patch("/:id",
  requireRole("Owner", "Admin"),
  async (req, res) => {
    const parsed = UserPatchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten().fieldErrors });
      return;
    }

    const updates: Record<string, unknown> = {};
    if (parsed.data.name !== undefined)   updates.name   = parsed.data.name;
    if (parsed.data.email !== undefined)  updates.email  = parsed.data.email;
    if (parsed.data.active !== undefined) updates.active = parsed.data.active;

    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: "No fields to update." });
      return;
    }

    // Ensure target user belongs to caller's org
    const { data, error } = await supabase
      .from("users")
      .update(updates)
      .eq("id", req.params.id)
      .eq("org_id", req.user!.orgId)
      .select()
      .single();
    if (error) { res.status(500).json({ error: error.message }); return; }
    if (!data) { res.status(404).json({ error: "User not found." }); return; }
    res.json(data);
  }
);

export default router;
