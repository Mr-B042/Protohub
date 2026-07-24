-- Migration 169: follow-up to 168 - seed the missing agent_stock row.
--
-- 168 corrected agent_location_stock (per-agent-per-hub) and the
-- products.agent_stock cache column for the "5-Slot Toothbrush Holder"
-- duplicate-product fix, but missed the separate agent_stock TABLE
-- (org-wide per-agent total, no location breakdown) - the one the
-- Inventory page's "Agent Balance" column actually reads from. That left
-- "Agent Balance" showing 0 even after 168 landed.
--
-- Agent Lagos LBN (ef43cabb-6ab6-45e3-af57-b6df84b36e58) operates only one
-- location, so agent_stock should equal that location's agent_location_stock
-- value (20).
insert into public.agent_stock (agent_id, product_id, quantity, defective, missing)
values ('ef43cabb-6ab6-45e3-af57-b6df84b36e58', '17dd783a-e039-4797-95ed-dfd48ddc9c67', 20, 0, 0)
on conflict (agent_id, product_id) do update set quantity = excluded.quantity;
