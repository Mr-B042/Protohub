-- 197: payment verification and first-class COD discrepancies.
--
-- A remittance row previously meant "money arrived", full stop. In practice a
-- bank transfer can be claimed, land late, or bounce - so a payment needs a
-- verification state of its own, and a rejected payment must NOT keep counting
-- as cash received.
alter table public.pda_remittances
  add column if not exists payment_code text,
  add column if not exists status text not null default 'Verified',
  add column if not exists verified_by uuid,
  add column if not exists verified_by_name text,
  add column if not exists verified_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'pda_remittance_status_valid') then
    alter table public.pda_remittances
      add constraint pda_remittance_status_valid check (status in ('Verified','Pending Verification','Rejected'));
  end if;
end $$;

comment on column public.pda_remittances.status is
  'Rejected payments are excluded from cash received - a bounced transfer is not money (migration 197).';

-- ── COD discrepancies ────────────────────────────────────
-- A variance between what an agent should have handed over and what arrived.
-- Kept separate from `pda_incidents` because most variances are ordinary
-- accounting differences to resolve, not misconduct to investigate - and
-- treating every short payment as an incident would make real incidents
-- invisible in the noise.
create table if not exists public.pda_cod_discrepancies (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null,
  discrepancy_code text,
  agent_id         uuid not null references public.personal_delivery_agents(id) on delete cascade,
  assignment_id    uuid references public.pda_order_assignments(id) on delete set null,
  order_id         text,
  customer_name    text,
  discrepancy_type text not null,
  expected_amount  numeric not null default 0,
  actual_amount    numeric not null default 0,
  -- Stored rather than derived so a historical case keeps the figure that was
  -- actually disputed, even if the underlying order is corrected later.
  variance         numeric not null default 0,
  status           text not null default 'Pending',
  note             text,
  reported_by      uuid,
  reported_by_name text,
  resolved_by      uuid,
  resolved_by_name text,
  resolution_note  text,
  resolved_at      timestamptz,
  created_at       timestamptz not null default now(),
  constraint pda_cod_discrepancy_type_valid check (discrepancy_type in
    ('Underpayment','Overpayment','Refund Not Deducted','Missing Payment','Wrong Amount Collected','Other')),
  constraint pda_cod_discrepancy_status_valid check (status in
    ('Pending','Under Review','Resolved','Written Off','Rejected'))
);

create index if not exists idx_pda_cod_disc_agent on public.pda_cod_discrepancies (agent_id, status);
create index if not exists idx_pda_cod_disc_org on public.pda_cod_discrepancies (org_id, created_at desc);

alter table public.pda_cod_discrepancies enable row level security;
