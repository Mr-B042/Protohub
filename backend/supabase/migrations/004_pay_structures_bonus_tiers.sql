-- Add bonus_tiers jsonb column for Performance Bonus pay structure type.
ALTER TABLE pay_structures
  ADD COLUMN IF NOT EXISTS bonus_tiers jsonb NOT NULL DEFAULT '[]'::jsonb;
