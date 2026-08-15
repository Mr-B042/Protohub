-- Weekly Report design-match (Stage 3): the supplied mockup has 3 more
-- freeform sections than the original build (Key Learnings, Additional
-- Notes) plus a structured "Focus Goal" for next week (3 numeric targets).
-- summary_wins/summary_challenges/next_week_plan stay plain text - the
-- mockup only shows static bullet markers, not interactive checkboxes, so
-- newline-delimited text rendered as a bulleted list client-side is
-- faithful without adding jsonb array complexity.

alter table public.head_of_sales_weekly_reports
  add column if not exists key_learnings text,
  add column if not exists additional_notes text,
  add column if not exists focus_target_aov numeric(12, 2),
  add column if not exists focus_target_delivery_rate numeric(5, 2),
  add column if not exists focus_target_upsell_rate numeric(5, 2);
