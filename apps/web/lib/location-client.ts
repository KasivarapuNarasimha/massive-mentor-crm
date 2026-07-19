/**
 * Browser location helpers for Field Sales tracking.
 * - Requests GPS via browser Geolocation API when possible
 * - Never fabricates locality from IP (server handles IP city/state only)
 */

export type CapturedLocation = {
  latitude?: number | null;
  longitude?: number | null;
  accuracyM?: number | null;
  fullAddress?: string | null;
  locality?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  source: "gps" | "ip" | "unknown";
  userAgent?: string;
  browser?: string;
  device?: string;
  os?: string;
  gpsDenied?: boolean;
};

function parseUa(ua: string) {
  let browser = "Unknown";
  if (/edg\//i.test(ua)) browser = "Edge";
  else if (/chrome|crios/i.test(ua) && !/edg/i.test(ua)) browser = "Chrome";
  else if (/firefox|fxios/i.test(ua)) browser = "Firefox";
  else if (/safari/i.test(ua) && !/chrome/i.test(ua)) browser = "Safari";

  let os = "Unknown";
  if (/windows nt/i.test(ua)) os = "Windows";
  else if (/android/i.test(ua)) os = "Android";
  else if (/iphone|ipad|ipod/i.test(ua)) os = "iOS";
  else if (/mac os x/i.test(ua)) os = "macOS";
  else if (/linux/i.test(ua)) os = "Linux";

  let device = "Desktop";
  if (/mobile|android|iphone|ipod/i.test(ua)) device = "Mobile";
  else if (/ipad|tablet/i.test(ua)) device = "Tablet";

  return { browser, device, os };
}

export function deviceMeta(): Pick<CapturedLocation, "userAgent" | "browser" | "device" | "os"> {
  const userAgent = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const p = parseUa(userAgent);
  return { userAgent, ...p };
}

/**
 * Try browser GPS. On denial/unavailable, return source=ip for server fallback.
 */
function readPosition(
  highAccuracy: boolean,
  timeoutMs: number
): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: highAccuracy,
      timeout: timeoutMs,
      maximumAge: highAccuracy ? 0 : 60_000,
    });
  });
}

/**
 * Try browser GPS. On denial/unavailable, return source=ip for server fallback.
 * Uses a fast low-accuracy attempt first (better after permission already granted),
 * then high-accuracy if needed.
 */
export async function captureGps(options?: {
  timeoutMs?: number;
  /** When true (field work / check-in), still attempt GPS even if previously denied */
  force?: boolean;
}): Promise<CapturedLocation> {
  const meta = deviceMeta();
  const timeoutMs = options?.timeoutMs ?? 20000;

  if (typeof navigator === "undefined" || !navigator.geolocation) {
    return { ...meta, source: "ip", gpsDenied: true };
  }

  let pos: GeolocationPosition | null = null;
  try {
    // Fast path — works well once permission is already allowed
    pos = await readPosition(false, Math.min(8000, timeoutMs));
  } catch {
    try {
      pos = await readPosition(true, timeoutMs);
    } catch {
      return { ...meta, source: "ip", gpsDenied: true };
    }
  }

  const latitude = pos.coords.latitude;
  const longitude = pos.coords.longitude;
  const accuracyM = pos.coords.accuracy;
  let fullAddress: string | null = null;
  let locality: string | null = null;
  let city: string | null = null;
  let state: string | null = null;
  let country: string | null = null;

  // Optional client reverse-geocode; server also geocodes if missing
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${latitude}&lon=${longitude}&addressdetails=1`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (res.ok) {
      const j = (await res.json()) as {
        display_name?: string;
        address?: Record<string, string>;
      };
      const a = j.address || {};
      fullAddress = j.display_name || null;
      locality =
        a.suburb || a.neighbourhood || a.quarter || a.city_district || a.village || null;
      city = a.city || a.town || a.municipality || null;
      state = a.state || null;
      country = a.country || null;
    }
  } catch {
    /* server reverse-geocode */
  }

  return {
    ...meta,
    latitude,
    longitude,
    accuracyM,
    fullAddress,
    locality,
    city,
    state,
    country,
    source: "gps",
    gpsDenied: false,
  };
}

/** Payload ready for POST /location/* */
export function toLocationBody(loc: CapturedLocation): Record<string, unknown> {
  return {
    latitude: loc.latitude ?? null,
    longitude: loc.longitude ?? null,
    accuracyM: loc.accuracyM ?? null,
    fullAddress: loc.fullAddress ?? null,
    locality: loc.locality ?? null,
    city: loc.city ?? null,
    state: loc.state ?? null,
    country: loc.country ?? null,
    source: loc.source,
    userAgent: loc.userAgent,
    browser: loc.browser,
    device: loc.device,
    os: loc.os,
  };
}
