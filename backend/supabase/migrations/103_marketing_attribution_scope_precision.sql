-- Migration 103: tighten marketer attribution matching and keep public-form
-- tracking fields available on orders.
--
-- The first marketer scope used broad "%tag%" matches. That can make a tag
-- like "chelsea" also match "not_chelsea" or "chelsea2". Marketer links now
-- generate stable tag prefixes (for example `media_buyer=chelsea` and
-- `utm_content=chelsea-main-page`), so match exact tags or tag prefixes only.

alter table public.orders
  add column if not exists confirmation_checked boolean,
  add column if not exists preferred_delivery text,
  add column if not exists referrer text;

create or replace function private.marketing_text_matches_tag(_value text, _tag text)
returns boolean
language sql
immutable
set search_path to 'public', 'pg_catalog'
as $$
  select
    length(trim(coalesce(_tag, ''))) > 0
    and (
      lower(coalesce(_value, '')) = lower(trim(_tag))
      or left(lower(coalesce(_value, '')), char_length(lower(trim(_tag))) + 1) = lower(trim(_tag)) || '-'
      or left(lower(coalesce(_value, '')), char_length(lower(trim(_tag))) + 1) = lower(trim(_tag)) || '_'
    )
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
  select exists (
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
  select exists (
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

grant execute on function private.marketing_text_matches_tag(text, text) to authenticated, service_role;
grant execute on function private.marketing_order_matches_current_user(public.orders) to authenticated, service_role;
grant execute on function private.marketing_cart_matches_current_user(public.abandoned_carts) to authenticated, service_role;
