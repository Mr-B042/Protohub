-- Email Marketing: Audience Health (Bright's 7 designs, 8 Nov 2026).
--
-- Quality, engagement, deliverability, growth & churn, segment health and
-- issues for the email list. Things it needs that part 1 did not keep:
--  1. Bounces and spam complaints, reported back by Mailjet (a webhook the
--     Owner switches on), so a dead or complaining address stops getting email.
--  2. Problems ("issues") with the time they were found and fixed, so the
--     Issues & Actions tab can show what is open, what was fixed and how fast.
--  3. One snapshot a day of the numbers that can't be worked out afterwards
--     (segment health), for the trend charts.

alter table public.email_campaign_sends add column if not exists provider_message_id text;
alter table public.email_campaign_sends add column if not exists bounced_at timestamptz;
alter table public.email_campaign_sends add column if not exists bounce_kind text check (bounce_kind is null or bounce_kind in ('hard', 'soft', 'blocked'));
alter table public.email_campaign_sends add column if not exists spam_at timestamptz;

-- "cleaned": taken out by a list clean-up (never opened 3+ emails over 60+
-- days, or an older second email for the same phone). Like unsubscribed they
-- get no campaign emails, but they did not leave, so it is not counted as a
-- loss (churn). Nobody is deleted.
alter table public.email_contacts drop constraint if exists email_contacts_status_check;
alter table public.email_contacts add constraint email_contacts_status_check check (status in ('subscribed', 'unsubscribed', 'bounced', 'cleaned'));

-- Which upload a person came in with (Quality by Source).
alter table public.email_contacts add column if not exists import_id uuid references public.email_imports(id) on delete set null;

-- The "Email list problem" alert (Settings › Alerts) is a notification type.
alter type public.notification_type add value if not exists 'email_list_issue';

alter table public.email_marketing_settings add column if not exists bounce_hook_secret text;
alter table public.email_marketing_settings add column if not exists bounce_hook_on_at timestamptz;

create table if not exists public.email_health_issues (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  -- One open issue per problem: "high_bounce", "segment_at_risk:<id>", ...
  key text not null,
  title text not null,
  area text not null check (area in ('quality', 'engagement', 'deliverability', 'growth', 'segments')),
  severity text not null check (severity in ('critical', 'high', 'medium', 'low')),
  action text not null default '',
  detected_at timestamptz not null default now(),
  -- Worked out again on every check: fixed = the problem is no longer there.
  resolved_at timestamptz,
  last_seen_at timestamptz not null default now()
);
create unique index if not exists email_health_issues_open on public.email_health_issues (branch_id, key) where resolved_at is null;
create index if not exists email_health_issues_branch on public.email_health_issues (org_id, branch_id, detected_at desc);
alter table public.email_health_issues enable row level security;

create table if not exists public.email_health_snapshots (
  branch_id uuid not null references public.branches(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  day date not null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (branch_id, day)
);
alter table public.email_health_snapshots enable row level security;
