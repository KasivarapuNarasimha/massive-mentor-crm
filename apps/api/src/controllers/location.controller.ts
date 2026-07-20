import { Response } from "express";
import { AuthenticatedRequest } from "../middleware/auth.js";
import {
  recordLocationEvent,
  startFieldWork,
  endFieldWork,
  meetingCheckIn,
  meetingCheckOut,
  getLiveTeamLocations,
  getLocationHistory,
  getMyFieldStatus,
  getTravelInsights,
  setOfficeLocation,
  buildLocationReport,
  reportToCsv,
  type LocationPayload,
  type DeviceContext,
} from "../services/location.service.js";

function clientIp(req: AuthenticatedRequest): string | null {
  const xf = req.headers["x-forwarded-for"];
  if (typeof xf === "string" && xf.trim()) return xf.split(",")[0].trim();
  if (Array.isArray(xf) && xf[0]) return String(xf[0]).split(",")[0].trim();
  return req.socket?.remoteAddress || req.ip || null;
}

function deviceFromReq(req: AuthenticatedRequest, body?: LocationPayload): DeviceContext {
  const ua =
    body?.userAgent ||
    (typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : null);
  return {
    publicIp: clientIp(req),
    userAgent: ua,
    browser: body?.browser,
    device: body?.device,
    os: body?.os,
  };
}

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function payloadFromBody(body: Record<string, unknown>): LocationPayload {
  const latitude = numOrNull(body.latitude);
  const longitude = numOrNull(body.longitude);
  console.info("[location] payloadFromBody", {
    latitude,
    longitude,
    accuracyM: numOrNull(body.accuracyM),
    source: body.source,
    city: body.city,
    hasCoords: latitude != null && longitude != null,
  });
  return {
    latitude,
    longitude,
    accuracyM: numOrNull(body.accuracyM),
    speedMps: numOrNull(body.speedMps),
    headingDeg: numOrNull(body.headingDeg),
    fullAddress: (body.fullAddress as string) || null,
    locality: (body.locality as string) || null,
    city: (body.city as string) || null,
    state: (body.state as string) || null,
    country: (body.country as string) || null,
    pincode: (body.pincode as string) || null,
    userAgent: (body.userAgent as string) || null,
    browser: (body.browser as string) || null,
    device: (body.device as string) || null,
    os: (body.os as string) || null,
    meetingId: (body.meetingId as string) || null,
    fieldSessionId: (body.fieldSessionId as string) || null,
    // Never trust client "ip" as a location source for GPS features
    source:
      body.source === "gps" && latitude != null && longitude != null
        ? "gps"
        : "unknown",
  };
}

/** POST /location/events — login/logout/heartbeat */
export async function postLocationEvent(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const body = (req.body || {}) as Record<string, unknown>;
    const eventType = String(body.eventType || "heartbeat");
    const allowed = new Set([
      "login",
      "logout",
      "heartbeat",
      "field_start",
      "field_end",
      "meeting_checkin",
      "meeting_checkout",
    ]);
    if (!allowed.has(eventType)) {
      return res.status(400).json({ success: false, error: "Invalid eventType" });
    }
    const payload = payloadFromBody(body);
    const device = deviceFromReq(req, payload);
    console.info("[location] POST /events", {
      userId: req.user.id,
      eventType,
      lat: payload.latitude,
      lng: payload.longitude,
      source: payload.source,
      ip: device.publicIp,
    });
    const event = await recordLocationEvent(req.user.id, payload, device, eventType);
    res.json({
      success: true,
      data: {
        event,
        debug: {
          receivedLat: payload.latitude,
          receivedLng: payload.longitude,
          storedSource: event.source,
          storedCity: event.city,
          storedAddress: event.fullAddress,
        },
      },
    });
  } catch (error: unknown) {
    console.error("[location] POST /events failed", error);
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to record location",
    });
  }
}

export async function postFieldStart(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const payload = payloadFromBody((req.body || {}) as Record<string, unknown>);
    console.info("[location] POST /field/start", {
      userId: req.user.id,
      lat: payload.latitude,
      lng: payload.longitude,
      source: payload.source,
    });
    const result = await startFieldWork(req.user.id, payload, deviceFromReq(req, payload));
    res.json({
      success: true,
      data: {
        ...result,
        debug: {
          receivedLat: payload.latitude,
          receivedLng: payload.longitude,
          eventSource: result.event?.source,
          eventAddress: result.event?.fullAddress,
        },
      },
    });
  } catch (error: unknown) {
    console.error("[location] field/start failed", error);
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to start field work",
    });
  }
}

export async function postFieldEnd(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const payload = payloadFromBody((req.body || {}) as Record<string, unknown>);
    const result = await endFieldWork(req.user.id, payload, deviceFromReq(req, payload));
    res.json({ success: true, data: result });
  } catch (error: unknown) {
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to end field work",
    });
  }
}

export async function postMeetingCheckIn(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const meetingId = String(req.params.meetingId || req.body?.meetingId || "");
    if (!meetingId) return res.status(400).json({ success: false, error: "meetingId required" });
    const payload = payloadFromBody((req.body || {}) as Record<string, unknown>);
    const result = await meetingCheckIn(
      req.user.id,
      meetingId,
      payload,
      deviceFromReq(req, payload)
    );
    res.json({ success: true, data: result });
  } catch (error: unknown) {
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : "Check-in failed",
    });
  }
}

export async function postMeetingCheckOut(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const meetingId = String(req.params.meetingId || req.body?.meetingId || "");
    if (!meetingId) return res.status(400).json({ success: false, error: "meetingId required" });
    const payload = payloadFromBody((req.body || {}) as Record<string, unknown>);
    const result = await meetingCheckOut(
      req.user.id,
      meetingId,
      payload,
      deviceFromReq(req, payload)
    );
    res.json({ success: true, data: result });
  } catch (error: unknown) {
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : "Check-out failed",
    });
  }
}

export async function getLiveLocations(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const data = await getLiveTeamLocations(req.user.id);
    res.json({ success: true, data });
  } catch (error: unknown) {
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed",
    });
  }
}

export async function getHistory(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const data = await getLocationHistory(req.user.id, {
      userId: req.query.userId ? String(req.query.userId) : undefined,
      from: req.query.from ? String(req.query.from) : undefined,
      to: req.query.to ? String(req.query.to) : undefined,
      eventType: req.query.eventType ? String(req.query.eventType) : undefined,
      page: req.query.page ? parseInt(String(req.query.page), 10) : 1,
      pageSize: req.query.pageSize ? parseInt(String(req.query.pageSize), 10) : 30,
    });
    res.json({ success: true, data });
  } catch (error: unknown) {
    res.status(403).json({
      success: false,
      error: error instanceof Error ? error.message : "Forbidden",
    });
  }
}

export async function getMyStatus(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const data = await getMyFieldStatus(req.user.id);
    res.json({ success: true, data });
  } catch (error: unknown) {
    res.status(500).json({ success: false, error: "Failed" });
  }
}

export async function getInsights(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const data = await getTravelInsights(
      req.user.id,
      req.query.userId ? String(req.query.userId) : undefined,
      req.query.day ? String(req.query.day) : undefined
    );
    res.json({ success: true, data });
  } catch (error: unknown) {
    res.status(403).json({
      success: false,
      error: error instanceof Error ? error.message : "Forbidden",
    });
  }
}

export async function putOffice(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const { lat, lng, address, label } = req.body as {
      lat?: number;
      lng?: number;
      address?: string;
      label?: string;
    };
    if (typeof lat !== "number" || typeof lng !== "number") {
      return res.status(400).json({ success: false, error: "lat and lng required" });
    }
    const settings = await setOfficeLocation(req.user.id, { lat, lng, address, label });
    res.json({ success: true, data: settings });
  } catch (error: unknown) {
    res.status(403).json({
      success: false,
      error: error instanceof Error ? error.message : "Forbidden",
    });
  }
}

export async function getReport(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const type = String(req.query.type || "attendance") as
      | "attendance"
      | "travel"
      | "visits"
      | "productivity"
      | "route";
    const format = String(req.query.format || "json");
    const report = await buildLocationReport(req.user.id, {
      type,
      from: req.query.from ? String(req.query.from) : undefined,
      to: req.query.to ? String(req.query.to) : undefined,
      userId: req.query.userId ? String(req.query.userId) : undefined,
    });

    if (format === "csv") {
      const csv = reportToCsv(report);
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="location-${type}-${Date.now()}.csv"`
      );
      return res.send(csv);
    }

    if (format === "xlsx") {
      const XLSX = await import("xlsx");
      const rows = report.rows || [];
      const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ message: "No data" }]);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, type.slice(0, 31));
      const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="location-${type}-${Date.now()}.xlsx"`
      );
      return res.send(buf);
    }

    if (format === "pdf") {
      const PDFDocument = (await import("pdfkit")).default;
      const doc = new PDFDocument({ margin: 40, size: "A4" });
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="location-${type}-${Date.now()}.pdf"`
      );
      doc.pipe(res);
      doc.fontSize(14).text(`Field Sales Report: ${type}`, { align: "center" });
      doc.moveDown();
      doc.fontSize(8).fillColor("#666").text(`Generated ${new Date().toISOString()}`);
      doc.moveDown();
      doc.fillColor("#000").fontSize(9);
      const rows = (report.rows || []) as Array<Record<string, unknown>>;
      if (!rows.length) {
        doc.text("No data for this period.");
      } else {
        for (const row of rows.slice(0, 200)) {
          doc.text(
            Object.entries(row)
              .map(([k, v]) => `${k}: ${v ?? ""}`)
              .join(" | ")
              .slice(0, 120)
          );
          doc.moveDown(0.3);
        }
      }
      doc.end();
      return;
    }

    res.json({ success: true, data: report });
  } catch (error: unknown) {
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : "Report failed",
    });
  }
}
