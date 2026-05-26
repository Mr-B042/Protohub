alter table public.agent_balance_weekly_followups
  add column if not exists agent_reported_closing_units integer;
alter table public.agent_balance_weekly_followups
  add column if not exists agent_reported_at timestamptz;
alter table public.agent_balance_weekly_followups
  add column if not exists agent_reported_note text;
alter table public.agent_balance_weekly_followups
  add column if not exists agent_reported_by_user_id uuid references public.users(id) on delete set null;
alter table public.agent_balance_weekly_followups
  add column if not exists agent_reported_by_name text;
alter table public.agent_balance_weekly_followups
  add column if not exists manager_review_status text;
alter table public.agent_balance_weekly_followups
  add column if not exists manager_review_note text;
alter table public.agent_balance_weekly_followups
  add column if not exists manager_reviewed_at timestamptz;
alter table public.agent_balance_weekly_followups
  add column if not exists manager_reviewed_by_user_id uuid references public.users(id) on delete set null;
alter table public.agent_balance_weekly_followups
  add column if not exists manager_reviewed_by_name text;
alter table public.agent_balance_weekly_followups
  drop constraint if exists agent_balance_weekly_followups_manager_review_status_check;
alter table public.agent_balance_weekly_followups
  add constraint agent_balance_weekly_followups_manager_review_status_check
  check (manager_review_status in ('under_review', 'resolved', 'approved_write_off', 'send_to_owner') or manager_review_status is null);
alter table public.agent_balance_weekly_followups
  drop constraint if exists agent_balance_weekly_followups_last_action_type_check;
alter table public.agent_balance_weekly_followups
  add constraint agent_balance_weekly_followups_last_action_type_check
  check (last_action_type in ('mark_sent', 'mark_confirmed', 'report_shortage', 'report_agent_balance', 'manager_review') or last_action_type is null);
