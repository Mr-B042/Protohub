import { supabase } from "./supabase.js";
import { logger } from "./logger.js";
import { fetchAllRowsOrThrow, selectByIdBatches } from "./query-limits.js";
import { DAY_MS } from "./email-marketing-rules.js";
import { EmailMarketingError } from "./email-marketing.js";
import { SEND_TOKEN, benefitText, codeFrom, discountFor, offerProblem, offerState, type Offer, type OfferType } from "./email-offers-rules.js";

/**
 * Coupons & Offers (Bright's design 54, 8 Nov 2026). An offer rides on an
 * email: Create Campaign (or an automation email) picks it, the email's
 * tracked link brings the send token into the order form, and the order is
 * saved with the lower amount. No code box on the order form (Bright).
 * Rules: email-offers-rules.ts.
 */

const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null);
const change = (now: number, before: number) => (before > 0 ? Math.round(((now - before) / before) * 1000) / 10 : null);
const last10 = (phone: unknown) => String(phone ?? "").replace(/\D/g, "").slice(-10);

export function offerRow(row: any) {
  const offer: Offer = {
    id: row.id, name: row.name, type: row.type, benefit: row.benefit === "fixed" ? "fixed" : "percent", value: Number(row.value) || 0, code: row.code,
    minOrder: Number(row.min_order) || 0, productIds: Array.isArray(row.product_ids) ? row.product_ids : [], minDelivered: Number(row.min_delivered) || 0,
    startsMs: row.starts_at ? Date.parse(row.starts_at) : null, endsMs: row.ends_at ? Date.parse(row.ends_at) : null,
    usageLimit: row.usage_limit === null || row.usage_limit === undefined ? null : Number(row.usage_limit), perCustomerLimit: Number(row.per_customer_limit) || 1, status: row.status
  };
  return { ...offer, description: row.description ?? "", startsAt: row.starts_at ?? null, endsAt: row.ends_at ?? null, createdAt: row.created_at, updatedAt: row.updated_at, createdByName: row.created_by_name ?? "" };
}
export type OfferDto = ReturnType<typeof offerRow>;

// ── Saving ────────────────────────────────────────────────────────────

export type OfferInput = {
  name: string; description: string; type: OfferType; benefit: "percent" | "fixed"; value: number; code: string; minOrder: number; productIds: string[];
  minDelivered: number; startsAt: string | null; endsAt: string | null; usageLimit: number | null; perCustomerLimit: number; status: "draft" | "active";
};

export async function saveOffer(orgId: string, branchId: string, user: { id: string; name?: string | null }, id: string | null, input: OfferInput) {
  const code = codeFrom(input.code);
  if (!code) throw new EmailMarketingError(400, "The code needs 3 to 24 letters or numbers (e.g. FLASH10).");
  if (input.benefit === "percent" && (input.value <= 0 || input.value > 90)) throw new EmailMarketingError(400, "A percent offer must be between 1% and 90%.");
  if (input.benefit === "fixed" && input.value <= 0) throw new EmailMarketingError(400, "Enter how much naira comes off.");
  if (input.startsAt && input.endsAt && Date.parse(input.endsAt) <= Date.parse(input.startsAt)) throw new EmailMarketingError(400, "The end date must be after the start date.");
  if (input.type === "flash" && !input.endsAt) throw new EmailMarketingError(400, "A flash sale needs an end date.");
  if (input.type === "loyalty" && input.minDelivered < 1) throw new EmailMarketingError(400, "A loyalty offer needs the delivered orders a customer must have (1 or more).");
  if (input.productIds.length) {
    const { data } = await supabase.from("products").select("id").eq("org_id", orgId).in("id", input.productIds);
    if ((data ?? []).length !== input.productIds.length) throw new EmailMarketingError(400, "One of the products was not found.");
  }
  const columns = {
    name: input.name, description: input.description, type: input.type, benefit: input.benefit, value: input.value, code, min_order: input.minOrder,
    product_ids: input.productIds, min_delivered: input.type === "loyalty" ? input.minDelivered : 0, starts_at: input.startsAt, ends_at: input.endsAt,
    usage_limit: input.usageLimit, per_customer_limit: input.perCustomerLimit, updated_at: new Date().toISOString()
  };
  if (id) {
    const { data, error } = await supabase.from("email_offers").update(columns).eq("org_id", orgId).eq("branch_id", branchId).eq("id", id).select("id").maybeSingle();
    if (error) throw error.code === "23505" ? new EmailMarketingError(409, `The code ${code} is already used by another offer.`) : new Error(error.message);
    if (!data) throw new EmailMarketingError(404, "Offer not found.");
    return id;
  }
  const { data, error } = await supabase.from("email_offers").insert({ ...columns, status: input.status, org_id: orgId, branch_id: branchId, created_by: user.id, created_by_name: user.name ?? "" }).select("id").single();
  if (error) throw error.code === "23505" ? new EmailMarketingError(409, `The code ${code} is already used by another offer.`) : new Error(error.message);
  return data.id as string;
}

export async function setOfferStatus(orgId: string, branchId: string, id: string, action: "launch" | "pause" | "resume" | "archive" | "unarchive") {
  const status = action === "pause" ? "paused" : action === "archive" ? "archived" : action === "unarchive" ? "paused" : "active";
  const { data, error } = await supabase.from("email_offers").update({ status, updated_at: new Date().toISOString() }).eq("org_id", orgId).eq("branch_id", branchId).eq("id", id).select("id").maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new EmailMarketingError(404, "Offer not found.");
}

export async function deleteOffer(orgId: string, branchId: string, id: string) {
  const { count } = await supabase.from("email_offer_redemptions").select("id", { count: "exact", head: true }).eq("offer_id", id);
  if (count) throw new EmailMarketingError(409, "Customers have used this offer. Archive it instead, so its results are kept.");
  const { error } = await supabase.from("email_offers").delete().eq("org_id", orgId).eq("branch_id", branchId).eq("id", id);
  if (error) throw new Error(error.message);
}

// ── The page (design 54) ──────────────────────────────────────────────

export async function offersPage(orgId: string, branchId: string, range: { fromMs: number; toMs: number }) {
  const nowMs = Date.now();
  const length = Math.max(DAY_MS, range.toMs - range.fromMs);
  const before = { fromMs: range.fromMs - length, toMs: range.fromMs };
  const [{ data: rows, error }, redemptions, { data: products }] = await Promise.all([
    supabase.from("email_offers").select("*").eq("org_id", orgId).eq("branch_id", branchId).order("created_at", { ascending: false }).limit(500),
    fetchAllRowsOrThrow<any>(() => supabase.from("email_offer_redemptions").select("offer_id, order_id, send_id, phone, amount_before, discount, created_at").eq("org_id", orgId).eq("branch_id", branchId).order("created_at", { ascending: true })),
    supabase.from("products").select("id, name, image_url").eq("org_id", orgId).eq("branch_id", branchId)
  ]);
  if (error) throw new Error(error.message);
  const offers = (rows ?? []).map(offerRow);
  const orderIds = [...new Set(redemptions.map((row) => String(row.order_id)))];
  // Silent Test orders are test orders: not counted in offer results.
  const orders = orderIds.length ? await selectByIdBatches<any>(orderIds, (batch) => supabase.from("orders").select("id, amount, status").neq("launch_stage", "silent").in("id", batch)) : [];
  const orderOf = new Map(orders.map((row) => [String(row.id), row]));
  // Only redemptions whose order is still there (and not a Silent Test order).
  const counted = redemptions.filter((row) => orderOf.has(String(row.order_id)));
  const inRange = (row: any, r: { fromMs: number; toMs: number }) => { const at = Date.parse(row.created_at); return at >= r.fromMs && at < r.toMs; };
  const revenueOf = (list: any[]) => list.reduce((sum, row) => { const order = orderOf.get(String(row.order_id)); return sum + (order?.status === "Delivered" ? Number(order.amount) || 0 : 0); }, 0);
  const now = counted.filter((row) => inRange(row, range)), prev = counted.filter((row) => inRange(row, before));
  const people = (list: any[]) => new Set(list.map((row) => last10(row.phone)).filter(Boolean)).size;
  const liveAt = (atMs: number) => offers.filter((offer) => offer.status === "active" && Date.parse(offer.createdAt) <= atMs && offerState(offer, atMs) === "live").length;

  // Conversion lift: orders per email sent, with an offer against without (campaign emails in the period).
  const { data: sentRows } = await supabase.from("email_campaign_sends").select("campaign_id, order_id, sent_at").eq("org_id", orgId).eq("branch_id", branchId).eq("status", "sent")
    .gte("sent_at", new Date(before.fromMs).toISOString()).lt("sent_at", new Date(range.toMs).toISOString()).limit(50000);
  const campaignIds = [...new Set((sentRows ?? []).map((row: any) => row.campaign_id))];
  const withOffer = new Set<string>();
  for (let i = 0; i < campaignIds.length; i += 200) {
    const { data } = await supabase.from("email_campaigns").select("id").in("id", campaignIds.slice(i, i + 200)).not("offer_id", "is", null);
    for (const row of data ?? []) withOffer.add(row.id);
  }
  const lift = (r: { fromMs: number; toMs: number }) => {
    const sends = (sentRows ?? []).filter((row: any) => { const at = Date.parse(row.sent_at); return at >= r.fromMs && at < r.toMs; });
    const a = sends.filter((row: any) => withOffer.has(row.campaign_id)), b = sends.filter((row: any) => !withOffer.has(row.campaign_id));
    // Too few emails on either side says nothing.
    if (a.length < 20 || b.length < 20) return null;
    return Math.round(((pct(a.filter((row: any) => row.order_id).length, a.length) ?? 0) - (pct(b.filter((row: any) => row.order_id).length, b.length) ?? 0)) * 10) / 10;
  };
  const liftNow = lift(range), liftBefore = lift(before);

  const productOf = new Map(((products ?? []) as any[]).map((row) => [row.id, row]));
  const byType = (["discount", "fixed", "flash", "loyalty"] as const).map((type) => ({ type, revenue: revenueOf(now.filter((row) => offers.find((offer) => offer.id === row.offer_id)?.type === type)) }));
  return {
    kpis: {
      active: { value: liveAt(nowMs), change: change(liveAt(nowMs), liveAt(range.fromMs)) },
      redemptions: { value: now.length, change: change(now.length, prev.length) },
      customers: { value: people(now), change: change(people(now), people(prev)) },
      revenue: { value: revenueOf(now), change: change(revenueOf(now), revenueOf(prev)) },
      lift: { value: liftNow, changePp: liftNow !== null && liftBefore !== null ? Math.round((liftNow - liftBefore) * 10) / 10 : null }
    },
    byType,
    expired: offers.filter((offer) => offerState(offer, nowMs) === "expired").length,
    offers: offers.map((offer) => {
      const mine = now.filter((row) => row.offer_id === offer.id);
      const single = offer.productIds.length === 1 ? productOf.get(offer.productIds[0]) : null;
      return {
        ...offer, state: offerState(offer, nowMs), benefitText: benefitText(offer),
        // allTime counts every redemption (it decides whether the offer can still be deleted).
        redemptions: mine.length, revenue: revenueOf(mine), allTime: redemptions.filter((row) => row.offer_id === offer.id).length,
        imageUrl: single?.image_url && /^https:\/\//.test(single.image_url) ? single.image_url : null,
        productNames: offer.productIds.map((id) => productOf.get(id)?.name).filter(Boolean)
      };
    })
  };
}

/** Offer Usage Report (CSV): every order that got an offer in the period. */
export async function offerUsage(orgId: string, branchId: string, range: { fromMs: number; toMs: number }) {
  const rows = await fetchAllRowsOrThrow<any>(() => supabase.from("email_offer_redemptions").select("offer_id, order_id, phone, amount_before, discount, created_at")
    .eq("org_id", orgId).eq("branch_id", branchId).gte("created_at", new Date(range.fromMs).toISOString()).lt("created_at", new Date(range.toMs).toISOString()).order("created_at", { ascending: true }));
  const offerIds = [...new Set(rows.map((row) => row.offer_id))];
  const { data: offers } = offerIds.length ? await supabase.from("email_offers").select("id, name, code").in("id", offerIds) : { data: [] };
  const orderIds = [...new Set(rows.map((row) => String(row.order_id)))];
  const orders = orderIds.length ? await selectByIdBatches<any>(orderIds, (batch) => supabase.from("orders").select("id, customer, status, amount").neq("launch_stage", "silent").in("id", batch)) : [];
  const offerOf = new Map(((offers ?? []) as any[]).map((row) => [row.id, row]));
  const orderOf = new Map(orders.map((row) => [String(row.id), row]));
  return rows.filter((row) => orderOf.has(String(row.order_id))).map((row) => ({
    at: row.created_at, offer: offerOf.get(row.offer_id)?.name ?? "", code: offerOf.get(row.offer_id)?.code ?? "", orderId: String(row.order_id),
    customer: orderOf.get(String(row.order_id))?.customer ?? "", phone: row.phone ?? "", status: orderOf.get(String(row.order_id))?.status ?? "",
    before: Number(row.amount_before) || 0, discount: Number(row.discount) || 0, paid: Number(orderOf.get(String(row.order_id))?.amount) || 0
  }));
}

// ── The offer an email brings (order form and order save) ───────────

type Found = { offer: Offer & { orgId: string; branchId: string }; sendId: string; sendPhone: string | null };

/** The offer on the email this token came from, if the email carries one. */
async function offerOfToken(token: string): Promise<Found | null> {
  if (!SEND_TOKEN.test(token)) return null;
  const { data: send } = await supabase.from("email_campaign_sends").select("id, campaign_id, phone, org_id, branch_id").eq("token", token).maybeSingle();
  if (!send) return null;
  const { data: campaign } = await supabase.from("email_campaigns").select("offer_id").eq("id", send.campaign_id).maybeSingle();
  if (!campaign?.offer_id) return null;
  const { data: row } = await supabase.from("email_offers").select("*").eq("id", campaign.offer_id).eq("branch_id", send.branch_id).maybeSingle();
  if (!row) return null;
  return { offer: { ...offerRow(row), orgId: row.org_id, branchId: row.branch_id }, sendId: send.id, sendPhone: send.phone ?? null };
}

async function usage(offerId: string, sendId: string, phone: string | null, orgId: string) {
  const key = last10(phone);
  const [{ count: total }, { count: bySend }, byPhone, delivered] = await Promise.all([
    supabase.from("email_offer_redemptions").select("id", { count: "exact", head: true }).eq("offer_id", offerId),
    supabase.from("email_offer_redemptions").select("id", { count: "exact", head: true }).eq("offer_id", offerId).eq("send_id", sendId),
    key ? supabase.from("email_offer_redemptions").select("id", { count: "exact", head: true }).eq("offer_id", offerId).like("phone", `%${key}`) : Promise.resolve({ count: 0 }),
    // launch-safe: counting a customer's delivered orders for a loyalty offer (Silent Test orders left out).
    key ? supabase.from("orders").select("id", { count: "exact", head: true }).eq("org_id", orgId).eq("status", "Delivered").neq("launch_stage", "silent").like("phone", `%${key}`) : Promise.resolve({ count: 0 })
  ]);
  return { usedTotal: total ?? 0, usedBySend: (bySend ?? 0) > 0, usedByCustomer: (byPhone as any).count ?? 0, deliveredOrders: (delivered as any).count ?? 0 };
}

/** For the order form: what to show a customer who came from an email with an offer (no personal data). */
export async function publicOfferForToken(token: string, productId: string | null) {
  const found = await offerOfToken(token);
  if (!found) return null;
  const used = await usage(found.offer.id, found.sendId, found.sendPhone, found.offer.orgId);
  // The minimum order is checked against the real total when the order is saved.
  const problem = offerProblem(found.offer, { productId, amount: Number.MAX_SAFE_INTEGER, nowMs: Date.now(), ...used });
  if (problem) return null;
  return {
    code: found.offer.code, name: found.offer.name, benefit: found.offer.benefit, value: found.offer.value, minOrder: found.offer.minOrder,
    endsAt: found.offer.endsMs ? new Date(found.offer.endsMs).toISOString() : null, text: benefitText(found.offer)
  };
}

export type AppliedOffer = { offerId: string; orgId: string; branchId: string; code: string; discount: number; sendId: string };

/**
 * At order save (order form and cart auto-submit): the email offer this
 * order earns, worked out again on the server. Never throws: an order is
 * always saved, at full price when anything is off.
 */
export async function applyEmailOffer(input: { orgId: string; utmSource: unknown; utmContent: unknown; phone: unknown; productId: string | null; amount: number }): Promise<AppliedOffer | null> {
  try {
    if (String(input.utmSource ?? "").toLowerCase() !== "email") return null;
    const found = await offerOfToken(String(input.utmContent ?? ""));
    if (!found || found.offer.orgId !== input.orgId) return null;
    const used = await usage(found.offer.id, found.sendId, String(input.phone ?? "") || found.sendPhone, input.orgId);
    if (offerProblem(found.offer, { productId: input.productId, amount: input.amount, nowMs: Date.now(), ...used })) return null;
    const discount = discountFor(found.offer, input.amount);
    if (discount <= 0) return null;
    return { offerId: found.offer.id, orgId: found.offer.orgId, branchId: found.offer.branchId, code: found.offer.code, discount, sendId: found.sendId };
  } catch (error) {
    logger.warn("email offer check failed: order saved at full price", { error: (error as Error).message });
    return null;
  }
}

/** After the order is saved: the redemption row (once per order). */
export async function recordRedemption(applied: AppliedOffer, orderId: string, phone: unknown, amountBefore: number) {
  const { error } = await supabase.from("email_offer_redemptions").upsert({
    org_id: applied.orgId, branch_id: applied.branchId, offer_id: applied.offerId, order_id: String(orderId), send_id: applied.sendId,
    phone: String(phone ?? "") || null, amount_before: amountBefore, discount: applied.discount
  }, { onConflict: "order_id", ignoreDuplicates: true });
  if (error) logger.warn("email offer: saving the redemption failed", { orderId, error: error.message });
}

/** The order fields for an applied offer (orders.amount is the lower amount). */
export const offerColumns = (applied: AppliedOffer | null) => (applied ? { offer_id: applied.offerId, offer_code: applied.code, offer_discount: applied.discount } : {});
