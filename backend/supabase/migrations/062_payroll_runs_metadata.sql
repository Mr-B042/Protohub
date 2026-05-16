-- Migration 062: persist payroll run metadata
-- Stores the custom label, notes, and top-performer summary alongside payroll runs
-- so previewed payroll context survives refreshes and history views.

alter table public.payroll_runs
  add column if not exists label text,
  add column if not exists notes text,
  add column if not exists top_performer jsonb not null default 'null'::jsonb;

update public.payroll_runs
set label = coalesce(label, period)
where label is null;
