-- Migration 106: marketer-submitted spend records with Owner/Admin matching.
--
-- Marketing spend can now be entered by either the company side or the marketer:
-- - Owner/Admin rows are trusted immediately and count as matched.
-- - Marketer rows start pending until Owner/Admin marks them matched or mismatch.

alter table public.marketing_spend_records
  add column if not exists entry_source text not null default 'owner_admin',
  add column if not exists review_status text not null default 'matched',
  add column if not exists matched_by uuid references public.users(id) on delete set null,
  add column if not exists matched_at timestamp with time zone,
  add column if not exists match_note text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'marketing_spend_records_entry_source_check'
  ) then
    alter table public.marketing_spend_records
      add constraint marketing_spend_records_entry_source_check
      check (entry_source in ('owner_admin', 'marketer'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'marketing_spend_records_review_status_check'
  ) then
    alter table public.marketing_spend_records
      add constraint marketing_spend_records_review_status_check
      check (review_status in ('pending', 'matched', 'mismatch'));
  end if;
end $$;

update public.marketing_spend_records
set entry_source = coalesce(nullif(entry_source, ''), 'owner_admin'),
    review_status = coalesce(nullif(review_status, ''), 'matched'),
    matched_at = case
      when review_status = 'matched' and matched_at is null then coalesce(updated_at, created_at, now())
      else matched_at
    end
where entry_source is null
   or review_status is null
   or (review_status = 'matched' and matched_at is null);

create index if not exists idx_marketing_spend_review_status
  on public.marketing_spend_records (org_id, review_status, spend_date desc);

drop policy if exists marketing_spend_owner_admin_write on public.marketing_spend_records;
drop policy if exists marketing_spend_owner_admin_insert on public.marketing_spend_records;
drop policy if exists marketing_spend_owner_admin_update on public.marketing_spend_records;
drop policy if exists marketing_spend_owner_admin_delete on public.marketing_spend_records;
drop policy if exists marketing_spend_marketer_insert on public.marketing_spend_records;
drop policy if exists marketing_spend_marketer_update_pending on public.marketing_spend_records;

create policy marketing_spend_owner_admin_insert
  on public.marketing_spend_records
  for insert
  with check (
    exists (
      select 1 from public.users u
      where u.id = auth.uid()
        and u.org_id = marketing_spend_records.org_id
        and u.role in ('Owner', 'Admin')
    )
  );

create policy marketing_spend_owner_admin_update
  on public.marketing_spend_records
  for update
  using (
    exists (
      select 1 from public.users u
      where u.id = auth.uid()
        and u.org_id = marketing_spend_records.org_id
        and u.role in ('Owner', 'Admin')
    )
  )
  with check (
    exists (
      select 1 from public.users u
      where u.id = auth.uid()
        and u.org_id = marketing_spend_records.org_id
        and u.role in ('Owner', 'Admin')
    )
  );

create policy marketing_spend_owner_admin_delete
  on public.marketing_spend_records
  for delete
  using (
    exists (
      select 1 from public.users u
      where u.id = auth.uid()
        and u.org_id = marketing_spend_records.org_id
        and u.role in ('Owner', 'Admin')
    )
  );

create policy marketing_spend_marketer_insert
  on public.marketing_spend_records
  for insert
  with check (
    exists (
      select 1 from public.users u
      where u.id = auth.uid()
        and u.org_id = marketing_spend_records.org_id
        and u.role = 'Marketer'
    )
    and marketer_user_id = auth.uid()
    and entry_source = 'marketer'
    and review_status = 'pending'
  );

create policy marketing_spend_marketer_update_pending
  on public.marketing_spend_records
  for update
  using (
    exists (
      select 1 from public.users u
      where u.id = auth.uid()
        and u.org_id = marketing_spend_records.org_id
        and u.role = 'Marketer'
    )
    and marketer_user_id = auth.uid()
    and entry_source = 'marketer'
    and review_status = 'pending'
  )
  with check (
    exists (
      select 1 from public.users u
      where u.id = auth.uid()
        and u.org_id = marketing_spend_records.org_id
        and u.role = 'Marketer'
    )
    and marketer_user_id = auth.uid()
    and entry_source = 'marketer'
    and review_status = 'pending'
  );
