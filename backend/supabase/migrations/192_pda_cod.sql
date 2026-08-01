-- 192: cash-on-delivery reconciliation for Personal Delivery Agents.
--
-- The governing decision: an agent NEVER nets their delivery fee off the
-- customer's cash. They collect the full amount, remit the full amount, and
-- are paid their fee separately. Netting hides shortages - if an agent is
-- allowed to keep ₦4,500 and hand over the rest, a ₦4,500 shortfall and a
-- correctly deducted fee look identical in the books.
--
-- So: Amount Due to Protohub == Amount Collected. Always. The fee lives in a
-- separate earnings ledger and is only payable once the cash is in.

-- What the agent still owes on each delivered order.
alter table public.pda_order_assignments
  add column if not exists amount_remitted numeric not null default 0,
  add column if not exists reconciliation_status text not null default 'Awaiting Collection Confirmation',
  add column if not exists earning_status text not null default 'Pending',
  add column if not exists earning_available_at timestamptz,
  add column if not exists earning_paid_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'pda_reconciliation_status_valid') then
    alter table public.pda_order_assignments
      add constraint pda_reconciliation_status_valid check (reconciliation_status in (
        'Awaiting Collection Confirmation','Cash Held by Agent','Partially Remitted',
        'Fully Remitted','Under Review','Short Payment','Overpayment','Reconciled','Nothing to Remit'
      ));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'pda_earning_status_valid') then
    alter table public.pda_order_assignments
      add constraint pda_earning_status_valid check (earning_status in
        ('Pending','Available','Paid','Withheld'));
  end if;
end $$;

-- ── Cash handed over by an agent ─────────────────────────
-- Logged by the office when the money is actually received, never by the agent
-- declaring it sent - "I paid it" and "we have it" are different facts.
create table if not exists public.pda_remittances (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null,
  agent_id      uuid not null references public.personal_delivery_agents(id) on delete cascade,
  amount        numeric not null,
  method        text not null default 'Cash',
  reference     text,
  note          text,
  received_by   uuid,
  received_by_name text,
  received_at   timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  constraint pda_remittance_amount_positive check (amount > 0),
  constraint pda_remittance_method_valid check (method in ('Cash','Transfer','POS','Other'))
);

create index if not exists idx_pda_remittance_agent on public.pda_remittances (agent_id, received_at desc);

-- Which orders a payment cleared. One payment can settle several deliveries,
-- so the allocation is explicit rather than inferred from dates.
create table if not exists public.pda_remittance_allocations (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null,
  remittance_id uuid not null references public.pda_remittances(id) on delete cascade,
  assignment_id uuid not null references public.pda_order_assignments(id) on delete cascade,
  amount        numeric not null,
  created_at    timestamptz not null default now(),
  constraint pda_allocation_amount_positive check (amount > 0),
  constraint pda_allocation_unique unique (remittance_id, assignment_id)
);

create index if not exists idx_pda_allocation_assignment on public.pda_remittance_allocations (assignment_id);

-- ── Delivery fees actually paid out to an agent ──────────
create table if not exists public.pda_earning_payouts (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null,
  agent_id      uuid not null references public.personal_delivery_agents(id) on delete cascade,
  amount        numeric not null,
  method        text,
  reference     text,
  note          text,
  paid_by       uuid,
  paid_by_name  text,
  paid_at       timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  constraint pda_payout_amount_positive check (amount > 0)
);

create index if not exists idx_pda_payout_agent on public.pda_earning_payouts (agent_id, paid_at desc);

alter table public.pda_remittances             enable row level security;
alter table public.pda_remittance_allocations  enable row level security;
alter table public.pda_earning_payouts         enable row level security;
