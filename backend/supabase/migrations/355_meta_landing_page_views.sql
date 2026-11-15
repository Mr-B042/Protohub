-- Ad Spend funnel (Bright, 15 Nov 2026): Meta's landing-page views per ad per day.
-- Null = not read yet (days synced before this column existed).
alter table public.tracking_meta_ad_insights add column if not exists landing_page_views integer;
