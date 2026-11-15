-- Email results count only the customer's own orders (Bright, 15 Nov 2026: the
-- "You Left Something" email showed ₦39,500 for order 6107, which a rep created
-- from the cart). An order a rep created after the email is kept apart as
-- "Rep closed after the email".
alter table public.email_campaign_sends add column if not exists rep_order_id text;
alter table public.email_campaign_sends add column if not exists rep_converted_at timestamptz;

-- Existing credits that were rep-made orders move over (first history entry has a staff member).
update public.email_campaign_sends s
   set rep_order_id = s.order_id, rep_converted_at = s.converted_at, order_id = null, converted_at = null
 where s.order_id is not null
   and exists (
     select 1 from (select a.changed_by from public.order_audit a where a.order_id = s.order_id order by a.created_at limit 1) f
     where f.changed_by is not null);

drop function if exists public.email_campaign_stats(uuid[]);
create function public.email_campaign_stats(p_ids uuid[])
 returns table(campaign_id uuid, queued integer, sent integer, failed integer, skipped integer, opened integer, clicked integer, orders integer, delivered_orders integer, revenue numeric, unsubscribed integer, sent_a integer, opened_a integer, clicked_a integer, sent_b integer, opened_b integer, clicked_b integer, last_sent_at timestamp with time zone, rep_orders integer, rep_delivered_orders integer, rep_revenue numeric)
 language sql
 stable
as $function$
  with per as (
    select s.campaign_id, s.run_no, s.email,
      bool_or(s.status = 'sent') as was_sent,
      bool_or(s.status = 'queued') as is_queued,
      bool_or(s.status = 'failed') as did_fail,
      bool_or(s.status = 'skipped') as was_skipped,
      bool_or(s.first_opened_at is not null or s.first_clicked_at is not null) as did_open,
      bool_or(s.first_clicked_at is not null) as did_click,
      max(s.order_id) as order_id,
      max(s.rep_order_id) as rep_order_id,
      bool_or(s.unsubscribed_at is not null) as did_unsub,
      min(s.variant) as variant,
      max(s.sent_at) as sent_at
    from public.email_campaign_sends s
    where s.campaign_id = any(p_ids)
    group by s.campaign_id, s.run_no, s.email
  )
  select per.campaign_id,
    count(*) filter (where per.is_queued and not per.was_sent)::integer,
    count(*) filter (where per.was_sent)::integer,
    count(*) filter (where per.did_fail and not per.was_sent and not per.is_queued)::integer,
    count(*) filter (where per.was_skipped and not per.was_sent)::integer,
    count(*) filter (where per.was_sent and per.did_open)::integer,
    count(*) filter (where per.was_sent and per.did_click)::integer,
    count(*) filter (where per.order_id is not null)::integer,
    count(*) filter (where o.status = 'Delivered')::integer,
    coalesce(sum(o.amount) filter (where o.status = 'Delivered'), 0),
    count(*) filter (where per.did_unsub)::integer,
    count(*) filter (where per.was_sent and per.variant = 'a')::integer,
    count(*) filter (where per.was_sent and per.variant = 'a' and per.did_open)::integer,
    count(*) filter (where per.was_sent and per.variant = 'a' and per.did_click)::integer,
    count(*) filter (where per.was_sent and per.variant = 'b')::integer,
    count(*) filter (where per.was_sent and per.variant = 'b' and per.did_open)::integer,
    count(*) filter (where per.was_sent and per.variant = 'b' and per.did_click)::integer,
    max(per.sent_at),
    count(*) filter (where per.rep_order_id is not null)::integer,
    count(*) filter (where r.status = 'Delivered')::integer,
    coalesce(sum(r.amount) filter (where r.status = 'Delivered'), 0)
  from per
  left join public.orders o on o.id = per.order_id and coalesce(o.launch_stage, 'live') <> 'silent'
  left join public.orders r on r.id = per.rep_order_id and coalesce(r.launch_stage, 'live') <> 'silent'
  group by per.campaign_id
$function$;
revoke all on function public.email_campaign_stats(uuid[]) from public, anon, authenticated;
