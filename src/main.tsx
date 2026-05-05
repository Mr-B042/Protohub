import React, { useState, useEffect } from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { LoginScreen } from "./components/LoginScreen";
import { auth } from "./lib/auth";
import "./styles.css";

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
    <Root />
  </React.StrictMode>
);
