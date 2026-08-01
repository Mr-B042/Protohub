-- 200: the fields the Add Agent form actually collects.
--
-- Onboarding previously captured only enough to make contact; everything else
-- arrived later during KYC. The intake form gathers identity up front, which
-- is better - a reviewer can start verifying the moment the record exists
-- rather than chasing the applicant for basics.
alter table public.personal_delivery_agents
  add column if not exists gender text,
  add column if not exists id_type text,
  add column if not exists id_number text,
  -- Two is the policy today, but a high-value agent may warrant three, and a
  -- referral from an existing trusted agent may warrant one.
  add column if not exists guarantors_required integer not null default 2;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'pda_guarantors_required_range') then
    alter table public.personal_delivery_agents
      add constraint pda_guarantors_required_range check (guarantors_required between 1 and 4);
  end if;
end $$;

comment on column public.personal_delivery_agents.id_number is
  'Government ID number. Sensitive - stripped from non-management API responses (migration 200).';

-- Where the agent prefers to collect stock from. Recorded at intake because it
-- decides which hub a transfer should be sent from later.
alter table public.personal_delivery_agents
  add column if not exists preferred_pickup_location text;
