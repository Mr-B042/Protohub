-- Migration 184: fields the redesigned Log Follow-up form captures that were
-- not stored before - who the rep actually spoke to, whether to remind them
-- before the next follow-up, and whether this customer was tagged for a
-- special offer later.
--
-- All nullable/defaulted so every attempt logged before this stays valid.
-- Attempt number is deliberately NOT stored: it is derived by counting the
-- existing attempts for the order, so it can never disagree with the log.
alter table public.order_contact_attempts
  add column if not exists contact_person text,
  add column if not exists reminder_set boolean not null default false,
  add column if not exists tagged_for_offer boolean not null default false;

create index if not exists idx_order_contact_attempts_tagged
  on public.order_contact_attempts (org_id, tagged_for_offer)
  where tagged_for_offer = true;
