-- Migration 011: add order-event notification types to notification_type enum
-- order-notifications.ts inserts these types but they were missing from the enum,
-- causing every order in-app notification to fail silently with a DB constraint error.

alter type notification_type add value if not exists 'order_new';
alter type notification_type add value if not exists 'order_confirmed';
alter type notification_type add value if not exists 'order_delivered';
alter type notification_type add value if not exists 'order_cancelled';
