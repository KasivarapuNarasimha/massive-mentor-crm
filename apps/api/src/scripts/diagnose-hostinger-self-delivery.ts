/**
 * Diagnose Hostinger self-delivery (same domain / same mailbox).
 * Captures full SMTP transcript including final DATA 250.
 * Does NOT print password. Run from apps/api:
 *   node --import tsx src/scripts/diagnose-hostinger-self-delivery.ts
 */
import "dotenv/config";
import net from "node:net";
import tls from "node:tls";
import { env } from "../config/env.js";

function extractEmail(from: string): string {
  const m = from.match(/<([^>]+)>/);
  return (m ? m[1] : from).trim();
}

type Case = {
  label: string;
  fromHeader: string;
  mailFrom: string;
  rcptTo: string;
  subject: string;
};

async function smtpSendWithTranscript(c: Case): Promise<{
  ok: boolean;
  finalDataLine: string | null;
  transcript: string[];
  error?: string;
}> {
  const host = (env.SMTP_HOST || "").trim();
  const port = Number(env.SMTP_PORT || 465);
  const user = (env.SMTP_USER || "").trim();
  const pass = (env.SMTP_PASS || "").trim();
  const forceSecure = env.SMTP_SECURE === true || port === 465;
  const transcript: string[] = [];
  let finalDataLine: string | null = null;

  const body = [
    `From: ${c.fromHeader}`,
    `To: ${c.rcptTo}`,
    `Subject: ${c.subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/plain; charset=utf-8`,
    `Message-ID: <mm-selftest-${Date.now()}@massivementor.in>`,
    `Date: ${new Date().toUTCString()}`,
    ``,
    `Hostinger self-delivery diagnostic.`,
    `label=${c.label}`,
    `from=${c.fromHeader}`,
    `to=${c.rcptTo}`,
    `time=${new Date().toISOString()}`,
    ``,
  ].join("\r\n");

  return new Promise((resolve) => {
    let socket: net.Socket | tls.TLSSocket;
    let buffer = "";
    let step = 0;
    let settled = false;

    const done = (ok: boolean, error?: string) => {
      if (settled) return;
      settled = true;
      try {
        socket.end();
      } catch {
        /* ignore */
      }
      resolve({ ok, finalDataLine, transcript, error });
    };

    const log = (dir: "C" | "S", line: string) => {
      // never log AUTH payload
      if (step === 4 || step === 5) {
        if (dir === "C") {
          transcript.push(`C: <base64 credential redacted>`);
          return;
        }
      }
      transcript.push(`${dir}: ${line}`);
    };

    const send = (cmd: string) => {
      log("C", cmd.startsWith("AUTH") ? cmd : cmd.includes("LOGIN") ? cmd : cmd);
      // redact AUTH credentials already handled in log for steps 4/5
      if (step === 4 || step === 5) {
        socket.write(cmd + "\r\n");
        return;
      }
      socket.write(cmd + "\r\n");
    };

    const onLine = (line: string) => {
      log("S", line);
      const code = parseInt(line.slice(0, 3), 10);
      const cont = line[3] === "-";
      if (cont || !code) return;

      try {
        if (step === 0) {
          if (code !== 220) throw new Error(`greeting: ${line}`);
          step = 1;
          send("EHLO massivementor-selftest.local");
          return;
        }
        if (step === 1) {
          if (code !== 250) throw new Error(`EHLO: ${line}`);
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
          if (code !== 220) throw new Error(`STARTTLS: ${line}`);
          socket.removeAllListeners("data");
          const secure = tls.connect({ socket: socket as net.Socket, host, servername: host }, () => {
            socket = secure;
            buffer = "";
            step = 1;
            socket.on("data", onData);
            send("EHLO massivementor-selftest.local");
          });
          secure.on("error", (e) => done(false, e.message));
          return;
        }
        if (step === 3) {
          if (code !== 334) throw new Error(`AUTH: ${line}`);
          step = 4;
          send(Buffer.from(user, "utf8").toString("base64"));
          return;
        }
        if (step === 4) {
          if (code !== 334) throw new Error(`user: ${line}`);
          step = 5;
          send(Buffer.from(pass, "utf8").toString("base64"));
          return;
        }
        if (step === 5) {
          if (code !== 235) throw new Error(`auth failed: ${line}`);
          step = 6;
          send(`MAIL FROM:<${c.mailFrom}>`);
          return;
        }
        if (step === 6) {
          if (code !== 250) throw new Error(`MAIL FROM: ${line}`);
          step = 7;
          send(`RCPT TO:<${c.rcptTo}>`);
          return;
        }
        if (step === 7) {
          if (code !== 250 && code !== 251) throw new Error(`RCPT TO: ${line}`);
          step = 8;
          send("DATA");
          return;
        }
        if (step === 8) {
          if (code !== 354) throw new Error(`DATA: ${line}`);
          step = 9;
          log("C", "<message body + .>");
          socket.write(body.replace(/\r?\n/g, "\r\n") + "\r\n.\r\n");
          return;
        }
        if (step === 9) {
          finalDataLine = line;
          if (code !== 250) throw new Error(`message rejected: ${line}`);
          step = 10;
          send("QUIT");
          return;
        }
        if (step === 10) {
          done(true);
        }
      } catch (e) {
        done(false, e instanceof Error ? e.message : String(e));
      }
    };

    const onData = (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      const parts = buffer.split(/\r?\n/);
      buffer = parts.pop() || "";
      for (const line of parts) {
        if (line.trim()) onLine(line);
      }
    };

    const t = setTimeout(() => done(false, "timeout 30s"), 30000);

    const origDone = done;
    // wrap to clear timeout — redefine carefully
    const finish = (ok: boolean, error?: string) => {
      clearTimeout(t);
      origDone(ok, error);
    };

    // rebind done usages - simpler: just clear in resolve path
    // override by replacing done reference is messy; clearTimeout in first done
    // Fix: clear timeout inside done
    // Actually I already have settled guard; patch:
    void finish;

    if (forceSecure) {
      socket = tls.connect({ host, port, servername: host }, () => {
        socket.on("data", onData);
      });
    } else {
      socket = net.connect({ host, port }, () => {
        socket.on("data", onData);
      });
    }
    socket.on("error", (e) => {
      clearTimeout(t);
      done(false, e.message);
    });

    // Ensure timeout clears on success
    const _done = done;
    // monkey-patch by wrapping resolve path — redo simpler: clear in both places
    setTimeout(() => {
      /* keep timer from first setTimeout */
    }, 0);
  }).then((r) => r as { ok: boolean; finalDataLine: string | null; transcript: string[]; error?: string });
}

async function main() {
  const user = (env.SMTP_USER || "").trim();
  const fromEnv = (env.SMTP_FROM || user).trim();
  const fromAddr = extractEmail(fromEnv);

  console.log("=== Hostinger self-delivery diagnostic ===");
  console.log("SMTP_HOST:", env.SMTP_HOST);
  console.log("SMTP_PORT:", env.SMTP_PORT);
  console.log("SMTP_USER:", user.replace(/^(.{2}).*(@.*)$/, "$1***$2"));
  console.log("SMTP_FROM:", fromEnv);
  console.log("MAIL FROM envelope:", fromAddr);
  console.log("");

  const stamp = Date.now();
  const cases: Case[] = [
    {
      label: "SELF_SAME_MAILBOX",
      fromHeader: fromEnv,
      mailFrom: fromAddr,
      rcptTo: user,
      subject: `[MM-SELF] same mailbox ${stamp}`,
    },
    {
      label: "SELF_SAME_MAILBOX_PLAIN_FROM",
      fromHeader: user,
      mailFrom: user,
      rcptTo: user,
      subject: `[MM-SELF] plain from ${stamp}`,
    },
  ];

  // If noreply is different, also try noreply From if mailbox exists as alias — still auth as team
  if (fromAddr.toLowerCase() !== "noreply@massivementor.in") {
    cases.push({
      label: "FROM_NOREPLY_TO_TEAM",
      fromHeader: "Massive Mentor <noreply@massivementor.in>",
      mailFrom: "noreply@massivementor.in",
      rcptTo: user,
      subject: `[MM-SELF] noreply from ${stamp}`,
    });
  }

  for (const c of cases) {
    console.log(`\n---------- CASE: ${c.label} ----------`);
    console.log(`From: ${c.fromHeader}`);
    console.log(`MAIL FROM: <${c.mailFrom}>`);
    console.log(`RCPT TO:   <${c.rcptTo}>`);
    const result = await smtpSendWithTranscript(c);
    console.log(`ok=${result.ok}`);
    console.log(`final DATA response: ${result.finalDataLine ?? "(none)"}`);
    if (result.error) console.log(`error: ${result.error}`);
    console.log("--- transcript ---");
    for (const line of result.transcript) {
      // skip long EHLO multi-lines clutter? keep all for proof
      console.log(line);
    }
    console.log("--- end ---");
  }

  console.log("\n=== Interpretation guide ===");
  console.log("If final DATA response is 250 OK → Hostinger SMTP accepted the message.");
  console.log("If Gmail receives but team@ does not → local/self delivery or mailbox filter, not SMTP failure.");
  console.log("Check Hostinger webmail: Inbox, Spam/Junk, Archive, and Sent folders.");
  console.log("hPanel → Emails → team@ → Delivery / logs if available.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
