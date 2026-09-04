/**
 * Capacitor Push Notifications client (Phase 3).
 *
 * - Runs only on native Capacitor platforms (Android first).
 * - Stable installId in Preferences (survives login/logout).
 * - Permission requested AFTER authenticated session is ready (not cold first-launch).
 * - Foreground: SSE + 8s poll remain primary; push is for background/killed.
 */
"use client";

import { api } from "@/lib/api";
import { isRunningInCapacitorNative, nativeGetItem, nativeSetItem } from "@/lib/native-secure-storage";

const INSTALL_ID_KEY = "mm_push_install_id";
const APP_ID = "in.massivementor.crm";

let listenersAttached = false;
let registrationInFlight: Promise<void> | null = null;

function randomInstallId(): string {
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
      return crypto.randomUUID();
    }
  } catch {
    /* fall through */
  }
  return `inst_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}

export async function getOrCreateInstallId(): Promise<string> {
  const existing = await nativeGetItem(INSTALL_ID_KEY);
  if (existing && existing.length >= 8) return existing;
  const id = randomInstallId();
  await nativeSetItem(INSTALL_ID_KEY, id);
  return id;
}

function platformName(): "android" | "ios" | "web" {
  if (typeof window === "undefined") return "web";
  const cap = (window as unknown as { Capacitor?: { getPlatform?: () => string } }).Capacitor;
  const p = (cap?.getPlatform?.() || "").toLowerCase();
  if (p === "ios") return "ios";
  if (p === "android") return "android";
  return "web";
}

async function upsertToken(opts: {
  token: string;
  authToken: string;
  businessId?: string | null;
}): Promise<void> {
  const installId = await getOrCreateInstallId();
  const platform = platformName();
  await api.registerDevicePushToken(
    {
      installId,
      platform,
      token: opts.token,
      provider: "fcm",
      appId: APP_ID,
      businessId: opts.businessId || null,
    },
    opts.authToken
  );
}

/**
 * After login / portal ready: request permission (if needed) and register FCM token.
 * Safe to call multiple times; no-ops in browser.
 */
export async function ensureNativePushRegistration(opts: {
  authToken: string;
  businessId?: string | null;
}): Promise<void> {
  if (!isRunningInCapacitorNative()) return;
  if (!opts.authToken) return;
  if (registrationInFlight) return registrationInFlight;

  registrationInFlight = (async () => {
    try {
      const { PushNotifications } = await import("@capacitor/push-notifications");

      if (!listenersAttached) {
        listenersAttached = true;

        await PushNotifications.addListener("registration", (token) => {
          const value = token?.value;
          if (!value) return;
          void upsertToken({
            token: value,
            authToken: opts.authToken,
            businessId: opts.businessId,
          }).catch((e) => {
            console.warn("[native-push] register upsert failed", e);
          });
        });

        await PushNotifications.addListener("registrationError", (err) => {
          console.warn("[native-push] registrationError", err);
        });

        await PushNotifications.addListener("pushNotificationReceived", () => {
          // Foreground: ignore visual storm — SSE/poll already handle inbox.
        });

        await PushNotifications.addListener("pushNotificationActionPerformed", (action) => {
          try {
            const data = (action?.notification?.data || {}) as Record<string, string>;
            const path = data.path || "/dashboard";
            if (typeof window !== "undefined" && path.startsWith("/")) {
              window.location.assign(path);
            }
          } catch {
            /* ignore */
          }
        });
      }

      let perm = await PushNotifications.checkPermissions();
      if (perm.receive === "prompt" || perm.receive === "prompt-with-rationale") {
        perm = await PushNotifications.requestPermissions();
      }
      if (perm.receive !== "granted") {
        console.info("[native-push] permission not granted — skipping register");
        return;
      }

      await PushNotifications.register();
    } catch (e) {
      console.warn("[native-push] ensure failed", e);
    } finally {
      registrationInFlight = null;
    }
  })();

  return registrationInFlight;
}

/** Logout: revoke current install only (does not wipe installId). */
export async function revokeNativePushOnLogout(authToken: string | null): Promise<void> {
  if (!isRunningInCapacitorNative()) return;
  if (!authToken) return;
  try {
    const installId = await getOrCreateInstallId();
    await api.revokeDevicePushToken(
      { installId, appId: APP_ID, reason: "logout" },
      authToken
    );
  } catch {
    /* best-effort */
  }
}
