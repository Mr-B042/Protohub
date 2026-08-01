-- 189: private storage for KYC media, plus the live-verification phrase.
--
-- ⚠️ Every existing Protohub bucket (package-images, product-videos,
-- retention-media) is PUBLIC, which is fine for product photos and quite wrong
-- for government IDs, selfies, bank documents and guarantor IDs - a public
-- bucket means anyone holding the URL can open someone's ID.
--
-- `pda-kyc` is private. The API uploads with the service role and hands out
-- short-lived signed URLs to management roles only, so a document is never
-- reachable by URL alone.
insert into storage.buckets (id, name, public, file_size_limit)
values ('pda-kyc', 'pda-kyc', false, 52428800)
on conflict (id) do update set public = false, file_size_limit = 52428800;

-- Live verification video.
--
-- An uploaded video proves very little on its own: it could have been recorded
-- months ago, or by somebody else entirely. Issuing a random phrase and asking
-- the applicant to say it, with their name and today's date, while showing
-- their face and ID, ties the recording to a specific moment and person.
-- The phrase is stored so the reviewer can check what was actually asked for.
alter table public.personal_delivery_agents
  add column if not exists verification_phrase text,
  add column if not exists verification_phrase_issued_at timestamptz;

comment on column public.personal_delivery_agents.verification_phrase is
  'Random phrase the applicant must say in their live verification video (migration 189). Re-issue invalidates any earlier recording.';
