-- Migration 098: remittance variance approval — log-first, approve-later.
--
-- Previously only the Owner could record a remittance with short/excess cash (a
-- hard 403 lock for everyone else). Now an Admin can log it too: the cash records
-- immediately (so finance/cash position stays accurate), but it is marked
-- 'pending' for the Owner to approve or reject after the fact. Owner-logged
-- variances are 'approved' at source. Sales Reps / Agents remain blocked.
--
-- This is an oversight/audit layer only — it does NOT gate finance recognition
-- (the variance counts as soon as it's logged). Cash Position / Remittance
-- accounting are untouched.

alter table public.orders
  add column if not exists remittance_variance_status      text,                          -- null | 'pending' | 'approved' | 'rejected'
  add column if not exists remittance_variance_reviewed_by  uuid references public.users(id) on delete set null,
  add column if not exists remittance_variance_reviewed_at  timestamp with time zone,
  add column if not exists remittance_variance_review_note  text;

-- Fast lookup of what's awaiting the Owner.
create index if not exists idx_orders_remit_variance_pending
  on public.orders (org_id)
  where remittance_variance_status = 'pending';
