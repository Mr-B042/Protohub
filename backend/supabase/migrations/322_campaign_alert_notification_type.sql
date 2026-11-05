-- Campaigns with no order for 3 days (Bright, 5 Nov 2026, #908): the alert
-- saves system_notifications.type = 'campaign_no_orders', and the column is
-- the notification_type enum, so without this every alert insert failed.
alter type public.notification_type add value if not exists 'campaign_no_orders';
