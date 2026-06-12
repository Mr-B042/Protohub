-- Migration 110: clean up duplicated waybill-fee expenses.
--
-- Older frontend code could create a legacy expense id (`EXP-WB-<waybill>`)
-- while the backend also booked a linked `waybill_id` expense. Keep one fee row
-- per waybill, link legacy rows that are the only fee row, and delete extras.

with legacy as (
  select
    e.id,
    e.org_id,
    replace(e.id, 'EXP-WB-', '') as waybill_id
  from public.expenses e
  join public.waybill_records w
    on w.org_id = e.org_id
   and w.id = replace(e.id, 'EXP-WB-', '')
  where e.id like 'EXP-WB-WB-%'
    and e.waybill_id is null
    and coalesce(e.category, '') = 'Waybill'
),
legacy_with_linked as (
  select l.id
  from legacy l
  where exists (
    select 1
    from public.expenses x
    where x.org_id = l.org_id
      and x.waybill_id = l.waybill_id
      and x.id <> l.id
  )
)
delete from public.expenses e
using legacy_with_linked d
where e.id = d.id;

update public.expenses e
set waybill_id = replace(e.id, 'EXP-WB-', '')
from public.waybill_records w
where e.id like 'EXP-WB-WB-%'
  and e.waybill_id is null
  and coalesce(e.category, '') = 'Waybill'
  and w.org_id = e.org_id
  and w.id = replace(e.id, 'EXP-WB-', '');

with ranked as (
  select
    id,
    row_number() over (
      partition by org_id, waybill_id
      order by
        case when id = ('EXP-WB-' || waybill_id) then 0 else 1 end,
        created_at nulls last,
        id
    ) as rn
  from public.expenses
  where waybill_id is not null
    and coalesce(category, '') = 'Waybill'
)
delete from public.expenses e
using ranked r
where e.id = r.id
  and r.rn > 1;
