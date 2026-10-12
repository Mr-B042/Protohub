import { supabase } from "./supabase.js";
import { logger } from "./logger.js";

// ── An order's delivery fee, booked as a cost BY THE SERVER (Bright, 12 Oct 2026)
//
// "Any order inputed with delivery fee and mark it failed delivery fee should
// be take note."
//
// The cost row (EXP-DEL-<order>) used to be written by the browser, as a second
// request after the fee was saved on the order. Three things went wrong:
//   • the second request could fail or be refused (a Recovery Rep may type a
//     fee but could not save an expense) and the fee sat on the order with no
//     cost behind it;
//   • a failed order has no delivery date, so its cost was dated to the day the
//     order was PLACED and landed in an old week nobody was looking at;
//   • nothing re-booked it when only the status changed on the server.
// The two order routes now call this after every save that touches the fee,
// the status or the delivered date, whoever made the change.

export type DeliveryExpenseOrder = {
  id: string;
  status?: string | null;
  customer?: string | null;
  logistics_cost?: number | string | null;
  currency?: string | null;
  product_id?: string | null;
  delivered_date?: string | null;
  created_at?: string | null;
};

export const deliveryExpenseId = (orderId: string) => `EXP-DEL-${orderId}`;

const isFailedStatus = (status: string | null | undefined) => status === "Failed" || status === "Cancelled";

const lagosDay = (value: string | Date) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
};

/**
 * The cost row an order should have, or null when it should have none.
 *
 * `failedOn` is the day the order was marked Failed/Cancelled. A failed trip is
 * a cost of the day it failed, not of the day the order came in.
 */
export function deliveryExpenseFor(order: DeliveryExpenseOrder, failedOn: string | null, today: string) {
  const fee = Number(order.logistics_cost ?? 0);
  if (!Number.isFinite(fee) || fee <= 0) return null;
  const failed = isFailedStatus(order.status);
  const customer = String(order.customer ?? "").trim();
  const date = failed
    ? (failedOn ?? today)
    : String(order.delivered_date ?? "").slice(0, 10) || (order.created_at ? lagosDay(order.created_at) : today);
  return {
    id: deliveryExpenseId(order.id),
    category: failed ? "Failed Delivery" : "Delivery",
    description: failed
      ? `Failed delivery cost for ${order.id} - ${customer} (${order.status})`
      : `Delivery cost for ${order.id} - ${customer}`,
    amount: fee,
    currency: ["NGN", "USD", "GBP"].includes(String(order.currency)) ? String(order.currency) : "NGN",
    date,
    productId: order.product_id ?? null
  };
}

/** The day this order was last moved INTO its failed status, from its history. */
async function failedDay(orgId: string, order: DeliveryExpenseOrder): Promise<string | null> {
  const { data, error } = await supabase.from("order_audit")
    .select("from_status, to_status, created_at")
    .eq("org_id", orgId).eq("order_id", order.id).eq("to_status", order.status as string)
    .order("created_at", { ascending: false }).limit(20);
  if (error) throw error;
  const moved = (data ?? []).find((row: any) => row.from_status !== row.to_status);
  return moved ? lagosDay(moved.created_at as string) : null;
}

/**
 * Books, updates or removes the order's delivery cost so it always matches the
 * order. Never throws: a cost that could not be booked must not undo an order
 * save that already happened. It is logged instead.
 */
export async function syncOrderDeliveryExpense(orgId: string, order: DeliveryExpenseOrder | null | undefined): Promise<void> {
  if (!order?.id) return;
  try {
    const id = deliveryExpenseId(order.id);
    const fee = Number(order.logistics_cost ?? 0);
    if (!Number.isFinite(fee) || fee <= 0) {
      const { error } = await supabase.from("expenses").delete().eq("id", id).eq("org_id", orgId);
      if (error) throw error;
      return;
    }
    const today = lagosDay(new Date());
    let failedOn: string | null = null;
    if (isFailedStatus(order.status)) {
      failedOn = await failedDay(orgId, order);
      if (!failedOn) {
        // No history of the change (older orders): keep the day already booked
        // for a failed cost instead of moving it to today on every re-save.
        const { data: existing, error } = await supabase.from("expenses").select("date, category").eq("id", id).eq("org_id", orgId).maybeSingle();
        if (error) throw error;
        if (existing?.category === "Failed Delivery") failedOn = String(existing.date).slice(0, 10);
      }
    }
    const row = deliveryExpenseFor(order, failedOn, today);
    if (!row) return;
    // Upsert by id, and only these columns: a cost already marked as paid from
    // the manager's wallet (bank_account_id) keeps that mark.
    const { error } = await supabase.from("expenses").upsert({
      id: row.id, org_id: orgId, date: row.date, category: row.category, description: row.description,
      amount: row.amount, currency: row.currency, product_id: row.productId
    }, { onConflict: "id" });
    if (error) throw error;
  } catch (err: any) {
    logger.warn?.("order delivery expense not booked", { orderId: order.id, error: err?.message ?? String(err) });
  }
}
