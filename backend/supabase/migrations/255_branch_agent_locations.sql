-- Agent coverage hubs and their stock must follow the owning agent branch.
alter table public.agent_locations add column if not exists branch_id uuid references public.branches(id) on delete restrict;
alter table public.agent_location_stock add column if not exists branch_id uuid references public.branches(id) on delete restrict;

update public.agent_locations l
set branch_id = a.branch_id
from public.agents a
where l.agent_id = a.id and l.branch_id is null;

update public.agent_location_stock s
set branch_id = l.branch_id
from public.agent_locations l
where s.agent_location_id = l.id and s.branch_id is null;

alter table public.agent_locations alter column branch_id set not null;
alter table public.agent_location_stock alter column branch_id set not null;
create index if not exists idx_agent_locations_branch on public.agent_locations(branch_id, agent_id, active);
create index if not exists idx_agent_location_stock_branch on public.agent_location_stock(branch_id, agent_location_id, product_id);
