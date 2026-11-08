-- Switch on the order form's Email box (Bright, 8 Nov 2026: "email only", and
-- "switch it on now" so emails build up before the Email Marketing screens).
-- Applied AFTER the code that drops a mistyped email instead of refusing the
-- whole order is live; before it, "ada@gmail" would have stopped an order.
-- The emails stay on the orders and carts; Email Marketing (migration 334)
-- copies them into its list.
update public.embed_settings set show_email = true, updated_at = now() where show_email is distinct from true;
