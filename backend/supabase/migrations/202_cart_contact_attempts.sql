-- 202: follow-up log for assigned abandoned carts.
--
-- Carts had customer-side telemetry (cart_journey_events) and a single status,
-- but nowhere for the REP to record what happened when they called. A status
-- alone cannot answer "has anyone actually chased this, and what did the
-- customer say" - so a cart could sit on "Assigned" for weeks looking worked.
--
-- Deliberately mirrors order_contact_attempts: a rep chasing a cart and a rep
-- chasing an order are doing the same job, and two different shapes would mean
-- two different habits and two different reports.
create table if not exists public.cart_contact_attempts (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null,
  cart_id        text not null,
  rep_id         uuid,
  rep_name       text,
  attempted_at   timestamptz not null default now(),
  channel        text not null default 'Call',
  outcome_code   text not null,
  -- Free text for "Other": a fixed list never survives contact with reality,
  -- but an unlabelled note is unreportable, hence code + custom together.
  custom_outcome text,
  outcome_note   text,
  customer_reached boolean not null default false,
  next_action_at timestamptz,
  created_at     timestamptz not null default now(),
  constraint cart_attempt_channel_valid check (channel in ('Call','WhatsApp','SMS','Email','Other')),
  constraint cart_attempt_outcome_valid check (outcome_code in (
    'Interested','Not interested','Unresponsive','Number not reachable',
    'Asked to call back','Wants to order now','Price concern','Wrong number','Other'
  )),
  constraint cart_attempt_custom_needs_text check (
    outcome_code <> 'Other' or (custom_outcome is not null and length(trim(custom_outcome)) > 0)
  )
);

create index if not exists idx_cart_attempts_cart on public.cart_contact_attempts (cart_id, attempted_at desc);
create index if not exists idx_cart_attempts_org on public.cart_contact_attempts (org_id, attempted_at desc);
create index if not exists idx_cart_attempts_rep on public.cart_contact_attempts (rep_id, attempted_at desc);

alter table public.cart_contact_attempts enable row level security;
