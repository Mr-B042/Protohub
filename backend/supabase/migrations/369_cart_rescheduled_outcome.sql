-- BUG-1003 (Chelsea, 25 Nov 2026): "Rescheduled" cart logs never saved.
-- The form and server have offered "Rescheduled" since 26 Aug 2026, but this
-- check was never widened, so every Rescheduled save failed with a 500
-- (0 ever stored). From 24 Nov a later day MUST be logged as Rescheduled
-- with a date, which turned the gap into a blocker.
-- ⚠️ Keep this list in step with AttemptSchema.outcomeCode in routes/carts.ts.
alter table public.cart_contact_attempts drop constraint if exists cart_attempt_outcome_valid;
alter table public.cart_contact_attempts add constraint cart_attempt_outcome_valid check (outcome_code = any (array[
  'Interested', 'Not interested', 'Unresponsive', 'Number not reachable', 'Asked to call back',
  'Wants to order now', 'Price concern', 'Rescheduled', 'Wrong number', 'Other'
]::text[]));
