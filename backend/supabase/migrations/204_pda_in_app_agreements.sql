-- 204: Personal Delivery Agent legal agreements are accepted in-app.
--
-- The six agreements were originally duplicated as KYC upload rows and as
-- pda_documents. Applicants could not meaningfully complete those KYC rows,
-- so they stayed Pending forever. Agreements now live only in pda_documents;
-- the exact accepted text and electronic-signature evidence are immutable in
-- pda_agreement_acceptances. Management approval remains a separate step.

alter table public.pda_documents
  drop constraint if exists pda_document_status_valid;

alter table public.pda_documents
  add constraint pda_document_status_valid check (status in (
    'Awaiting Acceptance','Electronically Accepted','Not Uploaded','Uploaded',
    'Approved','Rejected','Replacement Requested'
  ));

create table if not exists public.pda_agreement_acceptances (
  id                       uuid primary key default gen_random_uuid(),
  org_id                   uuid not null,
  agent_id                 uuid not null references public.personal_delivery_agents(id) on delete cascade,
  document_id              uuid not null references public.pda_documents(id) on delete cascade,
  document_key             text not null,
  version                  text not null,
  company_name_snapshot    text not null,
  applicant_name_snapshot  text not null,
  application_reference    text not null,
  typed_name               text not null,
  declaration_text         text not null,
  content_hash             text not null,
  agreement_snapshot       jsonb not null,
  source_ip                text,
  user_agent               text,
  accepted_at              timestamptz not null default now(),
  superseded_at            timestamptz,
  constraint pda_acceptance_hash_format check (content_hash ~ '^[a-f0-9]{64}$')
);

create index if not exists idx_pda_acceptance_agent
  on public.pda_agreement_acceptances (agent_id, accepted_at desc);
create index if not exists idx_pda_acceptance_document
  on public.pda_agreement_acceptances (document_id, accepted_at desc);
create unique index if not exists idx_pda_acceptance_current_unique
  on public.pda_agreement_acceptances (document_id, version, content_hash)
  where superseded_at is null;

alter table public.pda_agreement_acceptances enable row level security;

-- Existing applicants need a private way back to the acceptance page, even if
-- their application was created internally before status links existed.
update public.personal_delivery_agents
set status_token = replace(gen_random_uuid()::text, '-', '')
where status_token is null;

-- Remove the duplicate upload checklist entries. The agreement document and
-- its acceptance record now form the one source of truth.
delete from public.pda_kyc_items
where item_key in (
  'agent_agreement','inventory_agreement','cod_agreement','loss_damage_form',
  'confidentiality_agreement','termination_agreement'
);

-- A guarantor is verified through the dedicated guarantor workflow. An
-- applicant cannot sign a guarantor's responsibility form on their behalf.
delete from public.pda_documents where document_key = 'guarantor_form';

-- Keep approved/uploaded legacy agreements as historical evidence. Only
-- outstanding agreement rows move to the new in-app acceptance version.
update public.pda_documents
set version = '2026.08',
    status = 'Awaiting Acceptance',
    issued_at = coalesce(issued_at, current_date),
    updated_at = now()
where document_key in (
  'agent_agreement','inventory_agreement','cod_agreement','loss_damage_form',
  'confidentiality_agreement','termination_agreement'
)
and status in ('Not Uploaded','Rejected','Replacement Requested');

-- Seed a missing agreement for every existing agent without creating a second
-- row for a key that already has legacy signed evidence.
with required(document_key, label) as (values
  ('agent_agreement', 'Personal Delivery Agent Agreement'),
  ('inventory_agreement', 'Inventory Custody Agreement'),
  ('cod_agreement', 'COD Collection & Remittance Agreement'),
  ('loss_damage_form', 'Loss & Damage Responsibility Form'),
  ('confidentiality_agreement', 'Data & Customer Confidentiality Agreement'),
  ('termination_agreement', 'Termination & Stock Recovery Agreement')
)
insert into public.pda_documents (
  org_id, agent_id, document_key, label, version, issued_at, status
)
select agent.org_id, agent.id, required.document_key, required.label,
       '2026.08', current_date, 'Awaiting Acceptance'
from public.personal_delivery_agents agent
cross join required
where not exists (
  select 1 from public.pda_documents existing
  where existing.agent_id = agent.id
    and existing.document_key = required.document_key
);

comment on table public.pda_agreement_acceptances is
  'Immutable applicant acceptance evidence: exact agreement snapshot, hash, typed signature, time and technical audit context.';
