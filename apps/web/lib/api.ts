import { ApiResponse, AuthResponse, AuthUserResponse } from "@/types/api";

/** Resolved at build/runtime — never hardcode in pages. */
export const API_BASE_URL = (
  process.env.NEXT_PUBLIC_API_URL ||
  process.env.FRONTEND_API_URL ||
  "http://localhost:4000/api"
).replace(/\/$/, "");

/** Origin used for /health (strip trailing /api). */
export function getApiOrigin(): string {
  try {
    const u = new URL(API_BASE_URL);
    // If base ends with /api, health is at origin/health
    if (u.pathname.endsWith("/api") || u.pathname === "/api") {
      return u.origin;
    }
    return u.origin;
  } catch {
    return "http://localhost:4000";
  }
}

const DEFAULT_TIMEOUT_MS = 25_000;

interface RequestOptions extends RequestInit {
  token?: string;
  /** Abort after ms (default 25s). 0 = no timeout. */
  timeoutMs?: number;
}

function networkErrorMessage(err: unknown, url: string): string {
  const name = err instanceof Error ? err.name : "";
  const msg = err instanceof Error ? err.message : String(err || "Unknown error");
  // Client-side abort (timeout / navigation) — NOT "API unreachable"
  if (name === "AbortError" || /aborted|timeout/i.test(msg)) {
    return (
      `Request timed out (${url}). Large imports can take a few minutes — try again or split the file.`
    );
  }
  // Real connectivity failures only
  if (/failed to fetch|networkerror|load failed|fetch failed|network request failed/i.test(msg)) {
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      return "You appear offline. Reconnect to the internet and try again.";
    }
    return (
      `Cannot reach API at ${API_BASE_URL}. ` +
      `Check that the backend is running and NEXT_PUBLIC_API_URL is correct.`
    );
  }
  return `Network error: ${msg}`;
}

class ApiClient {
  private baseUrl: string;
  /** Last connectivity probe result (for banners). */
  lastNetworkError: string | null = null;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  get base(): string {
    return this.baseUrl;
  }

  /**
   * Lightweight health probe (does not require auth).
   * Never throws.
   */
  async checkHealth(timeoutMs = 5000): Promise<{
    ok: boolean;
    status?: number;
    error?: string;
    body?: unknown;
  }> {
    const url = `${getApiOrigin()}/health`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        method: "GET",
        signal: controller.signal,
        cache: "no-store",
      });
      const text = await response.text();
      let body: unknown = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = text?.slice(0, 200);
      }
      const ok = response.ok;
      if (!ok) {
        this.lastNetworkError = `API health returned ${response.status}`;
      } else {
        this.lastNetworkError = null;
      }
      return { ok, status: response.status, body };
    } catch (err) {
      const error = networkErrorMessage(err, url);
      this.lastNetworkError = error;
      return { ok: false, error };
    } finally {
      clearTimeout(timer);
    }
  }

  private async request<T>(
    endpoint: string,
    options: RequestOptions = {}
  ): Promise<ApiResponse<T>> {
    const { token, timeoutMs = DEFAULT_TIMEOUT_MS, ...fetchOptions } = options;

    const headers: HeadersInit = {
      "Content-Type": "application/json",
      ...(fetchOptions.headers || {}),
    };

    if (token) {
      (headers as Record<string, string>)["Authorization"] = `Bearer ${token}`;
    }

    const path = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
    const url = `${this.baseUrl}${path}`;

    const controller = new AbortController();
    const externalSignal = fetchOptions.signal;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const onExternalAbort = () => controller.abort();
    if (externalSignal) {
      if (externalSignal.aborted) controller.abort();
      else externalSignal.addEventListener("abort", onExternalAbort);
    }
    if (timeoutMs && timeoutMs > 0) {
      timer = setTimeout(() => controller.abort(), timeoutMs);
    }

    try {
      const response = await fetch(url, {
        ...fetchOptions,
        headers,
        signal: controller.signal,
        cache: fetchOptions.cache ?? "no-store",
      });

      // Guard empty / non-JSON bodies (avoids runtime crash on failed HTML/error pages)
      const text = await response.text();
      let data: Record<string, unknown> = {};
      if (text && text.trim()) {
        try {
          data = JSON.parse(text) as Record<string, unknown>;
        } catch {
          const snippet = text.slice(0, 80).replace(/\s+/g, " ");
          return {
            success: false,
            error: response.ok
              ? `Invalid JSON from API (${url}): ${snippet}`
              : `Request failed (${response.status}) at ${path}`,
          };
        }
      }

      if (!response.ok) {
        if (response.status === 401) {
          return {
            success: false,
            error: (data.error as string) || "Session expired. Please sign in again.",
            code: data.code as string | undefined,
            ...(data.data !== undefined ? { data: data.data as T } : {}),
          };
        }
        return {
          success: false,
          error: (data.error as string) || `Request failed (${response.status})`,
          code: data.code as string | undefined,
          ...(data.data !== undefined ? { data: data.data as T } : {}),
        };
      }

      this.lastNetworkError = null;
      // Normalize: some handlers return { success, data }, others raw payload
      if (data && typeof data === "object" && "success" in data) {
        return data as unknown as ApiResponse<T>;
      }
      return { success: true, data: data as T };
    } catch (error) {
      const message = networkErrorMessage(error, url);
      this.lastNetworkError = message;
      // Dev-friendly console (never throw — callers must not crash)
      if (typeof console !== "undefined") {
        console.warn(`[ApiClient] ${path}:`, message, error);
      }
      return {
        success: false,
        error: message,
      };
    } finally {
      if (timer) clearTimeout(timer);
      if (externalSignal) {
        externalSignal.removeEventListener("abort", onExternalAbort);
      }
    }
  }

  // Auth endpoints
  async register(
    email: string,
    password: string,
    name?: string,
    opts?: { businessName?: string; templateSlug?: string; industryLabel?: string }
  ) {
    return this.request<AuthResponse>("/auth/register", {
      method: "POST",
      body: JSON.stringify({
        email,
        password,
        name,
        businessName: opts?.businessName,
        templateSlug: opts?.templateSlug,
        industryLabel: opts?.industryLabel,
      }),
    });
  }

  async getIndustryCatalog() {
    return this.get<{
      templates: Array<{ slug: string; name: string; description: string | null; category: string | null }>;
    }>("/templates/catalog");
  }

  async listBusinessUsers(token: string) {
    return this.get<{
      businessId: string;
      users: Array<{
        id: string;
        email: string;
        name: string | null;
        role: string;
        membershipRole?: string;
        isDisabled?: boolean;
        status?: "active" | "disabled";
        isOwner?: boolean;
        createdAt?: string;
        lastLoginAt?: string | null;
        activeSessions?: number;
        deviceCount?: number;
        passwordChangedAt?: string | null;
      }>;
    }>("/business-users", token);
  }

  async createBusinessUser(
    body: { email: string; password: string; name?: string; role: string },
    token: string
  ) {
    return this.post<{ user: { id: string; email: string; name: string | null; role: string }; created: boolean }>(
      "/business-users",
      body,
      token
    );
  }

  async updateBusinessUser(
    userId: string,
    body: { name?: string | null; email?: string; role?: string; password?: string },
    token: string
  ) {
    return this.put<{ user: { id: string; email: string; name: string | null; role: string; isDisabled: boolean } }>(
      `/business-users/${userId}`,
      body,
      token
    );
  }

  async setBusinessUserDisabled(userId: string, disabled: boolean, token: string) {
    return this.post<{ userId: string; isDisabled: boolean }>(
      `/business-users/${userId}/disable`,
      { disabled },
      token
    );
  }

  async deleteBusinessUser(userId: string, token: string) {
    return this.request<{ userId: string; userDeleted: boolean }>(`/business-users/${userId}`, {
      method: "DELETE",
      token,
    });
  }

  async listAssignableRoles(token: string) {
    return this.get<{ roles: Array<{ key: string; label: string }> }>("/business-users/roles", token);
  }

  async updateBusinessUserRole(userId: string, role: string, token: string) {
    return this.put<{ userId: string; role: string }>(`/business-users/${userId}/role`, { role }, token);
  }

  /** Customer portal forgot password */
  async forgotPassword(email: string) {
    return this.request<{ message: string }>("/auth/forgot-password", {
      method: "POST",
      body: JSON.stringify({ email }),
    });
  }

  async validateResetToken(token: string) {
    return this.get<{ valid: boolean; portal?: string; emailHint?: string }>(
      `/auth/reset-password/validate?token=${encodeURIComponent(token)}`
    );
  }

  async resetPassword(body: { token: string; password: string; confirmPassword: string }) {
    return this.request<{ message: string }>("/auth/reset-password", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  /** Super Admin forgot password */
  async platformForgotPassword(email: string) {
    return this.request<{ message: string }>("/platform/auth/forgot-password", {
      method: "POST",
      body: JSON.stringify({ email }),
    });
  }

  async platformValidateResetToken(token: string) {
    return this.get<{ valid: boolean; portal?: string; emailHint?: string }>(
      `/platform/auth/reset-password/validate?token=${encodeURIComponent(token)}`
    );
  }

  async platformResetPassword(body: {
    token: string;
    password: string;
    confirmPassword: string;
  }) {
    return this.request<{ message: string }>("/platform/auth/reset-password", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  async login(
    email: string,
    password: string,
    opts?: { forceNewSession?: boolean }
  ) {
    return this.request<AuthResponse>("/auth/login", {
      method: "POST",
      body: JSON.stringify({
        email,
        password,
        forceNewSession: !!opts?.forceNewSession,
      }),
    });
  }

  async logout(token: string) {
    return this.request<{ message: string }>("/auth/logout", {
      method: "POST",
      token,
    });
  }

  async getSecurityDashboard(token: string) {
    return this.get<{
      activeSessions: Array<Record<string, unknown>>;
      loginHistory: Array<Record<string, unknown>>;
      devices: Array<Record<string, unknown>>;
      failedLoginsLast7Days: number;
      users: Array<Record<string, unknown>>;
      sessionPolicy: { plan: string; maxConcurrentSessions: number };
      currentSessionId: string | null;
    }>("/security/dashboard", token);
  }

  async getMySecurity(token: string) {
    return this.get<Record<string, unknown>>("/security/me", token);
  }

  async terminateSession(sessionId: string, token: string) {
    return this.request<{ terminated: string }>(`/security/sessions/${sessionId}`, {
      method: "DELETE",
      token,
    });
  }

  async terminateOtherSessions(token: string, userId?: string) {
    return this.post<{ terminated: number }>(
      "/security/sessions/terminate-others",
      userId ? { userId } : {},
      token
    );
  }

  async getCurrentUser(token: string) {
    return this.request<AuthUserResponse>("/auth/me", {
      method: "GET",
      token,
    });
  }

  // Profile endpoints
  async getProfile(token: string) {
    return this.request<{ profile: unknown }>("/profile", {
      method: "GET",
      token,
    });
  }

  async updateProfile(data: Record<string, unknown>, token: string) {
    return this.request<{ profile: unknown }>("/profile", {
      method: "PUT",
      body: JSON.stringify(data),
      token,
    });
  }

  // Health Score endpoints
  async getHealthScore(token: string) {
    return this.request<{ score: unknown; recent: unknown[] }>("/health-score", {
      method: "GET",
      token,
    });
  }

  async recalculateHealthScore(token: string) {
    return this.request<{ score: unknown }>("/health-score/recalculate", {
      method: "POST",
      token,
    });
  }

  // SWOT endpoints
  async generateSWOT(token: string) {
    return this.request<{ swot: unknown }>("/swot/generate", {
      method: "POST",
      token,
    });
  }

  async getLatestSWOT(token: string) {
    return this.request<{ swot: unknown }>("/swot/latest", {
      method: "GET",
      token,
    });
  }

  // Mentor (AI Chat) endpoints
  async sendMentorMessage(message: string, token: string) {
    return this.request<{ message: unknown; usage?: unknown }>("/mentor/chat", {
      method: "POST",
      body: JSON.stringify({ message }),
      token,
    });
  }

  async getMentorHistory(token: string) {
    return this.request<{ messages: unknown[] }>("/mentor/history", {
      method: "GET",
      token,
    });
  }

  // Roadmap endpoints
  async generateRoadmap(token: string) {
    return this.request<{ roadmap: unknown }>("/roadmap/generate", {
      method: "POST",
      token,
    });
  }

  async getRoadmap(token: string) {
    return this.request<{ roadmap: unknown }>("/roadmap", {
      method: "GET",
      token,
    });
  }

  // Marketing AI endpoints
  async generateMarketing(inputs: Record<string, unknown>, token: string) {
    return this.request<{ inputs: Record<string, unknown>; result: unknown }>("/marketing/generate", {
      method: "POST",
      body: JSON.stringify(inputs),
      token,
    });
  }

  // CRM endpoints (Phase 3)
  /** Enterprise bulk edit leads — POST /api/leads/bulk-edit */
  async bulkEditLeads(
    body: { ids: string[]; patch: Record<string, unknown> },
    token?: string | null
  ) {
    return this.post<{ updated: number; failed: number; ids: string[] }>(
      "/leads/bulk-edit",
      body,
      token
    );
  }

  /** Soft-delete (trash) or permanent purge — POST /api/leads/bulk-delete */
  async bulkDeleteLeads(
    body: { ids: string[]; permanent?: boolean },
    token?: string | null
  ) {
    return this.post<{ deleted: number; failed: number; ids: string[]; permanent: boolean }>(
      "/leads/bulk-delete",
      body,
      token
    );
  }

  /** Undo soft-delete — POST /api/leads/bulk-restore */
  async bulkRestoreLeads(body: { ids: string[] }, token?: string | null) {
    return this.post<{ restored: number; failed: number }>("/leads/bulk-restore", body, token);
  }

  async getCrmContacts(query: string = "", token?: string | null) {
    const endpoint = query ? `/crm/contacts${query.startsWith("?") ? query : "?" + query}` : "/crm/contacts";
    return this.request<unknown>(endpoint, { method: "GET", token: token ?? undefined });
  }

  async createCrmContact(data: Record<string, unknown>, token?: string | null) {
    return this.request<unknown>("/crm/contacts", { method: "POST", body: JSON.stringify(data), token: token ?? undefined });
  }

  async getCrmContact(id: string, token?: string | null) {
    return this.request<unknown>(`/crm/contacts/${id}`, { method: "GET", token: token ?? undefined });
  }

  async updateCrmContact(id: string, data: Record<string, unknown>, token?: string | null) {
    return this.request<unknown>(`/crm/contacts/${id}`, { method: "PUT", body: JSON.stringify(data), token: token ?? undefined });
  }

  async deleteCrmContact(id: string, token?: string | null) {
    return this.request<unknown>(`/crm/contacts/${id}`, { method: "DELETE", token: token ?? undefined });
  }

  async getCrmDeals(query: string = "", token?: string | null) {
    const endpoint = query ? `/crm/deals${query.startsWith("?") ? query : "?" + query}` : "/crm/deals";
    return this.request<unknown>(endpoint, { method: "GET", token: token ?? undefined });
  }

  async createCrmDeal(data: Record<string, unknown>, token?: string | null) {
    return this.request<unknown>("/crm/deals", { method: "POST", body: JSON.stringify(data), token: token ?? undefined });
  }

  async updateCrmDeal(id: string, data: Record<string, unknown>, token?: string | null) {
    return this.request<unknown>(`/crm/deals/${id}`, { method: "PUT", body: JSON.stringify(data), token: token ?? undefined });
  }

  async deleteCrmDeal(id: string, token?: string | null) {
    return this.request<unknown>(`/crm/deals/${id}`, { method: "DELETE", token: token ?? undefined });
  }

  async getCrmTasks(query: string = "", token?: string | null) {
    const endpoint = query ? `/crm/tasks${query.startsWith("?") ? query : "?" + query}` : "/crm/tasks";
    return this.request<unknown>(endpoint, { method: "GET", token: token ?? undefined });
  }

  async createCrmTask(data: Record<string, unknown>, token?: string | null) {
    return this.request<unknown>("/crm/tasks", { method: "POST", body: JSON.stringify(data), token: token ?? undefined });
  }

  async updateCrmTask(id: string, data: Record<string, unknown>, token?: string | null) {
    return this.request<unknown>(`/crm/tasks/${id}`, { method: "PUT", body: JSON.stringify(data), token: token ?? undefined });
  }

  async deleteCrmTask(id: string, token?: string | null) {
    return this.request<unknown>(`/crm/tasks/${id}`, { method: "DELETE", token: token ?? undefined });
  }

  async getCrmMeetings(query: string = "", token?: string | null) {
    const endpoint = query ? `/crm/meetings${query.startsWith("?") ? query : "?" + query}` : "/crm/meetings";
    return this.request<unknown>(endpoint, { method: "GET", token: token ?? undefined });
  }

  async createCrmMeeting(data: Record<string, unknown>, token?: string | null) {
    return this.request<unknown>("/crm/meetings", { method: "POST", body: JSON.stringify(data), token: token ?? undefined });
  }

  async updateCrmMeeting(id: string, data: Record<string, unknown>, token?: string | null) {
    return this.request<unknown>(`/crm/meetings/${id}`, { method: "PUT", body: JSON.stringify(data), token: token ?? undefined });
  }

  async deleteCrmMeeting(id: string, token?: string | null) {
    return this.request<unknown>(`/crm/meetings/${id}`, { method: "DELETE", token: token ?? undefined });
  }

  async getCrmNotes(query: string = "", token?: string | null) {
    const endpoint = query ? `/crm/notes${query.startsWith("?") ? query : "?" + query}` : "/crm/notes";
    return this.request<unknown>(endpoint, { method: "GET", token: token ?? undefined });
  }

  async createCrmNote(data: Record<string, unknown>, token?: string | null) {
    return this.request<unknown>("/crm/notes", { method: "POST", body: JSON.stringify(data), token: token ?? undefined });
  }

  async updateCrmNote(id: string, data: Record<string, unknown>, token?: string | null) {
    return this.request<unknown>(`/crm/notes/${id}`, { method: "PUT", body: JSON.stringify(data), token: token ?? undefined });
  }

  async deleteCrmNote(id: string, token?: string | null) {
    return this.request<unknown>(`/crm/notes/${id}`, { method: "DELETE", token: token ?? undefined });
  }

  async getCrmDocuments(query: string = "", token?: string | null) {
    const endpoint = query ? `/crm/documents${query.startsWith("?") ? query : "?" + query}` : "/crm/documents";
    return this.request<unknown>(endpoint, { method: "GET", token: token ?? undefined });
  }

  async createCrmDocument(data: Record<string, unknown>, token?: string | null) {
    return this.request<unknown>("/crm/documents", { method: "POST", body: JSON.stringify(data), token: token ?? undefined });
  }

  async updateCrmDocument(id: string, data: Record<string, unknown>, token?: string | null) {
    return this.request<unknown>(`/crm/documents/${id}`, { method: "PUT", body: JSON.stringify(data), token: token ?? undefined });
  }

  async deleteCrmDocument(id: string, token?: string | null) {
    return this.request<unknown>(`/crm/documents/${id}`, { method: "DELETE", token: token ?? undefined });
  }

  // Generic methods for future use




  async get<T>(endpoint: string, token?: string | null) {
    return this.request<T>(endpoint, {
      method: "GET",
      token: token ?? undefined,
    });
  }

  async post<T>(endpoint: string, body: unknown, token?: string | null) {
    return this.request<T>(endpoint, {
      method: "POST",
      body: JSON.stringify(body),
      token: token ?? undefined,
    });
  }

  /**
   * Multipart file upload (CSV/Excel import). Do not set Content-Type manually. Never throws.
   * Large imports use a long timeout so the browser does not abort mid-write and show a false
   * "Cannot reach API" error after the server already imported rows.
   */
  async postFormData<T>(
    endpoint: string,
    formData: FormData,
    token?: string | null,
    opts?: { timeoutMs?: number }
  ): Promise<ApiResponse<T>> {
    const headers: HeadersInit = {};
    if (token) {
      (headers as Record<string, string>)["Authorization"] = `Bearer ${token}`;
    }
    const path = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    // 5 minutes default for bulk import (450+ rows); preview can pass a shorter timeout
    const timeoutMs = opts?.timeoutMs ?? 300_000;
    const timer =
      timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : undefined;
    try {
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: formData,
        signal: controller.signal,
        cache: "no-store",
      });
      const text = await response.text();
      let data: Record<string, unknown> = {};
      if (text?.trim()) {
        try {
          data = JSON.parse(text) as Record<string, unknown>;
        } catch {
          // Nginx HTML error pages etc. — not a JSON body
          if (response.ok) {
            return {
              success: false,
              error: `Import finished but response was not JSON (HTTP ${response.status}). Refresh the leads table to confirm rows.`,
            };
          }
          return {
            success: false,
            error: `Upload failed (HTTP ${response.status}). ${text.slice(0, 120).replace(/\s+/g, " ")}`,
          };
        }
      }
      if (!response.ok) {
        return {
          success: false,
          error: (data.error as string) || `Upload failed (${response.status})`,
          ...(data.data !== undefined ? { data: data.data as T } : {}),
        };
      }
      this.lastNetworkError = null;
      // Normalize { success, data } wrappers
      if (data && typeof data === "object" && "success" in data) {
        return data as unknown as ApiResponse<T>;
      }
      return { success: true, data: data as T };
    } catch (error) {
      const isAbort =
        error instanceof Error &&
        (error.name === "AbortError" || /aborted|timeout/i.test(error.message));
      // Multipart imports often finish server-side after the browser loses the socket.
      // Never report that as "Cannot reach API" — import callers re-verify via list refresh.
      const message = isAbort
        ? `Upload timed out after ${Math.round(timeoutMs / 1000)}s. The server may still have saved the file — refresh the list to verify.`
        : typeof navigator !== "undefined" && navigator.onLine === false
          ? "You appear offline. Reconnect and try again."
          : `Upload connection interrupted (${path}). The server may still have processed the file — refresh the list to verify.`;
      // Do not flip global connectivity banner for long upload transport glitches
      console.warn("[ApiClient] formData:", message, error);
      return {
        success: false,
        error: message,
      };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async previewImportFile(file: File, token: string) {
    const fd = new FormData();
    fd.append("file", file);
    return this.postFormData<{
      headers: string[];
      sampleRows: Record<string, string>[];
      parsedRows: number;
      suggestions: Array<{
        sourceHeader: string;
        fieldKey: string | null;
        confidence: "high" | "medium" | "low" | "none";
        sampleValues: string[];
      }>;
      crmFields: Array<{ key: string; label: string; required: boolean }>;
      nameMapped: boolean;
      phoneMapped: boolean;
      emailMapped: boolean;
      needsWizard: boolean;
      allowedStatuses: string[];
      autoMappings: Array<{ sourceHeader: string; fieldKey: string }>;
      message?: string;
    }>("/reports/import/preview", fd, token, { timeoutMs: 90_000 });
  }

  async importContactsFile(
    file: File,
    token: string,
    opts?: {
      mappings?: Array<{ sourceHeader: string; fieldKey: string }>;
      saveMapping?: boolean;
      updateExisting?: boolean;
    }
  ) {
    const fd = new FormData();
    fd.append("file", file);
    if (opts?.mappings?.length) {
      fd.append("mappings", JSON.stringify(opts.mappings));
    }
    if (opts?.saveMapping !== undefined) {
      fd.append("saveMapping", opts.saveMapping ? "true" : "false");
    }
    if (opts?.updateExisting !== undefined) {
      fd.append("updateExisting", opts.updateExisting ? "true" : "false");
    }
    // Long timeout: server may process hundreds of rows before responding
    return this.postFormData<{
      parsedRows: number;
      imported: number;
      updated?: number;
      skippedDuplicates: number;
      failed: number;
      skippedEmpty?: number;
      errors?: {
        row: number;
        column?: string;
        reason: string;
        suggestedFix?: string;
        detectedColumns?: string[];
      }[];
      report?: string;
      allowedStatuses?: string[];
      needsMapping?: boolean;
      mappingPreview?: unknown;
    }>("/reports/import/file", fd, token, { timeoutMs: 300_000 });
  }

  /** Active business config (fields, pipelines, modules, AI pack, …) */
  async getBusinessConfig(token: string) {
    return this.get<{
      business: {
        id: string;
        name: string;
        templateId: string | null;
        templateSlug: string | null;
        templateVersion: number | null;
      };
      config: {
        version: number;
        modules: unknown;
        fields: unknown;
        pipelines: unknown;
        dashboards: unknown;
        reports: unknown;
        automations: unknown;
        notifications: unknown;
        aiPromptPack: unknown;
        roles: unknown;
        importMappings: unknown;
      } | null;
    }>("/templates/config/current", token);
  }

  async listIndustryTemplates(token: string) {
    return this.get<{ templates: Array<{ id: string; slug: string; name: string; category: string | null }> }>(
      "/templates",
      token
    );
  }

  async installIndustryTemplate(
    body: { templateSlug?: string; templateId?: string; replaceExisting?: boolean },
    token: string
  ) {
    return this.post<{
      templateSlug: string;
      fieldCount: number;
      moduleCount: number;
    }>("/templates/install", body, token);
  }

  /** Role portal: menus, actions, home, permissions (config-driven).
   * Optional previewRole: Business Admin workspace role switch (not user switch).
   */
  async getCurrentPortal(token: string, previewRole?: string | null) {
    const q = previewRole ? `?role=${encodeURIComponent(previewRole)}` : "";
    return this.get<{
      portalKey: string;
      portalLabel: string;
      description?: string;
      role: string;
      actualRole: string;
      platformRole: string;
      permissions: string[];
      businessId: string;
      businessName: string;
      homeRoute: string;
      defaultDashboardKey: string;
      menus: Array<{
        key: string;
        label: string;
        route: string;
        order: number;
        enabled: boolean;
        permissions?: string[];
      }>;
      actions: Array<{
        key: string;
        label: string;
        type: string;
        route?: string;
        featureKey?: string;
        permission?: string;
      }>;
      dashboardKeys: string[];
      reportKeys: string[];
      canSwitchWorkspace: boolean;
      isWorkspacePreview: boolean;
      workspaceRoles: Array<{ key: string; label: string }>;
      aiFeatures: Array<{ key: string; label: string; output: string }>;
    }>(`/portal/current${q}`, token);
  }

  async put<T>(endpoint: string, body: unknown, token?: string | null) {
    return this.request<T>(endpoint, {
      method: "PUT",
      body: JSON.stringify(body),
      token: token ?? undefined,
    });
  }

  // —— Super Admin platform APIs (portal=admin JWT only) ——
  async platformLogin(email: string, password: string) {
    return this.request<{
      user: { id: string; email: string; name: string | null; platformRole?: string };
      token: string;
      portal: "admin";
    }>("/platform/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
  }

  async platformMe(token: string) {
    return this.get<{ user: { id: string; email: string; platformRole?: string }; portal: string }>(
      "/platform/auth/me",
      token
    );
  }

  async platformAnalytics(token: string) {
    return this.get<Record<string, unknown>>("/platform/analytics", token);
  }

  async platformHealth(token: string) {
    return this.get<Record<string, unknown>>("/platform/health", token);
  }

  async platformAudit(token: string) {
    return this.get<unknown[]>("/platform/audit", token);
  }

  async platformListBusinesses(
    token: string,
    q?: { search?: string; status?: string; plan?: string; page?: number; pageSize?: number }
  ) {
    const params = new URLSearchParams();
    if (q?.search) params.set("search", q.search);
    if (q?.status) params.set("status", q.status);
    if (q?.plan) params.set("plan", q.plan);
    if (q?.page) params.set("page", String(q.page));
    if (q?.pageSize) params.set("pageSize", String(q.pageSize));
    const qs = params.toString() ? `?${params}` : "";
    return this.get<{
      total: number;
      page: number;
      pageSize: number;
      totalPages: number;
      businesses: Array<Record<string, unknown>>;
    }>(`/platform/businesses${qs}`, token);
  }

  async platformBulkAction(body: Record<string, unknown>, token: string) {
    return this.post<{
      action: string;
      total: number;
      success: number;
      failed: number;
      results: Array<{ id: string; name: string; ok: boolean; error?: string }>;
    }>("/platform/businesses/bulk", body, token);
  }

  async platformUsageDashboard(token: string) {
    return this.get<{
      kpis: Record<string, number | string | null>;
      charts: {
        dailyUsage: Array<{ date: string; count: number }>;
        monthlyUsage: Array<{ month: string; count: number }>;
        loginTrend: Array<{ date: string; count: number }>;
        aiRequests: Array<{ date: string; count: number }>;
      };
      businesses: Array<Record<string, unknown>>;
    }>("/platform/usage-dashboard", token);
  }

  async platformEvents(token: string) {
    return this.get<
      Array<{ id: string; time: string; event: string; severity: string; module: string }>
    >("/platform/events", token);
  }

  async platformAddUser(businessId: string, body: Record<string, unknown>, token: string) {
    return this.post(`/platform/businesses/${businessId}/users`, body, token);
  }

  async platformDisableUser(
    businessId: string,
    userId: string,
    disabled: boolean,
    token: string
  ) {
    return this.post(`/platform/businesses/${businessId}/users/${userId}/disable`, { disabled }, token);
  }

  async platformResetUserPassword(
    businessId: string,
    userId: string,
    password: string,
    token: string
  ) {
    return this.post(
      `/platform/businesses/${businessId}/users/${userId}/reset-password`,
      { password },
      token
    );
  }

  async platformExportBusiness(businessId: string, token: string) {
    return this.get<Record<string, unknown>>(`/platform/businesses/${businessId}/export`, token);
  }

  async platformGetBusiness(id: string, token: string) {
    return this.get<Record<string, unknown>>(`/platform/businesses/${id}`, token);
  }

  async platformCreateBusiness(body: Record<string, unknown>, token: string) {
    return this.post<Record<string, unknown>>("/platform/businesses", body, token);
  }

  async platformSuspendBusiness(id: string, reason: string, token: string) {
    return this.post(`/platform/businesses/${id}/suspend`, { reason }, token);
  }

  async platformActivateBusiness(id: string, token: string) {
    return this.post(`/platform/businesses/${id}/activate`, {}, token);
  }

  async platformDeleteBusiness(id: string, token: string) {
    return this.request(`/platform/businesses/${id}`, { method: "DELETE", token });
  }

  async platformChangePlan(
    id: string,
    body: { action: string; plan: string; days?: number },
    token: string
  ) {
    return this.post(`/platform/businesses/${id}/plan`, body, token);
  }

  async platformWhiteLabel(id: string, whiteLabel: Record<string, unknown>, token: string) {
    return this.put(`/platform/businesses/${id}/white-label`, { whiteLabel }, token);
  }

  async platformUsage(id: string, token: string) {
    return this.get<Record<string, unknown>>(`/platform/businesses/${id}/usage`, token);
  }

  async platformListInvoices(token: string, businessId?: string) {
    const qs = businessId ? `?businessId=${encodeURIComponent(businessId)}` : "";
    return this.get<unknown[]>(`/platform/invoices${qs}`, token);
  }

  async platformCreateInvoice(body: Record<string, unknown>, token: string) {
    return this.post("/platform/invoices", body, token);
  }

  async platformMarkInvoicePaid(id: string, token: string) {
    return this.post(`/platform/invoices/${id}/paid`, {}, token);
  }

  async platformListLicenses(token: string, filter?: string) {
    const qs = filter ? `?filter=${encodeURIComponent(filter)}` : "";
    return this.get<unknown[]>(`/platform/licenses${qs}`, token);
  }

  async platformListTickets(token: string, status?: string) {
    const qs = status ? `?status=${encodeURIComponent(status)}` : "";
    return this.get<unknown[]>(`/platform/tickets${qs}`, token);
  }

  async platformCreateTicket(body: Record<string, unknown>, token: string) {
    return this.post("/platform/tickets", body, token);
  }

  async platformUpdateTicket(id: string, status: string, token: string) {
    return this.request(`/platform/tickets/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
      token,
    });
  }

  // —— Enterprise backups (Super Admin) ——
  async platformListBackups(token: string, q?: { type?: string; businessId?: string }) {
    const params = new URLSearchParams();
    if (q?.type) params.set("type", q.type);
    if (q?.businessId) params.set("businessId", q.businessId);
    const qs = params.toString() ? `?${params}` : "";
    return this.get<{ backups: Array<Record<string, unknown>> }>(`/platform/backups${qs}`, token);
  }

  async platformCreateBackup(
    body: { type: "full" | "business"; businessId?: string },
    token: string
  ) {
    return this.post<{ id: string; status: string }>("/platform/backups", body, token);
  }

  async platformGetBackup(id: string, token: string) {
    return this.get<Record<string, unknown>>(`/platform/backups/${id}`, token);
  }

  async platformVerifyBackup(id: string, token: string) {
    return this.post<{ ok: boolean; detail: string }>(`/platform/backups/${id}/verify`, {}, token);
  }

  async platformDeleteBackup(id: string, token: string) {
    return this.request<{ deleted: boolean }>(`/platform/backups/${id}`, {
      method: "DELETE",
      token,
    });
  }

  async platformRequestRestore(
    id: string,
    body: { scope: "full" | "business"; businessId?: string; confirmPhrase?: string },
    token: string
  ) {
    return this.post<{
      restoreId: string;
      confirmationToken: string;
      expiresAt: string;
      message?: string;
    }>(`/platform/backups/${id}/restore`, body, token);
  }

  async platformConfirmRestore(restoreId: string, confirmationToken: string, token: string) {
    return this.post<{ status: string }>(
      `/platform/restores/${restoreId}/confirm`,
      { confirmationToken },
      token
    );
  }

  async platformListRestores(token: string) {
    return this.get<{ restores: Array<Record<string, unknown>> }>("/platform/restores", token);
  }

  async platformListBackupSchedules(token: string) {
    return this.get<{ schedules: Array<Record<string, unknown>> }>(
      "/platform/backup-schedules",
      token
    );
  }

  async platformUpsertBackupSchedule(body: Record<string, unknown>, token: string) {
    return this.request<{ schedule: Record<string, unknown> }>("/platform/backup-schedules", {
      method: "PUT",
      body: JSON.stringify(body),
      token,
    });
  }

  /** Tenant business backups */
  async listTenantBackups(token: string) {
    return this.get<{ backups: Array<Record<string, unknown>> }>("/backups", token);
  }

  async createTenantBackup(token: string) {
    return this.post<{ id: string; status: string }>("/backups", {}, token);
  }

  async requestTenantRestore(id: string, token: string) {
    return this.post<{ restoreId: string; confirmationToken: string; expiresAt: string }>(
      `/backups/${id}/restore`,
      {},
      token
    );
  }

  async confirmTenantRestore(restoreId: string, confirmationToken: string, token: string) {
    return this.post<{ status: string }>(
      `/backups/restores/${restoreId}/confirm`,
      { confirmationToken },
      token
    );
  }

  async platformSupportLoginAs(businessId: string, reason: string, token: string) {
    return this.post<{
      token: string;
      targetEmail: string;
      businessName: string;
      warning: string;
    }>("/platform/support/login-as", { businessId, reason }, token);
  }

  // —— Demo portal APIs ——
  async demoLogin(email: string, password: string) {
    return this.request<{
      user: { id: string; email: string; name: string | null; businessId?: string };
      token: string;
      portal: "demo";
    }>("/demo/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
  }

  async demoInfo() {
    return this.get<{
      portal: string;
      message: string;
      loginHint: { email: string; password: string };
      features: string[];
    }>("/demo/info");
  }

  async demoMe(token: string) {
    return this.get<Record<string, unknown>>("/demo/auth/me", token);
  }

  async demoReset(token: string) {
    return this.post("/demo/reset", {}, token);
  }
}

export const api = new ApiClient(API_BASE_URL);
