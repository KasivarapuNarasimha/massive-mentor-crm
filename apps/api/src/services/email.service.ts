import net from "node:net";
import tls from "node:tls";
import { env } from "../config/env.js";

export type SendEmailInput = {
  to: string;
  subject: string;
  text: string;
  html?: string;
  /** If true, body may contain secrets (reset links). Never log body in production. */
  sensitive?: boolean;
};

function isProduction(): boolean {
  return env.NODE_ENV === "production";
}

/** Strip wrapping quotes often left in .env values (Hostinger paste). */
function cleanSmtpSecret(value: string | undefined): string {
  let v = String(value || "").trim();
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    v = v.slice(1, -1).trim();
  }
  return v;
}

function smtpCredentials() {
  return {
    host: cleanSmtpSecret(env.SMTP_HOST),
    port: Number(env.SMTP_PORT || 587),
    user: cleanSmtpSecret(env.SMTP_USER),
    pass: cleanSmtpSecret(env.SMTP_PASS),
    from: cleanSmtpSecret(env.SMTP_FROM) || cleanSmtpSecret(env.SMTP_USER),
    secure: env.SMTP_SECURE === true || Number(env.SMTP_PORT || 587) === 465,
  };
}

function smtpConfigured(): boolean {
  const { host, user, pass } = smtpCredentials();
  const ok = !!(host && user && pass);
  // One-line proof when sendEmail is invoked (no secrets)
  if (!(globalThis as { __mmSmtpLogged?: boolean }).__mmSmtpLogged) {
    (globalThis as { __mmSmtpLogged?: boolean }).__mmSmtpLogged = true;
    console.log(
      `[email] smtpConfigured()=${ok} host=${host || "(empty)"} user=${user ? maskEmail(user) : "(empty)"} pass=${pass ? `set(len=${pass.length})` : "empty"}`
    );
  }
  return ok;
}

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return "***";
  const l = local || "";
  const shown = l.length <= 2 ? "**" : `${l.slice(0, 2)}***`;
  return `${shown}@${domain}`;
}

/** Dev-only: print full message including reset links so localhost QA always works. */
function logEmailToConsoleDev(input: SendEmailInput) {
  if (isProduction()) return;
  console.log("\n");
  console.log("╔══════════════════════════════════════════════════════════════════╗");
  console.log("║  EMAIL (DEVELOPMENT — API CONSOLE)                               ║");
  console.log("║  Look here when SMTP is off or Hostinger delivery fails.         ║");
  console.log("╚══════════════════════════════════════════════════════════════════╝");
  console.log(`To:      ${input.to}`);
  console.log(`Subject: ${input.subject}`);
  console.log(`HTML:    ${input.html ? `yes (${input.html.length} chars)` : "no"}`);
  console.log("---- text body ----");
  console.log(input.text);
  console.log("---- end ----\n");
}

/**
 * Minimal SMTP client (no nodemailer dependency).
 * Supports:
 * - Port 465: implicit TLS (secure)
 * - Port 587 / 25: STARTTLS after EHLO
 * Hostinger typically: smtp.hostinger.com:465 or :587
 */
async function sendViaRawSmtp(input: SendEmailInput): Promise<void> {
  const { host, port, user, pass, from, secure: forceSecure } = smtpCredentials();
  if (!host || !user || !pass) {
    throw new Error("SMTP credentials incomplete");
  }

  const boundary = `mm_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const html = input.html || input.text.replace(/\n/g, "<br/>\n");
  const encodedSubject = `=?UTF-8?B?${Buffer.from(input.subject, "utf8").toString("base64")}?=`;

  const dataLines = [
    `From: ${from}`,
    `To: ${input.to}`,
    `Subject: ${encodedSubject}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    ``,
    `--${boundary}`,
    `Content-Type: text/plain; charset=utf-8`,
    `Content-Transfer-Encoding: 8bit`,
    ``,
    input.text,
    ``,
    `--${boundary}`,
    `Content-Type: text/html; charset=utf-8`,
    `Content-Transfer-Encoding: 8bit`,
    ``,
    html,
    ``,
    `--${boundary}--`,
    ``,
  ];

  // Dot-stuff lines starting with .
  const dataBody = dataLines
    .join("\r\n")
    .split("\n")
    .map((l) => (l.startsWith(".") ? "." + l : l))
    .join("\r\n");

  await new Promise<void>((resolve, reject) => {
    let socket: net.Socket | tls.TLSSocket;
    let buffer = "";
    let step = 0;
    let settled = false;
    const timeout = setTimeout(() => {
      fail(new Error(`SMTP timeout connecting/talking to ${host}:${port}`));
    }, 25000);

    function fail(err: Error) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      try {
        socket.destroy();
      } catch {
        /* ignore */
      }
      reject(err);
    }

    function ok() {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      try {
        socket.end();
      } catch {
        /* ignore */
      }
      resolve();
    }

    function send(cmd: string) {
      socket.write(cmd + "\r\n");
    }

    function onLine(line: string) {
      // Multi-line replies end when code is followed by space
      const code = parseInt(line.slice(0, 3), 10);
      const cont = line[3] === "-";
      if (cont || !code) return;

      try {
        if (step === 0) {
          // greeting 220
          if (code !== 220) throw new Error(`SMTP greeting failed: ${line}`);
          step = 1;
          send(`EHLO massivementor.local`);
          return;
        }
        if (step === 1) {
          if (code !== 250) throw new Error(`SMTP EHLO failed: ${line}`);
          if (!forceSecure && port !== 465) {
            step = 2;
            send("STARTTLS");
            return;
          }
          step = 3;
          send("AUTH LOGIN");
          return;
        }
        if (step === 2) {
          // STARTTLS 220
          if (code !== 220) throw new Error(`SMTP STARTTLS failed: ${line}`);
          socket.removeAllListeners("data");
          const secure = tls.connect(
            {
              socket: socket as net.Socket,
              host,
              servername: host,
            },
            () => {
              socket = secure;
              buffer = "";
              step = 1; // re-EHLO after STARTTLS
              socket.on("data", onData);
              send(`EHLO massivementor.local`);
            }
          );
          secure.on("error", fail);
          return;
        }
        if (step === 3) {
          if (code !== 334) throw new Error(`SMTP AUTH LOGIN failed: ${line}`);
          step = 4;
          send(Buffer.from(user, "utf8").toString("base64"));
          return;
        }
        if (step === 4) {
          if (code !== 334) throw new Error(`SMTP username rejected: ${line}`);
          step = 5;
          send(Buffer.from(pass, "utf8").toString("base64"));
          return;
        }
        if (step === 5) {
          if (code !== 235) throw new Error(`SMTP authentication failed: ${line}`);
          step = 6;
          send(`MAIL FROM:<${extractEmail(from)}>`);
          return;
        }
        if (step === 6) {
          if (code !== 250) throw new Error(`SMTP MAIL FROM failed: ${line}`);
          step = 7;
          send(`RCPT TO:<${input.to}>`);
          return;
        }
        if (step === 7) {
          if (code !== 250 && code !== 251) throw new Error(`SMTP RCPT TO failed: ${line}`);
          step = 8;
          send("DATA");
          return;
        }
        if (step === 8) {
          if (code !== 354) throw new Error(`SMTP DATA not accepted: ${line}`);
          step = 9;
          socket.write(dataBody.replace(/\r?\n/g, "\r\n") + "\r\n.\r\n");
          return;
        }
        if (step === 9) {
          if (code !== 250) throw new Error(`SMTP message not accepted: ${line}`);
          step = 10;
          send("QUIT");
          return;
        }
        if (step === 10) {
          ok();
        }
      } catch (e) {
        fail(e instanceof Error ? e : new Error(String(e)));
      }
    }

    function onData(chunk: Buffer) {
      buffer += chunk.toString("utf8");
      const parts = buffer.split(/\r?\n/);
      buffer = parts.pop() || "";
      for (const line of parts) {
        if (line.trim()) onLine(line);
      }
    }

    if (forceSecure) {
      socket = tls.connect({ host, port, servername: host }, () => {
        socket.on("data", onData);
      });
    } else {
      socket = net.connect({ host, port }, () => {
        socket.on("data", onData);
      });
    }
    socket.on("error", fail);
  });
}

function extractEmail(from: string): string {
  const m = from.match(/<([^>]+)>/);
  if (m) return m[1];
  return from.trim();
}

async function sendViaNodemailer(input: SendEmailInput): Promise<void> {
  const nodemailer = await import("nodemailer").catch(() => null);
  if (!nodemailer) {
    throw new Error("nodemailer_not_installed");
  }
  const { host, port, user, pass, from, secure } = smtpCredentials();
  if (!host || !user || !pass) {
    throw new Error("SMTP credentials incomplete");
  }
  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
    connectionTimeout: 20_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
    tls: {
      // Hostinger / many shared hosts need this on some Windows Node builds
      rejectUnauthorized: env.NODE_ENV === "production",
      servername: host,
    },
    requireTLS: !secure && port === 587,
  });
  // Verify connectivity before send — clearer logs when auth/host is wrong
  try {
    await transporter.verify();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[email] SMTP verify failed:", msg);
    throw new Error(`SMTP verify failed: ${msg}`);
  }
  const info = await transporter.sendMail({
    from: from || user,
    to: input.to,
    subject: input.subject,
    text: input.text,
    html: input.html || input.text.replace(/\n/g, "<br/>"),
  });
  console.log(
    `[email] nodemailer messageId=${info.messageId || "n/a"} response=${info.response || "n/a"}`
  );
}

/**
 * Production email sender.
 * - Development: always print full email (incl. reset links) to the API console.
 * - If SMTP_* set: attempt delivery via nodemailer or raw SMTP (Hostinger-compatible).
 * - Production without SMTP: fail closed, never print tokens.
 */
export async function sendEmail(input: SendEmailInput): Promise<{ delivered: boolean; mode: string }> {
  const hasSmtp = smtpConfigured();
  const isProd = isProduction();

  // LOCALHOST / DEV: always surface the message in the API terminal first
  if (!isProd) {
    logEmailToConsoleDev(input);
  }

  if (!hasSmtp) {
    if (isProd) {
      console.error(
        "[email] CRITICAL: SMTP is not configured in production. Email NOT sent. " +
          `to=${maskEmail(input.to)} subject="${input.subject}" (body suppressed)`
      );
      throw new Error("Email delivery is not configured (set SMTP_HOST, SMTP_USER, SMTP_PASS)");
    }
    console.log(
      "[email] SMTP not configured — using API console only (development). " +
        "Set SMTP_HOST/SMTP_USER/SMTP_PASS in apps/api/.env to deliver to Hostinger."
    );
    return { delivered: false, mode: "console" };
  }

  // SMTP configured — deliver via provider
  const port = Number(env.SMTP_PORT || 587);
  console.log(
    `[email] Attempting SMTP host=${env.SMTP_HOST} port=${port} user=${maskEmail(env.SMTP_USER || "")} to=${maskEmail(input.to)}`
  );

  try {
    try {
      await sendViaNodemailer(input);
      console.log(`[email] delivered via nodemailer/smtp to=${maskEmail(input.to)}`);
      return { delivered: true, mode: "smtp-nodemailer" };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === "nodemailer_not_installed" || msg.includes("Cannot find module")) {
        console.log("[email] nodemailer not installed — using built-in SMTP client");
      } else {
        console.error("[email] nodemailer failed:", msg);
        console.log("[email] retrying with built-in SMTP client…");
      }
      await sendViaRawSmtp(input);
      console.log(`[email] delivered via raw-smtp to=${maskEmail(input.to)}`);
      return { delivered: true, mode: "smtp-raw" };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown error";
    console.error("[email] SMTP send FAILED:", msg);
    console.error(
      "[email] Hostinger tip: use smtp.hostinger.com, port 465 (SSL) or 587 (STARTTLS), " +
        "SMTP_USER=full mailbox email, SMTP_PASS=mailbox password, SMTP_FROM=same domain."
    );
    if (!isProd) {
      console.error(
        "[email] Development fallback: use the PASSWORD RESET link printed ABOVE in this terminal."
      );
    }
    throw new Error(`SMTP send failed: ${msg}`);
  }
}

/** Premium HTML templates — re-exported for existing imports */
export {
  buildPasswordResetEmail,
  buildWelcomeAccountEmail,
  buildTrialExpiryReminderEmail,
  buildTrialExpiredEmail,
  buildSubscriptionActivatedEmail,
  buildPaymentSuccessEmail,
  buildInvoiceGeneratedEmail,
  buildInvitationEmail,
  buildRenewalReminderEmail,
  getAppUrl,
  getLoginUrl,
} from "./email/templates.js";

/** Test SMTP connectivity (for diagnostics). Never logs password. */
export async function testSmtpConnection(): Promise<{
  configured: boolean;
  ok: boolean;
  detail: string;
}> {
  if (!smtpConfigured()) {
    return {
      configured: false,
      ok: false,
      detail: "SMTP_HOST / SMTP_USER / SMTP_PASS not set in apps/api/.env",
    };
  }
  try {
    await sendViaRawSmtp({
      to: (env.SMTP_USER || "").trim(),
      subject: "Massive Mentor SMTP test",
      text: "SMTP connection test from Massive Mentor API. You can ignore this message.",
    });
    return {
      configured: true,
      ok: true,
      detail: `SMTP OK host=${env.SMTP_HOST} port=${env.SMTP_PORT || 587}`,
    };
  } catch (e) {
    return {
      configured: true,
      ok: false,
      detail: e instanceof Error ? e.message : String(e),
    };
  }
}
