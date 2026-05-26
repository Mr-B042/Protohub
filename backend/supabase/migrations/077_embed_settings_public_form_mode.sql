alter table if exists embed_settings
  add column if not exists public_form_mode text not null default 'classic';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'embed_settings_public_form_mode_check'
  ) then
    alter table embed_settings
      add constraint embed_settings_public_form_mode_check
      check (public_form_mode in ('classic', 'guided_checkout'));
  end if;
end $$;;
