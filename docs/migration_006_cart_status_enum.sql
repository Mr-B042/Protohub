-- =====================================================================
-- Migration 006: Widen cart_status enum
-- The frontend uses four statuses that didn't exist in the original DB
-- enum: 'In progress', 'Abandoned', 'No response', 'Not interested'.
-- Without these, PATCH /api/carts/:id rejects bulk-action updates.
--
-- ALTER TYPE ... ADD VALUE cannot run inside an explicit transaction
-- block in older Postgres. Run each statement on its own. IF NOT EXISTS
-- requires Postgres 12+ (Supabase is currently 15+).
--
-- Run in Supabase SQL Editor.
-- =====================================================================

alter type cart_status add value if not exists 'In progress';
alter type cart_status add value if not exists 'Abandoned';
alter type cart_status add value if not exists 'No response';
alter type cart_status add value if not exists 'Not interested';
