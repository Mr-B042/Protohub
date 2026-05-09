alter table if exists embed_settings
  add column if not exists public_order_assignment_mode text not null default 'auto_assign';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'embed_settings_public_order_assignment_mode_check'
  ) then
    alter table embed_settings
      add constraint embed_settings_public_order_assignment_mode_check
      check (public_order_assignment_mode in ('auto_assign', 'manual_review'));
  end if;
end $$;
