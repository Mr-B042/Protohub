import type { EmailDesign } from "../../lib/email-render";

/**
 * A template's card cover, as in Bright's Templates design: a short, bold
 * poster (headline, one line, a picture or an emoji, a button) on a soft
 * colour. The full email opens with Preview. Pictures are the business's
 * own product photos.
 */

type Visual = "photo" | "stars" | string;
type Cover = { title: string; sub: string; visual: Visual; cta?: string; ctaTone?: "yellow" | "purple"; bg: string };

const BG = {
  mint: "from-[#ECFDF3] to-[#D9F7E5]", lavender: "from-[#F6F3FF] to-[#E6DEFF]", peach: "from-[#FFF5EC] to-[#FFE3CC]", pink: "from-[#FFF1F3] to-[#FFDDE3]",
  sky: "from-[#F1F6FF] to-[#DDE8FF]", teal: "from-[#ECFDFB] to-[#CFF5EF]", lilac: "from-[#FBF2FF] to-[#EED9FF]"
};

export const COVERS: Record<string, Cover> = {
  promo_offer: { title: "Don't Miss Out!", sub: "A special offer just for you.", visual: "photo", cta: "Shop Now", ctaTone: "yellow", bg: BG.mint },
  product_collection: { title: "Picked For Your Home", sub: "See what customers are ordering.", visual: "photo", cta: "Order Now", ctaTone: "purple", bg: BG.lavender },
  flash_sale: { title: "Ends Soon! ⏰", sub: "Order before the timer runs out.", visual: "photo", cta: "Order Now", ctaTone: "yellow", bg: BG.peach },
  win_back_offer: { title: "We Miss You! 👋", sub: "It's been a while. Here's a reason to come back.", visual: "🎁", cta: "Come Back", ctaTone: "purple", bg: BG.lavender },
  order_confirmation: { title: "Thanks for Your Order! 🎉", sub: "Your order is confirmed and being prepared.", visual: "📦", bg: BG.lavender },
  review_request: { title: "How's Your Product? 😊", sub: "We'd love to hear your experience.", visual: "stars", cta: "Tell Us", ctaTone: "purple", bg: BG.sky },
  usage_tips: { title: "A Few Quick Tips 💡", sub: "Get the most from your order.", visual: "photo", cta: "See Tips", ctaTone: "purple", bg: BG.teal },
  cart_reminder: { title: "You Left Something in Your Cart! 🛒", sub: "Complete your order now before it's gone.", visual: "photo", cta: "Complete Order", ctaTone: "yellow", bg: BG.pink },
  welcome_email: { title: "Welcome! 🎉", sub: "Thanks for joining. Get ready for deals, tips, and more.", visual: "👋", bg: BG.sky },
  new_arrival: { title: "New Arrival! ✨", sub: "Check out our latest product.", visual: "photo", cta: "Explore Now", ctaTone: "yellow", bg: BG.lilac },
  still_interested: { title: "Still Interested? 🤔", sub: "The item you viewed is still available.", visual: "photo", cta: "Shop Now", ctaTone: "yellow", bg: BG.peach },
  announcement: { title: "Some Good News 📣", sub: "An update we wanted you to hear first.", visual: "📣", cta: "Read More", ctaTone: "purple", bg: BG.lilac },
  newsletter: { title: "This Month 📰", sub: "Updates, tips, and picks for you.", visual: "📰", cta: "Read Now", ctaTone: "purple", bg: BG.lavender },
  seasonal_sale: { title: "Holiday Specials 🎁", sub: "Make the season easier.", visual: "photo", cta: "Shop The Sale", ctaTone: "yellow", bg: BG.teal },
  blank: { title: "Start Blank", sub: "Your logo, one line and the footer.", visual: "✏️", bg: BG.lavender }
};

/** A saved template's cover, read from its own design (first headline, first picture). */
function coverFromDesign(design: EmailDesign, name: string): Cover {
  let title = "", sub = "", photo = "";
  for (const block of design.blocks ?? []) {
    if (block.type === "hero") { title ||= `${block.title} ${block.highlight}`.trim(); sub ||= block.subtitle; photo ||= block.imageUrl; }
    if (block.type === "text" && block.size >= 20 && !/\{\{/.test(block.text)) title ||= block.text;
    if (block.type === "text" && block.size < 20 && !sub && !/\{\{/.test(block.text)) sub = block.text;
    if ((block.type === "image" && block.url) || (block.type === "product" && block.imageUrl)) photo ||= block.type === "image" ? block.url : block.imageUrl;
  }
  return { title: title || name, sub: sub.slice(0, 90), visual: photo ? `url:${photo}` : "✉️", bg: BG.lavender };
}

export default function TemplateCover({ starterKey, design, name, brand, photo, height = 220, small = false }: {
  starterKey?: string | null; design?: EmailDesign; name: string; brand: string; photo: string; height?: number; small?: boolean;
}) {
  const base = (starterKey && COVERS[starterKey]) || (design ? coverFromDesign(design, name) : COVERS.blank);
  const cover = starterKey === "welcome_email" ? { ...base, title: `Welcome to ${brand}! 🎉` } : base;
  const picture = cover.visual === "photo" ? photo : cover.visual.startsWith("url:") ? cover.visual.slice(4) : "";
  const s = small ? 0.62 : 1;
  return (
    <div className={`flex flex-col items-center overflow-hidden bg-gradient-to-b ${cover.bg} px-3 text-center`} style={{ height, paddingTop: 30 * s, paddingBottom: 8 * s }}>
      <div className="flex items-center gap-1 font-extrabold text-gray-900" style={{ fontSize: 12 * s }}>
        <span className="inline-flex items-center justify-center rounded-full bg-[#5B3FD9] text-white" style={{ width: 14 * s, height: 14 * s, fontSize: 8 * s }}>✦</span>{brand}
      </div>
      <div className="mt-1.5 line-clamp-2 font-black leading-tight tracking-tight text-[#14112B]" style={{ fontSize: 21 * s }}>{cover.title}</div>
      {cover.sub && <div className="mt-1 line-clamp-2 text-[#3A3556]" style={{ fontSize: 11.5 * s, maxWidth: 220 * s }}>{cover.sub}</div>}
      <div className="relative mt-2 flex min-h-0 w-full flex-1 items-end justify-center">
        {picture ? <img src={picture} alt="" className="h-full max-w-[82%] rounded-lg object-contain drop-shadow-md" style={{ maxHeight: 118 * s }} />
          : cover.visual === "stars" ? <span style={{ fontSize: 24 * s, letterSpacing: 2 }}>⭐⭐⭐⭐⭐</span>
          : <span style={{ fontSize: 54 * s, lineHeight: 1 }}>{cover.visual}</span>}
        {cover.cta && (
          <span className={`absolute bottom-1 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-lg font-bold shadow-md ${cover.ctaTone === "yellow" ? "bg-[#FFC107] text-[#1F1147]" : "bg-[#5B3FD9] text-white"}`}
            style={{ fontSize: 11 * s, padding: `${5 * s}px ${12 * s}px` }}>{cover.cta} →</span>
        )}
      </div>
    </div>
  );
}
