import { Router } from "express";
import { z } from "zod";
import { supabase } from "../lib/supabase.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { sanitizeMarketingAttributionTags } from "../lib/marketing-attribution.js";

const router = Router();
router.use(requireAuth);

const READ_ROLES = ["Owner", "Admin", "Manager", "Marketer"] as const;
const WRITE_ROLES = ["Owner", "Admin"] as const;
const CURRENCIES = ["NGN", "USD", "GBP"] as const;

const clean = (value: unknown, max = 240) =>
  String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);

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

const normalizeMoney = (value: unknown) => {
  if (value === null || value === undefined || value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.round((n + Number.EPSILON) * 100) / 100) : undefined;
};

const SpendSchema = z.object({
  spendDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  marketerUserId: z.string().uuid().nullable().optional(),
  marketerTag: z.string().min(1).max(80).optional(),
  productId: z.string().uuid().nullable().optional(),
  platform: z.string().max(80).optional(),
  campaign: z.string().max(140).optional(),
  landingPageUrl: z.string().max(2048).optional().or(z.literal("")),
  budgetGiven: z.union([z.number(), z.string()]).optional(),
  actualSpent: z.union([z.number(), z.string(), z.null()]).optional(),
  currency: z.enum(CURRENCIES).default("NGN"),
  notes: z.string().max(1000).optional(),
  proofUrl: z.string().max(2048).optional().or(z.literal(""))
});

const PatchSpendSchema = SpendSchema.partial();

const marketerBelongsToOrg = async (userId: string, orgId: string) => {
  const { data, error } = await supabase
    .from("users")
    .select("id, marketing_attribution_tags")
    .eq("id", userId)
    .eq("org_id", orgId)
    .eq("role", "Marketer")
    .maybeSingle();
  if (error) throw error;
  return data as { id: string; marketing_attribution_tags?: unknown } | null;
};

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

const rowForWrite = async (body: z.infer<typeof SpendSchema>, req: any) => {
  const orgId = req.user!.orgId;
  let marketerTags: string[] = [];
  if (body.marketerUserId) {
    const marketer = await marketerBelongsToOrg(body.marketerUserId, orgId);
    if (!marketer) throw Object.assign(new Error("Marketer not found in this workspace."), { status: 404 });
    marketerTags = sanitizeMarketingAttributionTags(marketer.marketing_attribution_tags);
  }

  const requestedTag = sanitizeMarketingAttributionTags(body.marketerTag ?? [])[0] ?? "";
  const marketerTag = requestedTag || marketerTags[0] || "";
  if (!marketerTag) {
    throw Object.assign(new Error("Choose a marketer tag or assign a tag to this marketer first."), { status: 400 });
  }

  if (body.productId && !await productBelongsToOrg(body.productId, orgId)) {
    throw Object.assign(new Error("Product not found in this workspace."), { status: 404 });
  }

  const budgetGiven = normalizeMoney(body.budgetGiven) ?? 0;
  const actualSpent = normalizeMoney(body.actualSpent);
  if (budgetGiven <= 0 && (actualSpent ?? 0) <= 0) {
    throw Object.assign(new Error("Enter budget given or actual spent."), { status: 400 });
  }

  return {
    org_id: orgId,
    spend_date: body.spendDate,
    marketer_user_id: body.marketerUserId ?? null,
    marketer_tag: marketerTag,
    product_id: body.productId || null,
    platform: clean(body.platform || "Facebook", 80) || "Facebook",
    campaign: clean(body.campaign, 140) || null,
    landing_page_url: safeUrl(body.landingPageUrl),
    budget_given: budgetGiven,
    actual_spent: actualSpent ?? null,
    currency: body.currency ?? "NGN",
    notes: clean(body.notes, 1000) || null,
    proof_url: safeUrl(body.proofUrl),
    created_by: req.user!.id,
    updated_at: new Date().toISOString()
  };
};

router.get("/", requireRole(...READ_ROLES), async (req, res) => {
  const { from, to, productId, marketerUserId } = req.query;
  let query = supabase
    .from("marketing_spend_records")
    .select("*")
    .eq("org_id", req.user!.orgId)
    .order("spend_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (typeof from === "string" && /^\d{4}-\d{2}-\d{2}$/.test(from)) query = query.gte("spend_date", from);
  if (typeof to === "string" && /^\d{4}-\d{2}-\d{2}$/.test(to)) query = query.lte("spend_date", to);
  if (typeof productId === "string" && productId) query = query.eq("product_id", productId);
  if (typeof marketerUserId === "string" && marketerUserId && req.user!.role !== "Marketer") query = query.eq("marketer_user_id", marketerUserId);

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

router.post("/", requireRole(...WRITE_ROLES), async (req, res) => {
  const parsed = SpendSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten().fieldErrors }); return; }
  try {
    const insert = await rowForWrite(parsed.data, req);
    const { data, error } = await supabase
      .from("marketing_spend_records")
      .insert(insert)
      .select()
      .single();
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.status(201).json(data);
  } catch (err: any) {
    res.status(err?.status ?? 500).json({ error: err?.message ?? "Could not save marketing spend." });
  }
});

router.patch("/:id", requireRole(...WRITE_ROLES), async (req, res) => {
  const id = String(req.params.id);
  const parsed = PatchSpendSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten().fieldErrors }); return; }

  const { data: existing, error: existingError } = await supabase
    .from("marketing_spend_records")
    .select("*")
    .eq("id", id)
    .eq("org_id", req.user!.orgId)
    .maybeSingle();
  if (existingError) { res.status(500).json({ error: existingError.message }); return; }
  if (!existing) { res.status(404).json({ error: "Marketing spend record not found." }); return; }

  const merged = {
    spendDate: parsed.data.spendDate ?? existing.spend_date,
    marketerUserId: parsed.data.marketerUserId ?? existing.marketer_user_id,
    marketerTag: parsed.data.marketerTag ?? existing.marketer_tag,
    productId: parsed.data.productId ?? existing.product_id,
    platform: parsed.data.platform ?? existing.platform,
    campaign: parsed.data.campaign ?? existing.campaign ?? undefined,
    landingPageUrl: parsed.data.landingPageUrl ?? existing.landing_page_url ?? undefined,
    budgetGiven: parsed.data.budgetGiven ?? existing.budget_given,
    actualSpent: parsed.data.actualSpent ?? existing.actual_spent,
    currency: parsed.data.currency ?? existing.currency,
    notes: parsed.data.notes ?? existing.notes ?? undefined,
    proofUrl: parsed.data.proofUrl ?? existing.proof_url ?? undefined
  };

  try {
    const update = await rowForWrite(merged, req);
    delete (update as any).org_id;
    delete (update as any).created_by;
    const { data, error } = await supabase
      .from("marketing_spend_records")
      .update(update)
      .eq("id", id)
      .eq("org_id", req.user!.orgId)
      .select()
      .single();
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json(data);
  } catch (err: any) {
    res.status(err?.status ?? 500).json({ error: err?.message ?? "Could not update marketing spend." });
  }
});

router.delete("/:id", requireRole(...WRITE_ROLES), async (req, res) => {
  const { error } = await supabase
    .from("marketing_spend_records")
    .delete()
    .eq("id", req.params.id)
    .eq("org_id", req.user!.orgId);
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.status(204).send();
});

export default router;
