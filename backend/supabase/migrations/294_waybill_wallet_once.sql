-- Waybill costs counted once (Bright, 9 Oct 2026). The team types each
-- product's combined weekly waybill total on the Expenses page; the manager
-- may already have paid part of it from her wallet. The total is the COST,
-- the wallet payment is HOW part of it was paid. Additive only.
--
--   manager_fund_transactions.category gains 'waybill'; product_id says which
--   product's waybills a wallet payment was for.
--   expenses.declared_total: on a typed "Waybill" expense, the full weekly
--   total typed. Its amount is then that total less what the wallet already
--   paid for the same week (lib/waybill-costs.ts), so the week counts once.

alter table public.manager_fund_transactions drop constraint if exists manager_fund_transactions_category_check;
alter table public.manager_fund_transactions add constraint manager_fund_transactions_category_check check (category is null or category in (
  'logistics', 'meta_ads', 'airtime_data', 'packaging', 'office', 'customer_refund',
  'staff_expense', 'transportation', 'repairs', 'miscellaneous', 'other', 'waybill'
));
alter table public.manager_fund_transactions add column if not exists product_id text;

alter table public.expenses add column if not exists declared_total numeric(14, 2);
