// ── Who may see what inside an alert (Bright, 6 Nov 2026) ───────────────────
// One list for the app's phone and in-app alerts AND for Telegram, so they can
// never drift apart. Alert routing (Settings) may send an alert to any role;
// what the alert SAYS still follows these lines:
//  - customer name, phone number and the amount: only roles that see customers
//    in the app (inventory/logistics, marketers, viewers and delivery agents
//    get the order without them - see inventory-operations-access.ts);
//  - ad spend: only the Owner and Admins.

const CUSTOMER_ROLES = new Set(["Owner", "Admin", "Manager", "Sales Rep", "Recovery Rep", "Sales Closer"]);
const AD_SPEND_ROLES = new Set(["Owner", "Admin"]);

export const alertSeesCustomer = (role: string | null | undefined) => CUSTOMER_ROLES.has(String(role ?? ""));
export const alertSeesAdSpend = (role: string | null | undefined) => AD_SPEND_ROLES.has(String(role ?? ""));
