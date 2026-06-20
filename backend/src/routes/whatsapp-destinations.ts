import { Router } from "express";
import { z } from "zod";
import { supabase } from "../lib/supabase.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);

const BaseDestinationSchema = z.object({
  label: z.string().trim().min(1).max(120),
  destinationType: z.enum(["group", "phone", "manual_group"]).default("manual_group"),
  groupJid: z.string().trim().max(160).optional().nullable(),
  phone: z.string().trim().max(40).optional().nullable(),
  notes: z.string().trim().max(240).optional().nullable(),
  active: z.boolean().default(true),
  isDefault: z.boolean().default(false),
  assignedRepId: z.string().uuid().nullable().optional()
});

const DestinationSchema = BaseDestinationSchema.superRefine((value, ctx) => {
  if (value.destinationType === "group" && !value.groupJid?.trim()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["groupJid"], message: "Choose or paste a group JID." });
  }
  if (value.destinationType === "phone" && !value.phone?.trim()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["phone"], message: "Enter a phone number." });
  }
});

const PatchDestinationSchema = BaseDestinationSchema.partial().superRefine((value, ctx) => {
  if (value.destinationType === "group" && value.groupJid !== undefined && !value.groupJid?.trim()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["groupJid"], message: "Choose or paste a group JID." });
  }
  if (value.destinationType === "phone" && value.phone !== undefined && !value.phone?.trim()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["phone"], message: "Enter a phone number." });
  }
});

function destinationPayload(orgId: string, userId: string, data: z.infer<typeof DestinationSchema> | z.infer<typeof PatchDestinationSchema>) {
  const payload: Record<string, unknown> = {
    org_id: orgId,
    user_id: userId
  };
  if (data.label !== undefined) payload.label = data.label;
  if (data.destinationType !== undefined) payload.destination_type = data.destinationType;
  if (data.groupJid !== undefined) payload.group_jid = data.groupJid?.trim() || null;
  if (data.phone !== undefined) payload.phone = data.phone?.trim() || null;
  if (data.notes !== undefined) payload.notes = data.notes?.trim() || null;
  if (data.active !== undefined) payload.active = data.active;
  if (data.isDefault !== undefined) payload.is_default = data.isDefault;
  if ("assignedRepId" in data && data.assignedRepId !== undefined) payload.assigned_rep_id = data.assignedRepId ?? null;
  return payload;
}

async function clearOtherDefaults(orgId: string, userId: string, exceptId?: string) {
  let query = supabase
    .from("whatsapp_user_destinations")
    .update({ is_default: false })
    .eq("org_id", orgId)
    .eq("user_id", userId);
  if (exceptId) query = query.neq("id", exceptId);
  const { error } = await query;
  if (error) throw error;
}

router.get("/", async (req, res) => {
  const includeInactive = ["1", "true", "yes"].includes(String(req.query.includeInactive ?? "").toLowerCase());
  let query = supabase
    .from("whatsapp_user_destinations")
    .select("*")
    .eq("org_id", req.user!.orgId)
    .eq("user_id", req.user!.id)
    .order("is_default", { ascending: false })
    .order("last_used_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });
  if (!includeInactive) query = query.eq("active", true);

  const { data, error } = await query;
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json({ destinations: data ?? [] });
});

router.post("/", async (req, res) => {
  const parsed = DestinationSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }

  try {
    if (parsed.data.isDefault) await clearOtherDefaults(req.user!.orgId, req.user!.id);
    const { data, error } = await supabase
      .from("whatsapp_user_destinations")
      .insert(destinationPayload(req.user!.orgId, req.user!.id, parsed.data))
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Could not save destination." });
  }
});

router.patch("/:id", async (req, res) => {
  const parsed = PatchDestinationSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }

  try {
    if (parsed.data.isDefault) await clearOtherDefaults(req.user!.orgId, req.user!.id, req.params.id);
    const { data, error } = await supabase
      .from("whatsapp_user_destinations")
      .update(destinationPayload(req.user!.orgId, req.user!.id, parsed.data))
      .eq("id", req.params.id)
      .eq("org_id", req.user!.orgId)
      .eq("user_id", req.user!.id)
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Could not update destination." });
  }
});

router.delete("/:id", async (req, res) => {
  const { error } = await supabase
    .from("whatsapp_user_destinations")
    .delete()
    .eq("id", req.params.id)
    .eq("org_id", req.user!.orgId)
    .eq("user_id", req.user!.id);

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json({ ok: true });
});

// Owner/Admin can view any user's destinations for view-as mode.
router.get("/user/:userId", requireRole("Owner", "Admin"), async (req, res) => {
  const { data, error } = await supabase
    .from("whatsapp_user_destinations")
    .select("*")
    .eq("org_id", req.user!.orgId)
    .eq("user_id", String(req.params["userId"] ?? ""))
    .eq("active", true)
    .order("is_default", { ascending: false })
    .order("last_used_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json({ destinations: data ?? [] });
});

// GET /api/whatsapp-destinations/org/all — Owner/Admin: all org destinations
// enriched with owner name, assigned rep names, and assigned agent name.
router.get("/org/all", requireRole("Owner", "Admin"), async (req, res) => {
  const { data, error } = await supabase
    .from("whatsapp_user_destinations")
    .select("*, owner:users!whatsapp_user_destinations_user_id_fkey(id, name, role), agent:agents!whatsapp_user_destinations_assigned_agent_id_fkey(id, name, zone, primary_base_state)")
    .eq("org_id", req.user!.orgId)
    .eq("active", true)
    .order("is_default", { ascending: false })
    .order("last_used_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json({ destinations: data ?? [] });
});

// PATCH /api/whatsapp-destinations/:id/assign-agent — Owner/Admin: map to a delivery agent
router.patch("/:id/assign-agent", requireRole("Owner", "Admin"), async (req, res) => {
  const agentId: string | null = req.body?.agentId ?? null;
  const { error } = await supabase
    .from("whatsapp_user_destinations")
    .update({ assigned_agent_id: agentId, updated_at: new Date().toISOString() })
    .eq("id", String(req.params["id"] ?? ""))
    .eq("org_id", req.user!.orgId);
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ ok: true });
});

// PATCH /api/whatsapp-destinations/:id/assign-reps — Owner/Admin: assign multiple reps
router.patch("/:id/assign-reps", requireRole("Owner", "Admin"), async (req, res) => {
  // repIds: array of user UUIDs (empty array = unassigned)
  const repIds: string[] = Array.isArray(req.body?.repIds)
    ? req.body.repIds.filter((id: unknown) => typeof id === "string")
    : [];
  const { error } = await supabase
    .from("whatsapp_user_destinations")
    .update({
      assigned_rep_ids: repIds,
      // keep single-rep field in sync with first entry for legacy queries
      assigned_rep_id: repIds[0] ?? null,
      updated_at: new Date().toISOString()
    })
    .eq("id", String(req.params["id"] ?? ""))
    .eq("org_id", req.user!.orgId);
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ ok: true, repIds });
});

export default router;
