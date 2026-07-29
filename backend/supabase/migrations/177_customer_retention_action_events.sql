-- Migration 177: audit retention Call and WhatsApp actions separately from
-- outcome logs. Opening a channel is useful activity, but it must not count
-- as a successful customer contact until the rep logs the real outcome.

create table if not exists public.customer_retention_action_events (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  order_id    text not null references public.orders(id) on delete cascade,
  action_type text not null check (action_type in ('call', 'whatsapp')),
  context     text not null default 'worklist',
  logged_by   uuid references public.users(id) on delete set null,
  logged_at   timestamptz not null default now()
);

create index if not exists idx_crae_order
  on public.customer_retention_action_events(org_id, order_id, logged_at desc);
create index if not exists idx_crae_logged_by
  on public.customer_retention_action_events(org_id, logged_by, logged_at desc);

alter table public.customer_retention_action_events enable row level security;

drop policy if exists "customer retention action events select" on public.customer_retention_action_events;
create policy "customer retention action events select"
  on public.customer_retention_action_events
  for select
  to authenticated
  using (
    org_id = private.auth_org_id()
    and private.auth_user_role()::text in ('Owner', 'Admin', 'Manager', 'Recovery Rep')
  );

drop policy if exists "customer retention action events insert" on public.customer_retention_action_events;
create policy "customer retention action events insert"
  on public.customer_retention_action_events
  for insert
  to authenticated
  with check (
    org_id = private.auth_org_id()
    and private.auth_user_role()::text in ('Owner', 'Admin', 'Manager', 'Recovery Rep')
  );
