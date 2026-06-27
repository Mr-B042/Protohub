import { supabase } from "./supabase.js";

// A product can pin all its auto-assigned orders to one dedicated handler (a Sales Rep
// or Admin), bypassing the round-robin. Returns the handler id only if it's still a
// valid active user in the org — otherwise null, so assignment falls back to round-robin
// instead of routing orders to a deactivated/foreign account.
export async function resolveDedicatedHandlerId(orgId: string, handlerId: string | null | undefined): Promise<string | null> {
  if (!handlerId) return null;
  const { data } = await supabase
    .from("users")
    .select("id")
    .eq("id", handlerId)
    .eq("org_id", orgId)
    .eq("active", true)
    .maybeSingle();
  return data?.id ?? null;
}
