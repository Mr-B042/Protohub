-- Agent Access (redesigned Portal Access) for Personal Delivery Agents.
--
-- Three things this page needs that the schema could not answer:
--
-- 1. WHO a login attempt belonged to. `login_audit` only stored an email, and
--    the Login History tab has to survive the switch to phone-based usernames
--    (an agent's login email changes, so joining history on email would lose
--    their past sign-ins). Store the user id alongside it.
-- 2. WHAT DEVICE signed in. The tab shows device/agent per attempt.
-- 3. WHETHER 2FA is required of someone. Supabase records enrolled factors in
--    auth.mfa_factors, but nothing records that management has ASKED an agent
--    to enrol - which is the half an admin screen controls.
--
-- Portal Access state itself deliberately needs NO new column. It is derived:
-- no linked user = Setup Required, linked + users.active = Active, linked +
-- users.active false = Blocked. That keeps agent status and portal access as
-- genuinely separate axes (the core idea of the redesign) without inventing a
-- second source of truth that could drift from the one that actually gates
-- sign-in.

alter table login_audit add column if not exists user_id uuid references users(id) on delete set null;
alter table login_audit add column if not exists user_agent text;

-- History is always read as "this user, newest first".
create index if not exists login_audit_user_id_created_at_idx
  on login_audit (user_id, created_at desc);

-- Email lookup still backs the pre-switch history and failed attempts, which
-- have no user id because the sign-in never resolved to an account.
create index if not exists login_audit_email_created_at_idx
  on login_audit (lower(email), created_at desc);

alter table users add column if not exists two_factor_required boolean not null default false;

comment on column login_audit.user_id is
  'Resolved account for this attempt. Null for failed sign-ins where the email matched no user.';
comment on column users.two_factor_required is
  'Management has required 2FA for this account. Actual enrolment lives in auth.mfa_factors.';

-- The Set Up modal offers "Require password change on first login". Supabase
-- has no such concept, so it is ours: the flag is set when management issues a
-- temporary password and cleared the moment the agent sets their own.
alter table users add column if not exists must_change_password boolean not null default false;

comment on column users.must_change_password is
  'Issued a temporary password. The portal forces a change before anything else.';

-- "Sign Out All Devices". The admin auth API can only revoke a session it has
-- the JWT for, and management never holds an agent's token, so revocation has
-- to happen against the auth tables directly. Security definer because the
-- service role must not be handed blanket write access to the auth schema.
create or replace function public.revoke_user_sessions(target_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = auth, public
as $$
declare
  removed integer;
begin
  delete from auth.refresh_tokens where user_id = target_user_id::text;
  get diagnostics removed = row_count;
  delete from auth.sessions where user_id = target_user_id;
  return removed;
end;
$$;

-- Only the backend may call this. Left reachable by anon or authenticated it
-- would let any signed-in user force-log-out anyone whose id they can guess.
revoke all on function public.revoke_user_sessions(uuid) from public;
revoke all on function public.revoke_user_sessions(uuid) from anon;
revoke all on function public.revoke_user_sessions(uuid) from authenticated;
grant execute on function public.revoke_user_sessions(uuid) to service_role;

-- Move existing Delivery Agent logins onto their phone number.
--
-- Only one account exists at the time of writing (Steve, PDA-00009) and it has
-- never been signed into, so there is no session to break and no password
-- anyone remembers. Written as a general backfill rather than a one-off id so
-- it is correct whenever it runs.
--
-- Deliberately conservative: it touches ONLY accounts whose phone is already a
-- clean 11-digit Nigerian mobile and whose target address is not taken. Any
-- agent with a malformed or shared number is left exactly as they are, to be
-- fixed on their profile and re-issued through Agent Access - silently
-- rewriting a login to a guessed number would lock someone out.
do $$
declare
  target record;
  new_email text;
begin
  for target in
    select u.id, u.email, u.phone
    from public.users u
    where u.role::text = 'Delivery Agent'
      and u.email not like '%@pda.protohub.invalid'
      and u.phone ~ '^0\d{10}$'
  loop
    new_email := target.phone || '@pda.protohub.invalid';
    if exists (select 1 from auth.users where lower(email) = new_email) then
      continue;
    end if;

    update auth.users set email = new_email, updated_at = now() where id = target.id;
    -- GoTrue keeps a second copy of the address on the identity row; leaving it
    -- behind makes the account inconsistent with itself.
    -- identities.email is a GENERATED column off identity_data, so the JSON is
    -- the only thing that may be written; the column follows on its own.
    update auth.identities
      set identity_data = jsonb_set(identity_data, '{email}', to_jsonb(new_email)),
          updated_at = now()
      where user_id = target.id and provider = 'email';
    update public.users
      set email = new_email,
          -- Their old password is unusable/unknown, so the next one issued is
          -- temporary by definition.
          must_change_password = true
      where id = target.id;
  end loop;
end $$;
