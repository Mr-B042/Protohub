-- Owner-editable weighted scorecard for Head of Sales Rep.
--
-- The five metrics and their weights (35/20/15/20/10) were hardcoded, and every
-- target was forced to the team's own trailing 4-week average. That default was
-- deliberate - the Owner's rule was never to invent a weekly target before a
-- baseline existed - but it left no way to say "cross-sell matters more to me
-- this quarter" or to set a real goal once one is known.
--
-- Stored as one jsonb blob on the existing settings row rather than a new table
-- or five columns: it is a small, whole-object setting that is always read and
-- written together, exactly like the `tiers` ladder already on this row.
--
-- Shape:
--   { "metrics": [ { "key": "teamAov", "weight": 35,
--                    "targetMode": "baseline" | "manual", "targetValue": 24000 } ] }
--
-- targetMode "baseline" keeps the current behaviour for that metric (its target
-- follows the trailing average and moves as the team moves). "manual" pins it to
-- targetValue. Left NULL, the whole thing falls back to the hardcoded defaults,
-- so existing orgs behave exactly as before until an Owner changes something.
alter table public.head_of_sales_settings
  add column if not exists scorecard jsonb;

comment on column public.head_of_sales_settings.scorecard is
  'Owner-editable scorecard weights and per-metric targets. NULL = use built-in defaults (35/20/15/20/10, all targets from the trailing 4-week baseline).';
