-- Migration 016: indexes for query patterns that run on every API call or
-- every cron tick but have no covering index in migration 001.

-- orders: payroll generation and remittance cron filter by delivered_date
create index if not exists idx_orders_delivered_date
  on orders(org_id, delivered_date)
  where delivered_date is not null;

-- orders: remittance cron filters by remittance_status + delivered_date
create index if not exists idx_orders_remittance
  on orders(org_id, remittance_status, delivered_date)
  where status = 'Delivered';

-- orders: date-range filter used in the orders list and weekly report
create index if not exists idx_orders_date_range
  on orders(org_id, created_at desc, status);

-- abandoned_carts: stale-carts cron filters by status + last_activity
create index if not exists idx_carts_stale
  on abandoned_carts(org_id, last_activity)
  where status in ('Open abandoned', 'Assigned');

-- expenses: date-range queries and weekly report
create index if not exists idx_expenses_date
  on expenses(org_id, date desc);

-- users: email helper fetches staff by role; also used in RLS policies
create index if not exists idx_users_org_role
  on users(org_id, role)
  where active = true;

-- stock_movements: waybill audit trail lookup
create index if not exists idx_stock_movements_waybill
  on stock_movements(waybill_id)
  where waybill_id is not null;

-- payroll_runs: list view for the payroll page
create index if not exists idx_payroll_runs_org
  on payroll_runs(org_id, created_at desc);

-- system_notifications: delete-read endpoint filters by read + recipient
create index if not exists idx_notifications_read_cleanup
  on system_notifications(org_id, read)
  where read = true;
