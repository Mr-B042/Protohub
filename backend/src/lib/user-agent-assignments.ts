import { supabase } from "./supabase.js";

export async function loadAssignedAgentIdsByUser(orgId: string, userIds: string[]) {
  const ids = [...new Set(userIds.filter(Boolean))];
  const map = new Map<string, string[]>();
  for (const id of ids) map.set(id, []);
  if (ids.length === 0) return map;

  const { data, error } = await supabase
    .from("user_agent_assignments")
    .select("user_id, agent_id")
    .eq("org_id", orgId)
    .in("user_id", ids);
  if (error) throw error;

  for (const row of data ?? []) {
    const userId = typeof row.user_id === "string" ? row.user_id : "";
    const agentId = typeof row.agent_id === "string" ? row.agent_id : "";
    if (!userId || !agentId) continue;
    const current = map.get(userId) ?? [];
    current.push(agentId);
    map.set(userId, current);
  }
  return map;
}

export async function loadAssignedAgentIdsForUser(orgId: string, userId: string) {
  const map = await loadAssignedAgentIdsByUser(orgId, [userId]);
  return map.get(userId) ?? [];
}
