-- Inventory valuation snapshots: what stock was worth at a moment in time.
--
-- The Inventory Value page is DERIVED from live stock and current unit costs,
-- and that is right for "what is it worth today". It is wrong for closing a
-- week: live stock keeps moving, and a cost edited next month would silently
-- restate a week already reported on. A snapshot freezes the count and the
-- costs so a closed week keeps saying what it said.
--
-- ⚠️ A snapshot is a RECORD, not a correction. Saving one never writes back to
-- products.warehouse_stock or agent_location_stock - if a physical count
-- disagrees with the system, that is a stock adjustment, made deliberately
-- through the stock module where it lands in stock_movements and stays
-- auditable. Letting a valuation quietly rewrite stock levels would launder a
-- discrepancy into the books with no trace of what changed.

create table if not exists inventory_valuation_snapshots (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  -- Sunday, the official week anchor shared with payroll and cash.
  week_start date not null,
  status text not null default 'draft',
  -- Held on the parent so a snapshot reads back without re-summing its lines,
  -- and so the figure survives even if a product row is later deleted.
  total_units numeric not null default 0,
  total_value numeric not null default 0,
  notes text not null default '',
  captured_by uuid references users(id) on delete set null,
  captured_by_name text not null default '',
  captured_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inventory_valuation_snapshots_week_unique unique (org_id, week_start),
  constraint inventory_valuation_snapshots_status_check check (status in ('draft', 'final')),
  constraint inventory_valuation_snapshots_notes_len check (char_length(notes) <= 500)
);

create index if not exists inventory_valuation_snapshots_org_week_idx
  on inventory_valuation_snapshots (org_id, week_start desc);

create table if not exists inventory_valuation_snapshot_lines (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references inventory_valuation_snapshots(id) on delete cascade,
  product_id uuid references products(id) on delete set null,
  -- Kept alongside the id so a deleted product still names itself in a closed
  -- week's valuation instead of leaving a blank row.
  product_name text not null default '',
  units numeric not null default 0,
  unit_cost numeric not null default 0,
  value numeric not null default 0,
  condition text not null default 'healthy',
  note text not null default '',
  created_at timestamptz not null default now(),
  constraint inventory_valuation_snapshot_lines_condition_check
    check (condition in ('healthy', 'slow_moving', 'at_risk', 'damaged')),
  constraint inventory_valuation_snapshot_lines_note_len check (char_length(note) <= 200)
);

create index if not exists inventory_valuation_snapshot_lines_parent_idx
  on inventory_valuation_snapshot_lines (snapshot_id);

alter table inventory_valuation_snapshots enable row level security;
alter table inventory_valuation_snapshot_lines enable row level security;

drop policy if exists inventory_valuation_snapshots_select on inventory_valuation_snapshots;
create policy inventory_valuation_snapshots_select on inventory_valuation_snapshots
  for select to authenticated
  using (org_id in (select org_id from users where id = auth.uid()));

drop policy if exists inventory_valuation_snapshot_lines_select on inventory_valuation_snapshot_lines;
create policy inventory_valuation_snapshot_lines_select on inventory_valuation_snapshot_lines
  for select to authenticated
  using (snapshot_id in (
    select id from inventory_valuation_snapshots
    where org_id in (select org_id from users where id = auth.uid())
  ));

-- Saving a snapshot atomically.
--
-- ⚠️ Same hazard as the other weekly saves: delete-then-insert across two
-- round trips destroys the valuation being corrected if the second call fails.
-- Parent upserted, lines replaced, one transaction, only the named week.
--
-- A snapshot already marked 'final' is refused. A closed week's valuation is
-- what the accounts were reported on; silently replacing it would restate a
-- period that has already been signed off.
create or replace function public.save_inventory_valuation(
  p_org_id uuid,
  p_week_start date,
  p_status text,
  p_notes text,
  p_captured_by uuid,
  p_captured_by_name text,
  p_lines jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_existing_status text;
  v_units numeric;
  v_value numeric;
begin
  select id, status into v_id, v_existing_status
    from inventory_valuation_snapshots
   where org_id = p_org_id and week_start = p_week_start;

  if v_existing_status = 'final' then
    raise exception 'This week''s valuation is already final and cannot be replaced.';
  end if;

  select coalesce(sum(coalesce((item->>'units')::numeric, 0)), 0),
         coalesce(sum(coalesce((item->>'value')::numeric, 0)), 0)
    into v_units, v_value
    from jsonb_array_elements(p_lines) as item;

  insert into inventory_valuation_snapshots (
    org_id, week_start, status, total_units, total_value, notes,
    captured_by, captured_by_name, captured_at
  ) values (
    p_org_id, p_week_start, p_status, v_units, v_value, coalesce(p_notes, ''),
    p_captured_by, coalesce(p_captured_by_name, ''), now()
  )
  on conflict (org_id, week_start)
  do update set
    status = excluded.status,
    total_units = excluded.total_units,
    total_value = excluded.total_value,
    notes = excluded.notes,
    captured_by = excluded.captured_by,
    captured_by_name = excluded.captured_by_name,
    captured_at = now(),
    updated_at = now()
  returning id into v_id;

  delete from inventory_valuation_snapshot_lines where snapshot_id = v_id;

  insert into inventory_valuation_snapshot_lines (
    snapshot_id, product_id, product_name, units, unit_cost, value, condition, note
  )
  select v_id,
         nullif(item->>'productId', '')::uuid,
         coalesce(item->>'productName', ''),
         coalesce((item->>'units')::numeric, 0),
         coalesce((item->>'unitCost')::numeric, 0),
         coalesce((item->>'value')::numeric, 0),
         coalesce(nullif(item->>'condition', ''), 'healthy'),
         coalesce(item->>'note', '')
  from jsonb_array_elements(p_lines) as item;

  return v_id;
end;
$$;

revoke all on function public.save_inventory_valuation(uuid, date, text, text, uuid, text, jsonb) from public;
revoke all on function public.save_inventory_valuation(uuid, date, text, text, uuid, text, jsonb) from anon;
revoke all on function public.save_inventory_valuation(uuid, date, text, text, uuid, text, jsonb) from authenticated;
grant execute on function public.save_inventory_valuation(uuid, date, text, text, uuid, text, jsonb) to service_role;
