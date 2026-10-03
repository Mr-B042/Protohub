-- Team Challenges (Bright, 3 Oct 2026): two teams of reps race to point
-- milestones built from verified upsells and cross-sells. Every score comes
-- from a ledger row tied to a real order; nothing is typed in by hand.
--
-- Rewards are cumulative entitlements per milestone: the first team to a
-- milestone is entitled to its winner amount, the other team (reaching it
-- before the close) to its runner-up amount; a payout is the entitlement minus
-- what that team was already paid. Owner-funded, paid outside commission.
-- Additive only.

create table if not exists public.team_challenges (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  name text not null,
  status text not null default 'draft' check (status in ('draft', 'active', 'paused', 'closed')),
  sell_from date not null,
  sell_to date not null,
  grace_days integer not null default 7 check (grace_days between 0 and 30),
  -- [{ key, target, winnerAmount, runnerUpAmount }] in target order.
  milestones jsonb not null default '[]'::jsonb,
  -- { crossSell, upgradePlusOne, upgradePlusTwo, minAddedValue, productIds[] }
  scoring jsonb not null default '{}'::jsonb,
  rule_version integer not null default 1,
  sponsor_note text,
  approved_by uuid references public.users(id) on delete set null,
  approved_by_name text,
  approved_at timestamptz,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.team_challenge_teams (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  challenge_id uuid not null references public.team_challenges(id) on delete cascade,
  name text not null,
  color text not null default 'violet',
  member_ids uuid[] not null default '{}',
  sort_order integer not null default 0
);

create table if not exists public.team_challenge_entries (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  challenge_id uuid not null references public.team_challenges(id) on delete cascade,
  order_id text not null,
  rep_id uuid references public.users(id) on delete set null,
  team_id uuid references public.team_challenge_teams(id) on delete set null,
  category text not null check (category in ('upsell', 'cross_sell', 'both')),
  points integer not null default 0,
  rule_version integer not null default 1,
  rule_label text,
  original_snapshot jsonb,
  revised_snapshot jsonb,
  added_value numeric(14, 2) not null default 0,
  delivered_at timestamptz,
  paid_at timestamptz,
  qualified_at timestamptz,
  status text not null default 'awaiting_delivery' check (status in (
    'awaiting_delivery', 'awaiting_payment', 'awaiting_verification', 'verified',
    'correction_requested', 'excluded', 'reversed'
  )),
  status_reason text,
  decided_by uuid references public.users(id) on delete set null,
  decided_by_name text,
  decided_at timestamptz,
  verified_points integer,
  rep_note text,
  review_requested_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (challenge_id, order_id)
);
create index if not exists team_challenge_entries_challenge on public.team_challenge_entries (challenge_id, status);

create table if not exists public.team_challenge_payouts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  challenge_id uuid not null references public.team_challenges(id) on delete cascade,
  team_id uuid not null references public.team_challenge_teams(id) on delete cascade,
  milestone_key text not null,
  amount numeric(14, 2) not null,
  per_rep jsonb not null default '[]'::jsonb,
  approved_by uuid references public.users(id) on delete set null,
  approved_by_name text,
  approved_at timestamptz not null default now(),
  paid_at timestamptz,
  paid_reference text,
  unique (challenge_id, team_id, milestone_key)
);

create table if not exists public.team_challenge_log (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  challenge_id uuid not null references public.team_challenges(id) on delete cascade,
  actor_id uuid references public.users(id) on delete set null,
  actor_name text,
  action text not null,
  detail jsonb,
  created_at timestamptz not null default now()
);
create index if not exists team_challenge_log_challenge on public.team_challenge_log (challenge_id, created_at desc);

alter table public.team_challenges enable row level security;
alter table public.team_challenge_teams enable row level security;
alter table public.team_challenge_entries enable row level security;
alter table public.team_challenge_payouts enable row level security;
alter table public.team_challenge_log enable row level security;
create policy "team challenges read" on public.team_challenges for select to authenticated using (org_id = private.auth_org_id());
create policy "team challenge teams read" on public.team_challenge_teams for select to authenticated using (org_id = private.auth_org_id());
create policy "team challenge entries read" on public.team_challenge_entries for select to authenticated using (org_id = private.auth_org_id());
create policy "team challenge payouts read" on public.team_challenge_payouts for select to authenticated using (org_id = private.auth_org_id());
create policy "team challenge log read" on public.team_challenge_log for select to authenticated using (org_id = private.auth_org_id());
