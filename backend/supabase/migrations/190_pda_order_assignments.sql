-- 190: Personal Delivery Agent order assignments.
--
-- A separate table rather than more columns on `orders`, because this workflow
-- tracks THREE independent things that the single `orders.status` cannot:
--   1. whether the AGENT has accepted the job,
--   2. whether the CUSTOMER has been reached and is ready,
--   3. where the DELIVERY itself has got to.
-- Collapsing them loses the distinction that makes the whole module work - an
-- order can be accepted by the agent, with the customer not yet reachable, and
-- nothing dispatched. `orders.status` stays the single source of truth for
-- company reporting; this table is the agent's operational layer on top.
create table if not exists public.pda_order_assignments (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null,
  order_id      text not null,
  agent_id      uuid not null references public.personal_delivery_agents(id) on delete cascade,

  -- 1. Has the agent taken the job?
  assignment_status text not null default 'Awaiting Agent Acceptance',
  offered_at        timestamptz not null default now(),
  responded_at      timestamptz,
  decline_reason    text,

  -- 2. Where are we with the customer?
  customer_contact_status text not null default 'Not Contacted',
  last_contact_at         timestamptz,
  customer_ready_at       timestamptz,

  -- 3. Where is the delivery?
  delivery_status     text not null default 'Ready for Dispatch',
  dispatch_started_at timestamptz,
  expected_arrival_at timestamptz,
  arrived_at          timestamptz,
  delivered_at        timestamptz,
  failure_reason      text,
  failure_note        text,

  -- Reschedules. A firm date keeps the stock reserved; a vague "I'll call you"
  -- must NOT hold inventory hostage, so the reservation is released instead.
  rescheduled_to      date,
  reschedule_daypart  text,
  reschedule_reason   text,
  stock_reserved      boolean not null default false,

  -- The fee is agreed and LOCKED before any movement, so it cannot be
  -- renegotiated after the fact.
  delivery_fee        numeric not null default 0,
  fee_status          text not null default 'Proposed',
  fee_proposed_by     text,
  fee_locked_at       timestamptz,

  -- Proof of delivery. An order cannot be marked delivered without one.
  amount_collected    numeric,
  payment_method      text,
  proof_type          text,
  proof_file_path     text,
  proof_reference     text,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint pda_assignment_order_unique unique (order_id, agent_id),
  constraint pda_assignment_status_valid check (assignment_status in
    ('Awaiting Agent Acceptance','Accepted','Declined','Reassignment Required','Cancelled')),
  constraint pda_contact_status_valid check (customer_contact_status in
    ('Not Contacted','Contacted','Customer Ready','Not Picking','Number Not Reachable',
     'Customer Requested Callback','Customer Requested Reschedule','Customer Cancelled')),
  constraint pda_delivery_status_valid check (delivery_status in
    ('Ready for Dispatch','Dispatch Started','Arrived at Customer Location','Delivered',
     'Failed','Rejected','Rescheduled','Cancelled')),
  constraint pda_fee_status_valid check (fee_status in
    ('Proposed','Pending Approval','Approved','Rejected','Locked')),
  -- A delivered assignment must carry proof and a collected amount. Enforced
  -- in the database so no code path can quietly skip it.
  constraint pda_delivered_needs_proof check (
    delivery_status <> 'Delivered'
    or (proof_type is not null and amount_collected is not null)
  ),
  -- Dispatch cannot have started before the customer confirmed readiness.
  constraint pda_dispatch_needs_ready check (
    dispatch_started_at is null or customer_ready_at is not null
  )
);

create index if not exists idx_pda_assignment_agent on public.pda_order_assignments (agent_id, delivery_status);
create index if not exists idx_pda_assignment_order on public.pda_order_assignments (org_id, order_id);

alter table public.pda_order_assignments enable row level security;
