import { Router, type Request } from "express";
import { z } from "zod";
import { supabase } from "../lib/supabase.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { addDaysToDateKey, incrementalRevenueForOrder, lagosDateKey, sundayWeekStartForDateKey } from "../lib/head-of-sales-metrics.js";
import {
  CATEGORY_LABEL, HEALTH_LABEL, fillScriptText, funnelOf, mergeSettings, nearDuplicates, outdatedPrices,
  playbookReadiness, repDiagnosis, scriptHealth, type ScriptCategory, type ScriptSettings, type UseFact
} from "../lib/sales-scripting.js";
import { activeHead, releaseFor } from "./sales-scripts.js";
import { notifySalesScript } from "../lib/weekly-report-notifications.js";

// Sales Scripting (Bright, 1 Oct 2026): replaces the Head of Sales
// "Initiatives" page and the single weekly script.
//
//   Head of Sales writes -> submits -> Manager / Admin / Owner approves,
//   returns (comment required) or rejects -> approved version goes live ->
//   reps read it on the order / Call Rep Console and record using it ->
//   accepted / delivered / extra revenue per script, rep and pairing.
//
// Editing a live script makes a new draft version; reps keep the live one
// until the new one is approved. Rules live in lib/sales-scripting.ts.
const router = Router();
router.use(requireAuth);

const APPROVERS = ["Owner", "Admin", "Manager"];
const CATEGORIES = ["closing", "upsell", "cross_sell", "objection"] as const;
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
const httpError = (status: number, message: string) => Object.assign(new Error(message), { status });
const fail = (res: any, error: any, fallback: string) => res.status(error?.status ?? 500).json({ error: error?.message ?? fallback });
const branchOf = (req: Request) => {
  const branchId = req.user!.branchId;
  if (!branchId) throw httpError(400, "Open a branch first.");
  return branchId;
};
const isApprover = (req: Request) => APPROVERS.includes(req.user!.role);

async function isHeadOfSales(req: Request) {
  if (req.user!.role !== "Sales Rep") return false;
  const head = await activeHead(req.user!.orgId);
  return head?.id === req.user!.id;
}

async function audit(req: Request, branchId: string, scriptId: string | null, versionId: string | null, action: string, detail: Record<string, unknown> = {}) {
  await supabase.from("sales_script_audit").insert({
    org_id: req.user!.orgId, branch_id: branchId, script_id: scriptId, version_id: versionId, action,
    actor_id: req.user!.id, actor_name: req.user!.name ?? null, actor_role: req.user!.role, detail
  });
}

// ------------------------------------------------------------------ loading

async function loadSettings(orgId: string, branchId: string): Promise<ScriptSettings> {
  const { data, error } = await supabase.from("sales_script_settings").select("settings").eq("org_id", orgId).eq("branch_id", branchId).maybeSingle();
  if (error) throw error;
  return mergeSettings(data?.settings);
}

const SYMBOL: Record<string, string> = { NGN: "₦", GHS: "GH₵", KES: "KSh", USD: "$", GBP: "£" };
const money = (value: number, currency = "NGN") => `${SYMBOL[currency] ?? ""}${Math.round(value).toLocaleString("en-NG")}`;

type ProductFacts = {
  id: string; name: string; imageUrl: string | null; currency: string;
  crossSellIds: string[]; freeGiftIds: string[]; crossSellOverrides: Record<string, number>;
  /** Active package price per quantity (cheapest when several). */
  priceByQty: Map<number, number>;
  allPrices: number[];
  packages: Array<{ quantity: number; price: number; name: string }>;
};

async function loadProducts(orgId: string, branchId: string): Promise<Map<string, ProductFacts>> {
  const { data: products, error } = await supabase.from("products")
    .select("id, name, image_url, active, cross_sell_product_ids, free_gift_product_ids, cross_sell_price_overrides")
    .eq("org_id", orgId).eq("branch_id", branchId);
  if (error) throw error;
  const ids = (products ?? []).map((row) => row.id);
  const [packagesRes, pricingsRes] = ids.length ? await Promise.all([
    supabase.from("product_packages").select("product_id, name, quantity, price, currency, active, display_order, image_url").in("product_id", ids),
    supabase.from("product_pricings").select("product_id, selling_price, currency, is_primary").in("product_id", ids)
  ]) : [{ data: [], error: null }, { data: [], error: null }] as any;
  if (packagesRes.error) throw packagesRes.error;
  if (pricingsRes.error) throw pricingsRes.error;
  const facts = new Map<string, ProductFacts>();
  for (const product of products ?? []) {
    if (product.active === false) continue;
    const packages = (packagesRes.data ?? []).filter((row: any) => row.product_id === product.id && row.active !== false)
      .sort((a: any, b: any) => (a.display_order ?? 0) - (b.display_order ?? 0));
    const pricing = (pricingsRes.data ?? []).filter((row: any) => row.product_id === product.id).sort((a: any, b: any) => Number(b.is_primary) - Number(a.is_primary))[0];
    const priceByQty = new Map<number, number>();
    for (const pack of packages) {
      const qty = Number(pack.quantity) || 1;
      const price = Number(pack.price) || 0;
      if (price > 0 && (!priceByQty.has(qty) || price < priceByQty.get(qty)!)) priceByQty.set(qty, price);
    }
    if (!priceByQty.has(1) && pricing?.selling_price) priceByQty.set(1, Number(pricing.selling_price));
    const overrides = (product.cross_sell_price_overrides && typeof product.cross_sell_price_overrides === "object") ? product.cross_sell_price_overrides as Record<string, number> : {};
    facts.set(product.id, {
      id: product.id,
      name: product.name,
      imageUrl: product.image_url ?? packages.find((row: any) => row.image_url)?.image_url ?? null,
      currency: packages[0]?.currency ?? pricing?.currency ?? "NGN",
      crossSellIds: Array.isArray(product.cross_sell_product_ids) ? product.cross_sell_product_ids.map(String) : [],
      freeGiftIds: Array.isArray(product.free_gift_product_ids) ? product.free_gift_product_ids.map(String) : [],
      crossSellOverrides: Object.fromEntries(Object.entries(overrides).map(([key, value]) => [key, Number(value)]).filter(([, value]) => Number.isFinite(value as number))),
      priceByQty,
      allPrices: Array.from(priceByQty.values()),
      packages: packages.map((row: any) => ({ quantity: Number(row.quantity) || 1, price: Number(row.price) || 0, name: row.name ?? "" }))
    });
  }
  return facts;
}

const lowestQtyPrice = (product: ProductFacts) => {
  const qtys = Array.from(product.priceByQty.keys()).sort((a, b) => a - b);
  return qtys.length ? product.priceByQty.get(qtys[0])! : 0;
};

type VersionRow = Record<string, any>;

function scriptVars(product: ProductFacts | undefined, version: VersionRow, products: Map<string, ProductFacts>, settings: ScriptSettings): Record<string, string> {
  if (!product) return {};
  const cur = product.currency;
  const fromQty = Number(version.upsell_from_qty) || 0;
  const toQty = Number(version.upsell_to_qty) || 0;
  const fromPrice = fromQty ? product.priceByQty.get(fromQty) : undefined;
  const toPrice = toQty ? product.priceByQty.get(toQty) : undefined;
  const cross = version.cross_sell_product_id ? products.get(version.cross_sell_product_id) : undefined;
  const crossPrice = cross ? (product.crossSellOverrides[cross.id] ?? lowestQtyPrice(cross)) : 0;
  const gifts = product.freeGiftIds.map((id) => products.get(id)?.name).filter(Boolean) as string[];
  return {
    product_name: product.name,
    current_price: fromPrice ? money(fromPrice, cur) : lowestQtyPrice(product) ? money(lowestQtyPrice(product), cur) : "",
    upgrade_price: toPrice ? money(toPrice, cur) : "",
    extra_amount: fromPrice && toPrice && toPrice > fromPrice ? money(toPrice - fromPrice, cur) : "",
    from_qty: fromQty ? String(fromQty) : "",
    to_qty: toQty ? String(toQty) : "",
    cross_sell_product: cross?.name ?? "",
    cross_sell_price: crossPrice ? money(crossPrice, cur) : "",
    delivery_offer: (settings.productDeliveryOffers[product.id] ?? "").trim() || settings.deliveryOffer.trim(),
    free_gifts: gifts.join(", ")
  };
}

function validPricesFor(product: ProductFacts | undefined, products: Map<string, ProductFacts>) {
  if (!product) return [];
  const prices = [...product.allPrices];
  for (const id of product.crossSellIds) {
    const cross = products.get(id);
    if (cross) prices.push(...cross.allPrices);
  }
  prices.push(...Object.values(product.crossSellOverrides));
  // Differences between packages (the "extra" for an upgrade) are real prices too.
  for (const a of product.allPrices) for (const b of product.allPrices) if (b > a) prices.push(b - a);
  return prices;
}

const allText = (version: VersionRow) => [version.what_to_say, ...(version.key_points ?? []), ...(version.must_say ?? [])].join("\n");

function versionDto(row: VersionRow | null | undefined) {
  if (!row) return null;
  return {
    id: row.id, versionNo: row.version_no, status: row.status,
    title: row.title, scenario: row.scenario ?? "", objective: row.objective ?? "", whenToUse: row.when_to_use ?? "",
    trigger: row.customer_trigger ?? "", whatToSay: row.what_to_say ?? "",
    keyPoints: (row.key_points ?? []) as string[], mustSay: (row.must_say ?? []) as string[], neverSay: (row.never_say ?? []) as string[],
    desiredAction: row.desired_action ?? "", priority: row.priority, impact: row.impact,
    closingStyle: row.closing_style ?? null, objection: row.objection ?? null,
    upsellFromQty: row.upsell_from_qty ?? null, upsellToQty: row.upsell_to_qty ?? null, crossSellProductId: row.cross_sell_product_id ?? null,
    createdByName: row.created_by_name ?? null, createdAt: row.created_at, submittedAt: row.submitted_at,
    decidedByName: row.decided_by_name ?? null, decidedAt: row.decided_at, decisionNote: row.decision_note ?? null,
    approvedAt: row.approved_at, archivedAt: row.archived_at, replacedByVersionId: row.replaced_by_version_id ?? null
  };
}

function displayStatus(item: any, latest: VersionRow | undefined) {
  if (item.archived_at) return "archived";
  if (item.deactivated_at) return "deactivated";
  if (latest?.status === "submitted") return "pending";
  if (latest?.status === "returned") return "returned";
  if (item.live_version_id) return "approved";
  if (latest?.status === "rejected") return "rejected";
  return "draft";
}

async function loadLibrary(orgId: string, branchId: string) {
  const { data: items, error } = await supabase.from("sales_script_items").select("*").eq("org_id", orgId).eq("branch_id", branchId).order("created_at");
  if (error) throw error;
  const ids = (items ?? []).map((row) => row.id);
  const versions: VersionRow[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error: versionError } = await supabase.from("sales_script_versions").select("*").in("script_id", ids.slice(i, i + 200));
    if (versionError) throw versionError;
    versions.push(...(data ?? []));
  }
  const byScript = new Map<string, VersionRow[]>();
  for (const version of versions) {
    const list = byScript.get(version.script_id) ?? [];
    list.push(version);
    byScript.set(version.script_id, list);
  }
  for (const list of byScript.values()) list.sort((a, b) => a.version_no - b.version_no);
  return { items: items ?? [], byScript };
}

function summarize(item: any, versions: VersionRow[], products: Map<string, ProductFacts>) {
  const latest = versions[versions.length - 1];
  const live = versions.find((version) => version.id === item.live_version_id);
  const product = products.get(item.product_id);
  const valid = validPricesFor(product, products);
  const current = live ?? latest;
  const outdated = current ? outdatedPrices(allText(current), valid) : [];
  return {
    id: item.id, productId: item.product_id, category: item.category as ScriptCategory,
    status: displayStatus(item, latest),
    live: versionDto(live), latest: versionDto(latest),
    hasPendingChange: Boolean(live && latest && latest.id !== live.id && ["draft", "submitted", "returned"].includes(latest.status)),
    versionsCount: versions.length,
    createdByName: item.created_by_name, createdAt: item.created_at,
    deactivatedAt: item.deactivated_at, deactivatedByName: item.deactivated_by_name, deactivationNote: item.deactivation_note,
    archivedAt: item.archived_at,
    outdatedPrices: outdated
  };
}

// ------------------------------------------------------------- the library

router.get("/library", async (req, res) => {
  try {
    const orgId = req.user!.orgId;
    const branchId = branchOf(req);
    const canAuthor = await isHeadOfSales(req);
    if (!canAuthor && !isApprover(req)) throw httpError(403, "Only the Head of Sales Rep and leadership manage scripts.");
    const [settings, products, library] = await Promise.all([loadSettings(orgId, branchId), loadProducts(orgId, branchId), loadLibrary(orgId, branchId)]);
    const scripts = library.items.map((item) => summarize(item, library.byScript.get(item.id) ?? [], products));
    const current = scripts.filter((script) => !script.archivedAt);
    const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const approvedLast7 = Array.from(library.byScript.values()).flat().filter((version) => version.approved_at && version.approved_at >= weekAgo).length;
    const productRows = Array.from(products.values()).map((product) => {
      const mine = current.filter((script) => script.productId === product.id);
      const liveCounts: Partial<Record<ScriptCategory, number>> = {};
      for (const script of mine) if (script.live && !script.deactivatedAt) liveCounts[script.category] = (liveCounts[script.category] ?? 0) + 1;
      const readiness = playbookReadiness(liveCounts, settings.minPerCategory);
      return {
        id: product.id, name: product.name, imageUrl: product.imageUrl, currency: product.currency,
        scriptCount: mine.filter((script) => !script.deactivatedAt).length,
        readiness,
        packages: product.packages,
        crossSellProducts: product.crossSellIds.map((id) => products.get(id)).filter(Boolean).map((cross) => ({ id: cross!.id, name: cross!.name })),
        deliveryOffer: settings.productDeliveryOffers[product.id] ?? ""
      };
    }).sort((a, b) => b.scriptCount - a.scriptCount || a.name.localeCompare(b.name));
    res.json({
      canAuthor,
      canApprove: isApprover(req),
      settings,
      products: productRows,
      allProducts: Array.from(products.values()).map((product) => ({ id: product.id, name: product.name })).sort((a, b) => a.name.localeCompare(b.name)),
      scripts: current,
      archivedCount: scripts.length - current.length,
      kpis: {
        total: current.length,
        approved: current.filter((script) => script.live && !script.deactivatedAt).length,
        approvedLast7,
        pending: current.filter((script) => script.status === "pending" || (script.latest?.status === "submitted")).length,
        drafts: current.filter((script) => script.latest && ["draft", "returned"].includes(script.latest.status)).length
      }
    });
  } catch (error: any) {
    fail(res, error, "Could not load the script library.");
  }
});

router.get("/archived", async (req, res) => {
  try {
    const orgId = req.user!.orgId;
    const branchId = branchOf(req);
    if (!(await isHeadOfSales(req)) && !isApprover(req)) throw httpError(403, "Not allowed.");
    const [products, library] = await Promise.all([loadProducts(orgId, branchId), loadLibrary(orgId, branchId)]);
    res.json({ scripts: library.items.filter((item) => item.archived_at).map((item) => summarize(item, library.byScript.get(item.id) ?? [], products)) });
  } catch (error: any) {
    fail(res, error, "Could not load archived scripts.");
  }
});

router.get("/scripts/:id", async (req, res) => {
  try {
    const orgId = req.user!.orgId;
    const branchId = branchOf(req);
    if (!(await isHeadOfSales(req)) && !isApprover(req)) throw httpError(403, "Not allowed.");
    const { data: item, error } = await supabase.from("sales_script_items").select("*").eq("org_id", orgId).eq("branch_id", branchId).eq("id", String(req.params.id)).maybeSingle();
    if (error) throw error;
    if (!item) throw httpError(404, "Script not found.");
    const [products, versionsRes, auditRes, usesRes] = await Promise.all([
      loadProducts(orgId, branchId),
      supabase.from("sales_script_versions").select("*").eq("script_id", item.id).order("version_no"),
      supabase.from("sales_script_audit").select("action, actor_name, actor_role, detail, created_at, version_id").eq("script_id", item.id).order("created_at", { ascending: false }).limit(200),
      supabase.from("sales_script_uses").select("version_id, outcome").eq("script_id", item.id)
    ]);
    if (versionsRes.error) throw versionsRes.error;
    if (auditRes.error) throw auditRes.error;
    if (usesRes.error) throw usesRes.error;
    const versions = versionsRes.data ?? [];
    const usesByVersion = new Map<string, { used: number; accepted: number }>();
    for (const use of usesRes.data ?? []) {
      const entry = usesByVersion.get(use.version_id) ?? { used: 0, accepted: 0 };
      entry.used += 1;
      if (use.outcome === "accepted") entry.accepted += 1;
      usesByVersion.set(use.version_id, entry);
    }
    res.json({
      script: summarize(item, versions, products),
      versions: versions.map((version) => ({ ...versionDto(version)!, ...(usesByVersion.get(version.id) ?? { used: 0, accepted: 0 }) })).reverse(),
      audit: (auditRes.data ?? []).map((row) => ({ action: row.action, actorName: row.actor_name, actorRole: row.actor_role, detail: row.detail, at: row.created_at, versionId: row.version_id }))
    });
  } catch (error: any) {
    fail(res, error, "Could not load the script.");
  }
});

// -------------------------------------------------- write: Head of Sales only

const list = z.array(z.string().trim().min(1).max(300)).max(20);
const FieldsSchema = z.object({
  title: z.string().trim().min(3).max(120),
  scenario: z.string().trim().max(120).default(""),
  objective: z.string().trim().max(500).default(""),
  whenToUse: z.string().trim().max(1000).default(""),
  trigger: z.string().trim().max(1000).default(""),
  whatToSay: z.string().trim().min(10).max(4000),
  keyPoints: list.default([]),
  mustSay: list.default([]),
  neverSay: list.default([]),
  desiredAction: z.string().trim().max(500).default(""),
  priority: z.enum(["primary", "alternative", "experimental"]).default("primary"),
  impact: z.enum(["high", "medium", "low"]).default("medium"),
  closingStyle: z.enum(["direct", "choice", "delivery", "urgency", "confirmation"]).nullable().optional(),
  objection: z.string().trim().max(300).nullable().optional(),
  upsellFromQty: z.number().int().min(1).max(1000).nullable().optional(),
  upsellToQty: z.number().int().min(1).max(1000).nullable().optional(),
  crossSellProductId: z.string().uuid().nullable().optional()
});
type Fields = z.infer<typeof FieldsSchema>;

function checkCategoryFields(category: ScriptCategory, fields: Fields) {
  if (category === "upsell") {
    if (!fields.upsellFromQty || !fields.upsellToQty) throw httpError(400, "Choose the upgrade path: from how many pieces to how many.");
    if (fields.upsellToQty <= fields.upsellFromQty) throw httpError(400, "The upgrade must go to more pieces than it starts from.");
  }
  if (category === "cross_sell" && !fields.crossSellProductId) throw httpError(400, "Choose the product this script cross-sells.");
  if (category === "closing" && !fields.closingStyle) throw httpError(400, "Choose the closing style.");
  if (category === "objection" && !fields.objection?.trim()) throw httpError(400, "Write the customer's objection this script answers.");
}

const versionColumns = (category: ScriptCategory, fields: Fields) => ({
  title: fields.title, scenario: fields.scenario, objective: fields.objective, when_to_use: fields.whenToUse,
  customer_trigger: fields.trigger, what_to_say: fields.whatToSay,
  key_points: fields.keyPoints, must_say: fields.mustSay, never_say: fields.neverSay,
  desired_action: fields.desiredAction, priority: fields.priority, impact: fields.impact,
  closing_style: category === "closing" ? fields.closingStyle ?? null : null,
  objection: category === "objection" ? fields.objection ?? null : null,
  upsell_from_qty: category === "upsell" ? fields.upsellFromQty ?? null : null,
  upsell_to_qty: category === "upsell" ? fields.upsellToQty ?? null : null,
  cross_sell_product_id: category === "cross_sell" ? fields.crossSellProductId ?? null : null
});

async function warningsFor(orgId: string, branchId: string, scriptId: string | null, productId: string, category: ScriptCategory, fields: Fields, settings?: ScriptSettings) {
  const [products, library, loadedSettings] = await Promise.all([loadProducts(orgId, branchId), loadLibrary(orgId, branchId), settings ? Promise.resolve(settings) : loadSettings(orgId, branchId)]);
  const product = products.get(productId);
  const fake: VersionRow = { ...versionColumns(category, fields) };
  const others = library.items
    .filter((item) => item.product_id === productId && item.category === category && item.id !== scriptId && !item.archived_at)
    .map((item) => {
      const versions = library.byScript.get(item.id) ?? [];
      const current = versions.find((version) => version.id === item.live_version_id) ?? versions[versions.length - 1];
      return { id: item.id, title: current?.title ?? "", scenario: current?.scenario ?? "", whatToSay: current?.what_to_say ?? "" };
    });
  const vars = scriptVars(product, fake, products, loadedSettings);
  const filled = fillScriptText(fields.whatToSay, vars);
  return {
    preview: {
      whatToSay: filled.text,
      keyPoints: fields.keyPoints.map((point) => fillScriptText(point, vars).text),
      mustSay: fields.mustSay.map((point) => fillScriptText(point, vars).text)
    },
    missingPlaceholders: filled.missing,
    outdatedPrices: outdatedPrices(allText(fake), validPricesFor(product, products)),
    duplicates: nearDuplicates({ id: scriptId ?? undefined, scenario: fields.scenario, whatToSay: fields.whatToSay }, others)
  };
}

router.post("/preview", async (req, res) => {
  // The preview runs while the form is still being filled in, so nothing here
  // is required - half-written fields are previewed as they are.
  const parsed = z.object({ scriptId: z.string().uuid().nullable().optional(), productId: z.string().uuid(), category: z.enum(CATEGORIES), fields: z.record(z.any()) }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Nothing to preview." }); return; }
  try {
    if (!(await isHeadOfSales(req)) && !isApprover(req)) throw httpError(403, "Not allowed.");
    const raw = parsed.data.fields;
    const text = (value: unknown) => (typeof value === "string" ? value : "");
    const strings = (value: unknown) => (Array.isArray(value) ? value.map(String) : []);
    const qty = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);
    const fields = {
      title: text(raw.title), scenario: text(raw.scenario), objective: text(raw.objective), whenToUse: text(raw.whenToUse), trigger: text(raw.trigger),
      whatToSay: text(raw.whatToSay), keyPoints: strings(raw.keyPoints), mustSay: strings(raw.mustSay), neverSay: strings(raw.neverSay),
      desiredAction: text(raw.desiredAction), priority: "primary", impact: "medium",
      closingStyle: null, objection: text(raw.objection) || null,
      upsellFromQty: qty(raw.upsellFromQty), upsellToQty: qty(raw.upsellToQty),
      crossSellProductId: typeof raw.crossSellProductId === "string" ? raw.crossSellProductId : null
    } as Fields;
    res.json(await warningsFor(req.user!.orgId, branchOf(req), parsed.data.scriptId ?? null, parsed.data.productId, parsed.data.category, fields));
  } catch (error: any) {
    fail(res, error, "Could not preview the script.");
  }
});

async function requireHead(req: Request) {
  if (!(await isHeadOfSales(req))) throw httpError(403, "Only the Head of Sales Rep writes scripts. Managers approve them.");
}

async function submitVersion(req: Request, branchId: string, item: any, versionId: string) {
  const now = new Date().toISOString();
  const { error } = await supabase.from("sales_script_versions").update({ status: "submitted", submitted_at: now, updated_at: now }).eq("id", versionId);
  if (error) throw error;
  await audit(req, branchId, item.id, versionId, "submitted");
  const { data: version } = await supabase.from("sales_script_versions").select("title, version_no").eq("id", versionId).maybeSingle();
  const { data: product } = await supabase.from("products").select("name").eq("id", item.product_id).maybeSingle();
  void notifySalesScript(req.user!.orgId, branchId, {
    kind: "submitted", headName: req.user!.name ?? "Head of Sales", productName: product?.name ?? "", category: CATEGORY_LABEL[item.category as ScriptCategory],
    title: version?.title ?? "", versionNo: version?.version_no ?? 1
  });
}

router.post("/scripts", async (req, res) => {
  const parsed = z.object({ productId: z.string().uuid(), category: z.enum(CATEGORIES), fields: FieldsSchema, submit: z.boolean().optional() }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ? `Check the form: ${parsed.error.issues[0].path.join(".")} ${parsed.error.issues[0].message}` : "Check the form." }); return; }
  try {
    await requireHead(req);
    const orgId = req.user!.orgId;
    const branchId = branchOf(req);
    const { productId, category, fields } = parsed.data;
    checkCategoryFields(category, fields);
    const products = await loadProducts(orgId, branchId);
    if (!products.has(productId)) throw httpError(400, "That product is not in this branch.");
    const { data: item, error } = await supabase.from("sales_script_items").insert({
      org_id: orgId, branch_id: branchId, product_id: productId, category,
      created_by: req.user!.id, created_by_name: req.user!.name ?? null
    }).select("*").single();
    if (error) throw error;
    const { data: version, error: versionError } = await supabase.from("sales_script_versions").insert({
      org_id: orgId, branch_id: branchId, script_id: item.id, version_no: 1, status: "draft",
      ...versionColumns(category, fields), created_by: req.user!.id, created_by_name: req.user!.name ?? null
    }).select("id").single();
    if (versionError) {
      await supabase.from("sales_script_items").delete().eq("id", item.id);
      throw versionError;
    }
    await audit(req, branchId, item.id, version.id, "created", { title: fields.title, category });
    if (parsed.data.submit) await submitVersion(req, branchId, item, version.id);
    res.status(201).json({ id: item.id, warnings: await warningsFor(orgId, branchId, item.id, productId, category, fields) });
  } catch (error: any) {
    fail(res, error, "Could not save the script.");
  }
});

async function loadItem(req: Request, branchId: string) {
  const { data: item, error } = await supabase.from("sales_script_items").select("*").eq("org_id", req.user!.orgId).eq("branch_id", branchId).eq("id", String(req.params.id)).maybeSingle();
  if (error) throw error;
  if (!item) throw httpError(404, "Script not found.");
  const { data: versions, error: versionError } = await supabase.from("sales_script_versions").select("*").eq("script_id", item.id).order("version_no");
  if (versionError) throw versionError;
  return { item, versions: versions ?? [], latest: (versions ?? [])[(versions ?? []).length - 1] as VersionRow | undefined };
}

router.put("/scripts/:id", async (req, res) => {
  const parsed = z.object({ fields: FieldsSchema, submit: z.boolean().optional() }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Check the form." }); return; }
  try {
    await requireHead(req);
    const orgId = req.user!.orgId;
    const branchId = branchOf(req);
    const { item, latest } = await loadItem(req, branchId);
    if (item.archived_at) throw httpError(409, "This script is archived.");
    const category = item.category as ScriptCategory;
    checkCategoryFields(category, parsed.data.fields);
    if (latest?.status === "submitted") throw httpError(409, "This version is waiting for approval. Ask the approver to return it before changing it.");
    let versionId: string;
    const now = new Date().toISOString();
    if (latest && ["draft", "returned"].includes(latest.status)) {
      const { error } = await supabase.from("sales_script_versions").update({ ...versionColumns(category, parsed.data.fields), status: "draft", updated_at: now }).eq("id", latest.id);
      if (error) throw error;
      versionId = latest.id;
      await audit(req, branchId, item.id, versionId, "edited", { versionNo: latest.version_no });
    } else {
      // Live, rejected or archived: a new version. Reps keep the live one until it is approved.
      const versionNo = (latest?.version_no ?? 0) + 1;
      const { data, error } = await supabase.from("sales_script_versions").insert({
        org_id: orgId, branch_id: branchId, script_id: item.id, version_no: versionNo, status: "draft",
        ...versionColumns(category, parsed.data.fields), created_by: req.user!.id, created_by_name: req.user!.name ?? null
      }).select("id").single();
      if (error) throw error;
      versionId = data.id;
      await audit(req, branchId, item.id, versionId, "new_version", { versionNo });
    }
    await supabase.from("sales_script_items").update({ updated_at: now }).eq("id", item.id);
    if (parsed.data.submit) await submitVersion(req, branchId, item, versionId);
    res.json({ id: item.id, warnings: await warningsFor(orgId, branchId, item.id, item.product_id, category, parsed.data.fields) });
  } catch (error: any) {
    fail(res, error, "Could not save the script.");
  }
});

router.post("/scripts/:id/submit", async (req, res) => {
  try {
    await requireHead(req);
    const branchId = branchOf(req);
    const { item, latest } = await loadItem(req, branchId);
    if (!latest || !["draft", "returned"].includes(latest.status)) throw httpError(409, "There is no draft to submit.");
    await submitVersion(req, branchId, item, latest.id);
    res.json({ ok: true });
  } catch (error: any) {
    fail(res, error, "Could not submit the script.");
  }
});

router.delete("/scripts/:id", async (req, res) => {
  try {
    await requireHead(req);
    const branchId = branchOf(req);
    const { item, versions } = await loadItem(req, branchId);
    if (versions.length !== 1 || versions[0].status !== "draft" || versions[0].submitted_at) {
      throw httpError(409, "Only a draft that was never submitted can be deleted. Ask the manager to archive it instead.");
    }
    const { error } = await supabase.from("sales_script_items").delete().eq("id", item.id);
    if (error) throw error;
    await audit(req, branchId, null, null, "draft_deleted", { title: versions[0].title });
    res.json({ ok: true });
  } catch (error: any) {
    fail(res, error, "Could not delete the draft.");
  }
});

// ------------------------------------------- approve / return / reject / retire

router.post("/scripts/:id/decide", requireRole(...(APPROVERS as any)), async (req, res) => {
  const parsed = z.object({ action: z.enum(["approve", "return", "reject"]), note: z.string().trim().max(2000).optional() }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Choose approve, return or reject." }); return; }
  try {
    const branchId = branchOf(req);
    const { item, latest } = await loadItem(req, branchId);
    if (!latest || latest.status !== "submitted") throw httpError(409, "Nothing is waiting for approval on this script.");
    const note = parsed.data.note?.trim() || null;
    if (parsed.data.action !== "approve" && (!note || note.length < 5)) throw httpError(400, "Write what needs to change.");
    const now = new Date().toISOString();
    const decided = { decided_by: req.user!.id, decided_by_name: req.user!.name ?? null, decided_at: now, decision_note: note, updated_at: now };
    if (parsed.data.action === "approve") {
      const { error } = await supabase.from("sales_script_versions").update({ ...decided, status: "approved", approved_at: now }).eq("id", latest.id);
      if (error) throw error;
      if (item.live_version_id && item.live_version_id !== latest.id) {
        const { error: archiveError } = await supabase.from("sales_script_versions")
          .update({ status: "archived", archived_at: now, replaced_by_version_id: latest.id, updated_at: now }).eq("id", item.live_version_id);
        if (archiveError) throw archiveError;
      }
      const { error: itemError } = await supabase.from("sales_script_items")
        .update({ live_version_id: latest.id, deactivated_at: null, deactivated_by: null, deactivated_by_name: null, deactivation_note: null, updated_at: now }).eq("id", item.id);
      if (itemError) throw itemError;
    } else {
      const { error } = await supabase.from("sales_script_versions").update({ ...decided, status: parsed.data.action === "return" ? "returned" : "rejected" }).eq("id", latest.id);
      if (error) throw error;
    }
    const action = parsed.data.action === "approve" ? (item.live_version_id ? "approved_replaced" : "approved_published") : parsed.data.action === "return" ? "returned" : "rejected";
    await audit(req, branchId, item.id, latest.id, action, { note, versionNo: latest.version_no, replacedVersionId: parsed.data.action === "approve" ? item.live_version_id : null });
    const { data: product } = await supabase.from("products").select("name").eq("id", item.product_id).maybeSingle();
    void notifySalesScript(req.user!.orgId, branchId, {
      kind: parsed.data.action === "approve" ? "approved" : parsed.data.action === "return" ? "returned" : "rejected",
      headId: item.created_by, deciderName: req.user!.name ?? "Manager", productName: product?.name ?? "", category: CATEGORY_LABEL[item.category as ScriptCategory],
      title: latest.title, versionNo: latest.version_no, note
    });
    res.json({ ok: true });
  } catch (error: any) {
    fail(res, error, "Could not save the decision.");
  }
});

router.post("/scripts/:id/retire", requireRole(...(APPROVERS as any)), async (req, res) => {
  const parsed = z.object({ action: z.enum(["deactivate", "reactivate", "archive"]), note: z.string().trim().max(1000).optional() }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Choose deactivate, reactivate or archive." }); return; }
  try {
    const branchId = branchOf(req);
    const { item } = await loadItem(req, branchId);
    const now = new Date().toISOString();
    const note = parsed.data.note?.trim() || null;
    if (parsed.data.action === "reactivate") {
      if (!item.live_version_id) throw httpError(409, "This script has no approved version to bring back.");
      if (item.archived_at) throw httpError(409, "Archived scripts stay archived. Write a new one instead.");
      await supabase.from("sales_script_items").update({ deactivated_at: null, deactivated_by: null, deactivated_by_name: null, deactivation_note: null, updated_at: now }).eq("id", item.id);
    } else {
      if (!note || note.length < 3) throw httpError(400, "Say why.");
      const patch: Record<string, unknown> = { deactivated_at: item.deactivated_at ?? now, deactivated_by: req.user!.id, deactivated_by_name: req.user!.name ?? null, deactivation_note: note, updated_at: now };
      if (parsed.data.action === "archive") {
        patch.archived_at = now;
        if (item.live_version_id) await supabase.from("sales_script_versions").update({ status: "archived", archived_at: now, updated_at: now }).eq("id", item.live_version_id);
      }
      await supabase.from("sales_script_items").update(patch).eq("id", item.id);
    }
    await audit(req, branchId, item.id, item.live_version_id, parsed.data.action === "archive" ? "archived" : parsed.data.action === "deactivate" ? "deactivated" : "reactivated", { note });
    res.json({ ok: true });
  } catch (error: any) {
    fail(res, error, "Could not change the script.");
  }
});

// ---------------------------------------------------- the rep's view on an order

async function loadOrder(orgId: string, orderId: string) {
  const { data, error } = await supabase.from("orders")
    .select("id, assigned_rep_id, product_id, product_name, quantity, status, created_at, cross_sell_lines")
    .eq("org_id", orgId).eq("id", orderId).maybeSingle();
  if (error) throw error;
  if (!data) throw httpError(404, "Order not found.");
  return data;
}

const PRIORITY_RANK: Record<string, number> = { primary: 0, alternative: 1, experimental: 2 };

router.get("/for-order/:orderId", async (req, res) => {
  try {
    const orgId = req.user!.orgId;
    const branchId = branchOf(req);
    const order = await loadOrder(orgId, String(req.params.orderId));
    const [settings, products, library, usesRes] = await Promise.all([
      loadSettings(orgId, branchId), loadProducts(orgId, branchId), loadLibrary(orgId, branchId),
      supabase.from("sales_script_uses").select("script_id, outcome, used_at").eq("org_id", orgId).eq("order_id", order.id)
    ]);
    if (usesRes.error) throw usesRes.error;
    const product = order.product_id ? products.get(order.product_id) : undefined;
    const qty = Number(order.quantity) || 1;
    const onOrder = new Set((Array.isArray(order.cross_sell_lines) ? order.cross_sell_lines : []).map((line: any) => String(line?.productId ?? "")));
    const sections: Record<ScriptCategory, any[]> = { closing: [], upsell: [], cross_sell: [], objection: [] };
    for (const item of library.items) {
      if (item.product_id !== order.product_id || item.deactivated_at || item.archived_at || !item.live_version_id) continue;
      const live = (library.byScript.get(item.id) ?? []).find((version) => version.id === item.live_version_id);
      if (!live) continue;
      const vars = scriptVars(product, live, products, settings);
      const fill = (text: string) => fillScriptText(text, vars).text;
      const category = item.category as ScriptCategory;
      const suggested = category === "upsell" ? Number(live.upsell_from_qty) === qty
        : category === "cross_sell" ? !onOrder.has(String(live.cross_sell_product_id ?? ""))
        : true;
      sections[category].push({
        id: item.id, versionId: live.id, versionNo: live.version_no, category,
        title: live.title, scenario: live.scenario, priority: live.priority, impact: live.impact,
        whenToUse: fill(live.when_to_use ?? ""), trigger: fill(live.customer_trigger ?? ""),
        objection: live.objection, closingStyle: live.closing_style,
        whatToSay: fill(live.what_to_say ?? ""), keyPoints: (live.key_points ?? []).map(fill),
        mustSay: (live.must_say ?? []).map(fill), neverSay: live.never_say ?? [], desiredAction: fill(live.desired_action ?? ""),
        upsellFromQty: live.upsell_from_qty, upsellToQty: live.upsell_to_qty,
        crossSellProductName: live.cross_sell_product_id ? products.get(live.cross_sell_product_id)?.name ?? null : null,
        extraAmount: vars.extra_amount || null,
        suggested
      });
    }
    for (const key of Object.keys(sections) as ScriptCategory[]) {
      sections[key].sort((a, b) => Number(b.suggested) - Number(a.suggested) || (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9) || a.title.localeCompare(b.title));
    }
    res.json({
      orderId: order.id,
      product: product ? { id: product.id, name: product.name } : order.product_name ? { id: order.product_id, name: order.product_name } : null,
      quantity: qty,
      sections,
      uses: Object.fromEntries((usesRes.data ?? []).map((use) => [use.script_id, { outcome: use.outcome, usedAt: use.used_at }])),
      canRecord: req.user!.role === "Sales Rep" && order.assigned_rep_id === req.user!.id
    });
  } catch (error: any) {
    fail(res, error, "Could not load scripts for this order.");
  }
});

router.post("/for-order/:orderId/shown", async (req, res) => {
  const parsed = z.object({ scriptId: z.string().uuid() }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Which script?" }); return; }
  try {
    if (req.user!.role !== "Sales Rep") { res.json({ ok: true }); return; }
    const orgId = req.user!.orgId;
    const branchId = branchOf(req);
    const { data: item } = await supabase.from("sales_script_items").select("id, live_version_id").eq("org_id", orgId).eq("branch_id", branchId).eq("id", parsed.data.scriptId).maybeSingle();
    if (!item?.live_version_id) { res.json({ ok: true }); return; }
    await supabase.from("sales_script_views").upsert({
      org_id: orgId, branch_id: branchId, rep_id: req.user!.id, script_id: item.id, version_id: item.live_version_id,
      order_id: String(req.params.orderId), view_date: lagosDateKey()
    }, { onConflict: "org_id,rep_id,script_id,order_id,view_date", ignoreDuplicates: true });
    res.json({ ok: true });
  } catch (error: any) {
    fail(res, error, "Could not record that.");
  }
});

router.post("/for-order/:orderId/use", requireRole("Sales Rep"), async (req, res) => {
  const parsed = z.object({ scriptId: z.string().uuid(), outcome: z.enum(["accepted", "declined"]).nullable() }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Say whether the customer said yes or no." }); return; }
  try {
    const orgId = req.user!.orgId;
    const branchId = branchOf(req);
    const order = await loadOrder(orgId, String(req.params.orderId));
    if (order.assigned_rep_id !== req.user!.id) throw httpError(403, "Only the rep on this order can record it.");
    const weekStart = sundayWeekStartForDateKey(order.created_at ? lagosDateKey(order.created_at) : lagosDateKey());
    const head = await activeHead(orgId);
    if (head && await releaseFor(orgId, head.id, weekStart)) throw httpError(409, "This week's Head of Sales bonus is already decided, so script records for it are closed.");
    if (parsed.data.outcome === null) {
      const { error } = await supabase.from("sales_script_uses").delete().eq("org_id", orgId).eq("order_id", order.id).eq("script_id", parsed.data.scriptId);
      if (error) throw error;
      res.json({ ok: true });
      return;
    }
    const { data: item } = await supabase.from("sales_script_items").select("id, product_id, category, live_version_id, deactivated_at, archived_at")
      .eq("org_id", orgId).eq("branch_id", branchId).eq("id", parsed.data.scriptId).maybeSingle();
    if (!item || !item.live_version_id || item.deactivated_at || item.archived_at) throw httpError(400, "That script is not live.");
    if (item.product_id !== order.product_id) throw httpError(400, "That script is for a different product.");
    // One script per type on an order (Bright, 1 Oct 2026): the rep says WHICH
    // closing / upsell / cross-sell script they used, so each sale is credited
    // to one script and the report can show which one converts. Objection
    // answers can stack - a customer can raise several.
    if (item.category !== "objection") {
      const { error: clearError } = await supabase.from("sales_script_uses").delete()
        .eq("org_id", orgId).eq("order_id", order.id).eq("category", item.category).neq("script_id", item.id);
      if (clearError) throw clearError;
    }
    const { error } = await supabase.from("sales_script_uses").upsert({
      org_id: orgId, branch_id: branchId, order_id: order.id, rep_id: req.user!.id, script_id: item.id, version_id: item.live_version_id,
      product_id: item.product_id, category: item.category, outcome: parsed.data.outcome, week_start: weekStart, used_at: new Date().toISOString()
    }, { onConflict: "org_id,order_id,script_id" });
    if (error) throw error;
    res.json({ ok: true });
  } catch (error: any) {
    fail(res, error, "Could not record the script.");
  }
});

// -------------------------------------------------------------- usage report

const lagosStartIso = (dateKey: string) => new Date(`${dateKey}T00:00:00+01:00`).toISOString();
const lagosEndIso = (dateKey: string) => new Date(`${dateKey}T23:59:59.999+01:00`).toISOString();
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;

async function usesBetween(orgId: string, branchId: string, from: string, to: string) {
  const rows: any[] = [];
  for (let page = 0; page < 50; page += 1) {
    const { data, error } = await supabase.from("sales_script_uses").select("order_id, rep_id, script_id, version_id, product_id, category, outcome, used_at")
      .eq("org_id", orgId).eq("branch_id", branchId).gte("used_at", lagosStartIso(from)).lte("used_at", lagosEndIso(to))
      .order("id").range(page * 1000, page * 1000 + 999);
    if (error) throw error;
    rows.push(...(data ?? []));
    if ((data ?? []).length < 1000) break;
  }
  return rows;
}

async function ordersByIds(orgId: string, ids: string[]) {
  const map = new Map<string, any>();
  const unique = Array.from(new Set(ids));
  for (let i = 0; i < unique.length; i += 200) {
    const { data, error } = await supabase.from("orders")
      .select("id, status, amount, upsell_from_qty, upsell_to_qty, original_amount, original_quantity, cross_sell_lines")
      .eq("org_id", orgId).in("id", unique.slice(i, i + 200));
    if (error) throw error;
    for (const row of data ?? []) map.set(String(row.id), row);
  }
  return map;
}

function useFacts(uses: any[], orders: Map<string, any>, versionById: Map<string, VersionRow>): Array<UseFact & { scriptId: string; versionId: string; productId: string; category: string; pairId: string | null; orderId: string }> {
  return uses.map((use) => {
    const order = orders.get(String(use.order_id));
    const delivered = order?.status === "Delivered";
    const version = versionById.get(use.version_id);
    let incremental = 0;
    if (order && use.outcome === "accepted") {
      if (use.category === "upsell") incremental = incrementalRevenueForOrder(order).upsell;
      if (use.category === "cross_sell") {
        const lines = Array.isArray(order.cross_sell_lines) ? order.cross_sell_lines : [];
        const pair = version?.cross_sell_product_id;
        incremental = lines.filter((line: any) => !pair || String(line?.productId) === String(pair))
          .filter((line: any) => line?.selectionSource !== "public_form" && line?.selectionSource !== "public_upsell")
          .reduce((sum: number, line: any) => sum + (Number(line?.amount) || 0), 0);
      }
    }
    return {
      repId: use.rep_id, outcome: use.outcome, delivered, incrementalRevenue: incremental,
      scriptId: use.script_id, versionId: use.version_id, productId: use.product_id, category: use.category,
      pairId: version?.cross_sell_product_id ?? null, orderId: String(use.order_id)
    };
  });
}

function periodOf(query: any) {
  const today = lagosDateKey();
  const to = typeof query.to === "string" && DATE_KEY.test(query.to) ? query.to : today;
  const from = typeof query.from === "string" && DATE_KEY.test(query.from) ? query.from : addDaysToDateKey(to, -27);
  if (from > to) throw httpError(400, "The start date is after the end date.");
  const length = daysBetween(from, to);
  return { from, to, previousFrom: addDaysToDateKey(from, -length), previousTo: addDaysToDateKey(from, -1) };
}

router.get("/usage", async (req, res) => {
  try {
    const orgId = req.user!.orgId;
    const branchId = branchOf(req);
    if (!(await isHeadOfSales(req)) && !isApprover(req)) throw httpError(403, "Not allowed.");
    const period = periodOf(req.query);
    const [settings, products, library, current, previous, viewsRes] = await Promise.all([
      loadSettings(orgId, branchId), loadProducts(orgId, branchId), loadLibrary(orgId, branchId),
      usesBetween(orgId, branchId, period.from, period.to), usesBetween(orgId, branchId, period.previousFrom, period.previousTo),
      supabase.from("sales_script_views").select("script_id").eq("org_id", orgId).eq("branch_id", branchId).gte("view_date", period.from).lte("view_date", period.to).limit(20000)
    ]);
    if (viewsRes.error) throw viewsRes.error;
    const versionById = new Map<string, VersionRow>(Array.from(library.byScript.values()).flat().map((version) => [version.id, version]));
    const orders = await ordersByIds(orgId, [...current, ...previous].map((use) => String(use.order_id)));
    const now = useFacts(current, orders, versionById);
    const before = useFacts(previous, orders, versionById);
    const views = new Map<string, number>();
    for (const row of viewsRes.data ?? []) views.set(row.script_id, (views.get(row.script_id) ?? 0) + 1);

    // Average delivered conversion of each product + category, the yardstick for health.
    const groupAverage = new Map<string, number>();
    const groups = new Map<string, typeof now>();
    for (const fact of now) {
      const key = `${fact.productId}|${fact.category}`;
      groups.set(key, [...(groups.get(key) ?? []), fact]);
    }
    for (const [key, facts] of groups) groupAverage.set(key, funnelOf(facts).deliveredConversion);

    const scripts = library.items.filter((item) => item.live_version_id || now.some((fact) => fact.scriptId === item.id)).map((item) => {
      const versions = library.byScript.get(item.id) ?? [];
      const live = versions.find((version) => version.id === item.live_version_id) ?? versions[versions.length - 1];
      const product = products.get(item.product_id);
      const mine = now.filter((fact) => fact.scriptId === item.id);
      const prev = before.filter((fact) => fact.scriptId === item.id);
      const funnel = funnelOf(mine, views.get(item.id) ?? 0);
      const previousFunnel = funnelOf(prev);
      const outdated = live ? outdatedPrices(allText(live), validPricesFor(product, products)) : [];
      const average = groupAverage.get(`${item.product_id}|${item.category}`) ?? 0;
      const health = scriptHealth({
        uses: funnel.used, deliveredConversion: funnel.deliveredConversion,
        previousUses: previousFunnel.used, previousDeliveredConversion: previousFunnel.deliveredConversion,
        categoryAverage: average, outdatedPrice: outdated.length > 0
      }, settings);
      return {
        scriptId: item.id, productId: item.product_id, productName: product?.name ?? "Product", category: item.category,
        categoryLabel: CATEGORY_LABEL[item.category as ScriptCategory],
        title: live?.title ?? "", versionNo: live?.version_no ?? 1,
        live: Boolean(item.live_version_id) && !item.deactivated_at && !item.archived_at,
        pairName: live?.cross_sell_product_id ? products.get(live.cross_sell_product_id)?.name ?? null : null,
        upgradePath: live?.upsell_from_qty && live?.upsell_to_qty ? `${live.upsell_from_qty} → ${live.upsell_to_qty}` : null,
        funnel, previousFunnel, categoryAverage: average,
        health: health.health, healthLabel: HEALTH_LABEL[health.health], healthReason: health.reason,
        outdatedPrices: outdated
      };
    }).sort((a, b) => b.funnel.used - a.funnel.used || a.title.localeCompare(b.title));

    // Which script converts best among the others for the same product and
    // type (Bright, 1 Oct 2026). Ranked by delivered conversion; a leader with
    // fewer uses than the health minimum is marked early so nobody over-reads it.
    const leaderGroups = new Map<string, typeof scripts>();
    for (const script of scripts.filter((row) => row.funnel.used > 0)) {
      const key = `${script.productId}|${script.category}`;
      leaderGroups.set(key, [...(leaderGroups.get(key) ?? []), script]);
    }
    const leaders = Array.from(leaderGroups.values()).map((group) => {
      const ranked = [...group].sort((a, b) => b.funnel.deliveredConversion - a.funnel.deliveredConversion || b.funnel.acceptanceRate - a.funnel.acceptanceRate || b.funnel.used - a.funnel.used);
      const best = ranked[0];
      return {
        productName: best.productName, category: best.category, categoryLabel: best.categoryLabel,
        best: { scriptId: best.scriptId, title: best.title, used: best.funnel.used, acceptanceRate: best.funnel.acceptanceRate, deliveredConversion: best.funnel.deliveredConversion },
        early: best.funnel.used < settings.minUses,
        others: ranked.slice(1).map((row) => ({ scriptId: row.scriptId, title: row.title, used: row.funnel.used, acceptanceRate: row.funnel.acceptanceRate, deliveredConversion: row.funnel.deliveredConversion }))
      };
    }).sort((a, b) => a.productName.localeCompare(b.productName) || a.category.localeCompare(b.category));

    const pairs = new Map<string, typeof now>();
    for (const fact of now.filter((item) => item.category === "cross_sell" && item.pairId)) {
      const key = `${fact.productId}|${fact.pairId}`;
      pairs.set(key, [...(pairs.get(key) ?? []), fact]);
    }
    const byCategory = (category: string) => funnelOf(now.filter((fact) => fact.category === category));
    const assistedOrders = new Set(now.filter((fact) => fact.outcome === "accepted" && fact.delivered).map((fact) => fact.orderId));
    res.json({
      period,
      settings,
      kpis: {
        activeApproved: library.items.filter((item) => item.live_version_id && !item.deactivated_at && !item.archived_at).length,
        pending: library.items.filter((item) => (library.byScript.get(item.id) ?? []).slice(-1)[0]?.status === "submitted").length,
        needsReview: scripts.filter((script) => script.live && (script.health === "needs_review" || script.health === "underperforming")).length,
        used: now.length,
        scriptAssistedSales: assistedOrders.size,
        upsellConversion: byCategory("upsell").acceptanceRate,
        crossSellConversion: byCategory("cross_sell").acceptanceRate,
        incrementalRevenue: funnelOf(now).incrementalRevenue
      },
      scripts,
      leaders,
      pairs: Array.from(pairs.entries()).map(([key, facts]) => {
        const [productId, pairId] = key.split("|");
        return { productName: products.get(productId)?.name ?? "Product", pairName: products.get(pairId)?.name ?? "Product", ...funnelOf(facts) };
      }).sort((a, b) => b.acceptanceRate - a.acceptanceRate)
    });
  } catch (error: any) {
    fail(res, error, "Could not load the script usage report.");
  }
});

router.get("/usage/:scriptId/reps", async (req, res) => {
  try {
    const orgId = req.user!.orgId;
    const branchId = branchOf(req);
    if (!(await isHeadOfSales(req)) && !isApprover(req)) throw httpError(403, "Not allowed.");
    const period = periodOf(req.query);
    const library = await loadLibrary(orgId, branchId);
    const item = library.items.find((row) => row.id === String(req.params.scriptId));
    if (!item) throw httpError(404, "Script not found.");
    const versionById = new Map<string, VersionRow>(Array.from(library.byScript.values()).flat().map((version) => [version.id, version]));
    const uses = await usesBetween(orgId, branchId, period.from, period.to);
    const orders = await ordersByIds(orgId, uses.map((use) => String(use.order_id)));
    const facts = useFacts(uses, orders, versionById);
    const mine = facts.filter((fact) => fact.scriptId === item.id);
    const group = facts.filter((fact) => fact.productId === item.product_id && fact.category === item.category);
    const repIds = Array.from(new Set(mine.map((fact) => fact.repId)));
    const { data: users } = repIds.length ? await supabase.from("users").select("id, name").in("id", repIds) : { data: [] as any[] };
    const nameOf = new Map((users ?? []).map((user: any) => [user.id, user.name as string]));
    const rows = repIds.map((repId) => ({ repId, repName: nameOf.get(repId) ?? "Former staff", ...funnelOf(mine.filter((fact) => fact.repId === repId)) }))
      .sort((a, b) => b.deliveredConversion - a.deliveredConversion || b.used - a.used);
    const categoryAverage = funnelOf(group).deliveredConversion;
    const versions = (library.byScript.get(item.id) ?? []).map((version) => ({
      versionNo: version.version_no, status: version.status, ...funnelOf(mine.filter((fact) => fact.versionId === version.id))
    }));
    res.json({ period, rows, categoryAverage, diagnosis: repDiagnosis(rows, categoryAverage), versions });
  } catch (error: any) {
    fail(res, error, "Could not load the rep breakdown.");
  }
});

// ---------------------------------------------------------------- settings

router.put("/settings", requireRole(...(APPROVERS as any)), async (req, res) => {
  try {
    const orgId = req.user!.orgId;
    const branchId = branchOf(req);
    const current = await loadSettings(orgId, branchId);
    const next = mergeSettings({ ...current, ...(req.body ?? {}) });
    const { error } = await supabase.from("sales_script_settings").upsert({
      org_id: orgId, branch_id: branchId, settings: next, updated_by: req.user!.id, updated_at: new Date().toISOString()
    }, { onConflict: "org_id,branch_id" });
    if (error) throw error;
    await audit(req, branchId, null, null, "settings_changed", { settings: next });
    res.json({ settings: next });
  } catch (error: any) {
    fail(res, error, "Could not save the settings.");
  }
});

export default router;
