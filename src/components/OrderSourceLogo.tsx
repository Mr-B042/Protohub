import { type SVGProps, useId } from "react";

type OrderSourceLogoKey =
  | "facebook"
  | "instagram"
  | "audience-network"
  | "threads"
  | "messenger"
  | "whatsapp"
  | "tiktok"
  | "youtube"
  | "website";

type OrderSourceLogoProps = SVGProps<SVGSVGElement> & {
  source?: string | null;
};

const FACEBOOK_GLYPH =
  "M36.7 17.8h-4.3c-3.7 0-6.1 2.5-6.1 6.5v4.1h-4.2v6.4h4.2V47h7.9V34.8h5.3l1.1-6.4h-6.4v-2.9c0-1.8.8-2.8 2.9-2.8h3.6z";
const TIKTOK_GLYPH =
  "M37.2 16.2c1.5 4.5 4.7 7.1 9.7 8.1v6.2a17.8 17.8 0 0 1-7.7-1.9v9.2c0 6.5-5.2 11.3-11.8 11.3c-6.8 0-12.3-5.5-12.3-12.3c0-6.7 5.3-11.8 12-12.3v6a6.2 6.2 0 0 0-4 1.3a5.6 5.6 0 1 0 9.2 4.3V14.1h6.2c0 .8.2 1.5.7 2.1Z";
const WHATSAPP_GLYPH =
  "M12.04 2.25a9.74 9.74 0 0 0-8.35 14.75L2.25 21.75l4.86-1.28a9.73 9.73 0 0 0 4.93 1.33h.01a9.71 9.71 0 0 0 6.89-2.86a9.7 9.7 0 0 0 2.81-6.9a9.7 9.7 0 0 0-2.84-6.89a9.7 9.7 0 0 0-6.87-2.9Zm0 17.68h-.01a8.01 8.01 0 0 1-4.08-1.12l-.29-.17-2.8.73.75-2.72-.18-.29a8 8 0 0 1 1.23-10.01a7.97 7.97 0 0 1 5.37-2.23h.01a8 8 0 0 1 5.67 2.39a7.98 7.98 0 0 1 2.33 5.67a7.96 7.96 0 0 1-8 7.75Zm4.4-6c-.24-.12-1.42-.7-1.64-.78c-.22-.08-.38-.12-.53.13c-.16.24-.61.78-.75.93c-.14.16-.27.18-.5.06a6.52 6.52 0 0 1-1.92-1.18a7.2 7.2 0 0 1-1.34-1.66c-.14-.23 0-.36.1-.47c.1-.1.24-.28.36-.42c.12-.14.16-.24.24-.4c.08-.15.04-.29-.02-.42c-.06-.12-.54-1.3-.74-1.78c-.2-.48-.39-.41-.54-.42l-.46-.01c-.16 0-.41.07-.63.31c-.22.24-.82.8-.82 1.96s.85 2.29.97 2.44c.12.16 1.65 2.53 4 3.54c.56.24 1 .39 1.33.5c.56.18 1.08.15 1.48.09c.45-.07 1.42-.58 1.62-1.12c.2-.55.2-1.01.14-1.12c-.06-.09-.22-.16-.46-.27Z";

const normalizeOrderSourceLogoKey = (source?: string | null): OrderSourceLogoKey => {
  const value = (source ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");

  if (value === "fb" || value.includes("facebook") || value.includes("meta")) return "facebook";
  if (value === "ig" || value.includes("instagram") || value.includes("insta")) return "instagram";
  if (value === "an" || value.includes("audience network")) return "audience-network";
  if (value === "th" || value.includes("threads")) return "threads";
  if (value === "ms" || value.includes("messenger")) return "messenger";
  if (value === "wa" || value.includes("whatsapp")) return "whatsapp";
  if (value === "tt" || value.includes("tiktok") || value.includes("tik tok")) return "tiktok";
  if (value === "yt" || value.includes("youtube")) return "youtube";
  return "website";
};

const orderSourceLogoLabel = (key: OrderSourceLogoKey) => {
  switch (key) {
    case "facebook":
      return "Facebook";
    case "instagram":
      return "Instagram";
    case "audience-network":
      return "Audience Network";
    case "threads":
      return "Threads";
    case "messenger":
      return "Messenger";
    case "whatsapp":
      return "WhatsApp";
    case "tiktok":
      return "TikTok";
    case "youtube":
      return "YouTube";
    case "website":
    default:
      return "Website";
  }
};

type LogoGradientIds = {
  instagram: string;
  messenger: string;
  audienceNetwork: string;
};

const renderCircleSurface = (fill: string, accent = "rgba(255,255,255,0.12)") => (
  <>
    <circle cx="32" cy="32" r="24" fill={fill} />
    <ellipse cx="24.5" cy="17.5" rx="14" ry="7.5" fill="#fff" opacity="0.14" transform="rotate(-22 24.5 17.5)" />
    <ellipse cx="40" cy="44" rx="16" ry="10" fill={accent} opacity="0.18" transform="rotate(18 40 44)" />
  </>
);

const renderSurface = (key: OrderSourceLogoKey, ids: LogoGradientIds) => {
  switch (key) {
    case "facebook":
      return renderCircleSurface("#1877F2", "#0B63D1");
    case "instagram":
      return renderCircleSurface(`url(#${ids.instagram})`);
    case "audience-network":
      return renderCircleSurface(`url(#${ids.audienceNetwork})`);
    case "threads":
      return renderCircleSurface("#111111", "#3A3A3A");
    case "messenger":
      return renderCircleSurface(`url(#${ids.messenger})`);
    case "whatsapp":
      return renderCircleSurface("#25D366", "#169C47");
    case "tiktok":
      return renderCircleSurface("#111111", "#3A3A3A");
    case "youtube":
      return (
        <>
          <rect x="10" y="16" width="44" height="32" rx="12" fill="#FF0033" />
          <ellipse cx="25" cy="21" rx="12" ry="6" fill="#fff" opacity="0.16" transform="rotate(-14 25 21)" />
        </>
      );
    case "website":
    default:
      return (
        <>
          <circle cx="32" cy="32" r="24" fill="#F8FAFC" />
          <circle cx="32" cy="32" r="23.25" stroke="#CBD5E1" strokeWidth="1.5" />
          <ellipse cx="25" cy="18" rx="14" ry="8" fill="#fff" opacity="0.8" transform="rotate(-22 25 18)" />
        </>
      );
  }
};

const renderGlyph = (key: OrderSourceLogoKey) => {
  switch (key) {
    case "facebook":
      return (
        <>
          <path d={FACEBOOK_GLYPH} transform="translate(1.3 1.9)" fill="#0A4DA8" opacity="0.18" />
          <path d={FACEBOOK_GLYPH} fill="#fff" />
        </>
      );
    case "instagram":
      return (
        <>
          <rect x="19.5" y="19.5" width="25" height="25" rx="8.5" stroke="#fff" strokeWidth="4" />
          <circle cx="32" cy="32" r="6.5" stroke="#fff" strokeWidth="4" />
          <circle cx="40.25" cy="23.75" r="2.5" fill="#fff" />
        </>
      );
    case "audience-network":
      return (
        <>
          <path d="M23.5 39.5L31.4 26.5L39.3 39.5L44.5 22.5" stroke="#fff" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="23.5" cy="39.5" r="3.4" fill="#fff" />
          <circle cx="31.4" cy="26.5" r="3.4" fill="#fff" />
          <circle cx="39.3" cy="39.5" r="3.4" fill="#fff" />
          <circle cx="44.5" cy="22.5" r="3.4" fill="#fff" />
        </>
      );
    case "threads":
      return (
        <text
          x="32"
          y="40.5"
          textAnchor="middle"
          fontFamily="Arial, Helvetica, sans-serif"
          fontSize="28"
          fontWeight="700"
          fill="#fff"
        >
          @
        </text>
      );
    case "messenger":
      return (
        <>
          <path d="M21 37.5L29.5 28.3L34.2 32.2L43 27.5L34.7 36.7L30 32.8Z" fill="#fff" />
        </>
      );
    case "whatsapp":
      return (
        <g transform="translate(15.8 15.4) scale(1.37)">
          <path d={WHATSAPP_GLYPH} transform="translate(0.8 1.05)" fill="#16803D" opacity="0.18" />
          <path d={WHATSAPP_GLYPH} fill="#fff" />
        </g>
      );
    case "tiktok":
      return (
        <>
          <path d={TIKTOK_GLYPH} transform="translate(-1.2 0.7)" fill="#25F4EE" />
          <path d={TIKTOK_GLYPH} transform="translate(1.2 -0.7)" fill="#FE2C55" />
          <path d={TIKTOK_GLYPH} fill="#fff" />
        </>
      );
    case "youtube":
      return <path d="M28.5 24.8L40.8 32L28.5 39.2Z" fill="#fff" />;
    case "website":
    default:
      return (
        <g stroke="#64748B" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="32" cy="32" r="12.5" />
          <path d="M19.5 32h25" />
          <path d="M32 19.5c4.2 4 6.5 8.2 6.5 12.5S36.2 40.5 32 44.5c-4.2-4-6.5-8.2-6.5-12.5S27.8 23.5 32 19.5Z" />
        </g>
      );
  }
};

export function OrderSourceLogo({ source, className, ...props }: OrderSourceLogoProps) {
  const key = normalizeOrderSourceLogoKey(source);
  const id = useId().replace(/:/g, "");
  const ids = {
    instagram: `${id}-instagram`,
    messenger: `${id}-messenger`,
    audienceNetwork: `${id}-audience-network`
  };
  const {
    ["aria-label"]: passedAriaLabel,
    ["aria-hidden"]: passedAriaHidden,
    ...svgProps
  } = props;
  const ariaHidden = passedAriaHidden === true || passedAriaHidden === "true";
  const ariaLabel = typeof passedAriaLabel === "string" ? passedAriaLabel : orderSourceLogoLabel(key);

  return (
    <svg
      viewBox="0 0 64 64"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      focusable="false"
      {...svgProps}
      {...(ariaHidden ? { "aria-hidden": true } : { role: "img", "aria-label": ariaLabel })}
    >
      <defs>
        <filter id={`${id}-shadow`} x="0" y="0" width="64" height="64" filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
          <feDropShadow dx="0" dy="2" stdDeviation="2.4" floodColor="#0f172a" floodOpacity="0.16" />
        </filter>
        <linearGradient id={ids.instagram} x1="14" y1="14" x2="50" y2="50" gradientUnits="userSpaceOnUse">
          <stop stopColor="#FEDA75" />
          <stop offset="0.34" stopColor="#FA7E1E" />
          <stop offset="0.65" stopColor="#D62976" />
          <stop offset="1" stopColor="#4F5BD5" />
        </linearGradient>
        <linearGradient id={ids.messenger} x1="12" y1="14" x2="50" y2="50" gradientUnits="userSpaceOnUse">
          <stop stopColor="#00B2FF" />
          <stop offset="1" stopColor="#7B4DFF" />
        </linearGradient>
        <linearGradient id={ids.audienceNetwork} x1="14" y1="14" x2="50" y2="50" gradientUnits="userSpaceOnUse">
          <stop stopColor="#40A9FF" />
          <stop offset="1" stopColor="#1877F2" />
        </linearGradient>
      </defs>
      <g filter={`url(#${id}-shadow)`}>
        {renderSurface(key, ids)}
        {renderGlyph(key)}
      </g>
    </svg>
  );
}
