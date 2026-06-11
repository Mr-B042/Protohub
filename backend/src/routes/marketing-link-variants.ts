import { Router } from "express";
import { z } from "zod";
import { supabase } from "../lib/supabase.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { sanitizeMarketingAttributionTags } from "../lib/marketing-attribution.js";

const router = Router();
router.use(requireAuth);

const ALLOWED_ROLES = ["Owner", "Admin", "Manager", "Marketer"] as const;

const clean = (value: unknown, max = 120) =>
  String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);

const slugify = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 100);

const safeUrl = (value: unknown) => {
  const raw = clean(value, 2048);
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
};

const isAllMarketingManager = (role: string) => role === "Owner" || role === "Admin" || role === "Manager";

const productBelongsToOrg = async (productId: string, orgId: string) => {
  const { data, error } = await supabase
    .from("products")
    .select("id")
    .eq("id", productId)
    .eq("org_id", orgId)
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
};

const VariantSchema = z.object({
  productId: z.string().uuid(),
  marketerUserId: z.string().uuid().nullable().optional(),
  marketerTag: z.string().min(1).max(80).optional(),
  label: z.string().min(1).max(120),
  packageSet: z.string().max(80).optional().or(z.literal("")),
  landingPageUrl: z.string().max(2048).optional().or(z.literal("")),
  utmSource: z.string().min(1).max(100).optional(),
  utmMedium: z.string().max(100).optional(),
  utmCampaign: z.string().max(100).optional(),
  utmContent: z.string().max(100).optional(),
  utmTerm: z.string().max(100).optional(),
  active: z.boolean().optional()
});

const resolveMarketerTag = (role: string, ownTags: string[], incoming?: string) => {
  const incomingTag = sanitizeMarketingAttributionTags(incoming ?? [])[0] ?? "";
  if (role === "Marketer") {
    if (ownTags.length === 0) return "";
    if (incomingTag && !ownTags.map((tag) => tag.toLowerCase()).includes(incomingTag.toLowerCase())) {
      return "";
    }
    return incomingTag || ownTags[0];
  }
  return incomingTag;
};

router.get("/", requireRole(...ALLOWED_ROLES), async (req, res) => {
  let query = supabase
    .from("marketing_link_variants")
    .select("*")
    .eq("org_id", req.user!.orgId)
    .order("created_at", { ascending: false });

  const productId = typeof req.query.productId === "string" ? req.query.productId : "";
  if (productId) query = query.eq("product_id", productId);

  if (req.user!.role === "Marketer") {
    const tags = sanitizeMarketingAttributionTags(req.user!.marketingAttributionTags);
    if (tags.length === 0) {
      res.json([]);
      return;
    }
    query = query.in("marketer_tag", tags);
  }

  const { data, error } = await query;
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(data ?? []);
});

router.post("/", requireRole(...ALLOWED_ROLES), async (req, res) => {
  const parsed = VariantSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten().fieldErrors }); return; }
  if (!await productBelongsToOrg(parsed.data.productId, req.user!.orgId)) {
    res.status(404).json({ error: "Product not found." });
    return;
  }

  const ownTags = sanitizeMarketingAttributionTags(req.user!.marketingAttributionTags);
  const marketerTag = resolveMarketerTag(req.user!.role, ownTags, parsed.data.marketerTag);
  if (!marketerTag) {
    res.status(403).json({ error: req.user!.role === "Marketer" ? "Ask the Owner to assign your marketer tag first." : "Choose a marketer tag for this link." });
    return;
  }

  const label = clean(parsed.data.label, 120);
  const utmSource = clean(parsed.data.utmSource || "Facebook", 100);
  const utmMedium = clean(parsed.data.utmMedium || "paid_social", 100);
  const utmCampaign = clean(parsed.data.utmCampaign || "embed", 100);
  const utmContent = slugify(parsed.data.utmContent || `${marketerTag}-${label}`);
  if (!utmContent) {
    res.status(400).json({ error: { utmContent: ["Could not generate a tracking slug. Rename the landing page link."] } });
    return;
  }

  const insert = {
    org_id: req.user!.orgId,
    product_id: parsed.data.productId,
    marketer_user_id: req.user!.role === "Marketer" ? req.user!.id : parsed.data.marketerUserId ?? null,
    marketer_tag: marketerTag,
    label,
    package_set: clean(parsed.data.packageSet, 80) || null,
    landing_page_url: safeUrl(parsed.data.landingPageUrl),
    utm_source: utmSource,
    utm_medium: utmMedium,
    utm_campaign: utmCampaign,
    utm_content: utmContent,
    utm_term: clean(parsed.data.utmTerm, 100) || null,
    active: parsed.data.active !== false,
    created_by: req.user!.id
  };

  const { data, error } = await supabase
    .from("marketing_link_variants")
    .insert(insert)
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      res.status(409).json({ error: "A tracked link with this landing-page slug already exists for this product and marketer." });
      return;
    }
    res.status(500).json({ error: error.message });
    return;
  }
  res.status(201).json(data);
});

router.delete("/:id", requireRole(...ALLOWED_ROLES), async (req, res) => {
  const id = String(req.params.id);
  let query = supabase
    .from("marketing_link_variants")
    .delete()
    .eq("id", id)
    .eq("org_id", req.user!.orgId);

  if (!isAllMarketingManager(req.user!.role)) {
    const tags = sanitizeMarketingAttributionTags(req.user!.marketingAttributionTags);
    if (tags.length === 0) { res.status(403).json({ error: "No marketer tag assigned." }); return; }
    query = query.in("marketer_tag", tags);
  }

  const { error } = await query;
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.status(204).send();
});

export default router;
