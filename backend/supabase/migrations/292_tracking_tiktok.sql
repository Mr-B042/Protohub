-- TikTok in the Tracking Hub (Bright, 8 Oct 2026). Additive only.
--
--   tracking_tiktok_events        each sale Protohub sent to TikTok's Events API
--                                 from the server: one CompletePayment per
--                                 order (event id = order id), plus failures.
--   tracking_tiktok_connections   a TikTok Ads Manager (Marketing API) token and
--                                 its advertiser accounts, for reading spend.
--   tracking_tiktok_ad_insights   TikTok spend per ad per day (like
--                                 tracking_meta_ad_insights for Meta).

create table if not exists public.tracking_tiktok_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete cascade,
  order_id text not null,
  event_name text not null default 'CompletePayment',
  event_id text not null,
  pixel_id text not null,
  data_source_id uuid references public.tracking_data_sources(id) on delete set null,
  status text not null,
  message text,
  test_mode boolean not null default false,
  value numeric(14, 2),
  currency text,
  sent_at timestamptz not null default now()
);
-- Strict registry: one real (non-test) sale per order, ever.
create unique index if not exists tracking_tiktok_events_once on public.tracking_tiktok_events (org_id, order_id, event_name) where status = 'sent' and test_mode = false;
create index if not exists tracking_tiktok_events_order on public.tracking_tiktok_events (org_id, order_id);
create index if not exists tracking_tiktok_events_pixel on public.tracking_tiktok_events (org_id, pixel_id, sent_at desc);

create table if not exists public.tracking_tiktok_connections (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  name text not null default 'TikTok Ads',
  -- Server-side only: a Marketing API access token with reporting access.
  access_token text,
  -- [{ "id": "7012...", "name": "...", "currency": "NGN", "timezone": "...", "active": true, "hasAccess": true }]
  advertisers jsonb not null default '[]'::jsonb,
  last_check_at timestamptz,
  last_check_ok boolean,
  last_check_message text,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists tracking_tiktok_connections_branch on public.tracking_tiktok_connections (org_id, branch_id);

create table if not exists public.tracking_tiktok_ad_insights (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  connection_id uuid not null references public.tracking_tiktok_connections(id) on delete cascade,
  advertiser_id text not null,
  day date not null,
  campaign_id text not null default '',
  campaign_name text not null default '',
  adgroup_id text not null default '',
  adgroup_name text not null default '',
  ad_id text not null,
  ad_name text not null default '',
  spend numeric(14, 2) not null default 0,
  conversions numeric(14, 2) not null default 0,
  fetched_at timestamptz not null default now()
);
create unique index if not exists tracking_tiktok_ad_insights_row on public.tracking_tiktok_ad_insights (connection_id, advertiser_id, day, ad_id);
create index if not exists tracking_tiktok_ad_insights_day on public.tracking_tiktok_ad_insights (org_id, branch_id, day);

alter table public.tracking_tiktok_events enable row level security;
alter table public.tracking_tiktok_connections enable row level security;
alter table public.tracking_tiktok_ad_insights enable row level security;
create policy "tracking tiktok events owner" on public.tracking_tiktok_events
  for select to authenticated using (org_id = private.auth_org_id() and private.auth_user_role()::text = 'Owner');
create policy "tracking tiktok connections owner" on public.tracking_tiktok_connections
  for select to authenticated using (org_id = private.auth_org_id() and private.auth_user_role()::text = 'Owner');
create policy "tracking tiktok ad insights owner" on public.tracking_tiktok_ad_insights
  for select to authenticated using (org_id = private.auth_org_id() and private.auth_user_role()::text = 'Owner');
