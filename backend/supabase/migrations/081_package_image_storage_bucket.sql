-- Storage bucket for package images uploaded via the inventory editor.
-- Backend writes via service role; public can read so the live order form
-- can render images without an extra auth round-trip.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'package-images',
  'package-images',
  true,
  10485760, -- 10 MB per file
  array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Anyone can fetch the rendered image URL (matches the public-bucket flag).
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'package-images public read'
  ) then
    create policy "package-images public read" on storage.objects
      for select
      using (bucket_id = 'package-images');
  end if;
end $$;

-- Authenticated org members can upload (used as a fallback path; in normal
-- flow the backend uploads via service role and skips RLS entirely).
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'package-images authenticated insert'
  ) then
    create policy "package-images authenticated insert" on storage.objects
      for insert
      to authenticated
      with check (bucket_id = 'package-images');
  end if;
end $$;

-- Authenticated users can replace or delete their own uploads (matches
-- common Supabase Storage owner-based pattern).
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'package-images owner update'
  ) then
    create policy "package-images owner update" on storage.objects
      for update
      to authenticated
      using (bucket_id = 'package-images' and owner = auth.uid())
      with check (bucket_id = 'package-images' and owner = auth.uid());
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'package-images owner delete'
  ) then
    create policy "package-images owner delete" on storage.objects
      for delete
      to authenticated
      using (bucket_id = 'package-images' and owner = auth.uid());
  end if;
end $$;
