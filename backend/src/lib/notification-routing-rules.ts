// Pure rules for alert routing (no database), so they can be unit-tested.
// See notification-routing.ts.

export const ROUTABLE_ROLES = [
  "Owner", "Admin", "Manager", "Sales Rep", "Recovery Rep", "Sales Closer",
  "Inventory Manager", "Inventory Manager & Logistics Operations", "Marketer"
] as const;

export type AlertKey =
  | "order_new" | "order_confirmed" | "order_delivered" | "order_cancelled" | "order_failed"
  | "order_rescheduled" | "order_assigned" | "order_recovered" | "order_follow_up"
  | "cart_new" | "cart_assigned";

export type AlertRoute = { roles: string[]; rep: boolean; push: boolean };

type AlertDef = { label: string; group: "Orders" | "Follow-ups" | "Abandoned carts"; hint: string; repApplies: boolean; defaults: AlertRoute };

export const ALERTS: Record<AlertKey, AlertDef> = {
  order_new:         { group: "Orders", label: "New order", hint: "A new order comes in.", repApplies: true, defaults: { roles: ["Owner", "Admin"], rep: true, push: true } },
  order_confirmed:   { group: "Orders", label: "Order confirmed", hint: "The customer confirmed the order.", repApplies: true, defaults: { roles: ["Owner", "Admin"], rep: false, push: true } },
  order_delivered:   { group: "Orders", label: "Order delivered", hint: "The order was delivered.", repApplies: true, defaults: { roles: ["Owner", "Admin"], rep: true, push: true } },
  order_failed:      { group: "Orders", label: "Order failed", hint: "Delivery failed.", repApplies: true, defaults: { roles: ["Owner", "Admin"], rep: false, push: true } },
  order_cancelled:   { group: "Orders", label: "Order cancelled", hint: "The order was cancelled.", repApplies: true, defaults: { roles: ["Owner", "Admin"], rep: false, push: true } },
  order_rescheduled: { group: "Orders", label: "Order rescheduled", hint: "The delivery date was moved.", repApplies: true, defaults: { roles: ["Owner", "Admin"], rep: true, push: true } },
  order_assigned:    { group: "Orders", label: "Order assigned", hint: "An order was given to a rep.", repApplies: true, defaults: { roles: [], rep: true, push: true } },
  order_recovered:   { group: "Orders", label: "Recovered order", hint: "An order that came in while the system was down.", repApplies: true, defaults: { roles: ["Owner", "Admin"], rep: true, push: true } },
  order_follow_up:   { group: "Follow-ups", label: "Follow-up due", hint: "A scheduled call or follow-up is due.", repApplies: true, defaults: { roles: ["Owner", "Admin"], rep: true, push: true } },
  cart_new:          { group: "Abandoned carts", label: "New abandoned cart", hint: "A customer left the order form without finishing.", repApplies: false, defaults: { roles: ["Owner", "Admin"], rep: false, push: true } },
  cart_assigned:     { group: "Abandoned carts", label: "Cart assigned", hint: "A cart was given to a rep to call.", repApplies: true, defaults: { roles: ["Owner", "Admin", "Manager"], rep: true, push: true } },
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
  };
}
