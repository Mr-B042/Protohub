-- Public bucket for short product/usage videos (e.g. the WhatsApp upsell clip).
-- 50 MB cap, video mimes only. Uploaded server-side via the service role; public
-- read because the bucket is public.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-videos', 'product-videos', true, 52428800, array['video/mp4', 'video/webm', 'video/quicktime'])
on conflict (id) do nothing;
