import { useEffect, useState } from "react";
import { isNativeShell } from "../lib/native-shell";

// ── Keep open apps on the latest version (21 Oct 2026) ──────────────────────
// A Protohub tab or the Android app can stay open for days. It only picked up
// new code on a full reload, so staff kept running old versions - Ihuoma was
// on a week-old build when she reported BUG-1001, after the fix was live.
// Every build now publishes /version.json; this compares it with the build
// running here and offers an Update bar when a newer one is out.
//
// ⚠️ It NEVER reloads by itself (Bright, 29 Oct 2026: "stop refreshing each
// time someone opens"). It used to reload on opening and on coming back after
// a minute away; on a day with many releases that was nearly every time.
// The page reloads only when someone presses Update.
//
// Mobile app only (Bright, 29 Oct 2026). A web browser already loads the
// newest version every time the page is opened or refreshed, so it shows
// nothing; the Android app can stay open for days, so it gets the bar.

declare const __APP_BUILD__: string;
const CURRENT = (() => { try { return __APP_BUILD__; } catch { return "local"; } })();
const CHECK_EVERY_MS = 5 * 60_000;

async function liveBuild(): Promise<string | null> {
  try {
    const response = await fetch(`/version.json?t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) return null;
    const body = await response.json();
    return typeof body?.build === "string" && body.build !== "local" ? body.build : null;
  } catch { return null; }
}

export function AppUpdateWatcher() {
  const [waiting, setWaiting] = useState(false);

  useEffect(() => {
    if (CURRENT === "local" || !isNativeShell) return;
    let stopped = false;
    const check = async () => {
      const build = await liveBuild();
      if (stopped || !build || build === CURRENT) return;
      setWaiting(true);
    };
    const onVisibility = () => { if (document.visibilityState === "visible") void check(); };
    const onPageShow = (event: PageTransitionEvent) => { if (event.persisted) void check(); };
    void check();
    const timer = window.setInterval(() => void check(), CHECK_EVERY_MS);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, []);

  if (!waiting) return null;
  return (
    <div role="status" style={{ position: "fixed", left: 16, right: 16, bottom: "calc(16px + env(safe-area-inset-bottom))", zIndex: 2147483000, display: "flex", justifyContent: "center", pointerEvents: "none" }}>
      <div style={{ pointerEvents: "auto", display: "flex", alignItems: "center", gap: 12, maxWidth: 480, width: "100%", padding: "12px 14px", borderRadius: 14, background: "#0b1520", color: "#fff", boxShadow: "0 10px 30px rgba(0,0,0,.25)", fontFamily: "Inter, system-ui, sans-serif", fontSize: 14 }}>
        <span style={{ flex: 1 }}>A new version of Protohub is ready.</span>
        <button type="button" onClick={() => window.location.reload()} style={{ border: 0, borderRadius: 10, padding: "8px 14px", background: "#1f8fe0", color: "#fff", fontWeight: 700, fontSize: 14, cursor: "pointer" }}>Update</button>
      </div>
    </div>
  );
}
