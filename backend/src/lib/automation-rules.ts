// Create Automation builder (Bright, 13 Nov 2026): pure rules, no database.
// An automation = trigger → conditions → actions (in order) → schedule → settings.

export const TRIGGERS = ["new_message", "new_lead", "tag_added", "order_update", "assigned", "time_based"] as const;
export type TriggerKey = typeof TRIGGERS[number];
export const PLATFORMS = ["facebook", "instagram", "telegram", "whatsapp"] as const;
/** Customer chats only reach Protohub from Facebook / Instagram (ManyChat). */
export const LIVE_PLATFORMS = ["facebook", "instagram"];

export const CONDITION_FIELDS = ["tag", "message", "state", "product", "status", "platform", "orders", "hot", "score"] as const;
export type ConditionField = typeof CONDITION_FIELDS[number];
export type Condition = { id: string; field: ConditionField; op: string; values: string[] };
export type ConditionGroup = { id: string; match: "all" | "any"; rules: Condition[] };

export const ACTION_TYPES = ["send_message", "assign", "add_tag", "update_lead", "trigger_automation", "notify_team", "wait", "route_lead", "webhook"] as const;
export type ActionType = typeof ACTION_TYPES[number];
export type Action = { id: string; type: ActionType; config: Record<string, any> };

export type AutomationConfig = {
  trigger: {
    key: TriggerKey; platforms: string[];
    /** new_message: "first" (first message only) or "any". */
    event: string;
    tag?: string; orderStatus?: string;
  };
  conditions: { enabled: boolean; match: "all" | "any" | "custom"; rules: Condition[]; groups: ConditionGroup[] };
  actions: Action[];
  schedule: {
    mode: "immediate" | "scheduled" | "delay" | "recurring";
    date?: string; time?: string; delayMinutes: number;
    repeat: boolean; frequency: "daily" | "weekly" | "monthly"; every: number;
    ends: "never" | "on_date" | "after"; endDate?: string; endAfter: number;
    workingHoursOnly: boolean; days: number[]; startMinute: number; endMinute: number;
  };
  settings: {
    notifyOwner: boolean; notifyTeam: boolean; channel: "inapp" | "inapp_push";
    maxRunsPerCustomer: number; coolDownDays: number; stopAfterEnabled: boolean; stopAfterDays: number;
    language: string; trackPerformance: boolean; params: Array<{ key: string; value: string }>;
  };
};

export const DEFAULT_CONFIG: AutomationConfig = {
  trigger: { key: "new_message", platforms: ["facebook", "instagram"], event: "first" },
  conditions: { enabled: false, match: "all", rules: [], groups: [] },
  actions: [],
  schedule: { mode: "immediate", delayMinutes: 60, repeat: false, frequency: "daily", every: 1, ends: "never", endAfter: 10, workingHoursOnly: false, days: [1, 2, 3, 4, 5, 6], startMinute: 510, endMinute: 1020 },
  settings: { notifyOwner: false, notifyTeam: false, channel: "inapp", maxRunsPerCustomer: 1, coolDownDays: 1, stopAfterEnabled: false, stopAfterDays: 30, language: "en-NG", trackPerformance: true, params: [] }
};

const str = (v: unknown, max = 200) => String(v ?? "").trim().slice(0, max);
const int = (v: unknown, min: number, max: number, fb: number) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n >= min && n <= max ? n : fb; };
const list = (v: unknown, max = 30) => (Array.isArray(v) ? v.map((x) => str(x, 80)).filter(Boolean).slice(0, max) : []);
const cleanRule = (r: any, i: number): Condition | null => {
  if (!r || !CONDITION_FIELDS.includes(r.field)) return null;
  return { id: str(r.id, 40) || `r${i}`, field: r.field, op: str(r.op, 20) || "is", values: list(r.values) };
};

/** Make anything posted into a safe, complete config. */
export function cleanConfig(raw: unknown): AutomationConfig {
  const r = raw && typeof raw === "object" ? raw as any : {};
  const d = DEFAULT_CONFIG;
  const t = r.trigger ?? {}, c = r.conditions ?? {}, s = r.schedule ?? {}, g = r.settings ?? {};
  return {
    trigger: {
      key: TRIGGERS.includes(t.key) ? t.key : d.trigger.key,
      platforms: Array.isArray(t.platforms) ? t.platforms.filter((p: string) => PLATFORMS.includes(p as any)) : d.trigger.platforms,
      event: t.event === "any" ? "any" : "first",
      tag: str(t.tag, 40) || undefined, orderStatus: str(t.orderStatus, 40) || undefined
    },
    conditions: {
      enabled: c.enabled === true,
      match: c.match === "any" ? "any" : c.match === "custom" ? "custom" : "all",
      rules: (Array.isArray(c.rules) ? c.rules : []).slice(0, 30).map(cleanRule).filter(Boolean) as Condition[],
      groups: (Array.isArray(c.groups) ? c.groups : []).slice(0, 10).map((x: any, i: number) => ({
        id: str(x?.id, 40) || `g${i}`, match: x?.match === "any" ? "any" as const : "all" as const,
        rules: (Array.isArray(x?.rules) ? x.rules : []).slice(0, 20).map(cleanRule).filter(Boolean) as Condition[]
      }))
    },
    actions: (Array.isArray(r.actions) ? r.actions : []).slice(0, 20).filter((a: any) => ACTION_TYPES.includes(a?.type)).map((a: any, i: number) => ({
      id: str(a.id, 40) || `a${i}`, type: a.type, config: a.config && typeof a.config === "object" ? JSON.parse(JSON.stringify(a.config)) : {}
    })),
    schedule: {
      mode: ["scheduled", "delay", "recurring"].includes(s.mode) ? s.mode : "immediate",
      date: /^\d{4}-\d{2}-\d{2}$/.test(str(s.date)) ? str(s.date) : undefined,
      time: /^\d{2}:\d{2}$/.test(str(s.time)) ? str(s.time) : undefined,
      delayMinutes: int(s.delayMinutes, 1, 60 * 24 * 60, d.schedule.delayMinutes),
      repeat: s.repeat === true || s.mode === "recurring",
      frequency: s.frequency === "weekly" ? "weekly" : s.frequency === "monthly" ? "monthly" : "daily",
      every: int(s.every, 1, 365, 1),
      ends: s.ends === "on_date" ? "on_date" : s.ends === "after" ? "after" : "never",
      endDate: /^\d{4}-\d{2}-\d{2}$/.test(str(s.endDate)) ? str(s.endDate) : undefined,
      endAfter: int(s.endAfter, 1, 10000, 10),
      workingHoursOnly: s.workingHoursOnly === true,
      days: Array.isArray(s.days) ? [...new Set(s.days.map(Number).filter((n: number) => n >= 0 && n <= 6))].sort() as number[] : d.schedule.days,
      startMinute: int(s.startMinute, 0, 1439, d.schedule.startMinute), endMinute: int(s.endMinute, 1, 1440, d.schedule.endMinute)
    },
    settings: {
      notifyOwner: g.notifyOwner === true, notifyTeam: g.notifyTeam === true, channel: g.channel === "inapp_push" ? "inapp_push" : "inapp",
      maxRunsPerCustomer: int(g.maxRunsPerCustomer, 0, 1000, d.settings.maxRunsPerCustomer),
      coolDownDays: int(g.coolDownDays, 0, 365, d.settings.coolDownDays),
      stopAfterEnabled: g.stopAfterEnabled === true, stopAfterDays: int(g.stopAfterDays, 1, 3650, 30),
      language: "en-NG", trackPerformance: g.trackPerformance !== false,
      params: (Array.isArray(g.params) ? g.params : []).slice(0, 20).map((p: any) => ({ key: str(p?.key, 30).replace(/[^\w]/g, ""), value: str(p?.value, 200) })).filter((p: any) => p.key)
    }
  };
}

/** What an automation needs before it can be switched on. */
export function configProblem(c: AutomationConfig, name: string): string | null {
  if (!name.trim()) return "Give the automation a name (step 5).";
  if (!c.actions.length) return "Add at least one action (step 3).";
  if (c.trigger.key === "new_message" && !c.trigger.platforms.some((p) => LIVE_PLATFORMS.includes(p))) return "Pick Facebook or Instagram: customer messages only come from there.";
  if (c.trigger.key === "time_based" && c.schedule.mode === "immediate") return "A time-based automation needs a schedule (step 4).";
  for (const a of c.actions) {
    if (a.type === "send_message" && !String(a.config.text ?? a.config.templateId ?? "").trim()) return "Write the message to send (step 3).";
    if (a.type === "add_tag" && !(a.config.tags ?? []).length) return "Pick the tag(s) to add (step 3).";
    if (a.type === "webhook") return "Webhook is not available yet: remove that action.";
  }
  return null;
}

// ── Conditions ────────────────────────────────────────────────────────────

export type LeadFacts = {
  tags: string[]; message: string; state: string | null; productId: string | null; product: string | null;
  status: string; platform: string; orders: number; hot: boolean; score: number;
};
const fold = (s: string) => s.toLowerCase().trim();

export function ruleMatches(rule: Condition, f: LeadFacts): boolean {
  const vals = rule.values.map(fold);
  const any = (xs: string[]) => xs.some((x) => vals.includes(fold(x)));
  const num = Number(rule.values[0]);
  switch (rule.field) {
    case "tag": return rule.op === "is_not" ? !any(f.tags) : any(f.tags);
    case "message": {
      const text = ` ${fold(f.message)} `;
      const hits = vals.filter((v) => v && text.includes(v));
      return rule.op === "all" ? hits.length === vals.length && vals.length > 0 : rule.op === "none" ? hits.length === 0 : hits.length > 0;
    }
    case "state": { const inList = !!f.state && vals.some((v) => fold(f.state!).includes(v)); return rule.op === "is_not" ? !inList : inList; }
    case "product": { const hit = vals.includes(fold(f.productId ?? "")) || (!!f.product && vals.some((v) => fold(f.product!).includes(v))); return rule.op === "is_not" ? !hit : hit; }
    case "status": return rule.op === "is_not" ? !vals.includes(fold(f.status)) : vals.includes(fold(f.status));
    case "platform": return rule.op === "is_not" ? !vals.includes(fold(f.platform)) : vals.includes(fold(f.platform));
    case "orders": return rule.op === "gt" ? f.orders > num : rule.op === "lt" ? f.orders < num : f.orders === num;
    case "hot": return rule.op === "is_not" ? !f.hot : f.hot;
    case "score": return rule.op === "lt" ? f.score < num : f.score >= num;
  }
  return false;
}

/** All / any of the rules; "custom" = every group passes (each group its own all/any). */
export function conditionsPass(c: AutomationConfig["conditions"], f: LeadFacts): boolean {
  if (!c.enabled) return true;
  if (c.match === "custom") {
    const groups = c.groups.filter((g) => g.rules.length);
    const top = c.rules.length ? c.rules.every((r) => ruleMatches(r, f)) : true;
    return top && groups.every((g) => (g.match === "any" ? g.rules.some((r) => ruleMatches(r, f)) : g.rules.every((r) => ruleMatches(r, f))));
  }
  if (!c.rules.length) return true;
  return c.match === "any" ? c.rules.some((r) => ruleMatches(r, f)) : c.rules.every((r) => ruleMatches(r, f));
}

// ── Time ──────────────────────────────────────────────────────────────────

const LAGOS = 3_600_000;
export const lagosMs = (date: string, time = "00:00") => Date.parse(`${date}T${time}:00+01:00`);

/** Inside the automation's own working hours (Lagos)? */
export function inHours(ms: number, s: AutomationConfig["schedule"]) {
  const d = new Date(ms + LAGOS);
  const minute = d.getUTCHours() * 60 + d.getUTCMinutes();
  return s.days.includes(d.getUTCDay()) && minute >= s.startMinute && minute < s.endMinute;
}
/** The first moment at or after `ms` that is inside the working hours. */
export function nextOpen(ms: number, s: AutomationConfig["schedule"]) {
  if (!s.workingHoursOnly || inHours(ms, s)) return ms;
  for (let i = 0; i < 8; i += 1) {
    const day = new Date(ms + LAGOS + i * 86_400_000).toISOString().slice(0, 10);
    const open = lagosMs(day) + s.startMinute * 60_000;
    const dow = new Date(open + LAGOS).getUTCDay();
    if (!s.days.includes(dow)) continue;
    if (open >= ms) return open;
    if (inHours(ms, s)) return ms;
  }
  return ms;
}

/** When a triggered run starts (schedule step). */
export function firstRunAt(s: AutomationConfig["schedule"], nowMs: number) {
  if (s.mode === "delay") return nextOpen(nowMs + s.delayMinutes * 60_000, s);
  return nextOpen(nowMs, s);
}

/** Time-based automations: the first run, then each repeat. Null = finished. */
export function nextScheduled(s: AutomationConfig["schedule"], afterMs: number, runsDone: number, nowMs: number): number | null {
  if (s.mode === "immediate" || s.mode === "delay") return null;
  const start = s.date ? lagosMs(s.date, s.time ?? "10:00") : nowMs;
  if (runsDone === 0 && afterMs < start) return start;
  if (!s.repeat && s.mode !== "recurring") return null;
  if (s.ends === "after" && runsDone >= s.endAfter) return null;
  const step = s.frequency === "weekly" ? 7 : s.frequency === "monthly" ? 30 : 1;
  let next = Math.max(start, afterMs);
  const daysEach = step * s.every;
  // Move forward in whole periods from the start until after "afterMs".
  const periods = Math.floor((next - start) / (daysEach * 86_400_000)) + 1;
  next = start + periods * daysEach * 86_400_000;
  if (s.ends === "on_date" && s.endDate && next > lagosMs(s.endDate, "23:59")) return null;
  return next;
}

/** {{customer_name}} {{phone}} {{product}} {{price}} {{state}} {{order_id}} {{rep_name}} + custom parameters. */
export function fillVariables(text: string, v: Record<string, string | null | undefined>) {
  return text.replace(/\{\{\s*([\w]+)\s*\}\}|\{([\w]+)\}/g, (all, a, b) => {
    const key = (a ?? b) as string;
    const value = v[key];
    return value === undefined || value === null || value === "" ? (key === "customer_name" ? "there" : "") : String(value);
  });
}
