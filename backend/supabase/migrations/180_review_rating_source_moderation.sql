-- Migration 180: make reviews reportable.
--
-- Reviews were already captured (review_collected, review_text,
-- review_is_video, media_urls, ad_permission_granted) but with no rating,
-- no channel and no moderation state - so the Reviews & Testimonials design
-- could not answer "average rating", "where did it come from" or "is it
-- approved to publish". These four columns close that.
--
-- All nullable / defaulted, so every review captured before this keeps
-- working: a null rating is "not scored" and is skipped by averages rather
-- than counted as zero, which would drag the average down and misreport
-- customer sentiment.
alter table public.customer_retention_touchpoints
  add column if not exists review_rating smallint
    check (review_rating is null or (review_rating >= 1 and review_rating <= 5)),
  add column if not exists review_source text
    check (review_source is null or review_source in ('whatsapp', 'facebook', 'instagram', 'website', 'phone', 'other')),
  -- Moderation state. Null means "not yet triaged" and is treated as
  -- pending by the UI, so nothing is auto-published without a human.
  add column if not exists review_status text
    check (review_status is null or review_status in ('pending', 'published', 'not_approved', 'rejected')),
  -- How many times the team has reused this testimonial in marketing.
  add column if not exists review_shared_count integer not null default 0
    check (review_shared_count >= 0);

create index if not exists idx_crt_review_status
  on public.customer_retention_touchpoints(org_id, review_status)
  where review_collected = true;
