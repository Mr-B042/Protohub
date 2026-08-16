// Shared role-group helpers. "Sales Rep", "Recovery Rep", and "Sales
// Closer" are all frontline reps who own a subset of orders/customers/
// contact-attempts - most access checks that gate on "Sales Rep" need the
// same behavior for the other two (see 82+ role checks across src/App.tsx
// and 25+ backend files - this predicate keeps "which sites changed and
// why" one grep-able set instead of scattered literal-string edits).
// A Sales Closer only ever ends up with assigned_rep_id orders once she
// converts a lead (Convert to Order); until then these checks are inert.
export const FRONTLINE_REP_ROLES = new Set(["Sales Rep", "Recovery Rep", "Sales Closer"]);

export const isFrontlineRepRole = (role: string | null | undefined): boolean =>
  !!role && FRONTLINE_REP_ROLES.has(role);
