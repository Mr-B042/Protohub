-- "Delivery Agent" existed everywhere EXCEPT the database.
--
-- The frontend offered it in EditableUserRole, roleAllowedPages gave it a
-- portal ("My Deliveries"), and the backend accepted it in VALID_ROLES - but
-- the user_role enum itself never had the value. So granting a personal
-- delivery agent portal access failed with:
--   invalid input value for enum user_role: "Delivery Agent"
-- and it had failed since the module shipped: zero users have ever held the
-- role, because it was never possible to hold it.
--
-- Two parts, and the second is the important one.
alter type public.user_role add value if not exists 'Delivery Agent';

-- Without this a Delivery Agent falls into the policy's "others see all"
-- branch and can read EVERY order in the organisation. A personal delivery
-- agent is an outside individual, not staff - they get their own portal and
-- nothing else. Same over-permissioning migration 164 fixed for Recovery Rep
-- and 218 avoided for Sales Closer.
--
-- They are given no direct order rows at all, rather than a scoped subset: the
-- agent portal (my-summary / my-orders / my-wallet / my-stock) is served by the
-- backend against its own assignment records, so it never reads this table as
-- the agent. Nothing in their UI breaks by having none.
drop policy if exists "Reps and marketers see scoped orders, others see all" on public.orders;
create policy "Reps and marketers see scoped orders, others see all"
  on public.orders for select
  using (
    org_id = private.auth_org_id()
    and (
      private.auth_user_role()::text not in ('Sales Rep', 'Recovery Rep', 'Sales Closer', 'Marketer', 'Delivery Agent')
      or (private.auth_user_role()::text in ('Sales Rep', 'Recovery Rep', 'Sales Closer') and assigned_rep_id = auth.uid())
      or (private.auth_user_role()::text = 'Marketer' and private.marketing_order_matches_current_user(orders))
    )
  );
