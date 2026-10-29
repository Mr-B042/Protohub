-- 312: tracking_journey_counts without the disk sort.
--
-- The 280 version grouped 41k rows a month on 8 worked-out columns AND
-- counted distinct visits in the same step. Postgres sorted the full rows
-- for that, ran out of its 5 MB working memory and wrote ~58 MB to disk on
-- every Tracking Hub load (74 GB in three months; up to 8 s a call).
--
-- Same answer, two steps: pull out only the small fields once, drop
-- duplicate visits, then count. Checked on prod over 30 days: identical
-- rows (3,823) and visits (41,202), 1.4 s -> 0.8 s, nothing written to disk.

create or replace function public.tracking_journey_counts(p_org uuid, p_branch uuid, p_from timestamptz, p_to timestamptz)
returns table (
  day date, event_type text, product_id uuid, tracking_key text, domain text, path text, campaign_id text, ad_id text, visits bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with picked as (
    select
      (e.created_at at time zone 'Africa/Lagos')::date as day,
      e.event_type,
      e.product_id,
      e.metadata->>'metaTrackingKey' as tracking_key,
      coalesce(nullif(e.metadata->>'landingPageUrl', ''), e.metadata->>'referrer', '') as url,
      nullif(coalesce(nullif(e.metadata->>'campaignId', ''), e.metadata->>'utmId', ''), '') as campaign_id,
      nullif(coalesce(nullif(e.metadata->>'adId', ''), e.metadata->>'utmContent', ''), '') as ad_id,
      coalesce(nullif(e.metadata->>'visitId', ''), e.cart_id::text, e.id::text) as visit
    from public.cart_journey_events e
    where e.org_id = p_org
      and (p_branch is null or e.branch_id = p_branch)
      and e.created_at >= p_from and e.created_at <= p_to
      and e.event_type in ('form_opened', 'first_interaction', 'submit_attempted', 'redirect_triggered')
  ), visits as (
    select distinct
      day,
      event_type,
      product_id,
      nullif(lower(coalesce(tracking_key, '')), '') as tracking_key,
      nullif(regexp_replace(lower(split_part(split_part(url, '://', 2), '/', 1)), '^www\.', ''), '') as domain,
      nullif(regexp_replace(split_part(substring(split_part(url, '://', 2) from '/.*$'), '?', 1), '/+$', ''), '') as path,
      campaign_id,
      ad_id,
      visit
    from picked
  )
  select day, event_type, product_id, tracking_key, domain, path, campaign_id, ad_id, count(*) as visits
  from visits
  group by 1, 2, 3, 4, 5, 6, 7, 8;
$$;

revoke all on function public.tracking_journey_counts(uuid, uuid, timestamptz, timestamptz) from public;
revoke all on function public.tracking_journey_counts(uuid, uuid, timestamptz, timestamptz) from anon, authenticated;
grant execute on function public.tracking_journey_counts(uuid, uuid, timestamptz, timestamptz) to service_role;
