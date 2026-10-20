-- Alert routing (Bright, 20 Oct 2026): the Owner chooses, per alert, which
-- roles get it, whether the rep on the order gets it, and whether it pops up
-- on phones (push) or stays in-app only.
-- Shape: { "<alert key>": { "roles": ["Owner", ...], "rep": bool, "push": bool } }
-- A missing key means the built-in default (backend/src/lib/notification-routing.ts).
alter table public.organizations
  add column if not exists notification_routing jsonb not null default '{}'::jsonb;
