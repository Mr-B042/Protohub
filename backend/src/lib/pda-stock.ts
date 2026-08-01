// Stock held by a Personal Delivery Agent.
//
// Every quantity change goes through `applyStockMovement` so that the ledger
// and the balance can never disagree - a balance nobody can explain is exactly
// what makes shrinkage invisible.
//
// Agents cannot change their own numbers. They report a discrepancy; a manager
// approves it; only then does anything move.
import { supabase } from "./supabase.js";

const STOCK = "pda_agent_stock";
const LEDGER = "pda_stock_ledger";

/** The columns a unit can occupy. Their sum is what the agent really holds. */
export type StockBucket =
  | "available" | "reserved" | "out_for_delivery"
  | "damaged" | "missing" | "awaiting_investigation";

export type StockMovementName =
  | "Received from company" | "Reserved for order" | "Released back to available"
  | "Out for delivery" | "Delivered to customer" | "Returned to available"
  | "Written off damaged" | "Written off missing" | "Under investigation"
  | "Adjustment approved" | "Returned to company";

/**
 * How each movement shifts units between buckets.
 * `from: null` means units enter from outside (a company transfer);
 * `to: null` means they leave the agent entirely (delivered, or written off).
 */
export const MOVEMENT_MAP: Record<StockMovementName, { from: StockBucket | null; to: StockBucket | null }> = {
  "Received from company":     { from: null,               to: "available" },
  "Reserved for order":        { from: "available",        to: "reserved" },
  "Released back to available":{ from: "reserved",         to: "available" },
  "Out for delivery":          { from: "reserved",         to: "out_for_delivery" },
  "Delivered to customer":     { from: "out_for_delivery", to: null },
  "Returned to available":     { from: "out_for_delivery", to: "available" },
  "Written off damaged":       { from: "available",        to: "damaged" },
  "Written off missing":       { from: "available",        to: "missing" },
  "Under investigation":       { from: "available",        to: "awaiting_investigation" },
  "Adjustment approved":       { from: "awaiting_investigation", to: "available" },
  "Returned to company":       { from: "available",        to: null }
};

export type StockRow = Record<StockBucket, number> & { id?: string };

const EMPTY: StockRow = {
  available: 0, reserved: 0, out_for_delivery: 0,
  damaged: 0, missing: 0, awaiting_investigation: 0
};

/** Total units physically with the agent (written-off units included: they are still unaccounted for). */
export function totalHeld(row: StockRow): number {
  return row.available + row.reserved + row.out_for_delivery
    + row.damaged + row.missing + row.awaiting_investigation;
}

/**
 * Whether a movement can be made, given what the agent currently holds.
 * Returned as a message rather than a boolean so the caller can say WHY -
 * "you cannot reserve 3 when only 1 is available" beats a generic failure.
 */
export function stockMovementBlocker(
  movement: StockMovementName, quantity: number, row: StockRow
): string | null {
  if (!Number.isInteger(quantity) || quantity <= 0) return "Quantity must be a whole number above zero.";
  const map = MOVEMENT_MAP[movement];
  if (!map) return `"${movement}" is not a recognised stock movement.`;
  if (map.from === null) return null;
  const held = row[map.from] ?? 0;
  if (held < quantity) {
    return `Only ${held} unit${held === 1 ? "" : "s"} in ${map.from.replace(/_/g, " ")}, cannot move ${quantity}.`;
  }
  return null;
}

/** Applies the movement to a balance in memory. Caller persists the result. */
export function applyToRow(movement: StockMovementName, quantity: number, row: StockRow): StockRow {
  const map = MOVEMENT_MAP[movement];
  const next = { ...row };
  if (map.from) next[map.from] = (next[map.from] ?? 0) - quantity;
  if (map.to) next[map.to] = (next[map.to] ?? 0) + quantity;
  return next;
}

export type MovementInput = {
  orgId: string;
  agentId: string;
  productId: string;
  productName?: string | null;
  movement: StockMovementName;
  quantity: number;
  orderId?: string | null;
  transferId?: string | null;
  note?: string | null;
  userId?: string | null;
  userName?: string | null;
};

/**
 * The one way agent stock ever changes: validate, move, write the ledger.
 * Returns an error message instead of throwing so routes can answer plainly.
 */
export async function applyStockMovement(input: MovementInput): Promise<{ error?: string; balance?: StockRow }> {
  const { data: existing } = await supabase.from(STOCK)
    .select("id, available, reserved, out_for_delivery, damaged, missing, awaiting_investigation")
    .eq("agent_id", input.agentId).eq("product_id", input.productId).maybeSingle();

  const current: StockRow = existing
    ? {
        id: existing.id,
        available: Number(existing.available ?? 0),
        reserved: Number(existing.reserved ?? 0),
        out_for_delivery: Number(existing.out_for_delivery ?? 0),
        damaged: Number(existing.damaged ?? 0),
        missing: Number(existing.missing ?? 0),
        awaiting_investigation: Number(existing.awaiting_investigation ?? 0)
      }
    : { ...EMPTY };

  const blocker = stockMovementBlocker(input.movement, input.quantity, current);
  if (blocker) return { error: blocker };

  const next = applyToRow(input.movement, input.quantity, current);

  if (existing) {
    const { error } = await supabase.from(STOCK).update({
      available: next.available, reserved: next.reserved, out_for_delivery: next.out_for_delivery,
      damaged: next.damaged, missing: next.missing, awaiting_investigation: next.awaiting_investigation,
      updated_at: new Date().toISOString()
    }).eq("id", existing.id);
    if (error) return { error: error.message };
  } else {
    const { error } = await supabase.from(STOCK).insert({
      org_id: input.orgId, agent_id: input.agentId, product_id: input.productId,
      available: next.available, reserved: next.reserved, out_for_delivery: next.out_for_delivery,
      damaged: next.damaged, missing: next.missing, awaiting_investigation: next.awaiting_investigation
    });
    if (error) return { error: error.message };
  }

  // The ledger records the balance AFTER the move, so a reader never has to
  // reconstruct it by replaying every earlier row - the mistake that made an
  // agent's balance read -86 when the real figure was 1.
  await supabase.from(LEDGER).insert({
    org_id: input.orgId,
    agent_id: input.agentId,
    product_id: input.productId,
    product_name: input.productName ?? null,
    movement: input.movement,
    quantity: input.quantity,
    balance_after: next.available,
    order_id: input.orderId ?? null,
    transfer_id: input.transferId ?? null,
    note: input.note ?? null,
    recorded_by: input.userId ?? null,
    recorded_by_name: input.userName ?? null
  });

  return { balance: next };
}
