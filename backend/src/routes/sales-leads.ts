import { Router } from "express";
import { z } from "zod";
import { supabase } from "../lib/supabase.js";
import { humanFieldErrors } from "../lib/validation-message.js";
import { requireAuth, requireRole, scopeOf } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth, requireRole("Owner", "Admin", "Manager", "Sales Closer"));

const SUPERVISOR_ROLES = new Set(["Owner", "Admin", "Manager"]);

const LeadFields = z.object({
  fullName: z.string().trim().min(2).max(160),
  phone: z.string().trim().min(5).max(32),
  alternatePhone: z.string().trim().max(32).optional(),
  whatsappNumber: z.string().trim().max(32).optional(),
  email: z.string().trim().email().max(160).optional().or(z.literal("")),
  preferredContactMethod: z.enum(["whatsapp", "call", "sms", "email"]).default("whatsapp"),
  state: z.string().trim().max(80).optional(),
  city: z.string().trim().max(120).optional(),
  address: z.string().trim().max(400).optional(),
  source: z.enum(["whatsapp", "instagram", "tiktok", "facebook", "website", "phone", "referral", "other"]).default("whatsapp"),
  campaign: z.string().trim().max(200).optional(),
  interestedProductIds: z.array(z.string().uuid()).max(20).default([]),
  packageId: z.string().uuid().optional(),
  notes: z.string().trim().max(500).optional(),
  status: z.enum(["new_lead", "contacted", "qualified", "follow_up", "order_created", "not_interested"]).default("new_lead"),
  tags: z.array(z.string().trim().max(40)).max(10).default([]),
  priority: z.enum(["low", "medium", "high"]).default("medium"),
  assignedCloserId: z.string().uuid().optional(),
  followUpAt: z.string().datetime().optional(),
  // Set once, by Convert to Order (never by the Add Lead / edit form).
  convertedOrderId: z.string().min(1).max(50).optional(),
  convertedAt: z.string().datetime().optional()
}).strict();

const CreateSchema = LeadFields;
const PatchSchema = LeadFields.partial().strict();

const rowToApi = (row: any) => ({
  id: row.id,
  fullName: row.full_name,
  phone: row.phone,
  alternatePhone: row.alternate_phone ?? "",
  whatsappNumber: row.whatsapp_number ?? "",
  email: row.email ?? "",
  preferredContactMethod: row.preferred_contact_method,
  state: row.state ?? "",
  city: row.city ?? "",
  address: row.address ?? "",
  source: row.source,
  campaign: row.campaign ?? "",
  interestedProductIds: Array.isArray(row.interested_product_ids) ? row.interested_product_ids : [],
  packageId: row.package_id,
  notes: row.notes ?? "",
  status: row.status,
  tags: Array.isArray(row.tags) ? row.tags : [],
  priority: row.priority,
  assignedCloserId: row.assigned_closer_id,
  followUpAt: row.follow_up_at,
  convertedOrderId: row.converted_order_id,
  convertedAt: row.converted_at,
  lastActivityAt: row.last_activity_at,
  createdBy: row.created_by,
  createdAt: row.created_at,
  updatedAt: row.updated_at
});

type LeadFieldValues = {
  fullName: string;
  phone: string;
  alternatePhone?: string;
  whatsappNumber?: string;
  email?: string;
  preferredContactMethod: string;
  state?: string;
  city?: string;
  address?: string;
  source: string;
  campaign?: string;
  interestedProductIds: string[];
  packageId?: string;
  notes?: string;
  status: string;
  tags: string[];
  priority: string;
  assignedCloserId?: string;
  followUpAt?: string;
  convertedOrderId?: string;
  convertedAt?: string;
};

const rowPayload = (value: LeadFieldValues, req: any) => ({
  org_id: req.user.orgId,
  full_name: value.fullName,
  phone: value.phone,
  alternate_phone: value.alternatePhone || null,
  whatsapp_number: value.whatsappNumber || null,
  email: value.email || null,
  preferred_contact_method: value.preferredContactMethod,
  state: value.state || null,
  city: value.city || null,
  address: value.address || null,
  source: value.source,
  campaign: value.campaign || null,
  interested_product_ids: value.interestedProductIds,
  package_id: value.packageId || null,
  notes: value.notes || null,
  status: value.status,
  tags: value.tags,
  priority: value.priority,
  assigned_closer_id: value.assignedCloserId || null,
  follow_up_at: value.followUpAt || null,
  converted_order_id: value.convertedOrderId || null,
  converted_at: value.convertedAt || null,
  updated_at: new Date().toISOString()
});

router.get("/", async (req, res) => {
  try {
    const scope = scopeOf(req);
    let query = supabase
      .from("sales_leads")
      .select("*")
      .eq("org_id", req.user!.orgId)
      .order("created_at", { ascending: false });
    if (!SUPERVISOR_ROLES.has(scope.role)) {
      query = query.or(`assigned_closer_id.eq.${scope.id},assigned_closer_id.is.null`);
    }
    if (typeof req.query.status === "string" && req.query.status !== "all") {
      query = query.eq("status", req.query.status);
    }
    const { data, error } = await query;
    if (error) throw error;
    res.json({ leads: (data ?? []).map(rowToApi) });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Could not load leads." });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const scope = scopeOf(req);
    const { data, error } = await supabase
      .from("sales_leads")
      .select("*")
      .eq("org_id", req.user!.orgId)
      .eq("id", req.params.id)
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      res.status(404).json({ error: "Lead not found." });
      return;
    }
    if (!SUPERVISOR_ROLES.has(scope.role) && data.assigned_closer_id && data.assigned_closer_id !== scope.id) {
      res.status(403).json({ error: "This lead is assigned to another closer." });
      return;
    }
    res.json(rowToApi(data));
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Could not load this lead." });
  }
});

router.post("/", async (req, res) => {
  const parsed = CreateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: humanFieldErrors(parsed.error) });
    return;
  }
  try {
    const scope = scopeOf(req);
    // A Sales Closer logging her own lead always owns it - only leadership
    // can hand a new lead straight to someone else.
    const assignedCloserId = SUPERVISOR_ROLES.has(scope.role)
      ? (parsed.data.assignedCloserId || null)
      : scope.id;
    const { data, error } = await supabase
      .from("sales_leads")
      .insert({
        ...rowPayload(parsed.data, req),
        assigned_closer_id: assignedCloserId,
        created_by: req.user!.id
      })
      .select("*")
      .single();
    if (error) throw error;
    res.status(201).json(rowToApi(data));
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Could not create this lead." });
  }
});

router.patch("/:id", async (req, res) => {
  const parsed = PatchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: humanFieldErrors(parsed.error) });
    return;
  }
  try {
    const scope = scopeOf(req);
    const { data: existing, error: existingError } = await supabase
      .from("sales_leads")
      .select("*")
      .eq("org_id", req.user!.orgId)
      .eq("id", req.params.id)
      .maybeSingle();
    if (existingError) throw existingError;
    if (!existing) {
      res.status(404).json({ error: "Lead not found." });
      return;
    }
    if (!SUPERVISOR_ROLES.has(scope.role) && existing.assigned_closer_id && existing.assigned_closer_id !== scope.id) {
      res.status(403).json({ error: "This lead is assigned to another closer." });
      return;
    }
    // existing.* comes straight from the DB (already valid, already
    // trusted) - only the incoming body needs Zod's scrutiny, which
    // already happened via PatchSchema.safeParse above. Re-running trusted
    // values like follow_up_at back through LeadFields would reject them:
    // Postgres returns timestamptz as "+00:00", not the "Z" suffix
    // z.string().datetime() requires by default.
    const merged: LeadFieldValues = {
      fullName: existing.full_name,
      phone: existing.phone,
      alternatePhone: existing.alternate_phone ?? undefined,
      whatsappNumber: existing.whatsapp_number ?? undefined,
      email: existing.email ?? undefined,
      preferredContactMethod: existing.preferred_contact_method,
      state: existing.state ?? undefined,
      city: existing.city ?? undefined,
      address: existing.address ?? undefined,
      source: existing.source,
      campaign: existing.campaign ?? undefined,
      interestedProductIds: existing.interested_product_ids ?? [],
      packageId: existing.package_id ?? undefined,
      notes: existing.notes ?? undefined,
      status: existing.status,
      tags: existing.tags ?? [],
      priority: existing.priority,
      assignedCloserId: existing.assigned_closer_id ?? undefined,
      followUpAt: existing.follow_up_at ?? undefined,
      convertedOrderId: existing.converted_order_id ?? undefined,
      convertedAt: existing.converted_at ?? undefined,
      ...parsed.data
    };
    const { data, error } = await supabase
      .from("sales_leads")
      .update({ ...rowPayload(merged, req), last_activity_at: new Date().toISOString() })
      .eq("org_id", req.user!.orgId)
      .eq("id", existing.id)
      .select("*")
      .single();
    if (error) throw error;
    res.json(rowToApi(data));
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Could not update this lead." });
  }
});

export default router;
