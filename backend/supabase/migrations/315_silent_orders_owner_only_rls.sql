-- Product Launch (1 Nov 2026): a Silent Test order may only ever reach the
-- Owner. The server already hides them (launch-hide-guard.test.ts), but the
-- browsers' live updates (Supabase Realtime on public.orders) are decided by
-- row-level security alone, and the permissive "same org orders" policy lets
-- every signed-in staff member read every order. A RESTRICTIVE policy is
-- ANDed with all the permissive ones, so no other policy can let a Silent
-- Test order through to anyone but the Owner. The backend uses the service
-- role, which bypasses RLS, so nothing the server does changes.
drop policy if exists "Silent Test orders are the Owner's alone" on public.orders;
create policy "Silent Test orders are the Owner's alone"
  on public.orders
  as restrictive
  for select
  to authenticated
  using (launch_stage <> 'silent' or (select private.auth_user_role())::text = 'Owner');

-- The same for abandoned carts of a Silent Test product whose settings hold
-- its carts back (the default): only the Owner may read them.
drop policy if exists "Held Silent Test carts are the Owner's alone" on public.abandoned_carts;
create policy "Held Silent Test carts are the Owner's alone"
  on public.abandoned_carts
  as restrictive
  for select
  to authenticated
  using (
    product_id is null
    or (select private.auth_user_role())::text = 'Owner'
    or not exists (
      select 1 from public.products p
      where p.id = abandoned_carts.product_id
        and p.launch_stage = 'silent'
        and coalesce((p.launch_settings ->> 'silentHoldCarts')::boolean, true)
    )
  );
