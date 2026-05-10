-- Align Supabase Realtime with the app's actual access model and
-- publish the key tables needed for live cross-user updates.

-- Orders: Sales Reps only see their own assigned orders; everyone else in the
-- org can see all orders, matching the app's intended behavior.
drop policy if exists "Reps see own orders, others see all" on public.orders;
create policy "Reps see own orders, others see all"
  on public.orders for select
  using (
    org_id = auth_org_id()
    and (
      auth_user_role() <> 'Sales Rep'
      or assigned_rep_id = auth.uid()
    )
  );

-- Abandoned carts: match the API behavior so reps only receive their own
-- assigned cart rows over Realtime.
drop policy if exists "All org members see carts" on public.abandoned_carts;
create policy "Reps see own carts, others see all"
  on public.abandoned_carts for select
  using (
    org_id = auth_org_id()
    and (
      auth_user_role() <> 'Sales Rep'
      or assigned_rep_id = auth.uid()
    )
  );

-- System notifications: org-wide notifications plus rows explicitly
-- addressed to the current user.
drop policy if exists "All org members see notifications" on public.system_notifications;
create policy "All org members see notifications"
  on public.system_notifications for select
  using (
    org_id = auth_org_id()
    and (
      recipient_id is null
      or recipient_id = auth.uid()
    )
  );

drop policy if exists "All org members mark read" on public.system_notifications;
create policy "All org members mark read"
  on public.system_notifications for update
  using (
    org_id = auth_org_id()
    and (
      recipient_id is null
      or recipient_id = auth.uid()
    )
  );

alter table public.orders               replica identity full;
alter table public.system_notifications replica identity full;
alter table public.products             replica identity full;
alter table public.product_packages     replica identity full;
alter table public.product_pricings     replica identity full;
alter table public.users                replica identity full;
alter table public.abandoned_carts      replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'orders'
  ) then
    execute 'alter publication supabase_realtime add table public.orders';
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'system_notifications'
  ) then
    execute 'alter publication supabase_realtime add table public.system_notifications';
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'products'
  ) then
    execute 'alter publication supabase_realtime add table public.products';
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'product_packages'
  ) then
    execute 'alter publication supabase_realtime add table public.product_packages';
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'product_pricings'
  ) then
    execute 'alter publication supabase_realtime add table public.product_pricings';
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'users'
  ) then
    execute 'alter publication supabase_realtime add table public.users';
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'abandoned_carts'
  ) then
    execute 'alter publication supabase_realtime add table public.abandoned_carts';
  end if;
end
$$;
