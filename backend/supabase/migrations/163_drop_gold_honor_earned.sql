-- Migration 163: revert migration 162
-- The "Gold Tier stays on permanently once earned" design was reverted per
-- Bright's direction - the whole badge (including the plain crown) should
-- disappear again in any week the rep doesn't hit the delivery-rate boost's
-- thresholds, same as before. Only a live countdown to the current bonus
-- week's end was kept. This column is no longer read or written anywhere.

alter table users drop column if exists gold_honor_earned;
