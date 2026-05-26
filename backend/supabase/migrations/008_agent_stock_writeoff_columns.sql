-- Backend's /api/agents/:id/reconcile route reads agent_stock.defective,
-- agent_stock.missing, and agents.stock_capacity. These columns were assumed
-- to exist (the route was written before this migration) but no migration in
-- the repo added them. Adding them idempotently so the reconcile route works
-- on a freshly-applied schema; safe no-op if they were already created
-- manually in the production project.

alter table public.agent_stock
  add column if not exists defective integer not null default 0 check (defective >= 0),
  add column if not exists missing   integer not null default 0 check (missing   >= 0);
alter table public.agents
  add column if not exists stock_capacity integer not null default 1000 check (stock_capacity > 0);
