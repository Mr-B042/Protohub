-- Migration 174: add "Wrong Number" as a 4th Reach Status option, per the
-- Customer Retention redesign doc's Post-Call Outcome Flow (Step 1).

alter table public.customer_retention_touchpoints
  drop constraint if exists customer_retention_touchpoints_reach_status_check;

alter table public.customer_retention_touchpoints
  add constraint customer_retention_touchpoints_reach_status_check
  check (reach_status in ('reached', 'not_reached', 'not_reachable', 'wrong_number'));
