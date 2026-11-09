-- Second batch of ready-made email groups (went quiet by reason, one-time
-- buyers, top spenders, engaged readers, best-seller buyers, top states):
-- added once per branch, including branches set up before it existed.
alter table public.email_marketing_settings add column if not exists seeded_v2_at timestamptz;
