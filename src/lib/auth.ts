// Token management — stored in localStorage so it survives page refreshes.
// The API client reads from here on every request.

const ACCESS_TOKEN_KEY  = "protohub.accessToken";
const REFRESH_TOKEN_KEY = "protohub.refreshToken";
const USER_KEY          = "protohub.authUser";

export interface AuthUser {
  id:    string;
  orgId: string;
  name:  string;
  email: string;
  role:  string;
}

export const auth = {
  getAccessToken():  string | null { return localStorage.getItem(ACCESS_TOKEN_KEY); },
  getRefreshToken(): string | null { return localStorage.getItem(REFRESH_TOKEN_KEY); },

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
    // Same-tab notification — the "storage" event only fires across tabs.
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event("protohub:logout"));
    }
  },

  isLoggedIn(): boolean {
    return Boolean(this.getAccessToken() && this.getUser());
  }
};
