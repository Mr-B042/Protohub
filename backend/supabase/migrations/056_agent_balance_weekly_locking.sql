alter table public.agent_balance_weekly_followups
  add column if not exists locked_at timestamptz;
alter table public.agent_balance_weekly_followups
  add column if not exists locked_by_user_id uuid references public.users(id) on delete set null;
alter table public.agent_balance_weekly_followups
  add column if not exists locked_by_name text;
alter table public.agent_balance_weekly_followups
  drop constraint if exists agent_balance_weekly_followups_last_action_type_check;
alter table public.agent_balance_weekly_followups
  add constraint agent_balance_weekly_followups_last_action_type_check
  check (
    last_action_type in (
      'mark_sent',
      'mark_confirmed',
      'report_shortage',
      'report_agent_balance',
      'manager_review',
      'lock_week',
      'unlock_week'
    ) or last_action_type is null
  );
