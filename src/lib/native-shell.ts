import { Capacitor } from "@capacitor/core";
import { StatusBar, Style } from "@capacitor/status-bar";
import { SplashScreen } from "@capacitor/splash-screen";

export const isNativeShell = Capacitor.isNativePlatform();
export const nativePlatform = Capacitor.getPlatform();

export async function bootstrapNativeShell(): Promise<void> {
  if (!isNativeShell) return;

  try {
    await StatusBar.setStyle({ style: Style.Dark });
  } catch {
    // Ignore platforms that don't expose this status bar API.
  }

  try {
    await StatusBar.setBackgroundColor({ color: "#0B1520" });
  } catch {
    // Ignore platforms that don't expose background color configuration.
  }

  try {
    await StatusBar.setOverlaysWebView({ overlay: false });
  } catch {
    // Ignore platforms that don't support this behavior.
  }

  try {
    await SplashScreen.hide();
  } catch {
    // Ignore platforms where the splash screen is already hidden.
  }
}
