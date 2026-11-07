import type { ReactNode } from "react";
import { Phone } from "lucide-react";
import { WhatsAppIcon } from "../../components/WhatsAppIcon";
import type { WfResponseOption, WfWaybillStatus } from "../../lib/api";

/** Shared pieces of the Waybill Follow-Up Center (Bright, 7 Nov 2026). */

export type WfTab = "dashboard" | "waybills" | "history" | "misses" | "reports";

export const PURPLE = "#5B3FD9";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-2xl border border-gray-200/80 bg-white shadow-[0_1px_3px_rgba(16,24,40,0.06)] dark:border-slate-800 dark:bg-slate-900 ${className}`}>{children}</section>;
}

/** The small rounded icon tile beside a card title. */
export function IconTile({ children, tone = "purple" }: { children: ReactNode; tone?: "purple" | "red" }) {
  const look = tone === "red" ? "bg-rose-50 text-rose-600 dark:bg-rose-500/10" : "bg-[#EEEBFC] text-[#5B3FD9] dark:bg-violet-500/15 dark:text-violet-300";
  return <span className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${look}`}>{children}</span>;
}

const PILL: Record<string, string> = {
  green: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300",
  amber: "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300",
  blue: "bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300",
  red: "bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-300",
  purple: "bg-[#EEEBFC] text-[#5B3FD9] dark:bg-violet-500/15 dark:text-violet-300",
  slate: "bg-slate-100 text-slate-600 dark:bg-slate-700/50 dark:text-slate-300"
};
export function Pill({ tone, children, className = "" }: { tone: keyof typeof PILL | string; children: ReactNode; className?: string }) {
  return <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-0.5 text-[12px] font-semibold ${PILL[tone] ?? PILL.slate} ${className}`}>{children}</span>;
}

export const STATUS_LOOK: Record<WfWaybillStatus, { label: string; tone: string }> = {
  verify: { label: "✓ Verify Receipt", tone: "green" },
  overdue: { label: "Overdue", tone: "red" },
  in_transit: { label: "In Transit", tone: "blue" },
  pending: { label: "Pending", tone: "amber" }
};

/** The agent-response pill: the response's short label; "Other" shows the words. */
export function ResponsePill({ response, note, options }: { response: string | null | undefined; note?: string; options: WfResponseOption[] }) {
  if (!response) return <span className="text-[12.5px] text-gray-400">Not followed up yet</span>;
  const option = options.find((row) => row.key === response);
  const text = response === "other" && note ? note : option?.short ?? response;
  return <Pill tone={option?.tone ?? "slate"} className="max-w-[180px] truncate">{text}</Pill>;
}

/** WhatsApp (the green WhatsApp mark) or phone (blue); both = the phone, as the stronger contact. */
export function ChannelIcon({ channels, size = 16, callTone = "text-sky-600" }: { channels: string[]; size?: number; callTone?: string }) {
  if (channels.includes("call")) return <Phone className={callTone} style={{ width: size, height: size }} aria-label="Phone call" />;
  return <WhatsAppIcon className="text-[#1FAF52]" style={{ width: size, height: size }} aria-label="WhatsApp" />;
}

export function Initials({ name }: { name: string }) {
  const letters = name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("") || "?";
  return <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-50 text-[11px] font-bold text-amber-800 dark:bg-amber-500/15 dark:text-amber-200">{letters}</span>;
}

export const lagosTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "Africa/Lagos" }) : "—";

export const lagosDateTime = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Africa/Lagos" });

/** "Fri, Nov 7, 2026" for the date picker. */
export const longDate = (dateKey: string) =>
  new Date(`${dateKey}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

export const shortDate = (dateKey: string) =>
  new Date(`${dateKey}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

export const naira = (value: number) => `₦${Math.round(Number(value) || 0).toLocaleString("en-NG")}`;

/** "1h 18m", "12m". */
export function untilText(ms: number) {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
}

export const btn = {
  primary: "!min-h-0 inline-flex items-center justify-center gap-2 rounded-xl bg-[#5B3FD9] px-4 py-2.5 text-[14px] font-semibold text-white shadow-sm hover:bg-[#4C32C4] disabled:opacity-50",
  soft: "!min-h-0 inline-flex items-center justify-center gap-2 rounded-xl bg-[#EEEBFC] px-4 py-2.5 text-[14px] font-semibold text-[#5B3FD9] hover:bg-[#E3DEFA] disabled:opacity-50 dark:bg-violet-500/15 dark:text-violet-200",
  ghost: "!min-h-0 inline-flex items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-[14px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200",
  outline: "!min-h-0 inline-flex items-center justify-center rounded-lg border border-[#C9BEF5] bg-white px-3 py-1.5 text-[12.5px] font-semibold text-[#5B3FD9] hover:bg-[#F5F2FE] dark:border-violet-500/40 dark:bg-slate-900 dark:text-violet-200"
};
