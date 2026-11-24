-- Cart call alerts (Bright, 24 Nov 2026: "most of them don't call their
-- abandoned cart early").
--
-- One row per alert already sent, so the every-2-minutes job never sends the
-- same one twice:
--   stage 'remind'   rep, cart not called at the call time (10 working min)
--   stage 'escalate' rep + Head of Sales, at twice the call time
--   stage 'hour'     rep + Head of Sales, after an hour
--   stage 'chase:morning:YYYY-MM-DD' / 'chase:afternoon:YYYY-MM-DD'
--                    the 9am / 2pm chase (cart_id = 'rep' for the rep's own
--                    alert, 'hos' for the Head of Sales summary)
-- A cart handed to another rep starts again for the new rep (rep_id is in the key).

create table if not exists public.cart_call_alerts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete cascade,
  cart_id text not null,
  rep_id uuid not null,
  stage text not null,
  sent_at timestamptz not null default now()
);
create unique index if not exists cart_call_alerts_once
  on public.cart_call_alerts (org_id, cart_id, rep_id, stage);

alter table public.cart_call_alerts enable row level security;
