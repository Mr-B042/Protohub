-- Migration 173: Customer Retention v2 - operational-workspace redesign.
--
-- Additive only, same conventions as migration 172. No RLS policy changes -
-- new columns fall under the existing table-level policies.

alter table public.customer_retention_touchpoints
  -- Independent request tracking - each request is its own insert-only
  -- row (matching this table's append-only philosophy); the later
  -- "collected" event is a separate row. Lets Reviews/Referrals report a
  -- real requested-to-received conversion rate instead of an estimate.
  add column if not exists review_requested_at    timestamptz,
  add column if not exists referral_requested_at  timestamptz,
  -- Unified "Log Outcome" vocabulary, recorded on every touchpoint insert
  -- regardless of which stage-specific fields are also set. Coarser than
  -- satisfaction_outcome; drives Contacted/Last-Contact KPIs and lets a
  -- "Not Reached" attempt exist without closing out a stage.
  add column if not exists reach_status           text check (reach_status in ('reached','not_reached','not_reachable')),
  add column if not exists customer_response      text check (customer_response in ('satisfied','neutral','complaint')),
  add column if not exists next_action            text check (next_action in (
                                                     'request_review','request_referral','offer_another_product',
                                                     'schedule_follow_up','needs_resolution','not_interested','do_not_contact'
                                                   )),
  add column if not exists next_action_at         timestamptz,
  add column if not exists next_action_note       text;

create index if not exists idx_crt_next_action_at on public.customer_retention_touchpoints(org_id, next_action_at) where next_action_at is not null;

-- Prioritization + bonus-progress settings, same table (same Owner-only
-- write RLS already on customer_retention_bonus_settings from migration 172).
alter table public.customer_retention_bonus_settings
  add column if not exists high_value_order_threshold numeric not null default 50000,
  add column if not exists monthly_bonus_target        numeric not null default 30000;
