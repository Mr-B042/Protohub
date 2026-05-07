-- =====================================================================
-- Migration 005: Backfill stock_movements.qty signs
-- Older code stored qty as Math.abs(...) regardless of direction, so the
-- +/- coloring in the History view always rendered emerald. New code
-- stores signed qty; this script signs the historical rows so they
-- render correctly too.
--
-- Idempotent: safe to run more than once. Outbound rows become negative,
-- inbound stay positive. Corrections are left alone — direction is
-- ambiguous from "type" alone, and adjust-flow rows are already signed.
--
-- Run in Supabase SQL Editor. Wrap in a transaction so it's all-or-nothing.
-- =====================================================================

begin;

-- Outbound movements: qty should be negative.
update public.stock_movements
   set qty = -abs(qty)
 where type in ('Distributed to Agent', 'Order Fulfilled', 'Waybill Out')
   and qty > 0;

-- Inbound movements: qty should be positive (no-op for almost all rows,
-- but defensive in case a future hand-edit flipped one).
update public.stock_movements
   set qty = abs(qty)
 where type in ('Stock Added', 'Return', 'Waybill In')
   and qty < 0;

commit;
