-- Meta ads run across placements; the order's utm_source carries Facebook's
-- {{site_source_name}} macro (fb / ig / an / th / ms). The order_source enum
-- only had Facebook, so Instagram / Audience Network / Threads / Messenger
-- placements were being collapsed into "Website" — making paid-ad orders look
-- like non-ad website traffic. Add the missing placements so sourceFromUtm can
-- store them accurately (matches the frontend OrderSource type).
--
-- ADD VALUE IF NOT EXISTS is idempotent. New values are only ADDED here (not
-- used), so this is safe to run in the migration transaction.

alter type public.order_source add value if not exists 'Instagram';
alter type public.order_source add value if not exists 'Messenger';
alter type public.order_source add value if not exists 'Audience Network';
alter type public.order_source add value if not exists 'Threads';
