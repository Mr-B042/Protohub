-- 188: Personal Delivery Agents - individuals who hold Protohub stock and
-- collect customer cash, as opposed to the registered logistics companies in
-- `agents`. Deliberately a SEPARATE set of tables, not a flag on `agents`:
-- the risks, permissions, verification and cash duties are different, and
-- mixing them would put KYC documents and guarantor records on every courier
-- company row.
--
-- This migration lays the whole module's foundation (agents, KYC checklist,
-- guarantors, documents) so the later slices - Applications & KYC, inventory,
-- COD, incidents - do not each need a schema change.

-- ── The agent ────────────────────────────────────────────
create table if not exists public.personal_delivery_agents (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null,
  agent_code          text not null,
  -- Optional link to a login once the agent gets portal access.
  user_id             uuid,

  full_name           text not null,
  phone               text not null,
  whatsapp_phone      text,
  email               text,
  date_of_birth       date,
  state               text,
  city                text,
  residential_address text,
  emergency_contact_name  text,
  emergency_contact_phone text,
  photo_url           text,

  -- An agent may cover several areas; radius is in km.
  service_areas       jsonb not null default '[]'::jsonb,
  service_radius_km   numeric,
  -- Never assume a motorcycle.
  transport_method    text,

  -- Controlled approval path. An agent must not hold stock or take orders
  -- until account_status = 'Approved', 'Probation' or 'Active'.
  account_status      text not null default 'Application Started',
  kyc_status          text not null default 'KYC Incomplete',
  trust_level         text not null default 'Probation',
  availability        text not null default 'Offline',

  -- Operational limits, tightened on probation and raised with trust.
  max_stock_units     integer,
  max_cod_exposure    numeric,
  max_active_orders   integer,
  working_days        jsonb not null default '[]'::jsonb,
  working_hours_start time,
  working_hours_end   time,
  allowed_product_ids jsonb not null default '[]'::jsonb,

  bank_name           text,
  bank_account_number text,
  bank_account_name   text,

  approved_at         timestamptz,
  approved_by         uuid,
  probation_ends_at   date,
  kyc_expires_at      date,
  restriction_reason  text,
  termination_reason  text,
  notes               text,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint pda_agent_code_unique unique (org_id, agent_code),
  constraint pda_account_status_valid check (account_status in (
    'Application Started','KYC Incomplete','KYC Submitted','Guarantor Verification Pending',
    'Management Review','Approved','Probation','Active','Rejected','Restricted',
    'Temporarily Suspended','KYC Expired','Cash Remittance Overdue','Inventory Discrepancy','Terminated'
  )),
  constraint pda_trust_level_valid check (trust_level in ('Probation','Verified','Trusted')),
  constraint pda_availability_valid check (availability in ('Available','Busy','Unavailable','Offline','Suspended'))
);

create index if not exists idx_pda_org_status on public.personal_delivery_agents (org_id, account_status);
create index if not exists idx_pda_org_availability on public.personal_delivery_agents (org_id, availability);
create index if not exists idx_pda_user on public.personal_delivery_agents (user_id);

-- ── KYC checklist ────────────────────────────────────────
-- One row per requirement, so approval is item-by-item and final approval can
-- be blocked until every mandatory item passes. A single "approve this person"
-- button is exactly what this table exists to prevent.
create table if not exists public.pda_kyc_items (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null,
  agent_id      uuid not null references public.personal_delivery_agents(id) on delete cascade,
  item_key      text not null,
  label         text not null,
  mandatory     boolean not null default true,
  status        text not null default 'Pending',
  file_url      text,
  reviewed_by   uuid,
  reviewed_at   timestamptz,
  review_note   text,
  rejection_reason text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint pda_kyc_item_unique unique (agent_id, item_key),
  constraint pda_kyc_status_valid check (status in
    ('Pending','Submitted','Approved','Rejected','Replacement Requested','Not Applicable'))
);

create index if not exists idx_pda_kyc_agent on public.pda_kyc_items (agent_id, status);

-- ── Guarantors ───────────────────────────────────────────
-- Two required, each verified independently. `guarantor_type` exists because
-- two close relatives are weak protection - the intended pairing is one family
-- guarantor plus one independently verifiable person (employer, landlord,
-- business owner, community leader).
create table if not exists public.pda_guarantors (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null,
  agent_id           uuid not null references public.personal_delivery_agents(id) on delete cascade,
  slot               integer not null,
  guarantor_type     text,
  full_name          text not null,
  relationship       text,
  phone              text not null,
  whatsapp_phone     text,
  address            text,
  occupation         text,
  id_document_url    text,
  photo_url          text,
  signed_form_url    text,
  consent_given      boolean not null default false,
  verification_status text not null default 'Not Contacted',
  verification_notes text,
  verified_by        uuid,
  verified_at        timestamptz,
  call_scheduled_at  timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint pda_guarantor_slot_unique unique (agent_id, slot),
  constraint pda_guarantor_slot_valid check (slot in (1, 2)),
  constraint pda_guarantor_type_valid check (guarantor_type is null or guarantor_type in ('Family','Independent')),
  constraint pda_guarantor_status_valid check (verification_status in (
    'Not Contacted','Call Scheduled','Reached','Confirmed','Information Mismatch',
    'Declined Responsibility','Unable to Verify','Approved','Rejected'
  ))
);

create index if not exists idx_pda_guarantor_agent on public.pda_guarantors (agent_id);

-- ── Signed agreements ────────────────────────────────────
-- Versioned: a re-issued agreement must not silently inherit the old approval.
create table if not exists public.pda_documents (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null,
  agent_id         uuid not null references public.personal_delivery_agents(id) on delete cascade,
  document_key     text not null,
  label            text not null,
  version          text not null default 'v1',
  issued_at        date,
  template_url     text,
  signed_file_url  text,
  uploaded_at      timestamptz,
  status           text not null default 'Not Uploaded',
  approved_by      uuid,
  approved_at      timestamptz,
  rejection_reason text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint pda_document_unique unique (agent_id, document_key, version),
  constraint pda_document_status_valid check (status in
    ('Not Uploaded','Uploaded','Approved','Rejected','Replacement Requested'))
);

create index if not exists idx_pda_document_agent on public.pda_documents (agent_id, status);

-- ── RLS ──────────────────────────────────────────────────
-- Same posture as the rest of Protohub: the API holds the service role and
-- scopes every query by org_id, so no anon/authenticated policy is granted.
-- KYC documents, guarantor records and bank details are the most sensitive
-- data in the system; leaving these tables closed by default is deliberate.
alter table public.personal_delivery_agents enable row level security;
alter table public.pda_kyc_items          enable row level security;
alter table public.pda_guarantors         enable row level security;
alter table public.pda_documents          enable row level security;
