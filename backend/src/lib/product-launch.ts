import { supabase } from "./supabase.js";

/**
 * Product Launch stages (Bright, 1 Nov 2026) - migration 314.
 *
 *  - silent ("Silent Test"): orders are shared out by round robin as usual,
 *    but only the Owner sees them or hears about them. Customers get no message.
 *  - soft ("Soft Launch"): everyone sees and works the orders; they are left
 *    out of the weekly report's delivery rate, and delivered ones still pay.
 *  - live: a normal product.
 *
 * Each order keeps the stage it came in under (orders.launch_stage, stamped by
 * a database trigger on every insert), so hiding and the rate rule follow the
 * ORDER, not whatever stage its product is in today.
 */
export type LaunchStage = "live" | "silent" | "soft";
export const LAUNCH_STAGES: LaunchStage[] = ["live", "silent", "soft"];

export type LaunchSettings = {
  /** Silent Test: send the customer the usual automatic messages. Bright: no. */
  silentCustomerMessages: boolean;
  /** Silent Test: keep the product's abandoned carts away from reps. */
  silentHoldCarts: boolean;
  /** At the switch to Soft Launch: send each customer their order confirmation then. */
  revealCustomerMessages: boolean;
  /** At the switch to Soft Launch: alert each rep (and leadership) as if the order had just come in. */
  revealRepAlerts: boolean;
  /** Soft Launch: leave these orders out of the weekly report's delivery rate. */
  softLeaveOutOfRate: boolean;
};

export const DEFAULT_LAUNCH_SETTINGS: LaunchSettings = {
  silentCustomerMessages: false,
  silentHoldCarts: true,
  revealCustomerMessages: true,
  revealRepAlerts: true,
  softLeaveOutOfRate: true
};

export const launchSettingsOf = (raw: unknown): LaunchSettings => {
  const value = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const pick = (key: keyof LaunchSettings) => (typeof value[key] === "boolean" ? value[key] as boolean : DEFAULT_LAUNCH_SETTINGS[key]);
  return {
    silentCustomerMessages: pick("silentCustomerMessages"),
    silentHoldCarts: pick("silentHoldCarts"),
    revealCustomerMessages: pick("revealCustomerMessages"),
    revealRepAlerts: pick("revealRepAlerts"),
    softLeaveOutOfRate: pick("softLeaveOutOfRate")
  };
};

export const isLaunchStage = (value: unknown): value is LaunchStage =>
  typeof value === "string" && (LAUNCH_STAGES as string[]).includes(value);

/** Who may see Silent Test orders: the Owner, and only when not previewing someone else. */
export const canSeeSilentOrders = (scopeRole: string | null | undefined) => scopeRole === "Owner";

/**
 * Leaves Silent Test orders out of an orders query for everyone but the Owner.
 * scopeRole must be the view-as aware role (effectiveUserRole ?? role), so an
 * Owner previewing a rep sees exactly what the rep sees.
 */
export function hideSilentOrders<Q extends { neq: (column: string, value: string) => Q }>(query: Q, scopeRole: string | null | undefined): Q {
  return canSeeSilentOrders(scopeRole) ? query : query.neq("launch_stage", "silent");
}

/**
 * The value for `.neq("launch_stage", ...)` on any orders read made for a
 * signed-in person: "silent" hides Silent Test orders, and for the Owner a
 * stage no order has, so nothing is hidden. One filter form everywhere keeps
 * launch-hide-guard.test.ts able to check every read.
 */
export const silentFilterFor = (scopeRole: string | null | undefined) => (canSeeSilentOrders(scopeRole) ? "owner-sees-all" : "silent");

/** The stage an order came in under ("live" when unknown). */
export async function orderLaunchStage(orgId: string, orderId: string): Promise<LaunchStage> {
  const { data } = await supabase.from("orders").select("launch_stage").eq("org_id", orgId).eq("id", orderId).maybeSingle();
  return isLaunchStage((data as any)?.launch_stage) ? (data as any).launch_stage : "live";
}

/** A product's stage and settings ("live" + defaults when unknown). */
export async function productLaunch(productId: string | null | undefined): Promise<{ stage: LaunchStage; settings: LaunchSettings }> {
  if (!productId) return { stage: "live", settings: DEFAULT_LAUNCH_SETTINGS };
  const { data } = await supabase.from("products").select("launch_stage, launch_settings").eq("id", productId).maybeSingle();
  return {
    stage: isLaunchStage((data as any)?.launch_stage) ? (data as any).launch_stage : "live",
    settings: launchSettingsOf((data as any)?.launch_settings)
  };
}

/** Product ids currently in Silent Test whose carts are held back from reps. */
export async function silentHeldCartProductIds(orgId: string): Promise<string[]> {
  const { data } = await supabase.from("products").select("id, launch_settings").eq("org_id", orgId).eq("launch_stage", "silent");
  return (data ?? []).filter((row: any) => launchSettingsOf(row.launch_settings).silentHoldCarts).map((row: any) => String(row.id));
}

/** Active Owners: the only people told about a Silent Test order. */
export async function ownerRecipients(orgId: string): Promise<Map<string, string>> {
  const { data } = await supabase.from("users").select("id, role").eq("org_id", orgId).eq("active", true).eq("role", "Owner");
  return new Map((data ?? []).map((row: any) => [String(row.id), "Owner"]));
}

/** Plain names for the stages, for alerts and history. */
export const LAUNCH_STAGE_LABEL: Record<LaunchStage, string> = {
  live: "Live",
  silent: "Silent Test",
  soft: "Soft Launch"
};

/** Allowed switches. Any stage can go to any other; staying put is not a switch. */
export const isAllowedSwitch = (from: LaunchStage, to: LaunchStage) => from !== to;

/** Orders a switch reveals: Silent Test orders become visible when leaving Silent Test. */
export const switchRevealsOrders = (from: LaunchStage, to: LaunchStage) => from === "silent" && to !== "silent";
