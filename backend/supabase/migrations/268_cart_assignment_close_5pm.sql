-- Cart hand-out closes at 17:00, not 17:30 (Bright, 30 Sept 2026: the sales
-- reps finish at 5pm, so a cart after 5 waits for the next morning).
--
-- Existing branches were moved to 17:00 directly on 30 Sept. This makes every
-- FUTURE branch start at 17:00 too: seed_cart_assignment_settings() inserts
-- only org_id and branch_id, so a new branch takes the column default.
-- The code's DEFAULT_ASSIGNMENT_RULES (cart-assignment.ts) matches.

alter table public.cart_assignment_settings
  alter column work_end_minute set default 1020;

-- Any branch still on the old closing time moves with it.
update public.cart_assignment_settings
set work_end_minute = 1020, updated_at = now()
where work_end_minute = 1050;
