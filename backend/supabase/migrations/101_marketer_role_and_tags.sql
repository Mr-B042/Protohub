-- Migration 101: marketer role + attribution scope.
--
-- Marketers/media buyers need their own login, but they must only see orders
-- tied to their buyer tags (for example media_buyer=chelsea). Empty tags are
-- intentionally safe: a Marketer with no tags sees no marketing orders/carts.

alter type public.user_role add value if not exists 'Marketer';

alter table public.users
  add column if not exists marketing_attribution_tags text[] not null default '{}'::text[];

create index if not exists idx_users_marketing_attribution_tags
  on public.users using gin (marketing_attribution_tags);

create or replace function private.current_marketing_attribution_tags()
returns text[]
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $$
  select coalesce(marketing_attribution_tags, '{}'::text[])
  from public.users
  where id = auth.uid()
$$;

create or replace function private.marketing_order_matches_current_user(_order public.orders)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $$
  select exists (
    select 1
    from unnest(private.current_marketing_attribution_tags()) as tag(raw_tag)
    where length(trim(raw_tag)) > 0
      and (
        coalesce(lower(_order.utm_source), '') like '%' || lower(trim(raw_tag)) || '%'
        or coalesce(lower(_order.utm_campaign), '') like '%' || lower(trim(raw_tag)) || '%'
        or coalesce(lower(_order.utm_medium), '') like '%' || lower(trim(raw_tag)) || '%'
        or coalesce(lower(_order.utm_content), '') like '%' || lower(trim(raw_tag)) || '%'
        or coalesce(lower(_order.utm_term), '') like '%' || lower(trim(raw_tag)) || '%'
        or coalesce(lower(_order.form_context->>'media_buyer'), '') like '%' || lower(trim(raw_tag)) || '%'
        or coalesce(lower(_order.form_context->>'mediaBuyer'), '') like '%' || lower(trim(raw_tag)) || '%'
        or coalesce(lower(_order.form_context->>'media_buyer_id'), '') like '%' || lower(trim(raw_tag)) || '%'
        or coalesce(lower(_order.form_context->>'mediaBuyerId'), '') like '%' || lower(trim(raw_tag)) || '%'
        or coalesce(lower(_order.form_context->>'buyer'), '') like '%' || lower(trim(raw_tag)) || '%'
        or coalesce(lower(_order.form_context->>'buyer_id'), '') like '%' || lower(trim(raw_tag)) || '%'
        or coalesce(lower(_order.form_context->>'buyerId'), '') like '%' || lower(trim(raw_tag)) || '%'
      )
  )
$$;

create or replace function private.marketing_cart_matches_current_user(_cart public.abandoned_carts)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $$
  select exists (
    select 1
    from unnest(private.current_marketing_attribution_tags()) as tag(raw_tag)
    where length(trim(raw_tag)) > 0
      and (
        coalesce(lower(_cart.source), '') like '%' || lower(trim(raw_tag)) || '%'
        or coalesce(lower(_cart.capture_payload->>'utm_source'), '') like '%' || lower(trim(raw_tag)) || '%'
        or coalesce(lower(_cart.capture_payload->>'utm_campaign'), '') like '%' || lower(trim(raw_tag)) || '%'
        or coalesce(lower(_cart.capture_payload->>'utm_medium'), '') like '%' || lower(trim(raw_tag)) || '%'
        or coalesce(lower(_cart.capture_payload->>'utm_content'), '') like '%' || lower(trim(raw_tag)) || '%'
        or coalesce(lower(_cart.capture_payload->>'utm_term'), '') like '%' || lower(trim(raw_tag)) || '%'
        or coalesce(lower(_cart.capture_payload->>'media_buyer'), '') like '%' || lower(trim(raw_tag)) || '%'
        or coalesce(lower(_cart.capture_payload->>'mediaBuyer'), '') like '%' || lower(trim(raw_tag)) || '%'
        or coalesce(lower(_cart.capture_payload->>'media_buyer_id'), '') like '%' || lower(trim(raw_tag)) || '%'
        or coalesce(lower(_cart.capture_payload->>'mediaBuyerId'), '') like '%' || lower(trim(raw_tag)) || '%'
        or coalesce(lower(_cart.capture_payload->>'buyer'), '') like '%' || lower(trim(raw_tag)) || '%'
        or coalesce(lower(_cart.capture_payload->>'buyer_id'), '') like '%' || lower(trim(raw_tag)) || '%'
        or coalesce(lower(_cart.capture_payload->>'buyerId'), '') like '%' || lower(trim(raw_tag)) || '%'
      )
  )
$$;

grant execute on function private.current_marketing_attribution_tags() to authenticated, service_role;
grant execute on function private.marketing_order_matches_current_user(public.orders) to authenticated, service_role;
grant execute on function private.marketing_cart_matches_current_user(public.abandoned_carts) to authenticated, service_role;

drop policy if exists "Users see own org members" on public.users;
create policy "Users see own org members"
  on public.users for select
  using (
    org_id = private.auth_org_id()
    and (
      private.auth_user_role()::text <> 'Marketer'
      or id = auth.uid()
    )
  );

drop policy if exists "Reps see own orders, others see all" on public.orders;
create policy "Reps and marketers see scoped orders, others see all"
  on public.orders for select
  using (
    org_id = private.auth_org_id()
    and (
      private.auth_user_role()::text not in ('Sales Rep', 'Marketer')
      or (private.auth_user_role()::text = 'Sales Rep' and assigned_rep_id = auth.uid())
      or (private.auth_user_role()::text = 'Marketer' and private.marketing_order_matches_current_user(orders))
    )
  );

drop policy if exists "Reps see own carts, others see all" on public.abandoned_carts;
create policy "Reps and marketers see scoped carts, others see all"
  on public.abandoned_carts for select
  using (
    org_id = private.auth_org_id()
    and (
      private.auth_user_role()::text not in ('Sales Rep', 'Marketer')
      or (private.auth_user_role()::text = 'Sales Rep' and assigned_rep_id = auth.uid())
      or (private.auth_user_role()::text = 'Marketer' and private.marketing_cart_matches_current_user(abandoned_carts))
    )
  );
