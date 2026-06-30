-- Migration 146: consolidate overlapping permissive RLS policies.
--
-- Supabase Security Advisor flags tables when multiple permissive policies can
-- satisfy the same action for the same role. Replace older broad FOR ALL /
-- catch-all policies with one policy per action so access stays the same but
-- policy evaluation is simpler and advisor noise is removed.

-- ── products ──────────────────────────────────────────────
drop policy if exists "same org products" on public.products;
drop policy if exists "All org members see products" on public.products;
drop policy if exists "Owner/Admin/Inventory manage products" on public.products;

create policy "products select org members"
  on public.products
  for select
  to authenticated
  using (org_id = private.auth_org_id());

create policy "products insert inventory roles"
  on public.products
  for insert
  to authenticated
  with check (
    org_id = private.auth_org_id()
    and private.auth_user_role()::text in ('Owner', 'Admin', 'Inventory Manager')
  );

create policy "products update inventory roles"
  on public.products
  for update
  to authenticated
  using (
    org_id = private.auth_org_id()
    and private.auth_user_role()::text in ('Owner', 'Admin', 'Inventory Manager')
  )
  with check (
    org_id = private.auth_org_id()
    and private.auth_user_role()::text in ('Owner', 'Admin', 'Inventory Manager')
  );

create policy "products delete inventory roles"
  on public.products
  for delete
  to authenticated
  using (
    org_id = private.auth_org_id()
    and private.auth_user_role()::text in ('Owner', 'Admin', 'Inventory Manager')
  );

-- ── push_subscriptions ────────────────────────────────────
drop policy if exists "Users can manage their own push subscriptions" on public.push_subscriptions;
drop policy if exists "Users manage own push subscriptions" on public.push_subscriptions;
drop policy if exists "Users see own push subscriptions" on public.push_subscriptions;

create policy "push subscriptions select own"
  on public.push_subscriptions
  for select
  to authenticated
  using (org_id = private.auth_org_id() and user_id = auth.uid());

create policy "push subscriptions insert own"
  on public.push_subscriptions
  for insert
  to authenticated
  with check (org_id = private.auth_org_id() and user_id = auth.uid());

create policy "push subscriptions update own"
  on public.push_subscriptions
  for update
  to authenticated
  using (org_id = private.auth_org_id() and user_id = auth.uid())
  with check (org_id = private.auth_org_id() and user_id = auth.uid());

create policy "push subscriptions delete own"
  on public.push_subscriptions
  for delete
  to authenticated
  using (org_id = private.auth_org_id() and user_id = auth.uid());

-- ── rep_penalties ─────────────────────────────────────────
drop policy if exists "tenant isolation" on public.rep_penalties;
drop policy if exists "Owner/Admin see rep penalties" on public.rep_penalties;
drop policy if exists "Owner/Admin manage rep penalties" on public.rep_penalties;

create policy "rep penalties select owner admin"
  on public.rep_penalties
  for select
  to authenticated
  using (
    org_id = private.auth_org_id()
    and private.auth_user_role()::text in ('Owner', 'Admin')
  );

create policy "rep penalties insert owner admin"
  on public.rep_penalties
  for insert
  to authenticated
  with check (
    org_id = private.auth_org_id()
    and private.auth_user_role()::text in ('Owner', 'Admin')
  );

create policy "rep penalties update owner admin"
  on public.rep_penalties
  for update
  to authenticated
  using (
    org_id = private.auth_org_id()
    and private.auth_user_role()::text in ('Owner', 'Admin')
  )
  with check (
    org_id = private.auth_org_id()
    and private.auth_user_role()::text in ('Owner', 'Admin')
  );

create policy "rep penalties delete owner admin"
  on public.rep_penalties
  for delete
  to authenticated
  using (
    org_id = private.auth_org_id()
    and private.auth_user_role()::text in ('Owner', 'Admin')
  );

-- ── sales_teams ───────────────────────────────────────────
drop policy if exists "tenant isolation" on public.sales_teams;
drop policy if exists "All org members see sales teams" on public.sales_teams;
drop policy if exists "Owner/Admin manage sales teams" on public.sales_teams;

create policy "sales teams select org members"
  on public.sales_teams
  for select
  to authenticated
  using (org_id = private.auth_org_id());

create policy "sales teams insert owner admin"
  on public.sales_teams
  for insert
  to authenticated
  with check (
    org_id = private.auth_org_id()
    and private.auth_user_role()::text in ('Owner', 'Admin')
  );

create policy "sales teams update owner admin"
  on public.sales_teams
  for update
  to authenticated
  using (
    org_id = private.auth_org_id()
    and private.auth_user_role()::text in ('Owner', 'Admin')
  )
  with check (
    org_id = private.auth_org_id()
    and private.auth_user_role()::text in ('Owner', 'Admin')
  );

create policy "sales teams delete owner admin"
  on public.sales_teams
  for delete
  to authenticated
  using (
    org_id = private.auth_org_id()
    and private.auth_user_role()::text in ('Owner', 'Admin')
  );
