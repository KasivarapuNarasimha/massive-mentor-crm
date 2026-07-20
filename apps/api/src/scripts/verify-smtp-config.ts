/**
 * Pre-flight: verify .env SMTP loads and Hostinger is reachable.
 * Does not print secrets or password-reset tokens.
 */
import "dotenv/config";
import net from "node:net";
import tls from "node:tls";
import { env } from "../config/env.js";

function mask(email?: string) {
  if (!email) return "(empty)";
  const [a, b] = email.split("@");
  if (!b) return "***";
  return `${(a || "").slice(0, 2)}***@${b}`;
}

function smtpConfigured() {
  return !!(env.SMTP_HOST?.trim() && env.SMTP_USER?.trim() && env.SMTP_PASS?.trim());
}

function willUseSmtpNotConsoleOnly() {
  // Mirrors email.service.ts smtpConfigured()
  return smtpConfigured();
}

async function tcpConnect(host: string, port: number, secure: boolean, timeoutMs = 12000) {
  return new Promise<{ ok: boolean; detail: string }>((resolve) => {
    const t = setTimeout(() => {
      try {
        socket.destroy();
      } catch {
        /* */
      }
      resolve({ ok: false, detail: `Timeout after ${timeoutMs}ms connecting to ${host}:${port}` });
    }, timeoutMs);

    let socket: net.Socket | tls.TLSSocket;
    const onReady = () => {
      // Read greeting
      const onData = (buf: Buffer) => {
        const line = buf.toString("utf8");
        clearTimeout(t);
        socket.removeListener("data", onData);
        socket.destroy();
        if (line.startsWith("220")) {
          resolve({ ok: true, detail: `SMTP greeting OK: ${line.trim().slice(0, 80)}` });
        } else {
          resolve({ ok: false, detail: `Unexpected greeting: ${line.trim().slice(0, 120)}` });
        }
      };
      socket.on("data", onData);
    };

    if (secure) {
      socket = tls.connect({ host, port, servername: host }, onReady);
    } else {
      socket = net.connect({ host, port }, onReady);
    }
    socket.on("error", (err) => {
      clearTimeout(t);
      resolve({ ok: false, detail: err.message });
    });
  });
}

async function main() {
  console.log("=== SMTP configuration verification ===\n");
  console.log("NODE_ENV:", env.NODE_ENV);
  console.log("CUSTOMER_APP_URL:", env.CUSTOMER_APP_URL);
  console.log("ADMIN_APP_URL:", env.ADMIN_APP_URL);
  console.log("SMTP_HOST:", env.SMTP_HOST || "(empty)");
  console.log("SMTP_PORT:", env.SMTP_PORT);
  console.log("SMTP_SECURE:", env.SMTP_SECURE);
  console.log("SMTP_USER:", mask(env.SMTP_USER));
  console.log("SMTP_PASS:", env.SMTP_PASS ? `(set, length=${env.SMTP_PASS.length})` : "(empty)");
  console.log("SMTP_FROM:", env.SMTP_FROM ? env.SMTP_FROM.replace(/[A-Za-z0-9._%+-]+@/g, "***@") : "(empty)");

  const configured = smtpConfigured();
  console.log("\nsmtpConfigured():", configured);
  console.log("Will prefer SMTP over console-only:", willUseSmtpNotConsoleOnly());

  const issues: string[] = [];
  if (!env.SMTP_HOST?.trim()) issues.push("SMTP_HOST missing");
  if (!env.SMTP_USER?.trim()) issues.push("SMTP_USER missing");
  if (!env.SMTP_PASS?.trim()) issues.push("SMTP_PASS missing");
  if (!env.SMTP_FROM?.trim()) issues.push("SMTP_FROM missing (falls back to SMTP_USER)");

  const port = Number(env.SMTP_PORT || 587);
  const secure = env.SMTP_SECURE === true || port === 465;
  if (port === 465 && env.SMTP_SECURE !== true) {
    console.log("NOTE: Port 465 implies SSL; code treats port 465 as secure even if SMTP_SECURE is false.");
  }
  if (port === 587 && env.SMTP_SECURE === true) {
    issues.push(
      "SMTP_PORT=587 with SMTP_SECURE=true is unusual. Hostinger 587 usually needs SMTP_SECURE=false (STARTTLS). Prefer 465+true or 587+false."
    );
  }

  // FROM should generally match mailbox domain
  const userEmail = (env.SMTP_USER || "").trim();
  const from = (env.SMTP_FROM || "").trim();
  if (userEmail.includes("@") && from.includes("@")) {
    const userDomain = userEmail.split("@")[1]?.toLowerCase();
    const fromMatch = from.match(/@([A-Za-z0-9.-]+)/);
    const fromDomain = fromMatch?.[1]?.toLowerCase();
    if (userDomain && fromDomain && userDomain !== fromDomain) {
      issues.push(
        `SMTP_FROM domain (${fromDomain}) differs from SMTP_USER domain (${userDomain}) — Hostinger may reject or spam-filter.`
      );
    }
  }

  console.log("\nBehavior matrix:");
  console.log(
    "  Dev + SMTP configured →",
    configured
      ? "send via SMTP (and also print body to API console in development)"
      : "N/A (SMTP not configured)"
  );
  console.log(
    "  Dev + SMTP missing →",
    !configured ? "print reset link to API console only" : "N/A"
  );
  console.log(
    "  Prod + SMTP configured →",
    "send via SMTP only (no token/body in logs)"
  );
  console.log(
    "  Prod + SMTP missing →",
    "fail securely, no reset link in logs"
  );

  if (!configured) {
    console.log("\nRESULT: SMTP is NOT ready — still using console mode in development.");
    process.exit(1);
  }

  console.log(`\nConnecting to Hostinger ${env.SMTP_HOST}:${port} secure=${secure} …`);
  const conn = await tcpConnect(env.SMTP_HOST!.trim(), port, secure);
  console.log(conn.ok ? "CONNECT OK:" : "CONNECT FAIL:", conn.detail);

  if (!conn.ok) {
    issues.push(`Cannot complete SMTP greeting: ${conn.detail}`);
  }

  if (issues.length) {
    console.log("\nIssues / warnings:");
    for (const i of issues) console.log(" -", i);
  }

  if (configured && conn.ok && !issues.some((i) => i.startsWith("Cannot"))) {
    console.log("\n=== SMTP configuration is ready for testing. ===");
    console.log("Restart the API so it reloads .env, then use Forgot Password.");
    process.exit(0);
  } else if (configured && !conn.ok) {
    console.log("\n=== These changes are still required before testing. ===");
    process.exit(1);
  } else {
    console.log("\n=== These changes are still required before testing. ===");
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
