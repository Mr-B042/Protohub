-- Migration 014: RLS policies for tables that exist in prod but were
-- never given row-level security. Without these, any anon-key query
-- can read or write data across org boundaries.

-- ── sales_teams ───────────────────────────────────────────
alter table sales_teams enable row level security;

create policy "All org members see sales teams"
  on sales_teams for select
  using (org_id = auth_org_id());

create policy "Owner/Admin manage sales teams"
  on sales_teams for all
  using (org_id = auth_org_id() and auth_user_role() in ('Owner', 'Admin'));

-- ── rep_penalties ─────────────────────────────────────────
alter table rep_penalties enable row level security;

create policy "Owner/Admin see rep penalties"
  on rep_penalties for select
  using (org_id = auth_org_id() and auth_user_role() in ('Owner', 'Admin'));

create policy "Owner/Admin manage rep penalties"
  on rep_penalties for all
  using (org_id = auth_org_id() and auth_user_role() in ('Owner', 'Admin'));

-- ── push_subscriptions ────────────────────────────────────
alter table push_subscriptions enable row level security;

create policy "Users see own push subscriptions"
  on push_subscriptions for select
  using (org_id = auth_org_id() and user_id = auth.uid());

create policy "Users manage own push subscriptions"
  on push_subscriptions for all
  using (org_id = auth_org_id() and user_id = auth.uid());

-- ── email_settings ────────────────────────────────────────
alter table email_settings enable row level security;

create policy "Owner/Admin see email settings"
  on email_settings for select
  using (org_id = auth_org_id() and auth_user_role() in ('Owner', 'Admin'));

create policy "Owner/Admin manage email settings"
  on email_settings for all
  using (org_id = auth_org_id() and auth_user_role() in ('Owner', 'Admin'));

-- ── embed_settings ────────────────────────────────────────
alter table embed_settings enable row level security;

-- All authenticated org members can read embed settings (needed to render the form config)
create policy "All org members see embed settings"
  on embed_settings for select
  using (org_id = auth_org_id());

create policy "Owner/Admin manage embed settings"
  on embed_settings for all
  using (org_id = auth_org_id() and auth_user_role() in ('Owner', 'Admin'));

-- ── login_audit ───────────────────────────────────────────
alter table login_audit enable row level security;

create policy "Owner/Admin see login audit"
  on login_audit for select
  using (auth_user_role() in ('Owner', 'Admin'));

-- Service role inserts audit rows — no insert policy needed for anon
