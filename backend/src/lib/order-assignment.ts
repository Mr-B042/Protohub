import { supabase } from "./supabase.js";

export type OrderAssignment = {
  assignedRepId: string | null;
  // Snapshot label stored on the order: who/what made the assignment.
  assignedByLabel: string | null;
};

// Keep only the ids that are still valid active users in this org. A dedicated
// handler can be any role (Sales Rep, Admin, Owner) — it's an explicit pick that
// overrides the normal rotation rules — so we don't filter by role here.
export async function resolveDedicatedHandlerIds(
  orgId: string,
  ids: (string | null | undefined)[] | null | undefined
): Promise<string[]> {
  const wanted = Array.from(new Set((ids ?? []).filter(Boolean) as string[]));
  if (wanted.length === 0) return [];
  const { data } = await supabase
    .from("users")
    .select("id")
    .eq("org_id", orgId)
    .eq("active", true)
    .in("id", wanted);
  const valid = new Set((data ?? []).map((r) => r.id));
  // Preserve the caller's order, drop anything no longer valid.
  return wanted.filter((id) => valid.has(id));
}

// Pick the next assignee by round-robin position and advance them to the back of
// the line. `subsetIds` restricts the candidate pool to an explicit set of users
// (a product's dedicated handlers) and ignores the role / excluded filters, since
// those people were chosen deliberately. With no subset it's the normal global
// rotation: active, non-excluded Sales Reps only. Returns the chosen id or null.
async function pickAndAdvance(orgId: string, subsetIds: string[] | null): Promise<string | null> {
  let query = supabase
    .from("users")
    .select("id, round_robin_position")
    .eq("org_id", orgId)
    .eq("active", true);

  if (subsetIds && subsetIds.length > 0) {
    query = query.in("id", subsetIds);
  } else {
    // Paused-from-rotation reps keep their login (`active` untouched) but are
    // skipped here. Source of truth for the global round-robin.
    query = query.eq("round_robin_excluded", false).eq("role", "Sales Rep");
  }

  const { data: reps } = await query.order("round_robin_position", { ascending: true, nullsFirst: false });
  const rep = (reps ?? [])[0] ?? null;
  if (!rep) return null;

  const maxPos = (reps ?? []).reduce((m, r) => Math.max(m, r.round_robin_position ?? 0), 0);
  supabase
    .from("users")
    .update({ round_robin_position: maxPos + 1 })
    .eq("id", rep.id)
    .then(() => {}); // fire-and-forget
  return rep.id;
}

// Decide who an auto-assigned order goes to. If the product pins a non-empty set
// of dedicated handlers, round-robin among just those; otherwise the global
// round-robin. Falls back to the global rotation if the pinned set has nobody
// assignable, so an order is never dropped.
export async function assignOrderRep(
  orgId: string,
  dedicatedHandlerIds: (string | null | undefined)[] | null | undefined
): Promise<OrderAssignment> {
  const subset = await resolveDedicatedHandlerIds(orgId, dedicatedHandlerIds);
  if (subset.length > 0) {
    const pick = await pickAndAdvance(orgId, subset);
    if (pick) return { assignedRepId: pick, assignedByLabel: "Dedicated handler" };
  }
  const pick = await pickAndAdvance(orgId, null);
  return pick ? { assignedRepId: pick, assignedByLabel: "Round-robin" } : { assignedRepId: null, assignedByLabel: null };
}

// Read a product's dedicated-handler set, tolerating the transition window: prefer
// the new array column, fall back to the legacy single-id column.
export function dedicatedHandlerIdsOf(product: {
  dedicated_handler_user_ids?: (string | null)[] | null;
  dedicated_handler_user_id?: string | null;
}): string[] {
  const arr = product.dedicated_handler_user_ids;
  if (Array.isArray(arr) && arr.length > 0) return arr.filter(Boolean) as string[];
  return product.dedicated_handler_user_id ? [product.dedicated_handler_user_id] : [];
}
