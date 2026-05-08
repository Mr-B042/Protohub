-- Convert call_outcome from a strict enum to free-text so reps can write
-- custom outcomes ("Not ready, call back tomorrow", "Travelled, back Friday").
-- All existing enum values are valid strings so no data is lost.
ALTER TABLE orders ALTER COLUMN call_outcome TYPE text USING call_outcome::text;
DROP TYPE IF EXISTS call_outcome;
