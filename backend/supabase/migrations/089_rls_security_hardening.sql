-- Migration 089: RLS security hardening
--
-- Fixes the "RLS Disabled in Public" criticals from Supabase advisors
-- without changing application behavior:
--   - Backend uses the service-role key (lib/supabase.ts) which bypasses
--     RLS, so all backend reads/writes keep working.
--   - The frontend admin app subscribes to cart_journey_events realtime,
--     which DOES need an explicit SELECT policy for authenticated users
--     scoped to their org.
--   - The auth_org_id() / auth_user_role() helpers are internal RLS
--     plumbing, not public RPC. We REVOKE EXECUTE from anon/authenticated.
--   - The package-images bucket exposes file URLs publicly (fine), but
--     the broad SELECT policy lets anyone LIST every file. Public URLs
--     don't need listing; drop the over-broad policy.

-- ── 1. Enable RLS on backend-only tables (no policies needed — service
--      role bypasses RLS, anon/authenticated get 0 rows).
alter table public.agent_coverage          enable row level security;
alter table public.agent_locations         enable row level security;
alter table public.agent_location_stock    enable row level security;
alter table public.follow_up_tasks         enable row level security;
alter table public.manager_activity_logs   enable row level security;
alter table public.order_contact_attempts  enable row level security;
alter table public.whatsapp_settings       enable row level security;
alter table public.whatsapp_messages       enable row level security;
alter table public.whatsapp_inbox_messages enable row level security;
alter table public.remittance_transactions enable row level security;
alter table public.native_push_devices     enable row level security;

-- ── 2. Enable RLS on cart_journey_events + add the SELECT policy that
--      keeps admin realtime working.
alter table public.cart_journey_events enable row level security;

-- Idempotent: drop any prior incarnation first.
drop policy if exists "Authenticated users read their org cart journey events"
  on public.cart_journey_events;

create policy "Authenticated users read their org cart journey events"
  on public.cart_journey_events
  for select
  to authenticated
  using (org_id = public.auth_org_id());

-- ── 3. Lock down internal RLS helpers from external RPC. They stay
--      callable from within SQL (RLS policies still work) but are no
--      longer reachable via /rest/v1/rpc/*.
revoke execute on function public.auth_org_id()    from anon, authenticated, public;
revoke execute on function public.auth_user_role() from anon, authenticated, public;

-- ── 4. Drop the over-broad SELECT policy on the package-images bucket.
--      Public bucket URLs still resolve without this; we just stop
--      allowing clients to LIST every file in the bucket.
drop policy if exists "package-images public read" on storage.objects;
