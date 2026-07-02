import { supabase } from "./supabase.js";
import { logger } from "./logger.js";

export type BackofficeCartJourneyEventType =
  | "cart_date_changed"
  | "order_date_changed"
  | "order_assigned"
  | "order_reassigned"
  | "delivery_agent_assigned"
  | "delivery_agent_reassigned"
  | "order_status_changed"
  | "contact_attempt_logged";

type AppendCartJourneyEventArgs = {
  orgId: string;
  cartId: string;
  eventType: BackofficeCartJourneyEventType;
  productId?: string | null;
  packageId?: string | null;
  state?: string | null;
  companionProductId?: string | null;
  companionPackageId?: string | null;
  metadata?: Record<string, unknown>;
};

const sanitizeJourneyMetadata = (metadata: Record<string, unknown> | undefined) => {
  const next: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(metadata ?? {})) {
    if (
      typeof value === "string"
      || typeof value === "number"
      || typeof value === "boolean"
      || value === null
    ) {
      next[key] = value;
    }
  }
  return next;
};

export const appendCartJourneyEvent = async (args: AppendCartJourneyEventArgs) => {
  const payload = {
    org_id: args.orgId,
    cart_id: args.cartId,
    product_id: args.productId ?? null,
    package_id: args.packageId ?? null,
    state: args.state ?? null,
    event_type: args.eventType,
    companion_product_id: args.companionProductId ?? null,
    companion_package_id: args.companionPackageId ?? null,
    metadata: sanitizeJourneyMetadata(args.metadata)
  };
  const { error } = await supabase.from("cart_journey_events").insert(payload);
  if (error) {
    throw error;
  }
};

// cart_journey_events is an append-only log that grows ~1,400 rows/day with no
// bound — it had reached 120 MB (62% of the whole DB) with nothing pruning it.
// Keep a rolling window (default 60 days; env-tunable) so it stops running away.
// The Live-Pulse overview reads this table over a user-selected range, so the
// window is generous — lower CART_JOURNEY_RETENTION_DAYS to reclaim more if that
// view is never used beyond a shorter lookback. Floor of 14 days as a guard.
const CART_JOURNEY_RETENTION_DAYS = Math.max(14, Number(process.env.CART_JOURNEY_RETENTION_DAYS) || 60);
export async function pruneOldCartJourneyEvents(): Promise<number> {
  const cutoff = new Date(Date.now() - CART_JOURNEY_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { count, error } = await supabase
    .from("cart_journey_events")
    .delete({ count: "exact" })
    .lt("created_at", cutoff);
  if (error) {
    logger.warn("cart journey prune failed", { error: error.message });
    return 0;
  }
  return count ?? 0;
}
