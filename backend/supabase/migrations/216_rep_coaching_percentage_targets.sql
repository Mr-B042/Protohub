-- Rep Coaching design-match: the supplied mockup shows a coaching action
-- item whose progress is a PERCENTAGE ("Increase upsell attempt rate to
-- 85%", tracked as "61%"), not a raw count out of a target count like
-- "Review 5 more calls." Rather than a bigger schema rework (separate
-- target_type/target_unit columns), one boolean flips how the existing
-- target_count/completed_count pair is interpreted: as a literal percent
-- when true, as a raw count when false (the default, matching every action
-- item created before this migration).
alter table public.rep_coaching_action_items
  add column if not exists target_is_percentage boolean not null default false;
