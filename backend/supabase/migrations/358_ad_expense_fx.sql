-- Zambia books ad spend from a naira ad account in kwacha (Bright, 15 Nov 2026),
-- keeping the naira amount underneath. Rate is editable; default ₦65.80 = K1
-- (mid-market, 10-12 Nov 2026).
alter table public.expenses add column if not exists source_amount numeric;
alter table public.expenses add column if not exists source_currency text;

create table if not exists public.currency_rates (
  org_id uuid not null references public.organizations(id) on delete cascade,
  from_currency text not null,
  to_currency text not null,
  -- How many `from` units make ONE `to` unit (₦65.80 = K1 -> 65.80).
  from_per_to numeric not null check (from_per_to > 0),
  source text,
  updated_by uuid references public.users(id) on delete set null,
  updated_by_name text,
  updated_at timestamptz not null default now(),
  primary key (org_id, from_currency, to_currency)
);
alter table public.currency_rates enable row level security;
