// ⚠️ TWO COPIES: backend/src/lib/email-render.ts and src/lib/email-render.ts
// must stay byte-for-byte the same (email-render.test.ts checks). The browser
// draws its previews with the exact HTML the server sends, so what Bright sees
// in the editor is what the customer gets.
//
// Email Marketing (Bright, 8 Nov 2026): an email is a list of blocks plus a
// few styles. This file turns that into email HTML (tables and inline styles,
// the only layout every email app shows the same) and a plain-text copy.

export type Align = "left" | "center" | "right";

export type EmailStyles = {
  backgroundColor: string;
  contentColor: string;
  brandColor: string;
  accentColor: string;
  textColor: string;
  fontFamily: string;
  radius: number;
};

export type FeatureItem = { icon: string; title: string };

export type EmailBlock =
  | { id: string; type: "header"; brand: string; tagline: string; align: Align }
  | { id: string; type: "hero"; title: string; highlight: string; subtitle: string; badgeTop: string; badgeMain: string; badgeBottom: string; imageUrl: string; buttonText: string; buttonLink: string }
  | { id: string; type: "text"; text: string; size: number; align: Align; color: string; bold: boolean }
  | { id: string; type: "image"; url: string; alt: string; link: string; width: number }
  | { id: string; type: "button"; text: string; link: string; style: "primary" | "secondary" | "link"; size: "small" | "medium" | "large"; align: Align; color: string; textColor: string; radius: number; theirs?: boolean }
  | { id: string; type: "product"; productId: string; name: string; price: string; imageUrl: string; buttonText: string; link: string; theirs?: boolean }
  | { id: string; type: "offer"; top: string; main: string; bottom: string; color: string; textColor: string }
  | { id: string; type: "divider"; color: string; thickness: number }
  | { id: string; type: "spacer"; height: number }
  | { id: string; type: "social"; facebook: string; instagram: string; tiktok: string; whatsapp: string; align: Align }
  | { id: string; type: "timer"; endsAt: string; label: string }
  | { id: string; type: "video"; url: string; thumbnailUrl: string; caption: string }
  | { id: string; type: "review"; reviewId: string; quote: string; name: string; productName: string }
  | { id: string; type: "html"; html: string }
  | { id: string; type: "features"; items: FeatureItem[] }
  | { id: string; type: "footer"; text: string }
  // Cover (Templates design, 8 Nov 2026): soft colour, centred headline, a line, a picture or emoji, a button.
  | { id: string; type: "cover"; title: string; subtitle: string; imageUrl: string; emoji: string; buttonText: string; buttonLink: string; buttonTone: "yellow" | "purple"; tone: CoverTone; big?: boolean; theirs?: boolean };

/** The cover's soft background (top and bottom of the fade). */
export const COVER_TONES = {
  mint: ["#ECFDF3", "#D9F7E5"], lavender: ["#F6F3FF", "#E6DEFF"], peach: ["#FFF5EC", "#FFE3CC"], pink: ["#FFF1F3", "#FFDDE3"],
  sky: ["#F1F6FF", "#DDE8FF"], teal: ["#ECFDFB", "#CFF5EF"], lilac: ["#FBF2FF", "#EED9FF"], butter: ["#FEFCE8", "#FEF3C7"]
} as const;
export type CoverTone = keyof typeof COVER_TONES;

export type EmailBlockType = EmailBlock["type"];

export type EmailDesign = {
  version: 1;
  template: string;
  /** False until someone edits the design itself; until then the setup step may rebuild it. */
  touched: boolean;
  styles: EmailStyles;
  blocks: EmailBlock[];
};

/** What the setup step knows, used to fill a template. */
export type CampaignFields = {
  brand: string;
  goal: string;
  offerType: string;
  productId: string;
  productName: string;
  productImage: string;
  productLink: string;
  productPrice: string;
  offerOn: boolean;
  offerTitle: string;
  offerBenefit: string;
};

/**
 * Brand colours, read from the Protohub logo (Bright, 9 Nov 2026: "our
 * branding colour is from our logo colour"): charcoal, sky blue, light grey.
 */
export const BRAND_PALETTE = { charcoal: "#26262E", blue: "#2A98DE", blueDark: "#1F7FC0", mist: "#EEF5FC", page: "#F2F4F7" } as const;
/** The first colours (purple, yellow, lavender page): emails made with them get the brand colours when drawn. */
const OLD_DEFAULTS: Record<string, string> = { "#5b3fd9": BRAND_PALETTE.charcoal, "#ffc107": BRAND_PALETTE.blue, "#f4f2fb": BRAND_PALETTE.page };
export const brandColorOf = (value: string | undefined) => (value && OLD_DEFAULTS[value.trim().toLowerCase()]) || value || "";

export const DEFAULT_STYLES: EmailStyles = {
  backgroundColor: BRAND_PALETTE.page,
  contentColor: "#FFFFFF",
  brandColor: BRAND_PALETTE.charcoal,
  accentColor: BRAND_PALETTE.blue,
  textColor: "#1F2937",
  fontFamily: "Arial, Helvetica, sans-serif",
  radius: 16
};

export const FONT_CHOICES = [
  { label: "Arial", value: "Arial, Helvetica, sans-serif" },
  { label: "Helvetica", value: "Helvetica, Arial, sans-serif" },
  { label: "Verdana", value: "Verdana, Geneva, sans-serif" },
  { label: "Trebuchet", value: "'Trebuchet MS', Arial, sans-serif" },
  { label: "Georgia", value: "Georgia, 'Times New Roman', serif" }
];

/** Emoji draw in every email app; drawn icons (SVG) are stripped by Gmail. */
export const FEATURE_ICONS: Record<string, string> = {
  sparkles: "✨", shield: "🛡️", layers: "🧩", truck: "🚚", cash: "💵", star: "⭐", heart: "❤️", check: "✅", clock: "⏰", gift: "🎁", home: "🏠", broom: "🧹"
};

let idCounter = 0;
export function blockId() {
  idCounter = (idCounter + 1) % 1_000_000;
  return `b${Date.now().toString(36)}${idCounter.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

const GOAL_HEADLINES: Record<string, { title: string; highlight: string; subtitle: string; button: string; body: string }> = {
  retention: { title: "We Miss", highlight: "You Already", subtitle: "Come back for something new", button: "Shop Again", body: "Thank you for shopping with us. Here is something we picked for you, delivered to your door and paid for on delivery." },
  upsell: { title: "Time To", highlight: "Upgrade", subtitle: "Get more value with", button: "Upgrade & Save Now", body: "You already love what you bought from us. Take it to the next level with this pick, delivered to your door and paid for on delivery." },
  promotion: { title: "A Special", highlight: "Offer For You", subtitle: "For a short time only on", button: "Get The Offer", body: "As one of our customers you get this offer first. Order now and pay when it arrives." },
  launch: { title: "Just", highlight: "Arrived", subtitle: "Be the first to get", button: "See It Now", body: "We just added something new and we think you will like it. Order today and pay on delivery." },
  cart: { title: "You Left", highlight: "Something Behind", subtitle: "Your order is waiting:", button: "Finish My Order", body: "You started an order but did not finish. It only takes a minute, and you pay when it arrives." },
  winback: { title: "It's Been", highlight: "A While", subtitle: "Here is a reason to come back:", button: "Come Back & Save", body: "We have not seen you in a while. Here is a little something to welcome you back." },
  appreciation: { title: "Thank You", highlight: "For Choosing Us", subtitle: "A small thank-you on", button: "See Your Gift", body: "Thank you for trusting us with your home. Here is a small thank-you from all of us." },
  announcement: { title: "Some", highlight: "Good News", subtitle: "An update about", button: "Read More", body: "We have an update we wanted you to hear first." }
};

export const TEMPLATE_CHOICES = [
  { key: "product_promo", label: "Product Promo" },
  { key: "upsell_offer", label: "Upsell Offer" },
  { key: "win_back", label: "Win-Back" },
  { key: "simple_message", label: "Simple Message" }
];

/** The design a template gives for the setup step's answers. */
export function buildTemplateDesign(template: string, fields: CampaignFields): EmailDesign {
  const words = GOAL_HEADLINES[fields.goal] ?? GOAL_HEADLINES.upsell;
  const product = fields.productName.trim();
  const offerOn = fields.offerOn && (fields.offerTitle.trim() || fields.offerBenefit.trim());
  const benefit = fields.offerBenefit.trim();
  const badge = splitBadge(benefit);
  const buttonText = offerOn && fields.offerTitle.trim() ? `${fields.offerTitle.trim()} Now` : words.button;
  const header: EmailBlock = { id: blockId(), type: "header", brand: fields.brand || "Our Store", tagline: "Smart Home • Kitchen • Lifestyle", align: "center" };
  const greeting: EmailBlock = { id: blockId(), type: "text", text: "Hi {{First Name}},", size: 20, align: "left", color: "", bold: true };
  const body: EmailBlock = {
    id: blockId(), type: "text", size: 15, align: "left", color: "", bold: false,
    text: product ? words.body.replace("this pick", `the ${product}`) : words.body
  };
  // Safe, true-for-every-order points; edit them per product in Design Email.
  const features: EmailBlock = {
    id: blockId(), type: "features",
    items: [{ icon: "cash", title: "Pay On Delivery" }, { icon: "truck", title: "Delivered To Your Door" }, { icon: "check", title: "Easy To Order" }]
  };
  const button: EmailBlock = {
    id: blockId(), type: "button", text: `${buttonText} →`, link: fields.productLink, style: "primary", size: "large", align: "center",
    color: DEFAULT_STYLES.accentColor, textColor: "#1F1147", radius: 10
  };
  const footer: EmailBlock = { id: blockId(), type: "footer", text: "Pay on Delivery | Delivered to Your Door" };
  const hero: EmailBlock = {
    id: blockId(), type: "hero", title: words.title, highlight: words.highlight,
    subtitle: product ? `${words.subtitle} ${product}` : words.subtitle,
    badgeTop: offerOn ? badge.top : "", badgeMain: offerOn ? badge.main : "", badgeBottom: offerOn ? badge.bottom : "",
    imageUrl: fields.productImage, buttonText: `${buttonText} →`, buttonLink: fields.productLink
  };
  let blocks: EmailBlock[];
  if (template === "simple_message") {
    blocks = [header, greeting, body, button, footer];
  } else if (template === "win_back") {
    const winback = GOAL_HEADLINES.winback;
    blocks = [header, { ...hero, title: winback.title, highlight: winback.highlight, subtitle: product ? `${winback.subtitle} ${product}` : winback.subtitle } as EmailBlock, greeting,
      { ...body, text: winback.body } as EmailBlock, button, footer];
  } else if (template === "upsell_offer") {
    const productBlock: EmailBlock = { id: blockId(), type: "product", productId: fields.productId, name: product || "Your product", price: fields.productPrice, imageUrl: fields.productImage, buttonText: words.button, link: fields.productLink };
    blocks = [header, greeting, body, productBlock, ...(offerOn ? [{ id: blockId(), type: "offer", top: badge.top, main: badge.main, bottom: badge.bottom, color: DEFAULT_STYLES.accentColor, textColor: "#1F1147" } as EmailBlock] : []), features, button, footer];
  } else {
    blocks = [header, hero, greeting, body, features, button, footer];
  }
  return { version: 1, template, touched: false, styles: { ...DEFAULT_STYLES }, blocks };
}

/** "Up to 15% OFF" → Up to / 15% / OFF for the round badge. */
export function splitBadge(text: string) {
  const value = text.trim();
  const match = value.match(/^(.*?)(₦?\s?[\d,.]+\s?%?|₦\s?[\d,.]+k?)(.*)$/i);
  if (!match) return { top: "", main: value.slice(0, 10), bottom: "" };
  return { top: match[1].trim(), main: match[2].replace(/\s+/g, ""), bottom: match[3].trim() };
}

// ── Ready-made templates (Templates tab, Bright's design, 8 Nov 2026) ─

export const TEMPLATE_CATEGORIES = [
  { key: "promotional", label: "Promotional" }, { key: "retention", label: "Retention & Win-Back" }, { key: "post_purchase", label: "Post-Purchase" },
  { key: "cart", label: "Abandoned Cart" }, { key: "welcome", label: "Welcome Series" }, { key: "launch", label: "Product Launch" },
  { key: "reengagement", label: "Re-Engagement" }, { key: "announcement", label: "Announcements" }, { key: "seasonal", label: "Seasonal & Event" }
] as const;
/** What a template is mainly for (Create Custom Template, step 1). */
export const TEMPLATE_TYPES = ["promotional", "retention", "transactional", "announcement"] as const;
export type TemplateType = (typeof TEMPLATE_TYPES)[number];

type Starter = { key: string; name: string; hint: string; category: string; type: TemplateType; layout: string; subject: string; preheader: string; build: (f: CampaignFields) => EmailBlock[] };

const B = {
  header: (f: CampaignFields): EmailBlock => ({ id: blockId(), type: "header", brand: f.brand || "Our Store", tagline: "Smart Home • Kitchen • Lifestyle", align: "center" }),
  text: (text: string, size = 15, bold = false, align: Align = "left"): EmailBlock => ({ id: blockId(), type: "text", text, size, align, color: "", bold }),
  button: (f: CampaignFields, text: string, link = f.productLink): EmailBlock => ({
    id: blockId(), type: "button", text: `${text} →`, link, style: "primary", size: "large", align: "center", color: DEFAULT_STYLES.accentColor, textColor: "#1F1147", radius: 10
  }),
  product: (f: CampaignFields, button: string): EmailBlock => ({ id: blockId(), type: "product", productId: f.productId, name: f.productName || "Your product", price: f.productPrice, imageUrl: f.productImage, buttonText: button, link: f.productLink }),
  features: (items: Array<[string, string]>): EmailBlock => ({ id: blockId(), type: "features", items: items.map(([icon, title]) => ({ icon, title })) }),
  divider: (): EmailBlock => ({ id: blockId(), type: "divider", color: "#E9E5FB", thickness: 1 }),
  timer: (label: string): EmailBlock => ({ id: blockId(), type: "timer", endsAt: new Date(Date.now() + 3 * 86_400_000).toISOString(), label }),
  social: (): EmailBlock => ({ id: blockId(), type: "social", facebook: "", instagram: "", tiktok: "", whatsapp: "", align: "center" }),
  footer: (): EmailBlock => ({ id: blockId(), type: "footer", text: "Pay on Delivery | Delivered to Your Door" }),
  /** visual: "photo" = the product's picture, anything else = an emoji. No button text = no button. */
  cover: (f: CampaignFields, tone: CoverTone, title: string, subtitle: string, visual: string, button = "", buttonTone: "yellow" | "purple" = "yellow"): EmailBlock => ({
    id: blockId(), type: "cover", title, subtitle, imageUrl: visual === "photo" ? f.productImage : "", emoji: visual === "photo" ? "" : visual,
    buttonText: button ? `${button} →` : "", buttonLink: button ? f.productLink : "", buttonTone, tone
  })
};
const POD: Array<[string, string]> = [["cash", "Pay On Delivery"], ["truck", "Delivered To Your Door"], ["check", "Easy To Order"]];
const product = (f: CampaignFields) => f.productName.trim() || "our best seller";
const brandName = (f: CampaignFields) => f.brand.trim() || "our store";

/**
 * Bright's email designs ("ProtoHub Email Templates", 9 Nov 2026): 48 emails,
 * each with its own designed photo, kept on the app's own site so every email
 * app can load them. Words were checked for a pay-on-delivery business: no
 * codes to type (an offer rides on the email's link and comes off by itself),
 * no made-up percentages, numbers, perks or order details; anything only the
 * business knows (dates, tips, delivery times) is a "[write … here]" gap.
 */
export const TEMPLATE_PHOTO_BASE = "https://protohub-zeta.vercel.app/email-templates/";

/**
 * Pictures that show a product (a shelf, rack or organiser). Bright, 9 Nov:
 * a generic picture "might not be right for some of the products", so when
 * the email has a product with a photo, these give way to that product's own
 * photo. The other pictures (gifts, clock, van, envelope…) suit any product.
 */
export const PRODUCT_PICTURES = new Set([
  "abandoned-cart-reminder", "almost-sold-out", "back-in-stock", "bestsellers", "bundle-deal", "buy-one-get-one", "cart-discount", "cart-free-delivery",
  "clearance-sale", "flash-sale", "launch-day", "payday-sale", "pre-order", "product-announcement", "promotional-offer", "re-engagement",
  "recommended-for-you", "replenishment-reminder", "review-request", "setup-and-care-tips", "vip-early-access", "weekend-deals", "whats-new"
]);

type Look = { slug: string; tone: CoverTone; title: string | ((f: CampaignFields) => string); subtitle: string | ((f: CampaignFields) => string); button?: string; buttonTone?: "yellow" | "purple" };
const say = (value: string | ((f: CampaignFields) => string), f: CampaignFields) => (typeof value === "function" ? value(f) : value);
function designed(look: Look, f: CampaignFields): EmailBlock {
  const own = PRODUCT_PICTURES.has(look.slug) && !!f.productImage.trim();
  return {
    id: blockId(), type: "cover", title: say(look.title, f), subtitle: say(look.subtitle, f),
    imageUrl: own ? f.productImage : `${TEMPLATE_PHOTO_BASE}${look.slug}.jpg`, emoji: "", big: !own,
    buttonText: look.button ? `${look.button} →` : "", buttonLink: look.button ? f.productLink : "", buttonTone: look.buttonTone ?? "yellow", tone: look.tone
  };
}
const hi = (text = "Hi {{First Name}},") => B.text(text, 19, true);
const p = (text: string) => B.text(text);
const OFFER_NOTE = "🎁 No code needed. Order through the button in this email and your offer comes off by itself.";
const offerNote = () => B.text(OFFER_NOTE, 15, true, "center");
const signOff = (f: CampaignFields) => p(`Thanks for shopping with us,\nThe ${brandName(f)} Team`);
const OFFER_HINT = " Attach an offer when you send it.";

function design(key: string, name: string, hint: string, category: string, type: TemplateType, subject: string, preheader: string, look: Look, body: (f: CampaignFields) => EmailBlock[]): Starter {
  return { key, name, hint, category, type, layout: key, subject, preheader, build: (f) => [B.header(f), designed(look, f), ...body(f), B.footer()] };
}

/** Ready-made emails. Words make no claims: no made-up discounts, numbers or reviews. */
export const STARTER_TEMPLATES: Starter[] = [
  // ── Promotional ──
  design("promo_offer", "Promotional Offer", "Drive more sales with a special offer." + OFFER_HINT, "promotional", "promotional", "A special offer on {{Product}}, just for you", "A limited-time offer just for you",
    { slug: "promotional-offer", tone: "mint", title: "Don't Miss Out!", subtitle: "A limited-time offer just for you.", button: "Shop Now" },
    (f) => [hi("Hi {{First Name}}, this one's for you"), p(`For a short time, ${product(f)} is on a special offer. Get yours before it's gone.`), offerNote(), B.product(f, "Order Now"), signOff(f)]),
  design("flash_sale", "Flash Sale", "A short sale with a countdown." + OFFER_HINT, "promotional", "promotional", "Flash sale: {{Product}} for a short time only", "Prices drop for a short time only",
    { slug: "flash-sale", tone: "butter", title: "Flash Sale ⚡", subtitle: "Prices drop for a short time only. Don't blink.", button: "Shop the Sale" },
    (f) => [hi(), p("For a short time, our best sellers cost less. When the timer runs out, prices go back up."), B.timer("Sale ends in"), offerNote(), B.product(f, "Order Now"), signOff(f)]),
  design("buy_one_get_one", "Buy 1 Get 1 Free", "Two for the price of one.", "promotional", "promotional", "Buy 1, get 1 free, {{First Name}} 🎁", "Buy one, get one free on selected products",
    { slug: "buy-one-get-one", tone: "mint", title: "Buy 1, Get 1 Free 🎁", subtitle: "Double the order, same price.", button: "Get Both" },
    (f) => [hi(), p("Order one of our selected products and the second one is on us. Keep one, give one to a friend."), p("Offer ends on [write the date here] or while stock lasts. You pay when it arrives."), B.product(f, "Get Both"), signOff(f)]),
  design("free_delivery", "Free Delivery Weekend", "Delivery is free for a few days.", "promotional", "promotional", "Free delivery this weekend 🚚", "Free delivery on every order this weekend",
    { slug: "free-delivery", tone: "sky", title: "Free Delivery This Weekend 🚚", subtitle: "No minimum. No delivery fee. Just order.", button: "Shop Free Delivery", buttonTone: "purple" },
    (f) => [hi(), p("This weekend only, delivery is free on every order, big or small, anywhere we deliver."), p("Starts: [write the date here]\nEnds: [write the date here]"), p("You still pay when it arrives."), B.product(f, "Order Now"), signOff(f)]),
  design("bundle_deal", "Bundle & Save", "Sell the complete set for less.", "promotional", "promotional", "Get the complete set for less, {{First Name}}", "Get the complete set and pay less",
    { slug: "bundle-deal", tone: "lavender", title: "Bundle & Save", subtitle: "Get the complete set for less.", button: "Shop the Bundle", buttonTone: "purple" },
    (f) => [hi(), p("Why buy one piece at a time? Get the complete set and pay less than buying each piece on its own."), p("What's in the set:\n✅ [write the first item here]\n✅ [write the second item here]\n✅ [write the third item here]"), B.product(f, "Order the Set"), signOff(f)]),
  design("clearance_sale", "Clearance Sale", "Clear end-of-line stock.", "promotional", "promotional", "Clearance: last chance, {{First Name}}", "Once it's gone, it's gone",
    { slug: "clearance-sale", tone: "pink", title: "Clearance Sale 🏷️", subtitle: "Last chance on end-of-line stock.", button: "Shop Clearance" },
    (f) => [hi(), p("We're making room for new arrivals, so these items are going at our lowest prices. Quantities are limited and won't be restocked."), signOff(f)]),
  design("vip_early_access", "VIP Early Access", "Best customers shop the sale first.", "promotional", "promotional", "You're in early, {{First Name}} 👑", "Shop the sale before everyone else",
    { slug: "vip-early-access", tone: "lavender", title: "VIP Early Access 👑", subtitle: "Shop the sale before everyone else.", button: "Shop Early", buttonTone: "purple" },
    (f) => [hi(), p("As one of our valued customers, you get first pick of our next sale, before it opens to everyone."), p("Early access opens: [write the date here]\nSale opens to everyone: [write the date here]"), signOff(f)]),
  design("payday_sale", "Payday Sale", "Month-end deals." + OFFER_HINT, "promotional", "promotional", "Payday deals for your home 💸", "You've earned it",
    { slug: "payday-sale", tone: "mint", title: "Payday Sale 💸", subtitle: "Treat your home. You've earned it.", button: "Treat Yourself" },
    (f) => [hi(), p("Payday is here, and so are our best deals of the month. Upgrade your space with products that make every day easier."), offerNote(), B.product(f, "Order Now"), signOff(f)]),
  design("almost_sold_out", "Almost Sold Out", "Only a few left.", "promotional", "promotional", "Almost gone: {{Product}}", "Only a few left of our best seller",
    { slug: "almost-sold-out", tone: "peach", title: "Almost Sold Out!", subtitle: "Only a few left of our best seller.", button: "Get Yours Now" },
    (f) => [hi(), p("Our most popular product is nearly gone, and we don't know when the next batch will arrive."), B.product(f, "Get Yours Now"), signOff(f)]),
  design("special_discount", "Special Discount", "A thank-you discount, no reason needed." + OFFER_HINT, "promotional", "promotional", "A little thank-you for you, {{First Name}}", "A special discount, just because",
    { slug: "discount-code", tone: "lavender", title: "A Special Discount, Just Because", subtitle: "A little thank-you for being with us.", button: "Get My Discount", buttonTone: "purple" },
    (f) => [hi(), p(`No special occasion. We just wanted to say thanks for being part of the ${brandName(f)} family.`), offerNote(), signOff(f)]),
  design("weekend_deals", "Weekend Deals", "Deals from Friday to Sunday.", "promotional", "promotional", "Weekend deals are live 🛋️", "Fresh deals on home essentials, all weekend long",
    { slug: "weekend-deals", tone: "butter", title: "Weekend Deals Are Live 🛋️", subtitle: "Fresh deals on home essentials, all weekend.", button: "See Weekend Deals", buttonTone: "purple" },
    (f) => [hi(), p("Make this weekend the one you finally get organised. Deals run from Friday to Sunday night."), B.product(f, "Order Now"), signOff(f)]),
  design("tell_a_friend", "Tell a Friend", "Ask customers to pass the email on.", "promotional", "retention", "Know someone who'd love this, {{First Name}}?", "Share it with a friend",
    { slug: "refer-a-friend", tone: "pink", title: "Share the Love 🤝", subtitle: "Know someone who'd love this?", button: "See What They'll Love", buttonTone: "purple" },
    (f) => [hi(), p("Know someone who'd love what we sell? Forward this email to them. They can order through the button above and pay when it arrives."), signOff(f)]),

  // ── Retention & Win-Back ──
  design("loyalty_points_reminder", "Loyalty Points Reminder", "Show members their points and reward.", "retention", "retention", "You have points waiting, {{First Name}} 🌟", "Here's what's waiting for you",
    { slug: "loyalty-points-reminder", tone: "lavender", title: "You Have Points Waiting 🌟", subtitle: "Here's what's waiting for you.", button: "Order Now", buttonTone: "purple" },
    (f) => [hi(), p("Points: {{Points}}\nLevel: {{Level}}\nYour reward: {{Voucher}}"), p("Your reward comes off by itself on your next order. Nothing to type."), signOff(f)]),
  design("vip_upgrade", "VIP Upgrade", "Tell a member they reached a new level.", "retention", "retention", "You've reached a new level, {{First Name}}! 👑", "Thanks for being one of our best customers",
    { slug: "vip-upgrade", tone: "lavender", title: "You've Reached a New Level! 👑", subtitle: "Thanks for being one of our best customers.", button: "See What's New", buttonTone: "purple" },
    (f) => [hi("Congratulations, {{First Name}}!"), p("You're now at the {{Level}} level.\nYour reward: {{Voucher}}"), p("It comes off by itself on your next order."), signOff(f)]),
  design("customer_anniversary", "Customer Anniversary", "Celebrate a customer with a gift." + OFFER_HINT, "retention", "retention", "Thank you for being with us, {{First Name}} 🎂", "A gift to say thank you",
    { slug: "customer-anniversary", tone: "pink", title: "Happy Anniversary! 🎂", subtitle: "Thank you for being with us.", button: "Claim My Gift", buttonTone: "purple" },
    (f) => [hi(), p("Thank you for sticking with us. To celebrate, here's a gift for you."), offerNote(), signOff(f)]),
  design("replenishment_reminder", "Restock Reminder", "Remind customers to order again.", "retention", "retention", "Running low on {{Product}}?", "Order again in one tap",
    { slug: "replenishment-reminder", tone: "mint", title: "Time to Restock? 🔄", subtitle: "Order your favourite again in one tap.", button: "Order Again" },
    (f) => [hi(), p("It's been a while since you bought this. If you're running low, order again now so you don't run out."), B.product(f, "Order Again"), signOff(f)]),
  design("last_chance_winback", "Last Chance Win-Back", "Last reminder before an offer ends." + OFFER_HINT, "retention", "retention", "Your offer ends tonight, {{First Name}} ⏰", "Your comeback offer ends at midnight",
    { slug: "last-chance-winback", tone: "peach", title: "Your Offer Ends Tonight ⏰", subtitle: "Your comeback offer ends at midnight.", button: "Use My Offer" },
    (f) => [hi(), p("We sent you a special offer to welcome you back, and it ends at midnight tonight. This is your last reminder."), offerNote(), signOff(f)]),
  design("thank_you_loyal", "Thank You", "Thank loyal customers with a gift." + OFFER_HINT, "retention", "retention", "Thank you, {{First Name}} 💜", "A little something for your loyalty",
    { slug: "thank-you-loyal-customer", tone: "lavender", title: "Thank You for Sticking With Us 💜", subtitle: "Here's a little something for your loyalty.", button: "Open My Gift", buttonTone: "purple" },
    (f) => [hi(), p(`Customers like you are the reason ${brandName(f)} exists, and we don't take that for granted.`), offerNote(), signOff(f)]),
  design("birthday", "Birthday Gift", "A birthday gift." + OFFER_HINT, "retention", "retention", "Happy birthday, {{First Name}}! 🎉", "Your birthday gift is inside",
    { slug: "birthday", tone: "butter", title: "Happy Birthday, {{First Name}}! 🎉", subtitle: "Your birthday gift is inside.", button: "Claim My Birthday Gift", buttonTone: "purple" },
    (f) => [p(`Wishing you a wonderful day! To celebrate, here's a special gift from all of us at ${brandName(f)}.`), offerNote(), signOff(f)]),
  design("win_back_offer", "Win-Back Campaign", "Bring back customers who stopped ordering." + OFFER_HINT, "retention", "retention", "We miss you, {{First Name}}", "Here is a reason to come back",
    { slug: "win-back-campaign", tone: "lavender", title: "We Miss You! 👋", subtitle: "It's been a while. Here's a special offer to come back.", button: "Claim Your Offer", buttonTone: "purple" },
    (f) => [hi(), p("We noticed you haven't ordered from us in a while, and we'd love to have you back. Here's a little something to make your next order sweeter."), offerNote(), p("We've added new products since your last order. Take a look, you might find something you love."), signOff(f)]),

  // ── Post-Purchase ──
  design("order_confirmation", "Order Confirmation", "Confirm the order and say what happens next.", "post_purchase", "transactional", "Thanks for your order, {{First Name}}!", "Your order is confirmed and being prepared",
    { slug: "order-confirmation", tone: "lavender", title: "Thanks for Your Order! 🎉", subtitle: "Your order is confirmed and being prepared." },
    (f) => [hi(), p("We've received your order and our team is getting it ready. We'll call you before delivery, and you pay when it arrives."), p("Need to change something? Just reply to this email."), signOff(f)]),
  design("shipping_confirmation", "Order On Its Way", "Tell customers their order has left.", "post_purchase", "transactional", "Your order is on its way, {{First Name}} 🚚", "Good news: it's coming to you",
    { slug: "shipping-confirmation", tone: "sky", title: "Your Order Is on Its Way! 🚚", subtitle: "It's coming to you." },
    (f) => [hi(), p("Good news: your order has left us and is on its way to you. Our delivery partner will call you before they arrive."), p("Please keep your phone close. You pay when it arrives."), signOff(f)]),
  design("out_for_delivery", "Out for Delivery", "Delivery is today: keep the phone close.", "post_purchase", "transactional", "Your order arrives today, {{First Name}} 📍", "Keep your phone close",
    { slug: "out-for-delivery", tone: "mint", title: "Out for Delivery Today 📍", subtitle: "Your order arrives today. Keep your phone close." },
    (f) => [hi(), p("Your order is out for delivery and should reach you today. Our rider will call you when they arrive."), p("Won't be home? Reply to this email and we'll help rearrange delivery."), signOff(f)]),
  design("delivered", "Order Delivered", "Check everything arrived well.", "post_purchase", "transactional", "Your order has arrived, {{First Name}} 🏠", "We hope you love it",
    { slug: "delivered", tone: "peach", title: "Your Order Has Arrived 🏠", subtitle: "We hope you love it!" },
    (f) => [hi(), p("Your order has been delivered. If anything is missing or damaged, reply to this email and we'll sort it out."), signOff(f)]),
  design("usage_tips", "Setup & Care Tips", "Help customers get the most from the product.", "post_purchase", "retention", "Get the most from your {{Product}}", "A few quick tips",
    { slug: "setup-and-care-tips", tone: "lavender", title: "A Few Quick Tips 💡", subtitle: (f) => `Get the most from ${product(f)}.` },
    (f) => [hi(), p("🔧 Setup: [write your setup tip here]\n🧽 Cleaning: [write your cleaning tip here]\n✅ Care: [write your care tip here]"), p("Questions? Just reply to this email."), B.button(f, "See The Product"), signOff(f)]),
  design("review_request", "Review Request", "Ask how the product is working for them.", "post_purchase", "retention", "How's your {{Product}}, {{First Name}}?", "We'd love to hear how it's going",
    { slug: "review-request", tone: "lavender", title: "How's Your New Product? 😊", subtitle: "We'd love to hear your experience." },
    (f) => [B.text("⭐⭐⭐⭐⭐", 28, false, "center"), hi(), p(`Your ${product(f)} arrived recently, and we'd love to know what you think. Just reply to this email and tell us. We read every reply.`), signOff(f)]),

  // ── Abandoned Cart ──
  design("cart_reminder", "Abandoned Cart Reminder", "Remind customers about the order they didn't finish.", "cart", "retention", "You left something behind, {{First Name}}", "Your order is one step away",
    { slug: "abandoned-cart-reminder", tone: "pink", title: "You Left Something in Your Cart! 🛒", subtitle: "Complete your order now before it's gone.", button: "Complete Order" },
    (f) => [hi(), p("Looks like you didn't finish your order. It only takes a minute, and you pay when it arrives."), B.product(f, "Complete Order"), p("Popular products sell out fast. Need help? Just reply to this email."), signOff(f)]),
  design("cart_discount", "Cart Discount", "A small offer to finish the order." + OFFER_HINT, "cart", "promotional", "Still thinking, {{First Name}}? Here's a little help", "Finish your order today and save",
    { slug: "cart-discount", tone: "pink", title: "Still Thinking? Here's a Little Help", subtitle: "Finish your order today and save.", button: "Complete Order" },
    (f) => [hi(), p("Your order is still waiting. To make it easier, here's a little something if you order today."), offerNote(), B.product(f, "Complete Order"), signOff(f)]),
  design("cart_last_call", "Cart Last Call", "It's still available, for now.", "cart", "retention", "Still available, for now: {{Product}}", "Popular items sell out fast",
    { slug: "cart-expiring", tone: "peach", title: "Still Available, For Now ⏳", subtitle: "Popular items sell out fast.", button: "Order Now" },
    (f) => [hi(), p("The item you picked is still available, but we can't promise for how long. Order now so you don't miss out."), B.product(f, "Order Now"), signOff(f)]),
  design("checkout_help", "Ordering Help", "Offer help to people who didn't finish.", "cart", "retention", "Need help with your order, {{First Name}}?", "We're here if something went wrong",
    { slug: "checkout-help", tone: "sky", title: "Need Help Ordering? 🙋", subtitle: "We're here if something went wrong.", button: "Finish My Order", buttonTone: "purple" },
    (f) => [hi(), p("We noticed you didn't finish your order. If something got in the way, we can help."), p("📦 Pay on delivery: you pay when it arrives.\n📞 Talk to us: reply to this email and we'll call you.\n🚚 Delivered to your door."), signOff(f)]),
  design("cart_free_delivery", "Cart Free Delivery", "Free delivery if they order today.", "cart", "promotional", "Free delivery on your order, {{First Name}} 🚚", "We'll cover delivery if you order today",
    { slug: "cart-free-delivery", tone: "mint", title: "Free Delivery on Your Order 🚚", subtitle: "We'll cover delivery if you order today.", button: "Claim Free Delivery" },
    (f) => [hi(), p("Good news: if you complete your order today, delivery is on us."), B.product(f, "Complete Order"), signOff(f)]),

  // ── Welcome Series ──
  design("welcome_email", "Welcome Email", "Start a great relationship with new subscribers.", "welcome", "retention", "Welcome, {{First Name}}! 🎉", "Thanks for joining us",
    { slug: "welcome-email", tone: "lavender", title: (f) => `Welcome to ${brandName(f)}! 🎉`, subtitle: "Thanks for joining. Get ready for great deals, useful tips, and more.", button: "Start Shopping", buttonTone: "purple" },
    (f) => [hi("Hi {{First Name}}, glad you're here!"), p("Here's what you can expect from us:"), p("🏷️ Members-only deals: offers before anyone else.\n🚚 Delivered to your door, and you pay when it arrives.\n💡 Useful tips for a tidy, stylish home.\n💬 Real people: reply to any email and we'll get back to you."), signOff(f)]),
  design("our_story", "Our Story", "Who you are and why you started.", "welcome", "retention", "Meet the team behind your order, {{First Name}} 👋", "Who we are and why we do this",
    { slug: "our-story", tone: "lavender", title: (f) => `Meet ${brandName(f)} 👋`, subtitle: "Who we are and why we do this.", button: "See What We Sell", buttonTone: "purple" },
    (f) => [hi(), p(`${brandName(f)} started with a simple idea: [write how you started here].`), p("🚚 Delivered to your door, and you pay when it arrives.\n🤝 Real people: a team that actually replies."), signOff(f)]),
  design("bestsellers", "Bestsellers", "Start new customers with a favourite.", "welcome", "promotional", "Our customers' favourite, {{First Name}} ⭐", "Start with the one everyone loves",
    { slug: "bestsellers", tone: "peach", title: "Our Customers' Favourites ⭐", subtitle: "Start with the products everyone loves.", button: "Shop Bestsellers" },
    (f) => [hi(), p("Not sure where to start? Here's one our customers love."), B.product(f, "Order Now"), signOff(f)]),
  design("welcome_gift_reminder", "Welcome Gift Reminder", "Remind new subscribers about their gift." + OFFER_HINT, "welcome", "retention", "Your welcome gift is waiting, {{First Name}} 🎁", "Your first-order gift is still here",
    { slug: "welcome-gift-reminder", tone: "pink", title: "Your Welcome Gift Is Waiting 🎁", subtitle: "Your first-order gift is still here.", button: "Use My Gift", buttonTone: "purple" },
    (f) => [hi(), p("You haven't used your welcome gift yet. Don't miss it."), offerNote(), signOff(f)]),

  // ── Product Launch ──
  design("coming_soon", "Coming Soon", "Build excitement before a launch.", "launch", "announcement", "Something new is coming, {{First Name}} 👀", "Be the first to know",
    { slug: "coming-soon", tone: "lavender", title: "Something New Is Coming… 👀", subtitle: "Be the first to know when it arrives." },
    (f) => [hi(), p("We've been working on something special, and it arrives on [write the date here]. Reply YES to this email and we'll tell you the moment it's here."), signOff(f)]),
  design("launch_day", "Launch Day", "It's here: the new product is live.", "launch", "announcement", "It's here: {{Product}} 🚀", "Our newest product is live",
    { slug: "launch-day", tone: "sky", title: "It's Here! Shop the Launch 🚀", subtitle: "Our newest product is live.", button: "Shop the Launch" },
    (f) => [hi(), p("The wait is over. Our newest product is available now."), B.product(f, "Order Now"), signOff(f)]),
  design("pre_order", "Pre-Order", "Take orders before stock lands.", "launch", "announcement", "Reserve yours early, {{First Name}}", "Reserve yours before it lands",
    { slug: "pre-order", tone: "mint", title: "Pre-Order Now", subtitle: "Reserve yours before it lands.", button: "Reserve Mine" },
    (f) => [hi(), p("Be first in line. Order today and we'll deliver as soon as stock lands. You pay when it arrives."), p("Delivery from: [write the date here]"), signOff(f)]),
  design("back_in_stock", "Back in Stock", "The product people wanted is back.", "launch", "announcement", "Back in stock: {{Product}} 🔔", "The one you wanted is available again",
    { slug: "back-in-stock", tone: "butter", title: "Back in Stock! 🔔", subtitle: "The one you wanted is available again.", button: "Buy Now", buttonTone: "purple" },
    (f) => [hi(), p("It's back, and it sold out fast last time."), B.product(f, "Order Now"), signOff(f)]),

  // ── Re-Engagement ──
  design("still_interested", "Re-Engagement", "Reconnect with people who looked but didn't order.", "reengagement", "retention", "Still interested, {{First Name}}?", "It's still available",
    { slug: "re-engagement", tone: "peach", title: "Still Interested? 🤔", subtitle: "The item you viewed is still available. Grab it now!", button: "Shop Now" },
    (f) => [hi(), p("You were checking this out recently. It's still available, for now:"), B.product(f, "Order Now"), signOff(f)]),
  design("whats_new", "What's New", "Show what's new since their last visit.", "reengagement", "retention", "Here's what you missed, {{First Name}} ✨", "New arrivals since your last visit",
    { slug: "whats-new", tone: "lavender", title: "Here's What You Missed ✨", subtitle: "New arrivals since your last visit.", button: "See What's New", buttonTone: "purple" },
    (f) => [hi(), p(`A lot has changed since you last visited. Here's what's new at ${brandName(f)}:`), B.product(f, "Order Now"), signOff(f)]),
  design("stay_subscribed", "Stay Subscribed", "Check quiet subscribers still want emails.", "reengagement", "retention", "Still want to hear from us, {{First Name}}?", "Stay with us or change your mind any time",
    { slug: "stay-subscribed", tone: "sky", title: "Still Want to Hear From Us?", subtitle: "Stay with us, or change your mind any time.", button: "See What's New", buttonTone: "purple" },
    (f) => [hi(), p("We haven't heard from you in a while. We only want to email people who enjoy hearing from us."), p("Want to stay? You don't need to do anything. Rather not hear from us? Use the unsubscribe link at the bottom of this email."), signOff(f)]),
  design("recommended_for_you", "Recommended for You", "One product picked for them.", "reengagement", "retention", "Picked for you, {{First Name}} 💡", "We think you'll like this",
    { slug: "recommended-for-you", tone: "peach", title: "Picked Just for You 💡", subtitle: "We think you'll like this.", button: "See My Pick" },
    (f) => [hi(), p("We picked this one for you."), B.product(f, "Order Now"), signOff(f)]),

  // ── Announcements ──
  design("new_arrival", "Product Announcement", "Tell customers about a new product.", "announcement", "announcement", "Just arrived: {{Product}}", "Be the first to get it",
    { slug: "product-announcement", tone: "lavender", title: "New Arrival! ✨", subtitle: (f) => `Check out ${product(f)}.`, button: "Explore Now" },
    (f) => [hi(`Hi {{First Name}}, meet ${product(f)}`), B.product(f, "Order Now"), p("Stock is limited for the first batch, so order early to get yours first."), signOff(f)]),
  design("faster_delivery", "Faster Delivery", "Share better delivery times.", "announcement", "announcement", "Faster delivery, {{First Name}} 🚚", "We now deliver faster",
    { slug: "faster-delivery", tone: "sky", title: "Faster Delivery 🚚", subtitle: "We now deliver to more places, faster.", button: "Order Now", buttonTone: "purple" },
    (f) => [hi(), p("We've upgraded our delivery. Here's how long orders now take:"), p("Lagos & Abuja: [write the time here]\nOther major cities: [write the time here]\nEverywhere else: [write the time here]"), signOff(f)]),
  design("holiday_schedule", "Holiday Delivery Schedule", "Last order dates before the holidays.", "announcement", "announcement", "Order by these dates for the holidays 📅", "Get it in time",
    { slug: "holiday-schedule", tone: "mint", title: "Holiday Delivery Schedule 📅", subtitle: "Order by these dates to get it in time.", button: "Order Before the Cut-Off" },
    (f) => [hi(), p("Planning gifts? Here are the last order dates for delivery before the holidays:"), p("Lagos & Abuja: [write the date here]\nOther cities: [write the date here]\nOffice closed: [write the dates here]"), signOff(f)]),

  // ── Seasonal & Event ──
  design("black_friday", "Black Friday", "The biggest sale of the year." + OFFER_HINT, "seasonal", "promotional", "Black Friday is here, {{First Name}} 🖤", "Our biggest price drops of the year",
    { slug: "black-friday", tone: "lavender", title: "Black Friday Is Here 🖤", subtitle: "Our biggest price drops of the year.", button: "Shop Black Friday" },
    (f) => [hi(), p("Our biggest sale of the year is live, for a limited time."), B.timer("Sale ends in"), offerNote(), B.product(f, "Order Now"), signOff(f)]),
  design("christmas", "Christmas", "Festive deals." + OFFER_HINT, "seasonal", "promotional", "Merry Christmas, {{First Name}} 🎄", "Festive deals for a tidy new year",
    { slug: "christmas", tone: "pink", title: (f) => `Merry Christmas from ${brandName(f)} 🎄`, subtitle: "Festive deals for a tidy new year.", button: "Shop Christmas Deals", buttonTone: "purple" },
    (f) => [hi(), p("Wishing you and your family a joyful season. Start the new year organised, with festive savings."), offerNote(), signOff(f)]),

  // ── Kept from before (Autopilot and Create Custom Template use these) ──
  { key: "product_collection", name: "Product Collection", hint: "Show a product with its price and a button", category: "promotional", type: "promotional", layout: "product_collection",
    subject: "Picked for your home, {{First Name}}", preheader: "See what customers are ordering",
    build: (f) => [B.header(f), B.cover(f, "lavender", "Picked For Your Home", "See what customers are ordering.", "photo", "Order Now", "purple"), B.text("Hi {{First Name}},", 20, true), B.product(f, "Order Now"), B.features(POD), B.footer()] },
  { key: "announcement", name: "Announcement", hint: "Share important news or updates", category: "announcement", type: "announcement", layout: "announcement",
    subject: "An update for you, {{First Name}}", preheader: "News we wanted you to hear first",
    build: (f) => [B.header(f), B.cover(f, "lilac", "Some Good News 📣", "An update we wanted you to hear first.", "📣", "Read More", "purple"), B.text("Hi {{First Name}}, write your news here.", 15, false, "center"), B.footer()] },
  { key: "newsletter", name: "Newsletter", hint: "Send updates, stories and picks", category: "announcement", type: "announcement", layout: "newsletter",
    subject: "What's new this month, {{First Name}}", preheader: "Updates, tips and picks for you",
    build: (f) => [B.header(f), B.cover(f, "lavender", "This Month 📰", "Updates, tips, and picks for you.", "📰"), B.text("📰 Story one: write it here."), B.divider(), B.product(f, "See It"), B.divider(), B.text("💡 A quick tip: write it here."), B.social(), B.footer()] },
  { key: "blank", name: "Blank Template", hint: "Start from an empty layout and design freely", category: "promotional", type: "promotional", layout: "blank",
    subject: "", preheader: "", build: (f) => [B.header(f), B.text("Write your message here."), B.footer()] }
];

// ── "Their product" (Bright, 9 Nov 2026) ─────────────────────────────
// A follow-up to a customer who went quiet shows the product THEY ordered.
// Blocks marked `theirs` (cover picture + button, product card, button) and
// the {{Their Product}} tag are filled per customer right before sending; in
// the editor they show the sample product.

export type TheirProduct = { name: string; price: string; imageUrl: string; link: string };
export const THEIR_PRODUCT_TAG = "{{Their Product}}";

/** True when the email has anything that changes with the customer's own product. */
export function usesTheirProduct(design: EmailDesign | null, subject = "") {
  if (subject.includes(THEIR_PRODUCT_TAG)) return true;
  return !!design?.blocks.some((block) => ("theirs" in block && block.theirs) || JSON.stringify(block).includes(THEIR_PRODUCT_TAG));
}

/** The design with the customer's own product in the marked places (no product found = "order", sample picture kept). */
export function withTheirProduct(design: EmailDesign, product: TheirProduct | null): EmailDesign {
  const name = product?.name.trim() || "order";
  const filled = JSON.parse(JSON.stringify(design).split(THEIR_PRODUCT_TAG).join(JSON.stringify(name).slice(1, -1))) as EmailDesign;
  // Not found: no card for the wrong product.
  if (!product) return { ...filled, blocks: filled.blocks.filter((block) => !(block.type === "product" && block.theirs)) };
  return {
    ...filled,
    blocks: filled.blocks.map((block): EmailBlock => {
      if (!("theirs" in block) || !block.theirs) return block;
      if (block.type === "cover") {
        // A designed picture of a gift, clock, van… stays; a product picture (or the sample product's photo) becomes theirs.
        const slug = block.imageUrl.startsWith(TEMPLATE_PHOTO_BASE) ? block.imageUrl.slice(TEMPLATE_PHOTO_BASE.length).replace(/\.jpg$/, "") : null;
        const swap = !!product.imageUrl && (!slug || PRODUCT_PICTURES.has(slug));
        return { ...block, imageUrl: swap ? product.imageUrl : block.imageUrl, big: swap ? false : block.big, buttonLink: block.buttonText ? product.link || block.buttonLink : block.buttonLink };
      }
      if (block.type === "product") return { ...block, name: product.name, price: product.price, imageUrl: product.imageUrl, link: product.link || block.link };
      if (block.type === "button") return { ...block, link: product.link || block.link };
      return block;
    })
  };
}
export const fillTheirProduct = (text: string, product: TheirProduct | null) => text.split(THEIR_PRODUCT_TAG).join(product?.name.trim() || "order");

/**
 * The "[write … here]" gaps a ready-made leaves for the business to fill
 * (dates, tips, delivery times). An email that still has one is never sent
 * (Bright, 9 Nov 2026: four live After Delivery emails still had them).
 */
export function unfilledGaps(design: EmailDesign | null, subject = ""): string[] {
  const text = `${subject} ${JSON.stringify(design?.blocks ?? [])}`;
  return [...new Set(text.match(/\[write [^\]]{1,60} here\]/gi) ?? [])];
}

/** A follow-up email (Autopilot's "went quiet" flows): designed cover, words, the customer's product. */
export type QuietEmailSpec = { slug: string; tone: CoverTone; title: string; subtitle: string; button: string; buttonTone?: "yellow" | "purple"; lines: string[]; offer?: boolean; product?: boolean;
  /** false = the email shows the product it was built with (a pick for them), not the one they ordered. */
  theirs?: boolean };
export function buildQuietDesign(f: CampaignFields, spec: QuietEmailSpec): EmailDesign {
  const blocks: EmailBlock[] = [
    B.header(f),
    // The designed picture; a product picture becomes the customer's own product when the email is sent.
    spec.theirs === false
      ? designed({ slug: spec.slug, tone: spec.tone, title: spec.title, subtitle: spec.subtitle, button: spec.button, buttonTone: spec.buttonTone }, f)
      : { ...designed({ slug: spec.slug, tone: spec.tone, title: spec.title, subtitle: spec.subtitle, button: spec.button, buttonTone: spec.buttonTone }, { ...f, productImage: "" }), theirs: true } as EmailBlock,
    hi(),
    ...spec.lines.map((line) => p(line)),
    ...(spec.offer ? [offerNote()] : []),
    ...(spec.product === false ? [] : [spec.theirs === false ? B.product(f, "Order Now") : { ...B.product(f, "Order Now"), theirs: true } as EmailBlock]),
    signOff(f),
    B.footer()
  ];
  return { version: 1, template: `quiet:${spec.slug}`, touched: true, styles: { ...DEFAULT_STYLES }, blocks };
}

/** The layouts in Create Custom Template, step 2 (the ready-made emails, by shape). */
export const STARTER_LAYOUTS = [
  { key: "promo_offer", name: "Product Promotion", hint: "Showcase a product with image, benefits, and a button" },
  { key: "product_collection", name: "Product Collection", hint: "A product card with price and a button" },
  { key: "win_back_offer", name: "Win-Back", hint: "Re-engage inactive customers" },
  { key: "welcome_email", name: "Welcome Email", hint: "Welcome new subscribers and set expectations" },
  { key: "order_confirmation", name: "Order Confirmation", hint: "Confirm an order and share next steps" },
  { key: "cart_reminder", name: "Abandoned Cart", hint: "Remind customers about items left behind" },
  { key: "announcement", name: "Announcement", hint: "Share important updates, restocks, or news" },
  { key: "usage_tips", name: "Educational / Tips", hint: "Share tips, how-tos, or product usage guides" },
  { key: "newsletter", name: "Newsletter", hint: "Send updates, stories, and picks" },
  { key: "flash_sale", name: "Flash Sale", hint: "A deal with a countdown timer" },
  { key: "review_request", name: "Review Request", hint: "Ask how the product is going" },
  { key: "blank", name: "Blank Template", hint: "Start from an empty layout and design freely" }
];

/** A ready-made template's design, filled with the business's brand and product. */
export function buildStarterDesign(key: string, fields: CampaignFields): EmailDesign {
  const starter = STARTER_TEMPLATES.find((row) => row.key === key) ?? STARTER_TEMPLATES[0];
  return { version: 1, template: `starter:${starter.key}`, touched: true, styles: { ...DEFAULT_STYLES }, blocks: starter.build(fields) };
}

/** {{Product}} in a template's subject becomes the product's name. */
export const fillProduct = (text: string, productName: string) => text.replace(/\{\{\s*product\s*\}\}/gi, productName.trim() || "our best seller");

/** A fresh block from the left-hand list. */
export function newBlock(type: EmailBlockType, fields?: Partial<CampaignFields>): EmailBlock {
  const id = blockId();
  switch (type) {
    case "header": return { id, type, brand: fields?.brand || "Our Store", tagline: "Smart Home • Kitchen • Lifestyle", align: "center" };
    case "cover": return { id, type, title: "Your Big Headline", subtitle: "A short line under it.", imageUrl: fields?.productImage ?? "", emoji: "", buttonText: "Shop Now →", buttonLink: fields?.productLink ?? "", buttonTone: "yellow", tone: "lavender" };
    case "hero": return { id, type, title: "Your Big", highlight: "Headline", subtitle: "A short line under it", badgeTop: "", badgeMain: "", badgeBottom: "", imageUrl: fields?.productImage ?? "", buttonText: "Shop Now →", buttonLink: fields?.productLink ?? "" };
    case "text": return { id, type, text: "Write your message here.", size: 15, align: "left", color: "", bold: false };
    case "image": return { id, type, url: fields?.productImage ?? "", alt: fields?.productName ?? "", link: fields?.productLink ?? "", width: 100 };
    case "button": return { id, type, text: "Shop Now →", link: fields?.productLink ?? "", style: "primary", size: "large", align: "center", color: DEFAULT_STYLES.accentColor, textColor: "#1F1147", radius: 10 };
    case "product": return { id, type, productId: fields?.productId ?? "", name: fields?.productName || "Product", price: fields?.productPrice ?? "", imageUrl: fields?.productImage ?? "", buttonText: "Order Now", link: fields?.productLink ?? "" };
    case "offer": return { id, type, top: "Up to", main: "15%", bottom: "OFF", color: DEFAULT_STYLES.accentColor, textColor: "#1F1147" };
    case "divider": return { id, type, color: "#E5E7EB", thickness: 1 };
    case "spacer": return { id, type, height: 24 };
    case "social": return { id, type, facebook: "", instagram: "", tiktok: "", whatsapp: "", align: "center" };
    case "timer": return { id, type, endsAt: new Date(Date.now() + 3 * 86_400_000).toISOString(), label: "Offer ends in" };
    case "video": return { id, type, url: "", thumbnailUrl: fields?.productImage ?? "", caption: "Watch it in action" };
    // Empty until a real approved review is picked: never a made-up quote.
    case "review": return { id, type, reviewId: "", quote: "", name: "", productName: fields?.productName ?? "" };
    case "html": return { id, type, html: "<p style=\"margin:0\">Your HTML here</p>" };
    case "features": return { id, type, items: [{ icon: "cash", title: "Pay On Delivery" }, { icon: "truck", title: "Delivered To Your Door" }, { icon: "check", title: "Easy To Order" }] };
    case "footer": return { id, type, text: "Pay on Delivery | Delivered to Your Door" };
  }
}

// ── Rendering ─────────────────────────────────────────────────────────

export type RenderOptions = {
  /** The business's logo (a normal web link): drawn in the header and footer. */
  logoUrl?: string;
  /** First name for {{First Name}}; when missing the tag shows (editor) or reads "there" (sent). */
  firstName?: string;
  /** Keep {{First Name}} visible, as the editor does. */
  showTags?: boolean;
  /** {{Points}}, {{Level}}, {{Voucher}}, {{Next Level}} (Loyalty & Rewards); missing = not a member yet. */
  loyalty?: { points: string; level: string; voucher: string; nextLevel: string };
  preheader?: string;
  /** Every link goes through this (click counting); the label names the link. */
  linkFor?: (url: string, label: string) => string;
  openPixelUrl?: string;
  unsubscribeUrl?: string;
  /** The business name and the reason line under each email. */
  brand?: string;
  footerNote?: string;
  /** Lightweight email: words and links only. */
  plain?: boolean;
  nowMs?: number;
  /** Editor only: marks each block so a click can pick it. */
  editor?: boolean;
  selectedId?: string;
  /** Narrow (phone) preview. */
  mobile?: boolean;
};

export function escapeHtml(value: string) {
  return String(value ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const SAFE_COLOR = /^#[0-9a-f]{3,8}$/i;
const luminance = (hex: string) => {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h.slice(0, 6);
  const [r, g, b] = [0, 2, 4].map((i) => { const v = parseInt(full.slice(i, i + 2), 16) / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
/** Text that can be read on a colour: the chosen one when it stands out enough, else white or near-black. */
export function readableOn(bg: string, fg: string) {
  if (!SAFE_COLOR.test(bg) || !SAFE_COLOR.test(fg)) return fg;
  // The first default text colour (dark purple) reads poorly on the brand blue: white there.
  if (fg.toLowerCase() === "#1f1147" && luminance(bg) < 0.45) return "#FFFFFF";
  const [a, b] = [luminance(bg), luminance(fg)].sort((x, y) => y - x);
  if ((a + 0.05) / (b + 0.05) >= 3) return fg;
  return luminance(bg) > 0.4 ? "#1C1C22" : "#FFFFFF";
}
const color = (value: string | undefined, fallback: string) => (value && SAFE_COLOR.test(value.trim()) ? value.trim() : fallback);
const clampNumber = (value: unknown, min: number, max: number, fallback: number) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
/** Only web links and mailto/tel; anything else becomes "#". */
export function safeUrl(url: string) {
  const value = String(url ?? "").trim();
  return /^(https?:\/\/|mailto:|tel:)/i.test(value) ? value : "";
}

export function applyTags(text: string, opts: RenderOptions) {
  if (opts.showTags) return text;
  const first = (opts.firstName ?? "").trim().split(/\s+/)[0] ?? "";
  const loyalty = opts.loyalty ?? { points: "0", level: "Member", voucher: "no voucher yet", nextLevel: "" };
  return text
    .replace(/\{\{\s*first\s*name\s*\}\}/gi, first || "there")
    .replace(/\{\{\s*points\s*\}\}/gi, loyalty.points)
    .replace(/\{\{\s*level\s*\}\}/gi, loyalty.level)
    .replace(/\{\{\s*voucher\s*\}\}/gi, loyalty.voucher)
    .replace(/\{\{\s*next\s*level\s*\}\}/gi, loyalty.nextLevel);
}

/** True when an email uses a loyalty tag (only then is the member looked up at send time). */
export const usesLoyaltyTags = (text: string) => /\{\{\s*(points|level|voucher|next\s*level)\s*\}\}/i.test(text);

/** Every link in the design, in render order (the click counter numbers them). */
export function collectLinks(design: EmailDesign): Array<{ url: string; label: string }> {
  const links: Array<{ url: string; label: string }> = [];
  const add = (url: string, label: string) => { const safe = safeUrl(url); if (safe) links.push({ url: safe, label }); };
  for (const block of design.blocks) {
    if (block.type === "hero") add(block.buttonLink, block.buttonText || "Hero button");
    if (block.type === "cover") add(block.buttonLink, block.buttonText || "Cover button");
    else if (block.type === "button") add(block.link, block.text || "Button");
    else if (block.type === "image") add(block.link, block.alt || "Image");
    else if (block.type === "product") add(block.link, block.name || "Product");
    else if (block.type === "video") add(block.url, block.caption || "Video");
    else if (block.type === "social") {
      add(block.facebook, "Facebook"); add(block.instagram, "Instagram"); add(block.tiktok, "TikTok");
      if (block.whatsapp.trim()) add(whatsappUrl(block.whatsapp), "WhatsApp");
    }
  }
  return links;
}

const whatsappUrl = (value: string) => {
  const v = value.trim();
  if (/^https?:\/\//i.test(v)) return v;
  let digits = v.replace(/\D/g, "");
  if (digits.startsWith("0")) digits = `234${digits.slice(1)}`;
  return digits ? `https://wa.me/${digits}` : "";
};

/** "2 days 4 hrs" left until the timer's end, at the moment of sending. */
export function timeLeftText(endsAt: string, nowMs: number) {
  const left = new Date(endsAt).getTime() - nowMs;
  if (!Number.isFinite(left) || left <= 0) return "Ended";
  const minutes = Math.floor(left / 60_000);
  const days = Math.floor(minutes / 1440), hours = Math.floor((minutes % 1440) / 60), mins = minutes % 60;
  return days ? `${days} day${days === 1 ? "" : "s"} ${hours} hr${hours === 1 ? "" : "s"}` : hours ? `${hours} hr${hours === 1 ? "" : "s"} ${mins} min` : `${mins} min`;
}

export function renderEmailHtml(design: EmailDesign, opts: RenderOptions = {}): string {
  const raw = { ...DEFAULT_STYLES, ...(design.styles ?? {}) };
  const styles = { ...raw, backgroundColor: brandColorOf(raw.backgroundColor), brandColor: brandColorOf(raw.brandColor), accentColor: brandColorOf(raw.accentColor) };
  const font = escapeHtml(styles.fontFamily || DEFAULT_STYLES.fontFamily);
  const logoSrc = safeUrl(opts.logoUrl ?? "");
  const brandText = (value: string) => (value.trim() && value.trim() !== "Our Store" ? value : opts.brand || value);
  const logoImg = (size: number, light = false) => logoSrc ? `<img src="${escapeHtml(logoSrc)}" alt="" width="${size}" height="${size}" style="display:block;width:${size}px;height:${size}px;border:0;border-radius:10px${light ? ";background:#FFFFFF" : ""}">` : "";
  const text = color(styles.textColor, DEFAULT_STYLES.textColor);
  const brandColor = color(styles.brandColor, DEFAULT_STYLES.brandColor);
  const accent = color(styles.accentColor, DEFAULT_STYLES.accentColor);
  const radius = clampNumber(styles.radius, 0, 32, 16);
  let linkIndex = 0;
  const href = (url: string, label: string) => {
    const safe = safeUrl(url);
    if (!safe) return "";
    linkIndex += 1;
    return escapeHtml(opts.linkFor ? opts.linkFor(safe, label) : safe);
  };
  const t = (value: string) => escapeHtml(applyTags(value, opts)).replace(/\n/g, "<br>");
  const rows: string[] = [];
  const wrap = (block: EmailBlock, inner: string, pad = "16px 28px") => {
    const mark = opts.editor ? ` data-block-id="${escapeHtml(block.id)}"${opts.selectedId === block.id ? " data-selected=\"1\"" : ""}` : "";
    rows.push(`<tr><td${mark} style="padding:${pad};font-family:${font};color:${text}">${inner}</td></tr>`);
  };
  const buttonHtml = (label: string, link: string, look: { bg: string; fg: string; radius: number; size: string; style: string }) => {
    const pads = look.size === "small" ? "8px 16px" : look.size === "medium" ? "11px 22px" : "15px 34px";
    const fontSize = look.size === "small" ? 13 : look.size === "medium" ? 15 : 17;
    const url = href(link, label) || "#";
    if (look.style === "link") return `<a href="${url}" style="color:${look.bg};font-weight:700;font-size:${fontSize}px;text-decoration:underline">${t(label)}</a>`;
    const outline = look.style === "secondary";
    const fg = readableOn(look.bg, look.fg);
    return `<a href="${url}" style="display:inline-block;padding:${pads};border-radius:${look.radius}px;background:${outline ? "transparent" : look.bg};border:2px solid ${look.bg};color:${outline ? look.bg : fg};font-weight:800;font-size:${fontSize}px;text-decoration:none;font-family:${font}">${t(label)}</a>`;
  };

  for (const block of design.blocks ?? []) {
    if (opts.plain && ["hero", "cover", "image", "video", "features", "offer", "spacer", "divider", "html"].includes(block.type)) {
      if (block.type === "cover") {
        wrap(block, `<p style="margin:0 0 8px;font-size:22px;font-weight:800">${t(block.title)}</p><p style="margin:0 0 12px">${t(block.subtitle)}</p>${block.buttonLink ? `<a href="${href(block.buttonLink, block.buttonText) || "#"}" style="color:${brandColor};font-weight:700">${t(block.buttonText)}</a>` : ""}`);
      }
      if (block.type === "hero") {
        wrap(block, `<p style="margin:0 0 8px;font-size:22px;font-weight:800">${t(`${block.title} ${block.highlight}`.trim())}</p><p style="margin:0 0 12px">${t(block.subtitle)}</p>${block.buttonLink ? `<a href="${href(block.buttonLink, block.buttonText) || "#"}" style="color:${brandColor};font-weight:700">${t(block.buttonText)}</a>` : ""}`);
      }
      continue;
    }
    switch (block.type) {
      case "header": {
        // The logo and name, in the brand's charcoal (like the e-receipts).
        const name = `<div style="font-size:24px;font-weight:900;letter-spacing:.5px;text-transform:uppercase;line-height:1.05;color:${BRAND_PALETTE.charcoal}">${t(brandText(block.brand))}</div>`;
        const tagline = block.tagline ? `<div style="font-size:12.5px;color:#6B7280;margin-top:3px">${t(block.tagline)}</div>` : "";
        const align = block.align === "left" ? "left" : block.align === "right" ? "right" : "center";
        wrap(block, logoSrc
          ? `<table role="presentation" cellpadding="0" cellspacing="0" align="${align}" style="${align === "center" ? "margin:0 auto" : ""}"><tr><td valign="middle">${logoImg(44)}</td><td valign="middle" style="padding-left:12px;text-align:left;font-family:${font}">${name}${tagline}</td></tr></table>`
          : `<div style="text-align:${align}">${name}${tagline}</div>`, "22px 28px 14px");
        break;
      }
      case "hero": {
        const badge = block.badgeMain
          ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:14px"><tr><td align="center" valign="middle" width="96" height="96" style="width:96px;height:96px;border-radius:48px;background:${accent};color:#1F1147;font-family:${font};text-align:center;line-height:1.05">${block.badgeTop ? `<div style="font-size:12px;font-weight:700">${t(block.badgeTop)}</div>` : ""}<div style="font-size:26px;font-weight:900">${t(block.badgeMain)}</div>${block.badgeBottom ? `<div style="font-size:14px;font-weight:900">${t(block.badgeBottom)}</div>` : ""}</td></tr></table>`
          : "";
        const image = safeUrl(block.imageUrl)
          ? `<img src="${escapeHtml(safeUrl(block.imageUrl))}" alt="" width="220" style="display:block;width:100%;max-width:220px;height:auto;border:0;margin:0 auto">`
          : "";
        const button = block.buttonText && block.buttonLink
          ? `<div style="text-align:center;padding-top:18px">${buttonHtml(block.buttonText, block.buttonLink, { bg: accent, fg: "#1F1147", radius: 999, size: "large", style: "primary" })}</div>`
          : "";
        const mark = opts.editor ? ` data-block-id="${escapeHtml(block.id)}"${opts.selectedId === block.id ? " data-selected=\"1\"" : ""}` : "";
        const narrow = !!opts.mobile;
        const textCell = `<td class="st" valign="top" style="padding:28px 0 0 28px;font-family:${font};${narrow ? "display:block;width:100%;padding:24px 22px 0" : "width:58%"}"><div style="font-size:30px;line-height:1.1;font-weight:900;color:#FFFFFF">${t(block.title)}</div><div style="font-size:30px;line-height:1.1;font-weight:900;color:${accent}">${t(block.highlight)}</div><div style="font-size:15px;line-height:1.4;color:#EDE9FE;margin-top:12px">${t(block.subtitle)}</div>${badge}</td>`;
        const imageCell = `<td class="st" valign="middle" style="padding:22px 22px 0 8px;${narrow ? "display:block;width:100%;padding:16px 22px 0" : "width:42%"}">${image}</td>`;
        rows.push(`<tr><td${mark} style="padding:0 16px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${brandColor};background-image:linear-gradient(135deg,${brandColor} 0%,${accent} 100%);border-radius:${Math.max(0, radius - 2)}px;border-bottom:5px solid ${accent}"><tr>${textCell}${imageCell}</tr><tr><td colspan="2" style="padding:0 22px 24px">${button}</td></tr></table></td></tr>`);
        break;
      }
      case "cover": {
        const [top, bottom] = COVER_TONES[block.tone] ?? COVER_TONES.lavender;
        const src = safeUrl(block.imageUrl);
        const picture = src
          ? `<img src="${escapeHtml(src)}" alt="" width="${block.big ? 520 : 260}" style="display:block;width:100%;max-width:${block.big ? 520 : 260}px;height:auto;border:0;margin:18px auto 0;border-radius:12px">`
          : block.emoji ? `<div style="font-size:56px;line-height:1.1;margin-top:16px">${t(block.emoji)}</div>` : "";
        const purple = block.buttonTone === "purple";
        const button = block.buttonText && block.buttonLink
          ? `<div style="text-align:center;padding-top:18px">${buttonHtml(block.buttonText, block.buttonLink, { bg: purple ? brandColor : accent, fg: purple ? "#FFFFFF" : "#1F1147", radius: 12, size: "large", style: "primary" })}</div>`
          : "";
        const mark = opts.editor ? ` data-block-id="${escapeHtml(block.id)}"${opts.selectedId === block.id ? " data-selected=\"1\"" : ""}` : "";
        rows.push(`<tr><td${mark} style="padding:0 16px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${bottom}" style="background:${bottom};background-image:linear-gradient(180deg,${top} 0%,${bottom} 100%);border-radius:${Math.max(0, radius - 2)}px"><tr><td align="center" style="padding:30px 24px 28px;font-family:${font};text-align:center"><div style="font-size:30px;line-height:1.15;font-weight:900;color:#14112B">${t(block.title)}</div>${block.subtitle ? `<div style="font-size:15px;line-height:1.45;color:#3A3556;margin-top:10px">${t(block.subtitle)}</div>` : ""}${picture}${button}</td></tr></table></td></tr>`);
        break;
      }
      case "text": {
        const size = clampNumber(block.size, 11, 40, 15);
        wrap(block, `<div style="font-size:${size}px;line-height:1.55;text-align:${block.align};font-weight:${block.bold ? 800 : 400};color:${color(block.color, text)}">${t(block.text)}</div>`, "10px 28px");
        break;
      }
      case "image": {
        const src = safeUrl(block.url);
        if (!src) { if (opts.editor) wrap(block, `<div style="padding:28px;border:2px dashed #C9BEF5;border-radius:12px;text-align:center;color:#7C6BC4;font-size:14px">Add a picture</div>`); break; }
        const width = clampNumber(block.width, 20, 100, 100);
        const img = `<img src="${escapeHtml(src)}" alt="${escapeHtml(block.alt)}" style="display:block;width:${width}%;max-width:${Math.round(5.44 * width)}px;height:auto;border:0;margin:0 auto;border-radius:12px">`;
        wrap(block, block.link ? `<a href="${href(block.link, block.alt || "Image") || "#"}">${img}</a>` : img, "10px 28px");
        break;
      }
      case "button": {
        wrap(block, `<div style="text-align:${block.align}">${buttonHtml(block.text, block.link, { bg: color(brandColorOf(block.color), accent), fg: color(block.textColor, "#1F1147"), radius: clampNumber(block.radius, 0, 40, 10), size: block.size, style: block.style })}</div>`, "14px 28px");
        break;
      }
      case "product": {
        const src = safeUrl(block.imageUrl);
        wrap(block, `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #ECE8FB;border-radius:14px"><tr>${src ? `<td width="120" style="padding:14px"><img src="${escapeHtml(src)}" alt="" width="110" style="display:block;width:110px;height:auto;border:0;border-radius:10px"></td>` : ""}<td style="padding:14px;font-family:${font}"><div style="font-size:17px;font-weight:800;color:${BRAND_PALETTE.charcoal}">${t(block.name)}</div>${block.price ? `<div style="font-size:14px;font-weight:700;color:${brandColor};margin-top:4px">${t(block.price)}</div>` : ""}${block.link ? `<div style="margin-top:12px">${buttonHtml(block.buttonText || "Order Now", block.link, { bg: accent, fg: "#FFFFFF", radius: 10, size: "medium", style: "primary" })}</div>` : ""}</td></tr></table>`, "10px 28px");
        break;
      }
      case "offer": {
        const bg = color(brandColorOf(block.color), accent), fg = readableOn(bg, color(block.textColor, "#1F1147"));
        wrap(block, `<table role="presentation" align="center" cellpadding="0" cellspacing="0"><tr><td align="center" valign="middle" width="120" height="120" style="width:120px;height:120px;border-radius:60px;background:${bg};color:${fg};text-align:center;font-family:${font};line-height:1.05">${block.top ? `<div style="font-size:13px;font-weight:700">${t(block.top)}</div>` : ""}<div style="font-size:32px;font-weight:900">${t(block.main)}</div>${block.bottom ? `<div style="font-size:16px;font-weight:900">${t(block.bottom)}</div>` : ""}</td></tr></table>`, "12px 28px");
        break;
      }
      case "divider":
        wrap(block, `<div style="border-top:${clampNumber(block.thickness, 1, 8, 1)}px solid ${color(block.color, "#E5E7EB")};font-size:0;line-height:0">&nbsp;</div>`, "10px 28px");
        break;
      case "spacer":
        wrap(block, `<div style="height:${clampNumber(block.height, 4, 120, 24)}px;font-size:0;line-height:0">&nbsp;</div>`, "0 28px");
        break;
      case "social": {
        const items: string[] = [];
        const add = (url: string, label: string) => { const link = href(url, label); if (link) items.push(`<a href="${link}" style="display:inline-block;margin:0 6px;padding:8px 12px;border-radius:999px;background:#F1EEFD;color:${brandColor};font-size:13px;font-weight:700;text-decoration:none">${label}</a>`); };
        add(block.facebook, "Facebook"); add(block.instagram, "Instagram"); add(block.tiktok, "TikTok"); if (block.whatsapp.trim()) add(whatsappUrl(block.whatsapp), "WhatsApp");
        if (items.length || opts.editor) wrap(block, `<div style="text-align:${block.align}">${items.join("") || `<span style="color:#9CA3AF;font-size:13px">Add your social links</span>`}</div>`, "12px 28px");
        break;
      }
      case "timer": {
        const left = timeLeftText(block.endsAt, opts.nowMs ?? Date.now());
        wrap(block, `<div style="text-align:center;background:#1F1147;border-radius:12px;padding:14px;color:#FFFFFF"><div style="font-size:13px;color:#C4B5FD">${t(block.label)}</div><div style="font-size:24px;font-weight:900;margin-top:4px;color:${accent}">⏰ ${escapeHtml(left)}</div></div>`, "12px 28px");
        break;
      }
      case "video": {
        const thumb = safeUrl(block.thumbnailUrl);
        const link = href(block.url, block.caption || "Video") || "#";
        wrap(block, `<a href="${link}" style="display:block;text-decoration:none;text-align:center">${thumb ? `<img src="${escapeHtml(thumb)}" alt="" style="display:block;width:100%;height:auto;border:0;border-radius:12px">` : `<div style="padding:40px;background:#1F1147;border-radius:12px;color:#fff;font-size:30px">▶</div>`}<div style="margin-top:8px;color:${brandColor};font-weight:700;font-size:14px">▶ ${t(block.caption || "Watch the video")}</div></a>`, "12px 28px");
        break;
      }
      case "review":
        if (!block.quote.trim()) { if (opts.editor) wrap(block, `<div style="padding:22px;border:2px dashed #C9BEF5;border-radius:12px;text-align:center;color:#7C6BC4;font-size:14px">Pick a customer review</div>`); break; }
        wrap(block, `<div style="background:#F8F6FF;border-left:4px solid ${brandColor};border-radius:10px;padding:14px 16px"><div style="color:#F59E0B;font-size:15px">★★★★★</div><div style="font-size:15px;font-style:italic;margin-top:6px">“${t(block.quote)}”</div><div style="font-size:13px;color:#6B7280;margin-top:6px">— ${t(block.name)}${block.productName ? `, on ${t(block.productName)}` : ""}</div></div>`, "12px 28px");
        break;
      case "html":
        wrap(block, String(block.html ?? ""), "10px 28px");
        break;
      case "features": {
        const items = (block.items ?? []).slice(0, 4);
        if (!items.length) break;
        const width = Math.floor(100 / items.length);
        const cells = items.map((item) => `<td class="st" valign="top" width="${width}%" style="padding:6px;${opts.mobile ? "display:block;width:100%" : ""}"><div style="background:${BRAND_PALETTE.mist};border-radius:12px;padding:14px 8px;text-align:center;font-family:${font}"><div style="font-size:24px">${FEATURE_ICONS[item.icon] ?? "✨"}</div><div style="font-size:13px;font-weight:800;color:${BRAND_PALETTE.charcoal};margin-top:6px">${t(item.title)}</div></div></td>`).join("");
        wrap(block, `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${cells}</tr></table>`, "10px 22px");
        break;
      }
      case "footer": {
        const parts = block.text.split("|").map((part) => part.trim()).filter(Boolean);
        const icon = (part: string) => /deliver|door|ship/i.test(part) ? "🚚" : /pay|cash|pod/i.test(part) ? "💵" : /trust|home|customer|review/i.test(part) ? "⭐" : /call|phone|whatsapp/i.test(part) ? "📞" : "•";
        // A charcoal band with the logo and name (like the e-receipts), the promises under it.
        const mark = opts.editor ? ` data-block-id="${escapeHtml(block.id)}"${opts.selectedId === block.id ? " data-selected=\"1\"" : ""}` : "";
        const promises = parts.length ? `<div style="font-size:12.5px;color:#E5E7EB;margin-top:12px">${parts.map((part) => `${icon(part)} ${t(part)}`).join(`<span style="color:#6B7280">&nbsp;&nbsp;|&nbsp;&nbsp;</span>`)}</div>` : "";
        const brandLine = `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto"><tr>${logoSrc ? `<td valign="middle" style="padding-right:10px">${logoImg(36, true)}</td>` : ""}<td valign="middle" style="font-family:${font};font-size:20px;font-weight:900;letter-spacing:.5px;text-transform:uppercase;color:#FFFFFF">${escapeHtml(opts.brand || "")}</td></tr></table>`;
        rows.push(`<tr><td${mark} style="padding:14px 0 0;background:${color(styles.contentColor, "#FFFFFF")}"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND_PALETTE.charcoal}"><tr><td style="padding:0"><div style="height:18px;background:${color(styles.contentColor, "#FFFFFF")};border-radius:0 0 50% 50% / 0 0 100% 100%"></div></td></tr><tr><td align="center" style="padding:16px 24px 22px;font-family:${font};text-align:center">${opts.brand || logoSrc ? brandLine : ""}${promises}</td></tr></table></td></tr>`);
        break;
      }
    }
  }

  const brand = escapeHtml(opts.brand || "us");
  const legal = opts.unsubscribeUrl
    ? `<tr><td style="padding:18px 24px 6px;text-align:center;font-family:${font};font-size:12px;line-height:1.5;color:#6B7280">${opts.footerNote ? `${escapeHtml(opts.footerNote)}<br>` : ""}You are getting this email because you ordered from ${brand} or asked for our offers.<br><a href="${escapeHtml(opts.unsubscribeUrl)}" style="color:#6B7280;text-decoration:underline">Unsubscribe</a> and we will not email you again.</td></tr>`
    : opts.editor ? "" : `<tr><td style="padding:18px 24px 6px;text-align:center;font-family:${font};font-size:12px;color:#9CA3AF">${opts.footerNote ? `${escapeHtml(opts.footerNote)}<br>` : ""}Unsubscribe link goes here.</td></tr>`;
  const pixel = opts.openPixelUrl ? `<img src="${escapeHtml(opts.openPixelUrl)}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0">` : "";
  const preheader = opts.preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${escapeHtml(opts.preheader)}${"&nbsp;&zwnj;".repeat(40)}</div>` : "";
  const editorCss = opts.editor
    ? `[data-block-id]{cursor:pointer;outline-offset:-2px}[data-block-id]:hover{outline:2px dashed #B9A8F5}[data-selected="1"]{outline:2px solid #5B3FD9!important}`
    : "";
  const width = opts.mobile ? 375 : 600;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><title>${escapeHtml(opts.preheader ?? "")}</title><style>body{margin:0;padding:0}img{-ms-interpolation-mode:bicubic}@media (max-width:620px){.c{width:100%!important}.st{display:block!important;width:100%!important;box-sizing:border-box}}${editorCss}</style></head>`
    + `<body style="margin:0;padding:0;background:${color(styles.backgroundColor, DEFAULT_STYLES.backgroundColor)}">${preheader}`
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${color(styles.backgroundColor, DEFAULT_STYLES.backgroundColor)}"><tr><td align="center" style="padding:${opts.mobile ? "12px 8px" : "24px 12px"}">`
    + `<table role="presentation" class="c" width="${width}" cellpadding="0" cellspacing="0" style="width:${width}px;max-width:${width}px;background:${color(styles.contentColor, "#FFFFFF")};border-radius:${radius}px;overflow:hidden">${rows.join("")}</table>`
    + `<table role="presentation" class="c" width="${width}" cellpadding="0" cellspacing="0" style="width:${width}px;max-width:${width}px">${legal}</table>`
    + `${pixel}</td></tr></table></body></html>`;
}

/** The plain-text copy sent beside the HTML. */
export function renderEmailText(design: EmailDesign, opts: RenderOptions = {}): string {
  const lines: string[] = [];
  const tag = (value: string) => applyTags(value, opts);
  const link = (url: string, label: string) => { const safe = safeUrl(url); return safe ? (opts.linkFor ? opts.linkFor(safe, label) : safe) : ""; };
  for (const block of design.blocks ?? []) {
    switch (block.type) {
      case "header": lines.push(tag(block.brand)); break;
      case "cover": lines.push(tag(block.title), tag(block.subtitle)); if (block.buttonLink) lines.push(`${tag(block.buttonText)}: ${link(block.buttonLink, block.buttonText)}`); break;
      case "hero": lines.push(tag(`${block.title} ${block.highlight}`.trim()), tag(block.subtitle)); if (block.buttonLink) lines.push(`${tag(block.buttonText)}: ${link(block.buttonLink, block.buttonText)}`); break;
      case "text": lines.push(tag(block.text)); break;
      case "button": if (block.link) lines.push(`${tag(block.text)}: ${link(block.link, block.text)}`); break;
      case "product": lines.push(`${tag(block.name)}${block.price ? ` (${block.price})` : ""}`); if (block.link) lines.push(link(block.link, block.name)); break;
      case "offer": lines.push([block.top, block.main, block.bottom].filter(Boolean).join(" ")); break;
      case "timer": lines.push(`${tag(block.label)} ${timeLeftText(block.endsAt, opts.nowMs ?? Date.now())}`); break;
      case "video": if (block.url) lines.push(`${tag(block.caption)}: ${link(block.url, block.caption)}`); break;
      case "review": if (block.quote.trim()) lines.push(`"${tag(block.quote)}" - ${tag(block.name)}`); break;
      case "features": lines.push(block.items.map((item) => item.title).join(" · ")); break;
      case "footer": lines.push(block.text); break;
      default: break;
    }
  }
  if (opts.unsubscribeUrl) lines.push("", `Unsubscribe: ${opts.unsubscribeUrl}`);
  return lines.filter((line, index) => line.trim() || index > 0).join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** A design read from storage: unknown block types dropped, styles filled in. */
export function normalizeDesign(raw: unknown): EmailDesign | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Partial<EmailDesign>;
  if (!Array.isArray(value.blocks)) return null;
  const known = new Set<EmailBlockType>(["header", "hero", "text", "image", "button", "product", "offer", "divider", "spacer", "social", "timer", "video", "review", "html", "features", "footer", "cover"]);
  return {
    version: 1,
    template: typeof value.template === "string" ? value.template : "product_promo",
    touched: !!value.touched,
    styles: { ...DEFAULT_STYLES, ...(value.styles ?? {}) },
    blocks: value.blocks.filter((block): block is EmailBlock => !!block && typeof block === "object" && known.has((block as EmailBlock).type) && typeof (block as EmailBlock).id === "string")
  };
}
