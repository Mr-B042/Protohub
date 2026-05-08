import React, { useState, useEffect } from "react";
import ReactDOM from "react-dom/client";
import * as Sentry from "@sentry/react";
import { App } from "./App";
import { LoginScreen } from "./components/LoginScreen";
import { ResetPasswordScreen } from "./components/ResetPasswordScreen";
import { auth } from "./lib/auth";
import "./styles.css";

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

  // Listen for auth being cleared. The "storage" event covers other tabs;
  // "protohub:logout" covers same-tab logouts (auth.clear emits it).
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === "protohub.accessToken" && !e.newValue) {
        setLoggedIn(false);
      }
    };
    const onLogoutEvent = () => setLoggedIn(false);
    const onHashChange  = () => setHash(window.location.hash);
    window.addEventListener("storage", onStorage);
    window.addEventListener("protohub:logout", onLogoutEvent);
    window.addEventListener("hashchange", onHashChange);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("protohub:logout", onLogoutEvent);
      window.removeEventListener("hashchange", onHashChange);
    };
  }, []);

  const handleLogin  = () => setLoggedIn(true);
  const handleLogout = () => { auth.clear(); setLoggedIn(false); };

  // Recovery email lands on /#/reset-password — handle it before the auth gate
  // so the user can complete the reset even if they aren't "logged in" yet.
  if (hash.startsWith("#/reset-password")) {
    return <ResetPasswordScreen onDone={() => { setHash(""); setLoggedIn(auth.isLoggedIn()); }} />;
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
