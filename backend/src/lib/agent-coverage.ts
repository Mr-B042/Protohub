import { supabase } from "./supabase.js";

export type AgentCoverageInput = {
  state: string;
  city?: string | null;
  coverageType?: "local_delivery" | "interstate_delivery" | "pickup_hub";
  priority?: number;
  active?: boolean;
  slaDays?: number;
  deliveryFeeRule?: string | null;
  notes?: string | null;
};

type AgentCoverageRow = {
  state: string;
  city: string;
  coverage_type: "local_delivery" | "interstate_delivery" | "pickup_hub";
  priority: number;
  active: boolean;
  sla_days: number;
  delivery_fee_rule: string | null;
  notes: string | null;
};

type AgentRecordForCoverage = {
  id: string;
  name: string;
  phone: string | null;
  zone: string | null;
  primary_base_state: string | null;
  coverage?: AgentCoverageRow[] | null;
};

const normalizeText = (value: unknown) =>
  typeof value === "string" ? value.trim() : "";

// The Abuja / Federal Capital Territory family is written many ways. Fold them
// all to one spelling so routing matches regardless of how the order or hub
// labels it (the only Nigerian "state" that is also commonly named by its city).
const ABUJA_ALIASES = new Set([
  "fct", "abuja", "fct abuja", "abuja fct", "fct abuja fct",
  "federal capital territory", "fct federal capital territory"
]);

// State labels arrive spelled many ways. Canonicalize so the SAME state always
// matches in routing/coverage: collapse whitespace, drop a trailing " State"
// descriptor ("Rivers State" -> "Rivers"), and fold the Abuja/FCT family. Only
// ever merges genuinely-identical states (never collapses two distinct states),
// so it can only ADD correct matches, never create a wrong one.
export const normalizeState = (value: unknown) => {
  const trimmed = normalizeText(value).replace(/\s+/g, " ");
  if (!trimmed) return "";
  const canonical = trimmed.replace(/\s+state$/i, "").trim();
  const key = canonical.toLowerCase().replace(/[.,()]/g, " ").replace(/\s+/g, " ").trim();
  if (ABUJA_ALIASES.has(key)) return "FCT Abuja";
  return canonical;
};
export const normalizeCity = (value: unknown) => normalizeText(value);

export function buildCoverageRows(
  primaryBaseState: string,
  coverage: AgentCoverageInput[] | null | undefined
): AgentCoverageRow[] {
  const normalizedPrimary = normalizeState(primaryBaseState);
  const source = Array.isArray(coverage) ? coverage : [];
  const rows = source
    .map((item) => ({
      state: normalizeState(item.state),
      city: normalizeCity(item.city),
      coverage_type: item.coverageType ?? "local_delivery",
      priority: Number.isFinite(item.priority) ? Math.max(0, Math.round(Number(item.priority))) : 100,
      active: item.active !== false,
      sla_days: Number.isFinite(item.slaDays) ? Math.max(0, Math.round(Number(item.slaDays))) : 1,
      delivery_fee_rule: normalizeText(item.deliveryFeeRule) || null,
      notes: normalizeText(item.notes) || null
    }))
    .filter((item) => item.state);

  if (normalizedPrimary && !rows.some((item) => item.state.toLowerCase() === normalizedPrimary.toLowerCase())) {
    rows.unshift({
      state: normalizedPrimary,
      city: "",
      coverage_type: "local_delivery",
      priority: 0,
      active: true,
      sla_days: 1,
      delivery_fee_rule: null,
      notes: "Primary base state"
    });
  }

  if (rows.length === 0 && normalizedPrimary) {
    rows.push({
      state: normalizedPrimary,
      city: "",
      coverage_type: "local_delivery",
      priority: 0,
      active: true,
      sla_days: 1,
      delivery_fee_rule: null,
      notes: "Primary base state"
    });
  }

  const seen = new Set<string>();
  return rows.filter((item) => {
    const key = `${item.state.toLowerCase()}::${item.city.toLowerCase()}::${item.coverage_type}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function coverageRowsForAgent(agent: Pick<AgentRecordForCoverage, "zone" | "primary_base_state" | "coverage">) {
  const rows = (agent.coverage ?? []).filter((row) => row.active !== false && normalizeState(row.state));
  if (rows.length > 0) return rows;
  const fallback = normalizeState(agent.primary_base_state) || normalizeState(agent.zone);
  if (!fallback) return [] as AgentCoverageRow[];
  return [{
    state: fallback,
    city: "",
    coverage_type: "local_delivery",
    priority: 100,
    active: true,
    sla_days: 1,
    delivery_fee_rule: null,
    notes: null
  }];
}

export function findBestCoverageMatch(
  agent: Pick<AgentRecordForCoverage, "zone" | "primary_base_state" | "coverage">,
  location: { state?: string | null; city?: string | null }
) {
  const wantedState = normalizeState(location.state).toLowerCase();
  const wantedCity = normalizeCity(location.city).toLowerCase();
  const rows = coverageRowsForAgent(agent);
  if (rows.length === 0) return null;

  const stateMatches = wantedState
    ? rows.filter((row) => normalizeState(row.state).toLowerCase() === wantedState)
    : [];

  const candidates = (stateMatches.length > 0 ? stateMatches : rows).slice().sort((a, b) => {
    const aCityMatch = wantedCity && normalizeCity(a.city).toLowerCase() === wantedCity ? 1 : 0;
    const bCityMatch = wantedCity && normalizeCity(b.city).toLowerCase() === wantedCity ? 1 : 0;
    if (aCityMatch !== bCityMatch) return bCityMatch - aCityMatch;
    const aLocal = a.coverage_type === "local_delivery" ? 1 : 0;
    const bLocal = b.coverage_type === "local_delivery" ? 1 : 0;
    if (aLocal !== bLocal) return bLocal - aLocal;
    if (a.priority !== b.priority) return a.priority - b.priority;
    return a.sla_days - b.sla_days;
  });

  return candidates[0] ?? null;
}

export async function loadAgentWithCoverage(orgId: string, agentId: string) {
  const { data, error } = await supabase
    .from("agents")
    .select("id, name, phone, zone, primary_base_state, coverage:agent_coverage(state, city, coverage_type, priority, active, sla_days, delivery_fee_rule, notes)")
    .eq("org_id", orgId)
    .eq("id", agentId)
    .single();
  if (error) throw error;
  return data as AgentRecordForCoverage | null;
}

export async function buildAgentAssignmentSnapshot(
  orgId: string,
  agentId: string,
  location: { state?: string | null; city?: string | null }
) {
  const agent = await loadAgentWithCoverage(orgId, agentId);
  if (!agent) {
    throw new Error("Agent not found in your organization.");
  }
  const coverage = findBestCoverageMatch(agent, location);
  return {
    agent_name_snapshot: agent.name,
    agent_phone_snapshot: agent.phone ?? null,
    agent_base_state_snapshot: normalizeState(agent.primary_base_state) || normalizeState(agent.zone) || null,
    agent_coverage_state_snapshot: coverage?.state ?? null,
    agent_coverage_city_snapshot: coverage?.city || null
  };
}

