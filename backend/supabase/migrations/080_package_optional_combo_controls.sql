alter table public.product_packages
  add column if not exists requires_state_stock boolean not null default false,
  add column if not exists featured_combo_card boolean not null default false;
