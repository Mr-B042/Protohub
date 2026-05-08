-- Add round_robin_position column so the round-robin sequence survives refresh.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS round_robin_position int NOT NULL DEFAULT 0;
