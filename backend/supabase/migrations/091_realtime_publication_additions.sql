-- Migration 091: extend supabase_realtime publication
--
-- Adds the tables admins actually watch live so the dashboard reflects
-- changes without a refresh. All listed tables already have RLS SELECT
-- policies scoped to auth_org_id(), so the realtime channel evaluates
-- correctly per-org without leaking cross-tenant data.
--
-- Intentionally NOT included:
--   - whatsapp_*, sms_* (low-velocity, polled OK)
--   - manager_activity_logs, order_audit, order_contact_attempts,
--     follow_up_tasks (viewed on demand, not live)
--   - agent_coverage, agent_locations (slow-changing config)
--   - remittance_transactions (low-velocity)
-- These can be added later if admins want live updates on them.

alter publication supabase_realtime add table public.stock_movements;
alter publication supabase_realtime add table public.agent_stock;
alter publication supabase_realtime add table public.expenses;
alter publication supabase_realtime add table public.waybill_records;
alter publication supabase_realtime add table public.agents;
alter publication supabase_realtime add table public.order_field_edits;
