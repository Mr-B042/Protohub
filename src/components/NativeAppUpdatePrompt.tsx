import { useEffect, useState } from "react";
import { isNativeShell } from "../lib/native-shell";

// ── "Update the Protohub app" prompt (Bright, 21 Oct 2026) ──────────────────
// The Android app is a shell around the live site, so web changes arrive by
// themselves - but native features (share, save, push) need a new APK. Every
// APK release now publishes /android-version.json (MOBILE-RELEASE.md). An
// older app shows this prompt; below minVersionCode it cannot be put off.

type Release = { versionCode: number; versionName: string; minVersionCode?: number; url: string; notes?: string[] };
const SNOOZE_KEY = "protohub.app-update-snoozed";
const SNOOZE_MS = 24 * 60 * 60_000;

export function NativeAppUpdatePrompt() {
  const [offer, setOffer] = useState<{ release: Release; installed: string; required: boolean } | null>(null);

  useEffect(() => {
    if (!isNativeShell) return;
    let stopped = false;
    const check = async () => {
      try {
        const { App } = await import("@capacitor/app");
        const info = await App.getInfo();
        const installedCode = Number(info.build) || 0;
        const response = await fetch(`/android-version.json?t=${Date.now()}`, { cache: "no-store" });
        if (!response.ok) return;
        const release = (await response.json()) as Release;
        if (stopped || !release?.versionCode || !release.url || installedCode >= release.versionCode) return;
        const required = installedCode < (release.minVersionCode ?? 0);
        if (!required) {
          let snoozed = "";
          try { snoozed = localStorage.getItem(SNOOZE_KEY) ?? ""; } catch { /* storage blocked */ }
          const [code, until] = snoozed.split("@");
          if (Number(code) === release.versionCode && Date.now() < Number(until)) return;
        }
        setOffer({ release, installed: info.version, required });
      } catch { /* not the Android app, or offline - try again next time */ }
    };
    void check();
    const onVisible = () => { if (document.visibilityState === "visible") void check(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { stopped = true; document.removeEventListener("visibilitychange", onVisible); };
  }, []);

  if (!offer) return null;
  const { release, installed, required } = offer;
  const update = () => {
    // The app hands outside links to the phone's browser, which downloads the APK.
    const opened = window.open(release.url, "_blank", "noopener,noreferrer");
    if (!opened) window.location.href = release.url;
  };
  const later = () => {
    try { localStorage.setItem(SNOOZE_KEY, `${release.versionCode}@${Date.now() + SNOOZE_MS}`); } catch { /* storage blocked */ }
    setOffer(null);
  };

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="app-update-title" style={{ position: "fixed", inset: 0, zIndex: 2147483001, background: "rgba(3,7,18,.6)", display: "flex", alignItems: "flex-end", justifyContent: "center", padding: 16, paddingBottom: "calc(16px + env(safe-area-inset-bottom))", fontFamily: "Inter, system-ui, sans-serif" }}>
      <div style={{ width: "100%", maxWidth: 440, background: "#fff", color: "#0f172a", borderRadius: 20, padding: 22, boxShadow: "0 20px 50px rgba(0,0,0,.3)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <img src="/brand/company-logo.png" alt="" style={{ width: 48, height: 48, borderRadius: 12, objectFit: "contain" }} onError={(event) => { event.currentTarget.style.display = "none"; }} />
          <div>
            <div id="app-update-title" style={{ fontSize: 18, fontWeight: 800 }}>{required ? "Update required" : "Update available"}</div>
            <div style={{ fontSize: 13, color: "#64748b" }}>Protohub {release.versionName} · you have {installed || "an older version"}</div>
          </div>
        </div>
        {!!release.notes?.length && (
          <ul style={{ margin: "16px 0 0", paddingLeft: 20, fontSize: 14, color: "#334155", lineHeight: 1.5 }}>
            {release.notes.map((note) => <li key={note}>{note}</li>)}
          </ul>
        )}
        <p style={{ margin: "14px 0 0", fontSize: 13, color: "#64748b" }}>
          {required ? "This version of the app no longer works properly. " : ""}Tap Update now, open the downloaded file, then tap Update. You stay signed in.
        </p>
        <button type="button" onClick={update} style={{ marginTop: 18, width: "100%", border: 0, borderRadius: 12, padding: "14px", background: "#1f8fe0", color: "#fff", fontSize: 16, fontWeight: 700, cursor: "pointer" }}>Update now</button>
        {!required && <button type="button" onClick={later} style={{ marginTop: 8, width: "100%", border: 0, borderRadius: 12, padding: "10px", background: "transparent", color: "#64748b", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>Later</button>}
      </div>
    </div>
  );
}
