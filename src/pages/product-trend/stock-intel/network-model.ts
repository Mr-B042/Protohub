import { zoneForState } from "../../../lib/nigeria";
import type { StockIntelData, StockIntelRow, StockIntelStatus } from "../../../lib/api";
import { STATUS_ORDER, place } from "./shared";

// The distribution network as the diagrams draw it, worked out from the
// Owner's supply routes (stock_supply_routes) - never hard-coded.

export type RouteGroup = {
  key: string;
  kind: "hub" | "fallback" | "direct";
  /** Source state (hub) or the state itself (direct). */
  state: string;
  title: string;
  role: string;
  serves: string[];
  servesLabel: string;
  color: string;
  stock: number;
  speed: number;
  status: StockIntelStatus | null;
  locationIds: string[];
};

export const GROUP_COLORS = ["#2563eb", "#16a34a", "#22c55e", "#f59e0b", "#ef4444", "#a855f7", "#7c3aed", "#0891b2", "#db2777"];

const ZONE_SHORT: Record<string, string> = { "North-Central": "NC", "North-East": "NE", "North-West": "NW", "South-East": "SE", "South-South": "SS", "South-West": "SW" };
const isNorth = (state: string) => (zoneForState(state) ?? "").startsWith("North");
export const directTitle = (state: string) => (state === "Rivers" ? "PH (Rivers)" : place(state));

function servesLabel(states: string[], fallback: boolean, hubStates: Set<string> = new Set(), hubName: (state: string) => string = place) {
  if (states.length > 3 && states.every(isNorth)) return `Northern States (${states.length} states)`;
  if (fallback) {
    // "Ibadan (Fallback), Other SW States" (design): hubs it backs up by name, the rest by zone.
    const hubs = states.filter((s) => hubStates.has(s));
    const rest = states.filter((s) => !hubStates.has(s));
    const zones = new Set(rest.map((s) => ZONE_SHORT[zoneForState(s) ?? ""] ?? ""));
    const restLabel = rest.length === 0 ? [] : zones.size === 1 && [...zones][0] && rest.length > 1 ? [`Other ${[...zones][0]} States`] : rest.map(place);
    return [...hubs.map((s) => `${hubName(s)} (Fallback)`), ...restLabel].join(", ");
  }
  const names = states.map(place);
  return names.length > 4 ? `${names.slice(0, 4).join(", ")} +${names.length - 4} more` : names.join(", ");
}

export function buildRouteGroups(data: StockIntelData, rows: StockIntelRow[]): { groups: RouteGroup[]; other: string[] } {
  const general = data.routes.filter((r) => r.productId === null);
  const hubsIn = (state: string) => data.hubs.filter((h) => h.state === state);
  const primary = new Map<string, string[]>();
  const fallback = new Map<string, string[]>();
  for (const route of general) {
    if (!route.sourceState) continue;
    const map = route.priority === 1 ? primary : fallback;
    map.set(route.sourceState, [...(map.get(route.sourceState) ?? []), route.destState]);
  }
  const titleOf = (state: string) => { const hubs = hubsIn(state); return hubs.length === 1 ? hubs[0].agentName : `${place(state)} hubs`; };
  // A hub's town name for labels ("Ibadan" for an Oyo hub named Ibadan).
  const hubName = (state: string) => { const hubs = hubsIn(state); return hubs.length === 1 && hubs[0].hubName ? hubs[0].hubName : place(state); };
  const figures = (state: string) => {
    const own = rows.filter((r) => r.state === state);
    const worst = own.length ? own.reduce((w, r) => (STATUS_ORDER[r.status] < STATUS_ORDER[w] ? r.status : w), "Healthy" as StockIntelStatus) : null;
    return { stock: own.reduce((s, r) => s + r.usable, 0), speed: own.reduce((s, r) => s + r.speed, 0), status: worst, locationIds: hubsIn(state).map((h) => h.locationId) };
  };
  const groups: RouteGroup[] = [];
  const biggest = [...primary.entries()].sort((a, b) => b[1].length - a[1].length)[0]?.[0];
  for (const [state, dests] of [...primary.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const zone = ZONE_SHORT[zoneForState(state) ?? ""] ?? "";
    groups.push({ key: `hub-${state}`, kind: "hub", state, title: titleOf(state), role: state === biggest && dests.length > 3 ? "Main Hub" : `Primary${zone ? ` – ${zone}` : ""}`,
      serves: dests.sort(), servesLabel: servesLabel(dests, false), color: "", ...figures(state) });
  }
  for (const [state, dests] of fallback) {
    if (primary.has(state)) continue;
    const zone = ZONE_SHORT[zoneForState(state) ?? ""] ?? "";
    groups.push({ key: `fb-${state}`, kind: "fallback", state, title: titleOf(state), role: `Fallback${zone ? ` – ${zone}` : ""}`,
      serves: dests.sort(), servesLabel: servesLabel(dests, true, new Set(primary.keys()), hubName), color: "", ...figures(state) });
  }
  const sourceStates = new Set(groups.map((g) => g.state));
  for (const route of general.filter((r) => r.priority === 1 && r.sourceState === null)) {
    if (sourceStates.has(route.destState) || hubsIn(route.destState).length === 0) continue;
    groups.push({ key: `direct-${route.destState}`, kind: "direct", state: route.destState, title: directTitle(route.destState), role: "Direct",
      serves: [route.destState], servesLabel: `${place(route.destState)} State`, color: "", ...figures(route.destState) });
  }
  groups.forEach((g, i) => { g.color = GROUP_COLORS[i % GROUP_COLORS.length]; });
  const routed = new Set([...groups.map((g) => g.state), ...general.map((r) => r.destState)]);
  const other = [...new Set(data.hubs.map((h) => h.state))].filter((s) => !routed.has(s)).sort();
  return { groups, other };
}
