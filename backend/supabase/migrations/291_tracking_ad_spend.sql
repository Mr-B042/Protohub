-- Tracking Hub -> Ad Spend (Bright, 8 Oct 2026). Meta spend is pulled from
-- every connected ad account (it already lands in tracking_meta_ad_insights,
-- one row per ad per day) and given to Protohub products by Meta IDs, never
-- by campaign names. Additive only.
--
--   tracking_ad_spend_mappings  which product(s) a Meta ad / ad set / campaign /
--                               ad account's spend belongs to. The lowest level
--                               set wins: ad > ad set > campaign > ad account.
--                               splits = [{"productId": uuid, "share": 0-100}],
--                               shares add up to 100 (one product = one 100 row).
--   tracking_ad_spend_state     per branch: auto sync on/off and the last sync.
--   tracking_ad_spend_days      a day whose spend is final (synced after the day
--                               closed); the auto sync stops re-reading it.

create table if not exists public.tracking_ad_spend_mappings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  level text not null check (level in ('account', 'campaign', 'adset', 'ad')),
  meta_id text not null,
  ad_account_id text,
  -- The Meta name when it was set, for display only (names change; ids don't).
  label text not null default '',
  splits jsonb not null default '[]'::jsonb,
  created_by uuid references public.users(id) on delete set null,
  created_by_name text,
  updated_at timestamptz not null default now()
);
create unique index if not exists tracking_ad_spend_mappings_row on public.tracking_ad_spend_mappings (org_id, branch_id, level, meta_id);

create table if not exists public.tracking_ad_spend_state (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  auto_sync boolean not null default true,
  last_sync_at timestamptz,
  last_sync_ok boolean,
  last_sync_message text,
  last_sync_trigger text,
  updated_at timestamptz not null default now()
);
create unique index if not exists tracking_ad_spend_state_branch on public.tracking_ad_spend_state (org_id, branch_id);

create table if not exists public.tracking_ad_spend_days (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  day date not null,
  finalized_at timestamptz not null default now()
);
create unique index if not exists tracking_ad_spend_days_row on public.tracking_ad_spend_days (org_id, branch_id, day);

alter table public.tracking_ad_spend_mappings enable row level security;
alter table public.tracking_ad_spend_state enable row level security;
alter table public.tracking_ad_spend_days enable row level security;
create policy "tracking ad spend mappings owner" on public.tracking_ad_spend_mappings
  for select to authenticated using (org_id = private.auth_org_id() and private.auth_user_role()::text = 'Owner');
create policy "tracking ad spend state owner" on public.tracking_ad_spend_state
  for select to authenticated using (org_id = private.auth_org_id() and private.auth_user_role()::text = 'Owner');
create policy "tracking ad spend days owner" on public.tracking_ad_spend_days
  for select to authenticated using (org_id = private.auth_org_id() and private.auth_user_role()::text = 'Owner');
