import crypto from "node:crypto";
import { supabase } from "./supabase.js";
import { logger } from "./logger.js";
import { fetchAllRowsOrThrow, selectByIdBatches } from "./query-limits.js";
import { marketingSender, sendMarketingEmail } from "./mailer.js";
import {
  AUTOMATION_PRESETS, BUILT_IN_FIELDS, BUILT_IN_LISTS, BUILT_IN_TAGS, DAY_MS, JOURNEY_STAGES, OVERVIEW_SEGMENTS, QUICK_SEGMENTS,
  assignVariants, automationRecipients, bestSendWindow, buildCustomers, buildPeople, builtInSegments, builtInSegmentsV2, cleanConditions, cleanEmail,
  contextFor, emailHealth, engagementOf, estimateFromPast, fieldKeyFor, groupEngagement, kpisAt, lagosDay, monthEnds, nextRepeatAt, percentChange, phoneKey, resolveAudience,
  cleanFieldValues, segmentMatches, slugFor, systemFieldValue, withUtm,
  type AudienceChoice, type CampaignResult, type CartLite, type Condition, type ContactLite, type CustomerStats, type Delivery, type MatchContext,
  type OrderLite, type Person, type SavedSegment, type SegmentRule
} from "./email-marketing-rules.js";
import { applyTags, collectLinks, fillTheirProduct, normalizeDesign, renderEmailHtml, renderEmailText, usesLoyaltyTags, usesTheirProduct, withTheirProduct, type EmailDesign, type RenderOptions, type TheirProduct } from "./email-render.js";
import { inSendWindow } from "./email-automation-rules.js";

/**
 * Email Marketing (Bright, 8 Nov 2026), part 1: the email list, saved
 * groups, campaigns, sending, and counting opens, clicks and orders.
 * Rules live in email-marketing-rules.ts; the email HTML in email-render.ts.
 */

export const PUBLIC_BACKEND_URL = (process.env.PUBLIC_BACKEND_URL || "https://protohub-production.up.railway.app").replace(/\/+$/, "");

export class EmailMarketingError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

const newToken = () => crypto.randomBytes(18).toString("base64url");

// ── Settings ──────────────────────────────────────────────────────────

export type MarketingSettings = { dailyLimit: number; footerNote: string; seededAt: string | null; autoSync: boolean; defaultListId: string | null; updateExisting: boolean; bounceHookOnAt: string | null };

export async function settingsFor(orgId: string, branchId: string): Promise<MarketingSettings> {
  const { data, error } = await supabase.from("email_marketing_settings").select("daily_limit, footer_note, seeded_at, auto_sync, default_list_id, update_existing, bounce_hook_on_at").eq("branch_id", branchId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) {
    await supabase.from("email_marketing_settings").upsert({ branch_id: branchId, org_id: orgId }, { onConflict: "branch_id", ignoreDuplicates: true });
    return { dailyLimit: 150, footerNote: "", seededAt: null, autoSync: true, defaultListId: null, updateExisting: true, bounceHookOnAt: null };
  }
  return {
    dailyLimit: Number(data.daily_limit) || 150, footerNote: data.footer_note ?? "", seededAt: data.seeded_at ?? null,
    autoSync: data.auto_sync !== false, defaultListId: data.default_list_id ?? null, updateExisting: data.update_existing !== false,
    bounceHookOnAt: data.bounce_hook_on_at ?? null
  };
}

export async function saveSettings(orgId: string, branchId: string, userId: string, input: { dailyLimit?: number; footerNote?: string; autoSync?: boolean; defaultListId?: string | null; updateExisting?: boolean }) {
  const patch: Record<string, unknown> = { branch_id: branchId, org_id: orgId, updated_by: userId, updated_at: new Date().toISOString() };
  if (input.dailyLimit !== undefined) patch.daily_limit = Math.min(100000, Math.max(1, Math.round(input.dailyLimit)));
  if (input.footerNote !== undefined) patch.footer_note = input.footerNote.trim().slice(0, 300);
  if (input.autoSync !== undefined) patch.auto_sync = input.autoSync;
  if (input.updateExisting !== undefined) patch.update_existing = input.updateExisting;
  if (input.defaultListId !== undefined) {
    if (input.defaultListId) {
      const { data } = await supabase.from("email_segments").select("id").eq("org_id", orgId).eq("branch_id", branchId).eq("id", input.defaultListId).eq("kind", "fixed").maybeSingle();
      if (!data) throw new EmailMarketingError(400, "Pick one of your uploaded lists.");
    }
    patch.default_list_id = input.defaultListId || null;
  }
  const { error } = await supabase.from("email_marketing_settings").upsert(patch, { onConflict: "branch_id" });
  if (error) throw new Error(error.message);
}

// ── Reading the customers ─────────────────────────────────────────────

type World = {
  nowMs: number;
  orders: Array<OrderLite & { id: string; utmSource: string | null; utmCampaign: string | null; utmContent: string | null; outcome: string }>;
  customers: Map<string, CustomerStats>;
  contacts: Array<ContactLite & { fields: Record<string, unknown> }>;
  people: Person[];
  ctx: MatchContext;
  segmentRows: SegmentRow[];
  segments: Map<string, SavedSegment>;
  tagRows: TagRow[];
  contactTags: Map<string, Set<string>>;
  fieldRows: FieldRow[];
  productNames: Map<string, string>;
};

export type SegmentRow = {
  id: string; name: string; description: string; icon: string; kind: "auto" | "fixed"; match: "all" | "any";
  conditions: Condition[]; excludeOn: boolean; exclude: Condition[]; contactIds: string[]; status: "active" | "paused" | "archived"; builtIn: string | null;
  createdAt: string; updatedAt: string; createdByName: string;
};

export type TagRow = {
  id: string; name: string; kind: "system" | "custom"; color: string; icon: string; description: string; match: "all" | "any";
  conditions: Condition[]; status: "active" | "archived"; builtIn: string | null; createdAt: string; updatedAt: string;
};

export type FieldRow = {
  id: string; key: string; name: string; type: string; options: string[]; description: string; required: boolean; useInForms: boolean;
  status: "active" | "inactive"; systemKey: string | null; icon: string; createdAt: string; updatedAt: string;
};

/** Where a list or group sits: built-in "list_*" groups and fixed lists show on the Lists tab. */
export const isList = (row: Pick<SegmentRow, "kind" | "builtIn">) => row.kind === "fixed" || !!row.builtIn?.startsWith("list_");

const worldCache = new Map<string, { at: number; world: Promise<World> }>();
const WORLD_TTL_MS = 45_000;

/** Drop the cached customers of a branch after a change to its list. */
export const forgetWorld = (branchId: string) => { worldCache.delete(branchId); };

async function loadOrders(orgId: string, branchId: string) {
  const rows = await fetchAllRowsOrThrow<any>(() => supabase.from("orders")
    .select("id, phone, email, status, amount, quantity, product_id, state, created_at, delivered_date, utm_source, utm_campaign, utm_content, source, full_upfront_paid, last_contact_attempt_outcome, call_outcome")
    // launch-safe: Silent Test orders are test orders; marketing never uses them.
    .eq("org_id", orgId).eq("branch_id", branchId).neq("launch_stage", "silent")
    .order("created_at", { ascending: true }));
  return rows.map((row) => ({
    id: String(row.id), phone: row.phone ?? null, email: row.email ?? null, status: String(row.status ?? ""), amount: Number(row.amount) || 0,
    quantity: row.quantity === null || row.quantity === undefined ? null : Number(row.quantity), productId: row.product_id ?? null,
    state: row.state ?? null, createdAt: row.created_at, deliveredDate: row.delivered_date ?? null,
    utmSource: row.utm_source ?? null, utmCampaign: row.utm_campaign ?? null, utmContent: row.utm_content ?? null,
    source: row.source ?? null, upfrontPaid: !!row.full_upfront_paid,
    // The rep's last call note: why a customer went quiet (Automations › Customer Went Quiet).
    outcome: [row.last_contact_attempt_outcome, row.call_outcome].filter((v) => typeof v === "string" && v.trim()).join(" · ").slice(0, 600)
  }));
}

async function loadCarts(orgId: string, branchId: string): Promise<CartLite[]> {
  const rows = await fetchAllRowsOrThrow<any>(() => supabase.from("abandoned_carts")
    .select("phone, email, product_id, created_at, status").eq("org_id", orgId).eq("branch_id", branchId).order("created_at", { ascending: true }));
  return rows.map((row) => ({ phone: row.phone ?? null, email: row.email ?? null, productId: row.product_id ?? null, createdAt: row.created_at, converted: String(row.status) === "Converted" }));
}

async function loadContacts(orgId: string, branchId: string): Promise<Array<ContactLite & { fields: Record<string, unknown> }>> {
  const rows = await fetchAllRowsOrThrow<any>(() => supabase.from("email_contacts")
    .select("id, email, name, phone, source, status, created_at, last_opened_at, last_clicked_at, last_emailed_at, fields")
    .eq("org_id", orgId).eq("branch_id", branchId).order("created_at", { ascending: true }));
  const ms = (value: string | null) => (value ? Date.parse(value) : null);
  return rows.map((row) => ({
    id: row.id, email: row.email, name: row.name ?? "", phone: row.phone ?? null, source: row.source, status: row.status, createdAt: row.created_at,
    lastOpenedMs: ms(row.last_opened_at), lastClickedMs: ms(row.last_clicked_at), lastEmailedMs: ms(row.last_emailed_at),
    fields: row.fields && typeof row.fields === "object" ? row.fields : {}
  }));
}

const toSegmentRow = (row: any): SegmentRow => ({
  id: row.id, name: row.name, description: row.description ?? "", icon: row.icon ?? "users", kind: row.kind === "fixed" ? "fixed" : "auto",
  match: row.match === "any" ? "any" : "all", conditions: cleanConditions(row.conditions), excludeOn: !!row.exclude_on, exclude: cleanConditions(row.exclude_conditions),
  contactIds: Array.isArray(row.contact_ids) ? row.contact_ids : [],
  status: row.status === "paused" ? "paused" : row.status === "archived" ? "archived" : "active", builtIn: row.built_in ?? null, createdAt: row.created_at, updatedAt: row.updated_at,
  createdByName: row.created_by_name ?? ""
});
const toTagRow = (row: any): TagRow => ({
  id: row.id, name: row.name, kind: row.kind === "system" ? "system" : "custom", color: row.color ?? "purple", icon: row.icon ?? "tag", description: row.description ?? "",
  match: row.match === "any" ? "any" : "all", conditions: cleanConditions(row.conditions), status: row.status === "archived" ? "archived" : "active",
  builtIn: row.built_in ?? null, createdAt: row.created_at, updatedAt: row.updated_at
});
const toFieldRow = (row: any): FieldRow => ({
  id: row.id, key: row.key, name: row.name, type: row.type, options: Array.isArray(row.options) ? row.options : [], description: row.description ?? "",
  required: !!row.required, useInForms: !!row.use_in_forms, status: row.status === "inactive" ? "inactive" : "active", systemKey: row.system_key ?? null,
  icon: row.icon ?? "form", createdAt: row.created_at, updatedAt: row.updated_at
});

/** Adds the ready-made groups, lists, tags and fields from Bright's designs the first time a branch opens the page. */
async function ensureBuiltIns(orgId: string, branchId: string, orders: OrderLite[]) {
  const settings = await settingsFor(orgId, branchId);
  if (settings.seededAt) return;
  const since = Date.now() - 90 * DAY_MS;
  const counts = new Map<string, number>();
  for (const order of orders) if (order.productId && Date.parse(order.createdAt) >= since) counts.set(order.productId, (counts.get(order.productId) ?? 0) + 1);
  const topId = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  let top: { id: string; name: string } | null = null;
  if (topId) {
    const { data } = await supabase.from("products").select("id, name").eq("id", topId).maybeSingle();
    if (data) top = { id: data.id, name: data.name };
  }
  const rows = [...builtInSegments(top), ...BUILT_IN_LISTS].map((segment) => ({
    org_id: orgId, branch_id: branchId, name: segment.name, description: segment.description, icon: segment.icon, kind: "auto",
    match: segment.match, conditions: segment.conditions, built_in: segment.key, created_by_name: "Ready-made"
  }));
  const { error } = await supabase.from("email_segments").upsert(rows, { onConflict: "branch_id,built_in", ignoreDuplicates: true });
  if (error) throw new Error(error.message);
  const tags = BUILT_IN_TAGS.map((tag) => ({
    org_id: orgId, branch_id: branchId, name: tag.name, kind: "system", color: tag.color, icon: tag.icon, description: tag.description,
    match: tag.match, conditions: tag.conditions, built_in: tag.key, created_by_name: "Ready-made"
  }));
  const tagResult = await supabase.from("email_tags").upsert(tags, { onConflict: "branch_id,built_in", ignoreDuplicates: true });
  if (tagResult.error) throw new Error(tagResult.error.message);
  const fields = BUILT_IN_FIELDS.map((field) => ({
    org_id: orgId, branch_id: branchId, key: field.key, name: field.name, type: field.type, options: field.options, description: field.description,
    required: field.required, use_in_forms: field.useInForms, system_key: field.key, icon: field.icon
  }));
  const fieldResult = await supabase.from("email_custom_fields").upsert(fields, { onConflict: "branch_id,key", ignoreDuplicates: true });
  if (fieldResult.error) throw new Error(fieldResult.error.message);
  await supabase.from("email_marketing_settings").update({ seeded_at: new Date().toISOString() }).eq("branch_id", branchId);
}

/** The second batch of ready-made groups (builtInSegmentsV2), once per branch, for branches set up before it existed too. */
const seededV2 = new Set<string>();
async function ensureBuiltInsV2(orgId: string, branchId: string, orders: OrderLite[]) {
  if (seededV2.has(branchId)) return;
  const { data: row } = await supabase.from("email_marketing_settings").select("seeded_v2_at").eq("branch_id", branchId).maybeSingle();
  if (row?.seeded_v2_at) seededV2.add(branchId);
  if (!row || row.seeded_v2_at) return;
  const since = Date.now() - 90 * DAY_MS;
  const products = new Map<string, number>();
  const states = new Map<string, number>();
  for (const order of orders) {
    if (order.status !== "Delivered") continue;
    if (order.productId && Date.parse(order.createdAt) >= since) products.set(order.productId, (products.get(order.productId) ?? 0) + 1);
    if (order.state?.trim()) states.set(order.state.trim(), (states.get(order.state.trim()) ?? 0) + 1);
  }
  const topIds = [...products.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([id]) => id);
  const { data: named } = topIds.length ? await supabase.from("products").select("id, name").in("id", topIds) : { data: [] as any[] };
  const topProducts = topIds.map((id) => (named ?? []).find((p: any) => p.id === id)).filter(Boolean).map((p: any) => ({ id: p.id as string, name: p.name as string }));
  // Lagos already has its own group (first batch).
  const topStates = [...states.entries()].filter(([state]) => state.toLowerCase() !== "lagos").sort((a, b) => b[1] - a[1]).slice(0, 2).map(([state]) => state);
  const rows = builtInSegmentsV2(topProducts, topStates).map((segment) => ({
    org_id: orgId, branch_id: branchId, name: segment.name, description: segment.description, icon: segment.icon, kind: "auto",
    match: segment.match, conditions: segment.conditions, built_in: segment.key, created_by_name: "Ready-made"
  }));
  const { error } = await supabase.from("email_segments").upsert(rows, { onConflict: "branch_id,built_in", ignoreDuplicates: true });
  if (error) throw new Error(error.message);
  await supabase.from("email_marketing_settings").update({ seeded_v2_at: new Date().toISOString() }).eq("branch_id", branchId);
  seededV2.add(branchId);
}

/** Phones of customers with an approved review (Products & Stock › Customer Reviews). */
async function reviewedPhones(orgId: string, branchId: string, orders: Array<{ id: string; phone: string | null }>) {
  const { data, error } = await supabase.from("customer_reviews").select("order_id").eq("org_id", orgId).eq("branch_id", branchId).eq("status", "approved").limit(20000);
  if (error) return new Set<string>();
  const ids = new Set((data ?? []).map((row: any) => String(row.order_id)));
  return new Set(orders.filter((order) => ids.has(order.id)).map((order) => phoneKey(order.phone)).filter(Boolean));
}

async function buildWorld(orgId: string, branchId: string): Promise<World> {
  const nowMs = Date.now();
  const [orders, carts, contacts] = await Promise.all([loadOrders(orgId, branchId), loadCarts(orgId, branchId), loadContacts(orgId, branchId)]);
  await ensureBuiltIns(orgId, branchId, orders);
  await ensureBuiltInsV2(orgId, branchId, orders);
  const [segmentResult, tagResult, fieldResult, contactTagRows, reviewed, productResult] = await Promise.all([
    supabase.from("email_segments").select("*").eq("org_id", orgId).eq("branch_id", branchId).order("created_at", { ascending: true }),
    supabase.from("email_tags").select("*").eq("org_id", orgId).eq("branch_id", branchId).order("created_at", { ascending: true }),
    supabase.from("email_custom_fields").select("*").eq("org_id", orgId).eq("branch_id", branchId).order("created_at", { ascending: true }),
    fetchAllRowsOrThrow<any>(() => supabase.from("email_contact_tags").select("contact_id, tag_id").eq("org_id", orgId).eq("branch_id", branchId)),
    reviewedPhones(orgId, branchId, orders),
    supabase.from("products").select("id, name").eq("org_id", orgId).eq("branch_id", branchId)
  ]);
  for (const result of [segmentResult, tagResult, fieldResult]) if (result.error) throw new Error(result.error.message);
  const segmentRows = (segmentResult.data ?? []).map(toSegmentRow);
  const tagRows = (tagResult.data ?? []).map(toTagRow);
  // Ready-made fields in the design's order, then the business's own by age.
  const fieldOrder = (row: FieldRow) => { const i = BUILT_IN_FIELDS.findIndex((field) => field.key === row.systemKey); return i < 0 ? 100 : i; };
  const fieldRows = (fieldResult.data ?? []).map(toFieldRow).sort((a, b) => fieldOrder(a) - fieldOrder(b) || a.createdAt.localeCompare(b.createdAt));
  const contactTags = new Map<string, Set<string>>();
  for (const row of contactTagRows) {
    if (!contactTags.has(row.contact_id)) contactTags.set(row.contact_id, new Set());
    contactTags.get(row.contact_id)!.add(row.tag_id);
  }
  const customers = buildCustomers(orders, carts);
  for (const key of reviewed) { const row = customers.get(key); if (row) row.reviewed = true; }
  // System tags follow their rule; custom tags are put on by hand. A tag's
  // own rule never asks about tags (no loops).
  const tagById = new Map(tagRows.map((row) => [row.id, row]));
  const baseCtx = contextFor(customers, nowMs);
  const hasTag = (person: Person, tagId: string) => {
    const tag = tagById.get(tagId);
    if (!tag || tag.status !== "active") return false;
    if (tag.kind === "system") return segmentMatches(person, { match: tag.match, conditions: tag.conditions.filter((c) => c.field !== "tag") }, baseCtx);
    return !!person.contact && !!contactTags.get(person.contact.id)?.has(tagId);
  };
  return {
    nowMs, orders, customers, contacts,
    people: buildPeople(customers, contacts),
    ctx: contextFor(customers, nowMs, hasTag),
    segmentRows,
    segments: new Map(segmentRows.map((row) => [row.id, { id: row.id, name: row.name, kind: row.kind, match: row.match, conditions: row.conditions, exclude: row.excludeOn ? row.exclude : [], contactIds: row.contactIds }])),
    tagRows, contactTags, fieldRows,
    productNames: new Map(((productResult.data ?? []) as any[]).map((row) => [row.id, row.name]))
  };
}

export function loadWorld(orgId: string, branchId: string, fresh = false): Promise<World> {
  const cached = worldCache.get(branchId);
  if (!fresh && cached && Date.now() - cached.at < WORLD_TTL_MS) return cached.world;
  const world = buildWorld(orgId, branchId);
  worldCache.set(branchId, { at: Date.now(), world });
  world.catch(() => worldCache.delete(branchId));
  return world;
}

/** Copies new order and cart emails into the list. */
export async function syncContacts(orgId: string) {
  const { data, error } = await supabase.rpc("sync_email_contacts", { p_org: orgId });
  if (error) throw new Error(error.message);
  return Number(data) || 0;
}

// ── Campaign rows ─────────────────────────────────────────────────────

export type CampaignStats = {
  queued: number; sent: number; failed: number; skipped: number; opened: number; clicked: number; orders: number; deliveredOrders: number; revenue: number;
  unsubscribed: number; a: { sent: number; opened: number; clicked: number }; b: { sent: number; opened: number; clicked: number }; lastSentAt: string | null;
};

const EMPTY_STATS: CampaignStats = { queued: 0, sent: 0, failed: 0, skipped: 0, opened: 0, clicked: 0, orders: 0, deliveredOrders: 0, revenue: 0, unsubscribed: 0, a: { sent: 0, opened: 0, clicked: 0 }, b: { sent: 0, opened: 0, clicked: 0 }, lastSentAt: null };

export async function statsFor(campaignIds: string[]): Promise<Map<string, CampaignStats>> {
  const out = new Map<string, CampaignStats>();
  for (let i = 0; i < campaignIds.length; i += 200) {
    const batch = campaignIds.slice(i, i + 200);
    const { data, error } = await supabase.rpc("email_campaign_stats", { p_ids: batch });
    if (error) throw new Error(error.message);
    for (const row of (data ?? []) as any[]) {
      out.set(row.campaign_id, {
        queued: row.queued, sent: row.sent, failed: row.failed, skipped: row.skipped, opened: row.opened, clicked: row.clicked,
        orders: row.orders, deliveredOrders: row.delivered_orders, revenue: Number(row.revenue) || 0, unsubscribed: row.unsubscribed,
        a: { sent: row.sent_a, opened: row.opened_a, clicked: row.clicked_a }, b: { sent: row.sent_b, opened: row.opened_b, clicked: row.clicked_b },
        lastSentAt: row.last_sent_at
      });
    }
  }
  return out;
}

export const CAMPAIGN_LIST_COLUMNS = "id, name, goal, subject, subject_b, preheader, offer_type, product_id, offer, offer_id, audience, delivery, options, status, slug, send_at, next_run_at, run_count, audience_count, thumbnail_url, archived_from, created_by_name, created_at, updated_at, launched_at, completed_at";

export function campaignDto(row: any, stats?: CampaignStats) {
  return {
    id: row.id, name: row.name, goal: row.goal, subject: row.subject, subjectB: row.subject_b, preheader: row.preheader, offerType: row.offer_type,
    productId: row.product_id, offer: row.offer ?? {}, audience: row.audience ?? {}, delivery: row.delivery ?? {}, options: row.options ?? {},
    status: row.status, slug: row.slug, sendAt: row.send_at, nextRunAt: row.next_run_at, runCount: row.run_count, audienceCount: row.audience_count,
    thumbnailUrl: row.thumbnail_url, createdByName: row.created_by_name, createdAt: row.created_at, updatedAt: row.updated_at,
    launchedAt: row.launched_at, completedAt: row.completed_at, archivedFrom: row.archived_from ?? null, offerId: row.offer_id ?? null,
    ...(row.design !== undefined ? { design: normalizeDesign(row.design) } : {}),
    stats: stats ?? EMPTY_STATS
  };
}

/** How a campaign's audience reads in a table ("Repeat Buyers"). */
export function audienceLabel(audience: AudienceChoice | undefined, segments: Map<string, SavedSegment>) {
  if (!audience?.source || audience.source === "all") return "All Customers";
  if (audience.source === "custom") return audience.custom?.name?.trim() || "Custom group";
  if (audience.source === "journey") return JOURNEY_STAGES[audience.journeyStage ?? ""]?.name ?? "Customer stage";
  const segment = segments.get((audience.source === "list" ? audience.listId : audience.segmentId) ?? "");
  return segment?.name ?? "Deleted group";
}

// ── Audience preview (step 2) ─────────────────────────────────────────

export function previewAudience(world: World, choice: AudienceChoice) {
  const result = resolveAudience(world.people, choice, world.segments, world.ctx);
  const buyersMatched = result.matched.filter((person) => (person.stats?.deliveredCount ?? 0) > 0);
  const allBuyers = world.people.filter((person) => (person.stats?.deliveredCount ?? 0) > 0).length;
  const totals = buyersMatched.reduce((sum, person) => ({ orders: sum.orders + person.stats!.deliveredCount, money: sum.money + person.stats!.deliveredTotal, days: sum.days + (world.nowMs - (person.stats!.lastDeliveredMs ?? world.nowMs)) / DAY_MS }), { orders: 0, money: 0, days: 0 });
  const repeat = buyersMatched.filter((person) => person.stats!.deliveredCount >= 2).length;
  const topSpend = world.ctx.topSpend(20);
  const highValue = buyersMatched.filter((person) => person.stats!.deliveredTotal >= topSpend).length;
  const states = new Map<string, number>();
  for (const person of result.matched) {
    const state = person.stats?.state?.trim();
    if (state) states.set(state, (states.get(state) ?? 0) + 1);
  }
  const ranked = [...states.entries()].sort((a, b) => b[1] - a[1]);
  const base = Math.max(1, result.matched.length);
  const pct = (n: number) => Math.round((n / base) * 1000) / 10;
  const top2 = ranked.slice(0, 2);
  const others = ranked.slice(2).reduce((sum, [, n]) => sum + n, 0);
  return {
    recipients: result.recipients.length,
    matched: result.matched.length,
    optedOut: result.optedOut,
    withoutEmail: result.matched.filter((person) => !person.contact).length,
    insights: {
      total: result.matched.length,
      percentOfAll: allBuyers ? Math.round((buyersMatched.length / allBuyers) * 1000) / 10 : 0,
      avgOrderValue: totals.orders ? Math.round(totals.money / totals.orders) : 0,
      avgFrequency: buyersMatched.length ? Math.round((totals.orders / buyersMatched.length) * 10) / 10 : 0,
      avgDaysSinceLast: buyersMatched.length ? Math.round(totals.days / buyersMatched.length) : null
    },
    breakdown: [
      { label: "Repeat Buyers", percent: pct(repeat) },
      { label: "High-Value", percent: pct(highValue) },
      ...top2.map(([state, n]) => ({ label: state, percent: pct(n) })),
      ...(others ? [{ label: "Other States", percent: pct(others) }] : [])
    ]
  };
}

/** Step 4/5 numbers: this business's own past results, and when customers order. */
export async function planningFor(orgId: string, branchId: string, audience: number) {
  const world = await loadWorld(orgId, branchId);
  const { data, error } = await supabase.from("email_campaigns").select("id, audience_count").eq("org_id", orgId).eq("branch_id", branchId)
    .in("status", ["completed", "sending", "active", "scheduled", "paused"]).order("created_at", { ascending: false }).limit(20);
  if (error) throw new Error(error.message);
  const stats = await statsFor((data ?? []).map((row) => row.id));
  const past: CampaignResult[] = (data ?? []).map((row) => {
    const s = stats.get(row.id) ?? EMPTY_STATS;
    return { sent: s.sent, opened: s.opened, clicked: s.clicked, orders: s.orders, revenue: s.revenue, audience: row.audience_count };
  });
  const kpis = kpisAt(world.orders, world.nowMs);
  const since = world.nowMs - 90 * DAY_MS;
  return {
    estimate: estimateFromPast(past, audience, kpis.aov),
    pastCampaigns: past.filter((row) => row.sent >= 10).length,
    sendWindow: bestSendWindow(world.orders.map((order) => Date.parse(order.createdAt)).filter((ms) => ms >= since))
  };
}

// ── Overview (design 43) ──────────────────────────────────────────────

export async function overviewFor(orgId: string, branchId: string) {
  const world = await loadWorld(orgId, branchId);
  const { nowMs, orders, people, ctx } = world;
  const now = kpisAt(orders, nowMs);
  const before30 = kpisAt(orders, nowMs - 30 * DAY_MS);
  const before90 = kpisAt(orders, nowMs - 90 * DAY_MS);
  const subscribed = world.contacts.filter((row) => row.status === "subscribed");
  const subscribedBefore = subscribed.filter((row) => Date.parse(row.createdAt) <= nowMs - 30 * DAY_MS).length;

  const since30 = new Date(nowMs - 30 * DAY_MS).toISOString();
  const [{ count: sentSends }, { count: failedSends }, { count: sentStaff }, { count: failedStaff }] = await Promise.all([
    supabase.from("email_campaign_sends").select("id", { count: "exact", head: true }).eq("org_id", orgId).eq("branch_id", branchId).eq("status", "sent").gte("sent_at", since30),
    supabase.from("email_campaign_sends").select("id", { count: "exact", head: true }).eq("org_id", orgId).eq("branch_id", branchId).eq("status", "failed").gte("queued_at", since30),
    supabase.from("email_messages").select("id", { count: "exact", head: true }).eq("org_id", orgId).eq("status", "sent").gte("created_at", since30),
    supabase.from("email_messages").select("id", { count: "exact", head: true }).eq("org_id", orgId).eq("status", "failed").gte("created_at", since30)
  ]);
  const health = emailHealth((sentSends ?? 0) + (sentStaff ?? 0), (failedSends ?? 0) + (failedStaff ?? 0));

  const trend = monthEnds(nowMs, 6).map((month) => {
    const k = kpisAt(orders, month.endMs);
    return { key: month.key, label: month.label, ltv: Math.round(k.ltv), retention: Math.round(k.retention * 10) / 10 };
  });

  const buyersList = people.filter((person) => (person.stats?.deliveredCount ?? 0) > 0);
  const engaged = buyersList.filter((person) => {
    const last = Math.max(person.contact?.lastOpenedMs ?? 0, person.contact?.lastClickedMs ?? 0);
    return last > 0 && nowMs - last <= 90 * DAY_MS;
  }).length;
  const topSpend = ctx.topSpend(20);
  const highValue = buyersList.filter((person) => person.stats!.deliveredTotal >= topSpend).length;

  const segments = OVERVIEW_SEGMENTS.map((segment) => {
    const matched = segment.key === "all" ? people.filter((person) => !!person.contact || (person.stats?.deliveredCount ?? 0) > 0) : people.filter((person) => segmentMatches(person, segment.rule, ctx));
    return { key: segment.key, name: segment.name, icon: segment.icon, count: matched.filter((person) => person.contact?.status === "subscribed").length, customers: matched.length };
  });

  const { data: campaignRows, error } = await supabase.from("email_campaigns").select(CAMPAIGN_LIST_COLUMNS)
    .eq("org_id", orgId).eq("branch_id", branchId).is("automation_id", null).neq("status", "archived").order("created_at", { ascending: false }).limit(200);
  if (error) throw new Error(error.message);
  const rows = campaignRows ?? [];
  const stats = await statsFor(rows.map((row) => row.id));
  const today = lagosDay(nowMs);
  // Automations (their own page since 8 Nov 2026): the ready-made flows' state and the busiest ones.
  const { data: autoRows, error: autoError } = await supabase.from("email_automations").select("id, name, status, template, trigger").eq("org_id", orgId).eq("branch_id", branchId).neq("status", "archived");
  if (autoError) throw new Error(autoError.message);
  const autos = autoRows ?? [];
  const autoRuns = autos.length ? await fetchAllRowsOrThrow<any>(() => supabase.from("email_automation_runs").select("automation_id").in("automation_id", autos.map((row) => row.id))) : [];
  const reached = new Map<string, number>();
  for (const run of autoRuns) reached.set(run.automation_id, (reached.get(run.automation_id) ?? 0) + 1);
  const templateState = (template: string) => {
    const match = autos.filter((row) => row.template === template);
    return match.some((row) => row.status === "active") ? "active" : match.length ? "paused" : "off";
  };
  const sender = await marketingSender(orgId);
  const { data: embed } = await supabase.from("embed_settings").select("show_email").eq("org_id", orgId).limit(1).maybeSingle();

  return {
    nowMs,
    sender,
    formEmailOn: !!embed?.show_email,
    health: health ? { ...health, sent: (sentSends ?? 0) + (sentStaff ?? 0), failed: (failedSends ?? 0) + (failedStaff ?? 0) } : null,
    kpis: {
      subscribers: { value: subscribed.length, change: percentChange(subscribed.length, subscribedBefore) },
      activeCustomers: { value: now.active, change: percentChange(now.active, before90.active) },
      repeatCustomers: { value: now.repeat, change: percentChange(now.repeat, before30.repeat) },
      frequency: { value: Math.round(now.frequency * 100) / 100, before: Math.round(before30.frequency * 100) / 100 },
      ltv: { value: Math.round(now.ltv), change: percentChange(now.ltv, before30.ltv) },
      retention: { value: Math.round(now.retention * 10) / 10, changePp: before30.buyers ? Math.round((now.retention - before30.retention) * 10) / 10 : null }
    },
    trend,
    ltv: { value: Math.round(now.ltv), change: percentChange(now.ltv, before30.ltv), aov: Math.round(now.aov), frequency: Math.round(now.frequency * 100) / 100, ageMonths: Math.round(now.avgAgeMonths * 10) / 10 },
    funnel: { total: buyersList.length, engaged, repeat: now.repeat, highValue },
    segments,
    automations: [
      { key: "post_purchase", name: "Post-Purchase", hint: "Thank, guide, upsell", state: templateState("post_purchase") },
      { key: "cart_abandonment", name: "Browse Abandonment", hint: "Remind & recover", state: templateState("cart_abandonment") },
      { key: "win_back", name: "Win-Back", hint: "Re-engage inactive", state: templateState("win_back") },
      { key: "vip_loyalty", name: "VIP Customers", hint: "Exclusive offers", state: templateState("vip_loyalty") },
      { key: "birthday", name: "Birthday", hint: "Personalised reward", state: templateState("birthday") }
    ],
    topAutomations: autos
      .map((row) => ({ id: row.id, name: row.name, status: row.status, customers: reached.get(row.id) ?? 0, trigger: String((row.trigger as any)?.kind ?? "") || null }))
      .sort((a, b) => (a.status === "active" ? 0 : 1) - (b.status === "active" ? 0 : 1) || b.customers - a.customers)
      .slice(0, 4),
    recent: rows.filter((row) => (row.delivery as Delivery)?.type !== "automation").slice(0, 8).map((row) => ({ ...campaignDto(row, stats.get(row.id)), audienceLabel: audienceLabel(row.audience as AudienceChoice, world.segments) })),
    scheduledToday: rows
      .filter((row) => row.status === "scheduled" && row.next_run_at && lagosDay(Date.parse(row.next_run_at)) === today)
      .sort((a, b) => Date.parse(a.next_run_at) - Date.parse(b.next_run_at))
      .map((row) => ({ id: row.id, name: row.name, at: row.next_run_at, audienceLabel: audienceLabel(row.audience as AudienceChoice, world.segments) }))
  };
}

// ── Audience & Segments (design 52) ───────────────────────────────────

function segmentMembers(world: World, segment: SegmentRow) {
  if (segment.kind === "fixed") {
    const ids = new Set(segment.contactIds);
    return world.people.filter((person) => person.contact && ids.has(person.contact.id));
  }
  return world.people.filter((person) => segmentMatches(person, { match: segment.match, conditions: segment.conditions, exclude: segment.excludeOn ? segment.exclude : [] }, world.ctx));
}

export async function audienceFor(orgId: string, branchId: string) {
  const world = await loadWorld(orgId, branchId);
  const { nowMs, contacts } = world;
  const total = contacts.length;
  const subscribed = contacts.filter((row) => row.status === "subscribed").length;
  const unsubscribed = contacts.filter((row) => row.status === "unsubscribed").length;
  const bounced = contacts.filter((row) => row.status === "bounced").length;
  const engaged = contacts.filter((row) => row.status === "subscribed" && Math.max(row.lastOpenedMs ?? 0, row.lastClickedMs ?? 0) >= nowMs - 30 * DAY_MS).length;
  const old = (row: ContactLite) => Date.parse(row.createdAt) <= nowMs - 30 * DAY_MS;
  const vipTag = world.tagRows.find((row) => row.builtIn === "vip");
  const listed = world.people.filter((person) => person.contact);
  const vipPeople = vipTag ? listed.filter((person) => world.ctx.hasTag?.(person, vipTag.id)) : [];
  const pct1 = (n: number, of: number) => (of ? Math.round((n / of) * 1000) / 10 : 0);

  const groupStats = (segment: SegmentRow) => {
    const members = segmentMembers(world, segment);
    const people = members.filter((person) => person.contact);
    const subs = people.filter((person) => person.contact!.status === "subscribed").length;
    const newer = people.filter((person) => !old(person.contact!)).length;
    return {
      ...segment,
      size: subs, customers: members.length, contacts: people.length, subscribed: subs,
      unsubscribed: people.length - subs,
      percent: pct1(people.length, total),
      growth: people.length - newer ? Math.round((newer / (people.length - newer)) * 1000) / 10 : null,
      engagement: groupEngagement(people.map((person) => person.contact), nowMs),
      isList: isList(segment)
    };
  };
  const groups = world.segmentRows.map(groupStats);
  // The Segments tab shows groups; the Lists tab shows lists (fixed ones appear in both).
  const segments = groups.filter((row) => !row.builtIn?.startsWith("list_"));
  const lists = groups.filter((row) => row.isList);

  const tags = world.tagRows.map((tag) => {
    const members = listed.filter((person) => {
      if (tag.kind === "system") return segmentMatches(person, { match: tag.match, conditions: tag.conditions.filter((c) => c.field !== "tag") }, world.ctx);
      return !!world.contactTags.get(person.contact!.id)?.has(tag.id);
    });
    return { ...tag, contacts: members.length, percent: pct1(members.length, total) };
  });

  const productName = (id: string) => world.productNames.get(id) ?? "";
  const fields = world.fieldRows.map((field) => {
    const filled = field.systemKey
      ? listed.filter((person) => systemFieldValue(field.systemKey!, person, world.ctx, productName) !== "").length
      : contacts.filter((row) => { const value = row.fields[field.key]; return Array.isArray(value) ? value.length > 0 : String(value ?? "").trim() !== ""; }).length;
    return { ...field, filled, filledPercent: pct1(filled, total) };
  });

  // The donut: each person counted once, in this order.
  const order: Array<{ label: string; rule: SegmentRule }> = [
    { label: "Repeat Buyers", rule: QUICK_SEGMENTS.repeat.rule },
    { label: "Recent Buyers", rule: QUICK_SEGMENTS.recent.rule },
    { label: "Not bought yet", rule: { match: "all", conditions: [{ field: "purchase_count", op: "eq", value: 0 }] } },
    { label: "Inactive", rule: { match: "all", conditions: [{ field: "last_purchase_days", op: "over", value: 60 }] } },
    { label: "Cart Abandoners", rule: QUICK_SEGMENTS.cart.rule }
  ];
  const counts = order.map(() => 0);
  let others = 0;
  for (const person of listed) {
    const index = order.findIndex((slice) => segmentMatches(person, slice.rule, world.ctx));
    if (index >= 0) counts[index] += 1; else others += 1;
  }
  const sorted = [...segments].sort((a, b) => b.size - a.size);
  const growing = segments.filter((row) => row.growth !== null).sort((a, b) => (b.growth ?? 0) - (a.growth ?? 0))[0] ?? null;
  const upsell = segments.find((row) => row.builtIn === "upsell") ?? null;

  return {
    kpis: {
      total: { value: total, change: percentChange(total, contacts.filter(old).length) },
      subscribed: { value: subscribed, percent: pct1(subscribed, total), change: percentChange(subscribed, contacts.filter((row) => old(row) && row.status === "subscribed").length) },
      unsubscribed: { value: unsubscribed + bounced, percent: pct1(unsubscribed + bounced, total) },
      engaged: { value: engaged, percent: pct1(engaged, subscribed) },
      vip: { value: vipPeople.length, percent: pct1(vipPeople.length, total) }
    },
    counts: { all: total, subscribed, unsubscribed, bounced },
    segments, lists, tags, fields,
    donut: { total: listed.length, slices: [...order.map((slice, i) => ({ label: slice.label, count: counts[i], percent: pct1(counts[i], listed.length) })), { label: "Others", count: others, percent: pct1(others, listed.length) }] },
    insights: {
      topSegment: sorted[0] && sorted[0].size > 0 ? { name: sorted[0].name, size: sorted[0].size } : null,
      fastestGrowing: growing && (growing.growth ?? 0) > 0 ? { name: growing.name, growth: growing.growth } : null,
      engagementRate: subscribed ? pct1(engaged, subscribed) : null,
      nextBest: upsell ? { name: upsell.name, size: upsell.size, customers: upsell.customers } : null
    },
    customersWithoutEmail: world.people.filter((person) => !person.contact && (person.stats?.deliveredCount ?? 0) > 0).length
  };
}

/** The All Audience tab: everyone on the list, with their groups, lists, tags and answers. */
export async function contactsFor(orgId: string, branchId: string) {
  const world = await loadWorld(orgId, branchId);
  const productName = (id: string) => world.productNames.get(id) ?? "";
  const activeGroups = world.segmentRows.filter((row) => row.status !== "archived");
  const activeTags = world.tagRows.filter((row) => row.status === "active");
  const systemFields = world.fieldRows.filter((row) => row.systemKey);
  const fieldsByContact = new Map(world.contacts.map((row) => [row.id, row.fields]));
  return world.people.filter((person) => person.contact).map((person) => {
    const contact = person.contact!;
    const memberOf = activeGroups.filter((group) => group.kind === "fixed"
      ? group.contactIds.includes(contact.id)
      : segmentMatches(person, { match: group.match, conditions: group.conditions, exclude: group.excludeOn ? group.exclude : [] }, world.ctx));
    const lastActivity = Math.max(contact.lastOpenedMs ?? 0, contact.lastClickedMs ?? 0, person.stats?.lastOrderMs ?? 0);
    return {
      id: contact.id, email: contact.email, name: contact.name || "", phone: contact.phone, source: contact.source, status: contact.status, joinedAt: contact.createdAt,
      orders: person.stats?.deliveredCount ?? 0, spent: Math.round(person.stats?.deliveredTotal ?? 0),
      lastPurchaseAt: person.stats?.lastDeliveredMs ? new Date(person.stats.lastDeliveredMs).toISOString() : null,
      lastOpenedAt: contact.lastOpenedMs ? new Date(contact.lastOpenedMs).toISOString() : null,
      lastActivityAt: lastActivity ? new Date(lastActivity).toISOString() : null,
      state: person.stats?.state ?? "",
      engagement: engagementOf(contact, world.nowMs),
      segments: memberOf.filter((group) => !isList(group)).map((group) => group.id),
      lists: memberOf.filter((group) => isList(group)).map((group) => group.id),
      tags: activeTags.filter((tag) => world.ctx.hasTag?.(person, tag.id)).map((tag) => tag.id),
      // Lists, not objects keyed by field key: the browser camel-cases response keys.
      fields: Object.entries(fieldsByContact.get(contact.id) ?? {}).map(([key, value]) => ({ key, value })),
      system: systemFields.map((field) => ({ key: field.key, value: systemFieldValue(field.systemKey!, person, world.ctx, productName) }))
    };
  }).sort((a, b) => b.joinedAt.localeCompare(a.joinedAt));
}

export async function segmentPreview(orgId: string, branchId: string, rule: SegmentRule) {
  const world = await loadWorld(orgId, branchId);
  const members = world.people.filter((person) => segmentMatches(person, rule, world.ctx));
  return { size: members.filter((person) => person.contact?.status === "subscribed").length, customers: members.length, withoutEmail: members.filter((person) => !person.contact).length };
}

// ── Adding people ─────────────────────────────────────────────────────

export async function addContacts(orgId: string, branchId: string, userId: string, rows: Array<{ email: string; name?: string; phone?: string; fields?: Record<string, unknown> }>, source: "manual" | "import", meta?: { kind: "csv" | "paste" | "device" | "manual"; details: string; userName: string }) {
  const world = await loadWorld(orgId, branchId);
  const settings = await settingsFor(orgId, branchId);
  const seen = new Set<string>();
  const clean: Array<Record<string, unknown>> = [];
  const answers = new Map<string, Record<string, unknown>>();
  let invalid = 0;
  for (const row of rows) {
    const email = cleanEmail(row.email);
    if (!email) { invalid += 1; continue; }
    if (seen.has(email)) continue;
    seen.add(email);
    const fields = row.fields ? cleanFieldValues(world.fieldRows, row.fields) : {};
    if (Object.keys(fields).length) answers.set(email, fields);
    clean.push({ org_id: orgId, branch_id: branchId, email, name: String(row.name ?? "").trim().slice(0, 120), phone: phoneKey(row.phone) ? String(row.phone).trim() : null, source, created_by: userId, fields });
  }
  let added = 0;
  const ids: string[] = [];
  for (let i = 0; i < clean.length; i += 500) {
    const { data, error } = await supabase.from("email_contacts").upsert(clean.slice(i, i + 500), { onConflict: "branch_id,email", ignoreDuplicates: true }).select("id");
    if (error) throw new Error(error.message);
    added += (data ?? []).length;
    ids.push(...(data ?? []).map((row: any) => row.id));
  }
  // People already on the list keep their own record (an unsubscribe stays).
  // With "update existing contacts" on, the upload fills in a missing name or
  // phone and adds its answers to custom fields.
  const existing = clean.length - added;
  const allIds = [...ids];
  let updated = 0;
  if (existing > 0) {
    const emails = clean.map((row) => String(row.email));
    const byEmail = new Map(clean.map((row) => [String(row.email), row]));
    const found = await selectByIdBatches<any>(emails, (batch) => supabase.from("email_contacts").select("id, email, name, phone, fields").eq("org_id", orgId).eq("branch_id", branchId).in("email", batch));
    for (const row of found) {
      if (!allIds.includes(row.id)) allIds.push(row.id);
      if (ids.includes(row.id) || !settings.updateExisting) continue;
      const incoming = byEmail.get(row.email);
      const extra = answers.get(row.email);
      const patch: Record<string, unknown> = {};
      if (incoming?.name && !String(row.name ?? "").trim()) patch.name = incoming.name;
      if (incoming?.phone && !row.phone) patch.phone = incoming.phone;
      if (extra) patch.fields = { ...(row.fields ?? {}), ...extra };
      if (Object.keys(patch).length) {
        await supabase.from("email_contacts").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", row.id);
        updated += 1;
      }
    }
  }
  // The default list for imported contacts (Import / Sync settings).
  if (source === "import" && settings.defaultListId && allIds.length) {
    const { data: list } = await supabase.from("email_segments").select("id, contact_ids, kind").eq("id", settings.defaultListId).eq("branch_id", branchId).maybeSingle();
    if (list && list.kind === "fixed") {
      const merged = [...new Set([...(list.contact_ids ?? []), ...allIds])];
      await supabase.from("email_segments").update({ contact_ids: merged, updated_at: new Date().toISOString() }).eq("id", list.id);
    }
  }
  const duplicates = rows.length - invalid - added - updated;
  let importId: string | null = null;
  if (meta) {
    const { data: logged } = await supabase.from("email_imports").insert({
      org_id: orgId, branch_id: branchId, source: meta.kind, details: meta.details.slice(0, 200), contacts: rows.length - invalid,
      added, updated, duplicates: Math.max(0, duplicates), invalid, created_by: userId, created_by_name: meta.userName
    }).select("id").single();
    importId = logged?.id ?? null;
    // The people this upload added remember it (Audience Health › Quality by Source).
    for (let i = 0; importId && i < ids.length; i += 200) {
      const { error } = await supabase.from("email_contacts").update({ import_id: importId }).eq("branch_id", branchId).in("id", ids.slice(i, i + 200));
      if (error) logger.warn("email upload: linking contacts to it failed", { importId, error: error.message });
    }
  }
  forgetWorld(branchId);
  return { added, updated, alreadyOnList: existing, invalid, contactIds: allIds, importId };
}

/** Import / Sync: the history of uploads, and how the order-form sync stands. */
export async function importsFor(orgId: string, branchId: string) {
  const [history, settings, lastOrderEmail, lastCartEmail] = await Promise.all([
    supabase.from("email_imports").select("*").eq("org_id", orgId).eq("branch_id", branchId).order("created_at", { ascending: false }).limit(200),
    settingsFor(orgId, branchId),
    supabase.from("email_contacts").select("created_at").eq("org_id", orgId).eq("branch_id", branchId).in("source", ["order", "cart"]).order("created_at", { ascending: false }).limit(1),
    supabase.from("email_contacts").select("id", { count: "exact", head: true }).eq("org_id", orgId).eq("branch_id", branchId).in("source", ["order", "cart"])
  ]);
  if (history.error) throw new Error(history.error.message);
  return {
    imports: (history.data ?? []).map((row: any) => ({
      id: row.id, source: row.source, details: row.details, contacts: row.contacts, added: row.added, updated: row.updated, duplicates: row.duplicates,
      invalid: row.invalid, status: row.status, listId: row.list_id, createdAt: row.created_at, createdByName: row.created_by_name
    })),
    settings: { autoSync: settings.autoSync, defaultListId: settings.defaultListId, updateExisting: settings.updateExisting },
    orderForm: { on: settings.autoSync, lastSyncAt: lastSyncMs ? new Date(lastSyncMs).toISOString() : null, lastContactAt: lastOrderEmail.data?.[0]?.created_at ?? null, contacts: lastCartEmail.count ?? 0 }
  };
}

export async function setContactStatus(orgId: string, branchId: string, contactId: string, status: "unsubscribed", reason: string) {
  const { error } = await supabase.from("email_contacts").update({ status, status_changed_at: new Date().toISOString(), status_reason: reason, updated_at: new Date().toISOString() })
    .eq("org_id", orgId).eq("branch_id", branchId).eq("id", contactId);
  if (error) throw new Error(error.message);
  forgetWorld(branchId);
}

/** Only people added by hand or by upload can be removed; order emails would come straight back. */
export async function deleteContact(orgId: string, branchId: string, contactId: string) {
  const { data } = await supabase.from("email_contacts").select("source").eq("org_id", orgId).eq("branch_id", branchId).eq("id", contactId).maybeSingle();
  if (!data) throw new EmailMarketingError(404, "That person is not on the list.");
  if (data.source === "order" || data.source === "cart") throw new EmailMarketingError(409, "This email came from an order or cart. Unsubscribe it instead; deleting would only bring it back.");
  const { error } = await supabase.from("email_contacts").delete().eq("org_id", orgId).eq("branch_id", branchId).eq("id", contactId);
  if (error) throw new Error(error.message);
  forgetWorld(branchId);
}

// ── Products, reviews, pictures for the email designer ───────────────

export async function productsForDesigner(orgId: string, branchId: string) {
  const { data: products, error } = await supabase.from("products").select("id, name, image_url, active").eq("org_id", orgId).eq("branch_id", branchId).eq("active", true).order("name");
  if (error) throw new Error(error.message);
  const ids = (products ?? []).map((row) => row.id);
  const [packages, media, links] = await Promise.all([
    selectByIdBatches<any>(ids, (batch) => supabase.from("product_packages").select("product_id, price, active, image_url").in("product_id", batch)),
    selectByIdBatches<any>(ids, (batch) => supabase.from("product_media").select("product_id, url, kind, is_cover, display_order").in("product_id", batch).eq("status", "approved").eq("kind", "image")),
    supabase.from("meta_capi_configs").select("product_id, landing_page_url, active, label").eq("org_id", orgId).not("landing_page_url", "is", null)
  ]);
  const https = (url: unknown) => (typeof url === "string" && /^https:\/\//i.test(url) ? url : "");
  return (products ?? []).map((product) => {
    const prices = packages.filter((row) => row.product_id === product.id && row.active !== false).map((row) => Number(row.price)).filter((n) => Number.isFinite(n) && n > 0);
    const photos = media.filter((row) => row.product_id === product.id && https(row.url)).sort((a, b) => Number(b.is_cover) - Number(a.is_cover) || (a.display_order ?? 0) - (b.display_order ?? 0));
    const packagePicture = packages.find((row) => row.product_id === product.id && https(row.image_url))?.image_url ?? "";
    const pages = ((links.data ?? []) as any[]).filter((row) => row.product_id === product.id && row.active !== false && https(row.landing_page_url));
    return {
      id: product.id, name: product.name,
      image: https(product.image_url) || photos[0]?.url || packagePicture || "",
      priceMin: prices.length ? Math.min(...prices) : null, priceMax: prices.length ? Math.max(...prices) : null,
      links: pages.map((row) => ({ label: row.label || row.landing_page_url, url: row.landing_page_url }))
    };
  });
}

/** Approved reviews the customer allowed in marketing (private ones never appear). */
export async function reviewsForDesigner(orgId: string, branchId: string) {
  const { data, error } = await supabase.from("customer_reviews").select("id, review_text, rating, order_id, product_id, reviewed_at")
    .eq("org_id", orgId).eq("branch_id", branchId).eq("status", "approved").eq("marketing_ok", true).is("marketing_withdrawn_at", null)
    .order("reviewed_at", { ascending: false }).limit(50);
  if (error) throw new Error(error.message);
  const rows = (data ?? []).filter((row) => String(row.review_text ?? "").trim());
  const orders = await selectByIdBatches<any>(rows.map((row) => row.order_id), (batch) => supabase.from("orders").select("id, customer")
    // launch-safe: Silent Test orders never feed marketing.
    .eq("org_id", orgId).neq("launch_stage", "silent").in("id", batch));
  const products = await selectByIdBatches<any>(rows.map((row) => row.product_id).filter(Boolean), (batch) => supabase.from("products").select("id, name").in("id", batch));
  const names = new Map(orders.map((row) => [row.id, String(row.customer ?? "").trim().split(/\s+/)[0]]));
  const productNames = new Map(products.map((row) => [row.id, row.name]));
  return rows.filter((row) => names.has(row.order_id)).map((row) => ({
    id: row.id, quote: String(row.review_text).trim().slice(0, 280), name: names.get(row.order_id) || "A customer",
    productName: productNames.get(row.product_id) ?? "", rating: row.rating ?? null
  }));
}

export async function uploadPicture(orgId: string, dataUrl: string) {
  const match = /^data:(image\/(png|jpeg|gif|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!match) throw new EmailMarketingError(400, "Choose a PNG, JPG, GIF or WebP picture.");
  const bytes = Buffer.from(match[3], "base64");
  if (bytes.length > 5 * 1024 * 1024) throw new EmailMarketingError(400, "That picture is over 5 MB.");
  const path = `${orgId}/${new Date().toISOString().slice(0, 10)}/${newToken()}.${match[2] === "jpeg" ? "jpg" : match[2]}`;
  const { error } = await supabase.storage.from("email-assets").upload(path, bytes, { contentType: match[1], upsert: false });
  if (error) throw new Error(error.message);
  return supabase.storage.from("email-assets").getPublicUrl(path).data.publicUrl;
}

// ── Sending ───────────────────────────────────────────────────────────

const trackingUrl = (kind: "o" | "c" | "u", token: string, index?: number) =>
  kind === "c" ? `${PUBLIC_BACKEND_URL}/e/c/${token}/${index}` : kind === "o" ? `${PUBLIC_BACKEND_URL}/e/o/${token}.gif` : `${PUBLIC_BACKEND_URL}/e/u/${token}`;

/** The links a run sends, with utm tags when the campaign asks for them. */
export function campaignLinks(campaign: { slug: string; options?: any }, design: EmailDesign) {
  const utm = campaign.options?.utm !== false;
  return collectLinks(design).map((link) => ({
    label: link.label,
    original: link.url,
    url: utm ? withUtm(link.url, { utm_source: "email", utm_medium: "email", utm_campaign: campaign.slug }) : link.url
  }));
}

type RunLink = { label: string; original?: string; url: string };

type SenderContext = { brand: string; footerNote: string };

/** One email's HTML and text, links routed through the click counter. */
export function renderForSend(campaign: any, rawDesign: EmailDesign, send: { token: string; name: string; variant: string; loyalty?: RenderOptions["loyalty"] | null; theirs?: TheirProduct | null }, sender: SenderContext, nowMs: number) {
  const design = send.theirs === undefined ? rawDesign : withTheirProduct(rawDesign, send.theirs);
  // Each link goes through the click counter, numbered by its place in the
  // run's link list (the same page twice counts as one link).
  const links: RunLink[] = Array.isArray(campaign.links) && campaign.links.length ? campaign.links : campaignLinks(campaign, design);
  // An automation with "Track Performance" off: plain links and no open picture.
  const track = campaign.options?.track !== false;
  const linkFor = (url: string) => {
    const index = links.findIndex((link) => (link.original ?? link.url) === url);
    if (!track) return index >= 0 ? links[index].url : url;
    return index >= 0 ? trackingUrl("c", send.token, index) : url;
  };
  const opts = {
    firstName: send.name, preheader: campaign.preheader || undefined, brand: sender.brand, footerNote: sender.footerNote,
    unsubscribeUrl: trackingUrl("u", send.token), openPixelUrl: track ? trackingUrl("o", send.token) : undefined, plain: !!campaign.options?.plainText, nowMs,
    loyalty: send.loyalty ?? undefined
  };
  const html = renderEmailHtml(design, { ...opts, linkFor });
  const text = renderEmailText(design, { ...opts, linkFor });
  const rawSubject = send.variant === "b" && campaign.subject_b?.trim() ? campaign.subject_b : campaign.subject;
  const subject = applyTags(send.theirs === undefined ? rawSubject : fillTheirProduct(rawSubject, send.theirs), { firstName: send.name, loyalty: opts.loyalty });
  return { html, text, subject };
}

/** A test email: same HTML, links go straight to their pages, nothing is counted. */
export async function sendTest(orgId: string, branchId: string, campaign: any, emails: string[], senderName: string) {
  const design = normalizeDesign(campaign.design);
  if (!design || !design.blocks.length) throw new EmailMarketingError(400, "The email has no content yet. Add blocks in Design Email first.");
  if (!String(campaign.subject ?? "").trim()) throw new EmailMarketingError(400, "Add an email subject first.");
  const sender = await marketingSender(orgId);
  if (!sender.ready) throw new EmailMarketingError(409, sender.reason ?? "Email sending is not set up.");
  const settings = await settingsFor(orgId, branchId);
  const links = campaignLinks({ slug: campaign.slug ?? "test", options: campaign.options }, design);
  const linkFor = (url: string) => links.find((link) => link.original === url)?.url ?? url;
  const results: Array<{ email: string; ok: boolean; error?: string }> = [];
  for (const email of emails) {
    const html = renderEmailHtml(design, { firstName: senderName, preheader: campaign.preheader || undefined, brand: sender.fromName, footerNote: settings.footerNote, unsubscribeUrl: `${PUBLIC_BACKEND_URL}/e/u/test`, plain: !!campaign.options?.plainText, linkFor });
    const text = renderEmailText(design, { firstName: senderName, unsubscribeUrl: `${PUBLIC_BACKEND_URL}/e/u/test`, linkFor });
    try {
      await sendMarketingEmail(orgId, { to: { email }, subject: `[Test] ${campaign.subject}`, html, text });
      results.push({ email, ok: true });
    } catch (error) {
      results.push({ email, ok: false, error: (error as Error).message });
    }
  }
  return results;
}

/** Queues one run of a campaign: everyone the audience picks, now. */
async function startRun(campaign: any, nowMs: number) {
  const design = normalizeDesign(campaign.design);
  if (!design) throw new Error("no design");
  const world = await loadWorld(campaign.org_id, campaign.branch_id, true);
  const audience = (campaign.audience ?? { source: "all" }) as AudienceChoice;
  const { recipients } = resolveAudience(world.people, audience, world.segments, world.ctx);
  const runNo = (campaign.run_count ?? 0) + 1;
  const rows = assignVariants(recipients.map((person) => ({ email: person.contact!.email, name: person.contact!.name || "", phone: person.contact!.phone, contactId: person.contact!.id })), !!campaign.options?.abTest && !!campaign.subject_b?.trim());
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabase.from("email_campaign_sends").upsert(rows.slice(i, i + 500).map((row) => ({
      org_id: campaign.org_id, branch_id: campaign.branch_id, campaign_id: campaign.id, run_no: runNo, kind: "main",
      contact_id: row.contactId, email: row.email, name: row.name, phone: row.phone, variant: row.variant, token: newToken()
    })), { onConflict: "campaign_id,run_no,kind,email", ignoreDuplicates: true });
    if (error) throw new Error(error.message);
  }
  const next = nextRepeatAt(campaign.delivery as Delivery, nowMs);
  await supabase.from("email_campaigns").update({
    status: "sending", run_count: runNo, audience_count: rows.length, links: campaignLinks(campaign, design),
    next_run_at: next ? new Date(next).toISOString() : null, updated_at: new Date().toISOString()
  }).eq("id", campaign.id).eq("status", "scheduled");
  logger.info("email campaign run queued", { campaignId: campaign.id, runNo, recipients: rows.length });
}

/** Automations: queue everyone who became due since the last check. */
async function feedAutomation(campaign: any, nowMs: number) {
  const design = normalizeDesign(campaign.design);
  if (!design) return 0;
  const world = await loadWorld(campaign.org_id, campaign.branch_id);
  const sent = await fetchAllRowsOrThrow<any>(() => supabase.from("email_campaign_sends").select("email").eq("campaign_id", campaign.id).eq("kind", "main"));
  const already = new Set(sent.map((row) => row.email));
  let due = automationRecipients(campaign.delivery as Delivery, world.people, Date.parse(campaign.launched_at ?? campaign.created_at), nowMs, already);
  // An automation can also be limited to a group (step 2).
  const audience = (campaign.audience ?? { source: "all" }) as AudienceChoice;
  if (audience.source && audience.source !== "all") {
    const allowed = new Set(resolveAudience(world.people, audience, world.segments, world.ctx).recipients.map((person) => person.key));
    due = due.filter((person) => allowed.has(person.key));
  }
  if (!due.length) return 0;
  const { error } = await supabase.from("email_campaign_sends").upsert(due.map((person) => ({
    org_id: campaign.org_id, branch_id: campaign.branch_id, campaign_id: campaign.id, run_no: 1, kind: "main",
    contact_id: person.contact!.id, email: person.contact!.email, name: person.contact!.name || "", phone: person.contact!.phone, variant: "a", token: newToken()
  })), { onConflict: "campaign_id,run_no,kind,email", ignoreDuplicates: true });
  if (error) throw new Error(error.message);
  if (!(campaign.links ?? []).length) await supabase.from("email_campaigns").update({ links: campaignLinks(campaign, design) }).eq("id", campaign.id);
  return due.length;
}

/** "Resend to non-openers": once per run, after the chosen hours. */
async function queueResends(campaign: any, nowMs: number) {
  const hours = Math.min(168, Math.max(6, Number(campaign.options?.resendHours) || 48));
  const { data: done } = await supabase.from("email_campaign_sends").select("id").eq("campaign_id", campaign.id).eq("run_no", campaign.run_count).eq("kind", "resend").limit(1);
  if ((done ?? []).length) return 0;
  const { count: waiting } = await supabase.from("email_campaign_sends").select("id", { count: "exact", head: true }).eq("campaign_id", campaign.id).eq("run_no", campaign.run_count).eq("status", "queued");
  if (waiting) return 0;
  const { data: last } = await supabase.from("email_campaign_sends").select("sent_at").eq("campaign_id", campaign.id).eq("run_no", campaign.run_count).eq("kind", "main").not("sent_at", "is", null).order("sent_at", { ascending: false }).limit(1);
  const lastSent = last?.[0]?.sent_at ? Date.parse(last[0].sent_at) : null;
  if (!lastSent || nowMs - lastSent < hours * 3_600_000) return 0;
  const rows = await fetchAllRowsOrThrow<any>(() => supabase.from("email_campaign_sends").select("contact_id, email, name, phone, variant")
    .eq("campaign_id", campaign.id).eq("run_no", campaign.run_count).eq("kind", "main").eq("status", "sent").is("first_opened_at", null).is("first_clicked_at", null).is("unsubscribed_at", null));
  if (!rows.length) {
    // Nothing to resend: leave a marker row-free note by touching updated_at only.
    return 0;
  }
  const { error } = await supabase.from("email_campaign_sends").upsert(rows.map((row) => ({
    org_id: campaign.org_id, branch_id: campaign.branch_id, campaign_id: campaign.id, run_no: campaign.run_count, kind: "resend",
    contact_id: row.contact_id, email: row.email, name: row.name, phone: row.phone, variant: row.variant, token: newToken()
  })), { onConflict: "campaign_id,run_no,kind,email", ignoreDuplicates: true });
  if (error) throw new Error(error.message);
  await supabase.from("email_campaigns").update({ status: "sending", updated_at: new Date().toISOString() }).eq("id", campaign.id).in("status", ["completed", "sending"]);
  return rows.length;
}

const PER_MINUTE = 40;

/** Sends what is queued, within each branch's daily limit. */
async function sendQueued(nowMs: number) {
  const queued = await supabase.from("email_campaign_sends").select("id, org_id, branch_id, campaign_id, contact_id, email, name, phone, variant, token")
    .eq("status", "queued").order("queued_at", { ascending: true }).limit(PER_MINUTE);
  if (queued.error) throw new Error(queued.error.message);
  const rows = queued.data ?? [];
  if (!rows.length) return 0;
  const campaigns = new Map<string, any>();
  const senders = new Map<string, { ready: boolean; brand: string; reason?: string }>();
  const allowance = new Map<string, number>();
  const footers = new Map<string, string>();
  const productCache = new Map<string, Promise<Awaited<ReturnType<typeof productsForDesigner>>>>();
  const dayStart = new Date(Date.parse(`${lagosDay(nowMs)}T00:00:00+01:00`)).toISOString();
  let sentCount = 0;
  for (const row of rows) {
    if (!senders.has(row.org_id)) {
      const sender = await marketingSender(row.org_id);
      senders.set(row.org_id, { ready: sender.ready, brand: sender.fromName, reason: sender.reason });
    }
    const sender = senders.get(row.org_id)!;
    if (!sender.ready) continue;
    if (!allowance.has(row.branch_id)) {
      const settings = await settingsFor(row.org_id, row.branch_id);
      const { count } = await supabase.from("email_campaign_sends").select("id", { count: "exact", head: true }).eq("branch_id", row.branch_id).eq("status", "sent").gte("sent_at", dayStart);
      allowance.set(row.branch_id, Math.max(0, settings.dailyLimit - (count ?? 0)));
      footers.set(row.branch_id, settings.footerNote);
    }
    if ((allowance.get(row.branch_id) ?? 0) <= 0) continue;
    if (!campaigns.has(row.campaign_id)) {
      const { data } = await supabase.from("email_campaigns").select("id, status, subject, subject_b, preheader, design, options, slug").eq("id", row.campaign_id).maybeSingle();
      campaigns.set(row.campaign_id, data);
    }
    const campaign = campaigns.get(row.campaign_id);
    // Paused or cancelled campaigns keep their queue until resumed.
    if (!campaign || !["sending", "active"].includes(campaign.status)) continue;
    // Automation emails wait for their sending hours (a daily limit can push one past them).
    const window = campaign.options?.sendWindow;
    if (window?.on && Array.isArray(window.days) && !inSendWindow(nowMs, window)) continue;
    const contact = row.contact_id ? await supabase.from("email_contacts").select("status").eq("id", row.contact_id).maybeSingle() : { data: { status: "subscribed" } };
    if (contact.data?.status !== "subscribed") {
      await supabase.from("email_campaign_sends").update({ status: "skipped", error: "Unsubscribed before sending" }).eq("id", row.id).eq("status", "queued");
      continue;
    }
    const design = normalizeDesign(campaign.design);
    if (!design) continue;
    // {{Points}}, {{Level}}, {{Voucher}}: the member is looked up only when the email uses one (Loyalty & Rewards).
    const loyalty = usesLoyaltyTags(`${JSON.stringify(campaign.design)} ${campaign.subject ?? ""} ${campaign.subject_b ?? ""}`)
      ? await (await import("./loyalty.js")).loyaltyTagsFor(row.org_id, row.branch_id, row.phone)
      : null;
    // "Their product": the product of this customer's latest order, looked up only when the email asks for it.
    const theirs = usesTheirProduct(design, `${campaign.subject ?? ""} ${campaign.subject_b ?? ""}`)
      ? await theirProductFor(row.org_id, row.branch_id, row.phone, campaign, productCache)
      : undefined;
    const { html, text, subject } = renderForSend(campaign, design, { ...row, loyalty, theirs }, { brand: sender.brand, footerNote: footers.get(row.branch_id) ?? "" }, nowMs);
    try {
      const result = await sendMarketingEmail(row.org_id, { to: { email: row.email, name: row.name || undefined }, subject, html, text, unsubscribeUrl: trackingUrl("u", row.token), customId: row.token, replyTo: campaign.options?.replyTo || undefined });
      const at = new Date().toISOString();
      await supabase.from("email_campaign_sends").update({ status: "sent", sent_at: at, provider: result.provider, provider_message_id: result.messageId ?? null, error: null }).eq("id", row.id);
      if (row.contact_id) await supabase.from("email_contacts").update({ last_emailed_at: at }).eq("id", row.contact_id);
      allowance.set(row.branch_id, (allowance.get(row.branch_id) ?? 1) - 1);
      sentCount += 1;
    } catch (error) {
      const message = (error as Error).message || "Send failed";
      const quota = (error as any)?.quotaLike;
      if (quota) { allowance.set(row.branch_id, 0); continue; }
      await supabase.from("email_campaign_sends").update({ status: "failed", error: message.slice(0, 300) }).eq("id", row.id);
    }
  }
  return sentCount;
}

const naira = (n: number) => `₦${Math.round(n).toLocaleString("en-NG")}`;

/** The product of this phone's latest order, with its photo, price and order page (links carry the email's utm tags). */
export async function theirProductFor(orgId: string, branchId: string, phone: unknown, campaign: any, cache: Map<string, Promise<Awaited<ReturnType<typeof productsForDesigner>>>>): Promise<TheirProduct | null> {
  const key = phoneKey(phone);
  if (!key) return null;
  const { data } = await supabase.from("orders").select("product_id, phone, created_at")
    // launch-safe: Silent Test orders are test orders; marketing never uses them.
    .eq("org_id", orgId).eq("branch_id", branchId).neq("launch_stage", "silent").not("product_id", "is", null)
    .ilike("phone", `%${key.slice(-10)}`).order("created_at", { ascending: false }).limit(5);
  const order = (data ?? []).find((row) => phoneKey(row.phone) === key);
  if (!order) return null;
  if (!cache.has(branchId)) cache.set(branchId, productsForDesigner(orgId, branchId));
  const product = (await cache.get(branchId)!).find((row) => row.id === order.product_id);
  if (!product) return null;
  const page = product.links[0]?.url ?? "";
  const price = product.priceMin === null ? "" : product.priceMax !== null && product.priceMax > product.priceMin ? `From ${naira(product.priceMin)}` : naira(product.priceMin);
  return {
    name: product.name, price, imageUrl: product.image,
    link: page && campaign.options?.utm !== false ? withUtm(page, { utm_source: "email", utm_medium: "email", utm_campaign: campaign.slug }) : page
  };
}

/** Runs whose queue is empty: completed, or back to waiting for the next repeat. */
async function closeFinishedRuns() {
  const { data } = await supabase.from("email_campaigns").select("id, status, next_run_at, delivery").eq("status", "sending");
  for (const campaign of data ?? []) {
    const { count } = await supabase.from("email_campaign_sends").select("id", { count: "exact", head: true }).eq("campaign_id", campaign.id).eq("status", "queued");
    if (count) continue;
    const repeat = (campaign.delivery as Delivery)?.type === "recurring" && campaign.next_run_at;
    await supabase.from("email_campaigns").update(repeat
      ? { status: "scheduled", updated_at: new Date().toISOString() }
      : { status: "completed", completed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", campaign.id).eq("status", "sending");
  }
}

/** Orders that came from an email: the utm tags name the campaign and the person. */
export async function attributeOrders(nowMs: number) {
  const since = new Date(nowMs - 37 * DAY_MS).toISOString();
  const { data: campaigns } = await supabase.from("email_campaigns").select("id, org_id, branch_id, slug").in("status", ["sending", "active", "completed", "scheduled", "paused"]);
  const byOrg = new Map<string, any[]>();
  for (const row of campaigns ?? []) byOrg.set(`${row.org_id}|${row.branch_id}`, [...(byOrg.get(`${row.org_id}|${row.branch_id}`) ?? []), row]);
  let matched = 0;
  for (const [key, list] of byOrg) {
    const [orgId, branchId] = key.split("|");
    const slugs = new Map(list.map((row) => [row.slug, row.id]));
    const orders = await fetchAllRowsOrThrow<any>(() => supabase.from("orders").select("id, phone, email, created_at, utm_source, utm_campaign, utm_content")
      // launch-safe: Silent Test orders are left out of email results.
      .eq("org_id", orgId).eq("branch_id", branchId).neq("launch_stage", "silent").gte("created_at", since).order("created_at", { ascending: true }));
    const { data: used } = await supabase.from("email_campaign_sends").select("order_id").eq("org_id", orgId).eq("branch_id", branchId).not("order_id", "is", null).gte("queued_at", since);
    const taken = new Set((used ?? []).map((row) => row.order_id));
    // 1) Exact: the link carried the campaign and this person's token.
    for (const order of orders) {
      if (taken.has(order.id) || order.utm_source !== "email" || !slugs.has(order.utm_campaign)) continue;
      const token = String(order.utm_content ?? "");
      if (!token) continue;
      const { data: send } = await supabase.from("email_campaign_sends").select("id, order_id").eq("token", token).eq("campaign_id", slugs.get(order.utm_campaign)).maybeSingle();
      if (!send || send.order_id) continue;
      await supabase.from("email_campaign_sends").update({ order_id: order.id, converted_at: order.created_at }).eq("id", send.id).is("order_id", null);
      taken.add(order.id);
      matched += 1;
    }
    // 2) Same phone or email within 7 days of clicking, when the tags were lost.
    const clicked = await fetchAllRowsOrThrow<any>(() => supabase.from("email_campaign_sends").select("id, phone, email, first_clicked_at")
      .eq("org_id", orgId).eq("branch_id", branchId).is("order_id", null).not("first_clicked_at", "is", null).gte("first_clicked_at", new Date(nowMs - 8 * DAY_MS).toISOString()));
    for (const send of clicked) {
      const clickMs = Date.parse(send.first_clicked_at);
      const phone = phoneKey(send.phone);
      const order = orders.find((row) => !taken.has(row.id) && Date.parse(row.created_at) >= clickMs && Date.parse(row.created_at) - clickMs <= 7 * DAY_MS
        && ((phone && phoneKey(row.phone) === phone) || (cleanEmail(row.email) && cleanEmail(row.email) === send.email)));
      if (!order) continue;
      await supabase.from("email_campaign_sends").update({ order_id: order.id, converted_at: order.created_at }).eq("id", send.id).is("order_id", null);
      taken.add(order.id);
      matched += 1;
    }
  }
  return matched;
}

let jobRunning = false;
let lastSyncMs = 0;
let lastAttributionMs = 0;

/** Every minute: copy new emails in, start due campaigns, feed automations, send, count orders. */
export async function runEmailMarketingJob() {
  if (jobRunning) return;
  jobRunning = true;
  const nowMs = Date.now();
  try {
    if (nowMs - lastSyncMs >= 5 * 60_000) {
      lastSyncMs = nowMs;
      const { data: orgs } = await supabase.from("organizations").select("id");
      for (const org of orgs ?? []) {
        try { await syncContacts(org.id); } catch (error) { logger.warn("email contacts sync failed", { orgId: org.id, error: (error as Error).message }); }
      }
    }
    const { data: due } = await supabase.from("email_campaigns").select("*").eq("status", "scheduled").lte("next_run_at", new Date(nowMs).toISOString()).limit(10);
    for (const campaign of due ?? []) {
      try { await startRun(campaign, nowMs); } catch (error) { logger.error("email campaign start failed", { campaignId: campaign.id, error: (error as Error).message }); }
    }
    const { data: active } = await supabase.from("email_campaigns").select("*").eq("status", "active").is("automation_id", null).limit(50);
    for (const campaign of active ?? []) {
      try { await feedAutomation(campaign, nowMs); } catch (error) { logger.error("email automation feed failed", { campaignId: campaign.id, error: (error as Error).message }); }
    }
    const { data: resend } = await supabase.from("email_campaigns").select("id, org_id, branch_id, run_count, options, status").in("status", ["sending", "completed", "scheduled"]).eq("options->>resendNonOpeners", "true").gte("updated_at", new Date(nowMs - 10 * DAY_MS).toISOString()).limit(20);
    for (const campaign of resend ?? []) {
      if (!campaign.run_count) continue;
      try { await queueResends(campaign, nowMs); } catch (error) { logger.error("email resend failed", { campaignId: campaign.id, error: (error as Error).message }); }
    }
    await sendQueued(nowMs);
    await closeFinishedRuns();
    if (nowMs - lastAttributionMs >= 10 * 60_000) {
      lastAttributionMs = nowMs;
      await attributeOrders(nowMs);
    }
  } catch (error) {
    logger.error("email marketing job crashed", { error: (error as Error).message });
  } finally {
    jobRunning = false;
  }
}

// ── Opens, clicks, unsubscribes (public, from the email) ─────────────

export async function recordOpen(token: string) {
  const { data: send } = await supabase.from("email_campaign_sends").select("id, contact_id, first_opened_at, open_count").eq("token", token).maybeSingle();
  if (!send) return;
  const at = new Date().toISOString();
  await supabase.from("email_campaign_sends").update({ open_count: (send.open_count ?? 0) + 1, ...(send.first_opened_at ? {} : { first_opened_at: at }) }).eq("id", send.id);
  if (send.contact_id) await supabase.from("email_contacts").update({ last_opened_at: at }).eq("id", send.contact_id);
}

/** The page a click goes to (null = unknown link). */
export async function recordClick(token: string, index: number): Promise<string | null> {
  const { data: send } = await supabase.from("email_campaign_sends").select("id, org_id, branch_id, campaign_id, contact_id, first_opened_at, first_clicked_at, click_count").eq("token", token).maybeSingle();
  if (!send) return null;
  const { data: campaign } = await supabase.from("email_campaigns").select("links, options").eq("id", send.campaign_id).maybeSingle();
  const link = Array.isArray(campaign?.links) ? (campaign!.links as Array<{ url: string }>)[index] : null;
  if (!link?.url) return null;
  const at = new Date().toISOString();
  await supabase.from("email_campaign_sends").update({
    click_count: (send.click_count ?? 0) + 1,
    ...(send.first_clicked_at ? {} : { first_clicked_at: at }),
    // A click proves the email was opened even when the picture was blocked.
    ...(send.first_opened_at ? {} : { first_opened_at: at })
  }).eq("id", send.id);
  await supabase.from("email_campaign_clicks").insert({ org_id: send.org_id, branch_id: send.branch_id, campaign_id: send.campaign_id, send_id: send.id, link_index: index });
  if (send.contact_id) await supabase.from("email_contacts").update({ last_clicked_at: at, ...(send.first_opened_at ? {} : { last_opened_at: at }) }).eq("id", send.contact_id);
  return campaign?.options?.utm !== false ? withUtm(link.url, { utm_content: token }) : link.url;
}

export async function unsubscribeToken(token: string): Promise<{ email: string } | null> {
  const { data: send } = await supabase.from("email_campaign_sends").select("id, contact_id, email, branch_id").eq("token", token).maybeSingle();
  if (!send) return null;
  const at = new Date().toISOString();
  await supabase.from("email_campaign_sends").update({ unsubscribed_at: at }).eq("id", send.id).is("unsubscribed_at", null);
  if (send.contact_id) {
    await supabase.from("email_contacts").update({ status: "unsubscribed", status_changed_at: at, status_reason: "Clicked unsubscribe", updated_at: at }).eq("id", send.contact_id).eq("status", "subscribed");
  }
  // Stop anything still waiting for this person in any campaign.
  await supabase.from("email_campaign_sends").update({ status: "skipped", error: "Unsubscribed before sending" }).eq("branch_id", send.branch_id).eq("email", send.email).eq("status", "queued");
  forgetWorld(send.branch_id);
  return { email: send.email };
}

export { AUTOMATION_PRESETS, JOURNEY_STAGES, QUICK_SEGMENTS };

// ── Tags, custom fields, editing a person ────────────────────────────

const TAG_COLORS = ["purple", "amber", "green", "blue", "red", "orange", "pink", "slate"];
const TAG_ICONS = ["tag", "crown", "star", "trend", "cart", "pin", "ban", "calendar", "sparkles", "gift", "heart"];

export async function createTag(orgId: string, branchId: string, user: { id: string; name?: string | null }, input: { name: string; color?: string; icon?: string; description?: string }) {
  const name = input.name.trim().slice(0, 40);
  if (!name) throw new EmailMarketingError(400, "Give the tag a name.");
  const { data, error } = await supabase.from("email_tags").insert({
    org_id: orgId, branch_id: branchId, name, kind: "custom", color: TAG_COLORS.includes(input.color ?? "") ? input.color : "purple",
    icon: TAG_ICONS.includes(input.icon ?? "") ? input.icon : "tag", description: (input.description ?? "").trim().slice(0, 200), created_by: user.id, created_by_name: user.name ?? ""
  }).select("id").single();
  if (error) throw error.code === "23505" ? new EmailMarketingError(409, "A tag with that name already exists.") : new Error(error.message);
  forgetWorld(branchId);
  return data.id as string;
}

export async function updateTag(orgId: string, branchId: string, tagId: string, input: { name?: string; color?: string; icon?: string; description?: string; status?: "active" | "archived" }) {
  const { data: tag } = await supabase.from("email_tags").select("kind").eq("org_id", orgId).eq("branch_id", branchId).eq("id", tagId).maybeSingle();
  if (!tag) throw new EmailMarketingError(404, "Tag not found.");
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  // A system tag keeps its name: its rule is what the name says.
  if (input.name !== undefined && tag.kind === "custom") { const name = input.name.trim().slice(0, 40); if (!name) throw new EmailMarketingError(400, "Give the tag a name."); patch.name = name; }
  if (input.color !== undefined && TAG_COLORS.includes(input.color)) patch.color = input.color;
  if (input.icon !== undefined && TAG_ICONS.includes(input.icon)) patch.icon = input.icon;
  if (input.description !== undefined) patch.description = input.description.trim().slice(0, 200);
  if (input.status !== undefined) patch.status = input.status;
  const { error } = await supabase.from("email_tags").update(patch).eq("org_id", orgId).eq("branch_id", branchId).eq("id", tagId);
  if (error) throw error.code === "23505" ? new EmailMarketingError(409, "A tag with that name already exists.") : new Error(error.message);
  forgetWorld(branchId);
}

export async function deleteTag(orgId: string, branchId: string, tagId: string) {
  const { data: tag } = await supabase.from("email_tags").select("kind").eq("org_id", orgId).eq("branch_id", branchId).eq("id", tagId).maybeSingle();
  if (!tag) throw new EmailMarketingError(404, "Tag not found.");
  if (tag.kind === "system") throw new EmailMarketingError(409, "A ready-made tag can't be deleted. Archive it instead.");
  const { error } = await supabase.from("email_tags").delete().eq("org_id", orgId).eq("branch_id", branchId).eq("id", tagId);
  if (error) throw new Error(error.message);
  forgetWorld(branchId);
}

/** Put a custom tag on (or take it off) people. */
export async function tagContacts(orgId: string, branchId: string, tagId: string, contactIds: string[], add: boolean) {
  const { data: tag } = await supabase.from("email_tags").select("kind").eq("org_id", orgId).eq("branch_id", branchId).eq("id", tagId).maybeSingle();
  if (!tag) throw new EmailMarketingError(404, "Tag not found.");
  if (tag.kind === "system") throw new EmailMarketingError(409, "Ready-made tags follow their rule; they can't be put on by hand.");
  const ids = [...new Set(contactIds)].slice(0, 20000);
  if (add) {
    for (let i = 0; i < ids.length; i += 500) {
      const { error } = await supabase.from("email_contact_tags").upsert(ids.slice(i, i + 500).map((contactId) => ({ org_id: orgId, branch_id: branchId, contact_id: contactId, tag_id: tagId })), { onConflict: "contact_id,tag_id", ignoreDuplicates: true });
      if (error) throw new Error(error.message);
    }
  } else {
    for (let i = 0; i < ids.length; i += 200) {
      const { error } = await supabase.from("email_contact_tags").delete().eq("org_id", orgId).eq("branch_id", branchId).eq("tag_id", tagId).in("contact_id", ids.slice(i, i + 200));
      if (error) throw new Error(error.message);
    }
  }
  forgetWorld(branchId);
}

export async function updateContact(orgId: string, branchId: string, contactId: string, input: { name?: string; phone?: string; fields?: Record<string, unknown>; tags?: string[] }) {
  const world = await loadWorld(orgId, branchId);
  const contact = world.contacts.find((row) => row.id === contactId);
  if (!contact) throw new EmailMarketingError(404, "That person is not on the list.");
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.name !== undefined) patch.name = input.name.trim().slice(0, 120);
  if (input.phone !== undefined) patch.phone = phoneKey(input.phone) ? input.phone.trim() : null;
  if (input.fields) patch.fields = { ...contact.fields, ...cleanFieldValues(world.fieldRows, input.fields) };
  const { error } = await supabase.from("email_contacts").update(patch).eq("org_id", orgId).eq("branch_id", branchId).eq("id", contactId);
  if (error) throw new Error(error.message);
  if (input.tags) {
    const custom = new Set(world.tagRows.filter((tag) => tag.kind === "custom").map((tag) => tag.id));
    const wanted = new Set(input.tags.filter((id) => custom.has(id)));
    const current = world.contactTags.get(contactId) ?? new Set<string>();
    const add = [...wanted].filter((id) => !current.has(id));
    const remove = [...current].filter((id) => !wanted.has(id));
    if (add.length) {
      const { error: addError } = await supabase.from("email_contact_tags").upsert(add.map((tagId) => ({ org_id: orgId, branch_id: branchId, contact_id: contactId, tag_id: tagId })), { onConflict: "contact_id,tag_id", ignoreDuplicates: true });
      if (addError) throw new Error(addError.message);
    }
    if (remove.length) {
      const { error: removeError } = await supabase.from("email_contact_tags").delete().eq("contact_id", contactId).in("tag_id", remove);
      if (removeError) throw new Error(removeError.message);
    }
  }
  forgetWorld(branchId);
}

const FIELD_TYPES = ["text", "number", "date", "dropdown", "multi"];
const FIELD_ICONS = ["form", "pin", "box", "tag", "naira", "users", "truck", "star", "calendar"];

export async function createField(orgId: string, branchId: string, userId: string, input: { name: string; type: string; options?: string[]; description?: string; required?: boolean; useInForms?: boolean; icon?: string }) {
  const name = input.name.trim().slice(0, 60);
  if (!name) throw new EmailMarketingError(400, "Give the field a name.");
  if (!FIELD_TYPES.includes(input.type)) throw new EmailMarketingError(400, "Pick a field type.");
  const options = [...new Set((input.options ?? []).map((option) => option.trim().slice(0, 60)).filter(Boolean))].slice(0, 50);
  if ((input.type === "dropdown" || input.type === "multi") && options.length < 2) throw new EmailMarketingError(400, "A dropdown needs at least 2 choices.");
  const world = await loadWorld(orgId, branchId);
  let key = fieldKeyFor(name);
  if (world.fieldRows.some((row) => row.key === key)) key = `${key.slice(0, 35)}_${Math.random().toString(36).slice(2, 6)}`;
  const { data, error } = await supabase.from("email_custom_fields").insert({
    org_id: orgId, branch_id: branchId, key, name, type: input.type, options, description: (input.description ?? "").trim().slice(0, 200),
    required: !!input.required, use_in_forms: !!input.useInForms, icon: FIELD_ICONS.includes(input.icon ?? "") ? input.icon : "form", created_by: userId
  }).select("id").single();
  if (error) throw new Error(error.message);
  forgetWorld(branchId);
  return data.id as string;
}

export async function updateField(orgId: string, branchId: string, fieldId: string, input: { name?: string; options?: string[]; description?: string; required?: boolean; useInForms?: boolean; status?: "active" | "inactive"; icon?: string }) {
  const { data: field } = await supabase.from("email_custom_fields").select("system_key, type").eq("org_id", orgId).eq("branch_id", branchId).eq("id", fieldId).maybeSingle();
  if (!field) throw new EmailMarketingError(404, "Field not found.");
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  // Ready-made fields are filled from orders: their name and choices stay.
  if (!field.system_key) {
    if (input.name !== undefined) { const name = input.name.trim().slice(0, 60); if (!name) throw new EmailMarketingError(400, "Give the field a name."); patch.name = name; }
    if (input.options !== undefined && (field.type === "dropdown" || field.type === "multi")) {
      const options = [...new Set(input.options.map((option) => option.trim().slice(0, 60)).filter(Boolean))].slice(0, 50);
      if (options.length < 2) throw new EmailMarketingError(400, "A dropdown needs at least 2 choices.");
      patch.options = options;
    }
    if (input.icon !== undefined && FIELD_ICONS.includes(input.icon)) patch.icon = input.icon;
  }
  if (input.description !== undefined) patch.description = input.description.trim().slice(0, 200);
  if (input.required !== undefined) patch.required = input.required;
  if (input.useInForms !== undefined) patch.use_in_forms = input.useInForms;
  if (input.status !== undefined) patch.status = input.status;
  const { error } = await supabase.from("email_custom_fields").update(patch).eq("org_id", orgId).eq("branch_id", branchId).eq("id", fieldId);
  if (error) throw new Error(error.message);
  forgetWorld(branchId);
}

export async function deleteField(orgId: string, branchId: string, fieldId: string) {
  const { data: field } = await supabase.from("email_custom_fields").select("system_key").eq("org_id", orgId).eq("branch_id", branchId).eq("id", fieldId).maybeSingle();
  if (!field) throw new EmailMarketingError(404, "Field not found.");
  if (field.system_key) throw new EmailMarketingError(409, "A ready-made field can't be deleted. Switch it off instead.");
  const { error } = await supabase.from("email_custom_fields").delete().eq("org_id", orgId).eq("branch_id", branchId).eq("id", fieldId);
  if (error) throw new Error(error.message);
  forgetWorld(branchId);
}

/** Static segment: the people who match right now, kept as a fixed list. */
export async function membersNow(orgId: string, branchId: string, rule: SegmentRule) {
  const world = await loadWorld(orgId, branchId, true);
  return world.people.filter((person) => person.contact && segmentMatches(person, rule, world.ctx)).map((person) => person.contact!.id);
}

/** Create Segment's live preview (image D): count, share and money of the matches. */
export async function segmentPreviewFull(orgId: string, branchId: string, rule: SegmentRule) {
  const world = await loadWorld(orgId, branchId);
  const members = world.people.filter((person) => segmentMatches(person, rule, world.ctx));
  const buyers = members.filter((person) => (person.stats?.deliveredCount ?? 0) > 0);
  const orders = buyers.reduce((sum, person) => sum + person.stats!.deliveredCount, 0);
  const money = buyers.reduce((sum, person) => sum + person.stats!.deliveredTotal, 0);
  const listed = members.filter((person) => person.contact);
  return {
    size: listed.filter((person) => person.contact!.status === "subscribed").length,
    contacts: listed.length,
    customers: members.length,
    withoutEmail: members.filter((person) => !person.contact).length,
    totalAudience: world.contacts.length,
    percentOfAudience: world.contacts.length ? Math.round((listed.length / world.contacts.length) * 1000) / 10 : 0,
    avgOrders: buyers.length ? Math.round((orders / buyers.length) * 10) / 10 : 0,
    avgOrderValue: orders ? Math.round(money / orders) : 0,
    totalValue: Math.round(money)
  };
}
