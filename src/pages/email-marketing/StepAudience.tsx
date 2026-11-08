import { useState } from "react";
import { BarChart3, Layers, Loader2, Map, PieChart, Save, Upload, UserMinus, Users, Zap } from "lucide-react";
import { emailMarketingApi, type EmAudience, type EmDesigner, type EmPreview } from "../../lib/api";
import { ImportModal } from "./AudiencePage";
import SegmentBuilder from "./SegmentBuilder";
import { Card, Donut, SLICE_COLORS, SegmentIcon, Tick, btn, count, input, naira, pct, select } from "./em-ui";
import type { Draft } from "./wizard-model";

/** Step 2, Choose Audience (image 45). */

type Panel = EmAudience["source"] | "exclude";
const SOURCES: Array<{ key: Panel; label: string; hint: string; icon: typeof Users }> = [
  { key: "all", label: "All Customers", hint: "Everyone on your email list", icon: Users },
  { key: "segment", label: "Saved Segment", hint: "Use an existing customer segment", icon: Layers },
  { key: "custom", label: "Build Custom Segment", hint: "Filter customers with specific conditions", icon: Zap },
  { key: "journey", label: "Customer Journey Audience", hint: "Target customers at a stage (e.g. just delivered)", icon: Map },
  { key: "list", label: "List Upload", hint: "Import a list (CSV)", icon: Upload },
  { key: "exclude", label: "Exclude Customers", hint: "Remove specific customers (e.g. recent buyers)", icon: UserMinus }
];
const QUICK_ORDER = ["recent", "repeat", "high_value", "at_risk", "cart", "inactive", "new", "location"];

export default function StepAudience({ draft, designer, preview, previewing, onChange, onToast, onDesignerChanged }: {
  draft: Draft;
  designer: EmDesigner | null;
  preview: EmPreview | null;
  previewing: boolean;
  onChange: (patch: Partial<Draft>) => void;
  onToast: (message: string) => void;
  onDesignerChanged: () => Promise<void>;
}) {
  const a = draft.audience;
  const [panel, setPanel] = useState<Panel>(a.source);
  const [importing, setImporting] = useState(false);
  const [savingSegment, setSavingSegment] = useState(false);
  const setAudience = (next: EmAudience) => onChange({ audience: { ...next, exclude: next.exclude ?? a.exclude } });
  const custom = a.custom ?? { name: "", match: "all" as const, conditions: [] };
  const pick = (key: Panel) => {
    setPanel(key);
    if (key === "exclude") { if (!a.exclude?.on) setAudience({ ...a, exclude: { on: true, boughtWithinDays: 7 } }); return; }
    if (key === "custom") setAudience({ source: "custom", custom: custom.conditions.length ? custom : { name: "", match: "all", conditions: [{ field: "purchase_count", op: "gte", value: 2 }] } });
    else if (key === "segment") setAudience({ source: "segment", segmentId: a.segmentId ?? designer?.segments.find((row) => row.kind === "auto" && row.status === "active")?.id });
    else if (key === "list") setAudience({ source: "list", listId: a.listId ?? designer?.segments.find((row) => row.list)?.id });
    else if (key === "journey") setAudience({ source: "journey", journeyStage: a.journeyStage ?? "just_delivered" });
    else setAudience({ source: "all" });
  };
  const quickRow = (key: string) => designer?.quickSegments.find((row) => row.key === key);
  const quick = (key: string) => {
    const row = quickRow(key);
    if (!row) return;
    setPanel("custom");
    setAudience({ source: "custom", custom: { name: row.name, match: row.rule.match, conditions: row.rule.conditions.map((c) => ({ ...c })) } });
  };
  const saveAsSegment = async () => {
    if (!custom.name?.trim()) { onToast("Give the segment a name first."); return; }
    setSavingSegment(true);
    try {
      const created = await emailMarketingApi.createSegment({ name: custom.name.trim(), match: custom.match, conditions: custom.conditions, icon: "users" });
      await onDesignerChanged();
      setPanel("segment");
      setAudience({ source: "segment", segmentId: created.id });
      onToast(`Saved "${custom.name.trim()}" as a segment.`);
    } catch (err) {
      onToast((err as Error).message || "Could not save the segment.");
    } finally {
      setSavingSegment(false);
    }
  };
  const activeQuick = (key: string) => {
    const row = quickRow(key);
    return a.source === "custom" && !!row && JSON.stringify(row.rule.conditions) === JSON.stringify(custom.conditions) && row.rule.match === custom.match;
  };

  const quickGrid = (
    <Card className="p-4">
      <div className="flex items-start gap-2.5">
        <Zap className="mt-0.5 h-5 w-5 text-[#5B3FD9]" />
        <div><h3 className="m-0 text-[16px] font-bold text-gray-900 dark:text-slate-50">Quick Segments</h3><p className="m-0 text-[12.5px] text-gray-600 dark:text-slate-400">Common groups for an online shop. Tap one to start from it.</p></div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {QUICK_ORDER.map((key) => {
          const row = quickRow(key);
          if (!row) return null;
          const on = activeQuick(key);
          return (
            <button key={key} type="button" onClick={() => quick(key)}
              className={`!min-h-0 flex flex-col items-center gap-1 rounded-xl border px-2 py-3 text-center ${on ? "border-[#8B74EE] bg-[#F5F2FE] dark:bg-violet-500/10" : "border-gray-200 hover:bg-gray-50 dark:border-slate-700 dark:hover:bg-slate-800"}`}>
              <SegmentIcon name={row.icon} className={`h-5 w-5 ${row.icon === "crown" ? "text-amber-500" : row.icon === "alert" ? "text-rose-500" : "text-[#5B3FD9]"}`} />
              <span className="text-[12.5px] font-bold leading-tight text-gray-900 dark:text-slate-50">{row.name}</span>
              <span className="text-[11px] leading-tight text-gray-500">({row.hint})</span>
            </button>
          );
        })}
      </div>
    </Card>
  );

  const ex = a.exclude ?? { on: false };
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.5fr)_minmax(0,0.95fr)]">
      <Card className="p-4">
        <div className="flex items-start gap-2.5">
          <Users className="mt-0.5 h-5 w-5 text-[#5B3FD9]" />
          <div><h3 className="m-0 text-[17px] font-bold text-gray-900 dark:text-slate-50">Audience Source</h3><p className="m-0 text-[12.5px] text-gray-600 dark:text-slate-400">Choose who should receive this campaign.</p></div>
        </div>
        <div className="mt-3 space-y-2">
          {SOURCES.map(({ key, label, hint, icon: Icon }) => {
            const on = key === "exclude" ? !!ex.on : a.source === key;
            return (
              <button key={key} type="button" onClick={() => pick(key)} aria-pressed={on}
                className={`!min-h-0 flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left ${panel === key ? "border-[#8B74EE] bg-[#F5F2FE] dark:bg-violet-500/10" : "border-gray-100 hover:bg-gray-50 dark:border-slate-800 dark:hover:bg-slate-800"}`}>
                <Icon className="h-6 w-6 shrink-0 text-[#5B3FD9]" />
                <span className="min-w-0 flex-1"><span className="block text-[13.5px] font-bold text-gray-900 dark:text-slate-50">{label}</span><span className="block text-[12px] text-gray-500">{hint}</span></span>
                <Tick on={on} />
              </button>
            );
          })}
        </div>
      </Card>

      <div className="min-w-0 space-y-4">
        {panel === "all" && (
          <>
            <Card className="p-4">
              <h3 className="m-0 text-[16px] font-bold text-gray-900 dark:text-slate-50">All Customers</h3>
              <p className="m-0 mt-1 text-[13px] text-gray-600 dark:text-slate-400">Everyone on your email list who has not unsubscribed. To narrow it down, pick a quick segment below or build your own.</p>
            </Card>
            {quickGrid}
          </>
        )}
        {panel === "custom" && (
          <>
            <Card className="p-4">
              <div className="flex items-start gap-2.5">
                <Zap className="mt-0.5 h-5 w-5 text-[#5B3FD9]" />
                <div><h3 className="m-0 text-[16px] font-bold text-gray-900 dark:text-slate-50">Build Custom Segment</h3><p className="m-0 text-[12.5px] text-gray-600 dark:text-slate-400">Target the right customers using filters and conditions.</p></div>
              </div>
              <label className="mt-3 block text-[13.5px] font-bold text-gray-900 dark:text-slate-50">Segment Name <span className="text-rose-500">*</span>
                <input value={custom.name ?? ""} onChange={(event) => setAudience({ source: "custom", custom: { ...custom, name: event.target.value.slice(0, 120) } })} placeholder="e.g. Repeat Buyers – Edge Brusher Max" className={`${input} mt-1.5`} />
              </label>
              <div className="mt-3">
                {designer && <SegmentBuilder compact match={custom.match} conditions={custom.conditions} fields={designer.conditionFields} products={designer.products} states={designer.states} tags={designer.tags}
                  onChange={(rule) => setAudience({ source: "custom", custom: { ...custom, ...rule } })} />}
              </div>
              <button type="button" disabled={savingSegment || !custom.conditions.length} onClick={() => void saveAsSegment()} className={`${btn.outline} mt-3`}><Save className="h-3.5 w-3.5" />{savingSegment ? "Saving…" : "Save as a segment for later"}</button>
            </Card>
            {quickGrid}
          </>
        )}
        {panel === "segment" && (
          <Card className="p-4">
            <h3 className="m-0 text-[16px] font-bold text-gray-900 dark:text-slate-50">Saved Segment</h3>
            <p className="m-0 mt-1 text-[12.5px] text-gray-600 dark:text-slate-400">Groups from Audience &amp; Segments. They update by themselves as orders come in.</p>
            <div className="mt-3 space-y-1.5">
              {(designer?.segments ?? []).filter((row) => !row.list).map((row) => (
                <button key={row.id} type="button" disabled={row.status !== "active"} onClick={() => setAudience({ source: "segment", segmentId: row.id })}
                  className={`!min-h-0 flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left disabled:opacity-50 ${a.segmentId === row.id ? "border-[#8B74EE] bg-[#F5F2FE] dark:bg-violet-500/10" : "border-gray-100 hover:bg-gray-50 dark:border-slate-800 dark:hover:bg-slate-800"}`}>
                  <SegmentIcon name={row.icon} className="h-5 w-5 text-[#5B3FD9]" />
                  <span className="flex-1 text-[13.5px] font-semibold text-gray-900 dark:text-slate-50">{row.name}{row.status !== "active" ? " (paused)" : ""}</span>
                  <Tick on={a.segmentId === row.id} />
                </button>
              ))}
            </div>
          </Card>
        )}
        {panel === "journey" && (
          <Card className="p-4">
            <h3 className="m-0 text-[16px] font-bold text-gray-900 dark:text-slate-50">Customer Journey Audience</h3>
            <p className="m-0 mt-1 text-[12.5px] text-gray-600 dark:text-slate-400">Where each customer is right now, from their orders.</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {(designer?.journeyStages ?? []).map((stage) => (
                <button key={stage.key} type="button" onClick={() => setAudience({ source: "journey", journeyStage: stage.key })}
                  className={`!min-h-0 flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left ${a.journeyStage === stage.key ? "border-[#8B74EE] bg-[#F5F2FE] dark:bg-violet-500/10" : "border-gray-100 hover:bg-gray-50 dark:border-slate-800 dark:hover:bg-slate-800"}`}>
                  <span className="min-w-0 flex-1"><span className="block text-[13.5px] font-bold text-gray-900 dark:text-slate-50">{stage.name}</span><span className="block text-[12px] text-gray-500">{stage.hint}</span></span>
                  <Tick on={a.journeyStage === stage.key} />
                </button>
              ))}
            </div>
          </Card>
        )}
        {panel === "list" && (
          <Card className="p-4">
            <h3 className="m-0 text-[16px] font-bold text-gray-900 dark:text-slate-50">List Upload</h3>
            <p className="m-0 mt-1 text-[12.5px] text-gray-600 dark:text-slate-400">Send to exactly the people in an uploaded list.</p>
            <div className="mt-3 space-y-1.5">
              {(designer?.segments ?? []).filter((row) => row.list).map((row) => (
                <button key={row.id} type="button" onClick={() => setAudience({ source: "list", listId: row.id })}
                  className={`!min-h-0 flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left ${a.listId === row.id ? "border-[#8B74EE] bg-[#F5F2FE] dark:bg-violet-500/10" : "border-gray-100 hover:bg-gray-50 dark:border-slate-800 dark:hover:bg-slate-800"}`}>
                  <Upload className="h-5 w-5 text-sky-600" />
                  <span className="flex-1 text-[13.5px] font-semibold text-gray-900 dark:text-slate-50">{row.name}</span>
                  <Tick on={a.listId === row.id} />
                </button>
              ))}
              {!(designer?.segments ?? []).some((row) => row.list) && <p className="m-0 text-[13px] text-gray-500">No lists yet.</p>}
            </div>
            <button type="button" onClick={() => setImporting(true)} className={`${btn.soft} mt-3`}><Upload className="h-4 w-4" />Upload a CSV</button>
          </Card>
        )}
        {panel === "exclude" && (
          <Card className="p-4">
            <div className="flex items-center justify-between">
              <h3 className="m-0 text-[16px] font-bold text-gray-900 dark:text-slate-50">Exclude Customers</h3>
              <label className="flex items-center gap-2 text-[13px] text-gray-700 dark:text-slate-300"><input type="checkbox" checked={!!ex.on} onChange={(event) => setAudience({ ...a, exclude: { ...ex, on: event.target.checked } })} />On</label>
            </div>
            <p className="m-0 mt-1 text-[12.5px] text-gray-600 dark:text-slate-400">Taken out of whichever audience you picked.</p>
            <div className={`mt-3 space-y-3 ${ex.on ? "" : "pointer-events-none opacity-50"}`}>
              <label className="block text-[13px] font-semibold text-gray-800 dark:text-slate-200">People who got a delivery in the last
                <select value={String(ex.boughtWithinDays ?? 0)} onChange={(event) => setAudience({ ...a, exclude: { ...ex, on: true, boughtWithinDays: Number(event.target.value) || undefined } })} className={`${select} mt-1`}>
                  <option value="0">Don't exclude</option>{[3, 7, 14, 30].map((d) => <option key={d} value={d}>{d} days</option>)}
                </select>
              </label>
              <label className="block text-[13px] font-semibold text-gray-800 dark:text-slate-200">People we emailed in the last
                <select value={String(ex.emailedWithinDays ?? 0)} onChange={(event) => setAudience({ ...a, exclude: { ...ex, on: true, emailedWithinDays: Number(event.target.value) || undefined } })} className={`${select} mt-1`}>
                  <option value="0">Don't exclude</option>{[1, 3, 7, 14].map((d) => <option key={d} value={d}>{d} days</option>)}
                </select>
              </label>
              <label className="block text-[13px] font-semibold text-gray-800 dark:text-slate-200">People in this segment
                <select value={ex.segmentId ?? ""} onChange={(event) => setAudience({ ...a, exclude: { ...ex, on: true, segmentId: event.target.value || undefined } })} className={`${select} mt-1`}>
                  <option value="">None</option>{(designer?.segments ?? []).map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
                </select>
              </label>
            </div>
          </Card>
        )}
      </div>

      <div className="min-w-0 space-y-4">
        <Card className="p-4">
          <div className="flex items-start gap-2.5">
            <Users className="mt-0.5 h-5 w-5 text-[#5B3FD9]" />
            <div><h3 className="m-0 text-[16px] font-bold text-gray-900 dark:text-slate-50">Audience Preview</h3><p className="m-0 text-[12.5px] text-gray-600 dark:text-slate-400">How many customers will receive this campaign, from your choices.</p></div>
          </div>
          <div className="mt-3 flex items-center gap-4 rounded-xl bg-gradient-to-br from-[#EFEAFF] to-[#E3DBFF] px-4 py-4 dark:from-violet-500/15 dark:to-violet-500/5">
            <span className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-white text-[#5B3FD9] dark:bg-slate-900"><Users className="h-7 w-7" /></span>
            <div>
              <div className="flex items-center gap-2 text-[28px] font-extrabold leading-none text-gray-900 dark:text-slate-50">{preview ? count(preview.recipients) : "—"}{previewing && <Loader2 className="h-4 w-4 animate-spin text-[#5B3FD9]" />}</div>
              <div className="text-[15px] font-bold text-[#5B3FD9]">Customers</div>
            </div>
          </div>
          {preview && <p className="m-0 mt-2 text-[12px] leading-snug text-gray-600 dark:text-slate-400">{count(preview.matched)} customers match. {preview.withoutEmail ? `${count(preview.withoutEmail)} gave no email. ` : ""}{preview.optedOut ? `${count(preview.optedOut)} unsubscribed. ` : ""}Only people with an email receive it.</p>}
        </Card>
        <Card className="p-4">
          <h3 className="m-0 flex items-center gap-2 text-[16px] font-bold text-gray-900 dark:text-slate-50"><BarChart3 className="h-5 w-5 text-[#5B3FD9]" />Audience Insights</h3>
          <div className="mt-2 divide-y divide-gray-100 text-[13px] dark:divide-slate-800">
            {[
              ["Total Customers", preview ? count(preview.insights.total) : "—"],
              ["% of All Customers", preview ? pct(preview.insights.percentOfAll) : "—"],
              ["Avg. Order Value", preview ? naira(preview.insights.avgOrderValue) : "—"],
              ["Avg. Purchase Frequency", preview ? `${preview.insights.avgFrequency.toFixed(1)}x` : "—"],
              ["Last Purchase (Avg.)", preview?.insights.avgDaysSinceLast !== null && preview ? `${count(preview.insights.avgDaysSinceLast ?? 0)} days ago` : "—"]
            ].map(([label, value]) => (
              <div key={label} className="flex items-center justify-between py-2"><span className="text-gray-600 dark:text-slate-400">{label}</span><span className="font-bold text-gray-900 dark:text-slate-50">{value}</span></div>
            ))}
          </div>
        </Card>
        <Card className="p-4">
          <h3 className="m-0 flex items-center gap-2 text-[16px] font-bold text-gray-900 dark:text-slate-50"><PieChart className="h-5 w-5 text-[#5B3FD9]" />Audience Breakdown</h3>
          <div className="mt-3 flex items-center gap-3">
            <Donut size={124} stroke={18} slices={(preview?.breakdown ?? []).map((row, i) => ({ value: row.percent, color: SLICE_COLORS[i % SLICE_COLORS.length] }))}>
              <span className="text-[17px] font-extrabold text-gray-900 dark:text-slate-50">{preview ? count(preview.matched) : "—"}</span>
              <span className="text-[11px] text-gray-500">Customers</span>
            </Donut>
            <ul className="m-0 min-w-0 flex-1 list-none space-y-1.5 p-0 text-[12.5px]">
              {(preview?.breakdown ?? []).map((row, i) => (
                <li key={row.label} className="flex items-center gap-2"><span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: SLICE_COLORS[i % SLICE_COLORS.length] }} /><span className="flex-1 truncate text-gray-700 dark:text-slate-300">{row.label}</span><span className="font-bold tabular-nums">{pct(row.percent, 0)}</span></li>
              ))}
              {!preview?.breakdown.length && <li className="text-gray-500">Nobody matches yet.</li>}
            </ul>
          </div>
        </Card>
      </div>
      {importing && <ImportModal onClose={() => setImporting(false)} onListCreated={(listId) => setAudience({ source: "list", listId })}
        onDone={async (message) => { setImporting(false); onToast(message); await onDesignerChanged(); }} />}
    </div>
  );
}
