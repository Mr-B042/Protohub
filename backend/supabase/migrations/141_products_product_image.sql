-- Product-level catalog image, editable in the product editor beside the "real
-- footage" image. Used as the fallback for the order form, the order confirmation,
-- and the cart-recovery message when a package has no image of its own. Kept SEPARATE
-- from whatsapp_footage_image_url (which is only the new-order extra photo).
alter table public.products
  add column if not exists image_url text;
