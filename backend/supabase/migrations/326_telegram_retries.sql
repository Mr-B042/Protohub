-- Telegram: retry what did not go through (Bright, 6 Nov 2026, "fix all").
-- A message stuck at "sending" (the server restarted mid-send) or failed for
-- a passing reason (Telegram busy, network) is sent again from what was
-- saved here; one the person can never get (they blocked the bot) is not.

alter table public.telegram_messages add column if not exists payload jsonb;
alter table public.telegram_messages add column if not exists attempts integer not null default 1;
alter table public.telegram_messages add column if not exists retryable boolean not null default false;

create index if not exists telegram_messages_retry on public.telegram_messages (created_at)
  where status = 'sending' or (status = 'failed' and retryable);
