-- Enforce case-insensitive uniqueness on organizations.name so two workspaces
-- can't register with the same display name (e.g. "Bright POD" vs "bright pod").
-- The backend register handler maps Postgres error code 23505 to a 409 response.

create unique index if not exists organizations_name_lower_idx
  on public.organizations (lower(name));
