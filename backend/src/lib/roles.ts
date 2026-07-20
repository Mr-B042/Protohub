// Shared role-group helpers. "Sales Rep" and "Recovery Rep" are both
// frontline reps who own a subset of orders/customers/contact-attempts -
// most access checks that gate on "Sales Rep" need the same behavior for
// "Recovery Rep" (see 82+ role checks across src/App.tsx and 25+ backend
// files - this predicate keeps "which sites changed and why" one
// grep-able set instead of scattered literal-string edits).
export const FRONTLINE_REP_ROLES = new Set(["Sales Rep", "Recovery Rep"]);

export const isFrontlineRepRole = (role: string | null | undefined): boolean =>
  !!role && FRONTLINE_REP_ROLES.has(role);
