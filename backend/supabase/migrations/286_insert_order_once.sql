-- Save an order ONCE (Bright, 3 Oct 2026). Order #4787 came from the form and
-- #4788 from cart recovery half a second later for the same cart: recovery
-- inserted directly, outside the repeat-order guard, and nothing made the two
-- paths wait for each other. Both now go through this function:
--   * locked on the cart (or a request key), so the second attempt gets the
--     first order back instead of creating another;
--   * then insert_order_with_duplicate_guard, so a genuine repeat from the same
--     number + product within 7 days is held for review on either path.
-- Supersedes the unfinished 275_order_submission_idempotency.sql (never
-- applied): same idea, but a same-cart order with a DIFFERENT phone number is
-- saved as its own order (never an error to the customer, never revealing the
-- other order), and a submit with no cart and no key simply skips the lock.
-- Additive only.
alter table public.orders add column if not exists submission_key text;
create unique index if not exists orders_org_submission_key_idx
  on public.orders (org_id, submission_key) where submission_key is not null;

create or replace function public.insert_order_once(
  p_org_id uuid, p_phone_last10 text, p_product_id uuid,
  p_window_start timestamptz, p_order jsonb, p_submission_key text
) returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  existing public.orders;
  created public.orders;
  cart_key text := nullif(regexp_replace(coalesce(p_order->>'source_cart_id', ''), '-outage-[a-z0-9]+$', '', 'i'), '');
  request_key text;
begin
  set local lock_timeout = '10s';
  if p_order->>'org_id' is distinct from p_org_id::text then
    raise exception 'Order organization mismatch';
  end if;
  request_key := case
    when cart_key is not null then 'cart:' || cart_key
    when nullif(p_submission_key, '') is not null then 'request:' || p_submission_key
    else null end;
  if request_key is not null then
    if length(request_key) > 200 then raise exception 'Submission key too long'; end if;
    perform pg_advisory_xact_lock(hashtextextended(p_org_id::text || ':' || request_key, 0));
    select * into existing from public.orders
      where org_id = p_org_id and submission_key = request_key limit 1;
    if existing.id is null and cart_key is not null then
      -- Orders saved before this function existed, including outage captures.
      select * into existing from public.orders
        where org_id = p_org_id and source_cart_id in (cart_key, p_order->>'source_cart_id')
        order by created_at, id limit 1;
    end if;
    if existing.id is not null then
      if right(regexp_replace(coalesce(existing.phone, ''), '\D', '', 'g'), 10) is not distinct from p_phone_last10 then
        return jsonb_build_object('order', to_jsonb(existing), 'replayed', true);
      end if;
      -- Same cart, different number: its own order, without the cart's key.
      request_key := null;
    end if;
  end if;
  created := public.insert_order_with_duplicate_guard(
    p_org_id, p_phone_last10, p_product_id, p_window_start,
    p_order || jsonb_build_object('submission_key', request_key)
  );
  return jsonb_build_object('order', to_jsonb(created), 'replayed', false);
end;
$$;
revoke all on function public.insert_order_once(uuid, text, uuid, timestamptz, jsonb, text) from public, anon, authenticated;
grant execute on function public.insert_order_once(uuid, text, uuid, timestamptz, jsonb, text) to service_role;
notify pgrst, 'reload schema';
