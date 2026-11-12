-- Social Leads Inbox alerts (351): system_notifications.type is an enum.
alter type public.notification_type add value if not exists 'social_lead_new';
alter type public.notification_type add value if not exists 'social_lead_reply';
alter type public.notification_type add value if not exists 'social_lead_overdue';
alter type public.notification_type add value if not exists 'social_lead_follow_up';
