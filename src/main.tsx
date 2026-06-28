import React, { useState, useEffect } from "react";
import ReactDOM from "react-dom/client";
import * as Sentry from "@sentry/react";
import { App } from "./App";
import { auth } from "./lib/auth";
import { ensureFreshAuthSession } from "./lib/api";
import { ensureServiceWorkerRegistration } from "./lib/push-client";
import { LoginScreen } from "./components/LoginScreen";
import { ResetPasswordScreen } from "./components/ResetPasswordScreen";
import PublicOrderFormPage from "./pages/PublicOrderFormPage";
import "./styles.css";

function RouteFallback({ message }: { message: string }) {
  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#eef1f4", color: "#374151", fontFamily: "Inter, system-ui, sans-serif" }}>
      <div style={{ textAlign: "center", padding: "24px 20px" }}>
        <div style={{ fontSize: 28, fontWeight: 800, color: "#111827" }}>{message}</div>
      </div>
    </div>
  );
}

const STALE_IMPORT_PATTERNS = [
  /Failed to fetch dynamically imported module/i,
  /Importing a module script failed/i,
  /ChunkLoadError/i,
  /Loading chunk [\w-]+ failed/i
];
const CHUNK_RECOVERY_SESSION_KEY = "protohub.chunk-recovery-once";

function extractErrorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const candidate = error as { message?: unknown; reason?: unknown };
    if (typeof candidate.message === "string") return candidate.message;
    if (typeof candidate.reason === "string") return candidate.reason;
  }
  return "";
}

function isStaleImportError(error: unknown): boolean {
  const message = extractErrorMessage(error);
  return STALE_IMPORT_PATTERNS.some((pattern) => pattern.test(message));
}

function scheduleStaleChunkRecovery(error: unknown): boolean {
  if (typeof window === "undefined" || !isStaleImportError(error)) {
    return false;
  }

  const marker = `${window.location.pathname}${window.location.hash}`;
  if (window.sessionStorage.getItem(CHUNK_RECOVERY_SESSION_KEY) === marker) {
    return false;
  }

  window.sessionStorage.setItem(CHUNK_RECOVERY_SESSION_KEY, marker);
  window.setTimeout(() => {
    void ensureServiceWorkerRegistration()
      .then((registration) => registration?.update?.().catch(() => undefined))
      .catch(() => undefined)
      .finally(() => {
        window.location.reload();
      });
  }, 0);
  return true;
}

// Sentry error tracking — set VITE_SENTRY_DSN in Vercel environment variables.
// If the env var is missing (local dev), Sentry is a no-op.
const sentryDsn = (import.meta as any).env?.VITE_SENTRY_DSN as string | undefined;
if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    environment: (import.meta as any).env?.MODE ?? "production",
    tracesSampleRate: 0.1,        // 10% of transactions
    replaysOnErrorSampleRate: 1.0 // full replay on errors
  });
}

function Root() {
  const [loggedIn, setLoggedIn] = useState(() => auth.isLoggedIn());
  const [hash, setHash]         = useState(() => (typeof window === "undefined" ? "" : window.location.hash));

  // Fade out the first-paint splash (index.html) once React has mounted, then
  // remove it from the DOM. Runs after the first commit, so by now real UI is
  // on screen — the white-screen gap is covered end to end.
  useEffect(() => {
    const splash = document.getElementById("app-splash");
    if (!splash) return;
    splash.classList.add("app-splash--hide");
    const timer = window.setTimeout(() => splash.remove(), 400);
    return () => window.clearTimeout(timer);
  }, []);

  // Listen for auth being cleared. The "storage" event covers other tabs;
  // "protohub:logout" covers same-tab logouts (auth.clear emits it).
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === "protohub.accessToken" && !e.newValue) {
        setLoggedIn(false);
      } else if (e.key === "protohub.accessToken" && e.newValue) {
        setLoggedIn(true);
      }
    };
    const onAuthChanged = () => setLoggedIn(auth.isLoggedIn());
    const onLogoutEvent = () => setLoggedIn(false);
    const onHashChange  = () => setHash(window.location.hash);
    window.addEventListener("storage", onStorage);
    window.addEventListener("protohub:auth-changed", onAuthChanged);
    window.addEventListener("protohub:logout", onLogoutEvent);
    window.addEventListener("hashchange", onHashChange);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("protohub:auth-changed", onAuthChanged);
      window.removeEventListener("protohub:logout", onLogoutEvent);
      window.removeEventListener("hashchange", onHashChange);
    };
  }, []);

  useEffect(() => {
    if (!loggedIn || hash.startsWith("#/order-form/embed")) return;
    let stopped = false;

    const refreshIfNeeded = async () => {
      if (stopped || !auth.isLoggedIn()) return;
      const result = await ensureFreshAuthSession();
      if (stopped || result.ok) return;
      // Transient refresh failures should not kick the user out. The next API
      // request / interval tick will retry. Only a truly invalid/missing refresh
      // token means the browser can no longer extend the session.
      if (result.reason === "invalid" || result.reason === "missing") {
        auth.clear();
        setLoggedIn(false);
      }
    };

    void refreshIfNeeded();
    const intervalId = window.setInterval(refreshIfNeeded, 60_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refreshIfNeeded();
    };
    const onFocus = () => void refreshIfNeeded();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus);
    return () => {
      stopped = true;
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
    };
  }, [hash, loggedIn]);

  useEffect(() => {
    if (hash.startsWith("#/order-form/embed")) return;
    void ensureServiceWorkerRegistration().catch(() => null);
  }, [hash]);

  useEffect(() => {
    if (typeof document === "undefined" || !hash.startsWith("#/order-form/embed")) return;

    const root = document.documentElement;
    const previousTheme = root.dataset.theme;
    const hadDarkClass = root.classList.contains("dark");

    // Public customer forms must stay visually independent from the admin
    // dashboard theme; otherwise persisted dark mode makes embed text hard to read.
    root.classList.remove("dark");
    root.dataset.theme = "light";
    root.classList.add("public-order-embed-active");

    return () => {
      root.classList.remove("public-order-embed-active");
      root.classList.toggle("dark", hadDarkClass);
      if (previousTheme) root.dataset.theme = previousTheme;
      else delete root.dataset.theme;
    };
  }, [hash]);

  useEffect(() => {
    const onWindowError = (event: ErrorEvent) => {
      if (scheduleStaleChunkRecovery(event.error ?? event.message)) {
        event.preventDefault?.();
      }
    };
    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      if (scheduleStaleChunkRecovery(event.reason)) {
        event.preventDefault();
      }
    };
    const clearMarker = window.setTimeout(() => {
      window.sessionStorage.removeItem(CHUNK_RECOVERY_SESSION_KEY);
    }, 5000);

    window.addEventListener("error", onWindowError);
    window.addEventListener("unhandledrejection", onUnhandledRejection);
    return () => {
      window.clearTimeout(clearMarker);
      window.removeEventListener("error", onWindowError);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
    };
  }, []);

  const handleLogin  = () => setLoggedIn(true);
  const handleLogout = () => { auth.clear(); setLoggedIn(false); };

  // Recovery email lands on /#/reset-password — handle it before the auth gate
  // so the user can complete the reset even if they aren't "logged in" yet.
  if (hash.startsWith("#/reset-password")) {
    return <ResetPasswordScreen onDone={() => { setHash(""); setLoggedIn(auth.isLoggedIn()); }} />;
  }

  // Public embed form is hit by unauthenticated customers. App detects the
  // hash here and renders a lightweight public page — bypass the auth gate
  // and avoid booting the full admin dashboard bundle.
  if (hash.startsWith("#/order-form/embed")) {
    return <PublicOrderFormPage />;
  }

  if (!loggedIn) {
    return <LoginScreen onLogin={handleLogin} />;
  }

  return <App onLogout={handleLogout} />;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Sentry.ErrorBoundary
      fallback={({ error }) => {
        const err = error as Error;
        if (scheduleStaleChunkRecovery(err)) {
          return <RouteFallback message="Refreshing the latest version..." />;
        }
        return (
          <div style={{ padding: 40, maxWidth: 800, margin: "40px auto", fontFamily: "Inter, system-ui, sans-serif" }}>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>Something went wrong.</h2>
            <p style={{ marginTop: 8, color: "#555" }}>The error has been reported. Please refresh the page.</p>
            <details style={{ marginTop: 16, padding: 12, background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 8 }}>
              <summary style={{ cursor: "pointer", fontSize: 13, fontWeight: 600, color: "#374151" }}>Show technical details</summary>
              <pre style={{ marginTop: 10, fontSize: 12, whiteSpace: "pre-wrap", wordBreak: "break-word", color: "#b91c1c" }}>
{err?.name}: {err?.message}
{"\n\n"}
{err?.stack}
              </pre>
            </details>
            <button
              style={{ marginTop: 16, padding: "8px 16px", borderRadius: 6, background: "#1F8FE0", color: "white", border: "none", fontWeight: 600, cursor: "pointer" }}
              onClick={() => window.location.reload()}
            >
              Refresh
            </button>
          </div>
        );
      }}
    >
      <Root />
    </Sentry.ErrorBoundary>
  </React.StrictMode>
);
