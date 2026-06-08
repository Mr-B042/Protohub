-- Migration 108: credit marketer orders/carts by generated-link user id.
--
-- Marketer links include both a readable tag (`media_buyer`) and the owning
-- user's id (`media_buyer_id`). Tag matching is still useful, but the user id is
-- the safest attribution key. Without this, a generated link can create an order
-- that Owners/Admins see but the Marketer cannot, whenever the profile tag is
-- missing, changed, or does not exactly match the URL tag.

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
    coalesce(_order.form_context->>'media_buyer_id', '') = auth.uid()::text
    or coalesce(_order.form_context->>'mediaBuyerId', '') = auth.uid()::text
    or coalesce(_order.form_context->>'marketer_user_id', '') = auth.uid()::text
    or coalesce(_order.form_context->>'marketerUserId', '') = auth.uid()::text
    or coalesce(_order.form_context->>'buyer_id', '') = auth.uid()::text
    or coalesce(_order.form_context->>'buyerId', '') = auth.uid()::text
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
    coalesce(_cart.capture_payload->>'media_buyer_id', '') = auth.uid()::text
    or coalesce(_cart.capture_payload->>'mediaBuyerId', '') = auth.uid()::text
    or coalesce(_cart.capture_payload->>'marketer_user_id', '') = auth.uid()::text
    or coalesce(_cart.capture_payload->>'marketerUserId', '') = auth.uid()::text
    or coalesce(_cart.capture_payload->>'buyer_id', '') = auth.uid()::text
    or coalesce(_cart.capture_payload->>'buyerId', '') = auth.uid()::text
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

grant execute on function private.marketing_order_matches_current_user(public.orders) to authenticated, service_role;
grant execute on function private.marketing_cart_matches_current_user(public.abandoned_carts) to authenticated, service_role;
