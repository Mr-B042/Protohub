-- 187: mark agents who settle logistics monthly rather than per delivery.
--
-- Toolbox Rivers and 9jadoorstep Abia hand over their delivery-fee breakdown
-- at month end (or the first week of the next month), so their delivered
-- orders sit with no logistics_cost for weeks. Measured 2026-08-01: 31 of 90
-- and 7 of 22 delivered orders respectively had no fee recorded, spanning the
-- whole of July - not the day-or-two lag every other agent shows.
--
-- Cost that has been incurred but not yet billed still makes net profit look
-- better than it is. This flag lets the Owner-only view accrue a provisional
-- fee for those orders until the real breakdown arrives.
--
-- The accrual itself is NOT stored on the order - it is computed at display
-- time from the agent's own median fee, so when the real cost lands via Batch
-- Remittance the estimate simply stops applying. Nothing to reverse, and a
-- placeholder can never harden into a figure someone mistakes for real.
alter table public.agents
  add column if not exists monthly_remittance boolean not null default false;

comment on column public.agents.monthly_remittance is
  'Agent settles delivery fees monthly, not per delivery. Owner-only P&L accrues a provisional fee for their unpriced deliveries (migration 187).';

update public.agents
   set monthly_remittance = true
 where name in ('Toolbox Rivers', '9jadoorstep Abia');
