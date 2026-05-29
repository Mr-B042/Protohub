-- Migration 092: move auth_org_id() + auth_user_role() to a non-public schema
--
-- These SECURITY DEFINER helpers are called by ~78 RLS policies across
-- 30+ tables. They MUST remain callable by `authenticated` for RLS to
-- work (we proved that the hard way in migration 089 → 090 round trip
-- which broke realtime).
--
-- The Supabase security advisor keeps flagging them as "Public Can
-- Execute SECURITY DEFINER Function" because PostgREST auto-exposes any
-- function in `public` schema as an RPC endpoint at /rest/v1/rpc/*.
--
-- Fix: move both functions to a `private` schema. PostgREST only exposes
-- `public` schema RPC, so this kills the RPC endpoint while keeping the
-- functions reachable from RLS policy expressions. Critically, Postgres
-- stores RLS policy expressions by function OID, not by qualified name —
-- ALTER FUNCTION ... SET SCHEMA preserves the OID, so all 78 policies
-- continue to resolve to the same function without any per-policy
-- DROP/CREATE churn.

create schema if not exists private;

-- Anon + authenticated need USAGE on the schema to reach the functions
-- via the OID lookup that RLS does. service_role gets it via inheritance
-- but we grant explicitly to be safe.
grant usage on schema private to anon, authenticated, service_role;

-- Move the two helpers. OID is preserved across SET SCHEMA, so every
-- existing RLS policy (cached as OID references) continues to resolve.
alter function public.auth_org_id()    set schema private;
alter function public.auth_user_role() set schema private;

-- Re-grant execute on the new fully-qualified name. SET SCHEMA preserves
-- existing grants but we re-state them here for clarity and to keep
-- migration replays idempotent.
grant execute on function private.auth_org_id()    to anon, authenticated, service_role;
grant execute on function private.auth_user_role() to anon, authenticated, service_role;
