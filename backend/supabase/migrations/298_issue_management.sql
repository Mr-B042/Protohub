-- Issue & Feedback Management (Bright, 9 Oct 2026). Grows the Report a Bug
-- table (migration 297, still empty) into tickets the Owner and Admins
-- manage. Additive except the replaced CHECK constraints.
--
--   bug_reports gains: a ticket number (BUG-1048), the type's own questions
--   (details), impact / who is affected / frequency, the affected order or
--   customer, the reporter's browser and device (environment), recent failed
--   requests and errors from their session (error_context, secrets removed),
--   priority P0-P3 (worked out, or set by the team), an assignee, duplicates,
--   "I'm experiencing this too" count, and the response / resolve / reopen
--   times the analytics use.
--   bug_report_events: the permanent timeline - submitted, status, priority,
--   assigned, replies (the reporter sees) and internal notes (team only).
--   bug_report_followers: people who said "I'm experiencing this too".

create sequence if not exists public.bug_report_ticket_seq start 1001;

alter table public.bug_reports drop constraint if exists bug_reports_status_check;
alter table public.bug_reports drop constraint if exists bug_reports_title_check;
alter table public.bug_reports drop constraint if exists bug_reports_description_check;
alter table public.bug_reports add constraint bug_reports_status_check check (status in (
  'new', 'triaged', 'assigned', 'in_progress', 'testing', 'resolved', 'closed', 'reopened',
  'needs_info', 'duplicate', 'wont_fix', 'planned',
  'under_review', 'approved', 'in_development', 'released'
));
alter table public.bug_reports add constraint bug_reports_title_check check (char_length(title) between 10 and 100);
alter table public.bug_reports add constraint bug_reports_description_check check (char_length(description) <= 6000);

alter table public.bug_reports add column if not exists ticket_no bigint not null default nextval('public.bug_report_ticket_seq');
create unique index if not exists bug_reports_ticket_no on public.bug_reports (ticket_no);
alter table public.bug_reports add column if not exists details jsonb not null default '{}'::jsonb;
alter table public.bug_reports add column if not exists impact text check (impact in ('low', 'medium', 'high', 'critical'));
alter table public.bug_reports add column if not exists affected text check (affected in ('only_me', 'one_customer', 'several_users', 'department', 'everyone', 'not_sure'));
alter table public.bug_reports add column if not exists affected_ref_kind text check (affected_ref_kind in ('order', 'customer', 'product', 'delivery', 'sales_rep'));
alter table public.bug_reports add column if not exists affected_ref text;
alter table public.bug_reports add column if not exists frequency text check (frequency in ('first_time', 'sometimes', 'every_time', 'started_today', 'several_days', 'not_sure'));
alter table public.bug_reports add column if not exists environment jsonb not null default '{}'::jsonb;
alter table public.bug_reports add column if not exists error_context jsonb not null default '{}'::jsonb;
alter table public.bug_reports add column if not exists priority text check (priority in ('P0', 'P1', 'P2', 'P3'));
alter table public.bug_reports add column if not exists priority_overridden boolean not null default false;
alter table public.bug_reports add column if not exists assignee_id uuid references public.users(id) on delete set null;
alter table public.bug_reports add column if not exists assignee_name text;
alter table public.bug_reports add column if not exists duplicate_of uuid references public.bug_reports(id) on delete set null;
alter table public.bug_reports add column if not exists may_contact boolean not null default true;
alter table public.bug_reports add column if not exists affected_count integer not null default 1;
alter table public.bug_reports add column if not exists department text;
alter table public.bug_reports add column if not exists first_response_at timestamptz;
alter table public.bug_reports add column if not exists resolved_at timestamptz;
alter table public.bug_reports add column if not exists closed_at timestamptz;
alter table public.bug_reports add column if not exists reopened_count integer not null default 0;
alter table public.bug_reports add column if not exists sla_alerted_at timestamptz;
create index if not exists bug_reports_org_status on public.bug_reports (org_id, status);

create table if not exists public.bug_report_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  report_id uuid not null references public.bug_reports(id) on delete cascade,
  actor_id uuid references public.users(id) on delete set null,
  actor_name text not null default '',
  kind text not null check (kind in ('submitted', 'status', 'priority', 'assigned', 'reply', 'note', 'me_too', 'attachment', 'verified_fixed', 'reopened', 'duplicate', 'system')),
  internal boolean not null default false,
  body text,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists bug_report_events_report on public.bug_report_events (report_id, created_at);

create table if not exists public.bug_report_followers (
  report_id uuid not null references public.bug_reports(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (report_id, user_id)
);

alter table public.bug_report_events enable row level security;
alter table public.bug_report_followers enable row level security;

-- Screen recordings: 25MB a file (was 10MB).
update storage.buckets set file_size_limit = 26214400 where id = 'bug-report-files';
