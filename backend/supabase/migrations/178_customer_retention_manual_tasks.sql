-- Migration 178: manually-created retention tasks.
--
-- The Tasks page is otherwise a VIEW over the derived worklist (delivered
-- order + its due lifecycle stage). That covers everything the lifecycle
-- itself asks for, but it cannot represent work a rep or supervisor
-- invents: "call this customer back about the damaged lid", a general
-- check-in with no lifecycle trigger, or a batch imported from a call
-- sheet. Those live here.
--
-- This table is ADDITIVE and deliberately NOT wired into the bonus or KPI
-- math - derived lifecycle tasks remain the single source of truth for
-- retention reporting, exactly as customer_retention_touchpoints does for
-- completed work. A manual task is a reminder, not a business event.

create table if not exists public.customer_retention_tasks (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations(id) on delete cascade,
  -- Nullable: a General Check-in may target a customer, not a specific order.
  order_id         text references public.orders(id) on delete cascade,
  customer_name    text not null,
  customer_phone   text not null,
  task_type        text not null check (task_type in (
                     'satisfaction_check', 'complaint_follow_up', 'review_request',
                     'referral_request', 'repeat_sale_offer', 'win_back_call',
                     'scheduled_follow_up', 'general_check_in'
                   )),
  title            text not null,
  note             text,
  priority         text not null default 'medium' check (priority in ('high', 'medium', 'low')),
  status           text not null default 'pending' check (status in ('pending', 'completed', 'cancelled')),
  due_at           timestamptz not null,
  assigned_rep_id  uuid references public.users(id) on delete set null,
  created_by       uuid references public.users(id) on delete set null,
  completed_at     timestamptz,
  completed_by     uuid references public.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists idx_crmt_org_due
  on public.customer_retention_tasks(org_id, status, due_at);
create index if not exists idx_crmt_assigned
  on public.customer_retention_tasks(org_id, assigned_rep_id, due_at);
create index if not exists idx_crmt_order
  on public.customer_retention_tasks(org_id, order_id);

alter table public.customer_retention_tasks enable row level security;

-- Same visibility rule as retention assignments: supervisors see the whole
-- org, a Recovery Rep sees what is assigned to them (or unassigned work
-- they could pick up).
drop policy if exists "customer retention tasks select" on public.customer_retention_tasks;
create policy "customer retention tasks select"
  on public.customer_retention_tasks
  for select
  to authenticated
  using (
    org_id = private.auth_org_id()
    and (
      private.auth_user_role()::text in ('Owner', 'Admin', 'Manager')
      or (
        private.auth_user_role()::text = 'Recovery Rep'
        and (assigned_rep_id = auth.uid() or assigned_rep_id is null)
      )
    )
  );

drop policy if exists "customer retention tasks insert" on public.customer_retention_tasks;
create policy "customer retention tasks insert"
  on public.customer_retention_tasks
  for insert
  to authenticated
  with check (
    org_id = private.auth_org_id()
    and private.auth_user_role()::text in ('Owner', 'Admin', 'Manager', 'Recovery Rep')
  );

drop policy if exists "customer retention tasks update" on public.customer_retention_tasks;
create policy "customer retention tasks update"
  on public.customer_retention_tasks
  for update
  to authenticated
  using (
    org_id = private.auth_org_id()
    and (
      private.auth_user_role()::text in ('Owner', 'Admin', 'Manager')
      or (private.auth_user_role()::text = 'Recovery Rep' and assigned_rep_id = auth.uid())
    )
  )
  with check (
    org_id = private.auth_org_id()
    and private.auth_user_role()::text in ('Owner', 'Admin', 'Manager', 'Recovery Rep')
  );
