-- ₦500 per delivered order with no delivery fee (Bright, 20 Oct 2026).
--
-- Charged to the order's sales rep when the rep SENDS the weekly report and
-- the system sees the order delivered with no fee. Entering the fee later does
-- not undo it ("charged whether they write it or later, as long as it has been
-- submitted and the system has seen it"). Failed deliveries are left out.
--
-- Stored as an ordinary rep_penalties row (type 'missing_delivery_fee') so
-- payroll takes it off like every other fine. week_start = the weekly report
-- it is charged on. The rep never sees it: weekly-reports leaves this type out
-- of the rep's fines and shows it to Manager / Admin / Owner only.

alter table rep_penalties
  add column if not exists week_start date;

-- One charge per order, ever.
create unique index if not exists rep_penalties_missing_fee_once
  on rep_penalties (org_id, order_id)
  where type = 'missing_delivery_fee';
