-- One wallet waybill payment shared by several products (Bright, 9 Oct 2026).
-- Additive only.
--
--   manager_fund_transactions.product_splits: [{ "productId", "amount" }] when
--   a waybill payment covers 2+ products (null = one product, in product_id).
--   Each share is booked as its own "Waybill" expense (MGRF-<id>, MGRF-<id>-2,
--   ...) so each product's weekly total is counted once (lib/waybill-costs.ts).
alter table public.manager_fund_transactions add column if not exists product_splits jsonb;
