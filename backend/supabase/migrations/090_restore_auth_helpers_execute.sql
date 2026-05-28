-- Migration 090: restore EXECUTE on auth_org_id() / auth_user_role()
--
-- Migration 089 revoked EXECUTE from anon/authenticated on these helpers to
-- silence the Supabase advisor warning about SECURITY DEFINER functions
-- being callable via PostgREST RPC. That was the wrong fix: those helpers
-- are referenced by ~60 RLS policies across the database (orders, products,
-- abandoned_carts, cart_journey_events, etc.). Authenticated users — and
-- the realtime channel evaluating RLS on their behalf — need EXECUTE to
-- have those policies pass.
--
-- Symptom that surfaced: Supabase dashboard "Realtime requests: 0" while
-- admins are subscribed. Realtime silently denies delivery when the
-- policy expression errors.
--
-- A future migration can move these to a non-public schema (e.g. private)
-- to hide them from PostgREST while keeping RLS able to call them. For
-- now, restore the original grants so the app works.

grant execute on function public.auth_org_id()    to anon, authenticated;
grant execute on function public.auth_user_role() to anon, authenticated;
