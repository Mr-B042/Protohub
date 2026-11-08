import { Router, type Request, type Response } from "express";
import crypto from "node:crypto";
import { z } from "zod";
import { supabase } from "../lib/supabase.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { logger } from "../lib/logger.js";
import { marketingSender } from "../lib/mailer.js";
import {
  AUTOMATION_PRESETS, JOURNEY_STAGES, QUICK_SEGMENTS,
  CAMPAIGN_LIST_COLUMNS, EmailMarketingError, addContacts, audienceFor, audienceLabel, campaignDto, contactsFor, createField, createTag, deleteContact,
  deleteField, deleteTag, forgetWorld, importsFor, loadWorld, membersNow, overviewFor, planningFor, previewAudience, productsForDesigner, reviewsForDesigner, saveSettings,
  segmentPreviewFull, sendTest, setContactStatus, settingsFor, statsFor, syncContacts, tagContacts, updateContact, updateField, updateTag, uploadPicture
} from "../lib/email-marketing.js";
import { CONDITION_FIELDS, cleanConditions, cleanEmail, resolveAudience, slugFor, type AudienceChoice, type Delivery } from "../lib/email-marketing-rules.js";
import { collectLinks, normalizeDesign, safeUrl } from "../lib/email-render.js";
import { cleanList, cleaningPlan, enableBounceReports, healthFor } from "../lib/email-health.js";
import {
  automationReport, automationsPage, deleteAutomation, duplicateAutomation, getAutomation, saveAutomation, setAutomationStatus, testAutomationEmails, type AutomationInput
} from "../lib/email-automations.js";
import { AUTOMATION_GOALS } from "../lib/email-automation-rules.js";

/**
 * Email Marketing (Bright, 8 Nov 2026), part 1: Overview, Campaigns, the
 * 5-step Create Campaign window and Audience & Segments. Owner and Admin.
 * The email list holds customers' emails, so it stays with leadership.
 */
const router = Router();
router.use(requireAuth);
router.use(requireRole("Owner", "Admin"));

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const orgOf = (req: Request) => req.user!.orgId;
const branchOf = (req: Request) => {
  const id = req.user!.branchId;
  if (!id) throw new EmailMarketingError(403, "No branch is open. Pick a branch first.");
  return id;
};
function sendError(res: Response, error: any, fallback: string) {
  if (error instanceof EmailMarketingError) { res.status(error.status).json({ error: error.message }); return; }
  const status = Number(error?.status) || 500;
  if (status >= 500) logger.warn("email marketing route failed", { error: error?.message ?? String(error) });
  res.status(status).json({ error: status >= 500 ? fallback : String(error?.message ?? fallback) });
}

export const GOALS = ["retention", "upsell", "promotion", "launch", "cart", "winback", "appreciation", "announcement"] as const;
const OFFER_TYPES = ["product", "discount", "bundle", "loyalty", "custom"] as const;
const EDITABLE = ["draft", "scheduled", "paused", "active"];

// ── Cleaning what the browser sends ──────────────────────────────────

function cleanAudience(raw: any): AudienceChoice {
  const source = ["all", "segment", "custom", "journey", "list"].includes(raw?.source) ? raw.source : "all";
  const out: AudienceChoice = { source };
  if (source === "segment" && UUID.test(String(raw?.segmentId ?? ""))) out.segmentId = raw.segmentId;
  if (source === "list" && UUID.test(String(raw?.listId ?? ""))) out.listId = raw.listId;
  if (source === "journey" && JOURNEY_STAGES[String(raw?.journeyStage ?? "")]) out.journeyStage = raw.journeyStage;
  if (source === "custom") out.custom = { name: String(raw?.custom?.name ?? "").trim().slice(0, 120), match: raw?.custom?.match === "any" ? "any" : "all", conditions: cleanConditions(raw?.custom?.conditions) };
  if (raw?.exclude?.on) {
    out.exclude = {
      on: true,
      ...(UUID.test(String(raw.exclude.segmentId ?? "")) ? { segmentId: raw.exclude.segmentId } : {}),
      ...(Number(raw.exclude.boughtWithinDays) > 0 ? { boughtWithinDays: Math.min(365, Math.round(Number(raw.exclude.boughtWithinDays))) } : {}),
      ...(Number(raw.exclude.emailedWithinDays) > 0 ? { emailedWithinDays: Math.min(90, Math.round(Number(raw.exclude.emailedWithinDays))) } : {})
    };
  }
  return out;
}

function cleanDelivery(raw: any): Delivery {
  const type = ["one_time", "recurring", "automation"].includes(raw?.type) ? raw.type : "one_time";
  const sendAt = raw?.sendAt && Number.isFinite(Date.parse(raw.sendAt)) ? new Date(raw.sendAt).toISOString() : null;
  if (type === "automation") {
    const preset = AUTOMATION_PRESETS[String(raw?.automation?.preset ?? "")] ? raw.automation.preset : null;
    const trigger = ["delivered", "ordered", "cart", "inactive"].includes(raw?.automation?.trigger) ? raw.automation.trigger : "delivered";
    return {
      type, sendAt: null,
      automation: {
        preset, trigger,
        delayHours: Math.min(24 * 60, Math.max(0, Math.round(Number(raw?.automation?.delayHours ?? 48)))),
        inactiveDays: Math.min(365, Math.max(7, Math.round(Number(raw?.automation?.inactiveDays ?? 60)))),
        exit: raw?.automation?.exit === "none" ? "none" : "purchased"
      }
    };
  }
  if (type === "recurring") {
    const every = ["day", "week", "month"].includes(raw?.repeat?.every) ? raw.repeat.every : "week";
    const until = raw?.repeat?.until && Number.isFinite(Date.parse(raw.repeat.until)) ? new Date(raw.repeat.until).toISOString() : null;
    return { type, sendAt, repeat: { every, until } };
  }
  return { type, sendAt };
}

function cleanOptions(raw: any) {
  return {
    abTest: !!raw?.abTest,
    plainText: !!raw?.plainText,
    utm: raw?.utm !== false,
    resendNonOpeners: !!raw?.resendNonOpeners,
    resendHours: [24, 48, 72, 96].includes(Number(raw?.resendHours)) ? Number(raw.resendHours) : 48
  };
}

const campaignBody = z.object({
  name: z.string().trim().min(1, "Give the campaign a name.").max(160),
  goal: z.enum(GOALS).default("retention"),
  subject: z.string().max(200).default(""),
  subjectB: z.string().max(200).default(""),
  preheader: z.string().max(100).default(""),
  offerType: z.enum(OFFER_TYPES).default("product"),
  productId: z.string().regex(UUID).nullable().optional(),
  offer: z.object({ on: z.boolean().optional(), title: z.string().max(80).optional(), benefit: z.string().max(80).optional() }).default({}),
  audience: z.any().optional(),
  design: z.any().optional(),
  delivery: z.any().optional(),
  options: z.any().optional(),
  thumbnailUrl: z.string().max(2000).nullable().optional()
});

function campaignColumns(body: z.infer<typeof campaignBody>) {
  const design = body.design === undefined ? undefined : normalizeDesign(body.design);
  if (body.design !== undefined && design && JSON.stringify(design).length > 600_000) throw new EmailMarketingError(413, "The email is too big. Remove some HTML or pictures.");
  return {
    name: body.name, goal: body.goal, subject: body.subject.trim(), subject_b: body.subjectB.trim(), preheader: body.preheader.trim(),
    offer_type: body.offerType, product_id: body.productId ?? null,
    offer: { on: !!body.offer.on, title: (body.offer.title ?? "").trim(), benefit: (body.offer.benefit ?? "").trim() },
    ...(body.audience !== undefined ? { audience: cleanAudience(body.audience) } : {}),
    ...(design ? { design } : {}),
    ...(body.delivery !== undefined ? { delivery: cleanDelivery(body.delivery) } : {}),
    ...(body.options !== undefined ? { options: cleanOptions(body.options) } : {}),
    thumbnail_url: body.thumbnailUrl && /^https:\/\//i.test(body.thumbnailUrl) ? body.thumbnailUrl : null
  };
}

async function campaignFor(req: Request, id: string, columns = "*") {
  if (!UUID.test(id)) throw new EmailMarketingError(404, "Campaign not found.");
  const { data, error } = await supabase.from("email_campaigns").select(columns).eq("org_id", orgOf(req)).eq("branch_id", branchOf(req)).eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new EmailMarketingError(404, "Campaign not found.");
  return data as any;
}

// ── Pages ─────────────────────────────────────────────────────────────

router.get("/overview", async (req, res) => {
  try {
    // New order emails reach the list within minutes; opening the page does it now.
    await syncContacts(orgOf(req)).then((added) => { if (added) forgetWorld(branchOf(req)); }).catch(() => undefined);
    res.json(await overviewFor(orgOf(req), branchOf(req)));
  } catch (error) { sendError(res, error, "Could not load Email Marketing."); }
});

router.get("/audience", async (req, res) => {
  try { res.json(await audienceFor(orgOf(req), branchOf(req))); } catch (error) { sendError(res, error, "Could not load the audience."); }
});

router.get("/contacts", async (req, res) => {
  try { res.json({ contacts: await contactsFor(orgOf(req), branchOf(req)) }); } catch (error) { sendError(res, error, "Could not load the email list."); }
});

const consentRow = z.object({ email: z.string().max(254), name: z.string().max(120).optional(), phone: z.string().max(40).optional(), fields: z.record(z.string(), z.any()).optional() });

router.post("/contacts", async (req, res) => {
  try {
    const body = z.object({ email: z.string().max(254), name: z.string().max(120).optional(), phone: z.string().max(40).optional(), consent: z.literal(true, { errorMap: () => ({ message: "Tick that this person agreed to get emails from you." }) }) }).parse(req.body);
    if (!cleanEmail(body.email)) throw new EmailMarketingError(400, "That email does not look right. Check it and try again.");
    const result = await addContacts(orgOf(req), branchOf(req), req.user!.id, [body], "manual");
    if (!result.added) throw new EmailMarketingError(409, "That email is already on the list.");
    res.status(201).json(result);
  } catch (error: any) {
    if (error?.issues) { res.status(400).json({ error: error.issues[0]?.message ?? "Check the details." }); return; }
    sendError(res, error, "Could not add that person.");
  }
});

router.post("/contacts/import", async (req, res) => {
  try {
    const body = z.object({
      rows: z.array(consentRow).min(1, "The file has no rows.").max(20000, "Upload up to 20,000 people at a time."),
      consent: z.literal(true, { errorMap: () => ({ message: "Tick that everyone on this list agreed to get emails from you." }) }),
      listName: z.string().trim().max(120).optional(),
      source: z.enum(["csv", "paste", "device"]).default("csv"),
      details: z.string().max(200).optional()
    }).parse(req.body);
    const result = await addContacts(orgOf(req), branchOf(req), req.user!.id, body.rows, "import", { kind: body.source, details: body.details ?? "", userName: req.user!.name ?? "" });
    let listId: string | null = null;
    if (body.listName && result.contactIds.length) {
      const { data, error } = await supabase.from("email_segments").insert({
        org_id: orgOf(req), branch_id: branchOf(req), name: body.listName, description: `Uploaded list (${result.contactIds.length.toLocaleString("en-NG")} people)`,
        icon: "upload", kind: "fixed", contact_ids: result.contactIds, created_by: req.user!.id, created_by_name: req.user!.name ?? ""
      }).select("id").single();
      if (error) throw new Error(error.message);
      listId = data.id;
      if (result.importId) await supabase.from("email_imports").update({ list_id: listId }).eq("id", result.importId);
      forgetWorld(branchOf(req));
    }
    res.status(201).json({ ...result, contactIds: undefined, listId });
  } catch (error: any) {
    if (error?.issues) { res.status(400).json({ error: error.issues[0]?.message ?? "Check the file." }); return; }
    sendError(res, error, "Could not upload the list.");
  }
});

router.get("/imports", async (req, res) => {
  try { res.json(await importsFor(orgOf(req), branchOf(req))); } catch (error) { sendError(res, error, "Could not load the import history."); }
});

router.post("/contacts/:id/unsubscribe", async (req, res) => {
  try {
    if (!UUID.test(req.params.id)) throw new EmailMarketingError(404, "Not found.");
    await setContactStatus(orgOf(req), branchOf(req), req.params.id, "unsubscribed", `Unsubscribed by ${req.user!.name ?? "staff"}`);
    res.json({ ok: true });
  } catch (error) { sendError(res, error, "Could not unsubscribe that person."); }
});

router.patch("/contacts/:id", async (req, res) => {
  try {
    if (!UUID.test(req.params.id)) throw new EmailMarketingError(404, "Not found.");
    const body = z.object({ name: z.string().max(120).optional(), phone: z.string().max(40).optional(), fields: z.record(z.string(), z.any()).optional(), tags: z.array(z.string().regex(UUID)).max(100).optional() }).parse(req.body);
    await updateContact(orgOf(req), branchOf(req), req.params.id, body);
    res.json({ ok: true });
  } catch (error: any) {
    if (error?.issues) { res.status(400).json({ error: "Check the details." }); return; }
    sendError(res, error, "Could not save that person.");
  }
});

router.delete("/contacts/:id", async (req, res) => {
  try {
    if (!UUID.test(req.params.id)) throw new EmailMarketingError(404, "Not found.");
    await deleteContact(orgOf(req), branchOf(req), req.params.id);
    res.json({ ok: true });
  } catch (error) { sendError(res, error, "Could not remove that person."); }
});

// ── Segments ──────────────────────────────────────────────────────────

const segmentBody = z.object({
  name: z.string().trim().min(1, "Give the group a name.").max(120),
  description: z.string().max(240).optional(),
  icon: z.string().max(20).optional(),
  kind: z.enum(["auto", "fixed"]).default("auto"),
  match: z.enum(["all", "any"]).default("all"),
  conditions: z.array(z.any()).max(12),
  excludeOn: z.boolean().optional(),
  exclude: z.array(z.any()).max(12).optional()
});

router.post("/segments/preview", async (req, res) => {
  try {
    const body = z.object({ match: z.enum(["all", "any"]).default("all"), conditions: z.array(z.any()).max(12), excludeOn: z.boolean().optional(), exclude: z.array(z.any()).max(12).optional() }).parse(req.body);
    res.json(await segmentPreviewFull(orgOf(req), branchOf(req), { match: body.match, conditions: cleanConditions(body.conditions), exclude: body.excludeOn ? cleanConditions(body.exclude) : [] }));
  } catch (error) { sendError(res, error, "Could not count that group."); }
});

router.post("/segments", async (req, res) => {
  try {
    const body = segmentBody.parse(req.body);
    const conditions = cleanConditions(body.conditions);
    const exclude = cleanConditions(body.exclude);
    if (!conditions.length) throw new EmailMarketingError(400, "Add at least one condition.");
    // Static: the people who match today, kept as a list that won't change.
    const contactIds = body.kind === "fixed" ? await membersNow(orgOf(req), branchOf(req), { match: body.match, conditions, exclude: body.excludeOn ? exclude : [] }) : [];
    const { data, error } = await supabase.from("email_segments").insert({
      org_id: orgOf(req), branch_id: branchOf(req), name: body.name, description: (body.description ?? "").trim(), icon: body.icon ?? (body.kind === "fixed" ? "layers" : "users"),
      kind: body.kind, match: body.match, conditions, exclude_on: !!body.excludeOn, exclude_conditions: exclude, contact_ids: contactIds,
      created_by: req.user!.id, created_by_name: req.user!.name ?? ""
    }).select("id").single();
    if (error) throw new Error(error.message);
    forgetWorld(branchOf(req));
    res.status(201).json({ id: data.id });
  } catch (error: any) {
    if (error?.issues) { res.status(400).json({ error: error.issues[0]?.message ?? "Check the group." }); return; }
    sendError(res, error, "Could not save the group.");
  }
});

router.patch("/segments/:id", async (req, res) => {
  try {
    if (!UUID.test(req.params.id)) throw new EmailMarketingError(404, "Group not found.");
    const body = segmentBody.partial().extend({ status: z.enum(["active", "paused", "archived"]).optional() }).parse(req.body);
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (body.name !== undefined) patch.name = body.name;
    if (body.description !== undefined) patch.description = body.description.trim();
    if (body.icon !== undefined) patch.icon = body.icon;
    if (body.match !== undefined) patch.match = body.match;
    if (body.conditions !== undefined) {
      const conditions = cleanConditions(body.conditions);
      if (!conditions.length) throw new EmailMarketingError(400, "Add at least one condition.");
      patch.conditions = conditions;
    }
    if (body.excludeOn !== undefined) patch.exclude_on = body.excludeOn;
    if (body.exclude !== undefined) patch.exclude_conditions = cleanConditions(body.exclude);
    if (body.status !== undefined) patch.status = body.status;
    const { data, error } = await supabase.from("email_segments").update(patch).eq("org_id", orgOf(req)).eq("branch_id", branchOf(req)).eq("id", req.params.id).select("id").maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new EmailMarketingError(404, "Group not found.");
    forgetWorld(branchOf(req));
    res.json({ ok: true });
  } catch (error: any) {
    if (error?.issues) { res.status(400).json({ error: error.issues[0]?.message ?? "Check the group." }); return; }
    sendError(res, error, "Could not save the group.");
  }
});

router.delete("/segments/:id", async (req, res) => {
  try {
    if (!UUID.test(req.params.id)) throw new EmailMarketingError(404, "Group not found.");
    // A group a waiting or running campaign sends to cannot go.
    const { data: using } = await supabase.from("email_campaigns").select("name, audience, status").eq("org_id", orgOf(req)).eq("branch_id", branchOf(req)).in("status", ["scheduled", "sending", "active", "paused"]);
    const blocked = (using ?? []).find((row) => [row.audience?.segmentId, row.audience?.listId, row.audience?.exclude?.segmentId].includes(req.params.id));
    if (blocked) throw new EmailMarketingError(409, `"${blocked.name}" still sends to this group. Change or stop that campaign first.`);
    const { error } = await supabase.from("email_segments").delete().eq("org_id", orgOf(req)).eq("branch_id", branchOf(req)).eq("id", req.params.id);
    if (error) throw new Error(error.message);
    forgetWorld(branchOf(req));
    res.json({ ok: true });
  } catch (error) { sendError(res, error, "Could not delete the group."); }
});

// ── Tags ──────────────────────────────────────────────────────────────

const tagBody = z.object({ name: z.string().max(40).optional(), color: z.string().max(20).optional(), icon: z.string().max(20).optional(), description: z.string().max(200).optional(), status: z.enum(["active", "archived"]).optional() });

router.post("/tags", async (req, res) => {
  try {
    const body = tagBody.extend({ name: z.string().max(40) }).parse(req.body);
    res.status(201).json({ id: await createTag(orgOf(req), branchOf(req), { id: req.user!.id, name: req.user!.name }, body) });
  } catch (error) { sendError(res, error, "Could not create the tag."); }
});

router.patch("/tags/:id", async (req, res) => {
  try {
    if (!UUID.test(req.params.id)) throw new EmailMarketingError(404, "Tag not found.");
    await updateTag(orgOf(req), branchOf(req), req.params.id, tagBody.parse(req.body));
    res.json({ ok: true });
  } catch (error) { sendError(res, error, "Could not save the tag."); }
});

router.delete("/tags/:id", async (req, res) => {
  try {
    if (!UUID.test(req.params.id)) throw new EmailMarketingError(404, "Tag not found.");
    await deleteTag(orgOf(req), branchOf(req), req.params.id);
    res.json({ ok: true });
  } catch (error) { sendError(res, error, "Could not delete the tag."); }
});

router.post("/tags/:id/contacts", async (req, res) => {
  try {
    if (!UUID.test(req.params.id)) throw new EmailMarketingError(404, "Tag not found.");
    const body = z.object({ contactIds: z.array(z.string().regex(UUID)).min(1).max(20000), add: z.boolean() }).parse(req.body);
    await tagContacts(orgOf(req), branchOf(req), req.params.id, body.contactIds, body.add);
    res.json({ ok: true });
  } catch (error) { sendError(res, error, "Could not change the tag."); }
});

// ── Custom fields ─────────────────────────────────────────────────────

const fieldBody = z.object({
  name: z.string().max(60).optional(), type: z.string().max(20).optional(), options: z.array(z.string().max(60)).max(50).optional(),
  description: z.string().max(200).optional(), required: z.boolean().optional(), useInForms: z.boolean().optional(), status: z.enum(["active", "inactive"]).optional(), icon: z.string().max(20).optional()
});

router.post("/fields", async (req, res) => {
  try {
    const body = fieldBody.extend({ name: z.string().max(60), type: z.string().max(20) }).parse(req.body);
    res.status(201).json({ id: await createField(orgOf(req), branchOf(req), req.user!.id, body) });
  } catch (error) { sendError(res, error, "Could not create the field."); }
});

router.patch("/fields/:id", async (req, res) => {
  try {
    if (!UUID.test(req.params.id)) throw new EmailMarketingError(404, "Field not found.");
    await updateField(orgOf(req), branchOf(req), req.params.id, fieldBody.parse(req.body));
    res.json({ ok: true });
  } catch (error) { sendError(res, error, "Could not save the field."); }
});

router.delete("/fields/:id", async (req, res) => {
  try {
    if (!UUID.test(req.params.id)) throw new EmailMarketingError(404, "Field not found.");
    await deleteField(orgOf(req), branchOf(req), req.params.id);
    res.json({ ok: true });
  } catch (error) { sendError(res, error, "Could not delete the field."); }
});

// ── Campaign building ────────────────────────────────────────────────

router.get("/designer", async (req, res) => {
  try {
    const [products, reviews, saved, sender, settings, world] = await Promise.all([
      productsForDesigner(orgOf(req), branchOf(req)),
      reviewsForDesigner(orgOf(req), branchOf(req)),
      supabase.from("email_saved_blocks").select("id, kind, name, content, created_by_name, created_at").eq("org_id", orgOf(req)).eq("branch_id", branchOf(req)).order("created_at", { ascending: false }).limit(100),
      marketingSender(orgOf(req)),
      settingsFor(orgOf(req), branchOf(req)),
      loadWorld(orgOf(req), branchOf(req))
    ]);
    if (saved.error) throw new Error(saved.error.message);
    const states = [...new Set([...world.customers.values()].map((row) => row.state?.trim()).filter(Boolean) as string[])].sort();
    res.json({
      products, reviews, saved: saved.data ?? [], sender, settings: { dailyLimit: settings.dailyLimit, footerNote: settings.footerNote },
      segments: world.segmentRows.filter((row) => row.status !== "archived").map((row) => ({ id: row.id, name: row.name, kind: row.kind, status: row.status, icon: row.icon, list: row.kind === "fixed" || !!row.builtIn?.startsWith("list_") })),
      tags: world.tagRows.filter((row) => row.status === "active").map((row) => ({ id: row.id, name: row.name, kind: row.kind, color: row.color, icon: row.icon })),
      fields: world.fieldRows.filter((row) => row.status === "active").map((row) => ({ id: row.id, key: row.key, name: row.name, type: row.type, options: row.options, system: !!row.systemKey })),
      // ⚠️ Lists with a `key`, never objects keyed by "high_value" etc.: the
      // browser's request() camel-cases every response key (snakeToCamel).
      states, conditionFields: CONDITION_FIELDS,
      quickSegments: Object.entries(QUICK_SEGMENTS).map(([key, row]) => ({ key, ...row })),
      journeyStages: Object.entries(JOURNEY_STAGES).map(([key, row]) => ({ key, name: row.name, hint: row.hint })),
      presets: Object.entries(AUTOMATION_PRESETS).map(([key, row]) => ({ key, ...row })),
      userEmail: req.user!.email ?? ""
    });
  } catch (error) { sendError(res, error, "Could not load the campaign builder."); }
});

router.post("/audience-preview", async (req, res) => {
  try {
    const world = await loadWorld(orgOf(req), branchOf(req));
    res.json(previewAudience(world, cleanAudience(req.body?.audience)));
  } catch (error) { sendError(res, error, "Could not count the audience."); }
});

router.get("/planning", async (req, res) => {
  try { res.json(await planningFor(orgOf(req), branchOf(req), Math.max(0, Number(req.query.audience) || 0))); } catch (error) { sendError(res, error, "Could not load the estimates."); }
});

router.post("/pictures", async (req, res) => {
  try {
    const body = z.object({ dataUrl: z.string().max(8_000_000) }).parse(req.body);
    res.status(201).json({ url: await uploadPicture(orgOf(req), body.dataUrl) });
  } catch (error) { sendError(res, error, "Could not upload the picture."); }
});

router.post("/saved", async (req, res) => {
  try {
    const body = z.object({ kind: z.enum(["block", "template"]), name: z.string().trim().min(1, "Give it a name.").max(80), content: z.any() }).parse(req.body);
    const content = body.kind === "template" ? normalizeDesign(body.content) : body.content && typeof body.content === "object" && typeof body.content.type === "string" ? body.content : null;
    if (!content) throw new EmailMarketingError(400, "Nothing to save.");
    if (JSON.stringify(content).length > 600_000) throw new EmailMarketingError(413, "That is too big to save.");
    const { data, error } = await supabase.from("email_saved_blocks").insert({ org_id: orgOf(req), branch_id: branchOf(req), kind: body.kind, name: body.name, content, created_by: req.user!.id, created_by_name: req.user!.name ?? "" }).select("id").single();
    if (error) throw new Error(error.message);
    res.status(201).json({ id: data.id });
  } catch (error: any) {
    if (error?.issues) { res.status(400).json({ error: error.issues[0]?.message ?? "Check the name." }); return; }
    sendError(res, error, "Could not save it.");
  }
});

router.delete("/saved/:id", async (req, res) => {
  try {
    if (!UUID.test(req.params.id)) throw new EmailMarketingError(404, "Not found.");
    const { error } = await supabase.from("email_saved_blocks").delete().eq("org_id", orgOf(req)).eq("branch_id", branchOf(req)).eq("id", req.params.id);
    if (error) throw new Error(error.message);
    res.json({ ok: true });
  } catch (error) { sendError(res, error, "Could not delete it."); }
});

/** Pre-launch check: each link answers (5 seconds each). */
router.post("/check-links", async (req, res) => {
  try {
    const body = z.object({ urls: z.array(z.string().max(2000)).max(20) }).parse(req.body);
    const results = await Promise.all(body.urls.map(async (url) => {
      const safe = safeUrl(url);
      if (!/^https?:\/\//i.test(safe)) return { url, ok: false, status: null as number | null, reason: "Not a web link" };
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      try {
        const response = await fetch(safe, { method: "GET", redirect: "follow", signal: controller.signal, headers: { "User-Agent": "Protohub link check" } });
        return { url, ok: response.status < 400, status: response.status, reason: response.status < 400 ? "" : `The page answered ${response.status}` };
      } catch {
        return { url, ok: false, status: null, reason: "The page did not answer" };
      } finally {
        clearTimeout(timer);
      }
    }));
    res.json({ results });
  } catch (error) { sendError(res, error, "Could not check the links."); }
});

// ── Campaigns ─────────────────────────────────────────────────────────

router.get("/campaigns", async (req, res) => {
  try {
    // Automation emails live on the Automations page, not here.
    const { data, error } = await supabase.from("email_campaigns").select(CAMPAIGN_LIST_COLUMNS).eq("org_id", orgOf(req)).eq("branch_id", branchOf(req)).is("automation_id", null).order("created_at", { ascending: false }).limit(500);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    const [stats, world] = await Promise.all([statsFor(rows.map((row) => row.id)), loadWorld(orgOf(req), branchOf(req))]);
    res.json({ campaigns: rows.map((row) => ({ ...campaignDto(row, stats.get(row.id)), audienceLabel: audienceLabel(row.audience as AudienceChoice, world.segments) })) });
  } catch (error) { sendError(res, error, "Could not load the campaigns."); }
});

router.get("/campaigns/:id", async (req, res) => {
  try {
    const row = await campaignFor(req, req.params.id);
    const stats = await statsFor([row.id]);
    res.json({ campaign: campaignDto(row, stats.get(row.id)) });
  } catch (error) { sendError(res, error, "Could not load the campaign."); }
});

router.post("/campaigns", async (req, res) => {
  try {
    const body = campaignBody.parse(req.body);
    const { data, error } = await supabase.from("email_campaigns").insert({
      org_id: orgOf(req), branch_id: branchOf(req), ...campaignColumns(body), status: "draft",
      slug: slugFor(body.name, crypto.randomBytes(4).toString("hex")), created_by: req.user!.id, created_by_name: req.user!.name ?? ""
    }).select("id").single();
    if (error) throw new Error(error.message);
    res.status(201).json({ id: data.id });
  } catch (error: any) {
    if (error?.issues) { res.status(400).json({ error: error.issues[0]?.message ?? "Check the campaign." }); return; }
    sendError(res, error, "Could not save the campaign.");
  }
});

router.patch("/campaigns/:id", async (req, res) => {
  try {
    const current = await campaignFor(req, req.params.id, "id, status");
    if (!EDITABLE.includes(current.status)) throw new EmailMarketingError(409, "A campaign that is sending or finished cannot be changed. Duplicate it instead.");
    const body = campaignBody.parse(req.body);
    const { error } = await supabase.from("email_campaigns").update({ ...campaignColumns(body), updated_at: new Date().toISOString() }).eq("id", current.id).eq("org_id", orgOf(req)).eq("branch_id", branchOf(req));
    if (error) throw new Error(error.message);
    res.json({ ok: true });
  } catch (error: any) {
    if (error?.issues) { res.status(400).json({ error: error.issues[0]?.message ?? "Check the campaign." }); return; }
    sendError(res, error, "Could not save the campaign.");
  }
});

router.post("/campaigns/:id/duplicate", async (req, res) => {
  try {
    const row = await campaignFor(req, req.params.id);
    const name = `Copy of ${row.name}`.slice(0, 160);
    const { data, error } = await supabase.from("email_campaigns").insert({
      org_id: row.org_id, branch_id: row.branch_id, name, goal: row.goal, subject: row.subject, subject_b: row.subject_b, preheader: row.preheader,
      offer_type: row.offer_type, product_id: row.product_id, offer: row.offer, audience: row.audience, design: row.design,
      delivery: { ...(row.delivery ?? {}), sendAt: null }, options: row.options, thumbnail_url: row.thumbnail_url, status: "draft",
      slug: slugFor(name, crypto.randomBytes(4).toString("hex")), created_by: req.user!.id, created_by_name: req.user!.name ?? ""
    }).select("id").single();
    if (error) throw new Error(error.message);
    res.status(201).json({ id: data.id });
  } catch (error) { sendError(res, error, "Could not copy the campaign."); }
});

router.delete("/campaigns/:id", async (req, res) => {
  try {
    const row = await campaignFor(req, req.params.id, "id, status, run_count");
    if (row.status !== "draft" && !(row.status === "archived" && !row.run_count)) throw new EmailMarketingError(409, "Only a draft that never sent can be deleted. Archive this one instead.");
    const { error } = await supabase.from("email_campaigns").delete().eq("id", row.id).eq("org_id", orgOf(req)).eq("branch_id", branchOf(req));
    if (error) throw new Error(error.message);
    res.json({ ok: true });
  } catch (error) { sendError(res, error, "Could not delete the campaign."); }
});

/** The Review & Launch checks, done again on the server. */
async function launchProblems(req: Request, row: any, sendNow: boolean) {
  const problems: string[] = [];
  if (!String(row.name ?? "").trim()) problems.push("Give the campaign a name.");
  if (!String(row.subject ?? "").trim()) problems.push("Add an email subject.");
  if (row.options?.abTest && !String(row.subject_b ?? "").trim()) problems.push("A/B test is on: add the second subject line.");
  const design = normalizeDesign(row.design);
  if (!design || !design.blocks.length) problems.push("Design the email first.");
  else {
    const broken = design.blocks.filter((block) => (block.type === "button" && !safeUrl(block.link)) || (block.type === "hero" && block.buttonText.trim() && !safeUrl(block.buttonLink)));
    if (broken.length) problems.push("A button has no web link (it must start with https://).");
    if (!collectLinks(design).length) problems.push("Add at least one button or link so customers can order.");
  }
  const delivery = (row.delivery ?? {}) as Delivery;
  if (delivery.type !== "automation" && !sendNow) {
    const at = delivery.sendAt ? Date.parse(delivery.sendAt) : NaN;
    if (!Number.isFinite(at)) problems.push("Pick a send date and time.");
    else if (at < Date.now() - 5 * 60_000) problems.push("The send time has passed. Pick a new time or send now.");
  }
  const sender = await marketingSender(orgOf(req));
  if (!sender.ready) problems.push(sender.reason ?? "Email sending is not set up.");
  if (delivery.type !== "automation" && sendNow) {
    const world = await loadWorld(orgOf(req), branchOf(req), true);
    const { recipients } = resolveAudience(world.people, (row.audience ?? { source: "all" }) as AudienceChoice, world.segments, world.ctx);
    if (!recipients.length) problems.push("Nobody in this audience has an email yet, so there is no one to send to. Schedule it for later instead.");
  }
  return problems;
}

router.post("/campaigns/:id/launch", async (req, res) => {
  try {
    const body = z.object({ sendNow: z.boolean().default(false) }).parse(req.body ?? {});
    const row = await campaignFor(req, req.params.id);
    if (!["draft", "paused"].includes(row.status)) throw new EmailMarketingError(409, "This campaign is already launched.");
    const delivery = (row.delivery ?? {}) as Delivery;
    const sendNow = body.sendNow && delivery.type !== "automation";
    const problems = await launchProblems(req, row, sendNow);
    if (problems.length) throw new EmailMarketingError(400, problems.join(" "));
    const now = new Date().toISOString();
    const patch = delivery.type === "automation"
      ? { status: "active", launched_at: now, next_run_at: null, send_at: null }
      : { status: "scheduled", launched_at: now, send_at: sendNow ? now : delivery.sendAt, next_run_at: sendNow ? now : delivery.sendAt, ...(sendNow ? { delivery: { ...delivery, sendAt: now } } : {}) };
    const { error } = await supabase.from("email_campaigns").update({ ...patch, paused_from: null, updated_at: now }).eq("id", row.id).in("status", ["draft", "paused"]);
    if (error) throw new Error(error.message);
    res.json({ ok: true, status: patch.status });
  } catch (error) { sendError(res, error, "Could not launch the campaign."); }
});

router.post("/campaigns/:id/:action(pause|resume|cancel|archive|unarchive)", async (req, res) => {
  try {
    const row = await campaignFor(req, req.params.id, "id, status, paused_from, archived_from, run_count, next_run_at");
    const action = String((req.params as Record<string, string>).action);
    const now = new Date().toISOString();
    let patch: Record<string, unknown>;
    if (action === "pause") {
      if (!["scheduled", "sending", "active"].includes(row.status)) throw new EmailMarketingError(409, "Only a waiting, sending or running campaign can be paused.");
      patch = { status: "paused", paused_from: row.status };
    } else if (action === "resume") {
      if (row.status !== "paused") throw new EmailMarketingError(409, "This campaign is not paused.");
      patch = { status: row.paused_from && ["scheduled", "sending", "active"].includes(row.paused_from) ? row.paused_from : "scheduled", paused_from: null };
    } else if (action === "cancel") {
      if (!["scheduled", "paused"].includes(row.status) || row.run_count) throw new EmailMarketingError(409, "Only a campaign that has not sent yet can go back to draft.");
      patch = { status: "draft", next_run_at: null, send_at: null, launched_at: null, paused_from: null };
    } else if (action === "archive") {
      if (["sending", "active", "scheduled"].includes(row.status)) throw new EmailMarketingError(409, "Pause or finish the campaign before archiving it.");
      if (row.status === "archived") throw new EmailMarketingError(409, "Already archived.");
      patch = { status: "archived", archived_from: row.status };
    } else {
      if (row.status !== "archived") throw new EmailMarketingError(409, "This campaign is not archived.");
      patch = { status: row.archived_from && row.archived_from !== "archived" ? row.archived_from : "completed", archived_from: null };
    }
    const { error } = await supabase.from("email_campaigns").update({ ...patch, updated_at: now }).eq("id", row.id).eq("status", row.status);
    if (error) throw new Error(error.message);
    res.json({ ok: true, status: patch.status });
  } catch (error) { sendError(res, error, "Could not change the campaign."); }
});

router.post("/campaigns/:id/test", async (req, res) => {
  try {
    const body = z.object({ emails: z.array(z.string().max(254)).min(1, "Add an email address.").max(5, "Send to up to 5 addresses.") }).parse(req.body);
    const emails = body.emails.map((email) => cleanEmail(email));
    if (emails.some((email) => !email)) throw new EmailMarketingError(400, "One of the addresses does not look right.");
    const row = await campaignFor(req, req.params.id);
    const results = await sendTest(orgOf(req), branchOf(req), row, emails as string[], (req.user!.name ?? "").split(/\s+/)[0] || "there");
    res.json({ results });
  } catch (error: any) {
    if (error?.issues) { res.status(400).json({ error: error.issues[0]?.message ?? "Check the addresses." }); return; }
    sendError(res, error, "Could not send the test email.");
  }
});

router.get("/campaigns/:id/report", async (req, res) => {
  try {
    const row = await campaignFor(req, req.params.id, CAMPAIGN_LIST_COLUMNS + ", links");
    const [stats, sends, clicks] = await Promise.all([
      statsFor([row.id]),
      supabase.from("email_campaign_sends").select("email, name, kind, run_no, variant, status, error, sent_at, first_opened_at, first_clicked_at, open_count, click_count, order_id, unsubscribed_at")
        .eq("campaign_id", row.id).order("queued_at", { ascending: false }).limit(300),
      supabase.from("email_campaign_clicks").select("link_index").eq("campaign_id", row.id).limit(20000)
    ]);
    if (sends.error) throw new Error(sends.error.message);
    const orderIds = [...new Set((sends.data ?? []).map((send) => send.order_id).filter(Boolean))] as string[];
    const orders = orderIds.length ? await supabase.from("orders").select("id, customer, amount, status, created_at")
      // launch-safe: ids come from this campaign's own sends; Silent Test orders are still left out.
      .eq("org_id", orgOf(req)).neq("launch_stage", "silent").in("id", orderIds.slice(0, 200)) : { data: [] as any[] };
    const counts = new Map<number, number>();
    for (const click of clicks.data ?? []) counts.set(click.link_index, (counts.get(click.link_index) ?? 0) + 1);
    const links = Array.isArray(row.links) ? row.links : [];
    const world = await loadWorld(orgOf(req), branchOf(req));
    res.json({
      campaign: { ...campaignDto(row, stats.get(row.id)), audienceLabel: audienceLabel(row.audience as AudienceChoice, world.segments) },
      links: links.map((link: any, index: number) => ({ label: link.label, url: link.original ?? link.url, clicks: counts.get(index) ?? 0 })),
      // Camel-case here on purpose; see the designer note above.
      sends: (sends.data ?? []).map((send: any) => ({
        email: send.email, name: send.name, kind: send.kind, runNo: send.run_no, variant: send.variant, status: send.status, error: send.error,
        sentAt: send.sent_at, openedAt: send.first_opened_at, clickedAt: send.first_clicked_at, opens: send.open_count, clicks: send.click_count,
        orderId: send.order_id, unsubscribedAt: send.unsubscribed_at
      })),
      orders: (orders.data ?? []).map((order: any) => ({ id: order.id, customer: order.customer, amount: Number(order.amount) || 0, status: order.status, createdAt: order.created_at }))
    });
  } catch (error) { sendError(res, error, "Could not load the campaign report."); }
});

// ── Settings ──────────────────────────────────────────────────────────

router.get("/settings", async (req, res) => {
  try {
    const [settings, sender] = await Promise.all([settingsFor(orgOf(req), branchOf(req)), marketingSender(orgOf(req))]);
    res.json({ dailyLimit: settings.dailyLimit, footerNote: settings.footerNote, sender });
  } catch (error) { sendError(res, error, "Could not load the settings."); }
});

router.patch("/settings", async (req, res) => {
  try {
    const body = z.object({
      dailyLimit: z.number().int().min(1).max(100000).optional(), footerNote: z.string().max(300).optional(),
      autoSync: z.boolean().optional(), defaultListId: z.string().regex(UUID).nullable().optional(), updateExisting: z.boolean().optional()
    }).parse(req.body);
    await saveSettings(orgOf(req), branchOf(req), req.user!.id, body);
    res.json({ ok: true });
  } catch (error: any) {
    if (error?.issues) { res.status(400).json({ error: "The daily limit must be between 1 and 100,000." }); return; }
    sendError(res, error, "Could not save the settings.");
  }
});

// ── Audience Health (Bright's 7 designs, 8 Nov 2026) ─────────────────

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;
/** ?from=YYYY-MM-DD&to=YYYY-MM-DD (Lagos days, both included); default the last 30 days. */
function healthRange(req: Request) {
  const nowMs = Date.now();
  const from = String(req.query.from ?? ""), to = String(req.query.to ?? "");
  const toMs = DAY_KEY.test(to) ? Math.min(nowMs, Date.parse(`${to}T00:00:00+01:00`) + DAY_MS) : nowMs;
  const fromRaw = DAY_KEY.test(from) ? Date.parse(`${from}T00:00:00+01:00`) : toMs - 30 * DAY_MS;
  const fromMs = Number.isFinite(fromRaw) && fromRaw < toMs ? Math.max(fromRaw, toMs - 400 * DAY_MS) : toMs - 30 * DAY_MS;
  return { fromMs, toMs: Number.isFinite(toMs) ? toMs : nowMs };
}

router.get("/health", async (req, res) => {
  try { res.json(await healthFor(orgOf(req), branchOf(req), healthRange(req))); }
  catch (error) { sendError(res, error, "Could not load Audience Health."); }
});

router.get("/health/cleaning", async (req, res) => {
  try {
    const plan = await cleaningPlan(orgOf(req), branchOf(req));
    res.json({ neverOpened: plan.neverOpened.length, duplicates: plan.duplicates.length, bounced: plan.bounced.length });
  } catch (error) { sendError(res, error, "Could not check the list."); }
});

router.post("/health/clean", async (req, res) => {
  try {
    const body = z.object({ neverOpened: z.boolean().default(false), duplicates: z.boolean().default(false), bounced: z.boolean().default(false) }).parse(req.body ?? {});
    if (!body.neverOpened && !body.duplicates && !body.bounced) { res.status(400).json({ error: "Tick at least one group to clean." }); return; }
    res.json(await cleanList(orgOf(req), branchOf(req), req.user!.name ?? "staff", body));
  } catch (error) { sendError(res, error, "Could not clean the list."); }
});

router.post("/health/bounce-reports", async (req, res) => {
  try { res.json(await enableBounceReports(orgOf(req), branchOf(req))); }
  catch (error) { sendError(res, error, "Could not switch on bounce reports."); }
});

// ── Automations (Bright's designs 50, 51 and steps 2-4, 8 Nov 2026) ───

const AUTOMATION_TEMPLATES = ["post_purchase", "win_back", "cart_abandonment", "welcome", "review_feedback", "replenishment", "birthday", "vip_loyalty"] as const;
const automationBody = z.object({
  name: z.string().trim().min(1, "Give the automation a name.").max(160),
  description: z.string().max(200).default(""),
  template: z.enum(AUTOMATION_TEMPLATES).nullable().default(null),
  goal: z.enum(AUTOMATION_GOALS).default("repeat"),
  trigger: z.any().optional(),
  audience: z.any().optional(),
  enrollment: z.any().optional(),
  settings: z.any().optional(),
  workflow: z.any().optional(),
  launch: z.boolean().default(false)
});

function automationInput(body: z.infer<typeof automationBody>): AutomationInput {
  return {
    name: body.name, description: body.description.trim(), template: body.template, goal: body.goal, trigger: body.trigger,
    audience: cleanAudience(body.audience ?? { source: "all" }),
    enrollment: { on: !!body.enrollment?.on, match: body.enrollment?.match === "any" ? "any" : "all", conditions: cleanConditions(body.enrollment?.conditions) },
    settings: body.settings, workflow: body.workflow ?? { nodes: [] }
  };
}
const automationError = (res: Response, error: any, fallback: string) => {
  if (error?.issues) { res.status(400).json({ error: error.issues[0]?.message ?? "Check the automation's details." }); return; }
  sendError(res, error, fallback);
};
const automationId = (req: Request) => {
  const id = String(req.params.id ?? "");
  if (!UUID.test(id)) throw new EmailMarketingError(404, "Automation not found.");
  return id;
};

router.get("/automations", async (req, res) => {
  try { res.json(await automationsPage(orgOf(req), branchOf(req))); }
  catch (error) { sendError(res, error, "Could not load the automations."); }
});

router.post("/automations/test-emails", async (req, res) => {
  try {
    const body = z.object({ emails: z.array(z.string()).min(1).max(5), workflow: z.any() }).parse(req.body);
    const emails = body.emails.map((email) => cleanEmail(email)).filter((email): email is string => !!email);
    if (!emails.length) { res.status(400).json({ error: "Enter at least one valid email address." }); return; }
    res.json({ results: await testAutomationEmails(orgOf(req), branchOf(req), body.workflow, emails, req.user!.name ?? "there") });
  } catch (error) { automationError(res, error, "Could not send the test emails."); }
});

router.get("/automations/:id", async (req, res) => {
  try { res.json({ automation: await getAutomation(orgOf(req), branchOf(req), automationId(req)) }); }
  catch (error) { sendError(res, error, "Could not load the automation."); }
});

router.get("/automations/:id/report", async (req, res) => {
  try { res.json(await automationReport(orgOf(req), branchOf(req), automationId(req))); }
  catch (error) { sendError(res, error, "Could not load the results."); }
});

router.post("/automations", async (req, res) => {
  try {
    const body = automationBody.parse(req.body);
    const id = await saveAutomation(orgOf(req), branchOf(req), { id: req.user!.id, name: req.user!.name }, null, automationInput(body), body.launch);
    res.status(201).json({ id });
  } catch (error) { automationError(res, error, "Could not save the automation."); }
});

router.patch("/automations/:id", async (req, res) => {
  try {
    const body = automationBody.parse(req.body);
    const id = await saveAutomation(orgOf(req), branchOf(req), { id: req.user!.id, name: req.user!.name }, automationId(req), automationInput(body), body.launch);
    res.json({ id });
  } catch (error) { automationError(res, error, "Could not save the automation."); }
});

router.post("/automations/:id/duplicate", async (req, res) => {
  try { res.status(201).json({ id: await duplicateAutomation(orgOf(req), branchOf(req), { id: req.user!.id, name: req.user!.name }, automationId(req)) }); }
  catch (error) { sendError(res, error, "Could not copy the automation."); }
});

router.post("/automations/:id/:action(launch|pause|resume|archive|unarchive)", async (req, res) => {
  try {
    const action = String((req.params as Record<string, string>).action) as "launch" | "pause" | "resume" | "archive" | "unarchive";
    await setAutomationStatus(orgOf(req), branchOf(req), automationId(req), action);
    res.json({ ok: true });
  } catch (error) { sendError(res, error, "Could not change the automation."); }
});

router.delete("/automations/:id", async (req, res) => {
  try { await deleteAutomation(orgOf(req), branchOf(req), automationId(req)); res.json({ ok: true }); }
  catch (error) { sendError(res, error, "Could not delete the automation."); }
});

export default router;
