// Missed logs approved after a weekly report was sent (Bright, 6 Nov 2026:
// "always approve so it enters the weekly report", then "use auto" for
// missed cart logs too). Pure: the report's saved figures with those misses
// moved from "waiting" to "taken off". lib/missed-log-approval.ts loads and
// saves the report.

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sept", "Oct", "Nov", "Dec"];
/** "28 Oct": the report's own day label (weekly-report-model.ts dayLabel). */
const dayLabel = (key: string) => {
  const [, month, day] = key.split("-").map(Number);
  return `${day} ${MONTH_NAMES[(month || 1) - 1]}`;
};

type Miss = { ref: string; kind: string; missDate: string; amount: number; status: string; cartsMissed?: number };
type Fine = { id: string; label: string; amount: number; date: string };

/**
 * The saved figures with these misses approved (follow-up misses by miss id,
 * cart-log misses by "repId|date"). The fine lines are the ones
 * buildRepWeeklySnapshot makes for approved misses (one per day and kind:
 * "Missed follow-up logs 28 Oct: 3 orders", "Missed cart logs 28 Oct: 2
 * carts"), and the sums are the report's own, as in snapshotWithFine
 * (fine-appeal-rules.ts): final = earned + corrections - fines - carried
 * fines, never below 0; what is left over carries to next week. Returns the
 * same object when nothing changes.
 */
export function snapshotWithApprovedMisses(snapshot: any, refs: string[]): any {
  if (!snapshot || typeof snapshot !== "object" || !snapshot.totals || !Array.isArray(snapshot.logMisses)) return snapshot;
  const approve = new Set(refs);
  let moved = 0;
  const logMisses: Miss[] = snapshot.logMisses.map((miss: Miss) => {
    if (miss.status !== "pending" || !approve.has(miss.ref)) return miss;
    moved += Math.max(0, Number(miss.amount) || 0);
    return { ...miss, status: "approved" };
  });
  if (logMisses.every((miss, index) => miss === snapshot.logMisses[index])) return snapshot;

  // Every approved miss of the week, one line per day and kind (cart logs first on a day, as the report sorts them).
  const lines = new Map<string, Fine & { kind: string; count: number }>();
  for (const miss of logMisses) {
    if (miss.status !== "approved" || !(Number(miss.amount) > 0)) continue;
    const key = `${miss.kind}|${miss.missDate}`;
    const line = lines.get(key) ?? { id: `logmiss:${key}`, label: "", amount: 0, date: miss.missDate, kind: miss.kind, count: 0 };
    line.amount += Number(miss.amount);
    line.count += miss.kind === "cart_log" ? (Number(miss.cartsMissed) || 1) : 1;
    lines.set(key, line);
  }
  const fines: Fine[] = Array.isArray(snapshot.fines) ? snapshot.fines : [];
  const nextFines: Fine[] = [
    ...fines.filter((fine) => !String(fine.id).startsWith("logmiss:")),
    ...[...lines.values()].sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind)).map((line) => ({
      id: line.id,
      date: line.date,
      amount: line.amount,
      label: line.kind === "cart_log"
        ? `Missed cart logs ${dayLabel(line.date)}: ${line.count} cart${line.count === 1 ? "" : "s"}`
        : `Missed follow-up logs ${dayLabel(line.date)}: ${line.count} order${line.count === 1 ? "" : "s"}`
    }))
  ];

  const t = snapshot.totals;
  const earned = Math.round(Number(t.baseBonus ?? 0) + Number(t.upsellBonus ?? 0) + Number(t.crossSellBonus ?? 0) + Number(t.deliveryBonus ?? 0));
  const adjustments = Math.round(Number(t.adjustments ?? 0));
  const carried = Math.round(Number(t.carriedFines ?? 0));
  const fineTotal = Math.max(0, Math.round(Number(t.fines ?? 0) + moved));
  return {
    ...snapshot,
    fines: nextFines,
    logMisses,
    totals: {
      ...t,
      fines: fineTotal,
      logMissFines: Math.round(Number(t.logMissFines ?? 0) + moved),
      pendingLogMisses: Math.max(0, Math.round(Number(t.pendingLogMisses ?? 0) - moved)),
      finalBonus: Math.max(0, earned + adjustments - fineTotal - carried),
      unpaidFines: Math.max(0, fineTotal + carried - earned - adjustments)
    }
  };
}
