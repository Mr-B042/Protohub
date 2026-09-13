-- Seed the first expansion workspaces. Existing Nigeria data remains only in
-- Nigeria Operations; these new branches intentionally start empty.
insert into public.branches (org_id, country_code, country_name, name, state_or_region, city, currency)
select o.id, seed.country_code, seed.country_name, seed.name, seed.state_or_region, seed.city, seed.currency
from public.organizations o
cross join (values
  ('NG', 'Nigeria', 'Owerri Branch', 'Imo State', 'Owerri', 'NGN'),
  ('GH', 'Ghana', 'Accra Branch', 'Greater Accra', 'Accra', 'GHS'),
  ('KE', 'Kenya', 'Nairobi Branch', 'Nairobi County', 'Nairobi', 'KES')
) as seed(country_code, country_name, name, state_or_region, city, currency)
where not exists (
  select 1 from public.branches b where b.org_id = o.id and b.name = seed.name
);

insert into public.branch_memberships (branch_id, user_id, is_default)
select b.id, u.id, false
from public.branches b
join public.users u on u.org_id = b.org_id and u.role = 'Owner'
where b.name in ('Owerri Branch', 'Accra Branch', 'Nairobi Branch')
on conflict (branch_id, user_id) do nothing;
