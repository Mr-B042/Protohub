-- Monthly incentive payouts (Bright, 3 Oct 2026). Each product challenge pays
-- its earned reward the first week after the month, cut by the person's
-- delivery rate for the month: 70%+ full, 65-70 half, 60-65 quarter, below 0.
-- A row is written when a Manager/Admin/Owner marks a person paid, freezing
-- what was paid. Additive only.
create table if not exists public.challenge_incentive_payouts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete cascade,
  challenge_id uuid not null references public.manager_product_challenges(id) on delete cascade,
  person_kind text not null check (person_kind in ('rep', 'manager')),
  person_id uuid references public.users(id) on delete set null,
  person_name text,
  earned_amount numeric(14, 2) not null default 0,
  delivery_rate numeric(6, 2),
  tier_percent integer not null default 0,
  payable_amount numeric(14, 2) not null default 0,
  note text,
  paid_at timestamptz not null default now(),
  paid_by uuid references public.users(id) on delete set null,
  paid_by_name text
);
create unique index if not exists challenge_incentive_payouts_once on public.challenge_incentive_payouts (challenge_id, person_kind, coalesce(person_id, '00000000-0000-0000-0000-000000000000'::uuid));
alter table public.challenge_incentive_payouts enable row level security;
create policy "challenge incentive payouts read" on public.challenge_incentive_payouts
  for select to authenticated using (org_id = private.auth_org_id());
