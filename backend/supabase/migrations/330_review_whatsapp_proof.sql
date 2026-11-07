-- Customer Reviews: a written review must come with a WhatsApp screenshot
-- that shows the customer's phone number (Bright, 7 Nov 2026).
--
-- The screenshot is a review file of its own kind, 'proof'. It is evidence,
-- not a product photo: it never raises a review's level, and it is always
-- kept private (it shows the customer's number), even when the customer
-- allowed marketing use.

alter table public.product_media drop constraint if exists product_media_review_part_check;
alter table public.product_media add constraint product_media_review_part_check
  check (review_part is null or review_part in ('content', 'consent', 'proof'));
