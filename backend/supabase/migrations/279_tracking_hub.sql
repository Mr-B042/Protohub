-- Tracking Hub (Bright, 2 Oct 2026). Additive only.
--
-- One place for ad conversion tracking instead of Pixel IDs and tokens typed
-- into each embed form:
--   tracking_data_sources   a Meta dataset (Pixel) + its server token, entered once
--   tracking_websites       each WordPress site and the data source it should use
--   tracking_profiles       "Household products - Meta": data source + website + strategy
--   meta_capi_configs       (existing) = a Tracking Link; now points at a profile
--                           / data source / website instead of carrying a token
--   tracking_browser_events the WordPress embed reports each browser Pixel
--                           Purchase it fires, so "browser events" is a real count
--   tracking_meta_insights  Meta's own purchase counts per campaign per day
--                           (read with the data source token), for Reconciliation
--   tracking_settings       the purchase rule and hub settings
-- Purchase event id = the Protohub order id from this release on.

create table if not exists public.tracking_data_sources (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  name text not null,
  business_name text not null default '',
  -- Meta ad account ids this dataset reports for (act_ prefix optional).
  ad_account_ids text[] not null default '{}',
  pixel_id text not null,
  -- Server-side only. Used for the Conversions API and for reading Meta's numbers.
  access_token text,
  test_event_code text,
  is_main boolean not null default false,
  status text not null default 'production' check (status in ('production', 'testing', 'paused')),
  last_check_at timestamptz,
  last_check_ok boolean,
  last_check_message text,
  meta_stats jsonb not null default '{}'::jsonb,
  meta_stats_at timestamptz,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists tracking_data_sources_pixel on public.tracking_data_sources (org_id, branch_id, pixel_id);

create table if not exists public.tracking_websites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  domain text not null,
  platform text not null default 'WordPress' check (platform in ('WordPress', 'Shopify', 'Custom', 'Other')),
  data_source_id uuid references public.tracking_data_sources(id) on delete set null,
  notes text,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists tracking_websites_domain on public.tracking_websites (org_id, branch_id, domain);

create table if not exists public.tracking_profiles (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  name text not null,
  data_source_id uuid references public.tracking_data_sources(id) on delete set null,
  default_website_id uuid references public.tracking_websites(id) on delete set null,
  strategy text not null default 'browser_capi' check (strategy in ('browser_capi', 'capi_only', 'landing_page')),
  ad_account_label text not null default '',
  status text not null default 'production' check (status in ('production', 'testing')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.meta_capi_configs add column if not exists data_source_id uuid references public.tracking_data_sources(id) on delete set null;
alter table public.meta_capi_configs add column if not exists website_id uuid references public.tracking_websites(id) on delete set null;
alter table public.meta_capi_configs add column if not exists profile_id uuid references public.tracking_profiles(id) on delete set null;
alter table public.meta_capi_configs add column if not exists form_label text;
-- Go-live checklist for Browser + CAPI: thank-you Pixel removed, test event seen.
alter table public.meta_capi_configs add column if not exists checklist jsonb not null default '{}'::jsonb;

create table if not exists public.tracking_browser_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  order_id text not null,
  event_name text not null default 'Purchase',
  event_id text not null,
  pixel_id text,
  page_url text,
  page_domain text,
  -- Pixel ids the page had loaded when it fired (spots a missing or doubled Pixel).
  pixels_on_page text[] not null default '{}',
  fired_at timestamptz not null default now()
);
create unique index if not exists tracking_browser_events_order on public.tracking_browser_events (org_id, order_id, event_name);
create index if not exists tracking_browser_events_recent on public.tracking_browser_events (org_id, fired_at desc);

create table if not exists public.tracking_meta_insights (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  data_source_id uuid not null references public.tracking_data_sources(id) on delete cascade,
  ad_account_id text not null,
  day date not null,
  campaign_id text not null,
  campaign_name text not null default '',
  purchases numeric(14, 2) not null default 0,
  purchase_value numeric(14, 2) not null default 0,
  spend numeric(14, 2) not null default 0,
  fetched_at timestamptz not null default now()
);
create unique index if not exists tracking_meta_insights_row on public.tracking_meta_insights (data_source_id, ad_account_id, day, campaign_id);

create table if not exists public.tracking_settings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  settings jsonb not null default '{}'::jsonb,
  updated_by uuid references public.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
create unique index if not exists tracking_settings_branch on public.tracking_settings (org_id, branch_id);

alter table public.tracking_data_sources enable row level security;
alter table public.tracking_websites enable row level security;
alter table public.tracking_profiles enable row level security;
alter table public.tracking_browser_events enable row level security;
alter table public.tracking_meta_insights enable row level security;
alter table public.tracking_settings enable row level security;

-- Everything goes through the server (Owner only); these cover direct reads.
create policy "tracking data sources owner" on public.tracking_data_sources
  for select to authenticated using (org_id = private.auth_org_id() and private.auth_user_role()::text = 'Owner');
create policy "tracking websites owner" on public.tracking_websites
  for select to authenticated using (org_id = private.auth_org_id() and private.auth_user_role()::text = 'Owner');
create policy "tracking profiles owner" on public.tracking_profiles
  for select to authenticated using (org_id = private.auth_org_id() and private.auth_user_role()::text = 'Owner');
create policy "tracking browser events owner" on public.tracking_browser_events
  for select to authenticated using (org_id = private.auth_org_id() and private.auth_user_role()::text = 'Owner');
create policy "tracking meta insights owner" on public.tracking_meta_insights
  for select to authenticated using (org_id = private.auth_org_id() and private.auth_user_role()::text = 'Owner');
create policy "tracking settings owner" on public.tracking_settings
  for select to authenticated using (org_id = private.auth_org_id() and private.auth_user_role()::text = 'Owner');
