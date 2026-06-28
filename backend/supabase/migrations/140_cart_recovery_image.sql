-- Optional dedicated image for the WhatsApp abandoned-cart recovery message.
-- When set, it's used instead of the cart's package image (e.g. a "you forgot
-- this 👀" creative). NULL = fall back to the package image.
alter table public.whatsapp_settings
  add column if not exists cart_recovery_image_url text;
