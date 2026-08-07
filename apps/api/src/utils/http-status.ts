/**
 * Map service-layer Error messages to HTTP status codes.
 * Controllers should keep response shapes; this only standardizes status selection.
 */
export function messageToHttpStatus(
  message: string,
  opts?: { defaultStatus?: number }
): number {
  const m = message || "";
  if (/not authenticated|unauthorized|session expired|session was ended/i.test(m)) {
    return 401;
  }
  if (
    /permission|insufficient|only managers|only business|not allowed|forbidden|restricted/i.test(
      m
    )
  ) {
    return 403;
  }
  if (/not found|not accessible|no longer exists/i.test(m)) {
    return 404;
  }
  if (
    /required|must be|invalid|validation|too many|maximum|cannot merge|already/i.test(m)
  ) {
    return 400;
  }
  return opts?.defaultStatus ?? 400;
}

/** Prefer message when Error; otherwise fallback string. */
export function errorMessage(error: unknown, fallback = "Request failed"): string {
  return error instanceof Error ? error.message : fallback;
}
