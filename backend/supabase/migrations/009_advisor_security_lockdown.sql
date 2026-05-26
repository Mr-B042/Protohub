-- Lockdown of issues surfaced by Supabase advisors after applying 007/008.
-- Already applied to the production project (mpcgeszkskevkmapwqat) via the
-- Supabase MCP — this file matches what's in the DB so the repo stays in
-- sync with the migration history.

-- ───────────────────────────────────────────────────────────────────────────
-- 1. embed_settings — enable RLS + tenant-isolation policy.
--    Backend uses service role (bypasses RLS). Closes the anon-key direct-
--    PostgREST read leak the advisor flagged as ERROR.
-- ───────────────────────────────────────────────────────────────────────────
alter table public.embed_settings enable row level security;
create policy "tenant isolation read" on public.embed_settings
  for select using (org_id = public.auth_org_id());
create policy "tenant isolation write" on public.embed_settings
  for all using (org_id = public.auth_org_id())
         with check (org_id = public.auth_org_id());
-- ───────────────────────────────────────────────────────────────────────────
-- 2. rep_penalties / sales_teams — RLS already enabled with no policies, so
--    PostgREST returned nothing for any direct client. Adding tenant-
--    isolation so future direct Supabase-JS clients get correct same-org rows.
-- ───────────────────────────────────────────────────────────────────────────
create policy "tenant isolation" on public.rep_penalties
  for all using (org_id = public.auth_org_id())
         with check (org_id = public.auth_org_id());
create policy "tenant isolation" on public.sales_teams
  for all using (org_id = public.auth_org_id())
         with check (org_id = public.auth_org_id());
-- ───────────────────────────────────────────────────────────────────────────
-- 3. Pin search_path on the four flagged functions. Closes the
--    schema-injection vector if a malicious schema gets injected before
--    public on the role's search_path. auth_user_role's body uses an
--    unqualified `from users`, so this is genuinely load-bearing there.
-- ───────────────────────────────────────────────────────────────────────────
alter function public.set_updated_at()                  set search_path = public, pg_catalog;
alter function public.auth_org_id()                     set search_path = public, pg_catalog;
alter function public.auth_user_role()                  set search_path = public, pg_catalog;
alter function public.embed_settings_touch_updated_at() set search_path = public, pg_catalog;
-- ───────────────────────────────────────────────────────────────────────────
-- 4. adjust_warehouse_stock is SECURITY DEFINER and accepts arbitrary
--    p_product_id + p_org_id, so a direct PostgREST RPC call by anon /
--    authenticated bypasses the backend's auth checks. The frontend never
--    calls it directly — the backend uses service role (which retains
--    EXECUTE regardless of these revokes), so the legitimate path is
--    unaffected.
-- ───────────────────────────────────────────────────────────────────────────
revoke execute on function public.adjust_warehouse_stock(uuid, uuid, integer)
  from anon, authenticated, public;
-- ───────────────────────────────────────────────────────────────────────────
-- 5. auth_org_id / auth_user_role intentionally remain callable by anon and
--    authenticated. They're invoked by 40+ RLS policies throughout the
--    schema and revoking would break the app. They return only the caller's
--    own org/role (or null for anon) so they leak no cross-tenant info — the
--    advisor's "callable by anon" warning is accepted-by-design. Documented
--    in this comment so the next person to read advisor output knows why.
-- ───────────────────────────────────────────────────────────────────────────;
