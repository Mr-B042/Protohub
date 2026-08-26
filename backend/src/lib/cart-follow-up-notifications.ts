import { supabase } from "./supabase.js";
import { logger } from "./logger.js";
import { sendPushToUsers } from "./push.js";
import { REPORT_ROW_CEILING } from "./query-limits.js";

/**
 * Nudges for assigned abandoned carts.
 *
 * Two different prompts, deliberately separate:
 *
 *  - A CALLBACK the rep promised. Time-specific, and the whole point of writing
 *    a date down is that something reminds you on the day.
 *  - A DIGEST of carts going quiet. Fresh carts get worked and older ones rot,
 *    so once a day the ones nobody has touched are named.
 *
 * Deliberately WITHOUT the miss/penalty machinery the order follow-up KPI has.
 * The ₦50-a-day rule is defined for orders; carts have no such rule and
 * inventing one here would charge reps against a target nobody set. These
 * notify. They never record a miss.
 *
 * "needs_attention" is the notification type because there is no cart-specific
 * one, and reusing an order_* type would file a cart prompt in the order feed.
 * Every row is addressed to a specific rep, so the org-wide audience filter
 * never applies to them.
 */
const CART_NOTIFICATION_TYPE = "needs_attention" as const;
const CART_QUEUE_LINK = "#/dashboard/admin/follow-up-queue";

// Outcomes that finish a cart. Same list the follow-up grid closes on: the
// order landed, they said no, showed interest, were rescheduled, or the number
// was never theirs. Anything else is still workable and still worth a nudge.
const CLOSING_OUTCOMES = new Set(["Interested", "Rescheduled", "Not interested", "Wrong number"]);
const CLOSING_CART_STATUSES = new Set(["Converted", "Not interested"]);

type CartRow = {
  id: string; org_id: string; customer: string | null; phone: string | null;
  assigned_rep_id: string | null; status: string | null;
  product_name: string | null; package_name: string | null;
  assigned_at: string | null; created_at: string | null;
};

/** One row per (rep, cart, day) so a rerun of the cron cannot double-notify. */
async function alreadyNotified(orgId: string, recipientId: string, tag: string) {
  const since = new Date(Date.now() - 20 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("system_notifications")
    .select("id")
    .eq("org_id", orgId)
    .eq("recipient_id", recipientId)
    .eq("type", CART_NOTIFICATION_TYPE)
    .eq("title", tag)
    .gte("created_at", since)
    .limit(1);
  if (error) {
    // Fail open rather than silently skipping a real reminder - a duplicate
    // nudge is a smaller failure than a callback nobody is told about.
    logger.warn("cart notification dedupe failed", { orgId, recipientId, error: error.message });
    return false;
  }
  return (data?.length ?? 0) > 0;
}

async function notifyRep(
  orgId: string, repId: string, title: string, message: string, cartId: string | null
) {
  if (await alreadyNotified(orgId, repId, title)) return false;

  const { error } = await supabase.from("system_notifications").insert({
    org_id: orgId,
    recipient_id: repId,
    type: CART_NOTIFICATION_TYPE,
    title,
    message,
    link: CART_QUEUE_LINK
  });
  if (error) {
    logger.warn("cart notification insert failed", { orgId, repId, cartId, error: error.message });
    return false;
  }

  await sendPushToUsers(orgId, [repId], {
    title,
    body: message,
    url: CART_QUEUE_LINK,
    // Tag by rep + title so a phone replaces the previous nudge rather than
    // stacking a column of them.
    tag: `cart-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${repId}`
  }).catch((pushError) => {
    logger.warn("cart notification push failed", {
      orgId, repId, error: pushError instanceof Error ? pushError.message : String(pushError)
    });
  });
  return true;
}

/**
 * A callback whose time has come. Runs often; each cart fires once per day.
 */
export async function syncDueCartCallbacks(limit = 200) {
  const nowIso = new Date().toISOString();
  const { data: due, error } = await supabase
    .from("cart_contact_attempts")
    .select("cart_id, org_id, next_action_at, rep_name, outcome_code")
    .not("next_action_at", "is", null)
    .lte("next_action_at", nowIso)
    .gte("next_action_at", new Date(Date.now() - 7 * 86400000).toISOString())
    .order("next_action_at", { ascending: false })
    .limit(limit);
  if (error) { logger.warn("cart callback sync failed", { error: error.message }); return { notified: 0 }; }

  const rows = due ?? [];
  if (rows.length === 0) return { notified: 0 };

  // Only the LATEST attempt per cart decides: an older promise that has since
  // been superseded is not still due.
  const latestByCart = new Map<string, any>();
  for (const row of rows) {
    if (!latestByCart.has(row.cart_id)) latestByCart.set(row.cart_id, row);
  }

  const cartIds = [...latestByCart.keys()];
  const { data: carts } = await supabase
    .from("abandoned_carts")
    .select("id, org_id, customer, phone, assigned_rep_id, status, product_name, package_name, assigned_at, created_at")
    .limit(REPORT_ROW_CEILING)
    .in("id", cartIds);

  let notified = 0;
  for (const cart of (carts ?? []) as CartRow[]) {
    if (!cart.assigned_rep_id) continue;
    if (CLOSING_CART_STATUSES.has(String(cart.status))) continue;
    const attempt = latestByCart.get(cart.id);
    if (CLOSING_OUTCOMES.has(String(attempt?.outcome_code))) continue;

    const who = cart.customer?.trim() || cart.phone || "a customer";
    // The customer is IN the title so the dedupe is naturally per-cart. Keyed
    // on "Callback due" alone, a rep with three promises due would have been
    // told about one of them and the other two would vanish.
    const ok = await notifyRep(
      cart.org_id,
      cart.assigned_rep_id,
      `Callback due · ${who}`,
      `You said you would call ${who} back${cart.phone ? ` on ${cart.phone}` : ""}. ${cart.package_name || cart.product_name || "Cart"}.`,
      cart.id
    );
    if (ok) notified += 1;
  }
  return { notified };
}

/**
 * Once a day: the carts a rep has gone quiet on. One notification listing the
 * count, not one per cart - a rep with nine stale carts should get a prompt,
 * not nine of them.
 */
export async function sendCartFollowUpDigest(staleDays = 2) {
  const cutoff = new Date(Date.now() - staleDays * 86400000).toISOString();

  const { data: carts, error } = await supabase
    .from("abandoned_carts")
    .select("id, org_id, customer, assigned_rep_id, status, last_activity, assigned_at, created_at")
    .limit(REPORT_ROW_CEILING)
    .not("assigned_rep_id", "is", null);
  if (error) { logger.warn("cart digest failed", { error: error.message }); return { notified: 0 }; }

  const open = (carts ?? []).filter((c: any) => !CLOSING_CART_STATUSES.has(String(c.status)));
  if (open.length === 0) return { notified: 0 };

  const { data: attempts } = await supabase
    .from("cart_contact_attempts")
    .select("cart_id, attempted_at")
    .limit(REPORT_ROW_CEILING)
    .in("cart_id", open.map((c: any) => c.id));

  const lastAttemptByCart = new Map<string, string>();
  for (const row of attempts ?? []) {
    const current = lastAttemptByCart.get(row.cart_id);
    if (!current || String(row.attempted_at) > current) lastAttemptByCart.set(row.cart_id, String(row.attempted_at));
  }

  // Group the quiet ones by the rep who owns them.
  const byRep = new Map<string, { orgId: string; never: number; stale: number }>();
  for (const cart of open as any[]) {
    const last = lastAttemptByCart.get(cart.id) ?? null;
    const isNever = !last;
    const isStale = Boolean(last) && String(last) < cutoff;
    if (!isNever && !isStale) continue;
    const key = `${cart.org_id}:${cart.assigned_rep_id}`;
    const entry = byRep.get(key) ?? { orgId: cart.org_id, never: 0, stale: 0 };
    if (isNever) entry.never += 1; else entry.stale += 1;
    byRep.set(key, entry);
  }

  let notified = 0;
  for (const [key, entry] of byRep) {
    const repId = key.split(":")[1];
    const total = entry.never + entry.stale;
    const parts = [
      entry.never > 0 ? `${entry.never} never called` : null,
      entry.stale > 0 ? `${entry.stale} with nothing logged for ${staleDays}+ days` : null
    ].filter(Boolean).join(" · ");
    const ok = await notifyRep(
      entry.orgId, repId,
      "Carts going quiet",
      `${total} assigned cart${total === 1 ? "" : "s"} need a call: ${parts}.`,
      null
    );
    if (ok) notified += 1;
  }
  return { notified };
}
