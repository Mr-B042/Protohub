-- Weekly Check-up (Bright, 5 Nov 2026): CPC needs clicks. Meta's numbers per
-- ad per day now also keep link clicks and impressions. Rows saved before
-- this stay NULL (no CPC for those days) until a sync reads them again.
alter table public.tracking_meta_ad_insights
  add column if not exists link_clicks bigint,
  add column if not exists impressions bigint;
