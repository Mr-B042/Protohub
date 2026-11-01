-- Staff logins read through the server only (Bright, 1 Nov 2026).
--
-- Found while closing Product Launch gaps: dozens of permissive policies let
-- ANY signed-in staff member read whole tables straight from the database
-- with their own login - every order with customers and amounts, expenses,
-- every user, stock movements, carts. The app's screens never show this (the
-- server scopes everything), but the data could be pulled from a browser, and
-- part of it already reached browsers through Realtime.
--
-- The browser reads the database directly ONLY for Realtime on the 12 tables
-- below; everything else goes through the backend, which uses the service
-- role and bypasses RLS entirely. So:
--   1. every other public table: a RESTRICTIVE policy that refuses all direct
--      access to anon and authenticated (ANDed with every permissive policy,
--      so no existing grant can get past it);
--   2. the 12 Realtime tables: a RESTRICTIVE read policy that matches what
--      each role's screens already show, and no direct writes;
--   3. the public order form's outage save (anon insert into abandoned_carts,
--      PublicOrderFormPage saveOutageCapturedCart) keeps working.
-- The helpers private.auth_org_id / auth_user_role are SECURITY DEFINER owned
-- by postgres, so walling off public.users does not break them.

do $$
declare
  realtime_tables text[] := array[
    'orders', 'abandoned_carts', 'system_notifications', 'users', 'agents', 'agent_stock',
    'stock_movements', 'waybill_records', 'expenses', 'remittance_transactions',
    'cart_contact_attempts', 'cart_journey_events'
  ];
  t record;
begin
  for t in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not (c.relname = any(realtime_tables))
  loop
    execute format('drop policy if exists "Logins read through the server only" on public.%I', t.relname);
    execute format('create policy "Logins read through the server only" on public.%I as restrictive for all to anon, authenticated using (false) with check (false)', t.relname);
  end loop;

  -- No direct writes to the Realtime tables either (the browser never writes),
  -- except the order form's outage cart save below.
  foreach t.relname in array realtime_tables loop
    execute format('drop policy if exists "No direct inserts" on public.%I', t.relname);
    execute format('drop policy if exists "No direct updates" on public.%I', t.relname);
    execute format('drop policy if exists "No direct deletes" on public.%I', t.relname);
    execute format('create policy "No direct updates" on public.%I as restrictive for update to anon, authenticated using (false) with check (false)', t.relname);
    execute format('create policy "No direct deletes" on public.%I as restrictive for delete to anon, authenticated using (false)', t.relname);
    if t.relname = 'abandoned_carts' then
      execute 'create policy "No direct inserts" on public.abandoned_carts as restrictive for insert to anon, authenticated with check (outage_captured is true)';
    else
      execute format('create policy "No direct inserts" on public.%I as restrictive for insert to anon, authenticated with check (false)', t.relname);
    end if;
  end loop;
end $$;

-- ── What each role may read directly (Realtime) ─────────────────────────────
-- Anonymous visitors read nothing.

drop policy if exists "Live updates match the screens" on public.orders;
create policy "Live updates match the screens" on public.orders as restrictive for select to anon, authenticated
using (
  org_id = (select private.auth_org_id()) and (
    (select private.auth_user_role())::text in ('Owner', 'Admin', 'Manager', 'Viewer', 'Inventory Manager')
    or ((select private.auth_user_role())::text in ('Sales Rep', 'Recovery Rep', 'Sales Closer') and assigned_rep_id = (select auth.uid()))
    or ((select private.auth_user_role())::text = 'Marketer' and private.marketing_order_matches_current_user(orders.*))
  )
);

drop policy if exists "Live updates match the screens" on public.abandoned_carts;
create policy "Live updates match the screens" on public.abandoned_carts as restrictive for select to anon, authenticated
using (
  org_id = (select private.auth_org_id()) and (
    (select private.auth_user_role())::text in ('Owner', 'Admin', 'Manager', 'Viewer')
    or ((select private.auth_user_role())::text in ('Sales Rep', 'Recovery Rep', 'Sales Closer') and assigned_rep_id = (select auth.uid()))
    or ((select private.auth_user_role())::text = 'Marketer' and private.marketing_cart_matches_current_user(abandoned_carts.*))
  )
);

drop policy if exists "Live updates match the screens" on public.system_notifications;
create policy "Live updates match the screens" on public.system_notifications as restrictive for select to anon, authenticated
using (org_id = (select private.auth_org_id()) and (recipient_id = (select auth.uid()) or recipient_id is null));

drop policy if exists "Live updates match the screens" on public.users;
create policy "Live updates match the screens" on public.users as restrictive for select to anon, authenticated
using (
  org_id = (select private.auth_org_id()) and (
    id = (select auth.uid())
    or (select private.auth_user_role())::text in ('Owner', 'Admin', 'Manager')
  )
);

drop policy if exists "Live updates match the screens" on public.agents;
create policy "Live updates match the screens" on public.agents as restrictive for select to anon, authenticated
using (org_id = (select private.auth_org_id()) and (select private.auth_user_role())::text in ('Owner', 'Admin', 'Manager', 'Viewer', 'Inventory Manager', 'Inventory Manager & Logistics Operations'));

drop policy if exists "Live updates match the screens" on public.agent_stock;
create policy "Live updates match the screens" on public.agent_stock as restrictive for select to anon, authenticated
using (
  (select private.auth_user_role())::text in ('Owner', 'Admin', 'Manager', 'Viewer', 'Inventory Manager', 'Inventory Manager & Logistics Operations')
  and exists (select 1 from public.agents a where a.id = agent_stock.agent_id and a.org_id = (select private.auth_org_id()))
);

drop policy if exists "Live updates match the screens" on public.stock_movements;
create policy "Live updates match the screens" on public.stock_movements as restrictive for select to anon, authenticated
using (org_id = (select private.auth_org_id()) and (select private.auth_user_role())::text in ('Owner', 'Admin', 'Manager', 'Viewer', 'Inventory Manager', 'Inventory Manager & Logistics Operations'));

drop policy if exists "Live updates match the screens" on public.waybill_records;
create policy "Live updates match the screens" on public.waybill_records as restrictive for select to anon, authenticated
using (org_id = (select private.auth_org_id()) and (select private.auth_user_role())::text in ('Owner', 'Admin', 'Manager', 'Viewer', 'Inventory Manager', 'Inventory Manager & Logistics Operations'));

drop policy if exists "Live updates match the screens" on public.expenses;
create policy "Live updates match the screens" on public.expenses as restrictive for select to anon, authenticated
using (org_id = (select private.auth_org_id()) and (select private.auth_user_role())::text in ('Owner', 'Admin'));

drop policy if exists "Live updates match the screens" on public.remittance_transactions;
create policy "Live updates match the screens" on public.remittance_transactions as restrictive for select to anon, authenticated
using (org_id = (select private.auth_org_id()) and (select private.auth_user_role())::text in ('Owner', 'Admin', 'Manager', 'Viewer'));

drop policy if exists "Live updates match the screens" on public.cart_contact_attempts;
create policy "Live updates match the screens" on public.cart_contact_attempts as restrictive for select to anon, authenticated
using (
  org_id = (select private.auth_org_id()) and (
    (select private.auth_user_role())::text in ('Owner', 'Admin', 'Manager', 'Viewer')
    or rep_id = (select auth.uid())
  )
);

drop policy if exists "Live updates match the screens" on public.cart_journey_events;
create policy "Live updates match the screens" on public.cart_journey_events as restrictive for select to anon, authenticated
using (
  org_id = (select private.auth_org_id()) and (
    (select private.auth_user_role())::text in ('Owner', 'Admin', 'Manager', 'Viewer')
    or exists (select 1 from public.abandoned_carts c where c.id = cart_journey_events.cart_id and c.assigned_rep_id = (select auth.uid()))
  )
);

-- The order form's outage save is checked against the product and package.
-- That check read public.products / product_packages AS the anonymous
-- visitor, which the wall above now refuses - so it moves into a SECURITY
-- DEFINER helper: the check still runs, the visitor still cannot read the
-- tables.
create or replace function private.outage_cart_target_ok(p_product uuid, p_package uuid, p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.products p where p.id = p_product and p.org_id = p_org and p.active = true)
     and exists (select 1 from public.product_packages pkg where pkg.id = p_package and pkg.product_id = p_product and pkg.active = true);
$$;
revoke all on function private.outage_cart_target_ok(uuid, uuid, uuid) from public;
grant execute on function private.outage_cart_target_ok(uuid, uuid, uuid) to anon, authenticated;
grant usage on schema private to anon;

drop policy if exists "Public embed outage inserts carts" on public.abandoned_carts;
create policy "Public embed outage inserts carts" on public.abandoned_carts for insert to anon
with check (
  status = 'Open abandoned'::cart_status
  and assigned_rep_id is null
  and product_id is not null
  and package_id is not null
  and private.outage_cart_target_ok(product_id, package_id, org_id)
);
