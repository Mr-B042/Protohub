-- 196: the vehicle an agent actually delivers on.
--
-- transport_method already says "Motorcycle" or "Car", but a dispatcher
-- chasing a delivery needs to know WHICH motorcycle. A plate number is also
-- the only way to tie an agent to an incident report from a customer or the
-- police.
alter table public.personal_delivery_agents
  add column if not exists vehicle_model text,
  add column if not exists vehicle_plate text;

comment on column public.personal_delivery_agents.vehicle_plate is
  'Plate number. The one identifier that survives an incident when nobody caught the rider''s name (migration 196).';
