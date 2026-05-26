alter table public.orders
  add column if not exists assigned_by_user_id uuid,
  add column if not exists assigned_by_name_snapshot text;
create index if not exists idx_orders_org_assigned_by_user
  on public.orders(org_id, assigned_by_user_id, created_at desc);
update public.orders as o
set assigned_by_name_snapshot = 'Round-robin'
where o.assigned_rep_id is not null
  and o.assigned_by_user_id is null
  and coalesce(o.assigned_by_name_snapshot, '') = ''
  and exists (
    select 1
    from public.order_audit oa
    where oa.order_id = o.id
      and oa.org_id = o.org_id
      and oa.note ilike '%auto-assigned by round-robin%'
  );
