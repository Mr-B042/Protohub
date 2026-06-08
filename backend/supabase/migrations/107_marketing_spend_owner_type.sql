-- Migration 107: separate media-buyer spend from company/Owner-run ad spend.
--
-- Media buyers should see and submit only the ad money tied to their own buyer
-- tags. Owner/Admin may also run ads directly from company ad accounts; those
-- rows should not pretend to belong to a media buyer or pollute buyer-specific
-- CPO/ROAS.

alter table public.marketing_spend_records
  add column if not exists spend_owner_type text not null default 'media_buyer';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'marketing_spend_records_spend_owner_type_check'
  ) then
    alter table public.marketing_spend_records
      add constraint marketing_spend_records_spend_owner_type_check
      check (spend_owner_type in ('media_buyer', 'company'));
  end if;
end $$;

update public.marketing_spend_records
set spend_owner_type = 'media_buyer'
where spend_owner_type is null or spend_owner_type = '';

create index if not exists idx_marketing_spend_owner_type_date
  on public.marketing_spend_records (org_id, spend_owner_type, spend_date desc);
