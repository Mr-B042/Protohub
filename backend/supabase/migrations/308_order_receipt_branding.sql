-- Order receipt (Bright's design, 20 Oct 2026): the tagline and the "Need
-- Help? Chat with us on WhatsApp" number printed on every receipt image. The
-- Owner / an Admin sets them once on the receipt screen. The brand name and
-- logo come from the existing organizations.name / logo_url (same as the PDF
-- receipt). Additive only.

alter table public.organizations
  add column if not exists receipt_tagline text,
  add column if not exists receipt_help_phone text;
