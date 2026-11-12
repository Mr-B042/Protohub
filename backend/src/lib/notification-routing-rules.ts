// Pure rules for alert routing (no database), so they can be unit-tested.
// See notification-routing.ts.

export const ROUTABLE_ROLES = [
  "Owner", "Admin", "Manager", "Sales Rep", "Recovery Rep", "Sales Closer",
  "Inventory Manager", "Inventory Manager & Logistics Operations", "Marketer"
] as const;

export type AlertKey =
  | "order_new" | "order_confirmed" | "order_delivered" | "order_cancelled" | "order_failed"
  | "order_rescheduled" | "order_assigned" | "order_recovered" | "order_follow_up" | "order_late_send"
  | "cart_new" | "cart_assigned"
  | "campaign_no_orders" | "ad_account_low_funds"
  | "email_list_issue"
  | "social_lead_new" | "social_lead_reply" | "social_lead_overdue" | "social_lead_follow_up";

/** stay (Bright, 11 Nov 2026): the pop-up stays on screen until closed (Chrome/Edge; other browsers let it slide away). */
export type AlertRoute = { roles: string[]; rep: boolean; push: boolean; stay: boolean };

type AlertDef = { label: string; group: "Orders" | "Follow-ups" | "Abandoned carts" | "Social leads" | "Ads" | "Email"; hint: string; repApplies: boolean; defaults: AlertRoute };

export const ALERTS: Record<AlertKey, AlertDef> = {
  order_new:         { group: "Orders", label: "New order", hint: "A new order comes in.", repApplies: true, defaults: { roles: ["Owner", "Admin"], rep: true, push: true, stay: false } },
  order_confirmed:   { group: "Orders", label: "Order confirmed", hint: "The customer confirmed the order.", repApplies: true, defaults: { roles: ["Owner", "Admin"], rep: false, push: true, stay: false } },
  order_delivered:   { group: "Orders", label: "Order delivered", hint: "The order was delivered.", repApplies: true, defaults: { roles: ["Owner", "Admin"], rep: true, push: true, stay: false } },
  order_failed:      { group: "Orders", label: "Order failed", hint: "Delivery failed.", repApplies: true, defaults: { roles: ["Owner", "Admin"], rep: false, push: true, stay: true } },
  order_cancelled:   { group: "Orders", label: "Order cancelled", hint: "The order was cancelled.", repApplies: true, defaults: { roles: ["Owner", "Admin"], rep: false, push: true, stay: true } },
  order_rescheduled: { group: "Orders", label: "Order rescheduled", hint: "The delivery date was moved.", repApplies: true, defaults: { roles: ["Owner", "Admin"], rep: true, push: true, stay: false } },
  order_assigned:    { group: "Orders", label: "Order assigned", hint: "An order was given to a rep.", repApplies: true, defaults: { roles: [], rep: true, push: true, stay: false } },
  order_recovered:   { group: "Orders", label: "Recovered order", hint: "An order that came in while the system was down.", repApplies: true, defaults: { roles: ["Owner", "Admin"], rep: true, push: true, stay: false } },
  order_late_send:   { group: "Orders", label: "Order not sent out in 15 min", hint: "A rep left an order in New past 15 working minutes (from 10am, 11am on Mondays).", repApplies: true, defaults: { roles: ["Owner", "Admin", "Manager"], rep: false, push: true, stay: false } },
  order_follow_up:   { group: "Follow-ups", label: "Follow-up due", hint: "A scheduled call or follow-up is due.", repApplies: true, defaults: { roles: ["Owner", "Admin"], rep: true, push: true, stay: false } },
  cart_new:          { group: "Abandoned carts", label: "New abandoned cart", hint: "A customer left the order form without finishing.", repApplies: false, defaults: { roles: ["Owner", "Admin"], rep: false, push: true, stay: false } },
  campaign_no_orders: { group: "Ads", label: "Campaign with no order for 3 days", hint: "A running campaign spent money but brought no order for 3 days (Turn off / Watch / Check, by its cost per order since it started).", repApplies: false, defaults: { roles: ["Owner"], rep: false, push: true, stay: false } },
  // Bright, 12 Nov 2026: on by default, stays on screen (ads stop when the money runs out).
  ad_account_low_funds: { group: "Ads", label: "Ad account low on funds", hint: "A Meta ad account has less money left than your level (₦5,000 to start; change it on Tracking Hub › Ad Spend), or Meta stopped it for an unpaid bill. Reminds every 6 hours in the day until funded.", repApplies: false, defaults: { roles: ["Owner"], rep: false, push: true, stay: true } },
  cart_assigned:     { group: "Abandoned carts", label: "Cart assigned", hint: "A cart was given to a rep to call.", repApplies: true, defaults: { roles: ["Owner", "Admin", "Manager"], rep: true, push: true, stay: false } },
  // Social Leads Inbox (Bright, 12 Nov 2026): the rep on the lead gets these; managers get "no reply in time".
  social_lead_new:       { group: "Social leads", label: "New social lead", hint: "A Facebook or Instagram customer was given to a rep (or moved to them).", repApplies: true, defaults: { roles: [], rep: true, push: true, stay: false } },
  social_lead_reply:     { group: "Social leads", label: "Customer replied", hint: "A customer wrote again, or is still waiting 10 minutes for a reply.", repApplies: true, defaults: { roles: [], rep: true, push: true, stay: false } },
  social_lead_overdue:   { group: "Social leads", label: "No reply in time", hint: "A customer waited 15 working minutes without a reply (changeable in Social Leads Inbox › Settings).", repApplies: true, defaults: { roles: ["Owner", "Admin", "Manager"], rep: true, push: true, stay: false } },
  social_lead_follow_up: { group: "Social leads", label: "Social lead follow-up due", hint: "A follow-up the rep scheduled is due.", repApplies: true, defaults: { roles: [], rep: true, push: true, stay: false } },
  // Email Marketing › Audience Health (Bright, 8 Nov 2026).
  email_list_issue:  { group: "Email", label: "Email list problem", hint: "Audience Health found a new Critical or High problem (bounces, spam complaints, unsubscribes, sending set-up).", repApplies: false, defaults: { roles: ["Owner"], rep: false, push: false, stay: false } },
};

const ROLE_SET = new Set<string>(ROUTABLE_ROLES);

/** Clean one saved/posted route; anything unusable falls back to the default. */
export function cleanRoute(key: AlertKey, raw: unknown): AlertRoute {
  const def = ALERTS[key].defaults;
  if (!raw || typeof raw !== "object") return { ...def, roles: [...def.roles] };
  const r = raw as Record<string, unknown>;
  const roles = Array.isArray(r.roles) ? [...new Set(r.roles.filter((x): x is string => typeof x === "string" && ROLE_SET.has(x)))] : [...def.roles];
  return {
    roles,
    rep: ALERTS[key].repApplies ? (typeof r.rep === "boolean" ? r.rep : def.rep) : false,
    push: typeof r.push === "boolean" ? r.push : def.push,
    stay: typeof r.stay === "boolean" ? r.stay : def.stay,
  };
}
