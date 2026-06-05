-- Migration 100: owner-gated correction lock on SETTLED remittances.
--
-- Once a remittance is fully settled (remittance_status = 'Paid'), an Admin can no
-- longer edit/adjust it — the Owner must "open" it for correction first. The Owner
-- can open a single order OR a whole logistics-partner batch. After an Admin saves a
-- correction, the order re-locks (the flag clears). Owner can always edit directly.
-- Admins still record/adjust Pending/Partial remittances freely (normal work).

alter table public.orders
  add column if not exists remittance_edit_open       boolean not null default false,
  add column if not exists remittance_edit_opened_by  uuid references public.users(id) on delete set null,
  add column if not exists remittance_edit_opened_at  timestamp with time zone;

-- Fast lookup of what the Owner has opened for correction.
create index if not exists idx_orders_remit_edit_open
  on public.orders (org_id)
  where remittance_edit_open = true;
