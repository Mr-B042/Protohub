import { useEffect, useMemo } from "react";
import { Home, Layers, Lightbulb, Pencil, Truck } from "lucide-react";
import type { StockIntelStatus } from "../../../lib/api";
import { Donut, nf } from "../parts";
import { IntelMap, type Arrow, type Callout } from "./IntelMap";
import { NetworkFlow, STATUS_TEXT } from "./Overview";
import { buildRouteGroups } from "./network-model";
import { Card, CardHead, STATUS_ORDER, STATUS_TONE, StatusPill, csv, daysText, houseTone, one, place, units, type IntelCtx } from "./shared";

const dayDiff = (from: string, to: string) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);

export function NetworkView({ ctx }: { ctx: IntelCtx }) {
  const { groups, other } = useMemo(() => buildRouteGroups(ctx.data, ctx.rows), [ctx.data, ctx.rows]);

  // Map: each restocked state tinted in its hub's colour; pins + callouts at the hubs.
  const fills: Record<string, string> = {};
  for (const g of [...groups].reverse()) for (const s of g.serves) fills[s] = `${g.color}55`;
  for (const g of groups) fills[g.state] = `${g.color}99`;
  const main = groups.find((g) => g.role === "Main Hub");
  const callouts: Callout[] = groups.map((g) => ({
    state: g.state, color: g.color, strong: g === main, pin: true,
    lines: [g.kind === "direct" ? g.title : g.title, `(${g.kind === "direct" ? "Direct" : g.role})`, `Stock: ${units(g.stock)}`]
  }));
  const arrows: Arrow[] = groups.filter((g) => g.kind === "hub").flatMap((g) => g.serves.filter((s) => ctx.data.hubs.some((h) => h.state === s)).slice(0, 4).map((s) => ({ from: g.state, to: s, color: g.color })));

  // Per agent hub: stock, demand, coverage, worst status.
  const hubs = useMemo(() => ctx.data.hubs.map((hub) => {
    const rows = ctx.rows.filter((r) => r.locationId === hub.locationId);
    const usable = rows.reduce((s, r) => s + r.usable, 0), speed = rows.reduce((s, r) => s + r.speed, 0), onWay = rows.reduce((s, r) => s + r.inTransit, 0);
    const status = rows.reduce<StockIntelStatus>((w, r) => (STATUS_ORDER[r.status] < STATUS_ORDER[w] ? r.status : w), "Healthy");
    const lead = rows.length ? rows[0].leadDays : 4;
    return { ...hub, usable, speed, coverage: speed > 0 ? (usable + onWay) / speed : null, status, lead, hasRows: rows.length > 0 };
  }).filter((h) => h.hasRows).sort((a, b) => {
    const ga = groups.findIndex((g) => g.state === a.state), gb = groups.findIndex((g) => g.state === b.state);
    return (ga < 0 ? 99 : ga) - (gb < 0 ? 99 : gb) || STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
  }), [ctx.data.hubs, ctx.rows, groups]);

  const total = hubs.reduce((s, h) => s + h.usable, 0);
  const slices = (["Healthy", "Watch", "Restock Soon", "Critical"] as StockIntelStatus[]).map((s) => ({ label: s, value: hubs.filter((h) => h.status === s).length, color: STATUS_TONE[s].fill }));
  const risk = ctx.data.result.hubRisks.filter((r) => r.shortage > 0 && r.networkDemand > 0)[0] ?? null;
  const covered = ctx.data.result.hubRisks.filter((r) => r.networkDemand > 0)[0] ?? null;

  // Distribution Performance (last window): per route.
  const outcomes = new Map(ctx.data.outcomes.map((o) => [o.state, o]));
  const perf = groups.map((g) => {
    const states = g.kind === "direct" ? [g.state] : [...new Set([g.state, ...g.serves])];
    const rows = ctx.rows.filter((r) => states.includes(r.state));
    const orders = states.reduce((s, st) => s + (outcomes.get(st)?.orders ?? 0), 0), delivered = states.reduce((s, st) => s + (outcomes.get(st)?.delivered ?? 0), 0);
    const targetHubs = new Set(ctx.data.hubs.filter((h) => (g.kind === "direct" ? h.state === g.state : g.serves.includes(h.state))).map((h) => h.locationId));
    const leadOf = new Map(ctx.rows.map((r) => [r.locationId, r.leadDays]));
    const received = ctx.data.waybills.filter((w) => w.status === "Received" && w.toLocationId && targetHubs.has(w.toLocationId) && w.dispatched && w.received);
    const taken = received.map((w) => Math.max(0, dayDiff(w.dispatched!, w.received!)));
    const onTime = received.filter((w, i) => taken[i] <= (leadOf.get(w.toLocationId!) ?? 4)).length;
    const leads = [...targetHubs].map((id) => leadOf.get(id)).filter((v): v is number => v != null);
    return {
      key: g.key,
      label: g.kind === "direct" ? `${g.title} (Direct)`
        : `${place(g.state)} → ${g.servesLabel.replace(/ \(\d+ states\)$/, "").replace(/ \(Fallback\)/g, "")}${g.kind === "fallback" ? " (fallback)" : ""}`,
      delivered: rows.reduce((s, r) => s + r.delivered, 0), rate: orders > 0 ? (delivered / orders) * 100 : null,
      lead: taken.length ? taken.reduce((a, b) => a + b, 0) / taken.length : leads.length ? leads.reduce((a, b) => a + b, 0) / leads.length : null,
      onTime: received.length ? (onTime / received.length) * 100 : null
    };
  });

  const exportRows = () => csv("hub-stock", [["Hub / Agent", "State", "Available", "Sells a day", "Coverage (days)", "Status"], ...hubs.map((h) => [h.agentName, place(h.state), h.usable, one(h.speed), h.coverage === null ? "" : one(h.coverage), h.status])]);
  useEffect(() => { ctx.exportRef.current = exportRows; });

  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
        <Card className="p-4">
          <CardHead title="Distribution Network" info="Built from the supply routes. Orders still go only to agents in their own state; routes only decide where restock is sent from." sub="Your stock flow, hubs, coverage areas, and fallback routes across Nigeria." />
          <div className="mt-2 flex flex-col gap-3 lg:flex-row lg:items-start">
            <div className="min-w-0 flex-1"><IntelMap fills={fills} callouts={callouts} arrows={arrows} label="Distribution network" /></div>
            <div className="w-full shrink-0 rounded-xl border border-gray-200 p-3 lg:w-[250px] dark:border-slate-700">
              <div className="mb-2 flex items-center gap-2 text-[13px] font-bold text-gray-900 dark:text-slate-100"><Layers className="h-4 w-4 text-[#1F8FE0]" /> Distribution Setup</div>
              <ul className="m-0 list-none space-y-2.5 p-0">
                {groups.map((g) => (
                  <li key={g.key} className="flex gap-2 text-[11.5px]">
                    <span className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded-full" style={{ background: g.color }} />
                    <span><b className="text-gray-900 dark:text-slate-100">{g.title}</b> <span className="text-gray-500">({g.kind === "direct" ? "Direct" : g.role})</span><br /><span className="text-gray-600 dark:text-slate-400">→ {g.kind === "direct" ? `${place(g.state)} only` : g.kind === "fallback" ? `Backup for ${g.servesLabel.replace(/ \(Fallback\)/g, "")}` : `Serves ${g.servesLabel}`}</span></span>
                  </li>
                ))}
                {other.length > 0 && <li className="flex gap-2 text-[11.5px]"><span className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded-full bg-slate-400" /><span><b>Main warehouse</b><br /><span className="text-gray-600">→ {other.map(place).join(", ")}</span></span></li>}
              </ul>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <CardHead title={<>Network Flow <span className="text-[13px] font-semibold text-gray-500">(Stock Route)</span></>}
            action={<button type="button" onClick={ctx.openRoutes} className="!min-h-0 inline-flex h-8 items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 text-[12px] font-semibold text-gray-700 hover:bg-gray-50 dark:border-slate-700 dark:text-slate-200"><Pencil className="h-3.5 w-3.5" />{ctx.canEdit ? "Edit routes" : "Routes"}</button>} />
          <NetworkFlow groups={groups} other={other} onEdit={ctx.canEdit ? ctx.openRoutes : undefined} />
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)_minmax(0,1.1fr)]">
        <Card className="p-4">
          <CardHead Icon={Home} title="Hub Stock & Capacity" />
          <div className="mt-2 overflow-x-auto">
            <table className="w-full !min-w-0 text-[12.5px]">
              <thead><tr className="text-left text-[11px] font-semibold text-gray-600"><th className="py-2">Hub / Agent</th><th className="text-right">Available Stock</th><th className="text-right">7-Day Demand</th><th className="text-right">Coverage</th><th className="text-right">Status</th></tr></thead>
              <tbody>
                {hubs.map((h) => (
                  <tr key={h.locationId} className="cursor-pointer border-t border-gray-100 hover:bg-gray-50 dark:border-slate-800 dark:hover:bg-slate-800/50" onClick={() => ctx.openHub(h.locationId)}>
                    <td className="py-2"><span className="flex items-center gap-2"><span className={`inline-flex h-6 w-6 items-center justify-center rounded-md ${houseTone(h.locationId)}`}><Home className="h-3.5 w-3.5" /></span><span className="whitespace-nowrap font-semibold">{h.agentName}</span></span></td>
                    <td className="whitespace-nowrap text-right">{units(h.usable)}</td><td className="whitespace-nowrap text-right">{one(h.speed)}/day</td>
                    <td className="whitespace-nowrap text-right font-bold" style={{ color: STATUS_TEXT[h.status] }}>{h.coverage === null ? "—" : daysText(h.coverage)}</td>
                    <td className="pl-2 text-right"><StatusPill status={h.status} /></td>
                  </tr>
                ))}
                {hubs.length === 0 && <tr><td colSpan={5} className="py-8 text-center text-gray-500">No agent stock yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
        <Card className="p-4">
          <CardHead Icon={Home} title="Network Health" />
          <div className="mt-3 flex items-center gap-4">
            <Donut slices={slices} center={nf(total)} sub="Total Stock" size={140} />
            <ul className="m-0 flex-1 list-none space-y-2 p-0 text-[12.5px]">
              {slices.filter((s) => s.value > 0 || s.label !== "Restock Soon").map((s) => (
                <li key={s.label} className="flex items-center gap-2"><span className="h-3 w-3 rounded-full" style={{ background: s.color }} /><b className="flex-1">{s.label}</b><span>{hubs.length ? Math.round((s.value / hubs.length) * 100) : 0}%</span><span className="text-gray-500">({s.value} agent{s.value === 1 ? "" : "s"})</span></li>
              ))}
            </ul>
          </div>
          <div className="mt-3 rounded-xl bg-violet-50 p-3 dark:bg-violet-500/10">
            <div className="flex items-center gap-1.5 text-[13px] font-bold text-gray-900 dark:text-slate-100"><Lightbulb className="h-4 w-4 text-violet-600" /> Key Insight</div>
            {risk ? (
              <div className="mt-1 text-[12px] leading-relaxed text-gray-700 dark:text-slate-300">
                <b>{risk.hubLabel} — Network Stock Risk ({ctx.productName(risk.productId)})</b><br />
                Available {units(risk.available)} · its own demand {nf(risk.ownDemand)} · {risk.dependents.length} agent{risk.dependents.length === 1 ? "" : "s"} it restocks need {nf(risk.networkDemand)} · total {nf(risk.required)} · <b className="text-rose-600">short by {units(risk.shortage)}</b>.<br />
                Replenish {place(risk.sourceState)} with at least <b>{units(risk.shortage)}</b> before sending more out of it.
              </div>
            ) : (
              <p className="m-0 mt-1 text-[12px] text-gray-700 dark:text-slate-300">{covered ? `${covered.hubLabel} can cover its own week and the ${units(covered.networkDemand)} its agents need (${units(covered.available)} on hand).` : "Every supply hub can cover its own week and the agents it restocks."}</p>
            )}
          </div>
        </Card>
        <Card className="p-4">
          <CardHead Icon={Truck} title={<>Distribution Performance <span className="text-[13px] font-semibold text-gray-500">(Last {ctx.windowDays} Days)</span></>} info="Delivered = units delivered by agents on the route. DR = orders placed in the period that are delivered. Lead time and On-Time come from received waybills in the last 60 days." />
          <div className="mt-2 overflow-x-auto">
            <table className="w-full !min-w-0 text-[12.5px]">
              <thead><tr className="text-left text-[11px] font-semibold text-gray-600"><th className="py-2">Route / Hub</th><th className="text-right">Delivered</th><th className="text-right">DR</th><th className="text-right">Avg. Lead Time</th><th className="text-right">On-Time</th></tr></thead>
              <tbody>
                {perf.map((p) => (
                  <tr key={p.key} className="border-t border-gray-100 dark:border-slate-800">
                    <td className="max-w-[170px] truncate py-2 font-semibold" title={p.label}>{p.label}</td>
                    <td className="text-right">{nf(p.delivered)}</td><td className="text-right">{p.rate === null ? "—" : `${Math.round(p.rate)}%`}</td>
                    <td className="whitespace-nowrap text-right">{p.lead === null ? "—" : daysText(p.lead)}</td>
                    <td className="text-right font-bold text-emerald-600">{p.onTime === null ? <span className="font-normal text-gray-400">—</span> : `${Math.round(p.onTime)}%`}</td>
                  </tr>
                ))}
                {perf.length === 0 && <tr><td colSpan={5} className="py-8 text-center text-gray-500">No routes yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}
