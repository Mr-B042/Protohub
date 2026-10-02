-- Meta Business connections (Bright, 2 Oct 2026). Additive only.
--
-- Connect a Meta Business ONCE (System User token, currency, timezone);
-- Protohub then finds its Pixels and ad accounts ("Sync Assets") and the
-- Owner switches each one on or off. A Pixel stays a tracking_data_sources
-- row (websites, links, ledger and reconciliation already point at those),
-- now linked to its connection and taking the connection's token unless it
-- has its own ("Add Manually", e.g. a partner's Pixel).

create table if not exists public.tracking_meta_connections (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  name text not null default '',
  business_id text not null,
  system_user_id text,
  system_user_name text,
  -- Server-side only.
  access_token text,
  currency text not null default 'NGN',
  timezone text not null default 'Africa/Lagos',
  last_check_at timestamptz,
  last_check_ok boolean,
  last_check_message text,
  last_sync_at timestamptz,
  last_sync_ok boolean,
  last_sync_message text,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists tracking_meta_connections_business on public.tracking_meta_connections (org_id, branch_id, business_id);

create table if not exists public.tracking_meta_ad_accounts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  connection_id uuid not null references public.tracking_meta_connections(id) on delete cascade,
  account_id text not null,
  name text not null default '',
  currency text,
  timezone text,
  account_status integer,
  -- Whether the connection's token can read it (assigned to the System User).
  has_access boolean not null default true,
  active boolean not null default true,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create unique index if not exists tracking_meta_ad_accounts_row on public.tracking_meta_ad_accounts (connection_id, account_id);

alter table public.tracking_data_sources add column if not exists connection_id uuid references public.tracking_meta_connections(id) on delete set null;
alter table public.tracking_data_sources add column if not exists active boolean not null default true;
-- Whether the connection's token can use this Pixel (assigned to the System User).
alter table public.tracking_data_sources add column if not exists has_access boolean;
alter table public.tracking_data_sources add column if not exists meta_last_fired_at timestamptz;

-- Meta's numbers read through a connection's ad accounts.
alter table public.tracking_meta_ad_insights add column if not exists connection_id uuid references public.tracking_meta_connections(id) on delete cascade;
alter table public.tracking_meta_ad_insights alter column data_source_id drop not null;
create unique index if not exists tracking_meta_ad_insights_conn_row on public.tracking_meta_ad_insights (connection_id, ad_account_id, day, ad_id);
alter table public.tracking_meta_campaigns add column if not exists connection_id uuid references public.tracking_meta_connections(id) on delete cascade;
alter table public.tracking_meta_campaigns alter column data_source_id drop not null;
create unique index if not exists tracking_meta_campaigns_conn_row on public.tracking_meta_campaigns (connection_id, campaign_id);

alter table public.tracking_meta_connections enable row level security;
alter table public.tracking_meta_ad_accounts enable row level security;
create policy "tracking meta connections owner" on public.tracking_meta_connections
  for select to authenticated using (org_id = private.auth_org_id() and private.auth_user_role()::text = 'Owner');
create policy "tracking meta ad accounts owner" on public.tracking_meta_ad_accounts
  for select to authenticated using (org_id = private.auth_org_id() and private.auth_user_role()::text = 'Owner');
