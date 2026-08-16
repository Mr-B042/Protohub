-- Owner-managed product sales challenges shown on the Manager Dashboard.

create table if not exists public.manager_product_challenges (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  name text not null,
  cadence text not null default 'weekly',
  target_units integer not null,
  start_date date not null,
  end_date date not null,
  reward_amount numeric(12,2) not null default 0,
  currency public.currency_code not null default 'NGN',
  milestone_mode text not null default 'none',
  milestone_distribution text not null default 'even',
  milestone_targets jsonb not null default '[]'::jsonb,
  status text not null default 'active',
  description text not null default '',
  created_by uuid references public.users(id) on delete set null,
  updated_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint manager_product_challenges_cadence_check
    check (cadence in ('weekly', 'monthly', 'quarterly')),
  constraint manager_product_challenges_status_check
    check (status in ('draft', 'active', 'paused', 'completed')),
  constraint manager_product_challenges_milestone_mode_check
    check (milestone_mode in ('none', 'weekly')),
  constraint manager_product_challenges_milestone_distribution_check
    check (milestone_distribution in ('even', 'custom')),
  constraint manager_product_challenges_milestone_targets_check
    check (jsonb_typeof(milestone_targets) = 'array'),
  constraint manager_product_challenges_target_check check (target_units > 0),
  constraint manager_product_challenges_reward_check check (reward_amount >= 0),
  constraint manager_product_challenges_dates_check check (end_date >= start_date)
);

create index if not exists manager_product_challenges_org_dates_idx
  on public.manager_product_challenges(org_id, start_date desc, end_date desc);

create index if not exists manager_product_challenges_org_product_status_idx
  on public.manager_product_challenges(org_id, product_id, status);

alter table public.manager_product_challenges enable row level security;

drop policy if exists "manager product challenges select org managers" on public.manager_product_challenges;
drop policy if exists "manager product challenges insert owner" on public.manager_product_challenges;
drop policy if exists "manager product challenges update owner" on public.manager_product_challenges;
drop policy if exists "manager product challenges delete owner" on public.manager_product_challenges;

create policy "manager product challenges select org managers"
  on public.manager_product_challenges for select to authenticated
  using (
    org_id = private.auth_org_id()
    and private.auth_user_role()::text in ('Owner', 'Admin', 'Manager')
  );

create policy "manager product challenges insert owner"
  on public.manager_product_challenges for insert to authenticated
  with check (
    org_id = private.auth_org_id()
    and private.auth_user_role()::text = 'Owner'
  );

create policy "manager product challenges update owner"
  on public.manager_product_challenges for update to authenticated
  using (
    org_id = private.auth_org_id()
    and private.auth_user_role()::text = 'Owner'
  )
  with check (
    org_id = private.auth_org_id()
    and private.auth_user_role()::text = 'Owner'
  );

create policy "manager product challenges delete owner"
  on public.manager_product_challenges for delete to authenticated
  using (
    org_id = private.auth_org_id()
    and private.auth_user_role()::text = 'Owner'
  );
