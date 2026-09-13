import { Router } from "express";
import { z } from "zod";
import { supabase } from "../lib/supabase.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);

const branchSchema = z.object({
  countryCode: z.string().trim().min(2).max(3),
  countryName: z.string().trim().min(2).max(80),
  name: z.string().trim().min(2).max(120),
  stateOrRegion: z.string().trim().max(120).optional().nullable(),
  city: z.string().trim().max(120).optional().nullable(),
  currency: z.enum(["NGN", "USD", "GBP"]).default("NGN")
});

router.get("/", async (req, res) => {
  const { data, error } = await supabase
    .from("branches")
    .select("id, country_code, country_name, name, state_or_region, city, currency, active, created_at")
    .eq("org_id", req.user!.orgId)
    .eq("active", true)
    .order("country_name")
    .order("name");
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json((data ?? []).map((row) => ({
    id: row.id, countryCode: row.country_code, countryName: row.country_name,
    name: row.name, stateOrRegion: row.state_or_region, city: row.city,
    currency: row.currency, active: row.active, createdAt: row.created_at
  })));
});

router.post("/", async (req, res) => {
  if (req.user!.role !== "Owner") { res.status(403).json({ error: "Only the Owner can create branches." }); return; }
  const parsed = branchSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten().fieldErrors }); return; }
  const value = parsed.data;
  const { data, error } = await supabase.from("branches").insert({
    org_id: req.user!.orgId, country_code: value.countryCode.toUpperCase(),
    country_name: value.countryName, name: value.name,
    state_or_region: value.stateOrRegion ?? null, city: value.city ?? null,
    currency: value.currency
  }).select("id, country_code, country_name, name, state_or_region, city, currency, active, created_at").single();
  if (error) { res.status(error.code === "23505" ? 409 : 500).json({ error: error.message }); return; }
  const { error: membershipError } = await supabase.from("branch_memberships").insert({ branch_id: data.id, user_id: req.user!.id, is_default: false });
  if (membershipError) { res.status(500).json({ error: membershipError.message }); return; }
  res.status(201).json({ branch: {
    id: data.id, countryCode: data.country_code, countryName: data.country_name,
    name: data.name, stateOrRegion: data.state_or_region, city: data.city,
    currency: data.currency, active: data.active, createdAt: data.created_at
  }});
});

export default router;
