import { Router, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { supabase } from "../lib/supabase.js";
import { logger } from "../lib/logger.js";
import { ACCEPTED_TYPES } from "../lib/media-safety.js";
import { CompleteSchema, HOLD, approverRecipients, checkHeldFile, notify, readSettings, removeFiles } from "./product-media.js";

/**
 * A customer's personal review link (Reviews & UGC, Bright's design 56,
 * 8 Nov 2026: "Personal review link"). No login: the link's token is the
 * key, and it opens one delivered order. The customer gives stars, words and
 * photos or a video with the same consent ticks a rep uses; files go through
 * the same holding area and checks (checkHeldFile). The review then waits
 * for an Owner / Admin / Manager like a rep's, and the order's rep is paid
 * when it is approved.
 */

const router = Router();
const TOKEN = /^[A-Za-z0-9_-]{20,40}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_FILES = 6;
const fail = (status: number, message: string) => Object.assign(new Error(message), { status });
function sendError(res: Response, error: any, fallback: string) {
  const status = Number(error?.status) || 500;
  if (status >= 500) logger.warn("public review route failed", { error: error?.message ?? String(error) });
  res.status(status).json({ error: status >= 500 ? fallback : error.message });
}
const firstName = (name: unknown) => String(name ?? "").trim().split(/\s+/)[0] ?? "";

async function linkFor(token: string) {
  if (!TOKEN.test(token)) throw fail(404, "This review link is not valid.");
  const { data: link, error } = await supabase.from("review_links").select("*").eq("token", token).maybeSingle();
  if (error) throw error;
  if (!link) throw fail(404, "This review link is not valid.");
  const { data: order, error: orderError } = await supabase.from("orders").select("id, org_id, branch_id, customer, product_id, product_name, status, assigned_rep_id")
    // launch-safe: the customer's own order, opened by its own link; Silent Test orders have no customers.
    .eq("id", link.order_id).neq("launch_stage", "silent").maybeSingle();
  if (orderError) throw orderError;
  if (!order) throw fail(404, "This review link is not valid.");
  return { link, order };
}
const tokenOf = (req: Request) => String(req.params.token ?? "");

/** What the page shows: the product, the brand, and whether a review was already sent. */
router.get("/:token", async (req, res) => {
  try {
    const { link, order } = await linkFor(tokenOf(req));
    const [{ data: product }, { data: brand }, { data: sent }, settings] = await Promise.all([
      order.product_id ? supabase.from("products").select("name, image_url").eq("id", order.product_id).maybeSingle() : Promise.resolve({ data: null as any }),
      supabase.from("organizations").select("name").eq("id", order.org_id).maybeSingle(),
      supabase.from("customer_reviews").select("id, status").eq("order_id", order.id).in("status", ["pending", "approved"]).limit(1),
      readSettings(order.org_id, order.branch_id)
    ]);
    if (!link.opened_at) await supabase.from("review_links").update({ opened_at: new Date().toISOString() }).eq("id", link.id);
    res.setHeader("Cache-Control", "no-store");
    res.json({
      brand: brand?.name ?? "", productName: product?.name ?? order.product_name ?? "", productImage: product?.image_url && /^https:\/\//.test(product.image_url) ? product.image_url : null,
      firstName: firstName(order.customer), delivered: order.status === "Delivered", alreadySent: (sent ?? []).length > 0,
      maxImageMb: settings.maxImageMb, maxVideoMb: settings.maxVideoMb, maxFiles: MAX_FILES
    });
  } catch (error) { sendError(res, error, "Could not open the review page."); }
});

const StartSchema = z.object({
  rating: z.number().int().min(1, "Pick 1 to 5 stars.").max(5, "Pick 1 to 5 stars."),
  text: z.string().max(2000, "Keep it under 2,000 characters.").default(""),
  genuine: z.literal(true, { errorMap: () => ({ message: "Please confirm this is your real experience." }) }),
  marketing: z.boolean().default(false)
});

/** Start the review (files follow, then /submit). */
router.post("/:token/start", async (req, res) => {
  try {
    const { order } = await linkFor(tokenOf(req));
    if (order.status !== "Delivered") throw fail(422, "You can review this order once it has been delivered.");
    const parsed = StartSchema.safeParse(req.body);
    if (!parsed.success) throw fail(400, parsed.error.issues[0]?.message ?? "Check your review.");
    const { count: waiting } = await supabase.from("customer_reviews").select("id", { count: "exact", head: true }).eq("order_id", order.id).in("status", ["pending", "approved"]);
    if ((waiting ?? 0) > 0) throw fail(409, "Thank you! A review for this order has already been sent.");
    // An unfinished one from this link before: throw it away first.
    const { data: drafts } = await supabase.from("customer_reviews").select("id").eq("order_id", order.id).eq("status", "draft").eq("source", "customer");
    for (const draft of drafts ?? []) await discardDraft(String(draft.id));
    const { data: rep } = order.assigned_rep_id ? await supabase.from("users").select("name").eq("id", order.assigned_rep_id).maybeSingle() : { data: null as any };
    const { data: created, error } = await supabase.from("customer_reviews").insert({
      org_id: order.org_id, branch_id: order.branch_id, order_id: order.id, product_id: order.product_id ?? null, rep_id: order.assigned_rep_id ?? null, rep_name: rep?.name ?? "",
      submitted_by: null, submitted_by_name: firstName(order.customer) || "Customer", submitted_by_role: "customer", source: "customer", channel: "link",
      status: "draft", review_type: "written", review_text: parsed.data.text.trim(), rating: parsed.data.rating, genuine_confirmed: true, marketing_ok: parsed.data.marketing,
      received_on: new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos" }).format(new Date())
    }).select("id").single();
    if (error) throw error;
    res.status(201).json({ reviewId: created.id });
  } catch (error) { sendError(res, error, "Could not start your review."); }
});

async function draftFor(req: Request, reviewId: string) {
  const { order } = await linkFor(tokenOf(req));
  if (!UUID.test(reviewId)) throw fail(404, "Start your review again.");
  const { data: review } = await supabase.from("customer_reviews").select("*").eq("id", reviewId).eq("order_id", order.id).eq("source", "customer").maybeSingle();
  if (!review || review.status !== "draft") throw fail(404, "Start your review again.");
  return { order, review };
}

async function discardDraft(id: string) {
  const { data: files } = await supabase.from("product_media").select("holding_path, holding_thumb_path").eq("review_id", id);
  await removeFiles(HOLD, (files ?? []).flatMap((row: any) => [row.holding_path, row.holding_thumb_path]));
  await supabase.from("product_media").delete().eq("review_id", id);
  await supabase.from("customer_reviews").delete().eq("id", id).eq("status", "draft");
}

const FileSchema = z.object({ reviewId: z.string(), mime: z.string().max(60), size: z.number().int().positive(), name: z.string().max(400).optional() });

/** A photo or video: a link to upload it to the holding area. */
router.post("/:token/files", async (req, res) => {
  try {
    const body = FileSchema.parse(req.body);
    const { review } = await draftFor(req, body.reviewId);
    if (!review.product_id) throw fail(422, "Photos can't be added to this order.");
    const kind = ACCEPTED_TYPES[body.mime.toLowerCase()];
    if (!kind) throw fail(415, "Only photos (JPG, PNG, WEBP) and videos (MP4, MOV, WEBM) can be added.");
    const settings = await readSettings(review.org_id, review.branch_id);
    const maxMb = kind === "image" ? settings.maxImageMb : settings.maxVideoMb;
    if (body.size > maxMb * 1024 * 1024) throw fail(413, kind === "image" ? `Photos must be ${maxMb} MB or smaller.` : `Videos must be ${maxMb} MB or smaller.`);
    const { count } = await supabase.from("product_media").select("id", { count: "exact", head: true }).eq("review_id", review.id);
    if ((count ?? 0) >= MAX_FILES) throw fail(429, `You can add up to ${MAX_FILES} photos or videos.`);
    const id = randomUUID();
    const holdingPath = `${review.org_id}/${id}/original`;
    const { error } = await supabase.from("product_media").insert({
      id, org_id: review.org_id, branch_id: review.branch_id, product_id: review.product_id, kind, status: "uploading", label: "customer_review", caption: "", tags: [],
      review_id: review.id, review_part: "content", original_name: String(body.name ?? "file").replace(/[^\w .-]/g, "").slice(0, 120) || "file",
      mime: body.mime.toLowerCase(), size_bytes: body.size, holding_path: holdingPath, uploaded_by: null, uploaded_by_name: review.submitted_by_name || "Customer", uploaded_by_role: "customer"
    });
    if (error) throw error;
    const { data: signed, error: signError } = await supabase.storage.from(HOLD).createSignedUploadUrl(holdingPath);
    if (signError) throw signError;
    res.status(201).json({ id, signedUrl: signed.signedUrl });
  } catch (error: any) {
    if (error?.issues) { res.status(400).json({ error: "The file details were not valid." }); return; }
    sendError(res, error, "Could not start the upload.");
  }
});

/** The file arrived: the same checks as every upload; refused files are deleted. */
router.post("/:token/files/:id/complete", async (req, res) => {
  const id = String(req.params.id ?? "");
  let row: any = null;
  try {
    if (!UUID.test(id)) throw fail(404, "That upload was not found.");
    const { data } = await supabase.from("product_media").select("*").eq("id", id).maybeSingle();
    row = data;
    if (!row || row.status !== "uploading" || !row.review_id) throw fail(404, "That upload was not found.");
    await draftFor(req, String(row.review_id));
    const parsed = CompleteSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw fail(400, "The file details were not valid. Try sending it again.");
    const patch = await checkHeldFile(row, await readSettings(row.org_id, row.branch_id), parsed.data);
    const { error } = await supabase.from("product_media").update({ ...patch, status: "pending" }).eq("id", row.id);
    if (error) throw error;
    res.json({ ok: true, kind: row.kind });
  } catch (error: any) {
    if (row && row.status === "uploading") {
      await removeFiles(HOLD, [row.holding_path, `${row.org_id}/${row.id}/main.webp`, `${row.org_id}/${row.id}/thumb.webp`]);
      await supabase.from("product_media").delete().eq("id", row.id);
    }
    sendError(res, error, "Could not check the file. Try sending it again.");
  }
});

router.delete("/:token/files/:id", async (req, res) => {
  try {
    const id = String(req.params.id ?? "");
    if (!UUID.test(id)) throw fail(404, "That file was not found.");
    const { data: row } = await supabase.from("product_media").select("id, review_id, holding_path, holding_thumb_path").eq("id", id).maybeSingle();
    if (!row?.review_id) throw fail(404, "That file was not found.");
    await draftFor(req, String(row.review_id));
    await removeFiles(HOLD, [row.holding_path, row.holding_thumb_path]);
    await supabase.from("product_media").delete().eq("id", row.id);
    res.json({ ok: true });
  } catch (error) { sendError(res, error, "Could not remove the file."); }
});

/** Send it: it waits for approval like a rep's review. */
router.post("/:token/submit", async (req, res) => {
  try {
    const { order, review } = await draftFor(req, String(req.body?.reviewId ?? ""));
    const { data: files } = await supabase.from("product_media").select("kind, status").eq("review_id", review.id);
    if ((files ?? []).some((file: any) => file.status === "uploading")) throw fail(409, "Some files are still being sent. Wait for them to finish.");
    const ready = (files ?? []).filter((file: any) => file.status === "pending");
    const type = ready.some((file: any) => file.kind === "video") ? "video" : ready.some((file: any) => file.kind === "image") ? "photo" : "written";
    if (type === "written" && String(review.review_text ?? "").trim().length < 5) throw fail(422, "Write a few words about your order, or add a photo or video.");
    const { data: sent, error } = await supabase.from("customer_reviews").update({ status: "pending", review_type: type, submitted_at: new Date().toISOString() })
      .eq("id", review.id).eq("status", "draft").select("*").maybeSingle();
    if (error) {
      if (String(error.code) === "23505") throw fail(409, "Thank you! A review for this order has already been sent.");
      throw error;
    }
    if (!sent) throw fail(409, "Thank you! Your review was already sent.");
    await supabase.from("customer_review_events").insert({
      org_id: sent.org_id, branch_id: sent.branch_id, review_id: sent.id, order_id: sent.order_id, action: "submitted", from_status: "draft", to_status: "pending",
      amount_change: 0, note: "Sent by the customer through their review link", actor_id: null, actor_name: sent.submitted_by_name || "Customer"
    });
    const recipients = await approverRecipients(order.org_id);
    await notify(order.org_id, sent.branch_id, recipients, "Customer review to approve", `A customer sent a ${type} review for order ${sent.order_id} through their review link.`, `review-${sent.id}`);
    res.json({ ok: true });
  } catch (error) { sendError(res, error, "Could not send your review."); }
});

export default router;
