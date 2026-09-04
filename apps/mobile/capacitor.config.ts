import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Massive Mentor CRM — Capacitor shell.
 *
 * Phase 2A: Android loads the hosted Next.js CRM (remote WebView).
 * Do not bundle Next.js into www — apps/web remains the single frontend.
 */
const config: CapacitorConfig = {
  appId: "in.massivementor.crm",
  appName: "Massive Mentor CRM",
  webDir: "www",
  server: {
    // Production CRM (customer portal only — not admin/demo hosts)
    url: "https://crm.massivementor.in",
    // Allow navigation within CRM + API auth redirects; block random hosts in allowNavigation
    allowNavigation: [
      "crm.massivementor.in",
      "*.massivementor.in",
      "api.massivementor.in",
    ],
    cleartext: false,
  },
  android: {
    allowMixedContent: false,
    backgroundColor: "#ffffff",
    // Improves back-stack behavior with remote SPA
    webContentsDebuggingEnabled: false,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1500,
      launchAutoHide: true,
      backgroundColor: "#ffffff",
      showSpinner: false,
      androidSplashResourceName: "splash",
    },
    StatusBar: {
      style: "DARK",
      backgroundColor: "#ffffff",
    },
  },
};

export default config;
