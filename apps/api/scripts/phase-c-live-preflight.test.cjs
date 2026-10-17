// Offline checks for the live-test preflight. Uses synthetic fixtures only.
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { validateLiveEnvironment, reportLiveEnvironment } = require("./phase-c-live-preflight.cjs");

function validEnv() {
  return {
    SMTP_HOST: "smtp.synthetic.example",
    SMTP_PORT: "587",
    SMTP_USER: "phasec-live@synthetic.example",
    SMTP_PASS: "synthetic-mailbox-secret",
    SMTP_FROM: "phasec-live@synthetic.example",
    COMMERCIAL_PUBLIC_URL: "https://synthetic.example",
    COMMERCIAL_DELIVERY_KEY: Buffer.alloc(32, 7).toString("base64"),
    MM_PHASEC_TEST_MAILBOX: "customer@synthetic.example",
  };
}

test("complete synthetic environment passes without appearing in the report", () => {
  const env = validEnv();
  const result = validateLiveEnvironment(env);
  assert.equal(result.ok, true);
  assert.deepEqual(result.missing, []);
  assert.deepEqual(result.invalid, []);
  const report = reportLiveEnvironment(result);
  assert.match(report, /MM_PHASEC_LIVE_PREFLIGHT ok/);
  assert.equal(report.includes(env.SMTP_PASS), false);
  assert.equal(report.includes(env.COMMERCIAL_DELIVERY_KEY), false);
  assert.equal(report.includes(env.COMMERCIAL_PUBLIC_URL), false);
});

test("missing and malformed values are reported by name only", () => {
  const result = validateLiveEnvironment({
    SMTP_PORT: "25",
    SMTP_FROM: "not-an-email",
    COMMERCIAL_PUBLIC_URL: "http://user:secret@example.test/path?q=1#token",
    COMMERCIAL_DELIVERY_KEY: "short",
    MM_PHASEC_TEST_MAILBOX: "also bad",
    MM_PHASEC_MAILBOX_MODE: "imap",
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.missing, ["SMTP_HOST", "SMTP_USER", "SMTP_PASS", "IMAP_HOST", "IMAP_PORT", "IMAP_USER", "IMAP_PASS"]);
  assert.deepEqual(result.invalid, ["SMTP_PORT", "SMTP_FROM", "MM_PHASEC_TEST_MAILBOX", "COMMERCIAL_PUBLIC_URL", "COMMERCIAL_DELIVERY_KEY"]);
  const report = reportLiveEnvironment(result);
  assert.match(report, /blocked/);
  assert.equal(report.includes("secret"), false);
  assert.equal(report.includes("token"), false);
});

test("manual mailbox mode does not require IMAP settings", () => {
  const result = validateLiveEnvironment(validEnv());
  assert.equal(result.mailboxMode, "manual");
  assert.equal(result.ok, true);
});
