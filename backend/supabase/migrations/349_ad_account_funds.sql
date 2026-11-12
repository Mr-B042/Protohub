-- Low ad account funds alert (Bright, 12 Nov 2026): each Meta ad account's
-- money left, read every 30 minutes, and the Owner's on/off + level.
alter table public.organizations
  add column if not exists ad_funds_alert jsonb not null default '{"enabled": true, "threshold": 5000}'::jsonb;

create table if not exists public.tracking_ad_account_funds (
  org_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete set null,
  ad_account_id text not null,
  name text not null default '',
  currency text not null default 'NGN',
  is_prepay boolean,
  account_status integer,
  disable_reason integer,
  -- Meta's own figures, in kobo, kept as sent so the reading can be checked.
  balance_minor text,
  amount_spent_minor text,
  spend_cap_minor text,
  funding_type integer,
  funding_display text,
  funds_left numeric,
  funds_source text check (funds_source in ('prepaid', 'spend_limit')),
  low_reason text check (low_reason in ('low', 'unpaid')),
  low_since timestamptz,
  last_alert_at timestamptz,
  checked_at timestamptz,
  error text,
  error_at timestamptz,
  primary key (org_id, ad_account_id)
);

alter table public.tracking_ad_account_funds enable row level security;
create policy "tracking ad account funds owner" on public.tracking_ad_account_funds
  for select to authenticated using (org_id = private.auth_org_id() and private.auth_user_role()::text = 'Owner');
