-- Tracking Hub redesign (Bright, 2 Oct 2026): every tab built to his images.
-- Additive only.
--
--   tracking_data_sources   + platform (Meta / TikTok / Google / Snapchat /
--                             other), description, dataset name, ad account
--                             label, currency, timezone
--   tracking_websites       + label ("Main Store")
--   tracking_meta_ad_insights  Meta's purchases per AD per day (read with the
--                             data source token) so Reconciliation can show
--                             Campaign / Ad Set / Ad / Landing Page / Product /
--                             Website views
--   tracking_meta_campaigns objective, start / end date for the detail panel
--   tracking_reconciliation_notes  notes and "Mark as Resolved"
--   tracking_audit          who changed what in the hub (Settings -> Audit Logs)
--   tracking_alert_log      one alert per issue per day (Notifications)
--   tracking_journey_counts()  page views / form starts / submit presses per
--                             day, product, link, website, campaign - counted
--                             in the database, as there are thousands a week

alter table public.tracking_data_sources add column if not exists platform text not null default 'meta';
alter table public.tracking_data_sources add column if not exists description text not null default '';
alter table public.tracking_data_sources add column if not exists dataset_name text;
alter table public.tracking_data_sources add column if not exists ad_account_label text not null default '';
alter table public.tracking_data_sources add column if not exists currency text not null default 'NGN';
alter table public.tracking_data_sources add column if not exists timezone text not null default 'Africa/Lagos';

alter table public.tracking_websites add column if not exists label text not null default '';
-- "Scan Website" / "Test Website": the Pixel ids and Protohub form found on the pages.
alter table public.tracking_websites add column if not exists last_scan jsonb;
alter table public.tracking_websites add column if not exists last_scan_at timestamptz;

-- Which Pixel each server send went to, so a data source shows its own last event.
alter table public.meta_capi_events add column if not exists pixel_id text;
create index if not exists meta_capi_events_pixel on public.meta_capi_events (org_id, pixel_id, sent_at desc);

create table if not exists public.tracking_meta_ad_insights (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  data_source_id uuid not null references public.tracking_data_sources(id) on delete cascade,
  ad_account_id text not null,
  day date not null,
  campaign_id text not null,
  campaign_name text not null default '',
  adset_id text not null default '',
  adset_name text not null default '',
  ad_id text not null,
  ad_name text not null default '',
  purchases numeric(14, 2) not null default 0,
  purchase_value numeric(14, 2) not null default 0,
  spend numeric(14, 2) not null default 0,
  fetched_at timestamptz not null default now()
);
create unique index if not exists tracking_meta_ad_insights_row on public.tracking_meta_ad_insights (data_source_id, ad_account_id, day, ad_id);
create index if not exists tracking_meta_ad_insights_day on public.tracking_meta_ad_insights (org_id, branch_id, day);

create table if not exists public.tracking_meta_campaigns (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  data_source_id uuid not null references public.tracking_data_sources(id) on delete cascade,
  ad_account_id text not null,
  campaign_id text not null,
  name text not null default '',
  objective text,
  status text,
  start_time timestamptz,
  stop_time timestamptz,
  fetched_at timestamptz not null default now()
);
create unique index if not exists tracking_meta_campaigns_row on public.tracking_meta_campaigns (data_source_id, campaign_id);

create table if not exists public.tracking_reconciliation_notes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  scope text not null check (scope in ('campaign', 'adset', 'ad', 'landing_page', 'product', 'website')),
  scope_id text not null,
  note text,
  resolved boolean not null default false,
  created_by uuid references public.users(id) on delete set null,
  created_by_name text,
  created_at timestamptz not null default now()
);
create index if not exists tracking_reconciliation_notes_scope on public.tracking_reconciliation_notes (org_id, branch_id, scope, scope_id, created_at desc);

create table if not exists public.tracking_audit (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  action text not null,
  subject_type text,
  subject_id text,
  subject_label text,
  detail jsonb not null default '{}'::jsonb,
  actor_id uuid references public.users(id) on delete set null,
  actor_name text,
  created_at timestamptz not null default now()
);
create index if not exists tracking_audit_recent on public.tracking_audit (org_id, branch_id, created_at desc);

create table if not exists public.tracking_alert_log (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  issue_key text not null,
  day date not null,
  created_at timestamptz not null default now()
);
create unique index if not exists tracking_alert_log_once on public.tracking_alert_log (org_id, branch_id, issue_key, day);

alter table public.tracking_meta_ad_insights enable row level security;
alter table public.tracking_meta_campaigns enable row level security;
alter table public.tracking_reconciliation_notes enable row level security;
alter table public.tracking_audit enable row level security;
alter table public.tracking_alert_log enable row level security;

create policy "tracking meta ad insights owner" on public.tracking_meta_ad_insights
  for select to authenticated using (org_id = private.auth_org_id() and private.auth_user_role()::text = 'Owner');
create policy "tracking meta campaigns owner" on public.tracking_meta_campaigns
  for select to authenticated using (org_id = private.auth_org_id() and private.auth_user_role()::text = 'Owner');
create policy "tracking reconciliation notes owner" on public.tracking_reconciliation_notes
  for select to authenticated using (org_id = private.auth_org_id() and private.auth_user_role()::text = 'Owner');
create policy "tracking audit owner" on public.tracking_audit
  for select to authenticated using (org_id = private.auth_org_id() and private.auth_user_role()::text = 'Owner');
create policy "tracking alert log owner" on public.tracking_alert_log
  for select to authenticated using (org_id = private.auth_org_id() and private.auth_user_role()::text = 'Owner');

-- Distinct visits per day / event / product / link / website / landing path /
-- campaign / ad, from the form's journey events. Server only.
create or replace function public.tracking_journey_counts(p_org uuid, p_branch uuid, p_from timestamptz, p_to timestamptz)
returns table (
  day date, event_type text, product_id uuid, tracking_key text, domain text, path text, campaign_id text, ad_id text, visits bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    (e.created_at at time zone 'Africa/Lagos')::date as day,
    e.event_type,
    e.product_id,
    nullif(lower(coalesce(e.metadata->>'metaTrackingKey', '')), '') as tracking_key,
    nullif(regexp_replace(lower(split_part(split_part(coalesce(nullif(e.metadata->>'landingPageUrl', ''), e.metadata->>'referrer', ''), '://', 2), '/', 1)), '^www\.', ''), '') as domain,
    nullif(regexp_replace(split_part(substring(split_part(coalesce(nullif(e.metadata->>'landingPageUrl', ''), e.metadata->>'referrer', ''), '://', 2) from '/.*$'), '?', 1), '/+$', ''), '') as path,
    nullif(coalesce(nullif(e.metadata->>'campaignId', ''), e.metadata->>'utmId', ''), '') as campaign_id,
    nullif(coalesce(nullif(e.metadata->>'adId', ''), e.metadata->>'utmContent', ''), '') as ad_id,
    count(distinct coalesce(nullif(e.metadata->>'visitId', ''), e.cart_id::text, e.id::text)) as visits
  from public.cart_journey_events e
  where e.org_id = p_org
    and (p_branch is null or e.branch_id = p_branch)
    and e.created_at >= p_from and e.created_at <= p_to
    and e.event_type in ('form_opened', 'first_interaction', 'submit_attempted', 'redirect_triggered')
  group by 1, 2, 3, 4, 5, 6, 7, 8;
$$;

revoke all on function public.tracking_journey_counts(uuid, uuid, timestamptz, timestamptz) from public;
revoke all on function public.tracking_journey_counts(uuid, uuid, timestamptz, timestamptz) from anon, authenticated;
grant execute on function public.tracking_journey_counts(uuid, uuid, timestamptz, timestamptz) to service_role;
