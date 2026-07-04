-- Migration 148: weighted round-robin for Dedicated Products.
--
-- Today, pinning sales reps to a product (products.dedicated_handler_user_ids)
-- is a binary set — whoever is pinned shares that product's orders in a strict
-- equal split, via the shared users.round_robin_position cursor (the same
-- cursor used by the org-wide Active Sequence). A single shared numeric column
-- can't express "this rep moves at 60% speed on product A but 100% on product
-- B", so dedicated-product rotation gets its own per-(product, user) state
-- here, fully decoupled from round_robin_position/round_robin_excluded (which
-- keep driving the global fallback exactly as before).
--
-- product_dedicated_handlers is the new editable source of truth for a
-- product's dedicated handlers + their relative weights. weight defaults to
-- 100 (today's exact equal split); assigned_count is a running total used to
-- pick the next rep by lowest assigned_count/weight ratio (deficit
-- scheduling) — this converges to the configured proportions over time and
-- reduces to today's exact equal rotation when every weight matches.
--
-- products.dedicated_handler_user_ids is kept and backend-mirrored (never
-- independently written) for backward compatibility — same "supersede but
-- don't drop" move already made once for the legacy singular
-- dedicated_handler_user_id column in migration 134.

create table product_dedicated_handlers (
  product_id       uuid not null references products(id) on delete cascade,
  user_id          uuid not null references users(id) on delete cascade,
  weight           integer not null default 100 check (weight >= 0 and weight <= 100000),
  assigned_count   bigint  not null default 0    check (assigned_count >= 0),
  last_assigned_at timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  primary key (product_id, user_id)
);

create index product_dedicated_handlers_product_idx on product_dedicated_handlers(product_id);

create trigger product_dedicated_handlers_updated_at
  before update on product_dedicated_handlers
  for each row execute function set_updated_at();

-- Backfill: every product currently pinning reps via the legacy array gets
-- one row per rep at weight 100 (today's exact equal split), assigned_count
-- 0. Nothing changes in behavior until an owner edits a weight. The `exists`
-- guard defends against any stale id lingering in the (FK-less) legacy array.
insert into product_dedicated_handlers (product_id, user_id, weight, assigned_count)
select p.id, h.user_id, 100, 0
from products p
cross join lateral unnest(p.dedicated_handler_user_ids) as h(user_id)
where p.dedicated_handler_user_ids is not null
  and array_length(p.dedicated_handler_user_ids, 1) > 0
  and exists (select 1 from users u where u.id = h.user_id)
on conflict (product_id, user_id) do nothing;

alter table product_dedicated_handlers enable row level security;

create policy "product dedicated handlers select org members"
  on product_dedicated_handlers for select
  using (
    exists (
      select 1 from products p
      where p.id = product_id and p.org_id = (select private.auth_org_id())
    )
  );

create policy "product dedicated handlers write inventory roles"
  on product_dedicated_handlers for all
  using (
    exists (
      select 1 from products p
      where p.id = product_id and p.org_id = (select private.auth_org_id())
    )
    and (select private.auth_user_role()) in ('Owner', 'Admin', 'Inventory Manager')
  )
  with check (
    exists (
      select 1 from products p
      where p.id = product_id and p.org_id = (select private.auth_org_id())
    )
    and (select private.auth_user_role()) in ('Owner', 'Admin', 'Inventory Manager')
  );

-- Atomic pick-and-advance: SELECT ... FOR UPDATE + UPDATE in one statement so
-- concurrent order creation for the same product can't lose an update (a
-- second concurrent call blocks on the row lock, then re-reads post-commit
-- state). Deliberately not SKIP LOCKED — that would let a concurrent request
-- silently pick the second-best (higher-ratio) rep instead of waiting for the
-- correct one, degrading fairness under load.
create or replace function pick_and_advance_dedicated_handler(p_product_id uuid, p_org_id uuid)
returns uuid
language plpgsql
as $$
declare
  picked uuid;
begin
  select pdh.user_id into picked
  from product_dedicated_handlers pdh
  join users u on u.id = pdh.user_id
  where pdh.product_id = p_product_id
    and pdh.weight > 0
    and u.org_id = p_org_id
    and u.active = true
  order by (pdh.assigned_count::numeric / pdh.weight) asc,
           pdh.last_assigned_at asc nulls first,
           pdh.user_id asc
  limit 1
  for update of pdh;

  if picked is null then
    return null;
  end if;

  update product_dedicated_handlers
  set assigned_count = assigned_count + 1,
      last_assigned_at = now()
  where product_id = p_product_id and user_id = picked;

  return picked;
end;
$$;

grant execute on function pick_and_advance_dedicated_handler(uuid, uuid) to service_role;
