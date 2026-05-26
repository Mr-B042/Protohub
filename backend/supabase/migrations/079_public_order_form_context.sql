alter table public.orders
  add column if not exists form_context jsonb not null default '{}'::jsonb;

create index if not exists idx_orders_form_context_gin
  on public.orders using gin (form_context);
