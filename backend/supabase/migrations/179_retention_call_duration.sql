-- Migration 179: record how long a retention call actually lasted.
--
-- The Calls & Outcomes design shows an "Avg. Call Duration" KPI, and
-- nothing in the touchpoint schema could answer it - there was no duration
-- anywhere. This adds the field so the figure is measured rather than
-- estimated.
--
-- Nullable on purpose: every touchpoint logged before this migration has
-- no duration, and averages must skip those rows instead of counting them
-- as zero, which would drag the average down and misreport call quality.
alter table public.customer_retention_touchpoints
  add column if not exists call_duration_seconds integer
    check (call_duration_seconds is null or (call_duration_seconds >= 0 and call_duration_seconds <= 86400));
