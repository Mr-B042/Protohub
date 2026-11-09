/**
 * The business's logo and name for email previews (Bright, 9 Nov 2026: every
 * email shows the brand). Filled when the email designer data loads; the
 * preview frame and template cards read it.
 */
let current: { name: string; logoUrl: string | null } = { name: "", logoUrl: null };
export const setEmailBrand = (brand: { name: string; logoUrl: string | null }) => { current = { name: brand.name, logoUrl: brand.logoUrl }; };
export const emailBrandNow = () => current;
