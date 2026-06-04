-- Migration 099: persist the cash-variance reason the Admin/Owner gives at log time.
--
-- The variance reason is REQUIRED when recording short/excess cash, but it was only
-- written into the order timeline note — not a structured field — so the Owner's
-- approval review had no reason to show. Store it on the order so it can be displayed
-- (and audited) alongside the variance-approval state from migration 098.

alter table public.orders
  add column if not exists remittance_variance_reason text;
