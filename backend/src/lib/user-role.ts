import type { UserRole } from "../types/index.js";

export const LEGACY_INVENTORY_ROLE = "Inventory Manager" as const;
export const INVENTORY_OPERATIONS_ROLE = "Inventory Manager & Logistics Operations" as const;

export function publicUserRole(role: string): UserRole {
  return (role === LEGACY_INVENTORY_ROLE ? INVENTORY_OPERATIONS_ROLE : role) as UserRole;
}

export function canFallbackToLegacyInventoryRole(error: { code?: string; message?: string } | null | undefined) {
  if (!error) return false;
  return error.code === "22P02"
    || /invalid input value for enum|Inventory Manager & Logistics Operations/i.test(error.message ?? "");
}
