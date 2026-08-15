-- Org-wide "Head of Sales Rep" designation for an existing Sales Rep.
--
-- Independent of sales_teams.lead_id (which only covers one team's reps and
-- is Owner/Admin managed) - this flag promotes one Sales Rep to oversee ALL
-- sales reps org-wide, unlocking a dedicated leadership dashboard. Owner-only
-- to grant/revoke.
--
-- head_of_sales_rep_appointed_at marks the 90-day appointment clock. It is
-- set once, server-side, on the false->true transition, and never touched
-- again while the flag stays true - re-toggling off and back on later
-- (Stage 0 does not add that UI path but the column must survive it safely)
-- would otherwise silently restart someone's appointment. Idempotent so it
-- is safe to re-run.

alter table public.users
  add column if not exists is_head_of_sales_rep boolean not null default false,
  add column if not exists head_of_sales_rep_appointed_at timestamptz;

comment on column public.users.is_head_of_sales_rep is
  'Org-wide oversight of ALL sales reps, independent of sales_teams.lead_id. Owner-granted only.';

create index if not exists users_org_is_head_of_sales_rep
  on public.users (org_id, is_head_of_sales_rep);
