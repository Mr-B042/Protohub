-- 195: file identity on uploaded KYC items and agreements.
--
-- Both tables stored only the storage PATH, which is a uuid - fine for
-- fetching, useless for a reviewer. The Document Review screen has to show
-- "gov_id_front.jpg · 425 KB", because a reviewer needs to see WHAT they are
-- opening (and spot a 12 KB "utility bill" that is obviously not one) before
-- they click.
alter table public.pda_kyc_items
  add column if not exists file_name text,
  add column if not exists file_size_bytes bigint;

alter table public.pda_documents
  add column if not exists file_name text,
  add column if not exists file_size_bytes bigint;

comment on column public.pda_kyc_items.file_size_bytes is
  'Shown to reviewers. A suspiciously small file is a signal in itself (migration 195).';
