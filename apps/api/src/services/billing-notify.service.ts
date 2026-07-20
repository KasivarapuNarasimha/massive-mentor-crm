/**
 * Super Admin notifications for SaaS billing lifecycle events.
 */
import { prisma } from "../lib/prisma.js";
import { notifyUser } from "./notification.service.js";
import { sendEmail } from "./email.service.js";
import { env } from "../config/env.js";
import {
  ctaButton,
  heading,
  pText,
  paragraph,
  renderEmailLayout,
} from "./email/layout.js";
import { escapeHtml, getLoginUrl } from "./email/brand.js";

function buildPlatformNotifyEmail(opts: { title: string; message: string }) {
  const adminUrl = getLoginUrl("/admin");
  const subject = `[MM Platform] ${opts.title}`;
  const text = `${opts.title}\n\n${opts.message}\n\n— Massive Mentor Platform`;
  const bodyHtml = `
    ${heading(opts.title)}
    ${paragraph(escapeHtml(opts.message).replace(/\n/g, "<br/>"))}
    ${ctaButton("Open admin", adminUrl)}
    ${pText("Internal platform notification — Massive Mentor.", { muted: true })}
  `;
  return {
    subject,
    text,
    html: renderEmailLayout({
      preheader: opts.title,
      eyebrow: "Platform",
      bodyHtml,
    }),
  };
}

export async function notifySuperAdmins(opts: {
  title: string;
  message: string;
  entityType?: string;
  entityId?: string;
}) {
  const admins = await prisma.user.findMany({
    where: { platformRole: "super_admin", isDisabled: false },
    select: { id: true, email: true },
    take: 20,
  });
  const mail = buildPlatformNotifyEmail(opts);
  for (const a of admins) {
    await notifyUser(a.id, {
      type: "system",
      title: opts.title,
      message: opts.message,
      entityType: opts.entityType || "Billing",
      entityId: opts.entityId,
    }).catch(() => undefined);
    if (a.email) {
      void sendEmail({
        to: a.email,
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
      }).catch(() => undefined);
    }
  }
  // Also notify configured backup/ops email if set
  if (env.BACKUP_NOTIFY_EMAIL) {
    void sendEmail({
      to: env.BACKUP_NOTIFY_EMAIL,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    }).catch(() => undefined);
  }
}
