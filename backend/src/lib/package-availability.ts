import { supabase } from "./supabase.js";
import { normalizePackageComponents } from "./order-inventory.js";

export type PackageAvailabilityPackage = {
  id: string;
  product_id?: string | null;
  active?: boolean | null;
  quantity?: number | null;
  state_filter_mode?: "all" | "allow" | "block" | string | null;
  state_restrictions?: string[] | null;
  requires_state_stock?: boolean | null;
  package_components?: unknown;
};

const normalizeStateName = (value: string | null | undefined) => {
  const normalized = (value ?? "").trim().toLowerCase();
  if (!normalized) return "";
  if (normalized === "fct" || normalized === "abuja" || normalized === "fct abuja" || normalized.includes("federal capital")) {
    return "FCT Abuja";
  }
  return (value ?? "").trim();
};

export const packageAllowsState = (pkg: PackageAvailabilityPackage, state: string | null | undefined) => {
  const mode = pkg.state_filter_mode === "allow" || pkg.state_filter_mode === "block" ? pkg.state_filter_mode : "all";
  if (mode === "all") return true;
  const restrictions = Array.isArray(pkg.state_restrictions) ? pkg.state_restrictions : [];
  if (restrictions.length === 0) return mode === "block";
  const normalizedState = normalizeStateName(state);
  if (!normalizedState) return false;
  const matches = restrictions.map(normalizeStateName).includes(normalizedState);
  return mode === "block" ? !matches : matches;
};

const packageRequirements = (pkg: PackageAvailabilityPackage, fallbackProductId: string) => {
  const components = normalizePackageComponents(pkg.package_components);
  if (components.length > 0) {
    return components
      .filter((component) => component.productId)
      .map((component) => ({
        productId: component.productId,
        quantity: Math.max(1, Number(component.quantity) || 1)
      }));
  }
  return [{
    productId: String(pkg.product_id ?? fallbackProductId),
    quantity: Math.max(1, Number(pkg.quantity ?? 1) || 1)
  }];
};

export async function packageHasAgentStateStock(
  orgId: string,
  productId: string,
  pkg: PackageAvailabilityPackage,
  state: string | null | undefined
) {
  if (!pkg.requires_state_stock) return true;
  const normalizedState = normalizeStateName(state);
  if (!normalizedState) return false;

  const requirements = packageRequirements(pkg, productId);
  if (requirements.length === 0) return false;

  const { data, error } = await supabase
    .from("agent_locations")
    .select("state, active, stock:agent_location_stock(product_id, quantity)")
    .eq("org_id", orgId)
    .eq("active", true);
  if (error) throw error;

  const availableByProduct = new Map<string, number>();
  for (const location of data ?? []) {
    if (normalizeStateName(location.state) !== normalizedState) continue;
    const stockRows = Array.isArray(location.stock) ? location.stock : [];
    for (const row of stockRows) {
      const rowProductId = String(row.product_id ?? "");
      if (!rowProductId) continue;
      availableByProduct.set(
        rowProductId,
        (availableByProduct.get(rowProductId) ?? 0) + Math.max(0, Number(row.quantity ?? 0))
      );
    }
  }

  return requirements.every((requirement) =>
    (availableByProduct.get(requirement.productId) ?? 0) >= requirement.quantity
  );
}

export async function packageAvailabilityForState(
  orgId: string,
  productId: string,
  packages: PackageAvailabilityPackage[],
  state: string | null | undefined
) {
  const rows = [];
  for (const pkg of packages) {
    const stateAllowed = packageAllowsState(pkg, state);
    const stockReady = stateAllowed
      ? await packageHasAgentStateStock(orgId, productId, pkg, state)
      : false;
    rows.push({
      packageId: pkg.id,
      stateAllowed,
      stockReady,
      visible: pkg.active !== false && stateAllowed && (!pkg.requires_state_stock || stockReady),
      requiresStateStock: Boolean(pkg.requires_state_stock)
    });
  }
  return rows;
}
