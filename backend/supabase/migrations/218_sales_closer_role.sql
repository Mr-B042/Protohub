-- "Sales Closer" role: turns social-DM inquiries (WhatsApp/Instagram/
-- TikTok/Facebook, not yet integrated) into orders. Distinct from "Sales
-- Rep", who only ever works orders/leads already inside the system. Same
-- additive-enum technique as migrations 101/164/208 - never edit the enum
-- in place.
alter type public.user_role add value if not exists 'Sales Closer';

-- Same over-permissioning bug migration 164 fixed for Recovery Rep: any
-- role not named in this policy's exclusion list falls into "sees every
-- order in the org" over Realtime. Fixed here, in the SAME migration as
-- the role, so no Sales Closer account is ever created into a window
-- where she can see every order in the org.
drop policy if exists "Reps and marketers see scoped orders, others see all" on public.orders;
create policy "Reps and marketers see scoped orders, others see all"
  on public.orders for select
  using (
    org_id = private.auth_org_id()
    and (
      private.auth_user_role()::text not in ('Sales Rep', 'Recovery Rep', 'Sales Closer', 'Marketer')
      or (private.auth_user_role()::text in ('Sales Rep', 'Recovery Rep', 'Sales Closer') and assigned_rep_id = auth.uid())
      or (private.auth_user_role()::text = 'Marketer' and private.marketing_order_matches_current_user(orders))
    )
  );
