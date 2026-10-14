-- Product unit words (Bright, 14 Oct 2026). Optional. When set, a free gift or
-- package item made of this product is written "1 set of …" / "2 sets of …"
-- instead of borrowing the main package's "pc". Left empty, the wording is
-- worked out from the name (a name that already says set / kit / pack / 8pc
-- is written as it is, with no extra unit word).
alter table public.products add column if not exists unit_singular text;
alter table public.products add column if not exists unit_plural text;
