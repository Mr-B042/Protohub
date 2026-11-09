import { COVER_TONES, type EmailBlock, type EmailDesign } from "../../lib/email-render";
import { emailBrandNow } from "../../lib/email-brand-store";

/**
 * A template's card (Bright's Templates design). It is drawn from the email's
 * own cover section (headline, line, picture or emoji, button, colour), so
 * the card and the email that opens from it always match. A saved template
 * with no cover uses its first headline and picture.
 */

type Cover = Extract<EmailBlock, { type: "cover" }>;

function coverOf(design: EmailDesign, name: string): Cover {
  const found = design.blocks?.find((block): block is Cover => block.type === "cover");
  if (found) return found;
  let title = "", subtitle = "", imageUrl = "";
  for (const block of design.blocks ?? []) {
    if (block.type === "hero") { title ||= `${block.title} ${block.highlight}`.trim(); subtitle ||= block.subtitle; imageUrl ||= block.imageUrl; }
    if (block.type === "text" && !/\{\{/.test(block.text)) { if (block.size >= 20) title ||= block.text; else subtitle ||= block.text; }
    if (block.type === "image" && block.url) imageUrl ||= block.url;
    if (block.type === "product" && block.imageUrl) imageUrl ||= block.imageUrl;
  }
  return { id: "", type: "cover", title: title || name, subtitle: subtitle.slice(0, 90), imageUrl, emoji: imageUrl ? "" : "✉️", buttonText: "", buttonLink: "", buttonTone: "purple", tone: "lavender" };
}

export default function TemplateCover({ design, name, brand, height = 220, small = false }: { design: EmailDesign; name: string; brand: string; height?: number; small?: boolean }) {
  const cover = coverOf(design, name);
  const brandNow = emailBrandNow();
  const logo = brandNow.logoUrl;
  const [top, bottom] = COVER_TONES[cover.tone] ?? COVER_TONES.lavender;
  const s = small ? 0.62 : 1;
  return (
    <div className="flex flex-col items-center overflow-hidden px-3 text-center" style={{ height, paddingTop: 30 * s, paddingBottom: 8 * s, background: `linear-gradient(180deg, ${top}, ${bottom})` }}>
      <div className="flex items-center gap-1.5 font-black uppercase tracking-wide text-[#26262E]" style={{ fontSize: 12 * s }}>{logo ? <img src={logo} alt="" className="rounded" style={{ width: 18 * s, height: 18 * s }} /> : null}{brand || brandNow.name}</div>
      <div className="mt-1.5 line-clamp-2 font-black leading-tight tracking-tight text-[#14112B]" style={{ fontSize: 21 * s }}>{cover.title}</div>
      {cover.subtitle && <div className="mt-1 line-clamp-2 text-[#3A3556]" style={{ fontSize: 11.5 * s, maxWidth: 230 * s }}>{cover.subtitle}</div>}
      <div className="relative mt-2 flex min-h-0 w-full flex-1 items-end justify-center">
        {cover.imageUrl ? <img src={cover.imageUrl} alt="" className="h-full max-w-[82%] rounded-lg object-contain drop-shadow-md" style={{ maxHeight: 118 * s }} />
          : <span style={{ fontSize: cover.emoji.length > 4 ? 22 * s : 54 * s, lineHeight: 1 }}>{cover.emoji}</span>}
        {cover.buttonText && (
          <span className={`absolute bottom-1 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-lg font-bold shadow-md ${cover.buttonTone === "purple" ? "bg-[#26262E] text-white" : "bg-[#2A98DE] text-white"}`}
            style={{ fontSize: 11 * s, padding: `${5 * s}px ${12 * s}px` }}>{cover.buttonText}</span>
        )}
      </div>
    </div>
  );
}
