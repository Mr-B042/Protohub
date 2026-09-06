import { randomUUID } from "node:crypto";
import { supabase } from "./supabase.js";

export type InventoryScope = "warehouse" | "agent_location";

export type AtomicInventoryMovement = {
  productId: string;
  productName?: string | null;
  type: string;
  quantity: number;
  ledgerQuantity?: number;
  sourceScope?: InventoryScope | null;
  sourceAgentLocationId?: string | null;
  destinationScope?: InventoryScope | null;
  destinationAgentLocationId?: string | null;
  bucketAgentLocationId?: string | null;
  defectiveDelta?: number;
  missingDelta?: number;
  agentId?: string | null;
  orderId?: string | null;
  waybillId?: string | null;
  fromLocation?: string | null;
  toLocation?: string | null;
  note?: string | null;
  idempotencyKey: string;
  movementId?: string;
};

export type AtomicInventoryMovementResult = {
  movementId: string;
  idempotencyKey: string;
  duplicate: boolean;
  sourceBalanceAfter: number | null;
  destinationBalanceAfter: number | null;
};

export class InventoryMovementError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, code = "INVENTORY_MOVEMENT_FAILED", status = 500) {
    super(message);
    this.name = "InventoryMovementError";
    this.code = code;
    this.status = status;
  }
}
const positiveInteger = (value: unknown, field: string) => {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw new InventoryMovementError(`${field} must be a whole number above zero.`, "INVALID_INVENTORY_MOVEMENT", 400);
  }
  return number;
};

const signedInteger = (value: unknown, field: string) => {
  const number = Number(value);
  if (!Number.isInteger(number)) {
    throw new InventoryMovementError(`${field} must be a whole number.`, "INVALID_INVENTORY_MOVEMENT", 400);
  }
  return number;
};

/**
 * Convert API-shaped movement lines into the compact JSON contract accepted by
 * the Postgres writer. Keeping this pure makes the transaction boundary easy to
 * regression-test without a live database.
 */
export function atomicInventoryPayload(lines: AtomicInventoryMovement[]) {
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new InventoryMovementError("At least one inventory movement is required.", "INVALID_INVENTORY_MOVEMENT", 400);
  }
  if (lines.length > 100) {
    throw new InventoryMovementError("A single inventory operation cannot exceed 100 product lines.", "INVALID_INVENTORY_MOVEMENT", 400);
  }

  const keys = new Set<string>();
  return lines.map((line) => {
    const productId = String(line.productId ?? "").trim();
    const type = String(line.type ?? "").trim();
    const idempotencyKey = String(line.idempotencyKey ?? "").trim();
    if (!productId || !type || !idempotencyKey) {
      throw new InventoryMovementError("Product, movement type, and retry key are required.", "INVALID_INVENTORY_MOVEMENT", 400);
    }
    if (keys.has(idempotencyKey)) {
      throw new InventoryMovementError(`Duplicate inventory retry key: ${idempotencyKey}`, "DUPLICATE_INVENTORY_KEY", 400);
    }
    keys.add(idempotencyKey);

    const sourceScope = line.sourceScope ?? null;
    const destinationScope = line.destinationScope ?? null;
    if (!sourceScope && !destinationScope) {
      throw new InventoryMovementError("Every inventory movement needs a source or destination.", "INVALID_INVENTORY_MOVEMENT", 400);
    }
    if (sourceScope === "agent_location" && !line.sourceAgentLocationId) {
      throw new InventoryMovementError("Source hub is required.", "INVALID_INVENTORY_MOVEMENT", 400);
    }
    if (destinationScope === "agent_location" && !line.destinationAgentLocationId) {
      throw new InventoryMovementError("Destination hub is required.", "INVALID_INVENTORY_MOVEMENT", 400);
    }

    const quantity = positiveInteger(line.quantity, "Inventory quantity");
    return {
      movementId: line.movementId ?? `MOV-${randomUUID()}`,
      idempotencyKey,
      productId,
      productName: String(line.productName ?? "").trim() || null,
      type,
      quantity,
      ledgerQuantity: line.ledgerQuantity === undefined ? quantity : signedInteger(line.ledgerQuantity, "Ledger quantity"),
      sourceScope,
      sourceAgentLocationId: line.sourceAgentLocationId ?? null,
      destinationScope,
      destinationAgentLocationId: line.destinationAgentLocationId ?? null,
      bucketAgentLocationId: line.bucketAgentLocationId ?? null,
      defectiveDelta: signedInteger(line.defectiveDelta ?? 0, "Defective change"),
      missingDelta: signedInteger(line.missingDelta ?? 0, "Missing change"),
      agentId: line.agentId ?? null,
      orderId: line.orderId ?? null,
      waybillId: line.waybillId ?? null,
      fromLocation: line.fromLocation ?? null,
      toLocation: line.toLocation ?? null,
      note: line.note ?? null
    };
  });
}

const classifyDatabaseError = (message: string) => {
  const normalized = message.trim();
  if (normalized.startsWith("INSUFFICIENT_STOCK|")) {
    return new InventoryMovementError(normalized.split("|").slice(1).join("|") || "Not enough stock.", "INSUFFICIENT_STOCK", 409);
  }
  if (normalized.startsWith("INVENTORY_CONFLICT|")) {
    return new InventoryMovementError(normalized.split("|").slice(1).join("|") || "Inventory changed concurrently.", "INVENTORY_CONFLICT", 409);
  }
  if (normalized.startsWith("INVALID_INVENTORY|")) {
    return new InventoryMovementError(normalized.split("|").slice(1).join("|") || "Invalid inventory movement.", "INVALID_INVENTORY_MOVEMENT", 400);
  }
  return new InventoryMovementError(normalized || "Inventory movement failed.");
};

/**
 * The only application writer for warehouse and hub quantities. Postgres locks
 * the affected products, validates every line, changes all balances, refreshes
 * aggregate caches, and inserts every ledger row in one transaction. A failure
 * rolls the whole batch back; a retry with the same keys is a no-op.
 */
export async function applyInventoryMovements(args: {
  orgId: string;
  actorUserId?: string | null;
  actorName?: string | null;
  lines: AtomicInventoryMovement[];
}): Promise<AtomicInventoryMovementResult[]> {
  const payload = atomicInventoryPayload(args.lines);
  const { data, error } = await supabase.rpc("apply_inventory_movements", {
    p_org_id: args.orgId,
    p_actor_user_id: args.actorUserId ?? null,
    p_actor_name: args.actorName ?? null,
    p_lines: payload
  });
  if (error) throw classifyDatabaseError(error.message);

  return (Array.isArray(data) ? data : []).map((row: any) => ({
    movementId: String(row.movementId ?? ""),
    idempotencyKey: String(row.idempotencyKey ?? ""),
    duplicate: row.duplicate === true,
    sourceBalanceAfter: row.sourceBalanceAfter == null ? null : Number(row.sourceBalanceAfter),
    destinationBalanceAfter: row.destinationBalanceAfter == null ? null : Number(row.destinationBalanceAfter)
  }));
}
