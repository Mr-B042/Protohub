alter table public.orders
  add column if not exists original_created_at timestamptz,
  add column if not exists created_at_corrected_at timestamptz,
  add column if not exists created_at_corrected_by uuid references public.users(id) on delete set null,
  add column if not exists created_at_correction_reason text,
  add column if not exists original_delivered_date text,
  add column if not exists delivered_date_corrected_at timestamptz,
  add column if not exists delivered_date_corrected_by uuid references public.users(id) on delete set null,
  add column if not exists delivered_date_correction_reason text;

alter table public.remittance_transactions
  add column if not exists order_created_at_snapshot timestamptz,
  add column if not exists order_delivered_date_snapshot text,
  add column if not exists product_id_snapshot uuid,
  add column if not exists product_name_snapshot text,
  add column if not exists package_name_snapshot text,
  add column if not exists customer_snapshot text,
  add column if not exists assigned_rep_id_snapshot uuid,
  add column if not exists agent_id_snapshot uuid,
  add column if not exists order_amount_snapshot numeric(12,2),
  add column if not exists logistics_cost_snapshot numeric(12,2),
  add column if not exists expected_remittance_snapshot numeric(12,2);

update public.remittance_transactions as rt
set
  order_created_at_snapshot = coalesce(rt.order_created_at_snapshot, o.created_at),
  order_delivered_date_snapshot = coalesce(rt.order_delivered_date_snapshot, o.delivered_date::text),
  product_id_snapshot = coalesce(rt.product_id_snapshot, o.product_id),
  product_name_snapshot = coalesce(rt.product_name_snapshot, o.product_name),
  package_name_snapshot = coalesce(rt.package_name_snapshot, o.package_name),
  customer_snapshot = coalesce(rt.customer_snapshot, o.customer),
  assigned_rep_id_snapshot = coalesce(rt.assigned_rep_id_snapshot, o.assigned_rep_id),
  agent_id_snapshot = coalesce(rt.agent_id_snapshot, o.agent_id),
  order_amount_snapshot = coalesce(rt.order_amount_snapshot, o.amount),
  logistics_cost_snapshot = coalesce(rt.logistics_cost_snapshot, coalesce(o.logistics_cost, 0)),
  expected_remittance_snapshot = coalesce(
    rt.expected_remittance_snapshot,
    greatest(0, coalesce(o.amount, 0) - coalesce(o.logistics_cost, 0))
  )
from public.orders as o
where o.id = rt.order_id
  and (
    rt.order_created_at_snapshot is null
    or rt.order_delivered_date_snapshot is null
    or rt.product_id_snapshot is null
    or rt.product_name_snapshot is null
    or rt.package_name_snapshot is null
    or rt.customer_snapshot is null
    or rt.assigned_rep_id_snapshot is null
    or rt.order_amount_snapshot is null
    or rt.logistics_cost_snapshot is null
    or rt.expected_remittance_snapshot is null
  );

create index if not exists idx_orders_created_correction_audit
  on public.orders (org_id, created_at_corrected_at desc);

create index if not exists idx_orders_delivered_correction_audit
  on public.orders (org_id, delivered_date_corrected_at desc);
