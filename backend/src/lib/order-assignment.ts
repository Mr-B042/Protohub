import { supabase } from "./supabase.js";

export type OrderAssignment = {
  assignedRepId: string | null;
  // Snapshot label stored on the order: who/what made the assignment.
  assignedByLabel: string | null;
};

// Global round-robin fallback — active, non-excluded Sales Reps only, keyed
// off users.round_robin_position (the Active Sequence tab). Unchanged
// semantics from before weighted dedicated handlers existed: used whenever a
// product has no dedicated handler set, or its set has nobody eligible.
async function pickAndAdvance(orgId: string): Promise<string | null> {
  const { data: reps } = await supabase
    .from("users")
    .select("id, round_robin_position")
    .eq("org_id", orgId)
    .eq("active", true)
    .eq("round_robin_excluded", false)
    .eq("role", "Sales Rep")
    .order("round_robin_position", { ascending: true, nullsFirst: false });

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

// Weighted pick among a product's dedicated handlers (see migration 148).
// Delegates the read + advance to a single Postgres function so they happen
// atomically under concurrent order creation — a plain SELECT-then-UPDATE
// from Node would race two simultaneous orders into picking the same
// least-loaded rep twice. Returns null when the product has no dedicated
// handler rows, or none are eligible (active user, weight > 0), same
// "fall back to global" contract the old subset branch had.
async function pickWeightedDedicatedHandler(orgId: string, productId: string): Promise<string | null> {
  const { data, error } = await supabase.rpc("pick_and_advance_dedicated_handler", {
    p_product_id: productId,
    p_org_id: orgId
  });
  if (error) return null; // plumbing failure — fall back rather than drop the order
  return (data as string | null) ?? null;
}

// Decide who an auto-assigned order goes to. Tries the product's weighted
// dedicated handlers first; falls back to the global rotation if the product
// has none, or its set has nobody eligible right now, so an order is never
// dropped.
export async function assignOrderRep(orgId: string, productId: string): Promise<OrderAssignment> {
  const pick = await pickWeightedDedicatedHandler(orgId, productId);
  if (pick) return { assignedRepId: pick, assignedByLabel: "Dedicated handler" };

  const fallback = await pickAndAdvance(orgId);
  return fallback ? { assignedRepId: fallback, assignedByLabel: "Round-robin" } : { assignedRepId: null, assignedByLabel: null };
}
