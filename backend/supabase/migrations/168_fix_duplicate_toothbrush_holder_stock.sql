-- Migration 168: fix duplicate "5-Slot Toothbrush Holder" product records.
--
-- Two duplicate products existed (created 2 minutes apart on 2026-07-18):
-- 17dd783a-e039-4797-95ed-dfd48ddc9c67 (SKU TOO-DIS-(CO-591) - the one
-- actually wired into the "Multi Corner Storage Shelf > Starter" package
-- as a free gift, referenced by 20 real orders.
-- a6235bb5-8a58-41ce-badc-82d4d8979c8a (SKU 5-S-TOO-HOL-343) - an orphan
-- referenced by nothing.
--
-- 20 units of physical stock were distributed to Lagos Hub against the
-- ORPHAN duplicate instead of the canonical one, leaving the canonical
-- product at 0 stock everywhere and blocking delivery on orders needing
-- this free gift at Lagos Hub (e.g. order #2634).

-- Move the 20 units from the orphan to the canonical product at Lagos Hub.
insert into public.agent_location_stock (org_id, agent_id, agent_location_id, product_id, quantity, defective, missing)
values ('3b0f208a-c052-4be5-9d5b-740a92130a41', 'ef43cabb-6ab6-45e3-af57-b6df84b36e58', 'd133445e-8d1f-44e4-bda2-4ac6c003fd4d', '17dd783a-e039-4797-95ed-dfd48ddc9c67', 20, 0, 0)
on conflict (agent_location_id, product_id) do update set quantity = public.agent_location_stock.quantity + excluded.quantity;

update public.products set agent_stock = 20 where id = '17dd783a-e039-4797-95ed-dfd48ddc9c67';

insert into public.stock_movements (id, org_id, product_id, product_name, type, qty, balance_after, agent_id, note)
values (gen_random_uuid()::text, '3b0f208a-c052-4be5-9d5b-740a92130a41', '17dd783a-e039-4797-95ed-dfd48ddc9c67', '5-Slot Toothbrush Holder', 'Correction', 20, 20, 'ef43cabb-6ab6-45e3-af57-b6df84b36e58', 'Duplicate-product fix: 20 units moved onto the canonical product (17dd783a, the one actually used by the Starter package free gift) at Lagos Hub. Was blocking order #2634 and others.');

-- Delete the orphan duplicate product entirely. agent_location_stock/
-- product_packages/product_pricings rows referencing it cascade-delete;
-- stock_movements.product_id SET NULLs, preserving the history text.
delete from public.products where id = 'a6235bb5-8a58-41ce-badc-82d4d8979c8a';
