export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  /** Machine-readable code e.g. SESSION_LIMIT */
  code?: string;
}

export interface User {
  id: string;
  email: string;
  name: string | null;
  role?: string;
  platformRole?: string;
  businessId?: string;
  /** light | dark | system */
  themePreference?: string;
}

export interface AuthResponse {
  user: User;
  token: string;
  sessionId?: string;
  mfaRequired?: boolean;
  portal?: string;
}

export interface AuthUserResponse {
  user: User;
}

export type SessionSummary = {
  id: string;
  deviceName?: string | null;
  browser?: string | null;
  os?: string | null;
  ipAddress?: string | null;
  locationLabel?: string | null;
  loginTime?: string;
  lastActivity?: string;
  isCurrent?: boolean;
  userEmail?: string;
  userName?: string | null;
  userId?: string;
};
