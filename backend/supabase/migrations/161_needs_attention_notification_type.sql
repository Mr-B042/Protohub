-- Migration 161: add needs_attention to notification_type enum
-- Backs the new daily Manager Dashboard "Needs Attention" digest cron
-- (backend/src/lib/manager-needs-attention.ts) - a dedicated type so the
-- notification bell can distinguish it from a generic 'info' row.

alter type notification_type add value if not exists 'needs_attention';
