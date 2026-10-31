import { useEffect, useState } from "react";

export function RouteFallback({ message }: { message: string }) {
  const [stalled, setStalled] = useState(false);
  useEffect(() => {
    setStalled(false);
    if (!message.toLowerCase().includes("loading workspace")) return;
    // A slow phone may still be downloading or parsing the workspace. Keep
    // that work alive; restarting it after 12 seconds made slow loads worse.
    const timer = window.setTimeout(() => setStalled(true), 12_000);
    return () => window.clearTimeout(timer);
  }, [message]);
  return (
    <div role="status" style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#eef1f4", color: "#374151", fontFamily: "Inter, system-ui, sans-serif" }}>
      <div style={{ textAlign: "center", padding: "24px 20px" }}>
        <img src="/brand/company-logo.png" alt="Protohub" style={{ width: 96, height: 96, objectFit: "contain", borderRadius: 18, margin: "0 auto 18px" }} onError={(event) => { event.currentTarget.style.display = "none"; }} />
        <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: "-0.02em", color: "#1f8fe0", marginBottom: 10 }}>Protohub</div>
        <div style={{ fontSize: 28, fontWeight: 800, color: "#111827" }}>{message}</div>
        {stalled && <>
          <p style={{ marginTop: 12 }}>Taking longer than usual. Loading will continue while you wait.</p>
          <button type="button" onClick={() => window.location.reload()} style={{ marginTop: 6, border: 0, borderRadius: 10, padding: "10px 16px", background: "#1f8fe0", color: "#fff", fontWeight: 700, cursor: "pointer" }}>Retry workspace</button>
        </>}
      </div>
    </div>
  );
}
