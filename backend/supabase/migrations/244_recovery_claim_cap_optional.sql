-- 244: make the Recovery Rep open-claim ceiling optional, and lift it.
--
-- Bright: "remove limit from the recovery rep".
--
-- 205 introduced max_open_claims to stop one rep hoarding the candidate pool,
-- and documented 0 as "disables claiming". That reading was never shared by
-- the rest of the code: atClaimCap() in lib/recovery-calendar.ts has always
-- treated claimCap <= 0 as NO CAP. So the two halves of the feature disagreed,
-- and there was no value that meant "run without a ceiling" - only 20, or a
-- number that switched claiming off entirely.
--
-- 0 now means UNLIMITED everywhere. Setting a positive number reinstates the
-- ceiling, which is the only way back: there is still no settings UI for this
-- column, so it is changed here or by SQL.
alter table public.recovery_rep_kpi_settings
  alter column max_open_claims set default 0;

update public.recovery_rep_kpi_settings
  set max_open_claims = 0,
      updated_at = now()
  where max_open_claims > 0;

comment on column public.recovery_rep_kpi_settings.max_open_claims is
  'Maximum orders a Recovery Rep may hold that are not yet Delivered/Cancelled/Failed. 0 means unlimited (no ceiling). Set a positive number to reinstate the anti-hoarding cap from migration 205.';
