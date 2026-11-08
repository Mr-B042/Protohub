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
  | { id: string; type: "button"; text: string; link: string; style: "primary" | "secondary" | "link"; size: "small" | "medium" | "large"; align: Align; color: string; textColor: string; radius: number }
  | { id: string; type: "product"; productId: string; name: string; price: string; imageUrl: string; buttonText: string; link: string }
  | { id: string; type: "offer"; top: string; main: string; bottom: string; color: string; textColor: string }
  | { id: string; type: "divider"; color: string; thickness: number }
  | { id: string; type: "spacer"; height: number }
  | { id: string; type: "social"; facebook: string; instagram: string; tiktok: string; whatsapp: string; align: Align }
  | { id: string; type: "timer"; endsAt: string; label: string }
  | { id: string; type: "video"; url: string; thumbnailUrl: string; caption: string }
  | { id: string; type: "review"; reviewId: string; quote: string; name: string; productName: string }
  | { id: string; type: "html"; html: string }
  | { id: string; type: "features"; items: FeatureItem[] }
  | { id: string; type: "footer"; text: string };

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

export const DEFAULT_STYLES: EmailStyles = {
  backgroundColor: "#F4F2FB",
  contentColor: "#FFFFFF",
  brandColor: "#5B3FD9",
  accentColor: "#FFC107",
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

/** A fresh block from the left-hand list. */
export function newBlock(type: EmailBlockType, fields?: Partial<CampaignFields>): EmailBlock {
  const id = blockId();
  switch (type) {
    case "header": return { id, type, brand: fields?.brand || "Our Store", tagline: "Smart Home • Kitchen • Lifestyle", align: "center" };
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
  const styles = { ...DEFAULT_STYLES, ...(design.styles ?? {}) };
  const font = escapeHtml(styles.fontFamily || DEFAULT_STYLES.fontFamily);
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
    return `<a href="${url}" style="display:inline-block;padding:${pads};border-radius:${look.radius}px;background:${outline ? "transparent" : look.bg};border:2px solid ${look.bg};color:${outline ? look.bg : look.fg};font-weight:800;font-size:${fontSize}px;text-decoration:none;font-family:${font}">${t(label)}</a>`;
  };

  for (const block of design.blocks ?? []) {
    if (opts.plain && ["hero", "image", "video", "features", "offer", "spacer", "divider", "html"].includes(block.type)) {
      if (block.type === "hero") {
        wrap(block, `<p style="margin:0 0 8px;font-size:22px;font-weight:800">${t(`${block.title} ${block.highlight}`.trim())}</p><p style="margin:0 0 12px">${t(block.subtitle)}</p>${block.buttonLink ? `<a href="${href(block.buttonLink, block.buttonText) || "#"}" style="color:${brandColor};font-weight:700">${t(block.buttonText)}</a>` : ""}`);
      }
      continue;
    }
    switch (block.type) {
      case "header": {
        wrap(block, `<div style="text-align:${block.align};font-size:26px;font-weight:800;color:#1F1147">🛍️ ${t(block.brand)}</div>${block.tagline ? `<div style="text-align:${block.align};font-size:13px;color:#6B7280;margin-top:4px">${t(block.tagline)}</div>` : ""}`, "22px 28px 14px");
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
        rows.push(`<tr><td${mark} style="padding:0 16px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${brandColor};background-image:linear-gradient(135deg,${brandColor} 0%,#8B6CF2 100%);border-radius:${Math.max(0, radius - 2)}px;border-bottom:5px solid ${accent}"><tr>${textCell}${imageCell}</tr><tr><td colspan="2" style="padding:0 22px 24px">${button}</td></tr></table></td></tr>`);
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
        wrap(block, `<div style="text-align:${block.align}">${buttonHtml(block.text, block.link, { bg: color(block.color, accent), fg: color(block.textColor, "#1F1147"), radius: clampNumber(block.radius, 0, 40, 10), size: block.size, style: block.style })}</div>`, "14px 28px");
        break;
      }
      case "product": {
        const src = safeUrl(block.imageUrl);
        wrap(block, `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #ECE8FB;border-radius:14px"><tr>${src ? `<td width="120" style="padding:14px"><img src="${escapeHtml(src)}" alt="" width="110" style="display:block;width:110px;height:auto;border:0;border-radius:10px"></td>` : ""}<td style="padding:14px;font-family:${font}"><div style="font-size:17px;font-weight:800;color:#1F1147">${t(block.name)}</div>${block.price ? `<div style="font-size:14px;font-weight:700;color:${brandColor};margin-top:4px">${t(block.price)}</div>` : ""}${block.link ? `<div style="margin-top:12px">${buttonHtml(block.buttonText || "Order Now", block.link, { bg: brandColor, fg: "#FFFFFF", radius: 10, size: "medium", style: "primary" })}</div>` : ""}</td></tr></table>`, "10px 28px");
        break;
      }
      case "offer": {
        const bg = color(block.color, accent), fg = color(block.textColor, "#1F1147");
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
        const cells = items.map((item) => `<td class="st" valign="top" width="${width}%" style="padding:6px;${opts.mobile ? "display:block;width:100%" : ""}"><div style="background:#F6F4FE;border-radius:12px;padding:14px 8px;text-align:center;font-family:${font}"><div style="font-size:24px">${FEATURE_ICONS[item.icon] ?? "✨"}</div><div style="font-size:13px;font-weight:800;color:#1F1147;margin-top:6px">${t(item.title)}</div></div></td>`).join("");
        wrap(block, `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${cells}</tr></table>`, "10px 22px");
        break;
      }
      case "footer": {
        const parts = block.text.split("|").map((part) => part.trim()).filter(Boolean);
        const icon = (part: string) => /deliver|door|ship/i.test(part) ? "🚚" : /pay|cash|pod/i.test(part) ? "💵" : /trust|home|customer|review/i.test(part) ? "⭐" : /call|phone|whatsapp/i.test(part) ? "📞" : "•";
        wrap(block, `<div style="text-align:center;font-size:12.5px;color:#4B5563">${parts.map((part) => `${icon(part)} ${t(part)}`).join(`<span style="color:#D1D5DB">&nbsp;&nbsp;|&nbsp;&nbsp;</span>`)}</div>`, "14px 28px 22px");
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
  const known = new Set<EmailBlockType>(["header", "hero", "text", "image", "button", "product", "offer", "divider", "spacer", "social", "timer", "video", "review", "html", "features", "footer"]);
  return {
    version: 1,
    template: typeof value.template === "string" ? value.template : "product_promo",
    touched: !!value.touched,
    styles: { ...DEFAULT_STYLES, ...(value.styles ?? {}) },
    blocks: value.blocks.filter((block): block is EmailBlock => !!block && typeof block === "object" && known.has((block as EmailBlock).type) && typeof (block as EmailBlock).id === "string")
  };
}
