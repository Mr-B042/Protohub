-- Keep stock movement history expressive enough for delivered-order reversals.
-- The backend already writes these movement types when a Delivered order is
-- cancelled/failed or deleted, but older schemas did not include the enum
-- values. Without them, stock can be restored while the ledger insert fails.
alter type public.stock_movement_type add value if not exists 'Status Reversal';
alter type public.stock_movement_type add value if not exists 'Delete Reversal';

-- Hot path for delivery idempotency: decide whether a product currently has an
-- active fulfilment movement or whether the latest movement was reversed.
create index if not exists idx_stock_movements_order_product_type_created
  on public.stock_movements(org_id, order_id, product_id, type, created_at desc)
  where order_id is not null;
