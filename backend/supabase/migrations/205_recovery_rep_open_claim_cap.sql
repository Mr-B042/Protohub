-- 205: how many unfinished recovery orders one rep may hold at a time.
--
-- Without a cap a rep can claim the whole candidate pool the moment they can
-- see it, which is hoarding rather than working: 569 orders sitting on one
-- person is indistinguishable from 569 orders nobody is touching, and it locks
-- every other rep out of the same pool.
alter table public.recovery_rep_kpi_settings
  add column if not exists max_open_claims integer not null default 20;

comment on column public.recovery_rep_kpi_settings.max_open_claims is
  'Maximum orders a Recovery Rep may hold that are not yet Delivered/Cancelled/Failed. 0 disables claiming.';
