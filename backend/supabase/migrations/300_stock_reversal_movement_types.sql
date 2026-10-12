-- Stock put back after a delivery is undone was failing on the live database
-- (found 12 Oct 2026).
--
-- Migration 152 was meant to add 'Status Reversal' and 'Delete Reversal' to
-- stock_movement_type. It is recorded as applied on live, but the two values
-- are not in the type there. Since the atomic stock writer (migration 247,
-- 7 Sept) every put-back goes through apply_inventory_movements, which casts
-- the movement type - so a put-back of type 'Status Reversal' is refused, and
-- an order whose stock was already closed, then marked Failed, keeps its
-- deduction. Order 4610 (Warri Bell Logistics, Delta): 3 pieces taken off on
-- 29 Sept, marked Failed afterwards, nothing put back, and no history row,
-- because the request stopped at the refused movement.
--
-- Additive: two new values, nothing existing changes. Kept in its own
-- migration because a new enum value cannot be used in the transaction that
-- adds it.

alter type public.stock_movement_type add value if not exists 'Status Reversal';
alter type public.stock_movement_type add value if not exists 'Delete Reversal';
