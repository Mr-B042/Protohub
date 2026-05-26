alter table public.product_packages
  add column if not exists state_filter_mode text not null default 'all'
    check (state_filter_mode in ('all', 'allow', 'block')),
  add column if not exists state_restrictions text[] not null default '{}',
  add column if not exists image_url text;
