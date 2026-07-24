-- Migration 165: data correction for order 2483's clobbered upsell fields.
--
-- The rep genuinely upgraded this order 1 -> 2pcs (quantity/amount already
-- reflect that), and upsell_from_qty/upsell_to_qty were correctly set to
-- 1/2 in the same edit. A separate save 19 seconds later - typing into the
-- "Note" field - unconditionally re-sent all three upsell columns using a
-- stale local snapshot, nulling out upsell_from_qty/upsell_to_qty while
-- adding the note. Fixed in the app (queueOrderUpsellSave now only sends
-- the field(s) actually touched); this restores the lost values so the
-- order counts correctly toward upgrade bonus/KPI totals.
update public.orders
set upsell_from_qty = 1, upsell_to_qty = 2
where id = '2483' and upsell_from_qty is null and upsell_to_qty is null;
