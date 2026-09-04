/**
 * Firebase Cloud Messaging (FCM) provider — Android first.
 *
 * Credentials (never commit secrets):
 * - FIREBASE_SERVICE_ACCOUNT_PATH  → path to service account JSON
 * - OR FIREBASE_SERVICE_ACCOUNT_JSON → inline JSON string
 * - Optional FIREBASE_PROJECT_ID override
 *
 * When unset, isConfigured()=false and send() is a safe no-op (logged).
 */
import fs from "node:fs";
import type { PushMessage, PushProvider, PushSendResult } from "./push-provider.js";

type FirebaseAdminModule = {
  apps: unknown[];
  app: (name?: string) => { delete: () => Promise<void> };
  initializeApp: (options?: { credential: unknown; projectId?: string }, name?: string) => unknown;
  credential: { cert: (serviceAccount: object) => unknown };
  messaging: (app?: unknown) => {
    send: (message: {
      token: string;
      notification?: { title: string; body: string };
      data?: Record<string, string>;
      android?: { priority: string };
    }) => Promise<string>;
  };
};

let adminMod: FirebaseAdminModule | null | undefined;
let initAttempted = false;
let initError: string | null = null;

function readServiceAccount(): { projectId?: string; account: object } | null {
  const inline = (process.env.FIREBASE_SERVICE_ACCOUNT_JSON || "").trim();
  if (inline) {
    try {
      const account = JSON.parse(inline) as object;
      const projectId =
        (process.env.FIREBASE_PROJECT_ID || "").trim() ||
        (account as { project_id?: string }).project_id;
      return { projectId, account };
    } catch {
      initError = "FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON";
      return null;
    }
  }
  const path = (process.env.FIREBASE_SERVICE_ACCOUNT_PATH || "").trim();
  if (path) {
    try {
      const raw = fs.readFileSync(path, "utf8");
      const account = JSON.parse(raw) as object;
      const projectId =
        (process.env.FIREBASE_PROJECT_ID || "").trim() ||
        (account as { project_id?: string }).project_id;
      return { projectId, account };
    } catch (e) {
      initError = `Failed to read FIREBASE_SERVICE_ACCOUNT_PATH: ${e instanceof Error ? e.message : String(e)}`;
      return null;
    }
  }
  return null;
}

async function ensureFirebase(): Promise<FirebaseAdminModule | null> {
  if (initAttempted) return adminMod ?? null;
  initAttempted = true;

  const sa = readServiceAccount();
  if (!sa) {
    adminMod = null;
    return null;
  }

  try {
    // Dynamic import so API boots without firebase-admin if unused
    const mod = (await import("firebase-admin")) as unknown as FirebaseAdminModule & {
      default?: FirebaseAdminModule;
    };
    const admin = (mod.default || mod) as FirebaseAdminModule;
    if (!admin.apps?.length) {
      admin.initializeApp({
        credential: admin.credential.cert(sa.account),
        projectId: sa.projectId,
      });
    }
    adminMod = admin;
    initError = null;
    return admin;
  } catch (e) {
    initError = e instanceof Error ? e.message : String(e);
    adminMod = null;
    return null;
  }
}

const INVALID_CODES = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
  "messaging/invalid-argument",
]);

export class FcmPushProvider implements PushProvider {
  readonly name = "fcm";

  isConfigured(): boolean {
    if (adminMod) return true;
    const hasCreds = !!(
      (process.env.FIREBASE_SERVICE_ACCOUNT_JSON || "").trim() ||
      (process.env.FIREBASE_SERVICE_ACCOUNT_PATH || "").trim()
    );
    return hasCreds;
  }

  getInitError(): string | null {
    return initError;
  }

  async send(token: string, message: PushMessage): Promise<PushSendResult> {
    const admin = await ensureFirebase();
    if (!admin) {
      if (process.env.NODE_ENV !== "production") {
        console.info(
          `[push:fcm] skip (not configured)${initError ? `: ${initError}` : ""} title=${message.title}`
        );
      }
      return { ok: false, error: initError || "fcm_not_configured" };
    }

    try {
      const id = await admin.messaging().send({
        token,
        notification: { title: message.title, body: message.body },
        data: message.data,
        android: { priority: "high" },
      });
      return { ok: true, providerMessageId: id };
    } catch (e: unknown) {
      const err = e as { code?: string; message?: string };
      const code = err?.code || "";
      const msg = err?.message || String(e);
      const invalidToken = INVALID_CODES.has(code) || /not.?registered|invalid.?token/i.test(msg);
      return { ok: false, invalidToken, error: `${code || "fcm_error"}: ${msg}`.slice(0, 500) };
    }
  }
}

export const fcmPushProvider = new FcmPushProvider();
