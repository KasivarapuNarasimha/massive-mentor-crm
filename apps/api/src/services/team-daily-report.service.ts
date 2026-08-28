/**
 * Daily Admin team CRM activity email — reuses getMemberActivitySummary + assignment summary.
 * Scheduled via existing job-monitor + distributed-lock pattern in index.ts.
 */
import { prisma } from "../lib/prisma.js";
import { getMemberActivitySummary } from "./activity.service.js";
import { getLeadAssignmentSummary } from "./lead-assignment.service.js";
import { sendEmail } from "./email.service.js";
import { recordAudit } from "./audit.service.js";
import {
  escapeHtml,
  getAppUrl,
  getLoginUrl,
  getSupportEmail,
} from "./email/brand.js";
import { heading, paragraph, renderEmailLayout, pText } from "./email/layout.js";

const ADMIN_ROLES = new Set([
  "ceo",
  "owner",
  "business_admin",
  "admin",
  "super_admin",
  "manager",
]);

function todayKey(d = new Date()): string {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD UTC
}

async function alreadySentToday(businessId: string): Promise<boolean> {
  const start = new Date(`${todayKey()}T00:00:00.000Z`);
  const count = await prisma.auditLog.count({
    where: {
      businessId,
      action: "team_daily_report_sent",
      createdAt: { gte: start },
    },
  });
  return count > 0;
}

function buildReportEmail(opts: {
  businessName: string;
  sinceDays: number;
  assignment: Awaited<ReturnType<typeof getLeadAssignmentSummary>>;
  activity: Awaited<ReturnType<typeof getMemberActivitySummary>>;
}) {
  const dateLabel = new Date().toLocaleDateString("en-IN", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const subject = `Daily Team Activity Report — ${opts.businessName} — ${todayKey()}`;

  const rows = opts.activity.byMember
    .map(
      (m) =>
        `<tr>
          <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${escapeHtml(m.name)}</td>
          <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:right;">${m.leadsAssigned}</td>
          <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:right;">${m.leadsUpdated}</td>
          <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:right;">${m.followUpsCompleted}</td>
          <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:right;">${m.meetings}</td>
          <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:right;">${m.emailsSent}</td>
          <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:right;">${m.whatsappActions}</td>
          <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:right;">—</td>
        </tr>`
    )
    .join("");

  const bodyHtml = `
      ${heading("Daily Team Activity Report")}
      ${paragraph(`Workspace: <strong>${escapeHtml(opts.businessName)}</strong><br/>${escapeHtml(dateLabel)} · Last ${opts.sinceDays} days`)}
      ${paragraph(`
        <strong>Team summary</strong><br/>
        Total leads: ${opts.assignment.totalLeads}<br/>
        Assigned: ${opts.assignment.assignedLeads} · Unassigned: ${opts.assignment.unassignedLeads}<br/>
        Lead edits logged: ${opts.activity.totals.leadsUpdated}<br/>
        Follow-ups completed: ${opts.activity.totals.followUpsCompleted}<br/>
        Meetings: ${opts.activity.totals.meetings}<br/>
        Emails: ${opts.activity.totals.emailsSent} · WhatsApp: ${opts.activity.totals.whatsappActions}<br/>
        Calls: — (not tracked in CRM)
      `)}
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:13px;margin:16px 0;">
        <thead>
          <tr style="background:#f3f4f6;text-align:left;">
            <th style="padding:8px;">Member</th>
            <th style="padding:8px;text-align:right;">Assigned</th>
            <th style="padding:8px;text-align:right;">Updated</th>
            <th style="padding:8px;text-align:right;">Follow-ups</th>
            <th style="padding:8px;text-align:right;">Meetings</th>
            <th style="padding:8px;text-align:right;">Emails</th>
            <th style="padding:8px;text-align:right;">WhatsApp</th>
            <th style="padding:8px;text-align:right;">Calls</th>
          </tr>
        </thead>
        <tbody>${rows || `<tr><td colspan="8" style="padding:12px;color:#6b7280;">No members</td></tr>`}</tbody>
      </table>
      ${paragraph(`<a href="${escapeHtml(getLoginUrl("/dashboard"))}" style="color:#7c3aed;font-weight:600;">Open CRM dashboard</a>`)}
      ${pText(`Questions? ${getSupportEmail()}`)}
    `;
  const html = renderEmailLayout({
    preheader: `Team CRM activity for the last ${opts.sinceDays} days`,
    eyebrow: "Team report",
    bodyHtml,
  });

  const text = [
    `Daily Team Activity Report — ${opts.businessName}`,
    dateLabel,
    ``,
    `Total leads: ${opts.assignment.totalLeads}`,
    `Assigned: ${opts.assignment.assignedLeads}`,
    `Unassigned: ${opts.assignment.unassignedLeads}`,
    `Lead edits: ${opts.activity.totals.leadsUpdated}`,
    `Follow-ups done: ${opts.activity.totals.followUpsCompleted}`,
    `Meetings: ${opts.activity.totals.meetings}`,
    `Emails: ${opts.activity.totals.emailsSent}`,
    `WhatsApp: ${opts.activity.totals.whatsappActions}`,
    `Calls: — (not tracked)`,
    ``,
    ...opts.activity.byMember.map(
      (m) =>
        `${m.name}: assigned=${m.leadsAssigned} updated=${m.leadsUpdated} followups=${m.followUpsCompleted} meetings=${m.meetings} emails=${m.emailsSent} whatsapp=${m.whatsappActions} calls=—`
    ),
    ``,
    `Open: ${getAppUrl()}/dashboard`,
  ].join("\n");

  return { subject, html, text };
}

async function adminRecipients(businessId: string): Promise<Array<{ id: string; email: string }>> {
  const members = await prisma.businessMember.findMany({
    where: { businessId },
    include: {
      user: { select: { id: true, email: true, role: true, isDisabled: true } },
    },
  });
  const out: Array<{ id: string; email: string }> = [];
  for (const m of members) {
    if (!m.user || m.user.isDisabled || !m.user.email) continue;
    const role = String(m.role || m.user.role || "").toLowerCase();
    if (!ADMIN_ROLES.has(role) && !role.includes("admin")) continue;
    out.push({ id: m.user.id, email: m.user.email });
  }
  return out;
}

/** Send one business report if not already sent today (UTC). */
export async function sendTeamDailyReportForBusiness(
  businessId: string,
  opts?: { force?: boolean; actorUserId?: string }
): Promise<{ sent: number; skipped?: string; attempted?: number; recipients?: number }> {
  if (!opts?.force && (await alreadySentToday(businessId))) {
    return { sent: 0, skipped: "already_sent_today" };
  }

  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { id: true, name: true, status: true },
  });
  if (!business || business.status === "deleted") {
    return { sent: 0, skipped: "business_inactive" };
  }

  const recipients = await adminRecipients(businessId);
  if (!recipients.length) return { sent: 0, skipped: "no_admin_recipients" };

  // Use first admin as actor context for tenant-scoped summary helpers
  const actorId = opts?.actorUserId || recipients[0].id;
  const [assignment, activity] = await Promise.all([
    getLeadAssignmentSummary(actorId),
    getMemberActivitySummary(actorId, { sinceDays: 1 }),
  ]);

  const email = buildReportEmail({
    businessName: business.name || "Workspace",
    sinceDays: 1,
    assignment,
    activity,
  });

  let sent = 0;
  let attempted = 0;
  for (const r of recipients) {
    attempted += 1;
    try {
      const result = await sendEmail({
        to: r.email,
        subject: email.subject,
        html: email.html,
        text: email.text,
      });
      // Count SMTP delivery OR intentional console mode (dev without SMTP)
      if (result.delivered || result.mode === "console") sent += 1;
    } catch (err) {
      console.error("[team-daily-report] send failed", r.email, err);
      // Dev: body already printed by sendEmail before SMTP throw — treat as console fallback
      if (process.env.NODE_ENV !== "production") {
        sent += 1;
        console.log(
          `[team-daily-report] counted console fallback for ${r.email} (SMTP failed in development)`
        );
      }
    }
  }

  // Only mark day as sent when at least one recipient was reached (or console fallback)
  if (sent > 0) {
    await recordAudit({
      businessId,
      actorUserId: actorId,
      action: "team_daily_report_sent",
      entityType: "business",
      entityId: businessId,
      metadata: {
        sent,
        attempted,
        recipients: recipients.map((x) => x.email),
        day: todayKey(),
      },
    });
  }

  return { sent, attempted, recipients: recipients.length };
}

/** Iterate active customer businesses (skip demo). */
export async function sendTeamDailyReportsForAllBusinesses(): Promise<{
  businesses: number;
  emailsSent: number;
  skipped: number;
}> {
  const businesses = await prisma.business.findMany({
    where: {
      isDemo: false,
      status: { not: "deleted" },
      NOT: { portalKind: "demo" },
    },
    select: { id: true },
    take: 500,
  });

  let emailsSent = 0;
  let skipped = 0;
  for (const b of businesses) {
    const res = await sendTeamDailyReportForBusiness(b.id);
    if (res.skipped) skipped += 1;
    emailsSent += res.sent;
  }
  return { businesses: businesses.length, emailsSent, skipped };
}
