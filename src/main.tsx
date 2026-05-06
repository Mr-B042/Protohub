import React, { useState, useEffect } from "react";
import ReactDOM from "react-dom/client";
import * as Sentry from "@sentry/react";
import { App } from "./App";
import { LoginScreen } from "./components/LoginScreen";
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

  // Listen for auth being cleared (e.g. token expired mid-session)
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === "protohub.accessToken" && !e.newValue) {
        setLoggedIn(false);
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const handleLogin  = () => setLoggedIn(true);
  const handleLogout = () => { auth.clear(); setLoggedIn(false); };

  if (!loggedIn) {
    return <LoginScreen onLogin={handleLogin} />;
  }

  return <App onLogout={handleLogout} />;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Sentry.ErrorBoundary fallback={<div style={{padding:40,textAlign:"center"}}><h2>Something went wrong.</h2><p>The error has been reported. Please refresh the page.</p><button onClick={() => window.location.reload()}>Refresh</button></div>}>
      <Root />
    </Sentry.ErrorBoundary>
  </React.StrictMode>
);
