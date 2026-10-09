-- Wallet waybill "its own cost" tick (Bright, 9 Oct 2026). Additive only.
--
--   manager_fund_transactions.waybill_own_cost: ticked = the waybill payment
--   is an extra cost, added in full on top of the product's typed weekly
--   waybill total (not taken out of it). Unticked (default) = the payment is
--   part of that total and counted once (lib/waybill-costs.ts).
alter table public.manager_fund_transactions add column if not exists waybill_own_cost boolean not null default false;
