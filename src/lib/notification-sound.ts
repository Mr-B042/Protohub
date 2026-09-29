/**
 * The Protohub chime - the sound a notification makes while the app is on
 * screen.
 *
 * ⚠️ WHY THE APP PLAYS ITS OWN SOUND. A web notification cannot choose its
 * sound: Chrome always uses the phone's standard ding, the same one WhatsApp
 * and every other app uses. What a web page CAN do is play audio while it is
 * open. So when a Protohub tab is on screen, the service worker shows the
 * banner silently and asks the page to play this chime instead (see sw.js
 * "protohub-chime"). When no tab is on screen, the phone's own sound plays as
 * before - nothing here is involved.
 *
 * The tones are synthesised with Web Audio, so there are no sound files to
 * download or cache.
 *
 * ⚠️ CHROME WILL NOT PLAY AUDIO BEFORE THE PERSON HAS TOUCHED THE PAGE. The
 * audio context is created suspended and unlocked on the first tap, click or
 * key press (installAudioUnlock). Until then chimes are skipped, never queued -
 * a burst of stale chimes on first tap would be worse than silence.
 */

export type ChimeKind = "order" | "assigned" | "cart" | "urgent" | "general";

type Note = { frequency: number; start: number; duration: number; gain?: number };

/** Each alert has its own shape, so a rep can tell them apart without looking. */
const CHIMES: Record<ChimeKind, { wave: OscillatorType; notes: Note[] }> = {
  // New order: a bright rising three-note chime.
  order: { wave: "sine", notes: [
    { frequency: 1046.5, start: 0, duration: 0.14 },
    { frequency: 1318.5, start: 0.12, duration: 0.14 },
    { frequency: 1568.0, start: 0.24, duration: 0.32 }
  ] },
  // Assigned to you: a softer double tone.
  assigned: { wave: "sine", notes: [
    { frequency: 880.0, start: 0, duration: 0.16 },
    { frequency: 1174.7, start: 0.16, duration: 0.3 }
  ] },
  // New or assigned cart: two quick rising notes.
  cart: { wave: "triangle", notes: [
    { frequency: 659.3, start: 0, duration: 0.12 },
    { frequency: 880.0, start: 0.11, duration: 0.26 }
  ] },
  // Something went wrong (failed or cancelled order, overdue remittance, low
  // stock): lower and repeated, so it is not mistaken for good news.
  urgent: { wave: "square", notes: [
    { frequency: 440.0, start: 0, duration: 0.14, gain: 0.5 },
    { frequency: 349.2, start: 0.16, duration: 0.14, gain: 0.5 },
    { frequency: 440.0, start: 0.42, duration: 0.14, gain: 0.5 },
    { frequency: 349.2, start: 0.58, duration: 0.2, gain: 0.5 }
  ] },
  general: { wave: "sine", notes: [{ frequency: 987.8, start: 0, duration: 0.3 }] }
};

const URGENT_KINDS = new Set(["order_failed", "order_cancelled", "remittance_overdue", "low_stock", "stale_carts", "needs_attention"]);
const ORDER_KINDS = new Set(["order_new", "order_confirmed", "order_delivered", "order_rescheduled"]);
const CART_KINDS = new Set(["abandoned_cart_new", "cart_assigned", "order_follow_up"]);

/** The notification's kind, as the server sends it, to the chime it plays. */
export function chimeForKind(kind?: string | null, title?: string | null): ChimeKind {
  const value = String(kind ?? "").toLowerCase();
  if (URGENT_KINDS.has(value)) return "urgent";
  if (value === "order_assigned") return "assigned";
  if (ORDER_KINDS.has(value)) return "order";
  if (CART_KINDS.has(value)) return "cart";
  // In-app notifications carry a title, not a kind.
  const text = String(title ?? "").toLowerCase();
  if (/failed|cancelled|overdue|low stock/.test(text)) return "urgent";
  if (/cart/.test(text)) return "cart";
  if (/assigned/.test(text)) return "assigned";
  if (/order/.test(text)) return "order";
  return "general";
}

// ── Per-device setting ───────────────────────────────────────────────────────
// Stored in this browser only: a rep may want sound at their desk and not on
// the phone in their pocket. Wrapped in try/catch - private windows and blocked
// storage must never stop a notification.

const SETTINGS_KEY = "protohub-notification-sound";
export type SoundSettings = { enabled: boolean; volume: number };
const DEFAULT_SETTINGS: SoundSettings = { enabled: true, volume: 0.7 };

export function readSoundSettings(): SoundSettings {
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw);
    return {
      enabled: typeof parsed.enabled === "boolean" ? parsed.enabled : DEFAULT_SETTINGS.enabled,
      volume: Number.isFinite(parsed.volume) ? Math.min(1, Math.max(0, parsed.volume)) : DEFAULT_SETTINGS.volume
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function writeSoundSettings(settings: SoundSettings) {
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Not saved on this device; the chime still follows the setting until reload.
  }
  currentSettings = settings;
  // Turning the chime off must give the phone its own sound back at once.
  reportVisibility();
}

let currentSettings: SoundSettings | null = null;
const settingsNow = () => (currentSettings ??= readSoundSettings());

// ── Playback ────────────────────────────────────────────────────────────────

let context: AudioContext | null = null;
let lastChimeAt = 0;
const recentKeys: string[] = [];

function audioContext(): AudioContext | null {
  if (context) return context;
  const Ctor = (window as any).AudioContext ?? (window as any).webkitAudioContext;
  if (!Ctor) return null;
  try {
    context = new Ctor();
  } catch {
    context = null;
  }
  return context;
}

/** Unlocks audio on the first touch, click or key press. Call once at start. */
export function installAudioUnlock() {
  const unlock = () => {
    const ctx = audioContext();
    if (ctx && ctx.state === "suspended") {
      void ctx.resume().then(() => reportVisibility()).catch(() => undefined);
    }
    if (ctx?.state === "running") {
      window.removeEventListener("pointerdown", unlock, true);
      window.removeEventListener("keydown", unlock, true);
      reportVisibility();
    }
  };
  window.addEventListener("pointerdown", unlock, true);
  window.addEventListener("keydown", unlock, true);
}

/**
 * Plays the chime for this kind of notification.
 *
 * `key` identifies the notification: the same one arriving twice (push and the
 * live update, or two open tabs) chimes once. A burst - ten carts handed out at
 * 08:30 - chimes at most once every 1.5 seconds rather than ten times at once.
 * `force` is for the "Test sound" button: it ignores the on/off setting and the
 * spacing, but still needs audio to have been unlocked by that very click.
 */
export function playChime(kind: ChimeKind, options: { key?: string; force?: boolean } = {}): boolean {
  const settings = settingsNow();
  if (!options.force && !settings.enabled) return false;

  if (options.key) {
    if (recentKeys.includes(options.key)) return false;
    recentKeys.push(options.key);
    if (recentKeys.length > 50) recentKeys.shift();
    // Two tabs of the app share this browser: whichever claims the key first
    // plays it.
    try {
      const claim = `protohub-chime:${options.key}`;
      if (window.localStorage.getItem(claim)) return false;
      window.localStorage.setItem(claim, String(Date.now()));
      window.setTimeout(() => { try { window.localStorage.removeItem(claim); } catch { /* ignore */ } }, 10_000);
    } catch {
      // No storage - fall back to this tab's own memory above.
    }
  }

  const now = Date.now();
  if (!options.force && now - lastChimeAt < 1500) return false;

  const ctx = audioContext();
  if (!ctx) return false;
  if (ctx.state === "suspended") {
    if (!options.force) return false;
    void ctx.resume().catch(() => undefined);
  }
  lastChimeAt = now;

  const volume = options.force ? Math.max(settings.volume, 0.2) : settings.volume;
  const chime = CHIMES[kind] ?? CHIMES.general;
  const start = ctx.currentTime + 0.02;
  const master = ctx.createGain();
  master.gain.value = volume * 0.35;
  master.connect(ctx.destination);
  for (const note of chime.notes) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = chime.wave;
    osc.frequency.value = note.frequency;
    const peak = note.gain ?? 1;
    // A short attack and a smooth decay - no click at either end.
    gain.gain.setValueAtTime(0.0001, start + note.start);
    gain.gain.exponentialRampToValueAtTime(peak, start + note.start + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + note.start + note.duration);
    osc.connect(gain).connect(master);
    osc.start(start + note.start);
    osc.stop(start + note.start + note.duration + 0.05);
  }
  return true;
}

// ── Telling the service worker whether the app is on screen ──────────────────

/**
 * ⚠️ THE SERVICE WORKER MUST DECIDE INSTANTLY. Android Chrome drops the banner
 * if anything asynchronous runs before showNotification (see sw.js), so it
 * cannot ask the open tabs "is anybody looking?" when a push lands. Instead
 * each tab keeps it told: on every visibility change, and every 20 seconds
 * while on screen. A report older than a minute counts as "not on screen", so
 * a closed or frozen tab can never leave notifications silent.
 */
/**
 * ⚠️ "ON SCREEN" IS NOT ENOUGH - IT MUST ALSO BE ABLE TO PLAY. A tab opened a
 * second ago has not been tapped, so Chrome will not let it make a sound. If
 * the service worker silenced the banner for that tab, the alert would make no
 * sound at all. So a tab only claims the chime when the sound is on AND audio
 * is actually unlocked; otherwise the phone keeps its own sound.
 */
export function reportVisibility(forceHidden = false) {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  const visible = !forceHidden && document.visibilityState === "visible";
  const canChime = visible && settingsNow().enabled && context?.state === "running";
  navigator.serviceWorker.controller?.postMessage({ type: "PROTOHUB_VISIBILITY", visible, canChime, at: Date.now() });
}

export function installVisibilityReporting() {
  if (!("serviceWorker" in navigator)) return;
  const report = () => reportVisibility();
  document.addEventListener("visibilitychange", report);
  window.addEventListener("focus", report);
  window.addEventListener("pagehide", () => reportVisibility(true));
  navigator.serviceWorker.addEventListener("controllerchange", report);
  window.setInterval(() => { if (document.visibilityState === "visible") report(); }, 20_000);
  report();
}

/**
 * The service worker showed a banner silently and wants the chime played here.
 * Only a tab that is actually on screen answers.
 */
export function installServiceWorkerChimes() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.addEventListener("message", (event) => {
    const data = event.data;
    if (data?.type !== "PROTOHUB_CHIME") return;
    if (document.visibilityState !== "visible") return;
    playChime(chimeForKind(data.kind, data.title), { key: data.key });
  });
}
