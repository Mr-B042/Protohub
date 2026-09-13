-- Delivered reconciliation rows inherit the branch of their source order.
alter table public.delivered_stock_reconciliation_lines
  add column if not exists branch_id uuid references public.branches(id) on delete restrict;

update public.delivered_stock_reconciliation_lines r
set branch_id = o.branch_id
from public.orders o
where r.order_id = o.id and r.branch_id is null;

update public.delivered_stock_reconciliation_lines r
set branch_id = b.id
from public.branches b
where r.branch_id is null
  and b.org_id = r.org_id
  and b.name = 'Nigeria Operations';

alter table public.delivered_stock_reconciliation_lines alter column branch_id set not null;
create index if not exists idx_delivered_reconciliation_branch
  on public.delivered_stock_reconciliation_lines(org_id, branch_id, delivered_at desc);
