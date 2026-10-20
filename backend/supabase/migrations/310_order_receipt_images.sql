-- Order receipt pictures shared as a link (Bright, 20 Oct 2026). The Protohub
-- Android app runs the web app inside a WebView that cannot open the phone's
-- share sheet or save a file, so there the receipt PNG is uploaded here and the
-- customer gets a short link to it. Private bucket: files are served only by
-- /api/public/receipts/<random id>.
insert into storage.buckets (id, name, public)
values ('order-receipts', 'order-receipts', false)
on conflict (id) do nothing;
