-- Migration 084: add cart_journey_events to the supabase_realtime publication
-- so the admin Cart Details modal can subscribe to live INSERT events
-- (tier_switched, image_viewed, field_hesitated, submit_idle, etc.) without
-- polling. abandoned_carts already joined the publication in 031.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'cart_journey_events'
  ) then
    execute 'alter publication supabase_realtime add table public.cart_journey_events';
  end if;
end
$$;
