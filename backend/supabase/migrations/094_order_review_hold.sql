-- Repeat-order guard: a customer placing more than 2 orders in one day (WAT)
-- through the public embed form has the 3rd+ order "held for review" instead of
-- auto-assigned/dispatched. On pay-on-delivery, dispatching a bogus duplicate
-- costs real stock + logistics, so the extra order is parked for an Owner/Admin
-- to release (clear the hold → normal flow) or reject (cancel).
--
-- This is a soft flag, NOT a new order status — the order stays "New" so all the
-- existing status / P&L / delivery-rate logic is untouched. Held orders are
-- simply left unassigned and surfaced with a "possible duplicate" badge.

alter table public.orders
  add column if not exists review_hold boolean not null default false,
  add column if not exists review_reason text;

comment on column public.orders.review_hold is
  'True when the order was parked for manual review (e.g. 3rd+ order from the same phone in one day). Held orders are not auto-assigned; an Owner/Admin releases (sets false) or rejects (cancels) them.';
comment on column public.orders.review_reason is
  'Human-readable reason the order was held for review (e.g. "Possible duplicate: 3 orders from this number today").';

-- Speeds up the "orders from this org today" lookup the create-time guard runs.
create index if not exists orders_org_created_at_idx
  on public.orders (org_id, created_at);
