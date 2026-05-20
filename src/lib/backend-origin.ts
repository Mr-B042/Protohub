const DEFAULT_API_BASE = (import.meta as any).env?.VITE_API_URL ?? "http://localhost:4000";
const FALLBACK_API_BASES = parseBaseList((import.meta as any).env?.VITE_API_FALLBACK_URLS);
const API_BASE_OVERRIDE_KEY = "protohub.apiBaseOverride";
const API_BASE_OVERRIDE_TTL_MS = 10 * 60 * 1000;
const DEFAULT_FAILOVER_STATUSES = new Set([502, 503, 504]);

type ApiBaseOverride = {
  base: string;
  expiresAt: number;
};

type FetchWithFailoverOptions = {
  retryableStatuses?: Set<number>;
};

function normalizeBase(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function parseBaseList(value: unknown): string[] {
  if (typeof value !== "string" || !value.trim()) return [];
  return value
    .split(/[,\n]/)
    .map((entry) => normalizeBase(entry))
    .filter(Boolean);
}

function canUseStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function readOverride(): ApiBaseOverride | null {
  if (!canUseStorage()) return null;
  try {
    const raw = window.localStorage.getItem(API_BASE_OVERRIDE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ApiBaseOverride> | null;
    if (!parsed?.base || typeof parsed.base !== "string") {
      window.localStorage.removeItem(API_BASE_OVERRIDE_KEY);
      return null;
    }
    if (typeof parsed.expiresAt !== "number" || parsed.expiresAt <= Date.now()) {
      window.localStorage.removeItem(API_BASE_OVERRIDE_KEY);
      return null;
    }
    return {
      base: normalizeBase(parsed.base),
      expiresAt: parsed.expiresAt
    };
  } catch {
    window.localStorage.removeItem(API_BASE_OVERRIDE_KEY);
    return null;
  }
}

function persistOverride(base: string | null) {
  if (!canUseStorage()) return;
  if (!base || normalizeBase(base) === normalizeBase(DEFAULT_API_BASE)) {
    window.localStorage.removeItem(API_BASE_OVERRIDE_KEY);
    return;
  }
  const payload: ApiBaseOverride = {
    base: normalizeBase(base),
    expiresAt: Date.now() + API_BASE_OVERRIDE_TTL_MS
  };
  window.localStorage.setItem(API_BASE_OVERRIDE_KEY, JSON.stringify(payload));
}

export function getApiBaseCandidates(): string[] {
  const override = readOverride()?.base ?? null;
  return Array.from(
    new Set(
      [override, normalizeBase(DEFAULT_API_BASE), ...FALLBACK_API_BASES]
        .filter((value): value is string => typeof value === "string" && value.length > 0)
    )
  );
}

export function rememberHealthyApiBase(base: string) {
  persistOverride(base);
}

export async function fetchWithApiFailover(
  path: string,
  init: RequestInit = {},
  options: FetchWithFailoverOptions = {}
): Promise<Response> {
  const retryableStatuses = options.retryableStatuses ?? DEFAULT_FAILOVER_STATUSES;
  const bases = getApiBaseCandidates();
  let lastError: unknown = null;

  for (let index = 0; index < bases.length; index += 1) {
    const base = bases[index];
    try {
      const response = await fetch(`${base}${path}`, init);
      if (response.ok) {
        rememberHealthyApiBase(base);
        return response;
      }
      const canTryAnother = index < bases.length - 1 && retryableStatuses.has(response.status);
      if (!canTryAnother) {
        return response;
      }
      lastError = new Error(`Backend ${base} returned ${response.status}`);
    } catch (error) {
      lastError = error;
      if (index === bases.length - 1) throw error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Unable to reach any configured backend.");
}
