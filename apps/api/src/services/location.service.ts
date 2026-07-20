/**
 * Field Sales Location Tracking
 * - Precise GPS only when client sends coordinates (browser permission granted)
 * - IP fallback: city/state/country only — never fabricate locality/area
 * - Tenant-scoped via businessId
 */
import { prisma } from "@/lib/prisma";
import {
  buildOwnedEntityScope,
  resolveActorRole,
} from "@/services/tenant-scope.service";
import { getUserBusinessId } from "@/services/field-engine.service";

export type LocationPayload = {
  eventType?: string;
  latitude?: number | null;
  longitude?: number | null;
  accuracyM?: number | null;
  speedMps?: number | null;
  headingDeg?: number | null;
  /** Client may send reverse-geocoded fields from GPS */
  fullAddress?: string | null;
  locality?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  pincode?: string | null;
  userAgent?: string | null;
  browser?: string | null;
  device?: string | null;
  os?: string | null;
  meetingId?: string | null;
  fieldSessionId?: string | null;
  /** Optional client-side source hint */
  source?: "gps" | "ip" | "unknown";
};

export type DeviceContext = {
  publicIp?: string | null;
  userAgent?: string | null;
  browser?: string | null;
  device?: string | null;
  os?: string | null;
};

const VIEW_ALL_ROLES = new Set([
  "ceo",
  "owner",
  "business_admin",
  "admin",
  "super_admin",
]);
const VIEW_TEAM_ROLES = new Set(["sales_manager", "manager"]);

function hasGps(lat?: number | null, lng?: number | null): boolean {
  return (
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180
  );
}

/** Haversine distance in km */
export function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Rough urban drive estimate minutes (~22 km/h avg) */
export function estimateTravelMinutes(distanceKm: number): number {
  if (!Number.isFinite(distanceKm) || distanceKm <= 0) return 0;
  return Math.max(1, Math.round((distanceKm / 22) * 60));
}

export function parseUserAgent(ua?: string | null): {
  browser: string;
  device: string;
  os: string;
} {
  const s = ua || "";
  let browser = "Unknown";
  if (/edg\//i.test(s)) browser = "Edge";
  else if (/chrome|crios/i.test(s) && !/edg/i.test(s)) browser = "Chrome";
  else if (/firefox|fxios/i.test(s)) browser = "Firefox";
  else if (/safari/i.test(s) && !/chrome/i.test(s)) browser = "Safari";
  else if (/msie|trident/i.test(s)) browser = "IE";

  let os = "Unknown";
  if (/windows nt/i.test(s)) os = "Windows";
  else if (/android/i.test(s)) os = "Android";
  else if (/iphone|ipad|ipod/i.test(s)) os = "iOS";
  else if (/mac os x/i.test(s)) os = "macOS";
  else if (/linux/i.test(s)) os = "Linux";

  let device = "Desktop";
  if (/mobile|android|iphone|ipod/i.test(s)) device = "Mobile";
  else if (/ipad|tablet/i.test(s)) device = "Tablet";

  return { browser, device, os };
}

/**
 * IP geolocation — city/state/country only.
 * Uses ipapi.co JSON (HTTPS). Failures return empty (no fabrication).
 */
export async function lookupIpGeo(ip?: string | null): Promise<{
  city?: string;
  state?: string;
  country?: string;
}> {
  if (!ip || ip === "127.0.0.1" || ip === "::1" || ip.startsWith("192.168.") || ip.startsWith("10.")) {
    return {};
  }
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 2500);
    const res = await fetch(`https://ipapi.co/${encodeURIComponent(ip)}/json/`, {
      signal: controller.signal,
      headers: { "User-Agent": "MassiveMentor-Location/1.0" },
    });
    clearTimeout(t);
    if (!res.ok) return {};
    const j = (await res.json()) as {
      city?: string;
      region?: string;
      country_name?: string;
      error?: boolean;
    };
    if (j.error) return {};
    return {
      city: j.city || undefined,
      state: j.region || undefined,
      country: j.country_name || undefined,
    };
  } catch {
    return {};
  }
}

/**
 * Reverse geocode GPS via Nominatim (OpenStreetMap).
 * Extracts locality/area from suburb/neighbourhood/city_district.
 */
export async function reverseGeocode(
  lat: number,
  lng: number
): Promise<{
  fullAddress?: string;
  locality?: string;
  city?: string;
  state?: string;
  country?: string;
  pincode?: string;
  provider?: string;
}> {
  // 1) Nominatim (OpenStreetMap)
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 4500);
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&addressdetails=1&zoom=18`;
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "MassiveMentor-CRM/1.0 (field-sales-location; contact: team@massivementor.in)",
        Accept: "application/json",
      },
    });
    clearTimeout(t);
    if (res.ok) {
      const j = (await res.json()) as {
        display_name?: string;
        address?: Record<string, string>;
      };
      const a = j.address || {};
      const locality =
        a.suburb ||
        a.neighbourhood ||
        a.quarter ||
        a.city_district ||
        a.village ||
        a.town ||
        a.hamlet ||
        undefined;
      const city = a.city || a.town || a.municipality || a.county || undefined;
      const state = a.state || a.region || undefined;
      const country = a.country || undefined;
      const pincode = a.postcode || undefined;
      console.info("[location] reverseGeocode Nominatim ok", {
        lat,
        lng,
        city,
        pincode,
      });
      return {
        fullAddress: j.display_name || undefined,
        locality,
        city,
        state,
        country,
        pincode,
        provider: "nominatim",
      };
    }
    console.warn("[location] reverseGeocode Nominatim HTTP", res.status);
  } catch (e) {
    console.warn(
      "[location] reverseGeocode Nominatim failed",
      e instanceof Error ? e.message : e
    );
  }

  // 2) BigDataCloud free reverse geocode (no key, server-side)
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 4000);
    const url = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=en`;
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(t);
    if (res.ok) {
      const j = (await res.json()) as {
        locality?: string;
        city?: string;
        principalSubdivision?: string;
        countryName?: string;
        postcode?: string;
      };
      const fullAddress = [j.locality, j.city, j.principalSubdivision, j.postcode, j.countryName]
        .filter(Boolean)
        .join(", ");
      console.info("[location] reverseGeocode BigDataCloud ok", {
        lat,
        lng,
        city: j.city,
        pincode: j.postcode,
      });
      return {
        fullAddress: fullAddress || undefined,
        locality: j.locality || undefined,
        city: j.city || j.locality || undefined,
        state: j.principalSubdivision || undefined,
        country: j.countryName || undefined,
        pincode: j.postcode || undefined,
        provider: "bigdatacloud",
      };
    }
    console.warn("[location] reverseGeocode BigDataCloud HTTP", res.status);
  } catch (e) {
    console.warn(
      "[location] reverseGeocode BigDataCloud failed",
      e instanceof Error ? e.message : e
    );
  }

  console.error("[location] reverseGeocode ALL providers failed", { lat, lng });
  return {};
}

function deriveStatus(eventType: string, hadActiveField: boolean, hadMeeting: boolean): string {
  if (eventType === "logout") return "offline";
  if (eventType === "meeting_checkin") return "meeting";
  if (eventType === "meeting_checkout") return hadActiveField ? "in_field" : "online";
  if (eventType === "field_start") return "in_field";
  if (eventType === "field_end") return "online";
  if (eventType === "login" || eventType === "heartbeat") {
    if (hadMeeting) return "meeting";
    if (hadActiveField) return "in_field";
    return "online";
  }
  return "online";
}

export async function recordLocationEvent(
  userId: string,
  payload: LocationPayload,
  device: DeviceContext,
  eventType: string
) {
  const businessId = await getUserBusinessId(userId);
  const ua = payload.userAgent || device.userAgent || null;
  const parsed = parseUserAgent(ua || undefined);
  const browser = payload.browser || device.browser || parsed.browser;
  const deviceType = payload.device || device.device || parsed.device;
  const os = payload.os || device.os || parsed.os;
  const publicIp = device.publicIp || null;

  let latitude = hasGps(payload.latitude, payload.longitude) ? payload.latitude! : null;
  let longitude = hasGps(payload.latitude, payload.longitude) ? payload.longitude! : null;
  let source: string = latitude != null ? "gps" : "unknown";

  let fullAddress = payload.fullAddress?.trim() || null;
  let locality = payload.locality?.trim() || null;
  let city = payload.city?.trim() || null;
  let state = payload.state?.trim() || null;
  let country = payload.country?.trim() || null;
  let pincode = payload.pincode?.trim() || null;
  const speedMps =
    typeof payload.speedMps === "number" && Number.isFinite(payload.speedMps)
      ? payload.speedMps
      : null;
  const headingDeg =
    typeof payload.headingDeg === "number" && Number.isFinite(payload.headingDeg)
      ? payload.headingDeg
      : null;
  const accuracyM =
    typeof payload.accuracyM === "number" && Number.isFinite(payload.accuracyM)
      ? payload.accuracyM
      : null;

  console.info("[location] recordLocationEvent input", {
    userId,
    eventType,
    rawLat: payload.latitude,
    rawLng: payload.longitude,
    hasGps: latitude != null,
    clientSource: payload.source,
    clientCity: payload.city,
    publicIp,
  });

  if (latitude != null && longitude != null) {
    source = "gps";
    // ALWAYS reverse-geocode on server when coords exist (client address often missing due to CORS)
    const geo = await reverseGeocode(latitude, longitude);
    fullAddress = fullAddress || geo.fullAddress || null;
    locality = locality || geo.locality || null;
    city = city || geo.city || null;
    state = state || geo.state || null;
    country = country || geo.country || null;
    pincode = pincode || geo.pincode || null;
    console.info("[location] GPS stored", {
      userId,
      eventType,
      latitude,
      longitude,
      accuracyM,
      city,
      locality,
      pincode,
      fullAddress: fullAddress?.slice(0, 120),
      reverseProvider: geo.provider || "none",
    });
  } else {
    // No GPS coordinates in payload — do NOT label as "ip" for field UX.
    // Optional coarse city from public IP for debugging only (never as GPS address).
    source = "unknown";
    locality = null;
    latitude = null;
    longitude = null;
    fullAddress = null;
    pincode = null;
    if (!city || !state || !country) {
      const ipGeo = await lookupIpGeo(publicIp);
      city = city || ipGeo.city || null;
      state = state || ipGeo.state || null;
      country = country || ipGeo.country || null;
    }
    console.warn("[location] NO GPS coordinates — storing without route accuracy", {
      userId,
      eventType,
      publicIp,
      city,
      failHint:
        "Browser likely blocked Geolocation (common on http://public-ip without HTTPS)",
    });
  }

  // Active sessions for status
  const activeField = await prisma.fieldWorkSession.findFirst({
    where: { userId, status: "active" },
    orderBy: { startedAt: "desc" },
  });
  const openMeeting = await prisma.meetingAttendance.findFirst({
    where: { userId, checkInAt: { not: null }, checkOutAt: null },
    orderBy: { checkInAt: "desc" },
  });

  // Segment distance from previous GPS point (route tracking)
  let segmentDistanceKm: number | null = null;
  if (latitude != null && longitude != null) {
    const prev = await prisma.locationEvent.findFirst({
      where: {
        userId,
        source: "gps",
        latitude: { not: null },
        longitude: { not: null },
      },
      orderBy: { recordedAt: "desc" },
      select: { latitude: true, longitude: true, recordedAt: true },
    });
    if (
      prev?.latitude != null &&
      prev.longitude != null &&
      Date.now() - prev.recordedAt.getTime() < 6 * 60 * 60 * 1000
    ) {
      const d = haversineKm(prev.latitude, prev.longitude, latitude, longitude);
      // Ignore GPS jumps > 50km between consecutive pings
      if (d > 0.005 && d < 50) {
        segmentDistanceKm = Math.round(d * 1000) / 1000;
      }
    }
  }

  const dayKey = new Date().toISOString().slice(0, 10);
  const prevState = await prisma.userLocationState.findUnique({ where: { userId } });
  let travelledKmToday = prevState?.travelledKmToday ?? 0;
  if (prevState?.travelDayKey !== dayKey) travelledKmToday = 0;
  if (segmentDistanceKm != null) {
    travelledKmToday = Math.round((travelledKmToday + segmentDistanceKm) * 1000) / 1000;
  }

  const movementStatus =
    speedMps != null && speedMps > 0.8
      ? "moving"
      : speedMps != null
        ? "stationary"
        : segmentDistanceKm != null && segmentDistanceKm > 0.03
          ? "moving"
          : latitude != null
            ? "stationary"
            : "unknown";

  const event = await prisma.locationEvent.create({
    data: {
      userId,
      businessId,
      eventType,
      recordedAt: new Date(),
      latitude,
      longitude,
      accuracyM,
      speedMps,
      headingDeg,
      segmentDistanceKm,
      source,
      fullAddress,
      locality,
      city,
      state,
      country,
      pincode,
      publicIp,
      userAgent: ua,
      browser,
      device: deviceType,
      os,
      meetingId: payload.meetingId || openMeeting?.meetingId || null,
      fieldSessionId: payload.fieldSessionId || activeField?.id || null,
    },
  });

  // Accumulate route distance on active field session
  if (activeField && segmentDistanceKm != null && eventType !== "field_end") {
    await prisma.fieldWorkSession.update({
      where: { id: activeField.id },
      data: {
        totalTravelledKm:
          Math.round(((activeField.totalTravelledKm || 0) + segmentDistanceKm) * 1000) / 1000,
      },
    });
  }

  const status = deriveStatus(
    eventType,
    !!activeField && eventType !== "field_end",
    !!openMeeting && eventType !== "meeting_checkout"
  );

  await prisma.userLocationState.upsert({
    where: { userId },
    create: {
      userId,
      businessId,
      status: eventType === "logout" ? "offline" : status,
      lastEventType: eventType,
      lastLocality: locality,
      lastCity: city,
      lastState: state,
      lastCountry: country,
      lastFullAddress: fullAddress,
      lastPincode: pincode,
      lastLat: latitude,
      lastLng: longitude,
      lastAccuracyM: accuracyM,
      lastSpeedMps: speedMps,
      lastHeadingDeg: headingDeg,
      lastSource: source,
      movementStatus,
      travelledKmToday,
      travelDayKey: dayKey,
      lastUpdatedAt: new Date(),
      activeFieldSessionId:
        eventType === "field_end" ? null : activeField?.id || null,
      activeMeetingId:
        eventType === "meeting_checkout" ? null : openMeeting?.meetingId || null,
    },
    update: {
      businessId,
      status: eventType === "logout" ? "offline" : status,
      lastEventType: eventType,
      lastLocality: locality,
      lastCity: city,
      lastState: state,
      lastCountry: country,
      lastFullAddress: fullAddress,
      lastPincode: pincode,
      lastLat: latitude,
      lastLng: longitude,
      lastAccuracyM: accuracyM,
      lastSpeedMps: speedMps,
      lastHeadingDeg: headingDeg,
      lastSource: source,
      movementStatus,
      travelledKmToday,
      travelDayKey: dayKey,
      lastUpdatedAt: new Date(),
      activeFieldSessionId:
        eventType === "field_end"
          ? null
          : eventType === "field_start"
            ? payload.fieldSessionId || activeField?.id || null
            : undefined,
      activeMeetingId:
        eventType === "meeting_checkout"
          ? null
          : eventType === "meeting_checkin"
            ? payload.meetingId || null
            : undefined,
    },
  });

  return event;
}

export async function startFieldWork(
  userId: string,
  payload: LocationPayload,
  device: DeviceContext
) {
  const businessId = await getUserBusinessId(userId);
  const existing = await prisma.fieldWorkSession.findFirst({
    where: { userId, status: "active" },
  });
  if (existing) {
    throw new Error("Field work session already active. End it before starting a new one.");
  }

  // GPS strongly preferred for field start
  const session = await prisma.fieldWorkSession.create({
    data: {
      userId,
      businessId,
      status: "active",
      startedAt: new Date(),
      startLat: hasGps(payload.latitude, payload.longitude) ? payload.latitude! : null,
      startLng: hasGps(payload.latitude, payload.longitude) ? payload.longitude! : null,
      startSource: hasGps(payload.latitude, payload.longitude) ? "gps" : "unknown",
    },
  });

  const event = await recordLocationEvent(
    userId,
    { ...payload, fieldSessionId: session.id },
    device,
    "field_start"
  );

  await prisma.fieldWorkSession.update({
    where: { id: session.id },
    data: {
      startLocality: event.locality,
      startAddress: event.fullAddress,
      startLat: event.latitude,
      startLng: event.longitude,
      startSource: event.source,
    },
  });

  await prisma.userLocationState.update({
    where: { userId },
    data: { activeFieldSessionId: session.id, status: "in_field" },
  });

  return { session: await prisma.fieldWorkSession.findUnique({ where: { id: session.id } }), event };
}

export async function endFieldWork(
  userId: string,
  payload: LocationPayload,
  device: DeviceContext
) {
  const session = await prisma.fieldWorkSession.findFirst({
    where: { userId, status: "active" },
    orderBy: { startedAt: "desc" },
  });
  if (!session) throw new Error("No active field work session");

  const event = await recordLocationEvent(
    userId,
    { ...payload, fieldSessionId: session.id },
    device,
    "field_end"
  );

  let distanceKm: number | null = null;
  if (
    session.startLat != null &&
    session.startLng != null &&
    event.latitude != null &&
    event.longitude != null
  ) {
    distanceKm =
      Math.round(
        haversineKm(session.startLat, session.startLng, event.latitude, event.longitude) * 100
      ) / 100;
  }

  // Prefer cumulative path distance if we recorded heartbeats
  const totalTravelled =
    session.totalTravelledKm != null && session.totalTravelledKm > 0
      ? Math.round((session.totalTravelledKm + (event.segmentDistanceKm || 0)) * 1000) / 1000
      : distanceKm;

  const updated = await prisma.fieldWorkSession.update({
    where: { id: session.id },
    data: {
      status: "ended",
      endedAt: new Date(),
      endLat: event.latitude,
      endLng: event.longitude,
      endLocality: event.locality,
      endAddress: event.fullAddress,
      endSource: event.source,
      distanceKm,
      totalTravelledKm: totalTravelled,
    },
  });

  return { session: updated, event };
}

export async function meetingCheckIn(
  userId: string,
  meetingId: string,
  payload: LocationPayload,
  device: DeviceContext
) {
  const scope = await buildOwnedEntityScope(userId);
  const meeting = await prisma.meeting.findFirst({
    where: { AND: [scope.where as object, { id: meetingId }] } as never,
  });
  if (!meeting) throw new Error("Meeting not found");

  const businessId = await getUserBusinessId(userId);
  let attendance = await prisma.meetingAttendance.findUnique({
    where: { meetingId_userId: { meetingId, userId } },
  });
  if (attendance?.checkInAt && !attendance.checkOutAt) {
    throw new Error("Already checked in to this meeting");
  }

  const event = await recordLocationEvent(
    userId,
    { ...payload, meetingId },
    device,
    "meeting_checkin"
  );

  attendance = await prisma.meetingAttendance.upsert({
    where: { meetingId_userId: { meetingId, userId } },
    create: {
      meetingId,
      userId,
      businessId,
      checkInAt: new Date(),
      checkInLat: event.latitude,
      checkInLng: event.longitude,
      checkInLocality: event.locality,
      checkInAddress: event.fullAddress,
      checkInSource: event.source,
    },
    update: {
      checkInAt: new Date(),
      checkInLat: event.latitude,
      checkInLng: event.longitude,
      checkInLocality: event.locality,
      checkInAddress: event.fullAddress,
      checkInSource: event.source,
      checkOutAt: null,
      checkOutLat: null,
      checkOutLng: null,
      checkOutLocality: null,
      checkOutAddress: null,
      durationMin: null,
    },
  });

  await prisma.userLocationState.update({
    where: { userId },
    data: { status: "meeting", activeMeetingId: meetingId },
  });

  return { attendance, event, meeting };
}

export async function meetingCheckOut(
  userId: string,
  meetingId: string,
  payload: LocationPayload,
  device: DeviceContext
) {
  const attendance = await prisma.meetingAttendance.findUnique({
    where: { meetingId_userId: { meetingId, userId } },
  });
  if (!attendance?.checkInAt) throw new Error("Not checked in to this meeting");
  if (attendance.checkOutAt) throw new Error("Already checked out");

  const event = await recordLocationEvent(
    userId,
    { ...payload, meetingId },
    device,
    "meeting_checkout"
  );

  const durationMin = Math.max(
    1,
    Math.round((Date.now() - attendance.checkInAt.getTime()) / 60000)
  );

  const updated = await prisma.meetingAttendance.update({
    where: { id: attendance.id },
    data: {
      checkOutAt: new Date(),
      checkOutLat: event.latitude,
      checkOutLng: event.longitude,
      checkOutLocality: event.locality,
      checkOutAddress: event.fullAddress,
      checkOutSource: event.source,
      durationMin,
    },
  });

  const activeField = await prisma.fieldWorkSession.findFirst({
    where: { userId, status: "active" },
  });

  await prisma.userLocationState.update({
    where: { userId },
    data: {
      status: activeField ? "in_field" : "online",
      activeMeetingId: null,
    },
  });

  return { attendance: updated, event };
}

/** Who can view which users' locations */
async function resolveVisibleUserIds(
  actorUserId: string,
  filterUserId?: string
): Promise<{ businessId: string | null; userIds: string[] | "all" }> {
  const businessId = await getUserBusinessId(actorUserId);
  const role = await resolveActorRole(actorUserId);

  if (VIEW_ALL_ROLES.has(role)) {
    if (filterUserId) return { businessId, userIds: [filterUserId] };
    return { businessId, userIds: "all" };
  }

  if (VIEW_TEAM_ROLES.has(role) && businessId) {
    // Team members in same business (simplified: all non-admin members for now;
    // TeamMember table can refine assignment later)
    const members = await prisma.businessMember.findMany({
      where: { businessId },
      select: { userId: true, role: true },
    });
    let ids = members
      .filter((m) =>
        ["sales_executive", "support_executive", "sales_manager", "manager"].includes(m.role)
      )
      .map((m) => m.userId);
    // Always include self
    if (!ids.includes(actorUserId)) ids.push(actorUserId);
    if (filterUserId) {
      if (!ids.includes(filterUserId)) throw new Error("Not allowed to view this user");
      ids = [filterUserId];
    }
    return { businessId, userIds: ids };
  }

  // Sales executive: self only
  if (filterUserId && filterUserId !== actorUserId) {
    throw new Error("Not allowed to view other employees' locations");
  }
  return { businessId, userIds: [actorUserId] };
}

export async function getLiveTeamLocations(actorUserId: string) {
  const { businessId, userIds } = await resolveVisibleUserIds(actorUserId);
  if (!businessId) return { team: [], office: null };

  const where: Record<string, unknown> = { businessId };
  if (userIds !== "all") where.userId = { in: userIds };

  const states = await prisma.userLocationState.findMany({
    where: where as never,
    orderBy: { lastUpdatedAt: "desc" },
  });

  const users = await prisma.user.findMany({
    where: { id: { in: states.map((s) => s.userId) } },
    select: { id: true, name: true, email: true, role: true },
  });
  const umap = new Map(users.map((u) => [u.id, u]));

  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { settings: true, name: true },
  });
  const settings = (business?.settings || {}) as {
    officeLat?: number;
    officeLng?: number;
    officeAddress?: string;
    officeLabel?: string;
  };
  const office =
    typeof settings.officeLat === "number" && typeof settings.officeLng === "number"
      ? {
          lat: settings.officeLat,
          lng: settings.officeLng,
          address: settings.officeAddress || null,
          label: settings.officeLabel || "Office",
        }
      : null;

  const team = states.map((s) => {
    const u = umap.get(s.userId);
    let distanceFromOfficeKm: number | null = null;
    let travelMinutes: number | null = null;
    if (
      office &&
      s.lastLat != null &&
      s.lastLng != null &&
      s.lastSource === "gps"
    ) {
      distanceFromOfficeKm =
        Math.round(haversineKm(office.lat, office.lng, s.lastLat, s.lastLng) * 100) / 100;
      travelMinutes = estimateTravelMinutes(distanceFromOfficeKm);
    }
    // Stale online → offline if > 30 min no update
    let status = s.status;
    if (
      status !== "offline" &&
      Date.now() - s.lastUpdatedAt.getTime() > 30 * 60 * 1000
    ) {
      status = "offline";
    }
    return {
      userId: s.userId,
      name: u?.name || u?.email || "User",
      email: u?.email,
      role: u?.role,
      status,
      locality: s.lastLocality,
      city: s.lastCity,
      state: s.lastState,
      country: s.lastCountry,
      pincode: s.lastPincode,
      fullAddress: s.lastFullAddress,
      lat: s.lastSource === "gps" ? s.lastLat : null,
      lng: s.lastSource === "gps" ? s.lastLng : null,
      source: s.lastSource,
      accuracyM: s.lastAccuracyM,
      speedMps: s.lastSpeedMps,
      headingDeg: s.lastHeadingDeg,
      movementStatus: s.movementStatus,
      travelledKmToday: s.travelledKmToday ?? 0,
      lastEventType: s.lastEventType,
      lastUpdatedAt: s.lastUpdatedAt,
      activeFieldSessionId: s.activeFieldSessionId,
      activeMeetingId: s.activeMeetingId,
      distanceFromOfficeKm,
      travelMinutes,
    };
  });

  return { team, office, businessName: business?.name || null };
}

export async function getLocationHistory(
  actorUserId: string,
  opts?: {
    userId?: string;
    from?: string;
    to?: string;
    eventType?: string;
    page?: number;
    pageSize?: number;
  }
) {
  const targetUserId = opts?.userId || actorUserId;
  const { businessId, userIds } = await resolveVisibleUserIds(actorUserId, targetUserId);
  const page = opts?.page && opts.page > 0 ? opts.page : 1;
  const pageSize = Math.min(100, Math.max(1, opts?.pageSize || 30));

  const where: Record<string, unknown> = {
    userId: userIds === "all" ? targetUserId : { in: userIds as string[] },
  };
  if (businessId) {
    where.OR = [{ businessId }, { businessId: null, userId: targetUserId }];
  }
  if (opts?.eventType) where.eventType = opts.eventType;
  if (opts?.from || opts?.to) {
    where.recordedAt = {
      ...(opts.from ? { gte: new Date(opts.from) } : {}),
      ...(opts.to ? { lte: new Date(opts.to) } : {}),
    };
  }

  const [total, items] = await Promise.all([
    prisma.locationEvent.count({ where: where as never }),
    prisma.locationEvent.findMany({
      where: where as never,
      orderBy: { recordedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return {
    items,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function getMyFieldStatus(userId: string) {
  const [state, activeField, openMeeting] = await Promise.all([
    prisma.userLocationState.findUnique({ where: { userId } }),
    prisma.fieldWorkSession.findFirst({
      where: { userId, status: "active" },
      orderBy: { startedAt: "desc" },
    }),
    prisma.meetingAttendance.findFirst({
      where: { userId, checkInAt: { not: null }, checkOutAt: null },
      orderBy: { checkInAt: "desc" },
      include: { meeting: { select: { id: true, title: true, scheduledAt: true } } },
    }),
  ]);
  return { state, activeField, openMeeting };
}

export async function getTravelInsights(
  actorUserId: string,
  targetUserId?: string,
  day?: string
) {
  const uid = targetUserId || actorUserId;
  await resolveVisibleUserIds(actorUserId, uid);

  const start = day ? new Date(day) : new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  const events = await prisma.locationEvent.findMany({
    where: {
      userId: uid,
      recordedAt: { gte: start, lt: end },
      source: "gps",
      latitude: { not: null },
      longitude: { not: null },
    },
    orderBy: { recordedAt: "asc" },
  });

  let travelledKm = 0;
  for (let i = 1; i < events.length; i++) {
    const a = events[i - 1];
    const b = events[i];
    if (a.latitude != null && a.longitude != null && b.latitude != null && b.longitude != null) {
      travelledKm += haversineKm(a.latitude, a.longitude, b.latitude, b.longitude);
    }
  }
  travelledKm = Math.round(travelledKm * 100) / 100;

  const visits = await prisma.meetingAttendance.findMany({
    where: {
      userId: uid,
      checkInAt: { gte: start, lt: end },
    },
    include: { meeting: { select: { title: true } } },
  });

  const visitSummary = visits.map((v) => ({
    meetingTitle: v.meeting?.title,
    locality: v.checkInLocality,
    stayedMin: v.durationMin,
    checkInAt: v.checkInAt,
    checkOutAt: v.checkOutAt,
  }));

  const totalStayMin = visits.reduce((s, v) => s + (v.durationMin || 0), 0);
  const state = await prisma.userLocationState.findUnique({ where: { userId: uid } });

  const businessId = await getUserBusinessId(uid);
  let officeInsight: {
    distanceKm: number | null;
    travelMinutes: number | null;
    officeLabel: string;
  } | null = null;
  if (businessId && state?.lastLat != null && state?.lastLng != null && state.lastSource === "gps") {
    const biz = await prisma.business.findUnique({
      where: { id: businessId },
      select: { settings: true },
    });
    const settings = (biz?.settings || {}) as { officeLat?: number; officeLng?: number; officeLabel?: string };
    if (typeof settings.officeLat === "number" && typeof settings.officeLng === "number") {
      const d =
        Math.round(
          haversineKm(settings.officeLat, settings.officeLng, state.lastLat, state.lastLng) * 100
        ) / 100;
      officeInsight = {
        distanceKm: d,
        travelMinutes: estimateTravelMinutes(d),
        officeLabel: settings.officeLabel || "Office",
      };
    }
  }

  const speedKmh =
    state?.lastSpeedMps != null && Number.isFinite(state.lastSpeedMps)
      ? Math.round(state.lastSpeedMps * 3.6 * 10) / 10
      : null;

  // Prefer stored cumulative day distance when available
  const dayKey = start.toISOString().slice(0, 10);
  const storedToday =
    state?.travelDayKey === dayKey && state.travelledKmToday != null
      ? Math.round(state.travelledKmToday * 100) / 100
      : null;

  return {
    date: dayKey,
    currentLocality: state?.lastLocality || null,
    currentCity: state?.lastCity || null,
    currentState: state?.lastState || null,
    currentCountry: state?.lastCountry || null,
    currentPincode: state?.lastPincode || null,
    fullAddress: state?.lastFullAddress || null,
    lat: state?.lastSource === "gps" ? state.lastLat : null,
    lng: state?.lastSource === "gps" ? state.lastLng : null,
    accuracyM: state?.lastAccuracyM ?? null,
    source: state?.lastSource || null,
    movementStatus: state?.movementStatus || "unknown",
    speedKmh,
    lastUpdatedAt: state?.lastUpdatedAt || null,
    travelledKm: storedToday != null && storedToday > travelledKm ? storedToday : travelledKm,
    totalStayMin,
    visits: visitSummary,
    eventCount: events.length,
    route: events.map((e) => ({
      lat: e.latitude,
      lng: e.longitude,
      at: e.recordedAt,
      address: e.fullAddress,
      speedMps: e.speedMps,
    })),
    officeInsight,
  };
}

export async function setOfficeLocation(
  actorUserId: string,
  data: { lat: number; lng: number; address?: string; label?: string }
) {
  const role = await resolveActorRole(actorUserId);
  if (!VIEW_ALL_ROLES.has(role)) throw new Error("Only admin/CEO can set office location");
  const businessId = await getUserBusinessId(actorUserId);
  if (!businessId) throw new Error("No business");
  const biz = await prisma.business.findUnique({ where: { id: businessId } });
  const settings = {
    ...((biz?.settings as object) || {}),
    officeLat: data.lat,
    officeLng: data.lng,
    officeAddress: data.address || null,
    officeLabel: data.label || "Office",
  };
  await prisma.business.update({
    where: { id: businessId },
    data: { settings },
  });
  return settings;
}

export async function buildLocationReport(
  actorUserId: string,
  opts: {
    type: "attendance" | "travel" | "visits" | "productivity" | "route";
    from?: string;
    to?: string;
    userId?: string;
  }
) {
  const target = opts.userId || actorUserId;
  await resolveVisibleUserIds(actorUserId, opts.userId);

  const from = opts.from ? new Date(opts.from) : new Date(new Date().setHours(0, 0, 0, 0));
  const to = opts.to ? new Date(opts.to) : new Date();

  if (opts.type === "attendance") {
    const logins = await prisma.locationEvent.findMany({
      where: {
        userId: target,
        eventType: { in: ["login", "logout", "field_start", "field_end"] },
        recordedAt: { gte: from, lte: to },
      },
      orderBy: { recordedAt: "asc" },
    });
    return {
      type: "attendance",
      rows: logins.map((e) => ({
        date: e.recordedAt.toISOString().slice(0, 10),
        time: e.recordedAt.toISOString().slice(11, 19),
        event: e.eventType,
        locality: e.locality || "",
        city: e.city || "",
        address: e.fullAddress || "",
        source: e.source,
        ip: e.publicIp || "",
        device: e.device || "",
        browser: e.browser || "",
      })),
    };
  }

  if (opts.type === "visits") {
    const visits = await prisma.meetingAttendance.findMany({
      where: {
        userId: target,
        checkInAt: { gte: from, lte: to },
      },
      include: { meeting: { select: { title: true } } },
      orderBy: { checkInAt: "asc" },
    });
    return {
      type: "visits",
      rows: visits.map((v) => ({
        meeting: v.meeting?.title || "",
        checkIn: v.checkInAt?.toISOString() || "",
        checkOut: v.checkOutAt?.toISOString() || "",
        stayedMin: v.durationMin ?? "",
        locality: v.checkInLocality || "",
        address: v.checkInAddress || "",
      })),
    };
  }

  if (opts.type === "travel" || opts.type === "productivity" || opts.type === "route") {
    const insights = await getTravelInsights(actorUserId, target, from.toISOString().slice(0, 10));
    const history = await getLocationHistory(actorUserId, {
      userId: target,
      from: from.toISOString(),
      to: to.toISOString(),
      pageSize: 100,
    });
    return {
      type: opts.type,
      summary: insights,
      rows: history.items.map((e) => ({
        datetime: e.recordedAt.toISOString(),
        event: e.eventType,
        locality: e.locality || "",
        city: e.city || "",
        lat: e.latitude ?? "",
        lng: e.longitude ?? "",
        source: e.source,
      })),
    };
  }

  return { type: opts.type, rows: [] };
}

export function reportToCsv(report: { rows: Array<Record<string, unknown>> }): string {
  const rows = report.rows || [];
  if (!rows.length) return "No data\n";
  const headers = Object.keys(rows[0]);
  const lines = [
    headers.join(","),
    ...rows.map((r) =>
      headers
        .map((h) => {
          const v = r[h];
          const s = v == null ? "" : String(v);
          return `"${s.replace(/"/g, '""')}"`;
        })
        .join(",")
    ),
  ];
  return lines.join("\n");
}
