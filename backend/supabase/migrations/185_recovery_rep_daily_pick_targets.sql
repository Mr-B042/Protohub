-- Migration 185: a minimum number of orders a Recovery Rep should pick up and
-- work each day - one target for follow-up work, one for retention - so the
-- daily throughput is visible rather than only the monthly total.
--
-- Separate targets because they are different jobs: chasing a dead order back
-- to life is not the same work as calling a delivered customer.
alter table public.recovery_rep_kpi_settings
  add column if not exists daily_follow_up_pick_target integer not null default 10
    check (daily_follow_up_pick_target >= 0),
  add column if not exists daily_retention_pick_target integer not null default 10
    check (daily_retention_pick_target >= 0);
