-- Ad Spend -> Since Start (Bright, 8 Oct 2026): judge each campaign over its
-- whole life, not the date filter. Additive only.
--
--   tracking_ad_lifetime       each ad's numbers since it started (Meta
--                              date_preset=maximum / TikTok query_lifetime):
--                              spend, views, link clicks, 3-second (TikTok
--                              2-second) plays, full plays, platform purchases.
--                              Ids are as stored in Ad Spend ("tt:" for TikTok).
--   tracking_ad_spend_targets  the Owner's own target cost per order for a
--                              product, instead of the worked-out break-even.

create table if not exists public.tracking_ad_lifetime (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  platform text not null default 'meta' check (platform in ('meta', 'tiktok')),
  account_id text not null,
  campaign_id text not null,
  campaign_name text not null default '',
  campaign_status text,
  campaign_start date,
  adset_id text not null default '',
  adset_name text not null default '',
  ad_id text not null,
  ad_name text not null default '',
  first_day date,
  last_day date,
  spend numeric(14, 2) not null default 0,
  impressions bigint not null default 0,
  link_clicks bigint not null default 0,
  video_hook bigint not null default 0,
  video_full bigint not null default 0,
  platform_purchases numeric(14, 2) not null default 0,
  fetched_at timestamptz not null default now()
);
create unique index if not exists tracking_ad_lifetime_row on public.tracking_ad_lifetime (org_id, branch_id, platform, ad_id);
create index if not exists tracking_ad_lifetime_campaign on public.tracking_ad_lifetime (org_id, branch_id, campaign_id);

create table if not exists public.tracking_ad_spend_targets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  target_cpa numeric(14, 2) not null check (target_cpa > 0),
  updated_by_name text,
  updated_at timestamptz not null default now()
);
create unique index if not exists tracking_ad_spend_targets_row on public.tracking_ad_spend_targets (org_id, branch_id, product_id);

alter table public.tracking_ad_spend_state add column if not exists last_lifetime_at timestamptz;

alter table public.tracking_ad_lifetime enable row level security;
alter table public.tracking_ad_spend_targets enable row level security;
create policy "tracking ad lifetime owner" on public.tracking_ad_lifetime
  for select to authenticated using (org_id = private.auth_org_id() and private.auth_user_role()::text = 'Owner');
create policy "tracking ad spend targets owner" on public.tracking_ad_spend_targets
  for select to authenticated using (org_id = private.auth_org_id() and private.auth_user_role()::text = 'Owner');
