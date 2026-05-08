# httpOnly cookie auth migration — deferred

The audit flagged localStorage-based JWT storage as XSS-readable: any successful
XSS payload can read both the access token and the refresh token, giving full
account takeover. Migrating to httpOnly cookies removes that attack surface.

This is **not done**. It's a real architectural change with breaking session
reset, new CSRF posture, and a runtime dependency. Documenting the steps so
the next person (or session) can pick it up cleanly.

## Why deferred

1. New runtime dependency (`cookie-parser` or hand-rolled cookie code).
2. Cross-origin frontend↔backend (Vercel + Railway are different eTLDs)
   forces `SameSite=None; Secure`, which means CSRF protection becomes
   mandatory — `SameSite=Lax` defaults aren't sufficient.
3. Existing localStorage sessions get invalidated on deploy — every user has
   to log in again. Coordinating that with the 44-agent ProTools team needs
   a comms window.
4. Refresh-token rotation needs careful design (rotate-on-use to detect token
   theft, vs reuse-allowed for resilience) — a wrong choice creates either
   security holes or pissed-off users with broken sessions.

## Concrete migration plan (when ready)

### Phase 1 — Backend support, frontend untouched

Backend changes:
1. `npm install cookie-parser` in `backend/package.json`.
2. `backend/src/index.ts` — `app.use(cookieParser())`.
3. `backend/src/routes/auth.ts` `/login`:
   - Set two cookies on success:
     ```ts
     res.cookie("ph_access", session.access_token, {
       httpOnly: true,
       secure: process.env.NODE_ENV === "production",
       sameSite: "none", // cross-site frontend; must pair with secure
       maxAge: 60 * 60 * 1000 // match Supabase access token lifetime
     });
     res.cookie("ph_refresh", session.refresh_token, {
       httpOnly: true,
       secure: process.env.NODE_ENV === "production",
       sameSite: "none",
       maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
     });
     ```
   - Keep returning tokens in the response body for transitional dual-mode.
4. `backend/src/routes/auth.ts` add `POST /logout`:
   ```ts
   res.clearCookie("ph_access");
   res.clearCookie("ph_refresh");
   res.status(204).send();
   ```
5. `backend/src/middleware/auth.ts` — `requireAuth`:
   - Read token from `req.cookies.ph_access` if present, else fall back to
     `Authorization: Bearer` header. The fallback covers in-flight sessions
     during the rollout window.
6. `backend/src/routes/auth.ts` `/refresh` — read from `req.cookies.ph_refresh`
   first, fall back to `req.body.refreshToken`. On success, set the rotated
   refresh cookie via `res.cookie(...)`.

CSRF mitigation:
- `SameSite=None` cookies need explicit CSRF protection because cross-site
  requests carry them.
- Implement double-submit cookie pattern: server sets a non-httpOnly cookie
  `ph_csrf` (random 32 bytes hex). Frontend reads it via `document.cookie`,
  echoes back in `X-CSRF-Token` header on every state-changing request.
  Middleware compares. Add a `requireCsrf` middleware applied before
  `requireAuth` on POST/PATCH/DELETE/PUT routes.

### Phase 2 — Frontend uses cookies

`src/lib/api.ts`:
- Add `credentials: "include"` to every `fetch(...)` call.
- Remove the `Authorization: Bearer` header (cookies carry auth now).
- Read the `ph_csrf` cookie and send it as `X-CSRF-Token` on mutating requests.

`src/lib/auth.ts`:
- Stop calling `localStorage.setItem` for tokens.
- Keep `protohub.authUser` in localStorage for fast first-paint (no security risk —
  it's denormalized profile, not credentials).
- `auth.clear()` calls `POST /api/auth/logout` to clear the cookies server-side.

`src/main.tsx`:
- `auth.isLoggedIn()` synchronous check no longer reads tokens from localStorage.
  Use `protohub.authUser` presence as the synchronous signal; first authed API
  call confirms.

### Phase 3 — Cleanup

- Delete the `Authorization: Bearer` fallback in `requireAuth`.
- Stop returning tokens in the `/login` response body.
- Force every active session to log out via the cache-version bump.

## Risk checklist before flipping the switch

- [ ] Test in staging end-to-end: login, refresh after expiry, logout, multi-tab.
- [ ] Verify CSRF middleware blocks a cross-origin POST without the header.
- [ ] Verify `Set-Cookie` headers reach the browser (Railway/Vercel proxies
      sometimes strip them with default config).
- [ ] Plan a maintenance window — every active user gets logged out at deploy.
- [ ] Update mobile / desktop clients if any exist.
