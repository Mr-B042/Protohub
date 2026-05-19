import { supabase } from "./supabase.js";

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
