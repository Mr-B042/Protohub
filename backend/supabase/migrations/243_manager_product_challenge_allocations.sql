-- Per-sales-rep allocations for a shared manager product challenge.
create table if not exists public.manager_product_challenge_allocations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  challenge_id uuid not null references public.manager_product_challenges(id) on delete cascade,
  rep_id uuid not null references public.users(id) on delete cascade,
  target_units integer not null check (target_units > 0),
  reward_amount numeric(12,2) not null default 0 check (reward_amount >= 0),
  milestone_targets jsonb not null default '[]'::jsonb check (jsonb_typeof(milestone_targets) = 'array'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (challenge_id, rep_id)
);

create index if not exists manager_challenge_allocations_org_idx
  on public.manager_product_challenge_allocations(org_id, challenge_id);

alter table public.manager_product_challenge_allocations enable row level security;

drop policy if exists "challenge allocations select org members" on public.manager_product_challenge_allocations;
drop policy if exists "challenge allocations write owners" on public.manager_product_challenge_allocations;

create policy "challenge allocations select org members"
  on public.manager_product_challenge_allocations for select to authenticated
  using (org_id = private.auth_org_id());

create policy "challenge allocations write owners"
  on public.manager_product_challenge_allocations for all to authenticated
  using (org_id = private.auth_org_id() and private.auth_user_role()::text = 'Owner')
  with check (org_id = private.auth_org_id() and private.auth_user_role()::text = 'Owner');
