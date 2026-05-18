alter table public.abandoned_carts
  add column if not exists embed_label text;

alter table public.orders
  add column if not exists embed_label text;

create index if not exists idx_abandoned_carts_org_embed_label
  on public.abandoned_carts (org_id, embed_label);

create index if not exists idx_orders_org_embed_label
  on public.orders (org_id, embed_label);
