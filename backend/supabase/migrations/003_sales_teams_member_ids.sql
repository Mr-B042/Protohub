-- Add member_ids column to sales_teams for tracking which reps belong to each team.
ALTER TABLE sales_teams
  ADD COLUMN IF NOT EXISTS member_ids jsonb NOT NULL DEFAULT '[]'::jsonb;
