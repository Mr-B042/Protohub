-- Migration 182: reusable recovery offers, call scripts and messages, plus a
-- log of every time one is actually used.
--
-- Three things the Recovery Rep dashboard asked for - Offer Templates,
-- Recovery Scripts, Broadcast Message - are all "a saved piece of approved
-- text a rep reuses". They differ only in how they're used, so they share one
-- table with a `kind` discriminator, the same convention
-- customer_retention_touchpoints already uses for its `stage`.
--
-- The send log is what makes offers measurable: "Top Win-back Offers" needs
-- to know which offer went out and what it earned, and nothing recorded that
-- before. resulting_order_id ties a send to a real order, so attribution is
-- an actual order rather than someone's recollection.

create table if not exists public.recovery_templates (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  kind         text not null check (kind in ('offer', 'script', 'message')),
  name         text not null,
  body         text not null,
  -- Offers only. Kept nullable rather than split into another table: a script
  -- simply has no offer shape.
  offer_type   text check (offer_type is null or offer_type in ('discount_pct', 'free_shipping', 'bundle', 'new_arrival', 'other')),
  discount_pct numeric check (discount_pct is null or (discount_pct >= 0 and discount_pct <= 100)),
  active       boolean not null default true,
  created_by   uuid references public.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists idx_recovery_templates_kind
  on public.recovery_templates(org_id, kind, active);

-- One row per actual use. Insert-only by design: this is an audit trail of
-- what was sent to whom, so it must never be edited after the fact.
create table if not exists public.recovery_template_sends (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.organizations(id) on delete cascade,
  template_id        uuid references public.recovery_templates(id) on delete set null,
  order_id           text references public.orders(id) on delete set null,
  customer_name      text,
  customer_phone     text not null,
  channel            text not null default 'whatsapp'
    check (channel in ('whatsapp', 'sms', 'call', 'other')),
  -- Set later if this customer goes on to order, so an offer's real return
  -- can be measured instead of assumed.
  resulting_order_id text references public.orders(id) on delete set null,
  sent_by            uuid references public.users(id) on delete set null,
  sent_at            timestamptz not null default now()
);

create index if not exists idx_recovery_template_sends_template
  on public.recovery_template_sends(org_id, template_id, sent_at desc);
create index if not exists idx_recovery_template_sends_phone
  on public.recovery_template_sends(org_id, customer_phone, sent_at desc);

alter table public.recovery_templates enable row level security;
alter table public.recovery_template_sends enable row level security;

-- Everyone who works recovery can READ templates - that is the point of a
-- shared approved-script store. Only supervisors can change them, so a rep
-- cannot quietly alter an approved offer.
drop policy if exists "recovery templates select" on public.recovery_templates;
create policy "recovery templates select"
  on public.recovery_templates for select to authenticated
  using (
    org_id = private.auth_org_id()
    and private.auth_user_role()::text in ('Owner', 'Admin', 'Manager', 'Recovery Rep', 'Sales Rep')
  );

drop policy if exists "recovery templates write" on public.recovery_templates;
create policy "recovery templates write"
  on public.recovery_templates for all to authenticated
  using (
    org_id = private.auth_org_id()
    and private.auth_user_role()::text in ('Owner', 'Admin', 'Manager')
  )
  with check (
    org_id = private.auth_org_id()
    and private.auth_user_role()::text in ('Owner', 'Admin', 'Manager')
  );

drop policy if exists "recovery template sends select" on public.recovery_template_sends;
create policy "recovery template sends select"
  on public.recovery_template_sends for select to authenticated
  using (
    org_id = private.auth_org_id()
    and private.auth_user_role()::text in ('Owner', 'Admin', 'Manager', 'Recovery Rep', 'Sales Rep')
  );

drop policy if exists "recovery template sends insert" on public.recovery_template_sends;
create policy "recovery template sends insert"
  on public.recovery_template_sends for insert to authenticated
  with check (
    org_id = private.auth_org_id()
    and private.auth_user_role()::text in ('Owner', 'Admin', 'Manager', 'Recovery Rep', 'Sales Rep')
  );
