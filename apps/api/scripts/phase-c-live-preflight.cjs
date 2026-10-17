// Shape checks for a future live customer run. Prints names only, never values.
const REQUIRED = [
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_USER",
  "SMTP_PASS",
  "SMTP_FROM",
  "COMMERCIAL_PUBLIC_URL",
  "COMMERCIAL_DELIVERY_KEY",
  "MM_PHASEC_TEST_MAILBOX",
];

function present(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function emailShape(value) {
  return /^[^\s@]+@[^\s@]+$/.test(value) && value.length <= 254;
}

function validateLiveEnvironment(env) {
  const missing = REQUIRED.filter((name) => !present(env[name]));
  const invalid = [];
  if (!missing.includes("SMTP_PORT") && !["465", "587"].includes(env.SMTP_PORT)) invalid.push("SMTP_PORT");
  if (!missing.includes("SMTP_FROM") && !emailShape(env.SMTP_FROM)) invalid.push("SMTP_FROM");
  if (!missing.includes("MM_PHASEC_TEST_MAILBOX") && !emailShape(env.MM_PHASEC_TEST_MAILBOX)) invalid.push("MM_PHASEC_TEST_MAILBOX");
  if (!missing.includes("COMMERCIAL_PUBLIC_URL")) {
    try {
      const url = new URL(env.COMMERCIAL_PUBLIC_URL);
      if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) invalid.push("COMMERCIAL_PUBLIC_URL");
    } catch {
      invalid.push("COMMERCIAL_PUBLIC_URL");
    }
  }
  if (!missing.includes("COMMERCIAL_DELIVERY_KEY")) {
    const key = env.COMMERCIAL_DELIVERY_KEY;
    const bytes = /^[A-Za-z0-9+/]{43}=$/.test(key) ? Buffer.from(key, "base64") : null;
    if (!bytes || bytes.length !== 32) invalid.push("COMMERCIAL_DELIVERY_KEY");
  }
  const mode = env.MM_PHASEC_MAILBOX_MODE || "manual";
  if (mode !== "manual" && mode !== "imap") invalid.push("MM_PHASEC_MAILBOX_MODE");
  if (mode === "imap") {
    for (const name of ["IMAP_HOST", "IMAP_PORT", "IMAP_USER", "IMAP_PASS"]) {
      if (!present(env[name])) missing.push(name);
    }
    if (present(env.IMAP_PORT) && env.IMAP_PORT !== "993") invalid.push("IMAP_PORT");
  }
  return { ok: missing.length === 0 && invalid.length === 0, missing, invalid, mailboxMode: mode === "imap" || mode === "manual" ? mode : "invalid" };
}

function reportLiveEnvironment(result) {
  const missing = result.missing.join(",") || "none";
  const invalid = result.invalid.join(",") || "none";
  return [
    `MM_PHASEC_LIVE_PREFLIGHT mailbox=${result.mailboxMode}`,
    `MM_PHASEC_LIVE_PREFLIGHT missing=${missing}`,
    `MM_PHASEC_LIVE_PREFLIGHT invalid=${invalid}`,
    `MM_PHASEC_LIVE_PREFLIGHT ${result.ok ? "ok" : "blocked"}`,
  ].join("\n");
}

if (require.main === module) {
  const result = validateLiveEnvironment(process.env);
  process.stdout.write(reportLiveEnvironment(result) + "\n");
  process.exit(result.ok ? 0 : 2);
}

module.exports = { REQUIRED, validateLiveEnvironment, reportLiveEnvironment };
