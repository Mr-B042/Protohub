-- Migration 086: per-field audit trail for manual order edits.
--
-- order_audit only tracks status changes (from_status/to_status). Manual
-- edits via PATCH /api/orders/:id — product, package, customer info,
-- amounts, assignments, dates — leave no trace. Bright's admin recently
-- rewrote orders #379 and #387 (product_name + package_id) and there was
-- no way to see who/when from the existing trail.
--
-- This table records every tracked field change with from/to values as
-- jsonb so it handles strings, numbers, uuids, dates, and nulls uniformly.
-- changed_by_name is snapshotted so the trail survives if the user is
-- later deleted (FK uses ON DELETE SET NULL).

create table if not exists public.order_field_edits (
  id              uuid primary key default gen_random_uuid(),
  order_id        text not null references public.orders(id) on delete cascade,
  org_id          uuid not null references public.organizations(id) on delete cascade,
  changed_by      uuid references public.users(id) on delete set null,
  changed_by_name text,
  field_name      text not null,
  from_value      jsonb,
  to_value        jsonb,
  created_at      timestamp with time zone not null default now()
);

create index if not exists idx_order_field_edits_order
  on public.order_field_edits (order_id, created_at desc);
create index if not exists idx_order_field_edits_org
  on public.order_field_edits (org_id, created_at desc);

-- RLS: same shape as order_audit — org members can read their org's rows.
alter table public.order_field_edits enable row level security;

create policy "Org members read order field edits"
  on public.order_field_edits
  for select
  using (org_id = auth_org_id());

create policy "Service role manages order field edits"
  on public.order_field_edits
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
