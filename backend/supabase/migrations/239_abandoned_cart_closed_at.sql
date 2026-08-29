-- ─────────────────────────────────────────────────────────────────────────────
-- When a cart was closed.
--
-- ⚠️ WHY THIS COLUMN EXISTS. The cart recovery panel wants two audit flags that
-- catch the behaviour the ₦500 daily penalty cannot see:
--
--   "Quick closes"  - a cart closed within two minutes of first contact
--   "Bulk closes"   - several carts closed by one rep inside three minutes
--
-- Both are questions about WHEN a cart was closed, and nothing recorded that.
-- The nearest available timestamp is the last contact attempt, which is a
-- different fact: a rep can log an attempt on Monday and close on Thursday.
-- Deriving a misconduct flag from it would put an accusation on somebody's
-- name using a number that means something else, so the flags were left
-- unbuilt until this column existed.
--
-- ⚠️ NOT BACKFILLED, AND IT CANNOT BE. There is no historical record of when
-- any existing cart was closed - that is the entire problem. Every row starts
-- NULL, and the flags therefore only ever describe carts closed from here on.
-- A backfill from last_activity would manufacture evidence, which is worse
-- than having none.
-- ─────────────────────────────────────────────────────────────────────────────

alter table abandoned_carts
  add column if not exists closed_at timestamptz;

comment on column abandoned_carts.closed_at is
  'When the cart reached a terminal status (Not interested / No response / Converted). NULL for carts closed before migration 239 - there was no record - and NULL for carts still open. Never backfilled: see the migration.';

-- The flags scan a rep''s closes inside a short window, so both columns are
-- part of the same lookup.
create index if not exists abandoned_carts_closed_at_idx
  on abandoned_carts (assigned_rep_id, closed_at desc)
  where closed_at is not null;
