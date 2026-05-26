alter table public.abandoned_carts
  add column if not exists email text,
  add column if not exists address text,
  add column if not exists preferred_delivery text,
  add column if not exists outage_captured boolean not null default false,
  add column if not exists outage_captured_at timestamptz,
  add column if not exists capture_payload jsonb not null default '{}'::jsonb;

drop policy if exists "Public embed outage inserts carts" on public.abandoned_carts;
create policy "Public embed outage inserts carts"
  on public.abandoned_carts
  for insert
  to anon
  with check (
    status = 'Open abandoned'
    and assigned_rep_id is null
    and product_id is not null
    and package_id is not null
    and exists (
      select 1
      from public.products p
      where p.id = abandoned_carts.product_id
        and p.org_id = abandoned_carts.org_id
        and p.active = true
    )
    and exists (
      select 1
      from public.product_packages pkg
      where pkg.id = abandoned_carts.package_id
        and pkg.product_id = abandoned_carts.product_id
        and pkg.active = true
    )
  );;
