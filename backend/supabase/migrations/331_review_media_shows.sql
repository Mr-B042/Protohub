-- Customer Reviews: "What does the photo show?" (Bright's Submit Customer
-- Review design, 7 Nov 2026). The same choices as the gallery's own labels,
-- for a photo or video review; empty for a written one.

alter table public.customer_reviews add column if not exists media_shows text
  check (media_shows is null or media_shows in ('product_in_use', 'unboxing', 'size', 'packaging', 'other'));
