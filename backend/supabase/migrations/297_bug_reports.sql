-- Report a Bug / Send Feedback (Bright, 9 Oct 2026). Additive only.
--
--   bug_reports: what anyone in the team sends from the "Report a Bug" page -
--   the kind (issue / feature / UX / other), title, description, where it
--   happened, steps, screenshots, and whether they want updates. The Owner
--   reads them and sets a status; a reporter who asked for updates is told.
--   Org-wide (not branch-scoped): branch_id is kept for context only.
--   Screenshots live in the private bucket "bug-report-files".

create table if not exists public.bug_reports (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete set null,
  reporter_id uuid references public.users(id) on delete set null,
  reporter_name text not null default '',
  reporter_role text not null default '',
  kind text not null check (kind in ('issue', 'feature', 'ux', 'other')),
  title text not null check (char_length(title) between 1 and 100),
  description text not null check (char_length(description) between 1 and 1000),
  module text not null default '',
  page text,
  steps text[] not null default '{}',
  attachments jsonb not null default '[]'::jsonb,
  wants_updates boolean not null default true,
  status text not null default 'new' check (status in ('new', 'looking', 'fixed', 'wont_fix')),
  owner_note text,
  status_changed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists bug_reports_org_created on public.bug_reports (org_id, created_at desc);
create index if not exists bug_reports_reporter on public.bug_reports (reporter_id, created_at desc);

alter table public.bug_reports enable row level security;
create policy "bug reports owner read" on public.bug_reports
  for select to authenticated using (org_id = private.auth_org_id() and private.auth_user_role()::text = 'Owner');

insert into storage.buckets (id, name, public, file_size_limit)
values ('bug-report-files', 'bug-report-files', false, 10485760)
on conflict (id) do nothing;
