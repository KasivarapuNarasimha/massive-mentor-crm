/**
 * Mobile-aware session storage adapter.
 *
 * Browser: localStorage (unchanged).
 * Capacitor native: @capacitor/preferences (device-partitioned key/value).
 *
 * Phase 2B: Preferences is the practical Cap 6 approach without Keystore complexity.
 * Tokens are still only readable by our WebView JS (same trust boundary as before),
 * but are no longer left solely in page localStorage on native — we dual-write so
 * AuthProvider bootstrap can prefer Preferences on native and clear both on logout.
 *
 * Does NOT send tokens to native Java/Kotlin app code beyond the Capacitor plugin.
 *
 * IMPORTANT: Never return the Capacitor Preferences plugin proxy from an async
 * function. Cap plugin proxies are thenable; awaiting a function that returns
 * the proxy triggers Preferences.then(), which is unimplemented on Android
 * ("Preferences.then() is not implemented on android"). Always import then
 * call Preferences.set/get/remove directly on the awaited import result.
 */
"use client";

const PREF_PREFIX = "mm_auth_";

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

export async function nativeSetItem(key: string, value: string): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore quota */
  }
  if (!isNativeCapacitor()) return;
  try {
    const { Preferences } = await import("@capacitor/preferences");
    await Preferences.set({ key: PREF_PREFIX + key, value });
  } catch {
    /* Preferences unavailable — localStorage already written */
  }
}

export async function nativeGetItem(key: string): Promise<string | null> {
  if (typeof window === "undefined") return null;
  if (isNativeCapacitor()) {
    try {
      const { Preferences } = await import("@capacitor/preferences");
      const { value } = await Preferences.get({ key: PREF_PREFIX + key });
      if (value != null && value !== "") {
        // Keep localStorage in sync for code paths that still read it synchronously
        try {
          localStorage.setItem(key, value);
        } catch {
          /* ignore */
        }
        return value;
      }
    } catch {
      /* fall through */
    }
  }
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export async function nativeRemoveItem(key: string): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
  if (!isNativeCapacitor()) return;
  try {
    const { Preferences } = await import("@capacitor/preferences");
    await Preferences.remove({ key: PREF_PREFIX + key });
  } catch {
    /* ignore */
  }
}

export async function nativeClearSessionKeys(keys: string[]): Promise<void> {
  for (const k of keys) {
    await nativeRemoveItem(k);
  }
}

export function isRunningInCapacitorNative(): boolean {
  return isNativeCapacitor();
}
