-- Normalize legacy Weekend Stock Summary access names stored on users.
-- This rewrites:
-- - permission: "view_agent_balances" -> "view_weekend_stock_summary"
-- - page:       "Agent Balances"      -> "Weekend Stock Summary"
-- It supports both legacy text[] columns and json/jsonb array columns.

do $$
declare
  permissions_udt text;
  extra_pages_udt text;
begin
  select c.udt_name
  into permissions_udt
  from information_schema.columns as c
  where c.table_schema = 'public'
    and c.table_name = 'users'
    and c.column_name = 'permissions';

  if permissions_udt = '_text' then
    update public.users
    set permissions = coalesce((
      select array_agg(dedup.normalized_value order by dedup.first_ord)
      from (
        select mapped.normalized_value, min(mapped.ord) as first_ord
        from (
          select
            case
              when element.value = 'view_agent_balances' then 'view_weekend_stock_summary'
              else element.value
            end as normalized_value,
            element.ord
          from unnest(coalesce(public.users.permissions, '{}'::text[])) with ordinality as element(value, ord)
        ) as mapped
        group by mapped.normalized_value
      ) as dedup
    ), '{}'::text[])
    where coalesce(public.users.permissions, '{}'::text[]) @> array['view_agent_balances']::text[];
  elsif permissions_udt in ('json', 'jsonb') then
    update public.users
    set permissions = (
      select coalesce(
        jsonb_agg(to_jsonb(dedup.normalized_value) order by dedup.first_ord),
        '[]'::jsonb
      )
      from (
        select mapped.normalized_value, min(mapped.ord) as first_ord
        from (
          select
            case
              when element.value = 'view_agent_balances' then 'view_weekend_stock_summary'
              else element.value
            end as normalized_value,
            element.ord
          from jsonb_array_elements_text(
            case
              when jsonb_typeof(public.users.permissions) = 'array' then public.users.permissions
              else '[]'::jsonb
            end
          ) with ordinality as element(value, ord)
        ) as mapped
        group by mapped.normalized_value
      ) as dedup
    )
    where jsonb_typeof(permissions) = 'array'
      and permissions @> '["view_agent_balances"]'::jsonb;
  end if;

  select c.udt_name
  into extra_pages_udt
  from information_schema.columns as c
  where c.table_schema = 'public'
    and c.table_name = 'users'
    and c.column_name = 'extra_pages';

  if extra_pages_udt = '_text' then
    update public.users
    set extra_pages = coalesce((
      select array_agg(dedup.normalized_value order by dedup.first_ord)
      from (
        select mapped.normalized_value, min(mapped.ord) as first_ord
        from (
          select
            case
              when element.value = 'Agent Balances' then 'Weekend Stock Summary'
              else element.value
            end as normalized_value,
            element.ord
          from unnest(coalesce(public.users.extra_pages, '{}'::text[])) with ordinality as element(value, ord)
        ) as mapped
        group by mapped.normalized_value
      ) as dedup
    ), '{}'::text[])
    where coalesce(public.users.extra_pages, '{}'::text[]) @> array['Agent Balances']::text[];
  elsif extra_pages_udt in ('json', 'jsonb') then
    update public.users
    set extra_pages = (
      select coalesce(
        jsonb_agg(to_jsonb(dedup.normalized_value) order by dedup.first_ord),
        '[]'::jsonb
      )
      from (
        select mapped.normalized_value, min(mapped.ord) as first_ord
        from (
          select
            case
              when element.value = 'Agent Balances' then 'Weekend Stock Summary'
              else element.value
            end as normalized_value,
            element.ord
          from jsonb_array_elements_text(
            case
              when jsonb_typeof(public.users.extra_pages) = 'array' then public.users.extra_pages
              else '[]'::jsonb
            end
          ) with ordinality as element(value, ord)
        ) as mapped
        group by mapped.normalized_value
      ) as dedup
    )
    where jsonb_typeof(extra_pages) = 'array'
      and extra_pages @> '["Agent Balances"]'::jsonb;
  end if;
end $$;
