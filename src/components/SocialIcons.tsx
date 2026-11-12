import type { CSSProperties } from "react";

/** Small platform marks for the Social Leads Inbox (Bright, 12 Nov 2026). */
type P = { className?: string; style?: CSSProperties; title?: string };

export function FacebookIcon({ className = "h-4 w-4", style, title = "Facebook" }: P) {
  return (
    <svg viewBox="0 0 24 24" className={className} style={style} role="img" aria-label={title}>
      <circle cx="12" cy="12" r="12" fill="#1877F2" />
      <path d="M15.1 12.6h-2.3V20h-3v-7.4H8.3V10h1.5V8.4c0-2 1-3.4 3.4-3.4h2v2.6h-1.3c-.8 0-1 .4-1 1V10h2.4l-.2 2.6z" fill="#fff" />
    </svg>
  );
}

export function InstagramIcon({ className = "h-4 w-4", style, title = "Instagram" }: P) {
  return (
    <svg viewBox="0 0 24 24" className={className} style={style} role="img" aria-label={title}>
      <defs>
        <radialGradient id="sl-ig" cx="30%" cy="107%" r="150%">
          <stop offset="0" stopColor="#fdf497" /><stop offset=".05" stopColor="#fdf497" /><stop offset=".45" stopColor="#fd5949" /><stop offset=".6" stopColor="#d6249f" /><stop offset=".9" stopColor="#285AEB" />
        </radialGradient>
      </defs>
      <rect width="24" height="24" rx="6.5" fill="url(#sl-ig)" />
      <rect x="5.5" y="5.5" width="13" height="13" rx="4" fill="none" stroke="#fff" strokeWidth="1.8" />
      <circle cx="12" cy="12" r="3.1" fill="none" stroke="#fff" strokeWidth="1.8" />
      <circle cx="16.3" cy="7.7" r="1" fill="#fff" />
    </svg>
  );
}

export function MessengerIcon({ className = "h-4 w-4", style, title = "Messenger" }: P) {
  return (
    <svg viewBox="0 0 24 24" className={className} style={style} role="img" aria-label={title}>
      <defs>
        <linearGradient id="sl-ms" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stopColor="#0099FF" /><stop offset=".6" stopColor="#A033FF" /><stop offset="1" stopColor="#FF5280" /></linearGradient>
      </defs>
      <path d="M12 2C6.4 2 2 6.1 2 11.6c0 2.9 1.2 5.4 3.1 7.1v3.3l3-1.7c.9.3 1.9.4 2.9.4 5.6 0 10-4.1 10-9.6S17.6 2 12 2z" fill="url(#sl-ms)" />
      <path d="M6.2 14.4l3-4.7 2.8 2.1 3.6-2.1-3 4.7-2.8-2.1z" fill="#fff" />
    </svg>
  );
}

export function PlatformIcon({ platform, className }: { platform: string; className?: string }) {
  if (platform === "instagram") return <InstagramIcon className={className} />;
  if (platform === "messenger") return <MessengerIcon className={className} />;
  return <FacebookIcon className={className} />;
}
