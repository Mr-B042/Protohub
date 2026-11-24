-- Ad account funds: how many campaigns are actually running (Bright, 25 Nov
-- 2026: "any account that has active campaign should be identified, so non
-- active campaign and active campaign low funds will read different").
-- Read from Meta with the funds every 30 minutes (effective_status = ACTIVE).
-- null = not read yet / the read failed (treated as possibly running).
alter table public.tracking_ad_account_funds
  add column if not exists active_campaigns integer,
  add column if not exists active_checked_at timestamptz;
