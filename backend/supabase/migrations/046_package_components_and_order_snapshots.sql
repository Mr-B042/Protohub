alter table product_packages
  add column if not exists package_components jsonb not null default '[]'::jsonb;
alter table orders
  add column if not exists package_components_snapshot jsonb not null default '[]'::jsonb;
