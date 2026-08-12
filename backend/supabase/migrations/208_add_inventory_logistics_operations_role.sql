-- Add the expanded operations role without removing the legacy Inventory
-- Manager value. Existing staff remain valid while Owner/Admin can move users
-- to the broader workspace deliberately.
alter type public.user_role
  add value if not exists 'Inventory Manager & Logistics Operations';
