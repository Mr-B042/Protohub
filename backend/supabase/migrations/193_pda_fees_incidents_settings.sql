-- 193: fee schedules, negotiated rates, incidents and module settings.

-- ── Standard delivery fee rules ──────────────────────────
-- Several rules can match one order, so each carries a scope and the most
-- specific match wins. Storing them as rows rather than code means Bright can
-- reprice a state without a deploy.
create table if not exists public.pda_fee_rules (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null,
  scope         text not null,
  -- What the scope matches: a state name, a city, a zone, a product id, or a
  -- distance band's upper bound in km. Null for the default rule.
  match_value   text,
  distance_min_km numeric,
  distance_max_km numeric,
  fee           numeric not null,
  same_day_surcharge numeric not null default 0,
  active        boolean not null default true,
  note          text,
  created_by    uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint pda_fee_scope_valid check (scope in
    ('default','state','city','zone','distance','product')),
  constraint pda_fee_non_negative check (fee >= 0 and same_day_surcharge >= 0)
);

create index if not exists idx_pda_fee_rules_org on public.pda_fee_rules (org_id, scope, active);

-- ── Negotiated rates ─────────────────────────────────────
-- An unusual order where the standard rate does not work. The agent proposes,
-- a manager approves, rejects or counters, and the final figure is locked to
-- the order before any movement.
create table if not exists public.pda_fee_negotiations (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null,
  assignment_id uuid not null references public.pda_order_assignments(id) on delete cascade,
  agent_id      uuid not null references public.personal_delivery_agents(id) on delete cascade,
  standard_fee  numeric,
  proposed_fee  numeric not null,
  proposed_reason text,
  counter_fee   numeric,
  status        text not null default 'Pending',
  decided_by    uuid,
  decided_by_name text,
  decided_at    timestamptz,
  decision_note text,
  created_at    timestamptz not null default now(),
  constraint pda_negotiation_status_valid check (status in
    ('Pending','Approved','Rejected','Countered','Accepted by Agent','Withdrawn')),
  constraint pda_negotiation_fee_positive check (proposed_fee >= 0)
);

create index if not exists idx_pda_negotiation_assignment on public.pda_fee_negotiations (assignment_id, status);

-- ── Incidents ────────────────────────────────────────────
-- Missing stock, missing cash, misconduct, accidents. Each carries the money
-- at risk so an investigation can be prioritised by what it actually costs.
create table if not exists public.pda_incidents (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null,
  agent_id      uuid not null references public.personal_delivery_agents(id) on delete cascade,
  order_id      text,
  incident_type text not null,
  severity      text not null default 'Medium',
  description   text not null,
  evidence_path text,
  amount_at_risk numeric not null default 0,
  status        text not null default 'Open',
  assigned_to   uuid,
  assigned_to_name text,
  resolution    text,
  final_decision text,
  reported_by   uuid,
  reported_by_name text,
  resolved_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint pda_incident_type_valid check (incident_type in (
    'Missing inventory','Damaged product','Missing COD','Customer complaint',
    'Agent misconduct','Delivery accident','Theft','Wrong product delivered',
    'False delivery claim','Unsafe delivery location','Other'
  )),
  constraint pda_incident_severity_valid check (severity in ('Low','Medium','High','Critical')),
  constraint pda_incident_status_valid check (status in
    ('Open','Under Investigation','Awaiting Agent Response','Resolved','Closed - No Action','Escalated')),
  constraint pda_incident_amount_non_negative check (amount_at_risk >= 0)
);

create index if not exists idx_pda_incident_agent on public.pda_incidents (agent_id, status);
create index if not exists idx_pda_incident_org on public.pda_incidents (org_id, status, severity);

-- ── Module settings ──────────────────────────────────────
-- One row per org. Trust levels are meaningless unless the limits they imply
-- are configurable, so they live here rather than as constants in code.
create table if not exists public.pda_settings (
  org_id        uuid primary key,
  probation_days integer not null default 30,
  probation_max_stock integer not null default 20,
  probation_max_cod numeric not null default 100000,
  probation_max_active_orders integer not null default 3,
  verified_max_stock integer not null default 60,
  verified_max_cod numeric not null default 300000,
  verified_max_active_orders integer not null default 8,
  trusted_max_stock integer not null default 150,
  trusted_max_cod numeric not null default 750000,
  trusted_max_active_orders integer not null default 15,
  -- How long an accepted order may sit untouched before it is flagged.
  stale_order_hours integer not null default 24,
  -- How long an agent may hold company cash before new orders are blocked.
  remittance_grace_days integer not null default 3,
  working_hours_start time not null default '08:30',
  working_hours_end   time not null default '17:30',
  kyc_valid_months integer not null default 12,
  updated_at    timestamptz not null default now(),
  updated_by    uuid
);

alter table public.pda_fee_rules        enable row level security;
alter table public.pda_fee_negotiations enable row level security;
alter table public.pda_incidents        enable row level security;
alter table public.pda_settings         enable row level security;
