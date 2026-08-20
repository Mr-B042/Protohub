import assert from "node:assert/strict";
import test from "node:test";
import {
  accountabilityBlockers,
  isPortalLoginEmail,
  normalizeLoginPhone,
  portalAccessState,
  portalLoginEmail,
  resolveLoginIdentifier,
  securityAttentionReasons
} from "./pda-agent-access.js";

// ── Portal state is separate from agent status ────────────

test("no linked login reads as Setup Required", () => {
  assert.equal(portalAccessState({ userId: null }), "Setup Required");
});

test("a linked active login reads as Active", () => {
  assert.equal(portalAccessState({ userId: "u1", userActive: true }), "Active");
});

test("a linked but deactivated login reads as Blocked, not Setup Required", () => {
  // The distinction matters: Setup Required invites someone to create an
  // account that already exists, which would collide instead of unblocking.
  assert.equal(portalAccessState({ userId: "u1", userActive: false }), "Blocked");
});

// ── Phone normalisation, against real production values ───

test("a plain Nigerian mobile passes through", () => {
  assert.equal(normalizeLoginPhone("09063864901"), "09063864901");
});

test("international form is converted to local form", () => {
  assert.equal(normalizeLoginPhone("+2347017461414"), "07017461414");
  assert.equal(normalizeLoginPhone("2347017461414"), "07017461414");
});

test("the FIRST number wins when an agent gave two", () => {
  // Both of these are real values on production agent records.
  assert.equal(normalizeLoginPhone("09031550795,07089507603"), "09031550795");
  assert.equal(normalizeLoginPhone("07087939085 / 09069284758"), "07087939085");
  assert.equal(normalizeLoginPhone("08067986000/07035031862"), "08067986000");
});

test("spaces and punctuation inside one number are ignored", () => {
  assert.equal(normalizeLoginPhone(" 0803 123 4567 "), "08031234567");
  assert.equal(normalizeLoginPhone("080-312-34567"), "08031234567");
});

test("anything that is not a Nigerian mobile is refused rather than guessed at", () => {
  // Guessing here would mint an account with a username nobody can type.
  assert.equal(normalizeLoginPhone(""), null);
  assert.equal(normalizeLoginPhone(null), null);
  assert.equal(normalizeLoginPhone("12345"), null);
  assert.equal(normalizeLoginPhone("not a phone"), null);
  assert.equal(normalizeLoginPhone("080123456789012"), null);
});

test("a login email is derived from the normalised number", () => {
  assert.equal(portalLoginEmail("+2347017461414"), "07017461414@pda.protohub.invalid");
  assert.equal(portalLoginEmail("nonsense"), null);
});

test("portal addresses are recognisable so they are never shown as contact emails", () => {
  assert.equal(isPortalLoginEmail("07017461414@pda.protohub.invalid"), true);
  assert.equal(isPortalLoginEmail("websteven10@gmail.com"), false);
});

// ── Sign-in identifier resolution ─────────────────────────

test("typing a phone number resolves to the portal address", () => {
  assert.equal(resolveLoginIdentifier("09063864901"), "09063864901@pda.protohub.invalid");
});

test("staff signing in with a real email are untouched", () => {
  // The same login form serves both, so this must not rewrite staff logins.
  assert.equal(resolveLoginIdentifier("busybright042@gmail.com"), "busybright042@gmail.com");
  assert.equal(resolveLoginIdentifier("Busybright042@Gmail.com"), "busybright042@gmail.com");
});

test("an unreadable identifier is passed through so auth returns the normal error", () => {
  assert.equal(resolveLoginIdentifier("whoknows"), "whoknows");
});

// ── Security attention ────────────────────────────────────

const DAY = 86_400_000;
const now = new Date("2026-08-20T09:00:00Z");
const daysAgo = (n: number) => new Date(now.getTime() - n * DAY).toISOString();

test("an agent with no account raises nothing - there is nothing to secure yet", () => {
  const reasons = securityAttentionReasons(
    { portalState: "Setup Required", recentFailedAttempts: 99 }, now
  );
  assert.deepEqual(reasons, []);
});

test("repeated failed sign-ins raise attention", () => {
  const reasons = securityAttentionReasons(
    { portalState: "Active", lastLoginAt: daysAgo(1), recentFailedAttempts: 3 }, now
  );
  assert.equal(reasons.length, 1);
  assert.match(reasons[0], /3 failed sign-in attempts/);
});

test("a brand new account that has not been used yet is not flagged", () => {
  const reasons = securityAttentionReasons(
    { portalState: "Active", lastLoginAt: null, accountCreatedAt: daysAgo(1) }, now
  );
  assert.deepEqual(reasons, []);
});

test("an old account that has never been signed into is flagged as still on a temp password", () => {
  // This is Steve's case - the lost password that went unnoticed.
  const reasons = securityAttentionReasons(
    { portalState: "Active", lastLoginAt: null, accountCreatedAt: daysAgo(9) }, now
  );
  assert.equal(reasons.length, 1);
  assert.match(reasons[0], /Never signed in/);
  assert.match(reasons[0], /9 days ago/);
});

test("required but un-enrolled 2FA is flagged", () => {
  const reasons = securityAttentionReasons(
    { portalState: "Active", lastLoginAt: daysAgo(1), twoFactorRequired: true, twoFactorEnrolled: false }, now
  );
  assert.equal(reasons.length, 1);
  assert.match(reasons[0], /Two-factor/);
});

test("enrolled 2FA raises nothing", () => {
  const reasons = securityAttentionReasons(
    { portalState: "Active", lastLoginAt: daysAgo(1), twoFactorRequired: true, twoFactorEnrolled: true }, now
  );
  assert.deepEqual(reasons, []);
});

// ── Accountability before standing someone down ───────────

test("outstanding cash and stock are both listed before an agent is stood down", () => {
  const blockers = accountabilityBlockers({
    outstandingCod: 35500, stockUnitsHeld: 9, openIncidents: 0, activeOrders: 0
  });
  assert.equal(blockers.length, 3);
  assert.match(blockers[0], /₦35,500 COD has not been remitted/);
  assert.match(blockers[1], /9 units of company inventory/);
  assert.match(blockers[2], /0 open incidents/);
});

test("open incidents are stated even when there are none", () => {
  // Silence on a review screen reads as "not checked", which is worse than a
  // zero that was actually looked up.
  const blockers = accountabilityBlockers({});
  assert.deepEqual(blockers, ["0 open incidents."]);
});

test("a single unit and a single incident read in the singular", () => {
  const blockers = accountabilityBlockers({ stockUnitsHeld: 1, openIncidents: 1, activeOrders: 1 });
  assert.match(blockers[0], /1 unit of company inventory/);
  assert.match(blockers[1], /1 active order still assigned/);
  assert.match(blockers[2], /1 open incident\./);
});
