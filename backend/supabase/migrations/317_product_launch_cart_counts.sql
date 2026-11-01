-- Product Launch: what a switch did to the test's held abandoned carts.
-- Handed out to reps (Soft Launch, or End test "let the team deliver") or
-- closed as Lost (End test "cancel quietly").
alter table public.product_launch_events
  add column if not exists carts_handed_out integer not null default 0,
  add column if not exists carts_closed integer not null default 0;
