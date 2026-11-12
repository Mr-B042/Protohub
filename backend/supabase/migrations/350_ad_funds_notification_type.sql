-- The low ad account funds alert (lib/ad-funds.ts, migration 349) saves
-- system_notifications.type = 'ad_account_low_funds', and the column is an
-- enum: without this value the first live alert (12 Nov 2026) was refused.
alter type public.notification_type add value if not exists 'ad_account_low_funds';
