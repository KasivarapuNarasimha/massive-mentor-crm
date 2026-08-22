import { PORTAL_TOKENS, PORTAL_USER_KEYS } from "@/lib/portal-config";

type DemoAuthUser = {
  id: string;
  email: string;
  name: string | null;
  businessId?: string;
};

/** Persist demo portal tokens for the shared CRM shell. */
export function persistDemoSession(data: { token: string; user: DemoAuthUser }) {
  localStorage.setItem(PORTAL_TOKENS.demo, data.token);
  localStorage.setItem(PORTAL_USER_KEYS.demo, JSON.stringify(data.user));
  // CRM shell currently reads the customer token key for /dashboard APIs.
  localStorage.setItem(PORTAL_TOKENS.customer, data.token);
  localStorage.setItem(PORTAL_USER_KEYS.customer, JSON.stringify(data.user));
  localStorage.setItem("massive_mentor_demo_mode", "1");
}
