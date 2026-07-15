// Token management - stored in localStorage so it survives page refreshes.
// The API client reads from here on every request.

const ACCESS_TOKEN_KEY  = "protohub.accessToken";
const REFRESH_TOKEN_KEY = "protohub.refreshToken";
const USER_KEY          = "protohub.authUser";

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    const normalized = part.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    return JSON.parse(atob(padded)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export interface AuthUser {
  id:    string;
  orgId: string;
  name:  string;
  email: string;
  role:  string;
}

export interface AuthSessionSnapshot {
  accessToken: string | null;
  refreshToken: string | null;
}

export const auth = {
  getAccessToken():  string | null { return localStorage.getItem(ACCESS_TOKEN_KEY); },
  getRefreshToken(): string | null { return localStorage.getItem(REFRESH_TOKEN_KEY); },

  getSessionSnapshot(): AuthSessionSnapshot {
    return {
      accessToken: this.getAccessToken(),
      refreshToken: this.getRefreshToken()
    };
  },

  sessionMatches(snapshot: AuthSessionSnapshot): boolean {
    return this.getAccessToken() === snapshot.accessToken &&
      this.getRefreshToken() === snapshot.refreshToken;
  },

  getAccessTokenExpiresAt(): number | null {
    const token = this.getAccessToken();
    if (!token) return null;
    const payload = decodeJwtPayload(token);
    const exp = payload?.exp;
    return typeof exp === "number" ? exp * 1000 : null;
  },

  isAccessTokenExpired(skewMs = 0): boolean {
    const expiresAt = this.getAccessTokenExpiresAt();
    return !expiresAt || expiresAt - Date.now() <= skewMs;
  },

  isAccessTokenExpiringWithin(ms: number): boolean {
    const expiresAt = this.getAccessTokenExpiresAt();
    return !expiresAt || expiresAt - Date.now() <= ms;
  },

  getUser(): AuthUser | null {
    try {
      const raw = localStorage.getItem(USER_KEY);
      return raw ? (JSON.parse(raw) as AuthUser) : null;
    } catch { return null; }
  },

  save(accessToken: string, refreshToken: string, user: AuthUser) {
    localStorage.setItem(ACCESS_TOKEN_KEY,  accessToken);
    localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event("protohub:auth-changed"));
    }
  },

  clear() {
    // Purge every protohub.* key on logout so a different user signing in on
    // a shared device doesn't see leftover org branding, customer-flag PII,
    // or any cached UI state from the previous session. Only protohub.theme
    // (light/dark) is user-preference and safe to preserve.
    const KEEP = new Set(["protohub.theme"]);
    try {
      const toRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith("protohub.") && !KEEP.has(key)) toRemove.push(key);
      }
      for (const key of toRemove) localStorage.removeItem(key);
    } catch {
      // Fall through to the legacy keys at minimum
      localStorage.removeItem(ACCESS_TOKEN_KEY);
      localStorage.removeItem(REFRESH_TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
    }
    // Same-tab notification - the "storage" event only fires across tabs.
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event("protohub:logout"));
    }
  },

  clearIfSessionMatches(snapshot: AuthSessionSnapshot): boolean {
    if (!this.sessionMatches(snapshot)) return false;
    this.clear();
    return true;
  },

  isLoggedIn(): boolean {
    return Boolean(this.getAccessToken() && this.getUser());
  }
};
