-- Migration 181: referrals as a tracked lifecycle, not just a captured name.
--
-- Touchpoints already recorded that a referral was ASKED FOR
-- (referral_requested_at) and that a contact was GIVEN
-- (referral_contact_name/phone). Nothing tracked what happened next, so the
-- Referrals design could not answer: did the referee buy, what were they
-- interested in, what reward is owed, and was it paid.
--
-- A referral is its own object with its own lifecycle, so it gets its own
-- table rather than more columns on a touchpoint. One touchpoint can also
-- yield several referred contacts.

create table if not exists public.customer_retention_referrals (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.organizations(id) on delete cascade,
  -- The order whose customer made the referral. Nullable so a referral can
  -- be logged manually for a customer whose order is not in view.
  referrer_order_id  text references public.orders(id) on delete set null,
  referrer_name      text not null,
  referrer_phone     text not null,
  referee_name       text not null,
  referee_phone      text not null,
  product_interested text,
  source             text not null default 'whatsapp'
    check (source in ('whatsapp', 'facebook', 'instagram', 'website', 'phone', 'other')),
  status             text not null default 'new_lead'
    check (status in ('new_lead', 'in_progress', 'converted', 'not_converted')),
  referral_date      timestamptz not null default now(),
  converted_at       timestamptz,
  -- The referee's actual order. This is what makes a conversion real rather
  -- than self-reported, and what reward payouts should be checked against.
  converted_order_id text references public.orders(id) on delete set null,
  reward_amount      numeric not null default 0 check (reward_amount >= 0),
  reward_status      text not null default 'not_eligible'
    check (reward_status in ('not_eligible', 'pending', 'paid')),
  reward_paid_at     timestamptz,
  assigned_rep_id    uuid references public.users(id) on delete set null,
  notes              text,
  created_by         uuid references public.users(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  -- The same person should not be logged twice as a referred lead.
  constraint customer_retention_referrals_unique_referee unique (org_id, referee_phone)
);

create index if not exists idx_crref_status
  on public.customer_retention_referrals(org_id, status, referral_date desc);
create index if not exists idx_crref_referrer
  on public.customer_retention_referrals(org_id, referrer_phone);
create index if not exists idx_crref_rep
  on public.customer_retention_referrals(org_id, assigned_rep_id, referral_date desc);

alter table public.customer_retention_referrals enable row level security;

-- Same visibility rule as retention assignments: supervisors see the org, a
-- Recovery Rep sees their own plus unassigned work they could pick up.
drop policy if exists "customer retention referrals select" on public.customer_retention_referrals;
create policy "customer retention referrals select"
  on public.customer_retention_referrals
  for select
  to authenticated
  using (
    org_id = private.auth_org_id()
    and (
      private.auth_user_role()::text in ('Owner', 'Admin', 'Manager')
      or (
        private.auth_user_role()::text = 'Recovery Rep'
        and (assigned_rep_id = auth.uid() or assigned_rep_id is null)
      )
    )
  );

drop policy if exists "customer retention referrals insert" on public.customer_retention_referrals;
create policy "customer retention referrals insert"
  on public.customer_retention_referrals
  for insert
  to authenticated
  with check (
    org_id = private.auth_org_id()
    and private.auth_user_role()::text in ('Owner', 'Admin', 'Manager', 'Recovery Rep')
  );

drop policy if exists "customer retention referrals update" on public.customer_retention_referrals;
create policy "customer retention referrals update"
  on public.customer_retention_referrals
  for update
  to authenticated
  using (
    org_id = private.auth_org_id()
    and (
      private.auth_user_role()::text in ('Owner', 'Admin', 'Manager')
      or (private.auth_user_role()::text = 'Recovery Rep' and assigned_rep_id = auth.uid())
    )
  )
  with check (
    org_id = private.auth_org_id()
    and private.auth_user_role()::text in ('Owner', 'Admin', 'Manager', 'Recovery Rep')
  );
