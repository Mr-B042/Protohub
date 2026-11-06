import type { ReactNode } from "react";
import { Bell, BarChart3, Box, CheckCircle2, ClipboardList, Clock, Megaphone, MessageSquare, Send, ShoppingCart, Truck, UserCheck, XCircle, type LucideIcon } from "lucide-react";

/** Shared pieces of the Telegram Automation Center (Bright, 6 Nov 2026). */

export type TgTab = "overview" | "bot" | "automations" | "alerts" | "staff" | "commands" | "messages" | "logs";

/** The round blue paper-plane mark. */
export function TgLogo({ size = 56, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="tg-logo-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#37AEE2" />
          <stop offset="1" stopColor="#1E96C8" />
        </linearGradient>
      </defs>
      <circle cx="32" cy="32" r="32" fill="url(#tg-logo-fill)" />
      <path d="M14.5 31.2 45.6 19.4c1.5-.5 2.8.4 2.3 2.6L42.6 46.8c-.4 1.8-1.5 2.2-3 1.4l-8.2-6-4 3.8c-.4.4-.8.8-1.7.8l.6-8.4L41.6 24.6c.7-.6-.1-.9-1-.3L21.6 36.4l-8.1-2.5c-1.8-.6-1.8-1.8.2-2.6Z" fill="#fff" />
    </svg>
  );
}

export const ROLE_SHORT: Record<string, string> = {
  "Inventory Manager & Logistics Operations": "Logistics",
  "Inventory Manager": "Inventory"
};
export const roleShort = (role: string) => ROLE_SHORT[role] ?? role;

type Look = { Icon: LucideIcon; tint: string; icon: string };
const LOOKS: Record<string, Look> = {
  order_new: { Icon: ShoppingCart, tint: "bg-emerald-50 dark:bg-emerald-500/10", icon: "text-emerald-600" },
  order_assigned: { Icon: UserCheck, tint: "bg-emerald-50 dark:bg-emerald-500/10", icon: "text-emerald-600" },
  cart_assigned: { Icon: ShoppingCart, tint: "bg-orange-50 dark:bg-orange-500/10", icon: "text-orange-600" },
  weekly_rep_note: { Icon: ClipboardList, tint: "bg-amber-50 dark:bg-amber-500/10", icon: "text-amber-700" },
  send_out_soon: { Icon: Clock, tint: "bg-amber-50 dark:bg-amber-500/10", icon: "text-amber-600" },
  follow_up_due: { Icon: Clock, tint: "bg-amber-50 dark:bg-amber-500/10", icon: "text-amber-600" },
  order_failed: { Icon: XCircle, tint: "bg-rose-50 dark:bg-rose-500/10", icon: "text-rose-600" },
  order_cancelled: { Icon: XCircle, tint: "bg-rose-50 dark:bg-rose-500/10", icon: "text-rose-600" },
  order_confirmed: { Icon: Truck, tint: "bg-sky-50 dark:bg-sky-500/10", icon: "text-sky-600" },
  order_delivered: { Icon: Truck, tint: "bg-emerald-50 dark:bg-emerald-500/10", icon: "text-emerald-600" },
  order_rescheduled: { Icon: Truck, tint: "bg-sky-50 dark:bg-sky-500/10", icon: "text-sky-600" },
  low_stock: { Icon: Box, tint: "bg-violet-50 dark:bg-violet-500/10", icon: "text-violet-600" },
  daily_report: { Icon: CheckCircle2, tint: "bg-emerald-50 dark:bg-emerald-500/10", icon: "text-emerald-600" },
  weekly_report: { Icon: BarChart3, tint: "bg-indigo-50 dark:bg-indigo-500/10", icon: "text-indigo-600" },
  announcement: { Icon: Megaphone, tint: "bg-fuchsia-50 dark:bg-fuchsia-500/10", icon: "text-fuchsia-600" },
  command: { Icon: MessageSquare, tint: "bg-sky-50 dark:bg-sky-500/10", icon: "text-sky-600" },
  test: { Icon: Send, tint: "bg-blue-50 dark:bg-blue-500/10", icon: "text-blue-600" },
  app_alert: { Icon: Bell, tint: "bg-slate-100 dark:bg-slate-700/40", icon: "text-slate-600" }
};
export const lookOf = (trigger: string): Look => LOOKS[trigger] ?? LOOKS.app_alert;

export const GROUP_LOOK: Record<string, Look> = {
  new_orders: { Icon: ShoppingCart, tint: "bg-sky-50 dark:bg-sky-500/10", icon: "text-sky-600" },
  follow_ups: { Icon: Clock, tint: "bg-amber-50 dark:bg-amber-500/10", icon: "text-amber-600" },
  delivery: { Icon: Truck, tint: "bg-emerald-50 dark:bg-emerald-500/10", icon: "text-emerald-600" },
  stock: { Icon: Box, tint: "bg-violet-50 dark:bg-violet-500/10", icon: "text-violet-600" },
  reports: { Icon: BarChart3, tint: "bg-indigo-50 dark:bg-indigo-500/10", icon: "text-indigo-600" }
};

export const TRIGGER_NAME: Record<string, string> = {
  order_new: "New order", order_assigned: "Order assigned", cart_assigned: "Cart assigned", weekly_rep_note: "Weekly late & fines note",
  send_out_soon: "Follow-up reminder", follow_up_due: "Follow-up due",
  order_confirmed: "Order confirmed", order_delivered: "Order delivered", order_failed: "Delivery failed", order_cancelled: "Order cancelled",
  order_rescheduled: "Order rescheduled", low_stock: "Low stock", daily_report: "Daily report", weekly_report: "Weekly report",
  announcement: "Announcement", command: "Bot reply", test: "Test / sample", app_alert: "App alert"
};

export function IconBubble({ trigger, group, size = "md" }: { trigger?: string; group?: string; size?: "sm" | "md" }) {
  const look = group ? GROUP_LOOK[group] ?? LOOKS.app_alert : lookOf(trigger ?? "");
  const box = size === "sm" ? "h-7 w-7" : "h-9 w-9";
  return (
    <span className={`inline-flex ${box} shrink-0 items-center justify-center rounded-full ${look.tint}`}>
      <look.Icon className={`${size === "sm" ? "h-3.5 w-3.5" : "h-[18px] w-[18px]"} ${look.icon}`} />
    </span>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-2xl border border-gray-200/80 bg-white shadow-[0_1px_3px_rgba(16,24,40,0.06)] dark:border-slate-800 dark:bg-slate-900 ${className}`}>{children}</section>;
}

export function CardHead({ title, action, className = "" }: { title: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={`flex items-center justify-between gap-3 px-5 pt-4 ${className}`}>
      <h3 className="m-0 text-[16px] font-bold text-gray-900 dark:text-slate-50">{title}</h3>
      {action}
    </div>
  );
}

export function Toggle({ on, onChange, disabled, label }: { on: boolean; onChange: (next: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)}
      className={`!min-h-0 relative inline-flex h-[22px] w-[40px] shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${on ? "bg-[#1F8FE0]" : "bg-gray-300 dark:bg-slate-600"}`}>
      <span className={`inline-block h-[18px] w-[18px] rounded-full bg-white shadow transition-transform ${on ? "translate-x-[20px]" : "translate-x-[2px]"}`} />
    </button>
  );
}

export function StatusDot({ on, onText = "Connected", offText = "Not Connected" }: { on: boolean; onText?: string; offText?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[13px] text-gray-700 dark:text-slate-300">
      <span className={`h-2 w-2 rounded-full ${on ? "bg-emerald-500" : "bg-gray-400"}`} />{on ? onText : offText}
    </span>
  );
}

export const timeOfDay = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "Africa/Lagos" });

/** "Just now", "12 min ago", "3 hr ago", "5 Nov". */
export function sinceText(iso: string | null | undefined) {
  if (!iso) return "—";
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return "—";
  if (ms < 2 * 60_000) return "Just now";
  if (ms < 60 * 60_000) return `${Math.round(ms / 60_000)} min ago`;
  if (ms < 24 * 60 * 60_000) return `${Math.round(ms / 3_600_000)} hr ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Africa/Lagos" });
}

export const dateTime = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Africa/Lagos" });

export const pct = (value: number | null | undefined) => value == null ? "—" : `${Number.isInteger(value) ? value : value.toFixed(1)}%`;

export function initials(name: string) {
  return (name.trim()[0] ?? "?").toUpperCase();
}

const AVATAR_TONES = ["bg-sky-100 text-sky-700", "bg-violet-100 text-violet-700", "bg-emerald-100 text-emerald-700", "bg-amber-100 text-amber-700", "bg-rose-100 text-rose-700", "bg-indigo-100 text-indigo-700"];
export const avatarTone = (seed: string) => AVATAR_TONES[[...seed].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % AVATAR_TONES.length];

export const HOURS = Array.from({ length: 24 }, (_, hour) => ({ value: hour, label: new Date(Date.UTC(2026, 0, 1, hour)).toLocaleTimeString("en-US", { hour: "numeric", timeZone: "UTC" }) }));
export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export const btn = {
  primary: "!min-h-0 inline-flex items-center justify-center gap-2 rounded-xl bg-[#1F8FE0] px-4 py-2.5 text-[14px] font-semibold text-white shadow-sm hover:bg-[#1A7FCB] disabled:opacity-50",
  ghost: "!min-h-0 inline-flex items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-[14px] font-semibold text-gray-800 hover:bg-gray-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100",
  danger: "!min-h-0 inline-flex items-center justify-center gap-2 rounded-xl border border-rose-200 bg-white px-4 py-2.5 text-[14px] font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50 dark:border-rose-500/40 dark:bg-slate-900",
  link: "!min-h-0 inline-flex items-center gap-1 text-[14px] font-semibold text-[#1F8FE0] hover:underline"
};
