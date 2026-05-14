import { Router } from "express";
import { z } from "zod";
import { supabase } from "../lib/supabase.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = Router();

const DEFAULTS = {
  state_field_mode:             "freetext" as "freetext" | "dropdown",
  public_order_assignment_mode: "auto_assign" as "auto_assign" | "manual_review",
  show_email:                   false,
  show_whatsapp:                true,
  require_whatsapp:             true,
  address_required:             true,
  city_required:                true,
  show_package_name:            false,
  ask_delivery:                 false,
  delivery_input_style:         "quick" as "quick" | "range",
  delivery_quick_today:         true,
  delivery_quick_tomorrow:      true,
  delivery_quick_next_tomorrow: false,
  delivery_range_min_days:      0,
  delivery_range_max_days:      7,
  require_confirmation:         false,
  confirmation_text:            "I hereby confirm that I am financially prepared and available to receive this product within the next 1 to 3 days",
  show_commitment:              false,
  commitment_text:              "Please note that orders outside Lagos and Abuja attract a commitment fee of ₦1500 before dispatch",
  allow_disagree:               true,
  form_order_summary_enabled:   true,
  form_order_summary_title:     "Your Order Summary"
};

// Reads either the org row or returns defaults — used by both auth + public GET.
async function readSettings(orgId: string) {
  const { data, error } = await supabase
    .from("embed_settings")
    .select("*")
    .eq("org_id", orgId)
    .maybeSingle();
  if (error) throw error;
  return { org_id: orgId, ...DEFAULTS, ...(data ?? {}) };
}

router.use(requireAuth);

router.get("/", async (req, res) => {
  try {
    res.json(await readSettings(req.user!.orgId));
  } catch (e: any) {
    res.status(500).json({ error: e.message ?? "Failed to load embed settings." });
  }
});

const SettingsSchema = z.object({
  state_field_mode:             z.enum(["freetext", "dropdown"]).optional(),
  public_order_assignment_mode: z.enum(["auto_assign", "manual_review"]).optional(),
  show_email:                   z.boolean().optional(),
  show_whatsapp:                z.boolean().optional(),
  require_whatsapp:             z.boolean().optional(),
  address_required:             z.boolean().optional(),
  city_required:                z.boolean().optional(),
  show_package_name:            z.boolean().optional(),
  ask_delivery:                 z.boolean().optional(),
  delivery_input_style:         z.enum(["quick", "range"]).optional(),
  delivery_quick_today:         z.boolean().optional(),
  delivery_quick_tomorrow:      z.boolean().optional(),
  delivery_quick_next_tomorrow: z.boolean().optional(),
  delivery_range_min_days:      z.number().int().min(0).max(365).optional(),
  delivery_range_max_days:      z.number().int().min(0).max(365).optional(),
  require_confirmation:         z.boolean().optional(),
  confirmation_text:            z.string().max(500).optional(),
  show_commitment:              z.boolean().optional(),
  commitment_text:              z.string().max(500).optional(),
  allow_disagree:               z.boolean().optional(),
  form_order_summary_enabled:   z.boolean().optional(),
  form_order_summary_title:     z.string().max(120).optional()
});

router.patch("/", requireRole("Owner", "Admin"), async (req, res) => {
  const parsed = SettingsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }
  const normalized = { ...parsed.data };
  if (normalized.form_order_summary_title !== undefined) {
    normalized.form_order_summary_title = normalized.form_order_summary_title.trim() || DEFAULTS.form_order_summary_title;
  }
  if (normalized.confirmation_text !== undefined) {
    normalized.confirmation_text = normalized.confirmation_text.trim() || DEFAULTS.confirmation_text;
  }
  if (normalized.commitment_text !== undefined) {
    normalized.commitment_text = normalized.commitment_text.trim() || DEFAULTS.commitment_text;
  }
  if (normalized.delivery_range_min_days !== undefined || normalized.delivery_range_max_days !== undefined) {
    const minDays = Math.max(0, normalized.delivery_range_min_days ?? DEFAULTS.delivery_range_min_days);
    const maxDays = Math.max(minDays, normalized.delivery_range_max_days ?? DEFAULTS.delivery_range_max_days);
    normalized.delivery_range_min_days = minDays;
    normalized.delivery_range_max_days = maxDays;
  }
  const payload = { org_id: req.user!.orgId, ...normalized };
  const { data, error } = await supabase
    .from("embed_settings")
    .upsert(payload, { onConflict: "org_id" })
    .select()
    .single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(data);
});

export default router;
export { readSettings };
