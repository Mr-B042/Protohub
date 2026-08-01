-- 191: stock held by Personal Delivery Agents.
--
-- Agents cannot collect from one central office across Nigeria, so stock is
-- SENT to them and they confirm what actually arrived. Until they confirm, the
-- units belong to neither side cleanly, which is why "in transit" is a state of
-- the transfer rather than of the agent's stock.
--
-- Company Stock → Transfer Created → In Transit → Agent Confirms Receipt →
-- Agent Available Stock.

-- ── Transfers out to an agent ────────────────────────────
create table if not exists public.pda_stock_transfers (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null,
  agent_id        uuid not null references public.personal_delivery_agents(id) on delete cascade,
  product_id      text not null,
  product_name    text,
  quantity_sent   integer not null,
  -- What the agent says actually arrived. A shortfall is a real event, not an
  -- error to be overwritten, so both numbers are kept.
  quantity_received integer,
  condition_note  text,
  waybill_reference text,
  proof_file_path text,
  status          text not null default 'In Transit',
  sent_by         uuid,
  sent_at         timestamptz not null default now(),
  confirmed_at    timestamptz,
  company_confirmed_at timestamptz,
  company_confirmed_by uuid,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint pda_transfer_qty_positive check (quantity_sent > 0),
  constraint pda_transfer_status_valid check (status in
    ('In Transit','Received','Received Short','Received Damaged','Cancelled','Disputed'))
);

create index if not exists idx_pda_transfer_agent on public.pda_stock_transfers (agent_id, status);

-- ── What each agent currently holds ──────────────────────
-- One row per agent+product. Every column is a state a unit can be in, so the
-- agent's true holding is the sum - a unit is never counted twice.
create table if not exists public.pda_agent_stock (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null,
  agent_id      uuid not null references public.personal_delivery_agents(id) on delete cascade,
  product_id    text not null,
  available     integer not null default 0,
  reserved      integer not null default 0,
  out_for_delivery integer not null default 0,
  damaged       integer not null default 0,
  missing       integer not null default 0,
  awaiting_investigation integer not null default 0,
  updated_at    timestamptz not null default now(),
  constraint pda_agent_stock_unique unique (agent_id, product_id),
  -- Stock can never go negative. A bug that would drive it below zero should
  -- fail loudly here rather than quietly invent inventory.
  constraint pda_agent_stock_non_negative check (
    available >= 0 and reserved >= 0 and out_for_delivery >= 0
    and damaged >= 0 and missing >= 0 and awaiting_investigation >= 0
  )
);

create index if not exists idx_pda_agent_stock_agent on public.pda_agent_stock (agent_id);

-- ── Every movement, ever ─────────────────────────────────
-- Agents cannot edit their own quantities; they can only report a discrepancy.
-- This table is how a balance is explained, so it is insert-only in practice.
create table if not exists public.pda_stock_ledger (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null,
  agent_id      uuid not null references public.personal_delivery_agents(id) on delete cascade,
  product_id    text not null,
  product_name  text,
  movement      text not null,
  quantity      integer not null,
  balance_after integer not null,
  order_id      text,
  transfer_id   uuid,
  note          text,
  recorded_by   uuid,
  recorded_by_name text,
  created_at    timestamptz not null default now(),
  constraint pda_ledger_movement_valid check (movement in (
    'Received from company','Reserved for order','Released back to available',
    'Out for delivery','Delivered to customer','Returned to available',
    'Written off damaged','Written off missing','Under investigation',
    'Adjustment approved','Returned to company'
  ))
);

create index if not exists idx_pda_ledger_agent on public.pda_stock_ledger (agent_id, created_at desc);
create index if not exists idx_pda_ledger_order on public.pda_stock_ledger (order_id);

-- ── Discrepancies an agent reports ───────────────────────
-- The agent's ONLY lever over their own numbers. Reporting changes nothing on
-- its own; a manager has to approve before any quantity moves.
create table if not exists public.pda_stock_discrepancies (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null,
  agent_id      uuid not null references public.personal_delivery_agents(id) on delete cascade,
  product_id    text not null,
  reported_quantity integer not null,
  system_quantity   integer not null,
  reason        text not null,
  agent_note    text,
  proof_file_path text,
  status        text not null default 'Reported',
  reviewed_by   uuid,
  reviewed_at   timestamptz,
  review_note   text,
  created_at    timestamptz not null default now(),
  constraint pda_discrepancy_status_valid check (status in
    ('Reported','Under Investigation','Approved','Rejected'))
);

create index if not exists idx_pda_discrepancy_agent on public.pda_stock_discrepancies (agent_id, status);

-- Stock is settled once per assignment. Re-saving a delivered order must not
-- deduct twice - the same non-idempotency that once over-deducted 275 units
-- across 42 orders on the main order flow.
alter table public.pda_order_assignments
  add column if not exists stock_settled boolean not null default false;

alter table public.pda_stock_transfers      enable row level security;
alter table public.pda_agent_stock          enable row level security;
alter table public.pda_stock_ledger         enable row level security;
alter table public.pda_stock_discrepancies  enable row level security;
