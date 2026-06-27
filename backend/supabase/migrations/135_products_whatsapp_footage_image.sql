-- Product-level "real footage" image sent as an EXTRA photo in the automated
-- new-order WhatsApp (after the invoice + the package's catalog image). One per
-- product, so it applies to every package without setting it package-by-package.
-- NULL = no extra footage photo.
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS whatsapp_footage_image_url text;
