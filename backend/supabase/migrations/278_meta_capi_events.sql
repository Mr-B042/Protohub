-- Meta Conversions API: a record of every send, and an optional delivered-
-- sale event (Bright, 1 Oct 2026). Additive only.
--
-- Before this, whether a Purchase reached Meta was only in the server logs.
-- meta_capi_events keeps one row per order per event: Purchase (sent when the
-- order is created) and Delivered (sent when the order is delivered, if the
-- Meta setting has it switched on). The Delivered job reads this table so it
-- never sends the same order twice.
--
-- Delivered events exist because Purchase at order creation counts every
-- submitted order, and with pay on delivery a large share never pay. Sending
-- the delivered sale lets the ads be optimised on people who actually pay.

create table if not exists public.meta_capi_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  order_id text not null,
  -- Our name for the event: 'Purchase' or 'Delivered'.
  event_name text not null check (event_name in ('Purchase', 'Delivered')),
  -- The name Meta received (e.g. 'OrderDelivered' for the delivered event).
  meta_event_name text not null,
  event_id text not null,
  status text not null check (status in ('sent', 'dry_run', 'rejected', 'failed', 'duplicate', 'missing_config')),
  http_status integer,
  message text,
  test_mode boolean not null default false,
  value numeric(14, 2),
  currency text,
  attempts integer not null default 1,
  sent_at timestamptz not null default now()
);

create unique index if not exists meta_capi_events_order_event on public.meta_capi_events (org_id, order_id, event_name);
create index if not exists meta_capi_events_recent on public.meta_capi_events (org_id, sent_at desc);

alter table public.meta_capi_events enable row level security;

create policy "meta capi events select leadership" on public.meta_capi_events
  for select to authenticated
  using (org_id = private.auth_org_id() and private.auth_user_role()::text in ('Owner', 'Admin'));

-- The delivered-sale event is off until switched on per Meta setting.
alter table public.meta_capi_configs add column if not exists send_delivered_event boolean not null default false;
alter table public.meta_capi_configs add column if not exists delivered_event_name text not null default 'OrderDelivered';
