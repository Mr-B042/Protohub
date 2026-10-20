-- Stock allocation decisions (Product Trend › Stock Recommendation, Bright's
-- brief, 21 Oct 2026).
--
-- Flow: the system recommends how a product's WAREHOUSE stock should be shared
-- across states -> a Manager / Admin adjusts and sends it -> the Owner
-- approves (or rejects) -> transfers are made with the normal waybill form
-- (nothing moves on its own) -> the page tracks what happened afterwards.
--
-- stock_allocation_decisions keeps what was recommended, what was approved,
-- who did what and when. stock_allocation_events is the append-only record of
-- every action (never changed or deleted).
--
-- One open decision per product (proposed or approved and not finished), so
-- the same warehouse units can never be promised twice.

create table if not exists public.stock_allocation_decisions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  status text not null default 'proposed'
    check (status in ('proposed', 'approved', 'rejected', 'cancelled', 'completed')),
  -- What the system recommended, line per state (state, units, need, priority,
  -- stock, waiting, forecast, rate, agent_id, agent_location_id).
  recommended jsonb not null default '[]'::jsonb,
  -- What was sent for approval / approved, same shape.
  final_lines jsonb not null default '[]'::jsonb,
  warehouse_available integer not null default 0,
  horizon_days integer not null default 30,
  confidence text,
  period_from date,
  period_to date,
  expected jsonb not null default '{}'::jsonb,
  reason text,
  proposed_by uuid references public.users(id) on delete set null,
  proposed_by_name text,
  proposed_at timestamptz not null default now(),
  decided_by uuid references public.users(id) on delete set null,
  decided_by_name text,
  decided_at timestamptz,
  decision_note text,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists stock_allocation_decisions_org_branch_idx
  on public.stock_allocation_decisions (org_id, branch_id, proposed_at desc);

-- At most one open decision per product per branch.
create unique index if not exists stock_allocation_decisions_one_open
  on public.stock_allocation_decisions (org_id, branch_id, product_id)
  where status in ('proposed', 'approved');

create table if not exists public.stock_allocation_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  decision_id uuid not null references public.stock_allocation_decisions(id) on delete cascade,
  action text not null,
  actor_id uuid references public.users(id) on delete set null,
  actor_name text,
  actor_role text,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists stock_allocation_events_decision_idx
  on public.stock_allocation_events (decision_id, created_at);

create or replace function public.stock_allocation_events_append_only()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    -- Only cascades (organisation, branch or decision removed) may delete.
    if exists (select 1 from public.stock_allocation_decisions d where d.id = old.decision_id) then
      raise exception 'stock_allocation_events rows cannot be deleted';
    end if;
    return old;
  end if;
  raise exception 'stock_allocation_events rows cannot be changed';
end;
$$;

drop trigger if exists trg_stock_allocation_events_append_only on public.stock_allocation_events;
create trigger trg_stock_allocation_events_append_only
  before update or delete on public.stock_allocation_events
  for each row execute function public.stock_allocation_events_append_only();

-- The API uses the service role; these stop any direct client reading across orgs.
alter table public.stock_allocation_decisions enable row level security;
alter table public.stock_allocation_events enable row level security;
