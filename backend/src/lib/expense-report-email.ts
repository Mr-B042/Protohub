import { supabase } from "./supabase.js";
import { logger } from "./logger.js";
import { sendMarketingEmail } from "./mailer.js";
import { lagosDateKey } from "./sales-bonus-engine.js";
import { fetchAllRowsOrThrow } from "./query-limits.js";

/**
 * Scheduled expense reports (Reports & Forecasts › Schedule Report). Only
 * reports the server can work out from expense rows alone are offered
 * (expenses by category, budget vs actual, ad spend by product); profit
 * reports need the browser's profit helpers and are downloaded instead.
 *
 * Weekly = every Monday for the Sunday–Saturday week before; monthly = the
 * 1st, for the month before. Sent at most once per period (last_sent_at).
 */

const addDays = (day: string, n: number) => { const d = new Date(`${day}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const naira = (v: number) => `₦${Math.round(v).toLocaleString("en-NG")}`;
const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

export function reportWindow(frequency: "weekly" | "monthly", today: string) {
  if (frequency === "weekly") {
    const d = new Date(`${today}T00:00:00Z`);
    const thisSunday = addDays(today, -d.getUTCDay());
    return { from: addDays(thisSunday, -7), to: addDays(thisSunday, -1) };
  }
  const first = `${today.slice(0, 7)}-01`;
  const prevLast = addDays(first, -1);
  return { from: `${prevLast.slice(0, 7)}-01`, to: prevLast };
}

const TITLE: Record<string, string> = { expenses: "Expense report", budget: "Budget vs actual", advertising: "Advertising report" };

async function buildReport(orgId: string, branchId: string, report: string, from: string, to: string) {
  const rows = await fetchAllRowsOrThrow<any>(() => supabase.from("expenses").select("id, category, amount, product_id, date")
    .eq("org_id", orgId).eq("branch_id", branchId).gte("date", from).lte("date", to).order("date").order("id"));
  const lines: Array<[string, string, string?]> = [];
  if (report === "expenses") {
    const by = new Map<string, number>();
    for (const r of rows) by.set(r.category, (by.get(r.category) ?? 0) + Number(r.amount));
    const total = [...by.values()].reduce((a, b) => a + b, 0);
    for (const [c, v] of [...by.entries()].sort((a, b) => b[1] - a[1])) lines.push([c, naira(v), total ? `${((v / total) * 100).toFixed(1)}%` : "—"]);
    lines.push(["Total", naira(total), `${rows.length} records`]);
  } else if (report === "budget") {
    const month = from.slice(0, 7);
    const { data: budgets } = await supabase.from("expense_budgets").select("category, amount").eq("org_id", orgId).eq("branch_id", branchId).eq("month", month);
    const spent = new Map<string, number>();
    for (const r of rows) spent.set(r.category, (spent.get(r.category) ?? 0) + Number(r.amount));
    if (!(budgets ?? []).length) lines.push(["No budgets set for this month", "—"]);
    for (const b of (budgets ?? []) as any[]) {
      const s = spent.get(b.category) ?? 0;
      lines.push([b.category, `${naira(s)} of ${naira(Number(b.amount))}`, Number(b.amount) ? `${Math.round((s / Number(b.amount)) * 100)}%` : "—"]);
    }
  } else {
    const ads = rows.filter((r) => r.category === "Ad Spend");
    const ids = [...new Set(ads.map((r) => r.product_id).filter(Boolean))];
    const { data: products } = ids.length ? await supabase.from("products").select("id, name").in("id", ids) : { data: [] as any[] };
    const nameOf = new Map(((products ?? []) as any[]).map((p) => [String(p.id), String(p.name)]));
    const by = new Map<string, number>();
    for (const r of ads) { const k = r.product_id ? nameOf.get(String(r.product_id)) ?? "Other product" : "No product"; by.set(k, (by.get(k) ?? 0) + Number(r.amount)); }
    const total = [...by.values()].reduce((a, b) => a + b, 0);
    for (const [c, v] of [...by.entries()].sort((a, b) => b[1] - a[1])) lines.push([c, naira(v), total ? `${((v / total) * 100).toFixed(1)}%` : "—"]);
    lines.push(["Total ad spend", naira(total)]);
  }
  return lines;
}

export async function runExpenseReportEmails(now = new Date()) {
  const today = lagosDateKey(now);
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
  const { data: schedules, error } = await supabase.from("expense_report_schedules").select("*").eq("active", true);
  if (error) throw error;
  let sent = 0;
  for (const s of (schedules ?? []) as any[]) {
    const due = s.frequency === "weekly" ? weekday === 1 : today.endsWith("-01");
    if (!due) continue;
    const window = reportWindow(s.frequency, today);
    if (s.last_sent_at && lagosDateKey(s.last_sent_at) === today) continue;
    try {
      const lines = await buildReport(s.org_id, s.branch_id, s.report, window.from, window.to);
      const title = `${TITLE[s.report] ?? "Report"}: ${window.from} to ${window.to}`;
      const html = `<div style="font-family:Inter,Arial,sans-serif;color:#111"><h2 style="margin:0 0 12px">${esc(title)}</h2><table cellpadding="6" style="border-collapse:collapse;font-size:14px">${lines.map(([a, b, c]) => `<tr><td style="border-bottom:1px solid #eee">${esc(a)}</td><td style="border-bottom:1px solid #eee;text-align:right;font-weight:600">${esc(b)}</td><td style="border-bottom:1px solid #eee;color:#666">${esc(c ?? "")}</td></tr>`).join("")}</table><p style="color:#666;font-size:12px;margin-top:16px">From Protohub › Expenses › Reports &amp; Forecasts. Set up by ${esc(s.created_by_name)}.</p></div>`;
      const text = `${title}\n\n${lines.map(([a, b, c]) => `${a}: ${b}${c ? ` (${c})` : ""}`).join("\n")}`;
      for (const email of s.emails as string[]) await sendMarketingEmail(s.org_id, { to: { email }, subject: title, html, text }, s.branch_id);
      await supabase.from("expense_report_schedules").update({ last_sent_at: now.toISOString() }).eq("id", s.id);
      sent += 1;
    } catch (err: any) {
      logger.warn("expense report email failed", { id: s.id, error: err?.message ?? String(err) });
    }
  }
  return { sent };
}
