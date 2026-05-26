alter table product_packages
  add column if not exists offer_sync_enabled boolean not null default false,
  add column if not exists offer_sync_source_product_id uuid references products(id) on delete set null,
  add column if not exists offer_sync_source_package_id uuid references product_packages(id) on delete set null;

create index if not exists product_packages_offer_sync_source_idx
  on product_packages (product_id, offer_sync_enabled, offer_sync_source_product_id, offer_sync_source_package_id);;
