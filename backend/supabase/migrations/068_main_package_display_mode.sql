alter table public.products
  add column if not exists main_package_display_mode text not null default 'standard'
    check (main_package_display_mode in ('standard', 'single_combo'));
