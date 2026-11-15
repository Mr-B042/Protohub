-- One Meta ad account used by several branches (Bright, 15 Nov 2026: "2nd
-- Designers Deluxe" runs Nigeria AND Zambia campaigns). Spend is still read
-- once, by the account's home branch; each campaign counts in ONE branch:
-- the sharing branch when it is proven its (its orders, its landing page's
-- product, or mapped there by hand), otherwise the home branch.
create table if not exists public.tracking_ad_account_shares (
  org_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  account_id text not null,
  home_branch_id uuid not null references public.branches(id) on delete cascade,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (org_id, branch_id, account_id)
);
alter table public.tracking_ad_account_shares enable row level security;
