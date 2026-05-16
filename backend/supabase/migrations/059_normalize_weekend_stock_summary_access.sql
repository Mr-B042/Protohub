-- Normalize legacy Weekend Stock Summary access names stored on users.
-- This rewrites:
-- - permission: "view_agent_balances" -> "view_weekend_stock_summary"
-- - page:       "Agent Balances"      -> "Weekend Stock Summary"
-- It also deduplicates the arrays while preserving first-seen order.

update users
set permissions = (
  select coalesce(
    jsonb_agg(to_jsonb(dedup.normalized_value) order by dedup.first_ord),
    '[]'::jsonb
  )
  from (
    select normalized_value, min(ord) as first_ord
    from (
      select
        case
          when value = 'view_agent_balances' then 'view_weekend_stock_summary'
          else value
        end as normalized_value,
        ord
      from jsonb_array_elements_text(
        case
          when jsonb_typeof(users.permissions) = 'array' then users.permissions
          else '[]'::jsonb
        end
      ) with ordinality as element(value, ord)
    ) mapped
    group by normalized_value
  ) dedup
)
where jsonb_typeof(permissions) = 'array'
  and permissions @> '["view_agent_balances"]'::jsonb;

update users
set extra_pages = (
  select coalesce(
    jsonb_agg(to_jsonb(dedup.normalized_value) order by dedup.first_ord),
    '[]'::jsonb
  )
  from (
    select normalized_value, min(ord) as first_ord
    from (
      select
        case
          when value = 'Agent Balances' then 'Weekend Stock Summary'
          else value
        end as normalized_value,
        ord
      from jsonb_array_elements_text(
        case
          when jsonb_typeof(users.extra_pages) = 'array' then users.extra_pages
          else '[]'::jsonb
        end
      ) with ordinality as element(value, ord)
    ) mapped
    group by normalized_value
  ) dedup
)
where jsonb_typeof(extra_pages) = 'array'
  and extra_pages @> '["Agent Balances"]'::jsonb;
