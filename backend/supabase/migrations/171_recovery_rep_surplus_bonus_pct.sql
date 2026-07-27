-- Migration 171: Recovery Rep surplus bonus percentage.
--
-- The dashboard only showed pass/fail minimums, giving a rep no personal
-- incentive to keep going once the ₦380,000 monthly floor was cleared.
-- Adds an Owner-editable percentage the rep earns on net contribution
-- ABOVE that floor (default 20%), gated on delivery rate/upsell attempt
-- rate/documentation all meeting target.
alter table public.recovery_rep_kpi_settings
  add column if not exists surplus_bonus_pct numeric not null default 20;
