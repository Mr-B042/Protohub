import { supabase } from "./supabase.js";
import { normalizeCity, normalizeState } from "./agent-coverage.js";

export type AgentLocationRecord = {
  id: string;
  org_id: string;
  agent_id: string;
  name: string;
  state: string;
  city: string;
  address: string | null;
  phone_override: string | null;
  active: boolean;
  is_primary: boolean;
  notes: string | null;
  stock?: Array<{
    product_id?: string;
    productId?: string;
    quantity?: number | null;
    defective?: number | null;
    missing?: number | null;
  }> | null;
};

type CoverageSeed = {
  state: string;
  city?: string | null;
  active?: boolean;
};

const locationName = (state: string, city?: string | null) => {
  const normalizedState = normalizeState(state);
  const normalizedCity = normalizeCity(city);
  return normalizedCity ? `${normalizedCity}, ${normalizedState} Hub` : `${normalizedState} Hub`;
};

const locationKey = (state: string, city?: string | null) =>
  `${normalizeState(state).toLowerCase()}::${normalizeCity(city).toLowerCase()}`;

const locationStockForProduct = (location: AgentLocationRecord, productId: string | null | undefined) => {
  if (!productId) return 0;
  return (location.stock ?? []).reduce((sum, row) => {
    const rowProductId = String(row.product_id ?? row.productId ?? "");
    if (rowProductId !== productId) return sum;
    return sum + Math.max(0, Number(row.quantity ?? 0));
  }, 0);
};

const normalizeOrgId = (orgId: string | string[]) =>
  Array.isArray(orgId) ? String(orgId[0] ?? "") : String(orgId);

export async function syncAgentLocationsFromCoverage(orgId: string | string[], agentId: string) {
  const safeOrgId = normalizeOrgId(orgId);
  const { data: agent, error: agentError } = await supabase
    .from("agents")
    .select("id, org_id, zone, primary_base_state, address, coverage:agent_coverage(state, city, active)")
    .eq("id", agentId)
    .eq("org_id", safeOrgId)
    .single();
  if (agentError) throw agentError;
  if (!agent) throw new Error("Agent not found.");

  const desiredBaseState = normalizeState(agent.primary_base_state) || normalizeState(agent.zone);
  const coverageSeeds: CoverageSeed[] = Array.isArray(agent.coverage)
    ? agent.coverage.map((row: any) => ({
        state: normalizeState(row.state),
        city: normalizeCity(row.city),
        active: row.active !== false
      }))
    : [];

  if (desiredBaseState && !coverageSeeds.some((row) => locationKey(row.state, row.city) === locationKey(desiredBaseState, ""))) {
    coverageSeeds.unshift({ state: desiredBaseState, city: "", active: true });
  }
  if (coverageSeeds.length === 0) {
    coverageSeeds.push({ state: desiredBaseState || "Unassigned", city: "", active: true });
  }

  const desired = new Map<string, CoverageSeed>();
  for (const seed of coverageSeeds) {
    const state = normalizeState(seed.state);
    if (!state) continue;
    desired.set(locationKey(state, seed.city), { state, city: normalizeCity(seed.city), active: seed.active !== false });
  }

  const { data: existingLocations, error: locationsError } = await supabase
    .from("agent_locations")
    .select("*")
    .eq("org_id", safeOrgId)
    .eq("agent_id", agentId)
    .order("created_at", { ascending: true });
  if (locationsError) throw locationsError;

  const existingByKey = new Map<string, any>();
  for (const location of existingLocations ?? []) {
    existingByKey.set(locationKey(location.state, location.city), location);
  }

  const inserts: Record<string, unknown>[] = [];
  const updates: Array<{ id: string; patch: Record<string, unknown> }> = [];
  const primaryKey = desiredBaseState ? locationKey(desiredBaseState, "") : desired.keys().next().value;

  for (const [key, seed] of desired.entries()) {
    const existing = existingByKey.get(key);
    const patch = {
      name: locationName(seed.state, seed.city),
      state: seed.state,
      city: normalizeCity(seed.city),
      address: agent.address ?? null,
      active: seed.active !== false,
      is_primary: key === primaryKey
    };
    if (existing) {
      updates.push({ id: existing.id, patch });
      existingByKey.delete(key);
    } else {
      inserts.push({
        org_id: safeOrgId,
        agent_id: agentId,
        ...patch,
        notes: key === primaryKey ? "Primary hub" : "Auto-created from coverage"
      });
    }
  }

  for (const location of existingByKey.values()) {
    updates.push({
      id: location.id,
      patch: {
        active: false,
        is_primary: false
      }
    });
  }

  if (inserts.length > 0) {
    const { error } = await supabase.from("agent_locations").insert(inserts);
    if (error) throw error;
  }

  for (const update of updates) {
    const { error } = await supabase
      .from("agent_locations")
      .update(update.patch)
      .eq("id", update.id)
      .eq("org_id", safeOrgId)
      .eq("agent_id", agentId);
    if (error) throw error;
  }

  const { data: syncedLocations, error: syncedError } = await supabase
    .from("agent_locations")
    .select("*, stock:agent_location_stock(product_id, quantity, defective, missing)")
    .eq("org_id", safeOrgId)
    .eq("agent_id", agentId)
    .order("is_primary", { ascending: false })
    .order("state", { ascending: true })
    .order("city", { ascending: true });
  if (syncedError) throw syncedError;
  return (syncedLocations ?? []) as AgentLocationRecord[];
}

export async function loadAgentLocations(orgId: string | string[], agentId: string) {
  const safeOrgId = normalizeOrgId(orgId);
  const { data, error } = await supabase
    .from("agent_locations")
    .select("*, stock:agent_location_stock(product_id, quantity, defective, missing)")
    .eq("org_id", safeOrgId)
    .eq("agent_id", agentId)
    .order("is_primary", { ascending: false })
    .order("state", { ascending: true })
    .order("city", { ascending: true });
  if (error) throw error;
  return (data ?? []) as AgentLocationRecord[];
}

export async function resolveAgentLocationForOrder(
  orgId: string | string[],
  agentId: string,
  args: {
    desiredState?: string | null;
    desiredCity?: string | null;
    productId?: string | null;
    explicitLocationId?: string | null;
    // Every product the order needs in stock (main + add-ons + free gifts).
    // When provided, hub selection ranks by ability to fulfill ALL lines, not
    // just the main product. Falls back to `productId` for older callers.
    requiredLines?: Array<{ productId: string; quantity: number }>;
  }
) {
  const locations = await loadAgentLocations(orgId, agentId);
  const activeLocations = locations.filter((location) => location.active !== false);
  const pool = activeLocations.length > 0 ? activeLocations : locations;
  if (pool.length === 0) return null;

  // A deliberate hub choice always wins: an explicit pick from the UI (the UI
  // gates cross-state selection) and, crucially, the reversal/delete paths that
  // pass the order's *stored* hub so stock is returned to where it was taken.
  if (args.explicitLocationId) {
    const explicit = pool.find((location) => location.id === args.explicitLocationId) ?? locations.find((location) => location.id === args.explicitLocationId);
    if (explicit) return explicit;
  }

  const wantedState = normalizeState(args.desiredState).toLowerCase();
  const wantedCity = normalizeCity(args.desiredCity).toLowerCase();

  // STRICT STATE ROUTING: an order placed in a state must be fulfilled from
  // that state's hub. When the order has a state, the candidate pool is
  // restricted to in-state hubs. If the agent has NO active hub in that state,
  // return null so the caller blocks/flags it — never silently route the order
  // to an out-of-state hub just because that hub has more stock.
  let candidates = pool;
  if (wantedState) {
    const stateHubs = pool.filter((location) => normalizeState(location.state).toLowerCase() === wantedState);
    if (stateHubs.length === 0) return null;
    candidates = stateHubs;
  }

  // Lines this order needs the hub to stock. Falls back to the single main
  // product so callers that haven't been updated still behave sensibly.
  const requiredLines = (args.requiredLines && args.requiredLines.length > 0)
    ? args.requiredLines
    : (args.productId ? [{ productId: String(args.productId), quantity: 1 }] : []);

  const fulfillment = (location: AgentLocationRecord) => {
    if (requiredLines.length === 0) return { fully: true, satisfied: 0, depth: 0 };
    let satisfied = 0;
    let depth = 0;
    let fully = true;
    for (const line of requiredLines) {
      const have = locationStockForProduct(location, line.productId);
      depth += Math.min(have, Math.max(1, line.quantity));
      if (have >= line.quantity) satisfied += 1; else fully = false;
    }
    return { fully, satisfied, depth };
  };

  const sorted = candidates.slice().sort((a, b) => {
    const fa = fulfillment(a);
    const fb = fulfillment(b);
    // 1. Hubs that can fulfill EVERY line (main + add-ons) first.
    if ((fa.fully ? 1 : 0) !== (fb.fully ? 1 : 0)) return (fb.fully ? 1 : 0) - (fa.fully ? 1 : 0);
    // 2. Then more lines satisfiable, then more total available stock depth.
    if (fa.satisfied !== fb.satisfied) return fb.satisfied - fa.satisfied;
    if (fa.depth !== fb.depth) return fb.depth - fa.depth;
    // 3. Then the primary hub.
    if ((a.is_primary ? 1 : 0) !== (b.is_primary ? 1 : 0)) return (b.is_primary ? 1 : 0) - (a.is_primary ? 1 : 0);
    // 4. Then city match (within the already state-matched pool).
    const aCityMatch = wantedCity && normalizeCity(a.city).toLowerCase() === wantedCity ? 1 : 0;
    const bCityMatch = wantedCity && normalizeCity(b.city).toLowerCase() === wantedCity ? 1 : 0;
    if (aCityMatch !== bCityMatch) return bCityMatch - aCityMatch;
    return a.name.localeCompare(b.name);
  });

  return sorted[0] ?? null;
}

export async function syncAgentStockAggregate(orgId: string | string[], agentId: string, productId: string) {
  const safeOrgId = normalizeOrgId(orgId);
  const { data: rows, error } = await supabase
    .from("agent_location_stock")
    .select("quantity, defective, missing")
    .eq("org_id", safeOrgId)
    .eq("agent_id", agentId)
    .eq("product_id", productId);
  if (error) throw error;

  const totals = (rows ?? []).reduce((acc, row) => ({
    quantity: acc.quantity + Math.max(0, Number(row.quantity ?? 0)),
    defective: acc.defective + Math.max(0, Number(row.defective ?? 0)),
    missing: acc.missing + Math.max(0, Number(row.missing ?? 0))
  }), { quantity: 0, defective: 0, missing: 0 });

  if (totals.quantity <= 0 && totals.defective <= 0 && totals.missing <= 0) {
    const { error: deleteError } = await supabase
      .from("agent_stock")
      .delete()
      .eq("agent_id", agentId)
      .eq("product_id", productId);
    if (deleteError) throw deleteError;
  } else {
    const { error: upsertError } = await supabase
      .from("agent_stock")
      .upsert({
        agent_id: agentId,
        product_id: productId,
        quantity: totals.quantity,
        defective: totals.defective,
        missing: totals.missing
      }, { onConflict: "agent_id,product_id" });
    if (upsertError) throw upsertError;
  }

  // Keep the denormalized products.agent_stock rollup in sync with the live sum
  // of agent_stock for this product. Order deliveries deduct agent_stock through
  // this function but historically left products.agent_stock untouched, so that
  // product-level total drifted chronically overstated (it's read by waybill and
  // agent stock checks). Re-summing here keeps it correct on every inventory delta.
  const { data: productRows, error: productSumError } = await supabase
    .from("agent_stock")
    .select("quantity")
    .eq("product_id", productId);
  if (productSumError) throw productSumError;
  const productAgentTotal = (productRows ?? []).reduce((sum, row) => sum + Math.max(0, Number(row.quantity ?? 0)), 0);
  const { error: productUpdateError } = await supabase
    .from("products")
    .update({ agent_stock: productAgentTotal })
    .eq("id", productId);
  if (productUpdateError) throw productUpdateError;

  return totals;
}

export async function buildAgentLocationSnapshot(
  orgId: string | string[],
  agentId: string,
  args: {
    desiredState?: string | null;
    desiredCity?: string | null;
    productId?: string | null;
    explicitLocationId?: string | null;
    requiredLines?: Array<{ productId: string; quantity: number }>;
  }
) {
  const location = await resolveAgentLocationForOrder(orgId, agentId, args);
  return {
    agent_location_id: location?.id ?? null,
    agent_location_name_snapshot: location?.name ?? null,
    agent_location_state_snapshot: location?.state ?? null,
    agent_location_city_snapshot: normalizeCity(location?.city) || null
  };
}
