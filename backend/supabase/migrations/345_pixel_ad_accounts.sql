-- Which ad accounts each Pixel is shared with / owned by (Bright, 11 Nov 2026:
-- tell same-named Pixels apart by ad account). Filled by the ad spend auto
-- sync every 6 hours from Meta (pixel shared_accounts + owner_ad_account).
alter table public.tracking_data_sources
  add column if not exists ad_accounts jsonb,
  add column if not exists ad_accounts_at timestamptz,
  add column if not exists ad_accounts_error text;
