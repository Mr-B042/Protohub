import { supabase } from "./supabase.js";
import { logger } from "./logger.js";
import { orderInventoryLinesFromRow } from "./order-inventory.js";

/**
 * Put items added AFTER delivery onto the inventory officer's screen.
 *
 * ⚠️ THE TRIGGER ONLY FIRES ON THE WAY INTO "DELIVERED".
 * capture_delivered_stock_pending builds the officer's list from the snapshot
 * taken at the instant the status changes to Delivered. Add a gift, an add-on
 * or an extra item afterwards and nothing re-runs, so the item never reaches
 * the screen and is never deducted - it leaves the shelf while the system
 * still counts it as in stock. Order 4238 is the case that surfaced it:
 * delivered on the 12th, two gifts added on the 14th, neither on the screen.
 *
 * ⚠️ CALL THIS FROM EVERY PATH THAT CHANGES WHAT AN ORDER CONTAINS.
 * There are three, and a fix in only one of them is not a fix: the general
 * order edit, the extra-items route, and the public upsell link a customer
 * can accept on their own. That is exactly why the work lives here rather
 * than inline in whichever route was being repaired at the time.
 */
export async function refreshPendingDeliveredLines(orgId: string, orderId: string): Promise<void> {
  try {
    const { data: order } = await supabase
      .from("orders").select("*")
      .eq("id", orderId).eq("org_id", orgId).maybeSingle();

    // ⚠️ ONLY WHILE THE ORDER IS STILL PENDING. A reconciled order records what
    // was actually counted off the shelf and must not move.
    if (!order) return;
    if (order.status !== "Delivered") return;
    if (order.stock_reconciliation_status !== "pending") return;
    if (!order.agent_id || !order.agent_location_id) return;

    const lines = orderInventoryLinesFromRow(order as any);
    if (lines.length === 0) return;

    await supabase.from("orders").update({
      stock_reconciliation_lines_snapshot: lines.map((line) => ({
        productId: line.productId,
        productName: line.productName,
        quantity: line.quantity
      }))
    }).eq("id", orderId).eq("org_id", orgId);

    const { data: listed } = await supabase
      .from("delivered_stock_reconciliation_lines")
      .select("product_id")
      .eq("org_id", orgId).eq("order_id", orderId);
    const listedIds = new Set((listed ?? []).map((row: any) => row.product_id));

    // ⚠️ INSERT ONLY WHAT IS ABSENT, NEVER REWRITE A ROW.
    // A line can already be reconciled while the order as a whole is pending.
    // Rewriting it would reset a finished count back to pending and drop the
    // stock movement that recorded it.
    const missing = lines
      .filter((line) => !listedIds.has(line.productId))
      .map((line) => ({
        org_id: orgId,
        order_id: orderId,
        agent_id: order.agent_id,
        agent_location_id: order.agent_location_id,
        state_snapshot: order.agent_location_state_snapshot ?? order.state ?? "",
        agent_name_snapshot: order.agent_name_snapshot ?? "",
        customer_snapshot: order.customer ?? "",
        product_id: line.productId,
        product_name_snapshot: line.productName,
        quantity: line.quantity,
        status: "pending",
        delivered_at: order.updated_at ?? new Date().toISOString()
      }));
    if (missing.length === 0) return;

    // Short stock does NOT refuse the change. The officer's screen already has
    // an exception route for a line it cannot cover, and settling it there
    // beats blocking somebody from recording what was actually sent.
    const { error } = await supabase
      .from("delivered_stock_reconciliation_lines").insert(missing);
    if (error) {
      logger.error("delivered stock: could not add late items to a pending order", {
        orderId, error: error.message
      });
    }
  } catch (error) {
    // Never fail the caller's save over this - the item change itself is the
    // thing the person asked for.
    logger.error("delivered stock: refreshing a pending order failed", {
      orderId, error: (error as Error).message
    });
  }
}
