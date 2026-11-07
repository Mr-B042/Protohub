import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { supabase } from "../lib/supabase.js";
import { requireAuth, scopeOf } from "../middleware/auth.js";
import { humanFieldErrors } from "../lib/validation-message.js";
import { canApproveMedia, canSendMedia } from "../lib/media-safety.js";
import { HOLD, PUBLIC, approveRow, approverRecipients, holdingPreviews, notify, removeFiles } from "./product-media.js";
import {
  LEVEL_LABEL, REJECT_REASONS, REVIEW_CHANNELS, REVIEW_LEVELS, REVIEW_TYPES, amountFor, cleanAmounts, filesProblem, isRejectReason,
  lagosDay, levelRank, levelsFor, reviewProblem, topUp, weekStartOf, type ReviewLevel, type ReviewType
} from "../lib/customer-review-rules.js";
import { readAmounts, saveAmounts } from "../lib/customer-reviews.js";
import { silentFilterFor } from "../lib/product-launch.js";

// ── Customer Reviews, part 1 (Bright, 7 Nov 2026) ──────────────────────────
// A rep sends a customer's review from the Upload media window, linked to one
// of their own delivered orders, with two separate ticks: the customer
// confirmed it is their real experience (needed), and the customer allowed us
// to use it for marketing (optional, never pre-ticked). An Owner, Admin or
// Manager approves it at a level; the order's rep is paid once per order at
// the highest level approved (approve_customer_review, migration 329), in the
// weekly report of the week it was approved. Without marketing permission
// the files stay private: never in the public gallery.

const router = Router();
router.use(requireAuth);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (status: number, message: string) => Object.assign(new Error(message), { status });
function sendError(res: Response, error: any, fallback: string) {
  const status = Number(error?.status) || 500;
  if (status >= 500) console.warn("[customer-reviews]", error?.message ?? error);
  res.status(status).json({ error: status >= 500 ? fallback : error.message });
}
const orgOf = (req: Request) => req.user!.orgId;
const realRole = (req: Request) => String(req.user!.role ?? "");
/** Approvers see everyone's reviews; under "View as" a rep, the rep's own. */
const seesAll = (req: Request) => canApproveMedia(scopeOf(req).role) && canApproveMedia(realRole(req));
const requireApprover = (req: Request) => {
  if (!canApproveMedia(realRole(req))) throw fail(403, "Only an Owner, Admin or Manager can decide customer reviews.");
};

const ORDER_COLUMNS = "id, customer, phone, product_name, product_id, delivered_date, assigned_rep_id, status, branch_id";
const FILE_COLUMNS = "id, review_id, review_part, kind, status, original_name, width, height, duration_seconds, holding_path, holding_thumb_path, public_path, public_thumb_path, url, thumb_url, fingerprint, product_id, org_id, mime, uploaded_by, uploaded_by_name, created_at";
const CHANNEL_TEXT: Record<string, string> = { whatsapp: "WhatsApp", call: "Phone call", sms: "SMS", in_person: "In person", other: "Other" };

const chunk = <T,>(list: T[], size = 150) => Array.from({ length: Math.ceil(list.length / size) }, (_, index) => list.slice(index * size, index * size + size));
const dayOf = (value: unknown) => (value ? String(value).slice(0, 10) : null);

/** The reviews' orders. A Silent Test order is only ever shown to the Owner, so its review is hidden too. */
async function ordersById(ids: string[], scopeRole: string) {
  const out = new Map<string, any>();
  for (const part of chunk(Array.from(new Set(ids)))) {
    if (!part.length) continue;
    const { data, error } = await supabase.from("orders").select(ORDER_COLUMNS).in("id", part).neq("launch_stage", silentFilterFor(scopeRole));
    if (error) throw error;
    for (const row of data ?? []) out.set(String(row.id), row);
  }
  return out;
}

async function filesByReview(reviewIds: string[]) {
  const rows: any[] = [];
  for (const part of chunk(reviewIds)) {
    if (!part.length) continue;
    const { data, error } = await supabase.from("product_media").select(FILE_COLUMNS).in("review_id", part).order("created_at");
    if (error) throw error;
    rows.push(...(data ?? []));
  }
  const previews = await holdingPreviews(rows);
  const out = new Map<string, any[]>();
  for (const row of rows) {
    const list = out.get(row.review_id) ?? [];
    const isPublic = row.status === "approved" && row.url;
    list.push({
      id: row.id, kind: row.kind, part: row.review_part ?? "content", status: row.status, name: row.original_name ?? "",
      width: row.width ?? null, height: row.height ?? null, durationSeconds: row.duration_seconds === null ? null : Number(row.duration_seconds),
      url: isPublic ? row.url : previews.get(row.holding_path) ?? null,
      thumbUrl: isPublic ? row.thumb_url : previews.get(row.holding_thumb_path) ?? (row.kind === "image" ? previews.get(row.holding_path) ?? null : null),
      isPublic: !!isPublic, fingerprint: row.fingerprint ?? null
    });
    out.set(row.review_id, list);
  }
  return { byReview: out, raw: rows };
}

async function ledgerFor(orderIds: string[]) {
  const rows: any[] = [];
  for (const part of chunk(Array.from(new Set(orderIds)))) {
    if (!part.length) continue;
    const { data, error } = await supabase.from("customer_review_incentives")
      .select("id, review_id, order_id, rep_id, rep_name, kind, level, level_total, amount, pay_week_start, approved_by_name, created_at").in("order_id", part).order("created_at");
    if (error) throw error;
    rows.push(...(data ?? []));
  }
  return rows;
}

/** One review as the screens need it. The phone only for approvers and the order's own rep. */
function mapReview(row: any, ctx: { orders: Map<string, any>; files: Map<string, any[]>; ledger: any[]; viewerId: string; approver: boolean }) {
  const order = ctx.orders.get(String(row.order_id));
  const paidForReview = ctx.ledger.filter((item) => item.review_id === row.id).reduce((sum, item) => sum + Number(item.amount ?? 0), 0);
  const paidForOrder = ctx.ledger.filter((item) => item.order_id === row.order_id).reduce((sum, item) => sum + Number(item.amount ?? 0), 0);
  const ownCustomer = order?.assigned_rep_id === ctx.viewerId || row.submitted_by === ctx.viewerId;
  return {
    id: row.id, orderId: String(row.order_id), productId: row.product_id ?? null,
    productName: order?.product_name ?? "", customer: order?.customer ?? "", phone: ctx.approver || ownCustomer ? order?.phone ?? "" : "",
    deliveredOn: dayOf(order?.delivered_date), orderStatus: order?.status ?? null,
    repId: row.rep_id ?? null, repName: row.rep_name ?? "", submittedById: row.submitted_by ?? null, submittedByName: row.submitted_by_name ?? "",
    status: row.status, type: row.review_type as ReviewType, approvedLevel: (row.approved_level ?? null) as ReviewLevel | null,
    levelAmount: Number(row.level_amount ?? 0),
    text: row.review_text ?? "", rating: row.rating ?? null, channel: row.channel, channelText: CHANNEL_TEXT[row.channel] ?? "Other",
    receivedOn: dayOf(row.received_on), complaint: row.complaint ?? "",
    genuine: row.genuine_confirmed, marketingOk: row.marketing_ok === true, marketingWithdrawnAt: row.marketing_withdrawn_at ?? null,
    reviewedByName: row.reviewed_by_name ?? null, reviewedAt: row.reviewed_at ?? null,
    decisionReason: row.decision_reason ?? null, decisionReasonText: row.decision_reason ? (REJECT_REASONS as Record<string, string>)[row.decision_reason] ?? "Other" : null,
    decisionNote: row.decision_note ?? null,
    legacy: !!row.legacy_touchpoint_id, submittedAt: row.submitted_at ?? null, createdAt: row.created_at,
    files: ctx.files.get(row.id) ?? [],
    bonus: { paidForReview: Math.round(paidForReview), paidForOrder: Math.round(paidForOrder) }
  };
}

async function loadReview(req: Request, id = String(req.params.id)) {
  if (!UUID.test(id)) throw fail(404, "That review was not found.");
  const { data, error } = await supabase.from("customer_reviews").select("*").eq("org_id", orgOf(req)).eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) throw fail(404, "That review was not found.");
  // Reps only ever reach their own.
  const me = scopeOf(req).id;
  if (!seesAll(req) && data.rep_id !== me && data.submitted_by !== me) throw fail(404, "That review was not found.");
  return data;
}

async function logEvent(row: any, req: Request | null, event: { action: string; from?: string | null; to?: string | null; amount?: number; note?: string }) {
  const { error } = await supabase.from("customer_review_events").insert({
    org_id: row.org_id, branch_id: row.branch_id, review_id: row.id, order_id: row.order_id, action: event.action,
    from_status: event.from ?? null, to_status: event.to ?? null, amount_change: event.amount ?? 0, note: (event.note ?? "").slice(0, 500),
    actor_id: req?.user?.id ?? null, actor_name: req?.user?.name ?? "Protohub"
  });
  if (error) console.warn("[customer-reviews] event insert failed:", error.message);
}

/** The rep (and whoever sent it, if someone else) hear about a decision. */
async function tellRep(req: Request, row: any, title: string, message: string) {
  const ids = Array.from(new Set([row.rep_id, row.submitted_by].filter((id) => id && id !== req.user!.id)));
  if (!ids.length) return;
  const { data } = await supabase.from("users").select("id, role").in("id", ids);
  await notify(row.org_id, row.branch_id, (data ?? []).map((user: any) => ({ id: String(user.id), role: String(user.role) })), title, message, `review-${row.id}`);
}

// ── Bonus amounts ─────────────────────────────────────────
router.get("/settings", async (req, res) => {
  try {
    res.json({ amounts: await readAmounts(orgOf(req)), canEdit: ["Owner", "Admin"].includes(realRole(req)), reasons: REJECT_REASONS });
  } catch (error) { sendError(res, error, "Could not load the review settings."); }
});

router.put("/settings", async (req, res) => {
  try {
    if (!["Owner", "Admin"].includes(realRole(req))) throw fail(403, "Only the Owner or an Admin can change the review bonus.");
    const amounts = cleanAmounts(req.body?.amounts ?? req.body);
    await saveAmounts(orgOf(req), amounts, { id: req.user!.id, name: req.user!.name ?? null });
    res.json({ amounts });
  } catch (error) { sendError(res, error, "Could not save the review bonus."); }
});

// ── Delivered orders to choose from ───────────────────────
router.get("/orders", async (req, res) => {
  try {
    const me = scopeOf(req);
    const approver = seesAll(req);
    const q = String(req.query.q ?? "").replace(/[%,()*"\\]/g, " ").trim().slice(0, 60);
    let query = supabase.from("orders").select(ORDER_COLUMNS).eq("org_id", orgOf(req)).eq("status", "Delivered").neq("launch_stage", silentFilterFor(me.role))
      .order("delivered_date", { ascending: false, nullsFirst: false }).limit(20);
    if (!approver) query = query.eq("assigned_rep_id", me.id);
    if (q) {
      const digits = q.replace(/\D/g, "");
      const parts = [`id.ilike.%${q}%`, `customer.ilike.%${q}%`];
      if (digits.length >= 4) parts.push(`phone.ilike.%${digits.slice(-9)}%`);
      query = query.or(parts.join(","));
    }
    const { data, error } = await query;
    if (error) throw error;
    const orders = data ?? [];
    const ids = orders.map((row: any) => String(row.id));
    const [reviews, ledger] = await Promise.all([
      ids.length ? supabase.from("customer_reviews").select("order_id, status, approved_level, level_amount, legacy_touchpoint_id").in("order_id", ids).neq("status", "draft") : Promise.resolve({ data: [], error: null } as any),
      ledgerFor(ids)
    ]);
    if (reviews.error) throw reviews.error;
    const repIds = Array.from(new Set(orders.map((row: any) => row.assigned_rep_id).filter(Boolean)));
    const { data: reps } = repIds.length ? await supabase.from("users").select("id, name").in("id", repIds) : { data: [] as any[] };
    const repName = new Map((reps ?? []).map((user: any) => [String(user.id), String(user.name ?? "")]));
    res.json({
      orders: orders.map((row: any) => {
        const own = (reviews.data ?? []).filter((review: any) => review.order_id === row.id);
        const best = own.filter((review: any) => review.status === "approved").sort((a: any, b: any) => levelRank(b.approved_level) - levelRank(a.approved_level))[0];
        return {
          id: String(row.id), customer: row.customer ?? "", phone: row.phone ?? "", productName: row.product_name ?? "", productId: row.product_id ?? null,
          deliveredOn: dayOf(row.delivered_date), repId: row.assigned_rep_id ?? null, repName: repName.get(String(row.assigned_rep_id)) ?? "",
          waiting: own.some((review: any) => review.status === "pending"),
          approvedLevel: best?.approved_level ?? null,
          paid: Math.round(ledger.filter((item) => item.order_id === row.id).reduce((sum, item) => sum + Number(item.amount ?? 0), 0))
        };
      })
    });
  } catch (error) { sendError(res, error, "Could not load your delivered orders."); }
});

// ── Start a review (files follow, then /submit) ───────────
const CreateSchema = z.object({
  orderId: z.string().min(1).max(80),
  type: z.enum(REVIEW_TYPES),
  text: z.string().max(2000).default(""),
  rating: z.number().int().min(1).max(5).nullable().optional(),
  channel: z.enum(REVIEW_CHANNELS).default("whatsapp"),
  receivedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  complaint: z.string().max(1000).default(""),
  genuine: z.boolean(),
  marketing: z.boolean().default(false)
});

router.post("/", async (req, res) => {
  try {
    const parsed = CreateSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: humanFieldErrors(parsed.error) }); return; }
    const body = parsed.data;
    const orgId = orgOf(req);
    const role = realRole(req);
    if (!canSendMedia(role)) throw fail(403, "Your role cannot send customer reviews.");
    const approver = canApproveMedia(role);
    const { data: order, error: orderError } = await supabase.from("orders").select(ORDER_COLUMNS).eq("org_id", orgId).eq("id", body.orderId)
      .neq("launch_stage", silentFilterFor(scopeOf(req).role)).maybeSingle();
    if (orderError) throw orderError;
    if (!order) throw fail(404, "That order was not found.");
    if (String(order.status) !== "Delivered") throw fail(422, "Only delivered orders can have a customer review.");
    if (!approver && order.assigned_rep_id !== req.user!.id) throw fail(403, "You can only send reviews for your own delivered orders.");
    const problem = reviewProblem({ ...body, rating: body.rating ?? undefined }, { today: lagosDay(Date.now()), deliveredOn: dayOf(order.delivered_date) });
    if (problem) throw fail(422, problem);

    const { count: waiting } = await supabase.from("customer_reviews").select("id", { count: "exact", head: true }).eq("order_id", order.id).eq("status", "pending");
    if ((waiting ?? 0) > 0) throw fail(409, "This order already has a review waiting for approval.");

    // Reviews started but never sent: clear this person's old ones and their files.
    const stale = await supabase.from("customer_reviews").select("id").eq("submitted_by", req.user!.id).eq("status", "draft")
      .lt("created_at", new Date(Date.now() - 86400000).toISOString()).limit(50);
    for (const draft of stale.data ?? []) await discardDraft(String(draft.id));

    const repId = order.assigned_rep_id ?? (approver ? null : req.user!.id);
    const { data: rep } = repId ? await supabase.from("users").select("name").eq("id", repId).maybeSingle() : { data: null as any };
    const { data: created, error } = await supabase.from("customer_reviews").insert({
      org_id: orgId, branch_id: order.branch_id, order_id: order.id, product_id: order.product_id ?? null,
      rep_id: repId, rep_name: rep?.name ?? "", submitted_by: req.user!.id, submitted_by_name: req.user!.name ?? "", submitted_by_role: role,
      status: "draft", review_type: body.type, review_text: body.text.trim(), rating: body.rating ?? null, channel: body.channel,
      received_on: body.receivedOn ?? lagosDay(Date.now()), complaint: body.complaint.trim(), genuine_confirmed: true, marketing_ok: body.marketing
    }).select("*").single();
    if (error) throw error;
    res.status(201).json({ review: { id: created.id, productId: created.product_id, status: created.status } });
  } catch (error) { sendError(res, error, "Could not start the review."); }
});

async function discardDraft(id: string) {
  const { data: files } = await supabase.from("product_media").select("holding_path, holding_thumb_path").eq("review_id", id);
  await removeFiles(HOLD, (files ?? []).flatMap((row: any) => [row.holding_path, row.holding_thumb_path]));
  await supabase.from("customer_reviews").delete().eq("id", id).eq("status", "draft");
}

router.delete("/:id", async (req, res) => {
  try {
    const row = await loadReview(req);
    if (row.status !== "draft" || row.submitted_by !== req.user!.id) throw fail(409, "Only a review you have not sent yet can be thrown away.");
    await discardDraft(row.id);
    res.json({ ok: true });
  } catch (error) { sendError(res, error, "Could not throw the review away."); }
});

router.post("/:id/submit", async (req, res) => {
  try {
    const row = await loadReview(req);
    if (row.submitted_by !== req.user!.id || row.status !== "draft") throw fail(409, "This review was already sent.");
    const { data: files, error: filesError } = await supabase.from("product_media").select("kind, status, review_part").eq("review_id", row.id);
    if (filesError) throw filesError;
    const problem = filesProblem(row.review_type, (files ?? []).map((file: any) => ({ kind: file.kind, status: file.status, part: file.review_part })));
    if (problem) throw fail(422, problem);
    const { data: sent, error } = await supabase.from("customer_reviews").update({ status: "pending", submitted_at: new Date().toISOString() })
      .eq("id", row.id).eq("status", "draft").select("*").maybeSingle();
    if (error) {
      if (String(error.code) === "23505") throw fail(409, "This order already has a review waiting for approval.");
      throw error;
    }
    if (!sent) throw fail(409, "This review was already sent.");
    await logEvent(sent, req, { action: "submitted", from: "draft", to: "pending", note: LEVEL_LABEL[sent.review_type as ReviewLevel] });
    const amounts = await readAmounts(orgOf(req));
    const recipients = (await approverRecipients(orgOf(req))).filter((user) => user.id !== req.user!.id);
    await notify(orgOf(req), sent.branch_id, recipients, "Customer review to approve",
      `${req.user!.name ?? "A rep"} sent a ${LEVEL_LABEL[sent.review_type as ReviewLevel].toLowerCase()} for order ${sent.order_id}.`, `review-${sent.id}`);
    res.json({ review: { id: sent.id, status: sent.status }, bonusIfApproved: amountFor(sent.review_type as ReviewLevel, amounts) });
  } catch (error) { sendError(res, error, "Could not send the review."); }
});

// ── How many are waiting (the tab's badge) ────────────────
router.get("/count", async (req, res) => {
  try {
    const me = scopeOf(req).id;
    let query = supabase.from("customer_reviews").select("id", { count: "exact", head: true }).eq("org_id", orgOf(req)).eq("status", "pending");
    if (!seesAll(req)) query = query.or(`rep_id.eq.${me},submitted_by.eq.${me}`);
    const { count, error } = await query;
    if (error) throw error;
    res.json({ waiting: count ?? 0 });
  } catch (error) { sendError(res, error, "Could not count the reviews."); }
});

// ── The list (reps: their own; approvers: everyone's) ─────
router.get("/", async (req, res) => {
  try {
    const orgId = orgOf(req);
    const me = scopeOf(req).id;
    const approver = seesAll(req);
    let query = supabase.from("customer_reviews").select("*").eq("org_id", orgId).neq("status", "draft")
      .order("created_at", { ascending: false }).limit(400);
    if (!approver) query = query.or(`rep_id.eq.${me},submitted_by.eq.${me}`);
    const { data, error } = await query;
    if (error) throw error;
    const orders = await ordersById((data ?? []).map((row: any) => String(row.order_id)), scopeOf(req).role);
    const rows = (data ?? []).filter((row: any) => orders.has(String(row.order_id)));
    const [files, ledger] = await Promise.all([
      filesByReview(rows.map((row: any) => row.id)),
      ledgerFor(rows.map((row: any) => String(row.order_id)))
    ]);
    const thisWeek = weekStartOf(lagosDay(Date.now()));
    let paid = supabase.from("customer_review_incentives").select("rep_id, amount, pay_week_start").eq("org_id", orgId).limit(20000);
    if (!approver) paid = paid.eq("rep_id", me);
    const { data: paidRows, error: paidError } = await paid;
    if (paidError) throw paidError;
    const ctx = { orders, files: files.byReview, ledger, viewerId: me, approver };
    const reviews = rows.map((row: any) => mapReview(row, ctx));
    res.json({
      reviews,
      canApprove: approver,
      amounts: await readAmounts(orgId),
      summary: {
        waiting: reviews.filter((item) => item.status === "pending").length,
        approvedThisWeek: reviews.filter((item) => item.status === "approved" && !item.legacy && item.reviewedAt && weekStartOf(lagosDay(Date.parse(item.reviewedAt))) === thisWeek).length,
        bonusThisWeek: Math.round((paidRows ?? []).filter((item: any) => item.pay_week_start === thisWeek).reduce((sum: number, item: any) => sum + Number(item.amount ?? 0), 0)),
        bonusTotal: Math.round((paidRows ?? []).reduce((sum: number, item: any) => sum + Number(item.amount ?? 0), 0)),
        forMarketing: reviews.filter((item) => item.status === "approved" && item.marketingOk).length,
        thisWeek
      }
    });
  } catch (error) { sendError(res, error, "Could not load the customer reviews."); }
});

// ── One review, with everything an approver checks ────────
router.get("/:id", async (req, res) => {
  try {
    const row = await loadReview(req);
    res.json(await detailFor(req, row));
  } catch (error) { sendError(res, error, "Could not load the review."); }
});

async function detailFor(req: Request, row: any) {
  const me = scopeOf(req).id;
  const approver = seesAll(req);
  const { data: siblings } = await supabase.from("customer_reviews").select("*").eq("order_id", row.order_id).neq("status", "draft").order("created_at");
  const all = [row, ...(siblings ?? []).filter((item: any) => item.id !== row.id)];
  const [orders, files, ledger, amounts, events] = await Promise.all([
    ordersById([String(row.order_id)], scopeOf(req).role),
    filesByReview(all.map((item: any) => item.id)),
    ledgerFor([String(row.order_id)]),
    readAmounts(row.org_id),
    supabase.from("customer_review_events").select("action, from_status, to_status, amount_change, note, actor_name, created_at").eq("review_id", row.id).order("created_at")
  ]);
  if (!orders.has(String(row.order_id))) throw fail(404, "That review was not found.");
  const ctx = { orders, files: files.byReview, ledger, viewerId: me, approver };
  const review = mapReview(row, ctx);

  // The same file anywhere else: another review, or the gallery.
  const prints = files.raw.filter((file) => file.review_id === row.id && file.fingerprint).map((file) => String(file.fingerprint));
  const duplicates: Array<{ fileName: string; reviewId: string | null; orderId: string | null; status: string }> = [];
  if (prints.length) {
    const { data: same } = await supabase.from("product_media").select("id, review_id, original_name, status, fingerprint").eq("org_id", row.org_id).in("fingerprint", prints).neq("review_id", row.id);
    const { data: galleryOnly } = await supabase.from("product_media").select("id, original_name, status").eq("org_id", row.org_id).in("fingerprint", prints).is("review_id", null);
    const otherReviewIds = Array.from(new Set((same ?? []).map((file: any) => file.review_id).filter(Boolean)));
    const { data: otherReviews } = otherReviewIds.length ? await supabase.from("customer_reviews").select("id, order_id, status").in("id", otherReviewIds) : { data: [] as any[] };
    for (const file of same ?? []) {
      const other = (otherReviews ?? []).find((item: any) => item.id === file.review_id);
      duplicates.push({ fileName: file.original_name ?? "", reviewId: file.review_id ?? null, orderId: other?.order_id ?? null, status: other?.status ?? file.status });
    }
    for (const file of galleryOnly ?? []) duplicates.push({ fileName: file.original_name ?? "", reviewId: null, orderId: null, status: `gallery: ${file.status}` });
  }

  const contentFiles = review.files.filter((file: any) => file.part !== "consent");
  const levels = levelsFor(row.review_type, contentFiles.some((file: any) => file.kind === "video"), contentFiles.some((file: any) => file.kind === "image"));
  const approvedOthers = all.filter((item: any) => item.id !== row.id && item.status === "approved" && !item.legacy_touchpoint_id).map((item: any) => Number(item.level_amount ?? 0));
  const paidForOrder = ledger.reduce((sum, item) => sum + Number(item.amount ?? 0), 0);
  const currentOwn = row.status === "approved" ? [Number(row.level_amount ?? 0)] : [];
  const options = levels.map((level) => {
    const amount = amountFor(level, amounts);
    const { credit } = topUp([...approvedOthers, ...currentOwn], amount, paidForOrder);
    return { level, label: LEVEL_LABEL[level], amount, adds: credit };
  });
  return {
    review,
    others: all.filter((item: any) => item.id !== row.id).map((item: any) => mapReview(item, ctx)),
    ledger: ledger.map((item) => ({
      id: item.id, reviewId: item.review_id, level: item.level, levelText: LEVEL_LABEL[item.level as ReviewLevel] ?? item.level,
      amount: Math.round(Number(item.amount ?? 0)), levelTotal: Math.round(Number(item.level_total ?? 0)), payWeekStart: item.pay_week_start,
      repName: item.rep_name ?? "", approvedByName: item.approved_by_name ?? "", createdAt: item.created_at
    })),
    duplicates,
    options,
    events: (events.data ?? []).map((item: any) => ({ action: item.action, from: item.from_status, to: item.to_status, amount: Math.round(Number(item.amount_change ?? 0)), note: item.note ?? "", actorName: item.actor_name ?? "", at: item.created_at })),
    canApprove: approver,
    reasons: REJECT_REASONS
  };
}

// ── Decisions (Owner / Admin / Manager) ───────────────────
const RPC_ERRORS: Record<string, [number, string]> = {
  not_waiting: [409, "This review is no longer waiting for approval."],
  not_higher: [409, "It is already approved at that level or higher."],
  not_delivered: [409, "This order is no longer marked Delivered, so its review can't earn a bonus."],
  legacy: [409, "Reviews brought over from Customer Retention can't earn a bonus."],
  not_found: [404, "That review was not found."],
  bad_level: [400, "Choose what to approve it as."]
};
async function approveInDatabase(req: Request, row: any, level: ReviewLevel, note: string) {
  const { data, error } = await supabase.rpc("approve_customer_review", {
    p_review_id: row.id, p_level: level, p_actor: req.user!.id, p_actor_name: req.user!.name ?? "", p_note: note
  });
  if (error) {
    const known = Object.entries(RPC_ERRORS).find(([code]) => String(error.message ?? "").includes(code));
    if (known) throw fail(known[1][0], known[1][1]);
    throw error;
  }
  return data as { credited: number; levelTotal: number; level: ReviewLevel; payWeekStart: string };
}

/** After approval: with marketing permission the files join the public gallery; without, they stay private. */
async function placeFiles(req: Request, row: any) {
  const { data: files } = await supabase.from("product_media").select("*").eq("review_id", row.id).eq("status", "pending");
  let failed = 0;
  for (const file of files ?? []) {
    try {
      if (row.marketing_ok && file.review_part !== "consent") await approveRow(file, req);
      else await supabase.from("product_media").update({ status: "private", reviewed_by: req.user!.id, reviewed_by_name: req.user!.name ?? "", reviewed_at: new Date().toISOString() }).eq("id", file.id);
    } catch (error: any) {
      failed += 1;
      console.warn("[customer-reviews] could not place file", file.id, error?.message);
      await supabase.from("product_media").update({ status: "private" }).eq("id", file.id).eq("status", "pending");
    }
  }
  return failed;
}

const naira = (amount: number) => `₦${Math.round(amount).toLocaleString("en-NG")}`;

router.post("/:id/approve", async (req, res) => {
  try {
    requireApprover(req);
    const row = await loadReview(req);
    const level = String(req.body?.level ?? row.review_type) as ReviewLevel;
    if (!REVIEW_LEVELS.includes(level)) throw fail(400, "Choose what to approve it as.");
    const { data: files } = await supabase.from("product_media").select("kind, review_part").eq("review_id", row.id);
    const content = (files ?? []).filter((file: any) => file.review_part !== "consent");
    if (!levelsFor(row.review_type, content.some((file: any) => file.kind === "video"), content.some((file: any) => file.kind === "image")).includes(level)) {
      throw fail(422, level === "premium" ? "Only a review with a video can be Premium." : "That level needs a photo or video this review does not have.");
    }
    const result = await approveInDatabase(req, row, level, String(req.body?.note ?? "").trim().slice(0, 500));
    const fresh = await loadReview(req);
    const failed = await placeFiles(req, fresh);
    await tellRep(req, fresh, "Customer review approved",
      result.credited > 0
        ? `Order ${fresh.order_id}: approved as ${LEVEL_LABEL[level].toLowerCase()}. ${naira(result.credited)} goes into this week's report.`
        : `Order ${fresh.order_id}: approved as ${LEVEL_LABEL[level].toLowerCase()}. This order's bonus was already paid.`);
    res.json({ ...(await detailFor(req, fresh)), credited: result.credited, warning: failed ? "Approved, but some files could not be moved. They stay private." : null });
  } catch (error) { sendError(res, error, "Could not approve the review."); }
});

router.post("/:id/premium", async (req, res) => {
  try {
    requireApprover(req);
    const row = await loadReview(req);
    if (row.status !== "approved") throw fail(409, "Approve the review first.");
    const { data: videos } = await supabase.from("product_media").select("id").eq("review_id", row.id).eq("kind", "video").neq("review_part", "consent").limit(1);
    if (!videos?.length) throw fail(422, "Only a review with a video can be Premium.");
    const result = await approveInDatabase(req, row, "premium", String(req.body?.note ?? "").trim().slice(0, 500));
    const fresh = await loadReview(req);
    await tellRep(req, fresh, "Video upgraded to Premium", `Order ${fresh.order_id}: your customer's video is Premium.${result.credited > 0 ? ` ${naira(result.credited)} more goes into this week's report.` : ""}`);
    res.json({ ...(await detailFor(req, fresh)), credited: result.credited });
  } catch (error) { sendError(res, error, "Could not upgrade the review."); }
});

const DeclineSchema = z.object({ reason: z.string().optional(), note: z.string().max(500).default("") });
async function decline(req: Request, res: Response, status: "rejected" | "changes_requested") {
  try {
    requireApprover(req);
    const parsed = DeclineSchema.safeParse(req.body ?? {});
    if (!parsed.success) { res.status(400).json({ error: humanFieldErrors(parsed.error) }); return; }
    const note = parsed.data.note.trim();
    const reason = status === "rejected" ? parsed.data.reason : null;
    if (status === "rejected" && !isRejectReason(reason)) throw fail(400, "Choose why it is not approved.");
    if ((status === "changes_requested" || reason === "other") && note.length < 3) throw fail(400, status === "changes_requested" ? "Say what to fix." : "Say why, so the rep knows.");
    const row = await loadReview(req);
    const { data: done, error } = await supabase.from("customer_reviews").update({
      status, decision_reason: reason, decision_note: note || null,
      reviewed_by: req.user!.id, reviewed_by_name: req.user!.name ?? "", reviewed_at: new Date().toISOString()
    }).eq("id", row.id).eq("status", "pending").select("*").maybeSingle();
    if (error) throw error;
    if (!done) throw fail(409, "This review is no longer waiting for approval.");
    // Its files go: nothing of a review that was not approved is kept.
    const { data: files } = await supabase.from("product_media").select("id, holding_path, holding_thumb_path").eq("review_id", row.id);
    await removeFiles(HOLD, (files ?? []).flatMap((file: any) => [file.holding_path, file.holding_thumb_path]));
    if (files?.length) await supabase.from("product_media").update({ status, holding_path: null, holding_thumb_path: null, reject_reason: note || null }).in("id", files.map((file: any) => file.id));
    await logEvent(done, req, { action: status, from: "pending", to: status, note: [reason ? (REJECT_REASONS as Record<string, string>)[reason] : "", note].filter(Boolean).join(" · ") });
    await tellRep(req, done, status === "rejected" ? "Customer review not approved" : "Changes asked for your customer review",
      `Order ${done.order_id}: ${[reason ? (REJECT_REASONS as Record<string, string>)[reason] : "", note].filter(Boolean).join(". ")}`);
    res.json(await detailFor(req, done));
  } catch (error) { sendError(res, error, "Could not save the decision."); }
}
router.post("/:id/reject", (req, res) => decline(req, res, "rejected"));
router.post("/:id/request-changes", (req, res) => decline(req, res, "changes_requested"));

/** The customer gave (or took back) permission for marketing after approval. */
router.post("/:id/marketing", async (req, res) => {
  try {
    requireApprover(req);
    const ok = req.body?.ok === true;
    const row = await loadReview(req);
    if (row.status !== "approved" || row.legacy_touchpoint_id) throw fail(409, "Only an approved review can change this.");
    const { data: files } = await supabase.from("product_media").select("*").eq("review_id", row.id).neq("review_part", "consent");
    if (ok) {
      for (const file of files ?? []) if (file.status === "private" && file.holding_path) await approveRow(file, req);
    } else {
      for (const file of files ?? []) {
        if (file.status !== "approved" || !file.public_path) continue;
        const holdingPath = `${file.org_id}/${file.id}/main.${String(file.public_path).split(".").pop()}`;
        const holdingThumb = file.public_thumb_path ? `${file.org_id}/${file.id}/thumb.webp` : null;
        const { error: copyError } = await supabase.storage.from(PUBLIC).copy(file.public_path, holdingPath, { destinationBucket: HOLD });
        if (copyError) throw copyError;
        if (holdingThumb) await supabase.storage.from(PUBLIC).copy(file.public_thumb_path, holdingThumb, { destinationBucket: HOLD });
        await supabase.from("product_media").update({ status: "private", holding_path: holdingPath, holding_thumb_path: holdingThumb, public_path: null, public_thumb_path: null, url: null, thumb_url: null, is_cover: false }).eq("id", file.id);
        await removeFiles(PUBLIC, [file.public_path, file.public_thumb_path]);
      }
    }
    const { data: done, error } = await supabase.from("customer_reviews").update({ marketing_ok: ok, marketing_withdrawn_at: ok ? null : new Date().toISOString() }).eq("id", row.id).select("*").single();
    if (error) throw error;
    await logEvent(done, req, { action: ok ? "marketing_allowed" : "marketing_withdrawn", note: String(req.body?.note ?? "").slice(0, 300) });
    res.json(await detailFor(req, done));
  } catch (error) { sendError(res, error, "Could not change the marketing permission."); }
});

export default router;
