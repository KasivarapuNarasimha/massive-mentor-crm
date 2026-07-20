/**
 * Browser GPS helpers for Field Sales.
 *
 * CRITICAL: The Geolocation API only works in a secure context
 * (HTTPS, or http://localhost / http://127.0.0.1).
 * Plain http://PUBLIC_IP:3000 is NOT secure → browsers block GPS and
 * getCurrentPosition/watchPosition fail even when "permission" looks allowed.
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
  source: "gps" | "unknown";
  userAgent?: string;
  browser?: string;
  device?: string;
  os?: string;
  gpsDenied?: boolean;
  permissionState?: PermissionState | "unsupported" | "insecure_context";
  /** Machine-readable failure reason for UI / logs */
  failReason?: string | null;
  geoErrorCode?: number | null;
  timestamp?: number;
  isSecureContext?: boolean;
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

/** True when browser will allow Geolocation (HTTPS or localhost). */
export function isGeoSecureContext(): boolean {
  if (typeof window === "undefined") return false;
  if (window.isSecureContext === true) return true;
  try {
    const h = window.location.hostname;
    return h === "localhost" || h === "127.0.0.1" || h === "[::1]";
  } catch {
    return false;
  }
}

export async function queryGeoPermission(): Promise<
  PermissionState | "unsupported" | "insecure_context"
> {
  if (!isGeoSecureContext()) return "insecure_context";
  try {
    if (!navigator.permissions?.query) return "unsupported";
    const r = await navigator.permissions.query({ name: "geolocation" as PermissionName });
    return r.state;
  } catch {
    return "unsupported";
  }
}

function geoErrorMessage(err: unknown): { code: number | null; reason: string } {
  if (err && typeof err === "object" && "code" in err) {
    const code = Number((err as GeolocationPositionError).code);
    const msg = String((err as GeolocationPositionError).message || "");
    if (code === 1) return { code, reason: `PERMISSION_DENIED: ${msg || "user denied location"}` };
    if (code === 2) return { code, reason: `POSITION_UNAVAILABLE: ${msg || "position unavailable"}` };
    if (code === 3) return { code, reason: `TIMEOUT: ${msg || "GPS timed out"}` };
    return { code, reason: msg || `Geolocation error code ${code}` };
  }
  if (err instanceof Error) return { code: null, reason: err.message };
  return { code: null, reason: String(err || "unknown GPS error") };
}

function readPosition(
  highAccuracy: boolean,
  timeoutMs: number
): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Geolocation API not available on this browser"));
      return;
    }
    console.info(
      `[mm-gps] getCurrentPosition enableHighAccuracy=${highAccuracy} timeoutMs=${timeoutMs} secure=${isGeoSecureContext()}`
    );
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: highAccuracy,
      timeout: timeoutMs,
      maximumAge: highAccuracy ? 0 : 10_000,
    });
  });
}

/**
 * Client reverse-geocode is best-effort only (Nominatim may block browser CORS).
 * Server always reverse-geocodes when lat/lng are stored.
 */
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
  // Prefer BigDataCloud client endpoint (CORS-friendly) then Nominatim
  try {
    const url = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=en`;
    const res = await fetch(url);
    if (res.ok) {
      const j = (await res.json()) as {
        locality?: string;
        city?: string;
        principalSubdivision?: string;
        countryName?: string;
        postcode?: string;
        localityInfo?: { administrative?: Array<{ name?: string }> };
      };
      const locality = j.locality || null;
      const city = j.city || locality;
      const state = j.principalSubdivision || null;
      const country = j.countryName || null;
      const pincode = j.postcode || null;
      const fullAddress = [locality, city, state, pincode, country].filter(Boolean).join(", ") || null;
      console.info("[mm-gps] reverseGeocode client BigDataCloud ok", { city, state, pincode });
      return { fullAddress, locality, city, state, country, pincode };
    }
  } catch (e) {
    console.warn("[mm-gps] BigDataCloud reverse geocode failed", e);
  }

  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&addressdetails=1&zoom=18`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) {
      console.warn("[mm-gps] Nominatim client HTTP", res.status);
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
  } catch (e) {
    console.warn("[mm-gps] Nominatim client failed", e);
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

  console.info("[mm-gps] raw coords", {
    latitude,
    longitude,
    accuracyM,
    speedMps,
    headingDeg,
    timestamp: pos.timestamp,
  });

  // Non-blocking reverse geocode — coords must ship even if address fails
  let geo = {
    fullAddress: null as string | null,
    locality: null as string | null,
    city: null as string | null,
    state: null as string | null,
    country: null as string | null,
    pincode: null as string | null,
  };
  try {
    geo = await reverseGeocodeClient(latitude, longitude);
  } catch (e) {
    console.warn("[mm-gps] reverse geocode threw (coords still used)", e);
  }

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
    failReason: null,
    geoErrorCode: null,
    timestamp: pos.timestamp || Date.now(),
    isSecureContext: isGeoSecureContext(),
  };
}

/**
 * One-shot GPS capture. Does NOT fall back to IP coordinates.
 * On failure returns source=unknown with failReason explaining why.
 */
export async function captureGps(options?: {
  timeoutMs?: number;
  force?: boolean;
}): Promise<CapturedLocation> {
  const meta = deviceMeta();
  const timeoutMs = options?.timeoutMs ?? 30_000;
  const secure = isGeoSecureContext();
  const permissionState = await queryGeoPermission();

  console.info("[mm-gps] captureGps start", {
    secure,
    permissionState,
    href: typeof window !== "undefined" ? window.location.href : null,
    geolocation: typeof navigator !== "undefined" && !!navigator.geolocation,
  });

  if (!secure) {
    const fail: CapturedLocation = {
      ...meta,
      source: "unknown",
      gpsDenied: true,
      permissionState: "insecure_context",
      failReason:
        "INSECURE_CONTEXT: Geolocation is blocked by the browser on plain HTTP. Use HTTPS (or localhost). Current origin is not a secure context.",
      geoErrorCode: 1,
      isSecureContext: false,
    };
    console.error("[mm-gps] ABORT — insecure context", fail.failReason);
    return fail;
  }

  if (typeof navigator === "undefined" || !navigator.geolocation) {
    return {
      ...meta,
      source: "unknown",
      gpsDenied: true,
      permissionState: "unsupported",
      failReason: "Geolocation API not available",
      isSecureContext: secure,
    };
  }

  try {
    const pos = await readPosition(true, timeoutMs);
    const loc = await fromPosition(pos);
    console.info("[mm-gps] captureGps SUCCESS", {
      lat: loc.latitude,
      lng: loc.longitude,
      city: loc.city,
      address: loc.fullAddress?.slice(0, 80),
    });
    return { ...loc, permissionState, isSecureContext: secure };
  } catch (err1) {
    const e1 = geoErrorMessage(err1);
    console.warn("[mm-gps] high-accuracy failed, retry low-accuracy", e1);
    try {
      const pos = await readPosition(false, Math.min(15_000, timeoutMs));
      const loc = await fromPosition(pos);
      console.info("[mm-gps] captureGps SUCCESS (low accuracy)", {
        lat: loc.latitude,
        lng: loc.longitude,
      });
      return { ...loc, permissionState, isSecureContext: secure };
    } catch (err2) {
      const e2 = geoErrorMessage(err2);
      console.error("[mm-gps] captureGps FAILED", e2);
      return {
        ...meta,
        source: "unknown",
        gpsDenied: true,
        permissionState: e2.code === 1 ? "denied" : permissionState,
        failReason: e2.reason,
        geoErrorCode: e2.code,
        isSecureContext: secure,
      };
    }
  }
}

export type WatchGpsHandlers = {
  onUpdate: (loc: CapturedLocation) => void;
  onError?: (err: GeolocationPositionError | Error, detail?: string) => void;
};

/**
 * Live GPS watch — only starts in a secure context.
 */
export function startWatchGps(handlers: WatchGpsHandlers): () => void {
  if (!isGeoSecureContext()) {
    const msg =
      "INSECURE_CONTEXT: watchPosition blocked on HTTP public host. Serve the app over HTTPS.";
    console.error("[mm-gps]", msg);
    handlers.onError?.(new Error(msg), msg);
    return () => undefined;
  }
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    handlers.onError?.(new Error("Geolocation not supported"));
    return () => undefined;
  }

  console.info("[mm-gps] startWatchGps enableHighAccuracy=true");
  let lastSent: { lat: number; lng: number; at: number } | null = null;
  const MIN_MOVE_M = 15;
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
      console.info("[mm-gps] watchPosition update", { lat, lng, accuracy: pos.coords.accuracy });
      void fromPosition(pos)
        .then((loc) => handlers.onUpdate(loc))
        .catch((e) => handlers.onError?.(e instanceof Error ? e : new Error(String(e))));
    },
    (err) => {
      const d = geoErrorMessage(err);
      console.error("[mm-gps] watchPosition error", d);
      handlers.onError?.(err, d.reason);
    },
    {
      enableHighAccuracy: true,
      maximumAge: 3_000,
      timeout: 25_000,
    }
  );

  return () => {
    try {
      navigator.geolocation.clearWatch(watchId);
      console.info("[mm-gps] watch cleared");
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

/** Payload for POST /location/* — never sends fabricated IP coords */
export function toLocationBody(loc: CapturedLocation): Record<string, unknown> {
  const body = {
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
    source: loc.source === "gps" && loc.latitude != null ? "gps" : "unknown",
    userAgent: loc.userAgent,
    browser: loc.browser,
    device: loc.device,
    os: loc.os,
    failReason: loc.failReason ?? null,
    geoErrorCode: loc.geoErrorCode ?? null,
    isSecureContext: loc.isSecureContext ?? isGeoSecureContext(),
  };
  console.info("[mm-gps] API payload", {
    lat: body.latitude,
    lng: body.longitude,
    source: body.source,
    city: body.city,
    failReason: body.failReason,
  });
  return body;
}

export function gpsStatusLabel(loc: {
  source?: string | null;
  gpsDenied?: boolean;
  permissionState?: string;
  latitude?: number | null;
  failReason?: string | null;
}): string {
  if (loc.latitude != null && loc.source === "gps") return "GPS active";
  if (loc.permissionState === "insecure_context") return "HTTPS required for GPS";
  if (loc.permissionState === "denied" || loc.gpsDenied) return "GPS blocked / denied";
  if (loc.permissionState === "prompt") return "GPS permission needed";
  if (loc.failReason?.includes("TIMEOUT")) return "GPS timeout";
  return "Waiting for GPS…";
}
