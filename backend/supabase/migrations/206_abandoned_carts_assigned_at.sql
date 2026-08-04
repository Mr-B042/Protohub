-- 206: when a cart was handed to a rep, so "how long have they sat on this"
-- is answerable. Only assigned_rep_id existed - who, never when.
--
-- Deliberately NOT backfilled. There is no record of when any existing
-- assignment happened: no column, no cart_journey_events entry, no
-- cart-assigned SMS. last_activity is the obvious candidate and the wrong one -
-- it moves every time a follow-up is logged, so it would date a three-week-old
-- assignment as today. Existing rows stay null and are labelled as not
-- recorded, the same decision taken for orders.assigned_at in migration 186.
alter table public.abandoned_carts
  add column if not exists assigned_at timestamptz;

comment on column public.abandoned_carts.assigned_at is
  'When the cart was assigned to assigned_rep_id. Null for assignments made before migration 206 - not recoverable, never inferred.';
