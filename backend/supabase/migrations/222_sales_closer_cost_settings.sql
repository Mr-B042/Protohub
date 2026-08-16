-- Two Owner-set inputs for the Sales Closer Cost & Profitability view
-- (Stage 10): flat monthly Allocated Salary (same pattern as Recovery
-- Rep's rep_monthly_salary, migration 164 - org-wide, not per-person,
-- subtracted in full once per month, zero proration - the only pattern
-- already proven in this codebase for this exact use case) and a fixed
-- per-unit Packaging cost assumption (no packaging figure is tracked
-- anywhere else in the schema, so this is a deliberate simplification
-- rather than new expense-tracking infrastructure). Both live on the
-- existing sales_closer_bonus_settings row rather than a new table,
-- since it's already the one Owner-editable settings row for this
-- feature.
alter table public.sales_closer_bonus_settings
  add column if not exists allocated_salary_monthly numeric not null default 70000,
  add column if not exists packaging_cost_per_unit numeric not null default 0;
