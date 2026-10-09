// The reporter's environment, captured when a report is sent (Bright,
// 9 Oct 2026), so nobody has to ask "which browser? were you on mobile?".

declare const __APP_BUILD__: string;

const SESSION_KEY = "protohub.supportSession";
const sessionId = () => {
  try {
    let id = sessionStorage.getItem(SESSION_KEY);
    if (!id) { id = `S-${Math.random().toString(36).slice(2, 10).toUpperCase()}`; sessionStorage.setItem(SESSION_KEY, id); }
    return id;
  } catch { return "unknown"; }
};

export function browserInfo(ua = navigator.userAgent) {
  const pick = (re: RegExp) => ua.match(re)?.[1];
  const browser = /Edg\//.test(ua) ? { name: "Edge", version: pick(/Edg\/([\d.]+)/) }
    : /OPR\//.test(ua) ? { name: "Opera", version: pick(/OPR\/([\d.]+)/) }
    : /SamsungBrowser\//.test(ua) ? { name: "Samsung Internet", version: pick(/SamsungBrowser\/([\d.]+)/) }
    : /Firefox\//.test(ua) ? { name: "Firefox", version: pick(/Firefox\/([\d.]+)/) }
    : /Chrome\//.test(ua) ? { name: "Chrome", version: pick(/Chrome\/([\d.]+)/) }
    : /Safari\//.test(ua) ? { name: "Safari", version: pick(/Version\/([\d.]+)/) }
    : { name: "Other", version: undefined };
  const os = /Windows NT 10/.test(ua) ? "Windows 10/11" : /Windows/.test(ua) ? "Windows"
    : /Android ([\d.]+)/.test(ua) ? `Android ${pick(/Android ([\d.]+)/)}`
    : /(iPhone|iPad).*OS ([\d_]+)/.test(ua) ? `iOS ${ua.match(/OS ([\d_]+)/)?.[1]?.replace(/_/g, ".")}`
    : /Mac OS X ([\d_]+)/.test(ua) ? `macOS ${pick(/Mac OS X ([\d_]+)/)?.replace(/_/g, ".")}`
    : /Linux/.test(ua) ? "Linux" : "Other";
  const device = /iPad|Tablet/.test(ua) ? "Tablet" : /Mobi|Android|iPhone/.test(ua) ? "Mobile" : "Desktop";
  return { browser: browser.name, browserVersion: browser.version?.split(".")[0] ?? "", os, device };
}

export function captureEnvironment(context: { userName: string; userRole: string; workspace: string; currentPage: string; previousPage: string | null; previousUrl: string | null }) {
  const info = browserInfo();
  let build = "local";
  try { build = __APP_BUILD__ || "local"; } catch { /* not defined in tests */ }
  return {
    ...context,
    url: window.location.hash || window.location.pathname,
    ...info,
    screen: `${window.screen.width}×${window.screen.height}`,
    viewport: `${window.innerWidth}×${window.innerHeight}`,
    pixelRatio: window.devicePixelRatio,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    language: navigator.language,
    online: navigator.onLine,
    connection: (navigator as any).connection?.effectiveType ?? null,
    appBuild: build,
    sessionId: sessionId(),
    capturedAt: new Date().toISOString()
  };
}
