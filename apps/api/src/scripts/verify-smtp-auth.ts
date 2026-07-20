import "dotenv/config";
import net from "node:net";
import tls from "node:tls";
import { env } from "../config/env.js";

function cmd(socket: net.Socket | tls.TLSSocket, command?: string) {
  return new Promise<string>((resolve, reject) => {
    let buf = "";
    const t = setTimeout(() => reject(new Error(`timeout: ${command || "read"}`)), 15000);
    const onData = (c: Buffer) => {
      buf += c.toString("utf8");
      const lines = buf.split(/\r?\n/).filter(Boolean);
      const last = lines[lines.length - 1];
      if (last && last.length >= 4 && last[3] === " ") {
        clearTimeout(t);
        socket.off("data", onData);
        resolve(last);
      }
    };
    socket.on("data", onData);
    if (command !== undefined) socket.write(command + "\r\n");
  });
}

async function main() {
  const host = (env.SMTP_HOST || "").trim();
  const port = Number(env.SMTP_PORT || 465);
  const user = (env.SMTP_USER || "").trim();
  const pass = (env.SMTP_PASS || "").trim();
  const secure = env.SMTP_SECURE === true || port === 465;

  if (!host || !user || !pass) {
    console.error("SMTP not fully configured");
    process.exit(1);
  }

  console.log(`Auth test → ${host}:${port} secure=${secure} user=${user.slice(0, 2)}***`);

  const socket: tls.TLSSocket | net.Socket = secure
    ? tls.connect({ host, port, servername: host })
    : net.connect({ host, port });

  await new Promise<void>((resolve, reject) => {
    socket.once(secure ? "secureConnect" : "connect", () => resolve());
    socket.once("error", reject);
  });

  const greeting = await cmd(socket);
  console.log("GREETING", greeting);
  console.log("EHLO", await cmd(socket, "EHLO massivementor.local"));
  console.log("AUTH", await cmd(socket, "AUTH LOGIN"));
  console.log("USER", await cmd(socket, Buffer.from(user, "utf8").toString("base64")));
  const authRes = await cmd(socket, Buffer.from(pass, "utf8").toString("base64"));
  console.log("PASS_RESULT", authRes);

  const ok = authRes.startsWith("235");
  try {
    await cmd(socket, "QUIT");
  } catch {
    /* ignore */
  }
  socket.destroy();

  if (ok) {
    console.log("SMTP AUTH OK — credentials accepted by Hostinger");
    process.exit(0);
  }
  console.error("SMTP AUTH FAILED — check SMTP_USER / SMTP_PASS / mailbox enabled for SMTP");
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
