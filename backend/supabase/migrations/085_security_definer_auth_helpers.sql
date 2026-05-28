-- Migration 085: fix realtime UPDATE delivery on RLS-protected tables.
--
-- Symptom: the supabase_realtime container logs
--   PoolingReplicationError: stack depth limit exceeded
--   ...SQL function "auth_org_id" during inlining
--   SQL function "auth_org_id" during startup (×100+)
-- whenever it tries to broadcast an UPDATE/INSERT on a table whose RLS
-- references auth_org_id() or auth_user_role(). The publication is fine;
-- the recursion blows up before any payload is emitted, so every RLS-
-- protected table looks "silent" to subscribers even though the row
-- changed in the DB.
--
-- Root cause: both helpers do `select ... from users where id = auth.uid()`
-- as SECURITY INVOKER. The users table has its own RLS policies that
-- themselves call auth_org_id() to gate "Users see own org members".
-- Realtime evaluates RLS → calls auth_org_id() → reads users → triggers
-- users RLS → calls auth_org_id() → … → stack overflow.
--
-- Fix: mark both helpers SECURITY DEFINER so they read the users row
-- under the function-owner's identity, skipping the recursive RLS check.
-- Safety: each function returns only one column (org_id / role) and is
-- WHERE-clamped to auth.uid(), so it leaks nothing the caller couldn't
-- already see via the standard "Users see own org members" SELECT
-- policy. Same shape every other production codebase uses for these
-- helpers.

create or replace function public.auth_org_id()
returns uuid
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $$
  select org_id from users where id = auth.uid()
$$;

create or replace function public.auth_user_role()
returns user_role
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $$
  select role from users where id = auth.uid()
$$;

-- Re-grant execute privileges (security definer functions need an explicit
-- grant for the roles that should call them; the previous grants persist
-- through CREATE OR REPLACE but reasserting is cheap and defensive).
grant execute on function public.auth_org_id() to anon, authenticated, service_role;
grant execute on function public.auth_user_role() to anon, authenticated, service_role;
