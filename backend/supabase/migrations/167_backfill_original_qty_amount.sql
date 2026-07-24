-- Migration 167: backfill original_quantity/original_amount left null by
-- the public order form's missing insert (fixed in the same change that
-- added original_quantity/original_amount to public-orders.ts's baseInsert).
--
-- ~1,627 orders org-wide (nearly all Facebook/TikTok/Instagram/Audience
-- Network orders) never had these set. This is what produced "Profit
-- baseline unavailable for this qualifying order" in the Upsell Bonus
-- profit panel once one of these orders got a genuine upsell logged.

-- Safe for the ~1,622 orders with no verified upsell: current quantity/
-- amount IS the true original value (same approach the original 018/019
-- migration used for its own historical backfill).
update public.orders
set original_quantity = quantity,
    original_amount = amount
where original_quantity is null
  and upsell_to_qty is null;

-- The 5 orders that already had a verified upsell before these columns
-- existed needed individual reconstruction from order_field_edits (the
-- "from_value" at the earliest quantity/amount edit is the pre-upgrade
-- snapshot), since current quantity/amount is already the POST-upgrade
-- value for these.
update public.orders set original_quantity = 1, original_amount = 39500 where id = '2129';
update public.orders set original_quantity = 15, original_amount = 48500 where id = '2382';
update public.orders set original_quantity = 1, original_amount = 39500 where id = '2483';
update public.orders set original_quantity = 3, original_amount = 16500 where id = '458';

-- Order 96 (also already-upsold) is deliberately excluded: no edit trail
-- or sales-expansion-attempt record exists for it, and its product has two
-- different 3pc packages at very different prices (₦16,500 vs ₦60,500)
-- with no way to tell which applied - left null for manual review.
