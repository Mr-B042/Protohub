-- Round-robin-only "pause from rotation" flag for sales reps.
--
-- Until now, removing a rep from the round-robin sequence meant setting
-- users.active = false — but that ALSO blocks their login and hides them
-- everywhere. This flag decouples the two: round_robin_excluded pauses a rep
-- from AUTO round-robin assignment only. `active` stays solely responsible for
-- login/visibility. A paused rep can still sign in and can still be assigned
-- orders manually; only the auto-assign engine skips them.
--
-- The auto-assign query (backend/src/routes/public-orders.ts) filters
-- `.eq("round_robin_excluded", false)` alongside `.eq("active", true)`.
-- Idempotent so it is safe to re-run.

alter table public.users
  add column if not exists round_robin_excluded boolean not null default false;
