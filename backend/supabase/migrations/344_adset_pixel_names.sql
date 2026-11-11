-- Ad set names on the ad set → Pixel list (Bright, 11 Nov 2026): Pixels share
-- names ("5-in-1 Corner Rack" ×6), so the Pixel picker shows the ad sets that
-- optimise on each. Filled by the Meta refresh (accountAdsetPixels).
alter table public.tracking_meta_adset_pixels
  add column if not exists adset_name text,
  add column if not exists campaign_name text,
  add column if not exists effective_status text;
