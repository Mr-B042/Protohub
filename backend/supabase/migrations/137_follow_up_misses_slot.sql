-- Per-slot follow-up misses: an unreachable order is chased in 3 same-day slots
-- (morning / afternoon / evening), each a separate ₦50 miss. Add a slot column and
-- make the uniqueness (order, day, slot) so all three can co-exist. Normal daily
-- misses use slot = 'day'.
alter table public.follow_up_misses
  add column if not exists slot text not null default 'day';

alter table public.follow_up_misses
  drop constraint if exists follow_up_misses_order_id_miss_date_key;

create unique index if not exists idx_follow_up_misses_order_date_slot
  on public.follow_up_misses (order_id, miss_date, slot);
