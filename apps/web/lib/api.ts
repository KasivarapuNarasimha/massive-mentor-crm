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
  /**
   * In-flight GET dedupe: identical authenticated GETs share one network call.
   * Prevents dashboard providers from stampeding the same endpoint 3–5×.
   */
  private getInflight = new Map<string, Promise<ApiResponse<unknown>>>();
  /** Short TTL cache so sequential callers (layout then PlanProvider) reuse results. */
  private getRecent = new Map<string, { at: number; promise: Promise<ApiResponse<unknown>> }>();
  private static GET_CACHE_TTL_MS = 5_000;

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
  /**
   * Connectivity probe for the API process.
   * Prefers lightweight /ready (incident evidence: /health can stall while /ready still works).
   * Falls back to /health. Any HTTP response means the process is reachable.
   */
  async checkHealth(timeoutMs = 10_000): Promise<{
    /** Process reachable (any HTTP response) OR fully healthy */
    ok: boolean;
    /** Explicit readiness when known */
    ready?: boolean;
    status?: number;
    error?: string;
    body?: unknown;
    /** Round-trip latency of the successful probe path (ms) */
    latencyMs?: number;
    /** Class hint for UI: timeout | offline | restarting | unavailable */
    failureKind?: "timeout" | "offline" | "restarting" | "unavailable" | "unknown";
  }> {
    const origin = getApiOrigin();
    const probe = async (path: string) => {
      const url = `${origin}${path}`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const t0 =
        typeof performance !== "undefined" ? performance.now() : Date.now();
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
        const latencyMs = Math.round(
          (typeof performance !== "undefined" ? performance.now() : Date.now()) -
            t0
        );
        return { url, response, body, latencyMs };
      } finally {
        clearTimeout(timer);
      }
    };

    try {
      // 1) /ready first — cheaper; stayed up when /health stalled
      try {
        const r = await probe("/ready");
        const body = r.body as { ready?: boolean } | null;
        const readyOk = r.response.ok && body?.ready !== false;
        if (readyOk) {
          this.lastNetworkError = null;
          return {
            ok: true,
            ready: true,
            status: r.response.status,
            body: r.body,
            latencyMs: r.latencyMs,
          };
        }
        // Process up, dependencies not ready (e.g. DB restarting)
        if (r.response.status > 0) {
          this.lastNetworkError = `API not ready (HTTP ${r.response.status})`;
          return {
            ok: false,
            ready: false,
            status: r.response.status,
            body: r.body,
            latencyMs: r.latencyMs,
            error: `API not ready (HTTP ${r.response.status})`,
            failureKind: "restarting",
          };
        }
      } catch (e) {
        const name = e instanceof Error ? e.name : "";
        if (name === "AbortError") {
          this.lastNetworkError = `Request timed out (${origin}/ready)`;
          return {
            ok: false,
            error: this.lastNetworkError,
            failureKind: "timeout",
          };
        }
        // fall through to /health
      }

      try {
        const h = await probe("/health");
        const body = h.body as { status?: string; database?: string } | null;
        if (h.response.status > 0) {
          const healthy =
            h.response.ok &&
            body?.status !== "degraded" &&
            body?.database !== "down";
          if (healthy) {
            this.lastNetworkError = null;
            return {
              ok: true,
              ready: true,
              status: h.response.status,
              body: h.body,
              latencyMs: h.latencyMs,
            };
          }
          this.lastNetworkError = `API health returned ${h.response.status}`;
          return {
            ok: false,
            ready: false,
            status: h.response.status,
            body: h.body,
            latencyMs: h.latencyMs,
            error: this.lastNetworkError,
            failureKind: "restarting",
          };
        }
      } catch (e) {
        const name = e instanceof Error ? e.name : "";
        if (name === "AbortError") {
          this.lastNetworkError = `Request timed out (${origin}/health)`;
          return {
            ok: false,
            error: this.lastNetworkError,
            failureKind: "timeout",
          };
        }
        throw e;
      }

      this.lastNetworkError = `Cannot reach API at ${origin}`;
      return {
        ok: false,
        error: this.lastNetworkError,
        failureKind: "unavailable",
      };
    } catch (err) {
      const error = networkErrorMessage(err, `${origin}/ready`);
      this.lastNetworkError = error;
      const failureKind =
        typeof navigator !== "undefined" && navigator.onLine === false
          ? ("offline" as const)
          : /timeout|aborted/i.test(error)
            ? ("timeout" as const)
            : ("unavailable" as const);
      return { ok: false, error, failureKind };
    }
  }

  private async request<T>(
    endpoint: string,
    options: RequestOptions = {}
  ): Promise<ApiResponse<T>> {
    const { token, timeoutMs = DEFAULT_TIMEOUT_MS, ...fetchOptions } = options;
    const method = String(fetchOptions.method || "GET").toUpperCase();

    const headers: HeadersInit = {
      "Content-Type": "application/json",
      ...(fetchOptions.headers || {}),
    };

    if (token) {
      (headers as Record<string, string>)["Authorization"] = `Bearer ${token}`;
    }

    const path = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
    const url = `${this.baseUrl}${path}`;

    // Share in-flight + recent GETs (no custom AbortSignal) across providers/components.
    const canDedupe = method === "GET" && !fetchOptions.signal;
    if (canDedupe) {
      const key = `GET:${url}:auth:${token ? token.slice(-24) : "anon"}`;
      const existing = this.getInflight.get(key);
      if (existing) {
        return existing as Promise<ApiResponse<T>>;
      }
      const recent = this.getRecent.get(key);
      if (recent && Date.now() - recent.at < ApiClient.GET_CACHE_TTL_MS) {
        return recent.promise as Promise<ApiResponse<T>>;
      }
      const shared = this.executeRequest<T>(url, path, {
        ...fetchOptions,
        method,
        headers,
        token,
        timeoutMs,
      })
        .then((res) => {
          // Only reuse successful responses briefly; never cache 429/errors.
          if (res.success) {
            this.getRecent.set(key, {
              at: Date.now(),
              promise: Promise.resolve(res) as Promise<ApiResponse<unknown>>,
            });
          } else {
            this.getRecent.delete(key);
          }
          return res;
        })
        .finally(() => {
          if (this.getInflight.get(key) === shared) {
            this.getInflight.delete(key);
          }
        });
      this.getInflight.set(key, shared as Promise<ApiResponse<unknown>>);
      return shared;
    }

    return this.executeRequest<T>(url, path, {
      ...fetchOptions,
      method,
      headers,
      token,
      timeoutMs,
    });
  }

  private async executeRequest<T>(
    url: string,
    path: string,
    options: RequestOptions & { headers: HeadersInit; method: string }
  ): Promise<ApiResponse<T>> {
    const { timeoutMs = DEFAULT_TIMEOUT_MS, headers, method, token: _ignoredToken, ...fetchOptions } =
      options;
    void _ignoredToken;

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
        method,
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
            status: 401,
            ...(data.data !== undefined ? { data: data.data as T } : {}),
          };
        }
        return {
          success: false,
          error: (data.error as string) || `Request failed (${response.status})`,
          code: data.code as string | undefined,
          status: response.status,
          planLabel: typeof data.planLabel === "string" ? data.planLabel : undefined,
          dailyLimit: typeof data.dailyLimit === "number" ? data.dailyLimit : undefined,
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
    return this.request<{ message: string; delivered?: boolean; mode?: string }>(
      "/auth/forgot-password",
      {
        method: "POST",
        body: JSON.stringify({ email }),
      }
    );
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

  /** Persist appearance preference (light | dark | system) — CRM customer token */
  async patchThemePreference(theme: string, token: string) {
    return this.request<{ themePreference: string }>("/auth/theme", {
      method: "PATCH",
      body: JSON.stringify({ theme }),
      token,
    });
  }

  /** Super Admin portal — same User.themePreference, platform JWT */
  async platformPatchThemePreference(theme: string, token: string) {
    return this.request<{ themePreference: string }>("/platform/auth/theme", {
      method: "PATCH",
      body: JSON.stringify({ theme }),
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

  /**
   * Soft-delete (trash) or permanent purge — POST /api/leads/bulk-delete
   * scope: "ids" (default) uses body.ids
   * scope: "all_filtered" deletes every lead matching search/status (all pages, up to 50k)
   * Long timeout: 50k rows @ 1k batches can exceed the default 25s client abort.
   */
  async bulkDeleteLeads(
    body: {
      ids?: string[];
      permanent?: boolean;
      scope?: "ids" | "all_filtered";
      search?: string;
      status?: string;
    },
    token?: string | null
  ) {
    return this.post<{
      deleted: number;
      failed: number;
      ids: string[];
      permanent: boolean;
      scope?: string;
      matched?: number;
    }>("/leads/bulk-delete", body, token, { timeoutMs: 600_000 });
  }

  /**
   * Bulk assign leads — POST /api/leads/bulk-assign
   * scope: "ids" | "first_n" | "all_filtered"
   * Long timeout for large filtered sets (up to 50k).
   */
  async bulkAssignLeads(
    body: {
      assignedTo?: string;
      /** single | all_members */
      assignMode?: "single" | "all_members";
      mode?: "single" | "all_members";
      /**
       * Optional subset for equal distribution (all_members).
       * Final confirm-modal remaining member IDs — backend distributes only to these.
       */
      assigneeIds?: string[];
      scope: "ids" | "first_n" | "all_filtered" | "reassign";
      ids?: string[];
      limit?: number;
      search?: string;
      status?: string;
      /** Filter which leads to assign (current assignee / "unassigned") */
      filterAssignedTo?: string;
      notes?: string;
      dryRun?: boolean;
      preview?: boolean;
    },
    token?: string | null
  ) {
    return this.post<{
      assigned: number;
      failed: number;
      matched: number;
      requested: number;
      scope: string;
      mode?: string;
      limit: number | null;
      assignedTo: string | null;
      assigneeName: string | null;
      ids: string[];
      distribution?: Array<{
        userId: string;
        name: string | null;
        email: string;
        count: number;
      }>;
      assignmentId?: string | null;
      sequence?: number | null;
      dryRun?: boolean;
    }>("/leads/bulk-assign", body, token, { timeoutMs: 600_000 });
  }

  async listAssignableMembers(token?: string | null) {
    return this.get<{
      members: Array<{
        id: string;
        name: string | null;
        email: string;
        phone: string | null;
        employeeCode: string | null;
        username: string | null;
        role: string;
      }>;
    }>("/leads/assignable-members", token);
  }

  /** Live assigned/unassigned + per-member lead counts (tenant-scoped) */
  async getLeadAssignmentSummary(token?: string | null) {
    return this.get<{
      totalLeads: number;
      assignedLeads: number;
      unassignedLeads: number;
      byMember: Array<{
        userId: string | null;
        name: string;
        email: string | null;
        count: number;
      }>;
    }>("/leads/assignment-summary", token);
  }

  /** Admin team CRM activity rollup (real tracked metrics only; calls unavailable) */
  async getMemberActivitySummary(token?: string | null, sinceDays = 30) {
    const q = sinceDays ? `?sinceDays=${encodeURIComponent(String(sinceDays))}` : "";
    return this.get<{
      sinceDays: number;
      since: string;
      unavailableMetrics: Array<{ key: string; reason: string }>;
      byMember: Array<{
        userId: string;
        name: string;
        email: string | null;
        role: string | null;
        leadsAssigned: number;
        leadsUpdated: number;
        followUpsCompleted: number;
        meetings: number;
        emailsSent: number;
        whatsappActions: number;
        callsMade: null;
      }>;
      totals: {
        leadsAssigned: number;
        leadsUpdated: number;
        followUpsCompleted: number;
        meetings: number;
        emailsSent: number;
        whatsappActions: number;
      };
    }>(`/leads/member-activity-summary${q}`, token);
  }

  /** Admin lead visibility search — reuses CRM contact list filters */
  async adminLeadVisibilitySearch(
    token: string | null | undefined,
    params: {
      status?: string;
      assignedTo?: string;
      search?: string;
      sinceDays?: number;
      page?: number;
      pageSize?: number;
    }
  ) {
    const q = new URLSearchParams();
    if (params.status) q.set("status", params.status);
    if (params.assignedTo) q.set("assignedTo", params.assignedTo);
    if (params.search) q.set("search", params.search);
    if (params.sinceDays != null) q.set("sinceDays", String(params.sinceDays));
    if (params.page) q.set("page", String(params.page));
    if (params.pageSize) q.set("pageSize", String(params.pageSize));
    const qs = q.toString();
    return this.get<{
      total: number;
      page: number;
      pageSize: number;
      items: Array<{
        id: string;
        name: string;
        company: string | null;
        status: string;
        assignedToId: string | null;
        assignedToName: string | null;
        lastActivityAt: string | null;
        nextFollowUp: string | null;
        phone: string | null;
        updatedAt: string;
      }>;
    }>(`/leads/admin-visibility-search${qs ? `?${qs}` : ""}`, token);
  }

  async sendTeamDailyReport(token: string | null | undefined, force = false) {
    return this.post<{ sent: number; skipped?: string }>(
      "/leads/team-daily-report/send",
      { force },
      token
    );
  }

  async listLeadAssignments(
    token?: string | null,
    q?: { page?: number; pageSize?: number }
  ) {
    const params = new URLSearchParams();
    if (q?.page) params.set("page", String(q.page));
    if (q?.pageSize) params.set("pageSize", String(q.pageSize));
    const qs = params.toString() ? `?${params}` : "";
    return this.get<{
      total: number;
      page: number;
      pageSize: number;
      items: Array<{
        id: string;
        sequence: number;
        actorUserId: string;
        actorName: string | null;
        mode: string;
        scope: string;
        leadCount: number;
        memberCount: number;
        distribution: unknown;
        status: string;
        notes: string | null;
        createdAt: string;
        lines: Array<{
          userId: string;
          userName: string | null;
          userEmail: string | null;
          leadCount: number;
        }>;
      }>;
    }>(`/leads/assignments${qs}`, token);
  }

  async getLeadAssignment(id: string, token?: string | null) {
    return this.get<Record<string, unknown>>(`/leads/assignments/${id}`, token);
  }

  async moveLeadAssignment(
    id: string,
    body: { fromUserId: string; toUserId: string; count: number; notes?: string },
    token?: string | null
  ) {
    return this.post<Record<string, unknown>>(
      `/leads/assignments/${id}/move`,
      body,
      token,
      { timeoutMs: 300_000 }
    );
  }

  // —— Media Library ——
  async listMediaFolders(token?: string | null) {
    return this.get<{ folders: Array<Record<string, unknown>> }>("/media/folders", token);
  }
  async createMediaFolder(body: { name: string; parentId?: string | null }, token?: string | null) {
    return this.post<{ folder: Record<string, unknown> }>("/media/folders", body, token);
  }
  async getMediaStats(token?: string | null) {
    return this.get<{
      totalFiles: number;
      storageBytes: number;
      storageUsedLabel: string;
      byKind: {
        brochures: number;
        images: number;
        videos: number;
        pdfs: number;
        documents: number;
      };
      kindBreakdown: Record<string, number>;
      recent: Array<{
        id: string;
        name: string;
        kind: string;
        sizeBytes: number;
        createdAt: string;
        mimeType: string;
      }>;
      mostDownloaded: { id: string; name: string; count: number } | null;
      mostShared: {
        id: string;
        name: string;
        whatsapp: number;
        email: number;
      } | null;
      totalWhatsAppShares: number;
      totalEmailShares: number;
    }>("/media/stats", token);
  }
  async getMediaCount(token?: string | null) {
    return this.get<{ total: number }>("/media/count", token);
  }
  async listMediaAssets(
    token?: string | null,
    q?: {
      folderId?: string;
      search?: string;
      kind?: string;
      uploadedBy?: string;
      tag?: string;
      favorites?: boolean;
      includeArchived?: boolean;
      approvalStatus?: string;
      shareableOnly?: boolean;
      page?: number;
      pageSize?: number;
    }
  ) {
    const params = new URLSearchParams();
    if (q?.folderId != null) params.set("folderId", q.folderId);
    if (q?.search) params.set("search", q.search);
    if (q?.kind) params.set("kind", q.kind);
    if (q?.uploadedBy) params.set("uploadedBy", q.uploadedBy);
    if (q?.tag) params.set("tag", q.tag);
    if (q?.favorites) params.set("favorites", "1");
    if (q?.includeArchived) params.set("includeArchived", "1");
    if (q?.approvalStatus) params.set("approvalStatus", q.approvalStatus);
    if (q?.shareableOnly) params.set("shareableOnly", "1");
    if (q?.page) params.set("page", String(q.page));
    if (q?.pageSize) params.set("pageSize", String(q.pageSize));
    const qs = params.toString() ? `?${params}` : "";
    return this.get<{
      assets: Array<Record<string, unknown>>;
      items?: Array<Record<string, unknown>>;
      total: number;
      page: number;
      pageSize: number;
      totalPages: number;
    }>(`/media/assets${qs}`, token);
  }
  async getMediaAsset(id: string, token?: string | null) {
    return this.get<{ asset: Record<string, unknown> }>(`/media/assets/${id}`, token);
  }
  async toggleMediaFavorite(id: string, token?: string | null) {
    return this.post<{ favorited: boolean }>(`/media/assets/${id}/favorite`, {}, token);
  }
  async updateMediaTags(id: string, tags: string[], token?: string | null) {
    return this.post<{ asset: Record<string, unknown> }>(
      `/media/assets/${id}/tags`,
      { tags },
      token
    );
  }
  async moveMediaAsset(id: string, folderId: string | null, token?: string | null) {
    return this.post<{ asset: Record<string, unknown> }>(
      `/media/assets/${id}/move`,
      { folderId },
      token
    );
  }
  async recordMediaDownload(id: string, token?: string | null) {
    return this.post<{ ok: boolean }>(`/media/assets/${id}/download`, {}, token);
  }
  async uploadMediaAsset(
    file: File,
    opts: {
      folderId?: string;
      name?: string;
      captionDefault?: string;
      tags?: string[];
      approvalStatus?: "pending" | "approved";
      expiresAt?: string | null;
      duplicateAction?: "replace" | "keep_both" | "skip";
      replaceAssetId?: string | null;
    },
    token?: string | null
  ) {
    const fd = new FormData();
    fd.append("file", file);
    if (opts.folderId) fd.append("folderId", opts.folderId);
    if (opts.name) fd.append("name", opts.name);
    if (opts.captionDefault) fd.append("captionDefault", opts.captionDefault);
    if (opts.tags?.length) fd.append("tags", JSON.stringify(opts.tags));
    if (opts.approvalStatus) fd.append("approvalStatus", opts.approvalStatus);
    if (opts.expiresAt) fd.append("expiresAt", opts.expiresAt);
    if (opts.duplicateAction) fd.append("duplicateAction", opts.duplicateAction);
    if (opts.replaceAssetId) fd.append("replaceAssetId", opts.replaceAssetId);
    return this.postFormData<{
      asset: Record<string, unknown>;
      skipped?: boolean;
      code?: string;
      data?: { duplicates?: Array<Record<string, unknown>>; contentHash?: string };
    }>("/media/assets", fd, token, { timeoutMs: 120_000 });
  }

  async bulkUploadMediaAssets(
    files: File[],
    opts: {
      folderId?: string;
      duplicateAction?: "replace" | "keep_both" | "skip";
      approvalStatus?: "pending" | "approved";
    },
    token?: string | null
  ) {
    const fd = new FormData();
    for (const f of files) fd.append("files", f);
    if (opts.folderId) fd.append("folderId", opts.folderId);
    if (opts.duplicateAction) fd.append("duplicateAction", opts.duplicateAction);
    if (opts.approvalStatus) fd.append("approvalStatus", opts.approvalStatus);
    return this.postFormData<{
      results: Array<{
        fileName: string;
        ok: boolean;
        skipped?: boolean;
        asset?: Record<string, unknown>;
        error?: string;
        code?: string;
      }>;
      uploaded: number;
      skipped: number;
      failed: number;
      total: number;
    }>("/media/assets/bulk", fd, token, { timeoutMs: 600_000 });
  }

  async listMediaCollections(token?: string | null) {
    return this.get<{
      collections: Array<{
        key: string;
        name: string;
        description: string;
        icon: string;
        count: number;
      }>;
    }>("/media/collections", token);
  }

  async listMediaCollectionAssets(
    key: string,
    token?: string | null,
    q?: { page?: number; pageSize?: number }
  ) {
    const params = new URLSearchParams();
    if (q?.page) params.set("page", String(q.page));
    if (q?.pageSize) params.set("pageSize", String(q.pageSize));
    const qs = params.toString() ? `?${params}` : "";
    return this.get<{
      assets: Array<Record<string, unknown>>;
      items?: Array<Record<string, unknown>>;
      total: number;
      collection: string;
    }>(`/media/collections/${encodeURIComponent(key)}${qs}`, token);
  }

  async recommendMediaForContact(contactId: string, token?: string | null) {
    return this.get<{
      contact: Record<string, unknown>;
      dealStages: string[];
      serviceHints: string[];
      suggestions: Array<Record<string, unknown> & { score?: number; reasons?: string[] }>;
    }>(`/media/recommend/${encodeURIComponent(contactId)}`, token);
  }

  async aiSearchMedia(query: string, token?: string | null) {
    const qs = `?q=${encodeURIComponent(query)}`;
    return this.get<{
      query: string;
      tokens: string[];
      totalMatched: number;
      items: Array<Record<string, unknown> & { relevance?: number }>;
    }>(`/media/ai-search${qs}`, token);
  }

  async getMediaStorageDashboard(token?: string | null) {
    return this.get<Record<string, unknown>>("/media/storage", token);
  }

  async purgeDeletedMedia(assetIds?: string[], token?: string | null) {
    return this.post<{ purged: number }>("/media/storage/purge", { assetIds }, token);
  }

  async processMediaExpiry(token?: string | null) {
    return this.post<{ archived: number; checked: number }>(
      "/media/storage/process-expiry",
      {},
      token
    );
  }

  async getMediaVersions(assetId: string, token?: string | null) {
    return this.get<{
      current: Record<string, unknown>;
      versions: Array<Record<string, unknown>>;
    }>(`/media/assets/${assetId}/versions`, token);
  }

  async restoreMediaVersion(
    assetId: string,
    versionId: string,
    token?: string | null
  ) {
    return this.post<{ asset: Record<string, unknown> }>(
      `/media/assets/${assetId}/versions/restore`,
      { versionId },
      token
    );
  }

  async setMediaApproval(
    assetId: string,
    status: "approved" | "rejected" | "pending",
    reason?: string,
    token?: string | null
  ) {
    return this.post<{ asset: Record<string, unknown> }>(
      `/media/assets/${assetId}/approve`,
      { status, reason },
      token
    );
  }

  async setMediaExpiry(
    assetId: string,
    expiresAt: string | null,
    token?: string | null
  ) {
    return this.post<{ asset: Record<string, unknown> }>(
      `/media/assets/${assetId}/expiry`,
      { expiresAt },
      token
    );
  }

  async archiveMediaAsset(assetId: string, reason?: string, token?: string | null) {
    return this.post<{ asset: Record<string, unknown> }>(
      `/media/assets/${assetId}/archive`,
      { reason },
      token
    );
  }

  async unarchiveMediaAsset(assetId: string, token?: string | null) {
    return this.post<{ asset: Record<string, unknown> }>(
      `/media/assets/${assetId}/unarchive`,
      {},
      token
    );
  }

  async createMediaShareLink(
    assetId: string,
    body: { expiresInDays?: number; password?: string; maxDownloads?: number },
    token?: string | null
  ) {
    return this.post<{
      link: {
        id: string;
        token: string;
        path: string;
        expiresAt: string;
        hasPassword: boolean;
      };
    }>(`/media/assets/${assetId}/share-links`, body, token);
  }

  async listMediaShareLinks(assetId: string, token?: string | null) {
    return this.get<{ links: Array<Record<string, unknown>> }>(
      `/media/assets/${assetId}/share-links`,
      token
    );
  }

  async revokeMediaShareLink(linkId: string, token?: string | null) {
    return this.request<{ revoked: boolean }>(`/media/share-links/${linkId}`, {
      method: "DELETE",
      token: token ?? undefined,
    });
  }

  async getMediaTimeline(assetId: string, token?: string | null) {
    return this.get<{
      assetId: string;
      items: Array<{
        id: string;
        at: string;
        action: string;
        actorName: string | null;
        detail: string | null;
        source: string;
      }>;
    }>(`/media/assets/${assetId}/timeline`, token);
  }
  async deleteMediaAsset(id: string, token?: string | null) {
    return this.request<{ deleted: boolean }>(`/media/assets/${id}`, {
      method: "DELETE",
      token: token ?? undefined,
    });
  }
  async renameMediaAsset(id: string, name: string, token?: string | null) {
    return this.request<{ asset: Record<string, unknown> }>(`/media/assets/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ name }),
      token: token ?? undefined,
    });
  }
  async sendMediaWhatsApp(
    body: { contactId: string; assetIds: string[]; caption?: string; kitId?: string },
    token?: string | null
  ) {
    return this.post<{
      mode?: "basic" | "enterprise";
      sent: number;
      failed: number;
      results: Array<{ assetId: string; assetName: string; ok: boolean; status: string; error?: string }>;
      contact: { id: string; name: string; phone: string };
      uiHint?: string;
      basic?: {
        mode: "basic";
        status: string;
        waUrl: string;
        phone: string;
        message: string;
        contactId: string | null;
        contactName: string | null;
        logIds: string[];
        files: Array<{ assetId: string; name: string; downloadPath: string }>;
        uiHint?: string;
      };
    }>("/media/send/whatsapp", body, token, { timeoutMs: 300_000 });
  }

  /** Current WhatsApp Basic vs Enterprise effective mode. */
  async getWhatsAppMode(token?: string | null) {
    return this.get<{
      mode: "basic" | "enterprise";
      preferredMode: "basic" | "enterprise";
      enterpriseConnected: boolean;
      label: string;
      description: string;
    }>("/integrations/whatsapp/mode", token);
  }

  async setWhatsAppPreferredMode(
    preferredMode: "basic" | "enterprise",
    token?: string | null
  ) {
    return this.post<{
      mode: "basic" | "enterprise";
      preferredMode: "basic" | "enterprise";
      enterpriseConnected: boolean;
      label: string;
      description: string;
    }>("/integrations/whatsapp/preferred-mode", { preferredMode }, token);
  }

  /** Confirm manual send after Basic Mode opened wa.me. */
  async confirmBasicWhatsAppSend(
    body: {
      sent: boolean;
      contactId?: string | null;
      logIds?: string[];
      phone?: string;
    },
    token?: string | null
  ) {
    return this.post<{ ok: boolean; status: string }>(
      "/integrations/whatsapp/basic/confirm",
      body,
      token
    );
  }

  async sendWhatsAppMessage(
    body: {
      to: string;
      message: string;
      contactId?: string;
      templateName?: string;
      templateParams?: string[];
    },
    token?: string | null
  ) {
    return this.post<{
      success?: boolean;
      mode?: "basic" | "enterprise";
      status?: string;
      messageId?: string;
      uiHint?: string;
      basic?: {
        waUrl: string;
        phone: string;
        message: string;
        contactId: string | null;
        logIds: string[];
        files?: Array<{ assetId: string; name: string; downloadPath: string }>;
      };
    }>("/integrations/whatsapp/send", body, token);
  }
  async listMediaKits(token?: string | null) {
    return this.get<{ kits: Array<Record<string, unknown>> }>("/media/kits", token);
  }
  async createMediaKit(
    body: {
      name: string;
      description?: string;
      captionTemplate?: string;
      assetIds: string[];
    },
    token?: string | null
  ) {
    return this.post<{ kit: Record<string, unknown> }>("/media/kits", body, token);
  }
  async deleteMediaKit(id: string, token?: string | null) {
    return this.request<{ deleted: boolean }>(`/media/kits/${id}`, {
      method: "DELETE",
      token: token ?? undefined,
    });
  }
  async sendMediaKitWhatsApp(
    kitId: string,
    body: { contactId: string; caption?: string },
    token?: string | null
  ) {
    return this.post<Record<string, unknown>>(
      `/media/kits/${kitId}/send/whatsapp`,
      body,
      token,
      { timeoutMs: 300_000 }
    );
  }
  async listMediaActivity(
    token?: string | null,
    q?: { page?: number; pageSize?: number; contactId?: string }
  ) {
    const params = new URLSearchParams();
    if (q?.page) params.set("page", String(q.page));
    if (q?.pageSize) params.set("pageSize", String(q.pageSize));
    if (q?.contactId) params.set("contactId", q.contactId);
    const qs = params.toString() ? `?${params}` : "";
    return this.get<{
      total: number;
      items: Array<Record<string, unknown>>;
    }>(`/media/activity${qs}`, token);
  }

  mediaFileUrl(assetId: string): string {
    return `${this.baseUrl}/media/assets/${assetId}/file`;
  }

  // —— WhatsApp caption templates & messaging polish ——
  async listCaptionTemplates(
    token?: string | null,
    q?: { category?: string; scope?: "all" | "global" | "personal" }
  ) {
    const params = new URLSearchParams();
    if (q?.category) params.set("category", q.category);
    if (q?.scope) params.set("scope", q.scope);
    const qs = params.toString() ? `?${params}` : "";
    return this.get<{
      categories: string[];
      templates: Array<Record<string, unknown>>;
    }>(`/media/caption-templates${qs}`, token);
  }
  async createCaptionTemplate(
    body: {
      name: string;
      body: string;
      category?: string;
      language?: string;
      isGlobal?: boolean;
    },
    token?: string | null
  ) {
    return this.post<{ template: Record<string, unknown> }>(
      "/media/caption-templates",
      body,
      token
    );
  }
  async updateCaptionTemplate(
    id: string,
    body: { name?: string; body?: string; category?: string; language?: string },
    token?: string | null
  ) {
    return this.request<{ template: Record<string, unknown> }>(
      `/media/caption-templates/${id}`,
      { method: "PATCH", body: JSON.stringify(body), token: token ?? undefined }
    );
  }
  async deleteCaptionTemplate(id: string, token?: string | null) {
    return this.request<{ deleted: boolean }>(`/media/caption-templates/${id}`, {
      method: "DELETE",
      token: token ?? undefined,
    });
  }
  async useCaptionTemplate(id: string, token?: string | null) {
    return this.post<{ template: Record<string, unknown> }>(
      `/media/caption-templates/${id}/use`,
      {},
      token
    );
  }
  async recentCaptionTemplates(token?: string | null) {
    return this.get<{ templates: Array<Record<string, unknown>> }>(
      "/media/caption-templates/recent",
      token
    );
  }
  async improveCaption(caption: string, token?: string | null) {
    return this.post<{ text: string }>(
      "/media/caption/improve",
      { caption },
      token,
      { timeoutMs: 60_000 }
    );
  }
  async translateCaption(
    caption: string,
    language: "en" | "te" | "hi",
    token?: string | null
  ) {
    return this.post<{ text: string; language: string }>(
      "/media/caption/translate",
      { caption, language },
      token,
      { timeoutMs: 60_000 }
    );
  }
  async getMessagingSettings(token?: string | null) {
    return this.get<{
      autoSignatureEnabled: boolean;
      signatureEnabled: boolean;
      signature: string;
      defaultSignature: string;
      canManageAutoSignature: boolean;
    }>("/media/messaging-settings", token);
  }
  async updateMessagingSettings(
    body: {
      signature?: string;
      signatureEnabled?: boolean;
      autoSignatureEnabled?: boolean;
    },
    token?: string | null
  ) {
    return this.request<Record<string, unknown>>("/media/messaging-settings", {
      method: "PATCH",
      body: JSON.stringify(body),
      token: token ?? undefined,
    });
  }

  // —— WhatsApp Conversation Center ——
  async listWaConversations(
    token?: string | null,
    q?: {
      search?: string;
      status?: string;
      assignedTo?: string;
      unreadOnly?: boolean;
      label?: string;
      page?: number;
      pageSize?: number;
    }
  ) {
    const params = new URLSearchParams();
    if (q?.search) params.set("search", q.search);
    if (q?.status) params.set("status", q.status);
    if (q?.assignedTo) params.set("assignedTo", q.assignedTo);
    if (q?.unreadOnly) params.set("unreadOnly", "1");
    if (q?.label) params.set("label", q.label);
    if (q?.page) params.set("page", String(q.page));
    if (q?.pageSize) params.set("pageSize", String(q.pageSize));
    const qs = params.toString() ? `?${params}` : "";
    return this.get<Record<string, unknown>>(`/whatsapp/conversations${qs}`, token);
  }

  async waSetLabels(id: string, labels: string[], token?: string | null) {
    return this.post(`/whatsapp/conversations/${id}/labels`, { labels }, token);
  }
  async waTogglePin(id: string, token?: string | null) {
    return this.post(`/whatsapp/conversations/${id}/pin`, {}, token);
  }
  async waSnooze(
    id: string,
    body: { preset?: string; until?: string },
    token?: string | null
  ) {
    return this.post(`/whatsapp/conversations/${id}/snooze`, body, token);
  }
  async waReact(messageId: string, emoji: string, token?: string | null) {
    return this.post(`/whatsapp/messages/${messageId}/react`, { emoji }, token);
  }
  async waSetTyping(id: string, isTyping: boolean, token?: string | null) {
    return this.post(`/whatsapp/conversations/${id}/typing`, { isTyping }, token);
  }
  async waGetTyping(id: string, token?: string | null) {
    return this.get<{ agents: Array<{ userId: string; name: string }> }>(
      `/whatsapp/conversations/${id}/typing`,
      token
    );
  }
  async waMerge(primaryId: string, secondaryId: string, token?: string | null) {
    return this.post(
      `/whatsapp/conversations/${primaryId}/merge`,
      { secondaryId },
      token
    );
  }
  waExportUrl(id: string, format: string): string {
    return `${this.base}/whatsapp/conversations/${id}/export?format=${format}`;
  }
  async waMarkSpam(id: string, block: boolean, token?: string | null) {
    return this.post(`/whatsapp/conversations/${id}/spam`, { block }, token);
  }
  async waTranscribe(messageId: string, token?: string | null) {
    return this.post(`/whatsapp/messages/${messageId}/transcribe`, {}, token);
  }
  async waListRules(token?: string | null) {
    return this.get<{ rules: Array<Record<string, unknown>> }>("/whatsapp/rules", token);
  }
  async waSaveRule(body: Record<string, unknown>, token?: string | null) {
    return this.post("/whatsapp/rules", body, token);
  }
  async waGetSla(token?: string | null) {
    return this.get<Record<string, unknown>>("/whatsapp/sla", token);
  }
  async waUpdateSla(body: Record<string, unknown>, token?: string | null) {
    return this.request("/whatsapp/sla", {
      method: "PATCH",
      body: JSON.stringify(body),
      token: token ?? undefined,
    });
  }
  async waListBroadcasts(token?: string | null) {
    return this.get<{ broadcasts: Array<Record<string, unknown>> }>(
      "/whatsapp/broadcasts",
      token
    );
  }
  async waCreateBroadcast(body: Record<string, unknown>, token?: string | null) {
    return this.post("/whatsapp/broadcasts", body, token, { timeoutMs: 300_000 });
  }
  async getWaConversation(id: string, token?: string | null) {
    return this.get<Record<string, unknown>>(`/whatsapp/conversations/${id}`, token);
  }
  async listWaMessages(id: string, token?: string | null, page = 1) {
    return this.get<{
      items: Array<Record<string, unknown>>;
      total: number;
      page: number;
      totalPages: number;
    }>(`/whatsapp/conversations/${id}/messages?page=${page}&pageSize=80`, token);
  }
  async sendWaMessage(id: string, body: string, token?: string | null) {
    return this.post<Record<string, unknown>>(
      `/whatsapp/conversations/${id}/messages`,
      { body },
      token
    );
  }
  async addWaNote(id: string, body: string, token?: string | null) {
    return this.post<Record<string, unknown>>(
      `/whatsapp/conversations/${id}/notes`,
      { body },
      token
    );
  }
  async assignWaConversation(id: string, assignedToUserId: string, token?: string | null) {
    return this.post<Record<string, unknown>>(
      `/whatsapp/conversations/${id}/assign`,
      { assignedToUserId },
      token
    );
  }
  async setWaConversationStatus(id: string, status: string, token?: string | null) {
    return this.post<Record<string, unknown>>(
      `/whatsapp/conversations/${id}/status`,
      { status },
      token
    );
  }
  async waFollowUp(id: string, dueAt: string, title?: string, token?: string | null) {
    return this.post<Record<string, unknown>>(
      `/whatsapp/conversations/${id}/follow-up`,
      { dueAt, title },
      token
    );
  }
  async waAiReplies(id: string, token?: string | null) {
    return this.get<{ suggestions: string[] }>(
      `/whatsapp/conversations/${id}/ai-replies`,
      token
    );
  }
  async waSummarize(id: string, token?: string | null) {
    return this.post<Record<string, unknown>>(
      `/whatsapp/conversations/${id}/summarize`,
      {},
      token,
      { timeoutMs: 60_000 }
    );
  }
  async waMedia(id: string, token?: string | null) {
    return this.get<Record<string, unknown>>(`/whatsapp/conversations/${id}/media`, token);
  }
  async waTimeline(id: string, token?: string | null) {
    return this.get<{ items: Array<Record<string, unknown>> }>(
      `/whatsapp/conversations/${id}/timeline`,
      token
    );
  }
  async waDashboard(token?: string | null) {
    return this.get<Record<string, unknown>>("/whatsapp/dashboard", token);
  }
  async waAgents(token?: string | null) {
    return this.get<{ agents: Array<Record<string, unknown>> }>("/whatsapp/agents", token);
  }
  async openWaForContact(contactId: string, token?: string | null) {
    return this.post<{ conversationId: string; phone: string }>(
      "/whatsapp/conversations/open",
      { contactId },
      token
    );
  }

  /** Compose + send email to lead(s) via platform SMTP — POST /api/leads/send-email */
  async sendLeadEmail(
    body: {
      contactIds: string[];
      to?: string;
      subject: string;
      body: string;
    },
    token?: string | null
  ) {
    return this.post<{
      sent: number;
      failed: number;
      results: Array<{ id: string; ok: boolean; error?: string }>;
    }>("/leads/send-email", body, token);
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

  /** Massive Mentor AI Command Center — natural language CRM/ERP actions */
  async runAiCommand(
    body: {
      message: string;
      sessionId?: string;
      choices?: Record<string, string>;
      locale?: string;
    },
    token?: string | null
  ) {
    return this.request<{
      status: string;
      summary: string;
      steps: unknown[];
      cards: unknown[];
      confirmToken?: string;
      choices?: unknown[];
      missingFields?: string[];
      sessionId: string;
    }>("/ai-command/run", {
      method: "POST",
      body: JSON.stringify(body),
      token: token ?? undefined,
      timeoutMs: 90_000,
    });
  }

  async confirmAiCommand(
    body: { confirmToken: string; sessionId?: string },
    token?: string | null
  ) {
    return this.request<{
      status: string;
      summary: string;
      steps: unknown[];
      cards: unknown[];
      sessionId: string;
    }>("/ai-command/confirm", {
      method: "POST",
      body: JSON.stringify(body),
      token: token ?? undefined,
      timeoutMs: 60_000,
    });
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

  async post<T>(
    endpoint: string,
    body: unknown,
    token?: string | null,
    opts?: { timeoutMs?: number }
  ) {
    return this.request<T>(endpoint, {
      method: "POST",
      body: JSON.stringify(body),
      token: token ?? undefined,
      timeoutMs: opts?.timeoutMs,
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
          code: data.code as string | undefined,
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
      const isPreview = path.includes("/import/preview");
      // Preview never commits rows — do not say the server "processed" the file.
      // Import (/import/file) may have committed; callers re-verify via list refresh.
      let message: string;
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        message = "You appear offline. Reconnect and try again.";
      } else if (isPreview) {
        message = isAbort
          ? `Preview timed out after ${Math.round(timeoutMs / 1000)}s. Try CSV or a smaller file.`
          : "Could not load import preview (connection interrupted). Try CSV format.";
      } else if (isAbort) {
        message = `Upload timed out after ${Math.round(timeoutMs / 1000)}s. Refresh the leads list — rows may already be saved.`;
      } else {
        message = `Upload connection interrupted (${path}). Refresh the leads list to verify whether rows were saved.`;
      }
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
    // Server only samples first ~40 rows now — 60s is ample (was 90s full-file parse)
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
    }>("/reports/import/preview", fd, token, { timeoutMs: 60_000 });
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
        /** ISO 4217 from Business.settings / country — tenant single source of truth */
        currency?: string | null;
        country?: string | null;
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

  /** Custom Fields engine — tenant FieldDef CRUD */
  async listCustomFields(
    token: string,
    params?: { entity?: string; includeInactive?: boolean }
  ) {
    const q = new URLSearchParams();
    if (params?.entity) q.set("entity", params.entity);
    if (params?.includeInactive) q.set("includeInactive", "1");
    const qs = q.toString();
    return this.get<{ fields: unknown[] }>(
      `/custom-fields${qs ? `?${qs}` : ""}`,
      token
    );
  }

  async createCustomField(token: string, body: Record<string, unknown>) {
    return this.post<{ field: unknown }>("/custom-fields", body, token);
  }

  async updateCustomField(token: string, key: string, body: Record<string, unknown>) {
    return this.request<{ field: unknown }>(`/custom-fields/${encodeURIComponent(key)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
      token,
    });
  }

  async deactivateCustomField(token: string, key: string) {
    return this.request<{ field: unknown }>(`/custom-fields/${encodeURIComponent(key)}`, {
      method: "DELETE",
      token,
    });
  }

  async setCustomFieldOptions(
    token: string,
    key: string,
    options: Array<string | { value: string; label: string; active?: boolean; order?: number }>
  ) {
    return this.request<{ field: unknown }>(
      `/custom-fields/${encodeURIComponent(key)}/options`,
      {
        method: "PUT",
        body: JSON.stringify({ options }),
        token,
      }
    );
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

  async platformPermissionCatalog(token: string) {
    return this.get<{
      modules: Array<{
        key: string;
        label: string;
        description?: string | null;
        category?: string | null;
        alwaysOn?: boolean;
        sortOrder?: number;
      }>;
      templates: Array<{
        roleKey: string;
        label: string;
        modules: string[];
        sortOrder?: number;
      }>;
    }>("/platform/permission-catalog", token);
  }

  async platformSetUserPermissions(
    businessId: string,
    userId: string,
    body: {
      modules: string[];
      role?: string;
      template?: string;
      customized?: boolean;
    },
    token: string
  ) {
    return this.request(`/platform/businesses/${businessId}/users/${userId}/permissions`, {
      method: "PATCH",
      body: JSON.stringify(body),
      token,
    });
  }

  /** Super Admin: update business name, type, and/or business-level module allowlist */
  async platformUpdateBusiness(
    businessId: string,
    body: {
      name?: string;
      templateSlug?: string;
      moduleAccess?: { enabled: string[]; customized?: boolean };
      applyTemplateModuleDefaults?: boolean;
    },
    token: string
  ) {
    return this.request(`/platform/businesses/${businessId}`, {
      method: "PATCH",
      body: JSON.stringify(body),
      token,
    });
  }

  /** Super Admin: update member display name / role */
  async platformUpdateBusinessUser(
    businessId: string,
    userId: string,
    body: { name?: string; role?: string },
    token: string
  ) {
    return this.request(`/platform/businesses/${businessId}/users/${userId}`, {
      method: "PATCH",
      body: JSON.stringify(body),
      token,
    });
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
      modules: string[];
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
      user: {
        id: string;
        email: string;
        name: string | null;
        platformRole?: string;
        themePreference?: string;
      };
      token: string;
      portal: "admin";
    }>("/platform/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
  }

  async platformMe(token: string) {
    return this.get<{
      user: {
        id: string;
        email: string;
        name?: string | null;
        platformRole?: string;
        themePreference?: string;
      };
      portal: string;
    }>("/platform/auth/me", token);
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
    body: {
      action: string;
      plan?: string;
      days?: number;
      reason?: string;
      paymentId?: string;
    },
    token: string
  ) {
    return this.post(`/platform/businesses/${id}/plan`, body, token);
  }

  async platformSubscriptionHistory(id: string, token: string, limit = 100) {
    return this.get<{
      history: Array<{
        id: string;
        action: string;
        previousPlan: string | null;
        newPlan: string | null;
        changedBy: string;
        changedByEmail: string | null;
        paymentId: string | null;
        date: string;
        reason: string | null;
        licenseStatus: string | null;
        expiryDate: string | null;
      }>;
    }>(
      `/platform/businesses/${id}/subscription-history?limit=${limit}`,
      token
    );
  }

  async platformExtendTrial(id: string, days: number, token: string) {
    return this.post(`/platform/businesses/${id}/extend-trial`, { days }, token);
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
      loginHint: { email: string };
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
