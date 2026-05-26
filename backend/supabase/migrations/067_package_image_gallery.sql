alter table public.product_packages
  add column if not exists image_urls text[] not null default '{}';
update public.product_packages
set image_urls = array[image_url]
where coalesce(array_length(image_urls, 1), 0) = 0
  and image_url is not null
  and btrim(image_url) <> '';
