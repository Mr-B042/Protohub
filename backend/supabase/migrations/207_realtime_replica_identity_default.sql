-- 207: narrow realtime's old-row payload back to the primary key.
--
-- REPLICA IDENTITY FULL puts the ENTIRE old row into the WAL on every update
-- and delete, and Realtime then ships that old row alongside the new one to
-- every subscriber. On orders that is roughly 2.5KB of old row per update, sent
-- to every open dashboard, for data nothing reads.
--
-- Checked before changing: all four realtime handlers in src/App.tsx touch
-- payload.old only on DELETE, and only to read `id`. REPLICA IDENTITY DEFAULT
-- still supplies the primary key in that tuple, so `row?.id` behaves exactly as
-- before. Every table below has a primary key, which DEFAULT requires - without
-- one, updates and deletes would silently stop replicating.
--
-- Migration 031 set these to FULL to align the realtime publication; this
-- narrows them back now that we know what is actually read.
alter table public.orders               replica identity default;
alter table public.abandoned_carts      replica identity default;
alter table public.system_notifications replica identity default;
alter table public.users                replica identity default;
alter table public.products             replica identity default;
alter table public.product_packages     replica identity default;
alter table public.product_pricings     replica identity default;
