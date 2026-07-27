-- Migration 170: backfill delivery-expense dates to match delivered_date.
--
-- Data-only migration documenting a fix already applied to prod.
--
-- syncOrderDeliveryExpense (frontend) never re-synced an order's already-
-- created EXP-DEL-<orderId> expense date once the order's real
-- delivered_date landed - most commonly because the delivery fee was
-- entered while the order was still Dispatched (using a fallback date),
-- days before it was actually marked Delivered. This left the expense
-- dated earlier than the real delivery, so its cost landed in the wrong
-- week's Finance Summary. Fixed in the frontend to re-sync the expense's
-- date on every status change into/within "Delivered".
--
-- This backfills the 593-record backlog so each auto-synced delivery
-- expense's date matches its order's actual, current delivered_date.
update public.expenses e
set date = o.delivered_date
from public.orders o
where e.id = 'EXP-DEL-' || o.id
and o.status = 'Delivered'
and o.delivered_date is not null
and e.date::date <> o.delivered_date::date;
