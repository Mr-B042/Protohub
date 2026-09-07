// Stock held by a Personal Delivery Agent.
//
// Every quantity change goes through `applyStockMovement` so that the ledger
// and the balance can never disagree - a balance nobody can explain is exactly
// what makes shrinkage invisible.
//
// Agents cannot change their own numbers. They report a discrepancy; a manager
// approves it; only then does anything move.
import { randomUUID } from "node:crypto";
import { supabase } from "./supabase.js";

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
  idempotencyKey?: string | null;
};

/**
 * The one way agent stock ever changes: validate, move, write the ledger.
 * Returns an error message instead of throwing so routes can answer plainly.
 */
export async function applyStockMovement(input: MovementInput): Promise<{ error?: string; balance?: StockRow }> {
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
    return { error: "Quantity must be a whole number above zero." };
  }
  const idempotencyKey = input.idempotencyKey?.trim() || `pda:manual:${randomUUID()}`;
  const { data, error } = await supabase.rpc("apply_pda_stock_movement", {
    p_org_id: input.orgId,
    p_agent_id: input.agentId,
    p_product_id: input.productId,
    p_product_name: input.productName ?? null,
    p_movement: input.movement,
    p_quantity: input.quantity,
    p_order_id: input.orderId ?? null,
    p_transfer_id: input.transferId ?? null,
    p_note: input.note ?? null,
    p_recorded_by: input.userId ?? null,
    p_recorded_by_name: input.userName ?? null,
    p_idempotency_key: idempotencyKey
  });
  if (error) {
    const message = error.message
      .replace(/^INSUFFICIENT_PDA_STOCK\|/, "")
      .replace(/^INVALID_PDA_INVENTORY\|/, "");
    return { error: message || "Stock could not be updated." };
  }

  const row = (data ?? {}) as Record<string, unknown>;
  return {
    balance: {
      available: Number(row.available ?? 0),
      reserved: Number(row.reserved ?? 0),
      out_for_delivery: Number(row.outForDelivery ?? 0),
      damaged: Number(row.damaged ?? 0),
      missing: Number(row.missing ?? 0),
      awaiting_investigation: Number(row.awaitingInvestigation ?? 0)
    }
  };
}
