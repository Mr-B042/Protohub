-- Migration 176: separate post-delivery retention ownership from the
-- original sales-rep assignment on orders.
--
-- `orders.assigned_rep_id` remains the Sales Rep who owns the sale.
-- This table owns the Customer Retention lifecycle independently.

create table if not exists public.customer_retention_assignments (
  order_id           text primary key references public.orders(id) on delete cascade,
  org_id             uuid not null references public.organizations(id) on delete cascade,
  recovery_rep_id    uuid references public.users(id) on delete set null,
  assigned_by        uuid references public.users(id) on delete set null,
  assignment_source  text not null default 'manual'
    check (assignment_source in ('manual', 'single_active_rep')),
  assigned_at        timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists idx_customer_retention_assignments_rep
  on public.customer_retention_assignments(org_id, recovery_rep_id, updated_at desc);

alter table public.customer_retention_assignments enable row level security;

drop policy if exists "customer retention assignments select" on public.customer_retention_assignments;
create policy "customer retention assignments select"
  on public.customer_retention_assignments
  for select
  to authenticated
  using (
    org_id = private.auth_org_id()
    and (
      private.auth_user_role()::text in ('Owner', 'Admin', 'Manager')
      or (
        private.auth_user_role()::text = 'Recovery Rep'
        and recovery_rep_id = auth.uid()
      )
    )
  );

drop policy if exists "customer retention assignments insert supervisors" on public.customer_retention_assignments;
create policy "customer retention assignments insert supervisors"
  on public.customer_retention_assignments
  for insert
  to authenticated
  with check (
    org_id = private.auth_org_id()
    and private.auth_user_role()::text in ('Owner', 'Admin', 'Manager')
  );

drop policy if exists "customer retention assignments update supervisors" on public.customer_retention_assignments;
create policy "customer retention assignments update supervisors"
  on public.customer_retention_assignments
  for update
  to authenticated
  using (
    org_id = private.auth_org_id()
    and private.auth_user_role()::text in ('Owner', 'Admin', 'Manager')
  )
  with check (
    org_id = private.auth_org_id()
    and private.auth_user_role()::text in ('Owner', 'Admin', 'Manager')
  );

-- When an organization has exactly one active Recovery Rep, all delivered
-- orders belong to that rep's retention queue. This also repairs assignments
-- left on an inactive former rep. With two or more active Recovery Reps,
-- existing assignments remain stable and supervisors assign new work.
create or replace function public.reconcile_single_recovery_rep_assignments(p_org_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rep_id uuid;
  v_rep_count integer;
  v_changed integer := 0;
begin
  select count(*)::integer, (array_agg(id order by created_at, id))[1]
    into v_rep_count, v_rep_id
  from public.users
  where org_id = p_org_id
    and active = true
    and role::text = 'Recovery Rep';

  if v_rep_count <> 1 or v_rep_id is null then
    return 0;
  end if;

  insert into public.customer_retention_assignments (
    order_id,
    org_id,
    recovery_rep_id,
    assigned_by,
    assignment_source,
    assigned_at,
    updated_at
  )
  select
    orders.id,
    orders.org_id,
    v_rep_id,
    null,
    'single_active_rep',
    now(),
    now()
  from public.orders
  where orders.org_id = p_org_id
    and orders.status::text = 'Delivered'
  on conflict (order_id) do update
    set recovery_rep_id = excluded.recovery_rep_id,
        assigned_by = null,
        assignment_source = 'single_active_rep',
        updated_at = now()
    where customer_retention_assignments.recovery_rep_id is distinct from excluded.recovery_rep_id;

  get diagnostics v_changed = row_count;
  return v_changed;
end;
$$;

revoke all on function public.reconcile_single_recovery_rep_assignments(uuid) from public;
revoke all on function public.reconcile_single_recovery_rep_assignments(uuid) from anon;
revoke all on function public.reconcile_single_recovery_rep_assignments(uuid) from authenticated;
grant execute on function public.reconcile_single_recovery_rep_assignments(uuid) to service_role;

create or replace function public.assign_delivered_order_to_single_recovery_rep()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status::text = 'Delivered' then
    perform public.reconcile_single_recovery_rep_assignments(new.org_id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_assign_delivered_order_to_single_recovery_rep on public.orders;
create trigger trg_assign_delivered_order_to_single_recovery_rep
  after insert or update of status on public.orders
  for each row
  when (new.status::text = 'Delivered')
  execute function public.assign_delivered_order_to_single_recovery_rep();

create or replace function public.reconcile_retention_assignments_after_user_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public.reconcile_single_recovery_rep_assignments(old.org_id);
    return old;
  end if;

  perform public.reconcile_single_recovery_rep_assignments(new.org_id);
  if tg_op = 'UPDATE' and old.org_id is distinct from new.org_id then
    perform public.reconcile_single_recovery_rep_assignments(old.org_id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_reconcile_retention_assignments_after_user_change on public.users;
create trigger trg_reconcile_retention_assignments_after_user_change
  after insert or delete or update of active, role, org_id on public.users
  for each row
  execute function public.reconcile_retention_assignments_after_user_change();

-- Backfill every organization that already has one active Recovery Rep.
select public.reconcile_single_recovery_rep_assignments(id)
from public.organizations;
