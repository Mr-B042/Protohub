-- Closes a race condition in the public order-create endpoint: the
-- duplicate-order check (same phone + product within a rolling 7-day window)
-- previously ran as a separate SELECT before the INSERT, with ~300 lines of
-- unrelated work in between and no locking - two requests landing within a
-- couple of milliseconds of each other could both run their SELECT before
-- either INSERT committed, so both would see zero prior matches and neither
-- would get held for review (confirmed against two real prod orders whose
-- created_at timestamps were 1.4ms apart, both review_hold=false).
--
-- This function makes the check-and-insert atomic: an advisory lock keyed on
-- (org_id, phone_last10, product_id) is held for the lifetime of this single
-- function call (pg_advisory_xact_lock is transaction-scoped and releases at
-- commit/rollback - deliberately NOT pg_advisory_lock, which is session-scoped
-- and unsafe here since the backend talks to Postgres through PostgREST/a
-- pooled connection with no guarantee the same session spans two separate
-- HTTP calls). A second near-simultaneous call for the same key blocks until
-- the first's insert has committed, at which point its own duplicate check
-- correctly sees the first order and gets held.
--
-- The INSERT column list is built dynamically from the intersection of "keys
-- present in the payload" and "columns that actually exist on orders right
-- now" - NOT a plain `insert ... select * from jsonb_populate_record(...)`,
-- because jsonb_populate_record's base row starts all-NULL: a column the
-- payload omits (e.g. `id`, which relies on nextval('orders_id_seq') as its
-- default) would otherwise be explicitly inserted as NULL instead of being
-- left out of the statement entirely, bypassing its default and violating
-- its NOT NULL constraint (caught by hand-testing this migration before
-- shipping it). Building the column list from the payload's own keys also
-- means an environment lagging a schema column or two behind (e.g. local dev
-- mid-migration) degrades gracefully - that column is simply excluded from
-- the INSERT - same intent as the Node-side retry loop this replaces, just
-- without needing the retry.
create or replace function public.insert_order_with_duplicate_guard(
  p_org_id uuid,
  p_phone_last10 text,
  p_product_id uuid,
  p_window_start timestamptz,
  p_order jsonb
) returns public.orders
language plpgsql
as $$
declare
  lock_key bigint;
  prior_count int := 0;
  review_hold boolean := false;
  review_reason text := null;
  payload jsonb;
  cols text;
  vals text;
  inserted public.orders;
begin
  -- Fail fast instead of hanging the request forever if the lock is ever
  -- somehow stuck.
  set local lock_timeout = '5s';

  lock_key := hashtextextended(p_org_id::text || ':' || coalesce(p_phone_last10, '') || ':' || coalesce(p_product_id::text, ''), 0);
  perform pg_advisory_xact_lock(lock_key);

  if p_phone_last10 is not null and length(p_phone_last10) >= 10 and p_product_id is not null then
    select count(*) into prior_count
    from public.orders
    where org_id = p_org_id
      and product_id = p_product_id
      and right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 10) = p_phone_last10
      and created_at >= p_window_start;

    if prior_count >= 1 then
      review_hold := true;
      review_reason := format('Possible duplicate: %s orders for this product from this number in the last 7 days — held for review.', prior_count + 1);
    end if;
  end if;

  payload := p_order || jsonb_build_object('review_hold', review_hold, 'review_reason', review_reason);
  -- If this recheck (running under the lock, so it's the authoritative call)
  -- flips a request that Node's earlier, non-atomic pre-check had already
  -- auto-assigned to a rep, the stored row must not keep that assignment -
  -- a held/duplicate order should read as unassigned, same as one the
  -- pre-check caught normally. The rep-notification side effects that
  -- already fired in Node a few hundred ms earlier (round-robin cursor
  -- advance, etc.) aren't undone - a harmless, self-correcting fairness
  -- blip in the rare case this whole fix targets, not the order record itself.
  if review_hold then
    payload := payload || jsonb_build_object(
      'assigned_rep_id', null,
      'assigned_by_user_id', null,
      'assigned_by_name_snapshot', null
    );
  end if;

  select
    string_agg(quote_ident(col.column_name), ', ' order by col.ordinal_position),
    string_agg(format('(r).%I', col.column_name), ', ' order by col.ordinal_position)
    into cols, vals
  from jsonb_object_keys(payload) as k(key)
  join information_schema.columns col
    on col.table_schema = 'public'
   and col.table_name = 'orders'
   and col.column_name = k.key;

  if cols is null then
    raise exception 'insert_order_with_duplicate_guard: payload matched no orders columns';
  end if;

  execute format(
    'insert into public.orders (%s) select %s from jsonb_populate_record(null::public.orders, $1) as r returning *',
    cols, vals
  ) using payload
    into inserted;

  return inserted;
end;
$$;

grant execute on function public.insert_order_with_duplicate_guard(uuid, text, uuid, timestamptz, jsonb) to service_role, anon;

-- Keeps the authoritative recheck (now the hot query, run under the lock)
-- fast - it's scoped to org+product+time, same predicate shape as the old
-- Node-side org-wide-then-filter-in-JS query but now filtered server-side.
create index if not exists orders_org_product_created_at_idx
  on public.orders (org_id, product_id, created_at);

-- Makes the new function immediately visible to PostgREST's schema cache
-- instead of waiting for its next periodic refresh (same precaution used in
-- migration 150 after adding new RPC-callable functions).
notify pgrst, 'reload schema';
