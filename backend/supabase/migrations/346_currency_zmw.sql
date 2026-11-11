-- Zambian Kwacha (Bright, 11 Nov 2026): a Zambia branch sells in ZMW, kept
-- apart from Nigeria's naira. Orders, carts, packages, expenses and prices
-- share this type.
alter type public.currency_code add value if not exists 'ZMW';
