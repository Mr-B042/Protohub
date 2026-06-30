-- Migration 147: fix Performance Advisor "Auth RLS Initialization Plan" warnings.
--
-- Supabase recommends wrapping auth/helper calls in RLS policies with a scalar
-- SELECT, e.g. `(select auth.uid())`, so Postgres evaluates the value once per
-- statement instead of once per scanned row. This migration rewrites existing
-- public/storage RLS policy expressions in place and refreshes marketer helper
-- functions that are invoked from RLS policies.

create or replace function private._rls_initplan_rewrite(_expr text)
returns text
language plpgsql
as $$
begin
  if _expr is null then
    return null;
  end if;

  -- pg_get_expr/pg_dump often quote schema-qualified functions. Replace both
  -- quoted and unquoted forms with scalar-subquery init-plan forms.
  _expr := replace(_expr, '"auth"."uid"()', '(select auth.uid())');
  _expr := replace(_expr, 'auth.uid()', '(select auth.uid())');
  _expr := replace(_expr, '"auth"."role"()', '(select auth.role())');
  _expr := replace(_expr, 'auth.role()', '(select auth.role())');
  _expr := replace(_expr, '"auth"."jwt"()', '(select auth.jwt())');
  _expr := replace(_expr, 'auth.jwt()', '(select auth.jwt())');

  _expr := replace(_expr, '"private"."auth_org_id"()', '(select private.auth_org_id())');
  _expr := replace(_expr, 'private.auth_org_id()', '(select private.auth_org_id())');
  _expr := replace(_expr, '"private"."auth_user_role"()', '(select private.auth_user_role())');
  _expr := replace(_expr, 'private.auth_user_role()', '(select private.auth_user_role())');

  return _expr;
end
$$;

do $$
declare
  policy_row record;
  role_clause text;
  next_qual text;
  next_check text;
  ddl text;
begin
  for policy_row in
    select *
    from pg_policies
    where schemaname in ('public', 'storage')
  loop
    next_qual := private._rls_initplan_rewrite(policy_row.qual);
    next_check := private._rls_initplan_rewrite(policy_row.with_check);

    if next_qual is not distinct from policy_row.qual
       and next_check is not distinct from policy_row.with_check then
      continue;
    end if;

    select string_agg(
      case when role_name::text = 'public' then 'public' else quote_ident(role_name::text) end,
      ', '
    )
    into role_clause
    from unnest(policy_row.roles) as roles(role_name);

    ddl := format(
      'alter policy %I on %I.%I to %s',
      policy_row.policyname,
      policy_row.schemaname,
      policy_row.tablename,
      coalesce(role_clause, 'public')
    );

    if next_qual is not null then
      ddl := ddl || format(' using (%s)', next_qual);
    end if;
    if next_check is not null then
      ddl := ddl || format(' with check (%s)', next_check);
    end if;

    execute ddl;
  end loop;
end
$$;

drop function private._rls_initplan_rewrite(text);

-- These helper functions are called by marketer-scoped RLS policies. Keep the
-- same behavior, but wrap auth.uid() to avoid repeated per-row auth lookups.
create or replace function private.current_marketing_attribution_tags()
returns text[]
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $$
  select coalesce(marketing_attribution_tags, '{}'::text[])
  from public.users
  where id = (select auth.uid())
$$;

create or replace function private.marketing_order_matches_current_user(_order public.orders)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $$
  with tag_variants(tag) as (
    select lower(trim(raw_tag))
    from unnest(private.current_marketing_attribution_tags()) as source(raw_tag)
    where length(trim(raw_tag)) > 0
    union
    select regexp_replace(lower(trim(raw_tag)), '[^a-z0-9]+', '-', 'g')
    from unnest(private.current_marketing_attribution_tags()) as source(raw_tag)
    where length(trim(raw_tag)) > 0
    union
    select regexp_replace(lower(trim(raw_tag)), '[^a-z0-9]+', '_', 'g')
    from unnest(private.current_marketing_attribution_tags()) as source(raw_tag)
    where length(trim(raw_tag)) > 0
  )
  select
    coalesce(_order.form_context->>'media_buyer_id', '') = (select auth.uid())::text
    or coalesce(_order.form_context->>'mediaBuyerId', '') = (select auth.uid())::text
    or coalesce(_order.form_context->>'marketer_user_id', '') = (select auth.uid())::text
    or coalesce(_order.form_context->>'marketerUserId', '') = (select auth.uid())::text
    or coalesce(_order.form_context->>'buyer_id', '') = (select auth.uid())::text
    or coalesce(_order.form_context->>'buyerId', '') = (select auth.uid())::text
    or exists (
      select 1
      from tag_variants
      where length(trim(tag)) > 0
        and (
          private.marketing_text_matches_tag(_order.utm_source, tag)
          or private.marketing_text_matches_tag(_order.utm_campaign, tag)
          or private.marketing_text_matches_tag(_order.utm_medium, tag)
          or private.marketing_text_matches_tag(_order.utm_content, tag)
          or private.marketing_text_matches_tag(_order.utm_term, tag)
          or private.marketing_text_matches_tag(_order.form_context->>'media_buyer', tag)
          or private.marketing_text_matches_tag(_order.form_context->>'mediaBuyer', tag)
          or private.marketing_text_matches_tag(_order.form_context->>'media_buyer_id', tag)
          or private.marketing_text_matches_tag(_order.form_context->>'mediaBuyerId', tag)
          or private.marketing_text_matches_tag(_order.form_context->>'buyer', tag)
          or private.marketing_text_matches_tag(_order.form_context->>'buyer_id', tag)
          or private.marketing_text_matches_tag(_order.form_context->>'buyerId', tag)
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
  with tag_variants(tag) as (
    select lower(trim(raw_tag))
    from unnest(private.current_marketing_attribution_tags()) as source(raw_tag)
    where length(trim(raw_tag)) > 0
    union
    select regexp_replace(lower(trim(raw_tag)), '[^a-z0-9]+', '-', 'g')
    from unnest(private.current_marketing_attribution_tags()) as source(raw_tag)
    where length(trim(raw_tag)) > 0
    union
    select regexp_replace(lower(trim(raw_tag)), '[^a-z0-9]+', '_', 'g')
    from unnest(private.current_marketing_attribution_tags()) as source(raw_tag)
    where length(trim(raw_tag)) > 0
  )
  select
    coalesce(_cart.capture_payload->>'media_buyer_id', '') = (select auth.uid())::text
    or coalesce(_cart.capture_payload->>'mediaBuyerId', '') = (select auth.uid())::text
    or coalesce(_cart.capture_payload->>'marketer_user_id', '') = (select auth.uid())::text
    or coalesce(_cart.capture_payload->>'marketerUserId', '') = (select auth.uid())::text
    or coalesce(_cart.capture_payload->>'buyer_id', '') = (select auth.uid())::text
    or coalesce(_cart.capture_payload->>'buyerId', '') = (select auth.uid())::text
    or exists (
      select 1
      from tag_variants
      where length(trim(tag)) > 0
        and (
          private.marketing_text_matches_tag(_cart.source, tag)
          or private.marketing_text_matches_tag(_cart.capture_payload->>'utm_source', tag)
          or private.marketing_text_matches_tag(_cart.capture_payload->>'utm_campaign', tag)
          or private.marketing_text_matches_tag(_cart.capture_payload->>'utm_medium', tag)
          or private.marketing_text_matches_tag(_cart.capture_payload->>'utm_content', tag)
          or private.marketing_text_matches_tag(_cart.capture_payload->>'utm_term', tag)
          or private.marketing_text_matches_tag(_cart.capture_payload->>'media_buyer', tag)
          or private.marketing_text_matches_tag(_cart.capture_payload->>'mediaBuyer', tag)
          or private.marketing_text_matches_tag(_cart.capture_payload->>'media_buyer_id', tag)
          or private.marketing_text_matches_tag(_cart.capture_payload->>'mediaBuyerId', tag)
          or private.marketing_text_matches_tag(_cart.capture_payload->>'buyer', tag)
          or private.marketing_text_matches_tag(_cart.capture_payload->>'buyer_id', tag)
          or private.marketing_text_matches_tag(_cart.capture_payload->>'buyerId', tag)
        )
    )
$$;

grant execute on function private.current_marketing_attribution_tags() to authenticated, service_role;
grant execute on function private.marketing_order_matches_current_user(public.orders) to authenticated, service_role;
grant execute on function private.marketing_cart_matches_current_user(public.abandoned_carts) to authenticated, service_role;
