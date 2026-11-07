-- Customer Reviews, part 1 (Bright, 7 Nov 2026).
--
-- A rep sends a customer's review (written, photo or video) from the Products
-- & Stock "Upload media" window, linked to one of their DELIVERED orders. An
-- Owner, Admin or Manager approves it (a video can be judged Premium), and the
-- order's rep earns a bonus once per order at the highest level approved:
-- written 50, photo 100, video 200, premium video 400 (naira, editable). A
-- later, better review only pays the difference. The bonus is paid in the
-- rep's weekly report for the week of approval (and so in payroll).
--
--   customer_reviews            one row per review sent, with its consent ticks
--   customer_review_incentives  the bonus ledger: one row per amount paid
--   customer_review_events      who did what, when (the audit trail)
--   customer_review_settings    the four bonus amounts, per company
--
-- Files are ordinary product_media rows (same holding -> check -> approve
-- path) carrying review_id. A review without permission for marketing keeps
-- its files PRIVATE ('private' status, never copied to the public bucket).
--
-- The 59 reviews logged in Customer Retention (3 - 25 Aug 2026) are brought
-- in as approved "from before" reviews with no bonus (Bright, 7 Nov 2026).

create table if not exists public.customer_reviews (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  order_id text not null references public.orders(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  -- The order's rep: the one the bonus is paid to.
  rep_id uuid references public.users(id) on delete set null,
  rep_name text not null default '',
  submitted_by uuid references public.users(id) on delete set null,
  submitted_by_name text not null default '',
  submitted_by_role text not null default '',
  -- draft: files still being sent (never shown to approvers)
  -- pending: waiting for an Owner / Admin / Manager
  status text not null default 'draft' check (status in ('draft', 'pending', 'approved', 'rejected', 'changes_requested')),
  -- What the rep says it is.
  review_type text not null check (review_type in ('written', 'photo', 'video')),
  -- What it was approved as, and that level's amount when approved (old
  -- approvals keep their amount when the settings change).
  approved_level text check (approved_level in ('written', 'photo', 'video', 'premium')),
  level_amount numeric not null default 0,
  review_text text not null default '',
  rating smallint check (rating is null or rating between 1 and 5),
  channel text not null default 'whatsapp' check (channel in ('whatsapp', 'call', 'sms', 'in_person', 'other')),
  received_on date not null default current_date,
  complaint text not null default '',
  -- Null only on reviews brought over from Customer Retention (never asked).
  genuine_confirmed boolean,
  marketing_ok boolean not null default false,
  marketing_withdrawn_at timestamptz,
  reviewed_by uuid references public.users(id) on delete set null,
  reviewed_by_name text,
  reviewed_at timestamptz,
  decision_reason text,
  decision_note text,
  legacy_touchpoint_id uuid unique,
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customer_reviews_text_len check (char_length(review_text) <= 2000),
  constraint customer_reviews_complaint_len check (char_length(complaint) <= 1000),
  constraint customer_reviews_note_len check (decision_note is null or char_length(decision_note) <= 500)
);
create index if not exists customer_reviews_org_branch_status on public.customer_reviews (org_id, branch_id, status, created_at desc);
create index if not exists customer_reviews_order on public.customer_reviews (order_id);
create index if not exists customer_reviews_rep on public.customer_reviews (rep_id, status, created_at desc);
-- One review waiting per order at a time.
create unique index if not exists customer_reviews_one_waiting on public.customer_reviews (order_id) where status = 'pending';

drop trigger if exists customer_reviews_updated_at on public.customer_reviews;
create trigger customer_reviews_updated_at before update on public.customer_reviews
  for each row execute function public.set_updated_at();

-- The bonus ledger. Never changed or deleted: a correction is a new row.
create table if not exists public.customer_review_incentives (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  order_id text not null,
  review_id uuid,
  rep_id uuid,
  rep_name text not null default '',
  kind text not null default 'credit' check (kind in ('credit', 'reversal')),
  level text not null check (level in ('written', 'photo', 'video', 'premium')),
  -- What the order's reviews are worth after this row; amount is what this row pays.
  level_total numeric not null,
  amount numeric not null,
  -- The Sunday of the report week it is paid in (Lagos time).
  pay_week_start date not null,
  approved_by uuid,
  approved_by_name text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists customer_review_incentives_week on public.customer_review_incentives (org_id, branch_id, pay_week_start);
create index if not exists customer_review_incentives_order on public.customer_review_incentives (order_id);
create index if not exists customer_review_incentives_rep on public.customer_review_incentives (rep_id, pay_week_start);

create table if not exists public.customer_review_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  review_id uuid,
  order_id text,
  action text not null,
  from_status text,
  to_status text,
  amount_change numeric not null default 0,
  note text not null default '',
  actor_id uuid,
  actor_name text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists customer_review_events_review on public.customer_review_events (review_id, created_at);
create index if not exists customer_review_events_org_branch on public.customer_review_events (org_id, branch_id, created_at desc);

-- Nobody quietly changes what was paid or what happened. Deletes only come
-- from a whole branch being removed.
create or replace function public.customer_review_append_only()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if exists (select 1 from public.branches b where b.id = old.branch_id) then
      raise exception '% rows cannot be deleted', tg_table_name;
    end if;
    return old;
  end if;
  raise exception '% rows cannot be changed', tg_table_name;
end $$;

drop trigger if exists customer_review_incentives_append_only on public.customer_review_incentives;
create trigger customer_review_incentives_append_only before update or delete on public.customer_review_incentives
  for each row execute function public.customer_review_append_only();
drop trigger if exists customer_review_events_append_only on public.customer_review_events;
create trigger customer_review_events_append_only before update or delete on public.customer_review_events
  for each row execute function public.customer_review_append_only();

create table if not exists public.customer_review_settings (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  written_amount numeric not null default 50 check (written_amount between 0 and 100000),
  photo_amount numeric not null default 100 check (photo_amount between 0 and 100000),
  video_amount numeric not null default 200 check (video_amount between 0 and 100000),
  premium_amount numeric not null default 400 check (premium_amount between 0 and 100000),
  updated_by uuid references public.users(id) on delete set null,
  updated_by_name text not null default '',
  updated_at timestamptz not null default now()
);

-- Review files ride on the gallery's table.
alter table public.product_media add column if not exists review_id uuid references public.customer_reviews(id) on delete cascade;
alter table public.product_media add column if not exists review_part text check (review_part is null or review_part in ('content', 'consent'));
-- The same file sent twice: a hash of the photo, or of a video's start + size.
alter table public.product_media add column if not exists fingerprint text;
create index if not exists product_media_review on public.product_media (review_id) where review_id is not null;
create index if not exists product_media_fingerprint on public.product_media (org_id, fingerprint) where fingerprint is not null;
-- 'private': an approved review file kept out of the public gallery.
alter table public.product_media drop constraint if exists product_media_status_check;
alter table public.product_media add constraint product_media_status_check
  check (status in ('uploading', 'pending', 'approved', 'rejected', 'changes_requested', 'private'));

-- Approve (or move up to a higher level) and pay the difference, in one go.
-- The order's bonus is the highest approved level; whatever was already paid
-- for the order is taken off, so a photo then a video pays 100 + 100.
create or replace function public.approve_customer_review(
  p_review_id uuid, p_level text, p_actor uuid, p_actor_name text, p_note text default ''
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r public.customer_reviews%rowtype;
  s public.customer_review_settings%rowtype;
  v_levels text[] := array['written', 'photo', 'video', 'premium'];
  v_upgrade boolean;
  v_amount numeric;
  v_target numeric;
  v_paid numeric;
  v_credit numeric;
  v_week date;
  v_today date := (now() at time zone 'Africa/Lagos')::date;
begin
  if not (p_level = any (v_levels)) then raise exception 'bad_level'; end if;
  select * into r from public.customer_reviews where id = p_review_id for update;
  if not found then raise exception 'not_found'; end if;
  v_upgrade := r.status = 'approved';
  if r.status <> 'pending' and not v_upgrade then raise exception 'not_waiting'; end if;
  if v_upgrade and array_position(v_levels, p_level) <= coalesce(array_position(v_levels, r.approved_level), 0) then
    raise exception 'not_higher';
  end if;
  if r.legacy_touchpoint_id is not null then raise exception 'legacy'; end if;
  if not exists (select 1 from public.orders o where o.id = r.order_id and o.status::text = 'Delivered') then
    raise exception 'not_delivered';
  end if;

  select * into s from public.customer_review_settings where org_id = r.org_id;
  v_amount := case p_level
    when 'written' then coalesce(s.written_amount, 50)
    when 'photo' then coalesce(s.photo_amount, 100)
    when 'video' then coalesce(s.video_amount, 200)
    else coalesce(s.premium_amount, 400) end;

  -- One order's bonus is worked out one approval at a time.
  perform pg_advisory_xact_lock(hashtext('customer_review_bonus:' || r.order_id));

  update public.customer_reviews
     set status = 'approved', approved_level = p_level, level_amount = v_amount,
         reviewed_by = p_actor, reviewed_by_name = p_actor_name, reviewed_at = now(),
         decision_reason = null, decision_note = coalesce(nullif(btrim(coalesce(p_note, '')), ''), decision_note)
   where id = r.id;

  select coalesce(max(level_amount), 0) into v_target from public.customer_reviews
   where order_id = r.order_id and status = 'approved' and legacy_touchpoint_id is null;
  select coalesce(sum(amount), 0) into v_paid from public.customer_review_incentives where order_id = r.order_id;
  v_credit := greatest(v_target - v_paid, 0);
  v_week := v_today - extract(dow from v_today)::int;

  if v_credit > 0 then
    insert into public.customer_review_incentives
      (org_id, branch_id, order_id, review_id, rep_id, rep_name, kind, level, level_total, amount, pay_week_start, approved_by, approved_by_name)
    values (r.org_id, r.branch_id, r.order_id, r.id, r.rep_id, r.rep_name, 'credit', p_level, v_target, v_credit, v_week, p_actor, coalesce(p_actor_name, ''));
  end if;

  insert into public.customer_review_events (org_id, branch_id, review_id, order_id, action, from_status, to_status, amount_change, note, actor_id, actor_name)
  values (r.org_id, r.branch_id, r.id, r.order_id, case when v_upgrade then 'upgraded' else 'approved' end, r.status, 'approved', v_credit,
          concat_ws(' · ', 'Approved as ' || p_level, nullif(btrim(coalesce(p_note, '')), '')), p_actor, coalesce(p_actor_name, ''));

  return jsonb_build_object('credited', v_credit, 'levelTotal', v_target, 'paidBefore', v_paid, 'level', p_level,
                            'levelAmount', v_amount, 'payWeekStart', v_week, 'upgrade', v_upgrade);
end $$;
revoke all on function public.approve_customer_review(uuid, text, uuid, text, text) from public;
revoke all on function public.approve_customer_review(uuid, text, uuid, text, text) from anon, authenticated;
grant execute on function public.approve_customer_review(uuid, text, uuid, text, text) to service_role;

-- The API uses the service role. No client reads these tables directly.
alter table public.customer_reviews enable row level security;
alter table public.customer_review_incentives enable row level security;
alter table public.customer_review_events enable row level security;
alter table public.customer_review_settings enable row level security;

-- Customer Retention's reviews (3 - 25 Aug 2026): approved "from before", no bonus.
insert into public.customer_reviews (
  org_id, branch_id, order_id, product_id, rep_id, rep_name, submitted_by, submitted_by_name, submitted_by_role,
  status, review_type, approved_level, level_amount, review_text, rating, channel, received_on,
  genuine_confirmed, marketing_ok, reviewed_by_name, reviewed_at, decision_note, legacy_touchpoint_id, submitted_at, created_at
)
select t.org_id, o.branch_id, t.order_id, o.product_id, t.logged_by, coalesce(u.name, ''), t.logged_by, coalesce(u.name, ''), coalesce(u.role::text, ''),
       'approved', case when t.review_is_video then 'video' else 'written' end, case when t.review_is_video then 'video' else 'written' end, 0,
       left(btrim(coalesce(t.review_text, '')), 2000), t.review_rating,
       case t.review_source when 'whatsapp' then 'whatsapp' when 'phone' then 'call' else 'other' end,
       (t.logged_at at time zone 'Africa/Lagos')::date,
       null, coalesce(t.ad_permission_granted, false), 'Customer Retention', t.logged_at,
       'Logged in Customer Retention before reviews were approved. No bonus.', t.id, t.logged_at, t.logged_at
  from public.customer_retention_touchpoints t
  join public.orders o on o.id = t.order_id
  left join public.users u on u.id = t.logged_by
 where t.stage = 'review_referral' and t.review_collected = true and o.branch_id is not null
on conflict (legacy_touchpoint_id) do nothing;

insert into public.customer_review_events (org_id, branch_id, review_id, order_id, action, from_status, to_status, note, actor_name, created_at)
select r.org_id, r.branch_id, r.id, r.order_id, 'imported', null, 'approved', 'Brought over from Customer Retention (no bonus).', 'Protohub', now()
  from public.customer_reviews r
 where r.legacy_touchpoint_id is not null
   and not exists (select 1 from public.customer_review_events e where e.review_id = r.id and e.action = 'imported');
