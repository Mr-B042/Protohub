// Agent Access - who can sign in to the Personal Delivery Agent portal.
//
// The load-bearing idea of this screen is that AGENT STATUS and PORTAL ACCESS
// are two different questions. An agent can be on Probation and signing in
// perfectly well; an Active agent can have their portal blocked while an
// unremitted-cash problem is sorted out. Conflating them is how you either
// lock a working agent out or leave a terminated one able to sign in.
//
// Portal state is therefore DERIVED from the two facts that actually gate
// sign-in (is there a linked account, and is that account active) rather than
// stored in a third column that could silently disagree with them.

/** The three portal states the page can show, independent of account_status. */
export type PortalAccessState = "Active" | "Setup Required" | "Blocked";

export type PortalAccountFacts = {
  /** The agent's linked login, if one has ever been created. */
  userId?: string | null;
  /** users.active - false means the login exists but sign-in is refused. */
  userActive?: boolean | null;
};

export function portalAccessState(facts: PortalAccountFacts): PortalAccessState {
  if (!facts.userId) return "Setup Required";
  return facts.userActive === false ? "Blocked" : "Active";
}

// ── Phone as the login username ───────────────────────────
//
// Agents remember their phone number; many have no email at all, and the two
// on file already are unusable ("07087939085 / 09069284758"). So the phone is
// the username, mapped onto a stable synthetic address because Supabase auth
// is email-based here.
//
// Nothing is ever sent to these addresses - agent passwords are set by
// management and shown once, never emailed - so a non-routable domain is
// correct rather than merely convenient. `.invalid` is reserved by RFC 2606
// precisely so it can never resolve to a real mailbox.
export const PORTAL_LOGIN_DOMAIN = "pda.protohub.invalid";

/**
 * Reduce whatever was typed on an application form to one canonical Nigerian
 * mobile number, or null if it cannot be read as one.
 *
 * Real values this has to survive, taken from production:
 *   "09031550795,07089507603"      two numbers, comma separated
 *   "07087939085 / 09069284758"    two numbers, slash separated
 *   "+2347017461414"               international form
 *   "08067986000/07035031862"      no spaces
 *
 * The FIRST number wins - it is the one the agent gave as their primary, and
 * silently picking a different one would hand them a username they never
 * expect to type.
 */
export function normalizeLoginPhone(raw: unknown): string | null {
  const text = String(raw ?? "").trim();
  if (!text) return null;

  // Split on any separator a human might use between two numbers.
  const first = text.split(/[,/;]|\s{2,}|\sor\s/i)[0] ?? "";
  const digits = first.replace(/[^\d+]/g, "");
  if (!digits) return null;

  // +234 / 234 / 0 are the three ways the same line gets written.
  let local = digits;
  if (local.startsWith("+234")) local = `0${local.slice(4)}`;
  else if (local.startsWith("234") && local.length >= 13) local = `0${local.slice(3)}`;
  local = local.replace(/\D/g, "");
  if (local.length === 10 && !local.startsWith("0")) local = `0${local}`;

  // A Nigerian mobile is 11 digits and starts 0. Anything else is not a
  // number we can hand out as a username, and guessing at it would create an
  // account nobody can sign in to.
  if (!/^0\d{10}$/.test(local)) return null;
  return local;
}

/** The auth email a phone-based login is stored under. */
export function portalLoginEmail(phone: unknown): string | null {
  const normalized = normalizeLoginPhone(phone);
  return normalized ? `${normalized}@${PORTAL_LOGIN_DOMAIN}` : null;
}

/** True when an address is one of ours rather than a real mailbox. */
export function isPortalLoginEmail(email: unknown): boolean {
  return String(email ?? "").trim().toLowerCase().endsWith(`@${PORTAL_LOGIN_DOMAIN}`);
}

/**
 * Let an agent sign in by typing their phone number.
 *
 * Anything that reads as a Nigerian mobile is translated to its synthetic
 * address; anything else is passed through untouched so staff continue to
 * sign in with their real email on the very same form.
 */
export function resolveLoginIdentifier(typed: string): string {
  const text = String(typed ?? "").trim();
  if (text.includes("@")) return text.toLowerCase();
  const asPhone = portalLoginEmail(text);
  return asPhone ?? text.toLowerCase();
}

// ── Security attention ────────────────────────────────────

export type SecurityFacts = {
  portalState: PortalAccessState;
  /** auth.users.last_sign_in_at - null means the account has never been used. */
  lastLoginAt?: string | null;
  /** When the login was created. */
  accountCreatedAt?: string | null;
  /** Failed sign-in attempts against this account in the recent window. */
  recentFailedAttempts?: number;
  twoFactorRequired?: boolean;
  twoFactorEnrolled?: boolean;
};

/** How many failed attempts before an account is worth a human look. */
export const FAILED_ATTEMPT_THRESHOLD = 3;
/** An unused new account is normal; an unused OLD one is a stuck agent. */
export const STALE_UNUSED_DAYS = 3;

/**
 * Why this account needs a human look, in plain words - or an empty list.
 *
 * Returns REASONS rather than a boolean for the same reason the assignment
 * matcher does: a count on a card that cannot explain itself sends someone
 * hunting through rows one at a time.
 */
export function securityAttentionReasons(facts: SecurityFacts, now: Date = new Date()): string[] {
  const reasons: string[] = [];
  if (facts.portalState === "Setup Required") return reasons;

  const failed = facts.recentFailedAttempts ?? 0;
  if (failed >= FAILED_ATTEMPT_THRESHOLD) {
    reasons.push(`${failed} failed sign-in attempts recently`);
  }

  // Never signed in, and created long enough ago that it is not simply new.
  // These are the agents still sitting on a temporary password - exactly the
  // case that cost a lost password before.
  if (!facts.lastLoginAt && facts.accountCreatedAt) {
    const created = Date.parse(facts.accountCreatedAt);
    if (Number.isFinite(created)) {
      const days = (now.getTime() - created) / 86_400_000;
      if (days >= STALE_UNUSED_DAYS) {
        reasons.push(`Never signed in since the account was created ${Math.floor(days)} days ago - still on a temporary password`);
      }
    }
  }

  if (facts.twoFactorRequired && !facts.twoFactorEnrolled) {
    reasons.push("Two-factor authentication is required but not yet enrolled");
  }

  return reasons;
}

// ── Blockers shown before standing an agent down ──────────

export type AccountabilityFacts = {
  outstandingCod?: number;
  stockUnitsHeld?: number;
  openIncidents?: number;
  activeOrders?: number;
};

/**
 * What is still outstanding against an agent, listed before any suspend,
 * reactivate or terminate decision.
 *
 * Blocking the portal does NOT settle anything - the cash and stock are still
 * ours and still with them. This list exists so that never gets forgotten at
 * the moment someone is being stood down, which is precisely when it is
 * easiest to assume the problem has been dealt with.
 */
export function accountabilityBlockers(facts: AccountabilityFacts): string[] {
  const cod = Number(facts.outstandingCod ?? 0);
  const stock = Number(facts.stockUnitsHeld ?? 0);
  const incidents = Number(facts.openIncidents ?? 0);
  const orders = Number(facts.activeOrders ?? 0);
  const naira = (value: number) => `₦${Math.round(value).toLocaleString("en-NG")}`;

  return [
    cod > 0 ? `${naira(cod)} COD has not been remitted.` : null,
    stock > 0 ? `${stock} unit${stock === 1 ? "" : "s"} of company inventory are still with this agent.` : null,
    orders > 0 ? `${orders} active order${orders === 1 ? "" : "s"} still assigned.` : null,
    // Deliberately listed even at zero: "0 open incidents" is a fact worth
    // stating on a review screen, where silence reads as "not checked".
    `${incidents} open incident${incidents === 1 ? "" : "s"}.`
  ].filter((line): line is string => Boolean(line));
}
