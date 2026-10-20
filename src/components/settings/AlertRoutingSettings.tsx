import { useEffect, useMemo, useState } from "react";
import { Bell, BellOff, Lock, RotateCcw, Smartphone } from "lucide-react";
import { notificationRoutingApi, type AlertRoute, type AlertRoutingSettings as Settings } from "../../lib/api";

// ── Alert routing (Bright, 20 Oct 2026) ─────────────────────────────────────
// Per alert: which roles get it, whether the rep on the order gets it, and
// whether it pops up on phones or stays in the in-app list only. Owner edits;
// Admins can look. Every alert starts on what it did before this existed.

const ROLE_LABEL: Record<string, string> = {
  "Inventory Manager & Logistics Operations": "Inventory & Logistics",
};
const sameRoute = (a: AlertRoute, b: AlertRoute) =>
  a.rep === b.rep && a.push === b.push && a.roles.length === b.roles.length && a.roles.every((r) => b.roles.includes(r));

export default function AlertRoutingSettings({ showToast }: { showToast: (message: string) => void }) {
  const [data, setData] = useState<Settings | null>(null);
  const [draft, setDraft] = useState<Record<string, AlertRoute>>({});
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const load = (next: Settings) => {
    setData(next);
    setDraft(Object.fromEntries(next.alerts.map((a) => [a.key, { ...a.route, roles: [...a.route.roles] }])));
  };
  useEffect(() => { notificationRoutingApi.get().then(load).catch((e: any) => setError(e?.message ?? "Could not load the alert settings.")); }, []);

  const changed = useMemo(() => (data?.alerts ?? []).filter((a) => draft[a.key] && !sameRoute(draft[a.key], a.route)).map((a) => a.key), [data, draft]);
  const groups = useMemo(() => {
    const out: Array<{ name: string; items: Settings["alerts"] }> = [];
    for (const a of data?.alerts ?? []) {
      const g = out.find((x) => x.name === a.group);
      if (g) g.items.push(a); else out.push({ name: a.group, items: [a] });
    }
    return out;
  }, [data]);

  const canEdit = !!data?.canEdit;
  const update = (key: string, fn: (r: AlertRoute) => AlertRoute) => {
    if (!canEdit) return;
    setDraft((prev) => ({ ...prev, [key]: fn(prev[key]) }));
  };
  const save = async () => {
    setSaving(true);
    try {
      load(await notificationRoutingApi.save(Object.fromEntries(changed.map((k) => [k, draft[k]]))));
      showToast("Alert settings saved.");
    } catch (e: any) { showToast(e?.message ?? "Could not save the alert settings."); }
    finally { setSaving(false); }
  };

  return (
    <section className="space-y-3">
      <h2 className="text-base font-bold text-gray-800">Alert routing</h2>
      <p className="text-sm text-gray-500">Choose who gets each alert, and whether it pops up on their phone or only shows in the notifications list.</p>
      {!canEdit && data && (
        <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800"><Lock className="h-4 w-4 shrink-0" /> Only the Owner can change these.</div>
      )}
      {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}
      {!data && !error && <div className="rounded-xl border border-gray-200 bg-white px-4 py-6 text-center text-sm text-gray-400">Loading…</div>}

      {groups.map((group) => (
        <div key={group.name} className="space-y-2">
          <h3 className="pt-1 text-[11px] font-semibold uppercase tracking-wider text-gray-400">{group.name}</h3>
          {group.items.map((alert) => {
            const route = draft[alert.key];
            if (!route) return null;
            const off = route.roles.length === 0 && !route.rep;
            const isDefault = sameRoute(route, alert.defaults);
            return (
              <div key={alert.key} data-testid={`alert-route-${alert.key}`} className={`rounded-xl border bg-white p-4 shadow-sm ${changed.includes(alert.key) ? "border-[#1F8FE0]" : "border-gray-200"}`}>
                <div className="flex items-start gap-3">
                  <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${off ? "bg-gray-100 text-gray-400" : "bg-blue-50 text-[#1F8FE0]"}`}>{off ? <BellOff className="h-4 w-4" /> : <Bell className="h-4 w-4" />}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <h4 className="m-0 text-sm font-bold text-gray-900">{alert.label}</h4>
                      {off && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-500">Off, nobody gets it</span>}
                    </div>
                    <p className="m-0 text-[13px] text-gray-500">{alert.hint}</p>
                  </div>
                  {canEdit && !isDefault && (
                    <button type="button" onClick={() => update(alert.key, () => ({ ...alert.defaults, roles: [...alert.defaults.roles] }))} className="!min-h-0 inline-flex shrink-0 items-center gap-1 text-[12px] font-semibold text-gray-500 hover:text-gray-800" title="Back to the starting setting"><RotateCcw className="h-3.5 w-3.5" /> Reset</button>
                  )}
                </div>

                <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label={`Who gets "${alert.label}"`}>
                  {data!.roles.map((role) => {
                    const on = route.roles.includes(role);
                    return (
                      <button key={role} type="button" aria-pressed={on} disabled={!canEdit}
                        onClick={() => update(alert.key, (r) => ({ ...r, roles: on ? r.roles.filter((x) => x !== role) : [...r.roles, role] }))}
                        className={`!min-h-0 rounded-full border px-3 py-1.5 text-[12.5px] font-semibold transition-colors disabled:cursor-default ${on ? "border-[#1F8FE0] bg-[#1F8FE0] text-white" : "border-gray-200 bg-white text-gray-500 hover:border-gray-300"}`}>
                        {on ? "✓ " : ""}{ROLE_LABEL[role] ?? role}
                      </button>
                    );
                  })}
                  {alert.repApplies && (
                    <button type="button" aria-pressed={route.rep} disabled={!canEdit}
                      onClick={() => update(alert.key, (r) => ({ ...r, rep: !r.rep }))}
                      className={`!min-h-0 rounded-full border px-3 py-1.5 text-[12.5px] font-semibold transition-colors disabled:cursor-default ${route.rep ? "border-emerald-600 bg-emerald-600 text-white" : "border-dashed border-gray-300 bg-white text-gray-500 hover:border-gray-400"}`}>
                      {route.rep ? "✓ " : ""}The rep on it
                    </button>
                  )}
                </div>

                <div className="mt-3 flex items-center justify-between gap-3 border-t border-gray-100 pt-3">
                  <span className="flex items-center gap-2 text-[13px] text-gray-600"><Smartphone className="h-4 w-4 text-gray-400" />{route.push ? "Pops up on phones" : "Notifications list only, no pop-up"}</span>
                  <button type="button" role="switch" aria-checked={route.push} aria-label={`Phone pop-up for "${alert.label}"`} disabled={!canEdit}
                    onClick={() => update(alert.key, (r) => ({ ...r, push: !r.push }))}
                    className={`relative h-6 w-11 shrink-0 rounded-full p-0 !min-h-0 transition-colors disabled:opacity-60 ${route.push ? "bg-[#1F8FE0]" : "bg-gray-200"}`}>
                    <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${route.push ? "left-5" : "left-0.5"}`} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ))}

      {canEdit && changed.length > 0 && (
        <div className="sticky bottom-3 z-10 flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-lg" style={{ marginBottom: "env(safe-area-inset-bottom)" }}>
          <span className="text-sm text-gray-600">{changed.length} alert{changed.length === 1 ? "" : "s"} changed</span>
          <div className="flex gap-2">
            <button type="button" onClick={() => data && load(data)} disabled={saving} className="!min-h-0 rounded-lg px-3 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-100">Undo</button>
            <button type="button" onClick={save} disabled={saving} className="!min-h-0 rounded-lg bg-[#1F8FE0] px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">{saving ? "Saving…" : "Save"}</button>
          </div>
        </div>
      )}
    </section>
  );
}
