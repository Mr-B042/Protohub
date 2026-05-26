create table if not exists public.remittance_transactions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  order_id text not null references public.orders(id) on delete cascade,
  delta_amount numeric(12,2) not null,
  previous_amount_remitted numeric(12,2) not null default 0,
  running_amount_remitted numeric(12,2) not null default 0,
  received_at timestamptz not null default now(),
  logged_by_user_id uuid references public.users(id) on delete set null,
  logged_by_name text,
  reason text
);
create index if not exists idx_remittance_transactions_org_received_at
  on public.remittance_transactions (org_id, received_at desc);
create index if not exists idx_remittance_transactions_order_received_at
  on public.remittance_transactions (order_id, received_at desc);
