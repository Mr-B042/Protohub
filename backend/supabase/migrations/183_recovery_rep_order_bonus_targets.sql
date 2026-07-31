-- Migration 183: Recovery Reps are paid per RECOVERED ORDER against
-- weekly/monthly volume targets, not on a share of net contribution.
--
-- The old model (20% of net contribution above a floor) only worked if the
-- rep could see company revenue and cost, because otherwise the number was
-- unexplainable to them. Bright's call: a rep should focus on targets they
-- control and can see, and should not be shown company financials at all.
-- With a per-order bonus, everything driving their pay is visible to them.
alter table public.recovery_rep_kpi_settings
  add column if not exists bonus_per_recovered_order numeric not null default 1000
    check (bonus_per_recovered_order >= 0),
  add column if not exists weekly_recovered_target integer not null default 15
    check (weekly_recovered_target >= 0),
  add column if not exists monthly_recovered_target integer not null default 60
    check (monthly_recovered_target >= 0);
