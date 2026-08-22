import { PORTAL_TOKENS, PORTAL_USER_KEYS } from "@/lib/portal-config";

/** Cookie checked by middleware on demo.massivementor.in for /dashboard access. */
export const DEMO_SESSION_COOKIE = "mm_demo_session";

type DemoAuthUser = {
  id: string;
  email: string;
  name: string | null;
  businessId?: string;
};

function setDemoSessionCookie(token: string) {
  // Readable by Next middleware (not httpOnly). API still validates the JWT.
  const maxAge = 60 * 60 * 24 * 7;
  const secure =
    typeof window !== "undefined" && window.location.protocol === "https:"
      ? "; Secure"
      : "";
  document.cookie = `${DEMO_SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${maxAge}; SameSite=Lax${secure}`;
}

export function clearDemoSessionCookie() {
  if (typeof document === "undefined") return;
  document.cookie = `${DEMO_SESSION_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
}

/** Persist demo portal tokens for the shared CRM shell. */
export function persistDemoSession(data: { token: string; user: DemoAuthUser }) {
  localStorage.setItem(PORTAL_TOKENS.demo, data.token);
  localStorage.setItem(PORTAL_USER_KEYS.demo, JSON.stringify(data.user));
  // CRM shell currently reads the customer token key for /dashboard APIs.
  localStorage.setItem(PORTAL_TOKENS.customer, data.token);
  localStorage.setItem(PORTAL_USER_KEYS.customer, JSON.stringify(data.user));
  localStorage.setItem("massive_mentor_demo_mode", "1");
  setDemoSessionCookie(data.token);
}

export function clearDemoSession() {
  try {
    localStorage.removeItem(PORTAL_TOKENS.demo);
    localStorage.removeItem(PORTAL_USER_KEYS.demo);
    localStorage.removeItem("massive_mentor_demo_mode");
  } catch {
    /* ignore */
  }
  clearDemoSessionCookie();
}

/** Client-side helper: are we in demo mode? */
export function isDemoModeClient(): boolean {
  try {
    return localStorage.getItem("massive_mentor_demo_mode") === "1";
  } catch {
    return false;
  }
}
