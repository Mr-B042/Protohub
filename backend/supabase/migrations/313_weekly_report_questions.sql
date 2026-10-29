-- 313: questions to the manager on a rep's weekly figures (Bright, 29 Oct 2026).
--
-- The Owner asks about one rep's figure (e.g. a payout change whose reason
-- counts more orders than were paid), and Protohub asks by itself when a figure does
-- not add up (source 'auto', one per check per rep per week via check_key).
-- The manager answers; the Owner accepts or asks again. While any question is
-- waiting for the manager, the week cannot be submitted to the Owner (and
-- cannot be locked).
--
-- messages: [{ kind: 'question' | 'answer' | 'follow_up' | 'accepted' | 'closed',
--              text, byId, byName, byRole, at }]

create table if not exists public.weekly_report_questions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  week_start date not null,
  rep_id uuid not null references public.users(id) on delete cascade,
  source text not null check (source in ('owner', 'auto')),
  check_key text,
  status text not null default 'open' check (status in ('open', 'answered', 'accepted')),
  messages jsonb not null default '[]'::jsonb,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz,
  check (source = 'owner' or check_key is not null)
);

create unique index if not exists weekly_report_questions_auto_once
  on public.weekly_report_questions (org_id, branch_id, week_start, rep_id, check_key)
  where check_key is not null;
create index if not exists weekly_report_questions_branch_week
  on public.weekly_report_questions (branch_id, week_start);

alter table public.weekly_report_questions enable row level security;

drop policy if exists "weekly report questions select" on public.weekly_report_questions;
create policy "weekly report questions select" on public.weekly_report_questions
  for select to authenticated
  using (
    org_id = private.auth_org_id()
    and private.auth_user_role()::text in ('Owner', 'Admin', 'Manager')
  );
