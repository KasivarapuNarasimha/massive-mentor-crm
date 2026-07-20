/**
 * Browser GPS helpers for Field Sales.
 * - High-accuracy Geolocation API (enableHighAccuracy)
 * - Optional watchPosition for live tracking during field work
 * - Client reverse-geocode (address, city, state, country, pincode)
 * - Never labels UI as "City Unknown (IP)" — use clear GPS status instead
 */

export type CapturedLocation = {
  latitude?: number | null;
  longitude?: number | null;
  accuracyM?: number | null;
  speedMps?: number | null;
  headingDeg?: number | null;
  fullAddress?: string | null;
  locality?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  pincode?: string | null;
  source: "gps" | "ip" | "unknown";
  userAgent?: string;
  browser?: string;
  device?: string;
  os?: string;
  /** true when permission denied or GPS hardware unavailable */
  gpsDenied?: boolean;
  /** permission state when known */
  permissionState?: PermissionState | "unsupported";
  timestamp?: number;
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

export async function queryGeoPermission(): Promise<PermissionState | "unsupported"> {
  try {
    if (!navigator.permissions?.query) return "unsupported";
    const r = await navigator.permissions.query({ name: "geolocation" as PermissionName });
    return r.state;
  } catch {
    return "unsupported";
  }
}

function readPosition(
  highAccuracy: boolean,
  timeoutMs: number
): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Geolocation not supported"));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: highAccuracy,
      timeout: timeoutMs,
      maximumAge: highAccuracy ? 0 : 15_000,
    });
  });
}

/** Reverse geocode via Nominatim — full address + pincode */
export async function reverseGeocodeClient(
  lat: number,
  lng: number
): Promise<{
  fullAddress: string | null;
  locality: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  pincode: string | null;
}> {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&addressdetails=1&zoom=18`;
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      return {
        fullAddress: null,
        locality: null,
        city: null,
        state: null,
        country: null,
        pincode: null,
      };
    }
    const j = (await res.json()) as {
      display_name?: string;
      address?: Record<string, string>;
    };
    const a = j.address || {};
    return {
      fullAddress: j.display_name || null,
      locality:
        a.suburb ||
        a.neighbourhood ||
        a.quarter ||
        a.city_district ||
        a.village ||
        a.hamlet ||
        null,
      city: a.city || a.town || a.municipality || a.county || null,
      state: a.state || a.region || null,
      country: a.country || null,
      pincode: a.postcode || null,
    };
  } catch {
    return {
      fullAddress: null,
      locality: null,
      city: null,
      state: null,
      country: null,
      pincode: null,
    };
  }
}

async function fromPosition(pos: GeolocationPosition): Promise<CapturedLocation> {
  const meta = deviceMeta();
  const latitude = pos.coords.latitude;
  const longitude = pos.coords.longitude;
  const accuracyM = pos.coords.accuracy;
  const speedMps =
    typeof pos.coords.speed === "number" && Number.isFinite(pos.coords.speed)
      ? pos.coords.speed
      : null;
  const headingDeg =
    typeof pos.coords.heading === "number" && Number.isFinite(pos.coords.heading)
      ? pos.coords.heading
      : null;

  const geo = await reverseGeocodeClient(latitude, longitude);

  return {
    ...meta,
    latitude,
    longitude,
    accuracyM,
    speedMps,
    headingDeg,
    fullAddress: geo.fullAddress,
    locality: geo.locality,
    city: geo.city,
    state: geo.state,
    country: geo.country,
    pincode: geo.pincode,
    source: "gps",
    gpsDenied: false,
    timestamp: pos.timestamp || Date.now(),
  };
}

/**
 * One-shot high-accuracy GPS capture. Always requests permission via Geolocation API.
 */
export async function captureGps(options?: {
  timeoutMs?: number;
  force?: boolean;
}): Promise<CapturedLocation> {
  const meta = deviceMeta();
  const timeoutMs = options?.timeoutMs ?? 25_000;
  const permissionState = await queryGeoPermission();

  if (typeof navigator === "undefined" || !navigator.geolocation) {
    return {
      ...meta,
      source: "unknown",
      gpsDenied: true,
      permissionState: "unsupported",
    };
  }

  try {
    // Always prefer high accuracy first for field sales
    const pos = await readPosition(true, timeoutMs);
    const loc = await fromPosition(pos);
    return { ...loc, permissionState };
  } catch {
    try {
      // Fallback low-accuracy still GPS (not IP labeling for UI)
      const pos = await readPosition(false, Math.min(12_000, timeoutMs));
      const loc = await fromPosition(pos);
      return { ...loc, permissionState };
    } catch (err) {
      const denied =
        err instanceof GeolocationPositionError &&
        err.code === GeolocationPositionError.PERMISSION_DENIED;
      return {
        ...meta,
        source: "unknown",
        gpsDenied: true,
        permissionState: denied ? "denied" : permissionState,
      };
    }
  }
}

export type WatchGpsHandlers = {
  onUpdate: (loc: CapturedLocation) => void;
  onError?: (err: GeolocationPositionError | Error) => void;
};

/**
 * Live GPS watch — high accuracy, updates on movement / every few seconds.
 * Returns stop() to clear the watch.
 */
export function startWatchGps(handlers: WatchGpsHandlers): () => void {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    handlers.onError?.(new Error("Geolocation not supported"));
    return () => undefined;
  }

  let lastSent: { lat: number; lng: number; at: number } | null = null;
  const MIN_MOVE_M = 18; // meaningful movement
  const MIN_INTERVAL_MS = 8_000;

  const watchId = navigator.geolocation.watchPosition(
    (pos) => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      const now = Date.now();
      if (lastSent) {
        const movedM = haversineMeters(lastSent.lat, lastSent.lng, lat, lng);
        const elapsed = now - lastSent.at;
        if (movedM < MIN_MOVE_M && elapsed < MIN_INTERVAL_MS) return;
      }
      lastSent = { lat, lng, at: now };
      void fromPosition(pos)
        .then((loc) => handlers.onUpdate(loc))
        .catch((e) => handlers.onError?.(e instanceof Error ? e : new Error(String(e))));
    },
    (err) => handlers.onError?.(err),
    {
      enableHighAccuracy: true,
      maximumAge: 5_000,
      timeout: 20_000,
    }
  );

  return () => {
    try {
      navigator.geolocation.clearWatch(watchId);
    } catch {
      /* ignore */
    }
  };
}

export function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Payload for POST /location/* */
export function toLocationBody(loc: CapturedLocation): Record<string, unknown> {
  return {
    latitude: loc.latitude ?? null,
    longitude: loc.longitude ?? null,
    accuracyM: loc.accuracyM ?? null,
    speedMps: loc.speedMps ?? null,
    headingDeg: loc.headingDeg ?? null,
    fullAddress: loc.fullAddress ?? null,
    locality: loc.locality ?? null,
    city: loc.city ?? null,
    state: loc.state ?? null,
    country: loc.country ?? null,
    pincode: loc.pincode ?? null,
    source: loc.source === "gps" ? "gps" : "unknown",
    userAgent: loc.userAgent,
    browser: loc.browser,
    device: loc.device,
    os: loc.os,
  };
}

/** Human GPS status for UI — never "City Unknown (IP)" */
export function gpsStatusLabel(loc: {
  source?: string | null;
  gpsDenied?: boolean;
  permissionState?: string;
  latitude?: number | null;
}): string {
  if (loc.latitude != null && loc.source === "gps") return "GPS active";
  if (loc.permissionState === "denied" || loc.gpsDenied) return "GPS permission denied";
  if (loc.permissionState === "prompt") return "GPS permission needed";
  if (loc.source === "ip") return "GPS unavailable";
  return "Waiting for GPS…";
}
