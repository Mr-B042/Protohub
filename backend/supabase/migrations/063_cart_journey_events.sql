-- Migration 063: customer journey timeline for public order forms
-- Tracks key pre-submit and pre-abandon actions so abandoned carts and
-- converted carts can show what the customer actually did in the form.

create table if not exists public.cart_journey_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  cart_id text not null,
  product_id uuid references public.products(id) on delete set null,
  package_id uuid references public.product_packages(id) on delete set null,
  state text,
  event_type text not null check (
    event_type in (
      'form_opened',
      'package_selected',
      'state_selected',
      'additional_item_preview_opened',
      'additional_item_added',
      'additional_item_removed',
      'submit_attempted',
      'order_submitted',
      'form_exited'
    )
  ),
  companion_product_id uuid references public.products(id) on delete set null,
  companion_package_id uuid references public.product_packages(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists cart_journey_events_org_cart_created_idx
  on public.cart_journey_events (org_id, cart_id, created_at asc);
create index if not exists cart_journey_events_event_type_idx
  on public.cart_journey_events (event_type, created_at desc);
