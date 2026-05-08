-- Migration 013: fix two production schema gaps
--
-- 1. waybill_status enum is missing 'Defective' and 'Missing' — waybills.ts
--    accepts these values and the Zod schema validates them, but the DB enum
--    only has 4 values so any status update to Defective/Missing fails.
--
-- 2. system_notifications is missing recipient_id, link, order_id, title —
--    order-notifications.ts inserts all four columns, so every order event
--    notification has been failing silently at the DB level.

-- ── waybill_status ────────────────────────────────────────
alter type waybill_status add value if not exists 'Defective';
alter type waybill_status add value if not exists 'Missing';

-- ── system_notifications ──────────────────────────────────
alter table system_notifications
  add column if not exists recipient_id uuid references users(id) on delete cascade,
  add column if not exists link         text,
  add column if not exists order_id     text,
  add column if not exists title        text;

-- Index so per-user notification queries stay fast
create index if not exists idx_notifications_recipient
  on system_notifications(org_id, recipient_id, read, created_at desc);
