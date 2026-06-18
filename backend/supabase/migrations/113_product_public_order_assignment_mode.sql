alter table products
  add column if not exists public_order_assignment_mode text not null default 'inherit';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'products_public_order_assignment_mode_check'
  ) then
    alter table products
      add constraint products_public_order_assignment_mode_check
      check (public_order_assignment_mode in ('inherit', 'auto_assign', 'manual_review'));
  end if;
end $$;
