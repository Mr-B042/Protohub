import {
  ArrowRight, BarChart3, Cake, CalendarDays, Clock, Coins, Crown, Mail, MailOpen, MousePointerClick, Repeat, RefreshCw, Settings2, ShoppingCart, Sparkles, SplitSquareHorizontal,
  Tag, Target, Type, Users, Zap, Link2, Send
} from "lucide-react";
import type { EmDelivery, EmDesigner, EmPlanning, EmPreview } from "../../lib/api";
import { Card, Pill, Tick, Toggle, count, input, naira, select } from "./em-ui";
import { delayText, whenText, type Draft } from "./wizard-model";

/** Step 4, Schedule & Automate (image 47). */

const TYPES: Array<{ key: EmDelivery["type"]; label: string; hint: string; icon: typeof Mail }> = [
  { key: "one_time", label: "One-Time Campaign", hint: "Send once at a specific date and time", icon: CalendarDays },
  { key: "recurring", label: "Recurring Campaign", hint: "Send on a repeating schedule (daily, weekly, monthly)", icon: RefreshCw },
  { key: "automation", label: "Automation Workflow", hint: "Automatically send based on customer actions (e.g. purchase, inactivity)", icon: Zap }
];
const RECOMMENDED: Array<{ key: string; name: string; hint: string; icon: typeof Mail; unavailable?: string }> = [
  { key: "post_purchase", name: "Post-Purchase Follow-Up", hint: "Thank you, usage tips, and upsell", icon: ShoppingCart },
  { key: "win_back", name: "Win-Back (Inactive Customers)", hint: "Re-engage customers after no purchase", icon: RefreshCw },
  { key: "birthday", name: "Birthday Campaign", hint: "Send a special message and offer", icon: Cake, unavailable: "The order form doesn't ask for birthdays yet." },
  { key: "cart_recovery", name: "Abandoned Cart Recovery", hint: "Remind customers to complete their order", icon: ShoppingCart },
  { key: "loyalty", name: "Loyalty Reward", hint: "Reward your repeat and high-value customers", icon: Crown, unavailable: "Comes with the Loyalty & Rewards part." }
];
const TRIGGERS: Record<string, { label: string; short: string }> = {
  delivered: { label: "Customer gets a delivery", short: "Customer gets a delivery" },
  ordered: { label: "Customer places an order", short: "Customer places an order" },
  cart: { label: "Customer leaves a cart", short: "Customer leaves a cart" },
  inactive: { label: "Customer goes quiet (no delivery for a while)", short: "Customer goes quiet" }
};
const DELAYS = [1, 6, 24, 48, 72, 168, 336, 720];

const lagosParts = (iso: string | null | undefined) => {
  const date = iso ? new Date(iso) : new Date(Date.now() + 86_400_000);
  const shifted = new Date(date.getTime() + 3_600_000).toISOString();
  return { day: shifted.slice(0, 10), time: shifted.slice(11, 16) };
};
const fromParts = (day: string, time: string) => new Date(`${day}T${time || "14:00"}:00+01:00`).toISOString();
const hourText = (h: number) => `${((h + 11) % 12) + 1}:00 ${h < 12 ? "AM" : "PM"}`;

export default function StepSchedule({ draft, designer, preview, planning, onChange }: {
  draft: Draft;
  designer: EmDesigner | null;
  preview: EmPreview | null;
  planning: EmPlanning | null;
  onChange: (patch: Partial<Draft>) => void;
}) {
  const d = draft.delivery;
  const auto = d.automation ?? { preset: null, trigger: "delivered" as const, delayHours: 48, inactiveDays: 60, exit: "purchased" as const };
  const parts = lagosParts(d.sendAt);
  const setDelivery = (next: EmDelivery) => onChange({ delivery: next });
  const setType = (type: EmDelivery["type"]) => {
    if (type === "automation") setDelivery({ type, sendAt: null, automation: auto });
    else setDelivery({ type, sendAt: d.sendAt ?? fromParts(parts.day, "14:00"), ...(type === "recurring" ? { repeat: d.repeat ?? { every: "week", until: null } } : {}) });
  };
  const usePreset = (key: string, on: boolean) => {
    const preset = designer?.presets.find((row) => row.key === key);
    if (!on || !preset) { if (d.type === "automation") setDelivery({ ...d, automation: { ...auto, preset: null } }); return; }
    setDelivery({ type: "automation", sendAt: null, automation: { preset: key, trigger: preset.trigger, delayHours: preset.delayHours, inactiveDays: preset.inactiveDays ?? 60, exit: preset.exit } });
  };
  const o = draft.options;
  const best = planning?.sendWindow;
  const est = planning?.estimate;
  const range = (low: number, high: number, money = false) => money ? `${naira(low)} – ${naira(high)}` : `${Math.round(low * 100)}% – ${Math.round(high * 100)}%`;
  const goalText = auto.preset ? designer?.presets.find((row) => row.key === auto.preset)?.goal ?? "Bring them back" : auto.trigger === "cart" ? "Finish the order" : "Increase repeat purchase";

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)_minmax(0,0.85fr)]">
        <Card className="p-4">
          <h3 className="m-0 text-[17px] font-bold text-gray-900 dark:text-slate-50">Delivery Type</h3>
          <div className="mt-3 space-y-2">
            {TYPES.map(({ key, label, hint, icon: Icon }) => (
              <button key={key} type="button" onClick={() => setType(key)} aria-pressed={d.type === key}
                className={`!min-h-0 flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left ${d.type === key ? "border-[#8B74EE] bg-[#F5F2FE] dark:bg-violet-500/10" : "border-gray-100 hover:bg-gray-50 dark:border-slate-800 dark:hover:bg-slate-800"}`}>
                <Icon className="h-6 w-6 shrink-0 text-[#5B3FD9]" />
                <span className="min-w-0 flex-1"><span className="block text-[14px] font-bold text-gray-900 dark:text-slate-50">{label}</span><span className="block text-[12.5px] text-gray-500">{hint}</span></span>
                <Tick on={d.type === key} />
              </button>
            ))}
          </div>
        </Card>

        <Card className="p-4">
          <h3 className="m-0 text-[17px] font-bold text-gray-900 dark:text-slate-50">Schedule Details</h3>
          {d.type === "automation" ? (
            <p className="m-0 mt-3 rounded-xl bg-[#F7F4FF] px-3 py-3 text-[13px] text-gray-700 dark:bg-slate-800 dark:text-slate-300">
              An automation has no send date. Once launched, it emails each customer when the trigger below happens, and counts only things that happen after launch.
            </p>
          ) : (
            <>
              <div className="mt-3 grid grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)_auto] items-end gap-2">
                <label className="block text-[13px] font-bold text-gray-900 dark:text-slate-50">Send Date <span className="text-rose-500">*</span>
                  <input type="date" disabled={draft.sendNow} value={parts.day} onChange={(event) => event.target.value && setDelivery({ ...d, sendAt: fromParts(event.target.value, parts.time) })} className={`${input} mt-1.5 !py-2 disabled:opacity-50`} />
                </label>
                <label className="block text-[13px] font-bold text-gray-900 dark:text-slate-50">Send Time <span className="text-rose-500">*</span>
                  <input type="time" disabled={draft.sendNow} value={parts.time} onChange={(event) => event.target.value && setDelivery({ ...d, sendAt: fromParts(parts.day, event.target.value) })} className={`${input} mt-1.5 !py-2 disabled:opacity-50`} />
                </label>
                <span className="mb-1 rounded-lg bg-gray-100 px-2 py-1.5 text-[11.5px] font-semibold text-gray-600 dark:bg-slate-800 dark:text-slate-300">WAT (GMT+1)</span>
              </div>
              {d.type === "one_time" && (
                <label className="mt-2 flex items-center gap-2 text-[13px] text-gray-700 dark:text-slate-300"><input type="checkbox" checked={draft.sendNow} onChange={(event) => onChange({ sendNow: event.target.checked })} />Send as soon as I launch instead</label>
              )}
              {d.type === "recurring" && (
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <label className="block text-[13px] font-bold text-gray-900 dark:text-slate-50">Repeat every
                    <select value={d.repeat?.every ?? "week"} onChange={(event) => setDelivery({ ...d, repeat: { every: event.target.value as "day" | "week" | "month", until: d.repeat?.until ?? null } })} className={`${select} mt-1.5 !py-2`}>
                      <option value="day">Day</option><option value="week">Week</option><option value="month">Month</option>
                    </select>
                  </label>
                  <label className="block text-[13px] font-bold text-gray-900 dark:text-slate-50">Stop after (optional)
                    <input type="date" value={d.repeat?.until ? lagosParts(d.repeat.until).day : ""} onChange={(event) => setDelivery({ ...d, repeat: { every: d.repeat?.every ?? "week", until: event.target.value ? fromParts(event.target.value, "23:59") : null } })} className={`${input} mt-1.5 !py-2`} />
                  </label>
                </div>
              )}
              <div className="mt-3 rounded-xl border border-gray-100 p-3 dark:border-slate-800">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-5 w-5 text-[#5B3FD9]" />
                  <span className="text-[14px] font-bold text-gray-900 dark:text-slate-50">Best Send Time</span>
                  {best && <Pill tone="green">Recommended</Pill>}
                </div>
                <p className="m-0 mt-1 text-[12.5px] leading-snug text-gray-600 dark:text-slate-400">
                  {best ? <>Your customers place the most orders between <strong>{hourText(best.startHour)} and {hourText(best.endHour % 24)} (WAT)</strong>: {best.share}% of orders in the last 90 days. Sending just before then puts the email on top of their inbox.</> : "Needs at least 20 orders in the last 90 days to suggest a time."}
                </p>
                {best && !draft.sendNow && (
                  <button type="button" onClick={() => setDelivery({ ...d, sendAt: fromParts(parts.day, `${String(best.startHour).padStart(2, "0")}:00`) })} className="!min-h-0 mt-1.5 text-[12.5px] font-semibold text-[#5B3FD9] hover:underline">Use {hourText(best.startHour)}</button>
                )}
              </div>
            </>
          )}
        </Card>

        <Card className="p-4">
          <h3 className="m-0 flex items-center gap-2 text-[17px] font-bold text-gray-900 dark:text-slate-50"><CalendarDays className="h-5 w-5 text-[#5B3FD9]" />Schedule Preview</h3>
          <div className="mt-3 space-y-2.5 rounded-xl border border-[#E4DDFB] bg-[#F7F4FF] p-3 text-[13px] dark:border-violet-500/30 dark:bg-violet-500/10">
            <p className="m-0 flex items-start gap-2 font-bold text-gray-900 dark:text-slate-50"><Mail className="mt-0.5 h-4 w-4 shrink-0 text-[#5B3FD9]" />{draft.name || "Untitled campaign"}</p>
            <p className="m-0 flex items-start gap-2 text-gray-800 dark:text-slate-200"><Users className="mt-0.5 h-4 w-4 shrink-0 text-[#5B3FD9]" />To: {preview ? `${count(preview.recipients)} customers` : "—"}{d.type === "automation" ? " now, more as they join" : ""}</p>
            <p className="m-0 flex items-start gap-2 text-gray-800 dark:text-slate-200"><CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-[#5B3FD9]" />
              {d.type === "automation" ? "Starts when you launch" : draft.sendNow ? "As soon as you launch" : whenText(d.sendAt, true)}{d.type === "recurring" ? `, then every ${d.repeat?.every ?? "week"}` : ""}
            </p>
          </div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)_minmax(0,1fr)]">
        <Card className="p-4">
          <div className="flex items-start gap-2.5">
            <Zap className="mt-0.5 h-5 w-5 text-[#5B3FD9]" />
            <div><h3 className="m-0 text-[16px] font-bold text-gray-900 dark:text-slate-50">Recommended Automation Workflows</h3><p className="m-0 text-[12.5px] text-gray-600 dark:text-slate-400">Ready-made flows. Turning one on makes this campaign that flow.</p></div>
          </div>
          <div className="mt-3 divide-y divide-gray-100 dark:divide-slate-800">
            {RECOMMENDED.map(({ key, name, hint, icon: Icon, unavailable }) => {
              const on = d.type === "automation" && auto.preset === key;
              return (
                <div key={key} className="flex items-center gap-3 py-2.5" title={unavailable}>
                  <Icon className={`h-5 w-5 shrink-0 ${unavailable ? "text-gray-400" : "text-[#5B3FD9]"}`} />
                  <span className="min-w-0 flex-1"><span className={`block text-[13.5px] font-bold ${unavailable ? "text-gray-500" : "text-gray-900 dark:text-slate-50"}`}>{name}</span><span className="block text-[12px] text-gray-500">{unavailable ?? hint}</span></span>
                  <Toggle on={on} disabled={!!unavailable} label={name} onChange={(next) => usePreset(key, next)} />
                </div>
              );
            })}
          </div>
        </Card>

        <Card className={`p-4 ${d.type === "automation" ? "" : "opacity-60"}`}>
          <h3 className="m-0 flex items-center gap-2 text-[16px] font-bold text-gray-900 dark:text-slate-50"><Zap className="h-5 w-5 text-[#5B3FD9]" />Automation Flow <span className="font-normal text-gray-500">(Optional)</span></h3>
          <div className="mt-3 flex items-stretch gap-1.5">
            {[
              { icon: ShoppingCart, title: "Trigger", sub: TRIGGERS[auto.trigger]?.short ?? "" },
              { icon: Mail, title: "Send Email", sub: auto.trigger === "inactive" ? `After ${auto.inactiveDays ?? 60} days quiet` : `After ${delayText(auto.delayHours).toLowerCase()}`, hot: true },
              { icon: Tag, title: "Goal", sub: goalText }
            ].map((step, index) => (
              <div key={step.title} className="flex flex-1 items-center gap-1.5">
                <div className={`flex flex-1 flex-col items-center gap-1 rounded-xl border px-2 py-3 text-center ${step.hot ? "border-[#C9BEF5] bg-[#F5F2FE] dark:bg-violet-500/10" : "border-gray-200 dark:border-slate-700"}`}>
                  <step.icon className="h-5 w-5 text-[#5B3FD9]" />
                  <span className="text-[13px] font-bold text-gray-900 dark:text-slate-50">{step.title}</span>
                  <span className="text-[11.5px] leading-tight text-gray-600 dark:text-slate-400">{step.sub}</span>
                </div>
                {index < 2 && <ArrowRight className="h-4 w-4 shrink-0 text-[#5B3FD9]" />}
              </div>
            ))}
          </div>
          <fieldset disabled={d.type !== "automation"} className="m-0 mt-3 space-y-3 border-0 p-0">
            <label className="block text-[13px] font-bold text-gray-900 dark:text-slate-50">Trigger
              <select value={auto.trigger} onChange={(event) => setDelivery({ ...d, type: "automation", automation: { ...auto, preset: null, trigger: event.target.value as typeof auto.trigger } })} className={`${select} mt-1.5 !py-2`}>
                {Object.entries(TRIGGERS).map(([key, row]) => <option key={key} value={key}>{row.label}</option>)}
              </select>
            </label>
            {auto.trigger === "inactive" ? (
              <label className="block text-[13px] font-bold text-gray-900 dark:text-slate-50">Quiet for
                <select value={String(auto.inactiveDays ?? 60)} onChange={(event) => setDelivery({ ...d, automation: { ...auto, inactiveDays: Number(event.target.value) } })} className={`${select} mt-1.5 !py-2`}>
                  {[30, 45, 60, 90, 120, 180].map((n) => <option key={n} value={n}>{n} days with no delivery</option>)}
                </select>
              </label>
            ) : (
              <label className="block text-[13px] font-bold text-gray-900 dark:text-slate-50">Delay After Trigger
                <select value={String(auto.delayHours)} onChange={(event) => setDelivery({ ...d, automation: { ...auto, delayHours: Number(event.target.value) } })} className={`${select} mt-1.5 !py-2`}>
                  {DELAYS.map((h) => <option key={h} value={h}>{delayText(h)}</option>)}
                </select>
              </label>
            )}
            <label className="block text-[13px] font-bold text-gray-900 dark:text-slate-50">Exit Condition (Optional)
              <select value={auto.exit} onChange={(event) => setDelivery({ ...d, automation: { ...auto, exit: event.target.value as "none" | "purchased" } })} className={`${select} mt-1.5 !py-2`}>
                <option value="purchased">After customer makes another purchase</option><option value="none">Never stop early</option>
              </select>
            </label>
          </fieldset>
        </Card>

        <Card className="p-4">
          <h3 className="m-0 flex items-center gap-2 text-[16px] font-bold text-gray-900 dark:text-slate-50"><Settings2 className="h-5 w-5 text-[#5B3FD9]" />Advanced Settings</h3>
          <div className="mt-2 divide-y divide-gray-100 dark:divide-slate-800">
            <div className="py-2.5">
              <div className="flex items-center gap-3">
                <SplitSquareHorizontal className="h-5 w-5 shrink-0 text-[#5B3FD9]" />
                <span className="min-w-0 flex-1"><span className="block text-[13.5px] font-bold text-gray-900 dark:text-slate-50">A/B Test (Subject Line)</span><span className="block text-[12px] text-gray-500">Half get subject A, half get B; see which is opened more</span></span>
                <Toggle on={o.abTest} label="A/B test" disabled={d.type === "automation"} onChange={(abTest) => onChange({ options: { ...o, abTest } })} />
              </div>
              {o.abTest && d.type !== "automation" && <input value={draft.subjectB} onChange={(event) => onChange({ subjectB: event.target.value.slice(0, 200) })} placeholder="Subject B" className={`${input} mt-2 !py-2`} aria-label="Subject B" />}
            </div>
            <div className="flex items-center gap-3 py-2.5">
              <Type className="h-5 w-5 shrink-0 text-[#5B3FD9]" />
              <span className="min-w-0 flex-1"><span className="block text-[13.5px] font-bold text-gray-900 dark:text-slate-50">Send as Plain Text (Lightweight)</span><span className="block text-[12px] text-gray-500">Words and links only, no pictures</span></span>
              <Toggle on={o.plainText} label="Plain text" onChange={(plainText) => onChange({ options: { ...o, plainText } })} />
            </div>
            <div className="flex items-center gap-3 py-2.5">
              <Link2 className="h-5 w-5 shrink-0 text-[#5B3FD9]" />
              <span className="min-w-0 flex-1"><span className="block text-[13.5px] font-bold text-gray-900 dark:text-slate-50">Enable UTM Tracking</span><span className="block text-[12px] text-gray-500">Links say "email" and this campaign, so orders show where they came from</span></span>
              <Toggle on={o.utm} label="UTM tracking" onChange={(utm) => onChange({ options: { ...o, utm } })} />
            </div>
            <div className="py-2.5">
              <div className="flex items-center gap-3">
                <Send className="h-5 w-5 shrink-0 text-[#5B3FD9]" />
                <span className="min-w-0 flex-1"><span className="block text-[13.5px] font-bold text-gray-900 dark:text-slate-50">Resend to Non-Openers</span><span className="block text-[12px] text-gray-500">Automatically resend after</span></span>
                <Toggle on={o.resendNonOpeners} label="Resend to non-openers" disabled={d.type === "automation"} onChange={(resendNonOpeners) => onChange({ options: { ...o, resendNonOpeners } })} />
              </div>
              <select disabled={!o.resendNonOpeners || d.type === "automation"} value={String(o.resendHours)} onChange={(event) => onChange({ options: { ...o, resendHours: Number(event.target.value) } })} className={`${select} mt-2 !py-2 disabled:opacity-50`} aria-label="Resend after">
                {[24, 48, 72, 96].map((h) => <option key={h} value={h}>{h} hours</option>)}
              </select>
            </div>
          </div>
        </Card>
      </div>

      <Card className="flex flex-wrap items-center gap-4 border-[#E4DDFB] bg-[#F7F4FF] p-4 dark:bg-slate-900">
        <div className="flex min-w-[220px] items-center gap-3">
          <BarChart3 className="h-8 w-8 text-[#5B3FD9]" />
          <div><h3 className="m-0 text-[16px] font-bold text-gray-900 dark:text-slate-50">Estimated Performance</h3><p className="m-0 text-[12.5px] text-gray-600 dark:text-slate-400">{est ? "From your own past campaigns and this audience." : `Shows after 3 sent campaigns (you have ${planning?.pastCampaigns ?? 0}). No guesses before then.`}</p></div>
        </div>
        {[
          { icon: MailOpen, label: "Open Rate", value: est ? range(est.open.low, est.open.high) : "—" },
          { icon: MousePointerClick, label: "Click Rate", value: est ? range(est.click.low, est.click.high) : "—" },
          { icon: ShoppingCart, label: "Conversion", value: est ? range(est.conversion.low, est.conversion.high) : "—" },
          { icon: Coins, label: "Est. Revenue", value: est ? range(est.revenue.low, est.revenue.high, true) : "—" }
        ].map(({ icon: Icon, label, value }) => (
          <div key={label} className="flex flex-1 items-center gap-2.5 border-l border-[#E4DDFB] pl-4 dark:border-slate-700">
            <Icon className="h-6 w-6 text-[#5B3FD9]" />
            <div><div className="text-[12.5px] text-gray-600 dark:text-slate-400">{label}</div><div className="text-[18px] font-extrabold text-gray-900 dark:text-slate-50">{value}</div></div>
          </div>
        ))}
      </Card>
    </div>
  );
}
