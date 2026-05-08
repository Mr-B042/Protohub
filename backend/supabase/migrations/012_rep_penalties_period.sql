-- Migration 012: add period column to rep_penalties
-- The table was created outside migrations (no DDL on file). This migration
-- adds the period column so payroll generation can filter penalties by period.
-- Also documents the table DDL for future db resets.

alter table rep_penalties
  add column if not exists period text;
