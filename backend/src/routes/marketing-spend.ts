import { Router } from "express";
import { z } from "zod";
import { supabase } from "../lib/supabase.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { sanitizeMarketingAttributionTags } from "../lib/marketing-attribution.js";

const router = Router();
router.use(requireAuth);

const READ_ROLES = ["Owner", "Admin", "Manager", "Marketer"] as const;
const CREATE_ROLES = ["Owner", "Admin", "Marketer"] as const;
const ADMIN_WRITE_ROLES = ["Owner", "Admin"] as const;
const CURRENCIES = ["NGN", "USD", "GBP"] as const;
const REVIEW_STATUSES = ["pending", "matched", "mismatch"] as const;
const SPEND_OWNER_TYPES = ["media_buyer", "company"] as const;

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

const marketingExpenseId = (spendId: string) => `marketing-spend-${spendId}`;

const syncMarketingSpendExpense = async (row: any, orgId: string) => {
  const expenseId = marketingExpenseId(String(row.id));
  if (row.review_status !== "matched") {
    const { error } = await supabase
      .from("expenses")
      .delete()
      .eq("id", expenseId)
      .eq("org_id", orgId);
    if (error) throw error;
    return;
  }

  const actualSpent = normalizeMoney(row.actual_spent) ?? 0;
  const budgetGiven = normalizeMoney(row.budget_given) ?? 0;
  const amount = actualSpent > 0 ? actualSpent : budgetGiven;
  if (amount <= 0) {
    const { error } = await supabase
      .from("expenses")
      .delete()
      .eq("id", expenseId)
      .eq("org_id", orgId);
    if (error) throw error;
    return;
  }

  const ownerLabel = row.spend_owner_type === "company" ? "Company ad account" : "Media buyer";
  const tag = clean(row.marketer_tag, 80) || (row.spend_owner_type === "company" ? "company" : "media buyer");
  const campaign = clean(row.campaign, 120);
  const platform = clean(row.platform || "Facebook", 80);
  const description = [
    `${ownerLabel} ad spend`,
    tag,
    campaign,
    platform
  ].filter(Boolean).join(" — ");

  const { error } = await supabase
    .from("expenses")
    .upsert({
      id: expenseId,
      org_id: orgId,
      date: row.spend_date,
      category: "Ad Spend",
      description,
      amount,
      currency: row.currency ?? "NGN",
      paid_by: tag,
      product_id: row.product_id ?? null
    }, { onConflict: "id" });
  if (error) throw error;
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
  proofUrl: z.string().max(2048).optional().or(z.literal("")),
  spendOwnerType: z.enum(SPEND_OWNER_TYPES).optional(),
  reviewStatus: z.enum(REVIEW_STATUSES).optional(),
  matchNote: z.string().max(1000).optional()
});

const PatchSpendSchema = SpendSchema.partial();
type SpendInput = z.infer<typeof SpendSchema>;
type PatchSpendInput = z.infer<typeof PatchSpendSchema>;

const isAdminWriter = (role: string | undefined) => role === "Owner" || role === "Admin";
const hasOwn = (value: object, key: string) =>
  Object.prototype.hasOwnProperty.call(value, key);

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

const resolveMarketerForRequest = async (body: SpendInput | PatchSpendInput, req: any) => {
  const orgId = req.user!.orgId;
  const spendOwnerType = req.user!.role === "Marketer" ? "media_buyer" : (body.spendOwnerType ?? "media_buyer");
  if (req.user!.role === "Marketer") {
    const ownTags = sanitizeMarketingAttributionTags(req.user!.marketingAttributionTags);
    const requestedTag = sanitizeMarketingAttributionTags(body.marketerTag ?? [])[0] ?? "";
    const marketerTag = requestedTag && ownTags.includes(requestedTag) ? requestedTag : ownTags[0] || "";
    if (!marketerTag) {
      throw Object.assign(new Error("Your marketer account needs a tracking tag before you can submit ad spend."), { status: 400 });
    }
    return { marketerUserId: req.user!.id, marketerTag, spendOwnerType };
  }

  if (spendOwnerType === "company") {
    const companyTag = sanitizeMarketingAttributionTags(body.marketerTag ?? [])[0] || "company";
    return { marketerUserId: null, marketerTag: companyTag, spendOwnerType };
  }

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
  return { marketerUserId: body.marketerUserId ?? null, marketerTag, spendOwnerType };
};

const rowForWrite = async (body: SpendInput | PatchSpendInput, req: any, options?: { existing?: any; create?: boolean }) => {
  const orgId = req.user!.orgId;
  const { marketerUserId, marketerTag, spendOwnerType } = await resolveMarketerForRequest(body, req);

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
    marketer_user_id: marketerUserId,
    marketer_tag: marketerTag,
    spend_owner_type: spendOwnerType,
    product_id: body.productId || null,
    platform: clean(body.platform || "Facebook", 80) || "Facebook",
    campaign: clean(body.campaign, 140) || null,
    landing_page_url: safeUrl(body.landingPageUrl),
    budget_given: budgetGiven,
    actual_spent: actualSpent ?? null,
    currency: body.currency ?? "NGN",
    notes: clean(body.notes, 1000) || null,
    proof_url: safeUrl(body.proofUrl),
    entry_source: req.user!.role === "Marketer" ? "marketer" : (options?.existing?.entry_source ?? "owner_admin"),
    review_status: req.user!.role === "Marketer"
      ? (options?.existing?.review_status ?? "pending")
      : (body.reviewStatus ?? options?.existing?.review_status ?? "matched"),
    matched_by: req.user!.role === "Marketer"
      ? (options?.existing?.matched_by ?? null)
      : ((body.reviewStatus ?? options?.existing?.review_status ?? "matched") === "pending" ? null : req.user!.id),
    matched_at: req.user!.role === "Marketer"
      ? (options?.existing?.matched_at ?? null)
      : ((body.reviewStatus ?? options?.existing?.review_status ?? "matched") === "pending" ? null : new Date().toISOString()),
    match_note: req.user!.role === "Marketer" ? (options?.existing?.match_note ?? null) : (clean(body.matchNote, 1000) || null),
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
    if (tags.length === 0) query = query.eq("marketer_user_id", req.user!.id);
    else query = query.or(`marketer_user_id.eq.${req.user!.id},marketer_tag.in.(${tags.map((tag) => `"${tag.replace(/"/g, '\\"')}"`).join(",")})`);
  }

  const { data, error } = await query;
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(data ?? []);
});

router.post("/", requireRole(...CREATE_ROLES), async (req, res) => {
  const parsed = SpendSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten().fieldErrors }); return; }
  try {
    const insert = await rowForWrite(parsed.data, req, { create: true });
    const { data, error } = await supabase
      .from("marketing_spend_records")
      .insert(insert)
      .select()
      .single();
    if (error) { res.status(500).json({ error: error.message }); return; }
    await syncMarketingSpendExpense(data, req.user!.orgId);
    res.status(201).json(data);
  } catch (err: any) {
    res.status(err?.status ?? 500).json({ error: err?.message ?? "Could not save marketing spend." });
  }
});

router.patch("/:id", requireRole(...CREATE_ROLES), async (req, res) => {
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
  const adminWriter = isAdminWriter(req.user!.role);
  if (!adminWriter) {
    if (
      req.user!.role !== "Marketer"
      || existing.marketer_user_id !== req.user!.id
      || existing.entry_source !== "marketer"
      || existing.review_status !== "pending"
      || parsed.data.reviewStatus
      || parsed.data.matchNote
    ) {
      res.status(403).json({ error: "Only Owner/Admin can match or edit reviewed marketing spend." });
      return;
    }
  }

  const merged = {
    spendDate: parsed.data.spendDate ?? existing.spend_date,
    marketerUserId: parsed.data.marketerUserId ?? existing.marketer_user_id,
    marketerTag: parsed.data.marketerTag ?? existing.marketer_tag,
    spendOwnerType: parsed.data.spendOwnerType ?? existing.spend_owner_type ?? "media_buyer",
    productId: parsed.data.productId ?? existing.product_id,
    platform: parsed.data.platform ?? existing.platform,
    campaign: parsed.data.campaign ?? existing.campaign ?? undefined,
    landingPageUrl: parsed.data.landingPageUrl ?? existing.landing_page_url ?? undefined,
    budgetGiven: parsed.data.budgetGiven ?? existing.budget_given,
    actualSpent: hasOwn(parsed.data, "actualSpent") ? parsed.data.actualSpent : existing.actual_spent,
    currency: parsed.data.currency ?? existing.currency,
    notes: parsed.data.notes ?? existing.notes ?? undefined,
    proofUrl: parsed.data.proofUrl ?? existing.proof_url ?? undefined,
    reviewStatus: parsed.data.reviewStatus ?? existing.review_status,
    matchNote: parsed.data.matchNote ?? existing.match_note ?? undefined
  };

  try {
    const update = await rowForWrite(merged, req, { existing });
    delete (update as any).org_id;
    delete (update as any).created_by;
    if (!adminWriter) {
      delete (update as any).entry_source;
      delete (update as any).review_status;
      delete (update as any).matched_by;
      delete (update as any).matched_at;
      delete (update as any).match_note;
    }
    const { data, error } = await supabase
      .from("marketing_spend_records")
      .update(update)
      .eq("id", id)
      .eq("org_id", req.user!.orgId)
      .select()
      .single();
    if (error) { res.status(500).json({ error: error.message }); return; }
    await syncMarketingSpendExpense(data, req.user!.orgId);
    res.json(data);
  } catch (err: any) {
    res.status(err?.status ?? 500).json({ error: err?.message ?? "Could not update marketing spend." });
  }
});

router.delete("/:id", requireRole(...CREATE_ROLES), async (req, res) => {
  let query = supabase
    .from("marketing_spend_records")
    .delete()
    .eq("id", req.params.id)
    .eq("org_id", req.user!.orgId);
  if (!isAdminWriter(req.user!.role)) {
    query = query
      .eq("marketer_user_id", req.user!.id)
      .eq("entry_source", "marketer")
      .eq("review_status", "pending");
  }
  const { error } = await query;
  if (error) { res.status(500).json({ error: error.message }); return; }
  await supabase
    .from("expenses")
    .delete()
    .eq("id", marketingExpenseId(String(req.params.id)))
    .eq("org_id", req.user!.orgId);
  res.status(204).send();
});

export default router;
