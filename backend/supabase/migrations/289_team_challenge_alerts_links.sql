-- Team Challenges, part 3 (Bright, 5 Oct 2026). Additive / widening only.
-- * notify_state: what has already been announced (lead changes, milestones,
--   deadline reminders) so each alert goes out once.
-- * linked_to_order_id + status 'linked': orders from the same customer close
--   together are ONE transaction - scored once on the first order, so a sale
--   can't be split into several orders to multiply points.
alter table public.team_challenges add column if not exists notify_state jsonb not null default '{}'::jsonb;
alter table public.team_challenge_entries add column if not exists linked_to_order_id text;
alter table public.team_challenge_entries drop constraint if exists team_challenge_entries_status_check;
alter table public.team_challenge_entries add constraint team_challenge_entries_status_check check (status in (
  'awaiting_delivery', 'awaiting_payment', 'awaiting_verification', 'verified',
  'correction_requested', 'excluded', 'reversed', 'linked'
));
