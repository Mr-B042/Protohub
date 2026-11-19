-- Last top-up per ad account (Bright, 19 Nov 2026: "last real time it was
-- funded"). Read from Meta's account activity (funding_event_successful) in the
-- 30-minute funds check; lib/ad-funds.ts.
alter table public.tracking_ad_account_funds
  add column if not exists last_funded_at timestamptz,
  add column if not exists last_funded_amount numeric;
