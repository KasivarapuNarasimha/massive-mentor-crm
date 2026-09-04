/**
 * Capacitor native bridge — no-ops in normal browsers.
 *
 * Loaded only from the customer CRM shell. Handles:
 * - Android system back button (history.back, avoid accidental exit)
 * - External URL opens via Capacitor Browser (or window.open fallback)
 * - Offline / online banner coordination
 *
 * Session tokens are managed by AuthProvider + native-secure-storage.ts
 * (Preferences dual-write on native). This bridge does not read JWTs.
 */
"use client";

type CapPluginListenerHandle = { remove: () => void | Promise<void> };

function isNativeCapacitor(): boolean {
  if (typeof window === "undefined") return false;
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } })
    .Capacitor;
  try {
    return !!cap?.isNativePlatform?.();
  } catch {
    return false;
  }
}

function ensureOfflineBanner(): HTMLElement {
  let el = document.getElementById("mm-native-offline-banner");
  if (el) return el;
  el = document.createElement("div");
  el.id = "mm-native-offline-banner";
  el.setAttribute("role", "status");
  el.style.cssText = [
    "position:fixed",
    "top:0",
    "left:0",
    "right:0",
    "z-index:99999",
    "display:none",
    "padding:0.55rem 0.75rem",
    "padding-top:max(0.55rem, env(safe-area-inset-top))",
    "background:#b45309",
    "color:#fff",
    "font:600 12px/1.35 system-ui,sans-serif",
    "text-align:center",
  ].join(";");
  el.textContent = "You are offline. Some CRM actions may not work until you reconnect.";
  document.body.appendChild(el);
  return el;
}

function setOfflineVisible(on: boolean) {
  const el = ensureOfflineBanner();
  el.style.display = on ? "block" : "none";
  document.documentElement.style.setProperty(
    "--mm-native-offline-offset",
    on ? "2.25rem" : "0px"
  );
}

/**
 * Open URL: keep same-origin CRM navigations in WebView; open external in system browser.
 */
export async function openExternalUrl(url: string): Promise<void> {
  if (!url) return;
  let parsed: URL;
  try {
    parsed = new URL(url, window.location.href);
  } catch {
    return;
  }
  const host = parsed.hostname.toLowerCase();
  const isCrm =
    host === "crm.massivementor.in" ||
    host === "api.massivementor.in" ||
    host.endsWith(".massivementor.in") ||
    host === "localhost" ||
    host === "127.0.0.1";

  if (isCrm && parsed.protocol.startsWith("http")) {
    // Stay inside WebView for CRM/API-related hosts (e.g. absolute CRM links)
    if (host === "crm.massivementor.in" || host === "localhost" || host === "127.0.0.1") {
      window.location.assign(parsed.toString());
      return;
    }
  }

  if (!isNativeCapacitor()) {
    window.open(parsed.toString(), "_blank", "noopener,noreferrer");
    return;
  }

  try {
    const { Browser } = await import("@capacitor/browser");
    await Browser.open({ url: parsed.toString() });
  } catch {
    window.open(parsed.toString(), "_blank", "noopener,noreferrer");
  }
}

/**
 * Install native listeners once per page lifetime.
 * Safe to call from DashboardShell / root client layout.
 */
export async function installCapacitorBridge(): Promise<() => void> {
  if (!isNativeCapacitor()) {
    return () => undefined;
  }

  const cleanups: Array<() => void> = [];
  const handles: CapPluginListenerHandle[] = [];

  // Mark document for CSS hooks (safe-area / touch tweaks)
  document.documentElement.classList.add("mm-capacitor-native");
  document.documentElement.dataset.mmNative = "android";

  // --- Back button ---
  try {
    const { App } = await import("@capacitor/app");
    const h = await App.addListener("backButton", ({ canGoBack }) => {
      // Prefer in-app history when WebView reports a back stack
      if (canGoBack || window.history.length > 1) {
        window.history.back();
        return;
      }
      // At root: do not force-exit — stay on current CRM screen
      // (double-back exit can be added later if product wants it)
    });
    handles.push(h);
  } catch {
    /* plugin unavailable */
  }

  // --- Network / offline banner ---
  try {
    const { Network } = await import("@capacitor/network");
    const apply = async () => {
      const s = await Network.getStatus();
      setOfflineVisible(!s.connected);
    };
    await apply();
    const h = await Network.addListener("networkStatusChange", (s) => {
      setOfflineVisible(!s.connected);
    });
    handles.push(h);
  } catch {
    const onOffline = () => setOfflineVisible(true);
    const onOnline = () => setOfflineVisible(false);
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    setOfflineVisible(!navigator.onLine);
    cleanups.push(() => {
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
    });
  }

  // --- Intercept target=_blank / external anchors lightly ---
  const onClick = (ev: MouseEvent) => {
    const t = ev.target as Element | null;
    const a = t?.closest?.("a[href]") as HTMLAnchorElement | null;
    if (!a || !a.href) return;
    const target = (a.getAttribute("target") || "").toLowerCase();
    if (target !== "_blank" && !a.hasAttribute("download")) return;
    try {
      const u = new URL(a.href, window.location.href);
      const host = u.hostname.toLowerCase();
      if (host === window.location.hostname) return;
      ev.preventDefault();
      void openExternalUrl(u.toString());
    } catch {
      /* ignore */
    }
  };
  document.addEventListener("click", onClick, true);
  cleanups.push(() => document.removeEventListener("click", onClick, true));

  // Status bar / splash — best effort
  try {
    const { SplashScreen } = await import("@capacitor/splash-screen");
    await SplashScreen.hide();
  } catch {
    /* optional */
  }

  return () => {
    for (const c of cleanups) c();
    for (const h of handles) {
      try {
        const r = h.remove();
        if (r && typeof (r as Promise<void>).then === "function") {
          void (r as Promise<void>);
        }
      } catch {
        /* ignore */
      }
    }
    document.documentElement.classList.remove("mm-capacitor-native");
    delete document.documentElement.dataset.mmNative;
    document.getElementById("mm-native-offline-banner")?.remove();
  };
}
