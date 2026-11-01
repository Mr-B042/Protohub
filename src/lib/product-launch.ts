/**
 * Product Launch stages (Bright, 1 Nov 2026) - the browser's half of
 * backend/src/lib/product-launch.ts (migration 314).
 *
 *  - silent "Silent Test": orders shared out as usual but seen only by the Owner.
 *  - soft "Soft Launch": seen and worked by everyone, left out of the weekly
 *    report's delivery rate; delivered ones still pay.
 *  - live: a normal product.
 */
export type LaunchStage = "live" | "silent" | "soft";

export type LaunchSettings = {
  silentCustomerMessages: boolean;
  silentHoldCarts: boolean;
  revealCustomerMessages: boolean;
  revealRepAlerts: boolean;
  softLeaveOutOfRate: boolean;
};

export const DEFAULT_LAUNCH_SETTINGS: LaunchSettings = {
  silentCustomerMessages: false,
  silentHoldCarts: true,
  revealCustomerMessages: true,
  revealRepAlerts: true,
  softLeaveOutOfRate: true
};

export const launchSettingsOf = (raw: Partial<LaunchSettings> | null | undefined): LaunchSettings => ({ ...DEFAULT_LAUNCH_SETTINGS, ...(raw ?? {}) });

export const normalizeLaunchStage = (value: unknown): LaunchStage =>
  value === "silent" || value === "soft" ? value : "live";

export const LAUNCH_STAGE_LABEL: Record<LaunchStage, string> = {
  live: "Live",
  silent: "Silent Test",
  soft: "Soft Launch"
};

/**
 * Leave this order out of the weekly report's delivery rate? Every Silent Test
 * order (only the Owner's screens ever hold one), and Soft Launch orders while
 * their product's setting says so. Its bonus is paid either way.
 */
export function outsideDeliveryRate(
  order: { launchStage?: LaunchStage; productId?: string | null },
  productSettings: (productId: string) => Partial<LaunchSettings> | null | undefined
) {
  if (order.launchStage === "silent") return true;
  if (order.launchStage !== "soft") return false;
  return launchSettingsOf(order.productId ? productSettings(order.productId) : null).softLeaveOutOfRate;
}
