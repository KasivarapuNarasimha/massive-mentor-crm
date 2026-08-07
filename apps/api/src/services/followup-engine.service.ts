/**
 * AI Follow-up Engine — data-driven next-best-action recommendations.
 *
 * Rules analyze real CRM signals (contacts, deals, tasks, meetings, AI history).
 * No mock data. Recommendations are persisted and de-duplicated via fingerprint.
 */
import { prisma } from "../lib/prisma.js";
import { createNotification } from "./notification.service.js";
import {
  buildCrmScope,
  buildOwnedEntityScope,
  andTenant,
} from "./tenant-scope.service.js";
import { toMoneyNumber, type MoneyInput } from "../lib/money.js";

export type FollowupActionType =
  | "call"
  | "whatsapp"
  | "email"
  | "proposal"
  | "meeting"
  | "wait"
  | "high_priority"
  | "overdue"
  | "close_opportunity";

export type CandidateRec = {
  entityType: "contact" | "deal";
  entityId: string;
  contactId?: string | null;
  dealId?: string | null;
  actionType: FollowupActionType;
  reasonCode: string;
  title: string;
  reason: string;
  priority: "high" | "medium" | "low";
  urgency: "red" | "yellow" | "green";
  confidence: number;
  rankScore: number;
  metadata?: Record<string, unknown>;
  notify?: boolean;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const REFRESH_TTL_MS = 3 * 60 * 1000; // recompute if older than 3 minutes
const COMPLETE_COOLDOWN_DAYS = 3;
const DISMISS_COOLDOWN_DAYS = 5;

function daysSince(d: Date | null | undefined, now: Date): number | null {
  if (!d) return null;
  return Math.floor((now.getTime() - d.getTime()) / DAY_MS);
}

function daysUntil(d: Date | null | undefined, now: Date): number | null {
  if (!d) return null;
  return Math.floor((d.getTime() - now.getTime()) / DAY_MS);
}

function fingerprintOf(
  entityType: string,
  entityId: string,
  actionType: string,
  reasonCode: string
): string {
  return `${entityType}:${entityId}:${actionType}:${reasonCode}`;
}

function isTerminalStatus(status: string): boolean {
  const s = (status || "").toLowerCase();
  return ["won", "lost", "closed_won", "closed_lost", "churned", "dead"].includes(s);
}

function isProposalStage(s: string): boolean {
  const x = (s || "").toLowerCase();
  return x.includes("proposal") || x === "quoted" || x === "quote";
}

function isNegotiation(s: string): boolean {
  const x = (s || "").toLowerCase();
  return x.includes("negotiat") || x === "decision" || x === "closing";
}

/**
 * Build candidate recommendations from live CRM rows (deterministic rules).
 */
function analyzeContact(ctx: {
  contact: {
    id: string;
    name: string;
    type: string;
    status: string;
    phone: string | null;
    email: string | null;
    company: string | null;
    value: MoneyInput;
    aiScore: number | null;
    priority: string | null;
    lastContactedAt: Date | null;
    nextFollowUp: Date | null;
    createdAt: Date;
    updatedAt: Date;
  };
  openTasks: Array<{ id: string; dueDate: Date | null; status: string; title: string }>;
  meetings: Array<{ id: string; scheduledAt: Date; outcome: string | null }>;
  deals: Array<{
    id: string;
    title: string;
    stage: string;
    value: MoneyInput;
    updatedAt: Date;
    expectedClose: Date | null;
  }>;
  lastAiGenAt: Date | null;
  lastWhatsappAt: Date | null;
  lastEmailAt: Date | null;
  now: Date;
}): CandidateRec[] {
  const { contact: c, openTasks, meetings, deals, lastAiGenAt, lastWhatsappAt, lastEmailAt, now } =
    ctx;
  if (isTerminalStatus(c.status)) return [];

  const out: CandidateRec[] = [];
  // Short subject for titles — company/city shown separately in the UI card
  const display = c.name;
  const lastTouch = c.lastContactedAt || c.updatedAt;
  const silentDays = daysSince(lastTouch, now) ?? daysSince(c.createdAt, now) ?? 0;
  const score = c.aiScore ?? 0;
  const value = toMoneyNumber(c.value);
  const hasPhone = !!(c.phone && c.phone.replace(/\D/g, "").length >= 7);
  const hasEmail = !!(c.email && c.email.includes("@"));

  const upcoming = meetings
    .filter((m) => m.scheduledAt.getTime() >= now.getTime())
    .sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());
  const pastMeetings = meetings
    .filter((m) => m.scheduledAt.getTime() < now.getTime())
    .sort((a, b) => b.scheduledAt.getTime() - a.scheduledAt.getTime());
  const overdueTasks = openTasks.filter(
    (t) => t.dueDate && t.dueDate.getTime() < now.getTime() && t.status !== "done"
  );
  const proposalDeal = deals.find((d) => isProposalStage(d.stage));
  const hotDeal = deals.find(
    (d) =>
      isNegotiation(d.stage) ||
      (isProposalStage(d.stage) && toMoneyNumber(d.value) >= 50000) ||
      (daysUntil(d.expectedClose, now) !== null &&
        (daysUntil(d.expectedClose, now) as number) <= 7 &&
        !isTerminalStatus(d.stage))
  );

  // ── Overdue follow-up / lost communication ──────────────────────────────
  if (silentDays >= 6) {
    const action: FollowupActionType = hasPhone ? "call" : hasEmail ? "email" : "whatsapp";
    out.push({
      entityType: "contact",
      entityId: c.id,
      contactId: c.id,
      actionType: silentDays >= 10 ? "overdue" : action,
      reasonCode: `silent_${silentDays >= 10 ? "10" : "6"}d`,
      title:
        silentDays >= 10
          ? `⚠ Overdue follow-up: ${display}`
          : action === "call"
            ? `📞 Call ${display} today`
            : action === "email"
              ? `📧 Send follow-up email to ${display}`
              : `💬 Send WhatsApp to ${display}`,
      reason: `No follow-up in the last ${silentDays} days (last activity ${lastTouch.toISOString().slice(0, 10)}).`,
      priority: silentDays >= 10 || score >= 70 || value >= 25000 ? "high" : "medium",
      urgency: silentDays >= 10 || score >= 80 ? "red" : "yellow",
      confidence: Math.min(0.95, 0.55 + silentDays * 0.03 + (score >= 70 ? 0.1 : 0)),
      rankScore: 70 + Math.min(30, silentDays) + (score >= 70 ? 15 : 0) + (value >= 25000 ? 10 : 0),
      notify: silentDays >= 10 || (silentDays >= 6 && (score >= 70 || value >= 50000)),
      metadata: { silentDays, suggestedChannel: action, buttons: ["call", "whatsapp", "email", "meeting"] },
    });
  }

  // ── High priority / hot lead ────────────────────────────────────────────
  if (score >= 75 || c.priority === "high" || c.priority === "urgent" || value >= 100000) {
    out.push({
      entityType: "contact",
      entityId: c.id,
      contactId: c.id,
      actionType: "high_priority",
      reasonCode: score >= 75 ? "ai_score_hot" : value >= 100000 ? "high_value" : "priority_flag",
      title: `🔥 High priority: ${display}`,
      reason:
        score >= 75
          ? `Lead score is ${score}/100 — treat as a hot opportunity.`
          : value >= 100000
            ? `Deal value ₹${Math.round(value).toLocaleString()} requires focused attention.`
            : `Marked priority “${c.priority}”.`,
      priority: "high",
      urgency: "red",
      confidence: 0.85,
      rankScore: 90 + Math.min(10, Math.floor((score || 0) / 10)),
      notify: true,
      metadata: { aiScore: score, value, buttons: ["call", "whatsapp", "email", "proposal"] },
    });
  }

  // ── New lead — first touch ──────────────────────────────────────────────
  const ageDays = daysSince(c.createdAt, now) ?? 0;
  if (
    ageDays <= 2 &&
    silentDays <= 2 &&
    !c.lastContactedAt &&
    (c.status === "new" || c.status === "contacted")
  ) {
    const firstAction: FollowupActionType = hasPhone ? "whatsapp" : hasEmail ? "email" : "call";
    out.push({
      entityType: "contact",
      entityId: c.id,
      contactId: c.id,
      actionType: firstAction,
      reasonCode: "new_lead_first_touch",
      title:
        firstAction === "whatsapp"
          ? `💬 Send WhatsApp to ${display}`
          : firstAction === "email"
            ? `📧 Introduce yourself to ${display}`
            : `📞 Call ${display} (new lead)`,
      reason: `New ${c.type} created ${ageDays === 0 ? "today" : `${ageDays} day(s) ago`} — first outreach is due.`,
      priority: "medium",
      urgency: "yellow",
      confidence: 0.8,
      rankScore: 60 + (2 - ageDays) * 5,
      metadata: { buttons: ["call", "whatsapp", "email"] },
    });
  }

  // ── Proposal pending ────────────────────────────────────────────────────
  if (isProposalStage(c.status) || proposalDeal) {
    const deal = proposalDeal;
    const stuckDays = daysSince(deal?.updatedAt || c.updatedAt, now) ?? silentDays;
    if (stuckDays >= 2) {
      out.push({
        entityType: deal ? "deal" : "contact",
        entityId: deal?.id || c.id,
        contactId: c.id,
        dealId: deal?.id,
        actionType: "proposal",
        reasonCode: `proposal_pending_${stuckDays}`,
        title: `📄 Proposal pending for ${display}`,
        reason: deal
          ? `Deal “${deal.title}” is in ${deal.stage} with no update for ${stuckDays} day(s).`
          : `Lead status is “${c.status}” — proposal has been pending for ${stuckDays} day(s).`,
        priority: stuckDays >= 5 || value >= 25000 ? "high" : "medium",
        urgency: stuckDays >= 5 ? "red" : "yellow",
        confidence: 0.88,
        rankScore: 75 + Math.min(20, stuckDays),
        notify: stuckDays >= 5,
        metadata: { buttons: ["proposal", "call", "email", "whatsapp"] },
      });
    }
  }

  // ── Opportunity to close ────────────────────────────────────────────────
  if (hotDeal || isNegotiation(c.status)) {
    const deal = hotDeal || deals[0];
    out.push({
      entityType: deal ? "deal" : "contact",
      entityId: deal?.id || c.id,
      contactId: c.id,
      dealId: deal?.id,
      actionType: "close_opportunity",
      reasonCode: "close_window",
      title: `⭐ Opportunity to close: ${display}`,
      reason: deal
        ? `Deal “${deal.title}” is in ${deal.stage}${
            toMoneyNumber(deal.value) > 0
              ? ` (₹${Math.round(toMoneyNumber(deal.value)).toLocaleString()})`
              : ""
          } — push for decision.`
        : `Lead is in ${c.status} — high chance to close if you follow up now.`,
      priority: "high",
      urgency: "red",
      confidence: 0.82,
      rankScore: 88,
      notify: true,
      metadata: { buttons: ["call", "meeting", "proposal", "email"] },
    });
  }

  // ── Overdue tasks ───────────────────────────────────────────────────────
  if (overdueTasks.length > 0) {
    out.push({
      entityType: "contact",
      entityId: c.id,
      contactId: c.id,
      actionType: "overdue",
      reasonCode: `overdue_tasks_${overdueTasks.length}`,
      title: `⚠ ${overdueTasks.length} overdue task(s) for ${display}`,
      reason: `Open task “${overdueTasks[0].title}” is past due. Complete or reschedule follow-up.`,
      priority: "high",
      urgency: "red",
      confidence: 0.9,
      rankScore: 85 + Math.min(10, overdueTasks.length),
      notify: overdueTasks.length >= 2,
      metadata: { buttons: ["call", "whatsapp", "meeting"], taskIds: overdueTasks.map((t) => t.id) },
    });
  }

  // ── Upcoming meeting — prepare ──────────────────────────────────────────
  if (upcoming[0]) {
    const until = daysUntil(upcoming[0].scheduledAt, now) ?? 0;
    if (until <= 1) {
      out.push({
        entityType: "contact",
        entityId: c.id,
        contactId: c.id,
        actionType: until < 0 ? "call" : "meeting",
        reasonCode: `meeting_${until <= 0 ? "today" : "tomorrow"}`,
        title:
          until <= 0
            ? `📅 Meeting today with ${display}`
            : `📅 Meeting tomorrow with ${display}`,
        reason: `Scheduled “${upcoming[0].scheduledAt.toISOString().slice(0, 16)}”. Prepare talking points or confirm attendance.`,
        priority: "high",
        urgency: until <= 0 ? "red" : "yellow",
        confidence: 0.92,
        rankScore: until <= 0 ? 95 : 72,
        notify: until <= 0,
        metadata: { buttons: ["meeting", "call", "whatsapp"], meetingId: upcoming[0].id },
      });
    }
  } else if (pastMeetings[0] && !pastMeetings[0].outcome) {
    const since = daysSince(pastMeetings[0].scheduledAt, now) ?? 0;
    if (since >= 1 && since <= 7) {
      out.push({
        entityType: "contact",
        entityId: c.id,
        contactId: c.id,
        actionType: "email",
        reasonCode: "post_meeting_followup",
        title: `📧 Post-meeting follow-up: ${display}`,
        reason: `Meeting on ${pastMeetings[0].scheduledAt.toISOString().slice(0, 10)} has no outcome logged — send a recap and next steps.`,
        priority: "medium",
        urgency: "yellow",
        confidence: 0.78,
        rankScore: 65,
        metadata: { buttons: ["email", "whatsapp", "call", "proposal"] },
      });
    }
  }

  // ── Schedule meeting if qualified & no upcoming ─────────────────────────
  if (
    !upcoming.length &&
    ["qualified", "proposal", "contacted"].includes((c.status || "").toLowerCase()) &&
    silentDays >= 3 &&
    silentDays < 6
  ) {
    out.push({
      entityType: "contact",
      entityId: c.id,
      contactId: c.id,
      actionType: "meeting",
      reasonCode: "schedule_meeting",
      title: `📅 Schedule meeting with ${display}`,
      reason: `Status “${c.status}” with ${silentDays} day(s) since last touch and no upcoming meeting.`,
      priority: "medium",
      urgency: "green",
      confidence: 0.7,
      rankScore: 55,
      metadata: { buttons: ["meeting", "call", "whatsapp"] },
    });
  }

  // ── Wait signal (recent contact + upcoming meeting far out) ─────────────
  if (silentDays <= 1 && upcoming[0] && (daysUntil(upcoming[0].scheduledAt, now) ?? 0) >= 2) {
    const waitDays = Math.min(3, daysUntil(upcoming[0].scheduledAt, now) ?? 2);
    out.push({
      entityType: "contact",
      entityId: c.id,
      contactId: c.id,
      actionType: "wait",
      reasonCode: `wait_${waitDays}d`,
      title: `⏳ Wait ${waitDays} day(s) — ${display}`,
      reason: `Recently contacted and next meeting is scheduled. Avoid over-messaging.`,
      priority: "low",
      urgency: "green",
      confidence: 0.75,
      rankScore: 20,
      metadata: { buttons: ["meeting"] },
    });
  }

  // ── Lost AI/comms channel ───────────────────────────────────────────────
  const daysSinceWa = daysSince(lastWhatsappAt, now);
  const daysSinceMail = daysSince(lastEmailAt, now);
  if (
    hasPhone &&
    silentDays >= 4 &&
    (daysSinceWa === null || daysSinceWa >= 7) &&
    !out.some((r) => r.actionType === "whatsapp")
  ) {
    out.push({
      entityType: "contact",
      entityId: c.id,
      contactId: c.id,
      actionType: "whatsapp",
      reasonCode: "lost_whatsapp_comms",
      title: `💬 Send WhatsApp follow-up to ${display}`,
      reason:
        daysSinceWa == null
          ? "No WhatsApp outreach on record for this lead."
          : `Last WhatsApp was ${daysSinceWa} day(s) ago — re-engage on chat.`,
      priority: "medium",
      urgency: "yellow",
      confidence: 0.72,
      rankScore: 58,
      metadata: { buttons: ["whatsapp", "call", "email"] },
    });
  }

  if (
    hasEmail &&
    silentDays >= 5 &&
    (daysSinceMail === null || daysSinceMail >= 8) &&
    !out.some((r) => r.actionType === "email")
  ) {
    out.push({
      entityType: "contact",
      entityId: c.id,
      contactId: c.id,
      actionType: "email",
      reasonCode: "lost_email_comms",
      title: `📧 Send follow-up email to ${display}`,
      reason:
        daysSinceMail == null
          ? "No email outreach recorded — a written follow-up can reopen the conversation."
          : `Last email was ${daysSinceMail} day(s) ago.`,
      priority: "medium",
      urgency: "yellow",
      confidence: 0.7,
      rankScore: 56,
      metadata: { buttons: ["email", "call", "whatsapp"] },
    });
  }

  // Prefer one primary rec per contact for list density — keep top by rank
  // (engine still stores multiple if different fingerprints; dashboard shows top N)
  void lastAiGenAt;
  return out;
}

function analyzeDealOnly(ctx: {
  deal: {
    id: string;
    title: string;
    stage: string;
    value: MoneyInput;
    probability: number | null;
    expectedClose: Date | null;
    updatedAt: Date;
    contactId: string | null;
    contact?: { id: string; name: string; company: string | null } | null;
  };
  now: Date;
}): CandidateRec[] {
  const { deal: d, now } = ctx;
  if (isTerminalStatus(d.stage)) return [];
  const out: CandidateRec[] = [];
  // Keep titles short; contact name/company shown in UI card
  const label = d.contact?.name || d.title;
  const silentDays = daysSince(d.updatedAt, now) ?? 0;
  const closeIn = daysUntil(d.expectedClose, now);

  if (isProposalStage(d.stage) && silentDays >= 3) {
    out.push({
      entityType: "deal",
      entityId: d.id,
      contactId: d.contactId,
      dealId: d.id,
      actionType: "proposal",
      reasonCode: "deal_proposal_stale",
      title: `📄 Proposal pending: ${label}`,
      reason: `Deal stage “${d.stage}” unchanged for ${silentDays} day(s).`,
      priority: silentDays >= 5 ? "high" : "medium",
      urgency: silentDays >= 5 ? "red" : "yellow",
      confidence: 0.86,
      rankScore: 74 + Math.min(15, silentDays),
      notify: silentDays >= 5,
      metadata: { buttons: ["proposal", "call", "email"] },
    });
  }

  if (
    (isNegotiation(d.stage) || (d.probability != null && d.probability >= 70)) &&
    silentDays >= 2
  ) {
    out.push({
      entityType: "deal",
      entityId: d.id,
      contactId: d.contactId,
      dealId: d.id,
      actionType: "close_opportunity",
      reasonCode: "deal_close_push",
      title: `⭐ Opportunity to close: ${label}`,
      reason: `Stage “${d.stage}”${d.probability != null ? `, win probability ${d.probability}%` : ""}${
        toMoneyNumber(d.value) > 0
          ? `, value ₹${Math.round(toMoneyNumber(d.value)).toLocaleString()}`
          : ""
      }.`,
      priority: "high",
      urgency: "red",
      confidence: 0.84,
      rankScore: 90,
      notify: true,
      metadata: { buttons: ["call", "meeting", "proposal"] },
    });
  }

  if (closeIn !== null && closeIn <= 5 && closeIn >= 0) {
    out.push({
      entityType: "deal",
      entityId: d.id,
      contactId: d.contactId,
      dealId: d.id,
      actionType: "call",
      reasonCode: "expected_close_soon",
      title: `📞 Close window: ${label}`,
      reason: `Expected close in ${closeIn} day(s) — confirm decision timeline.`,
      priority: "high",
      urgency: closeIn <= 2 ? "red" : "yellow",
      confidence: 0.8,
      rankScore: 80 + (5 - closeIn),
      notify: closeIn <= 2,
      metadata: { buttons: ["call", "meeting", "email"] },
    });
  }

  return out;
}

async function loadBusinessId(userId: string): Promise<string | null> {
  const m = await prisma.businessMember.findFirst({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: { businessId: true },
  });
  return m?.businessId ?? null;
}

/**
 * Recompute recommendations for a user from live CRM data and upsert into DB.
 */
export async function refreshFollowupEngine(
  userId: string,
  opts?: { force?: boolean }
): Promise<{ generated: number; active: number; notified: number }> {
  // Throttle unless force
  if (!opts?.force) {
    const latest = await prisma.aiRecommendation.findFirst({
      where: { userId },
      orderBy: { updatedAt: "desc" },
      select: { updatedAt: true },
    });
    if (latest && Date.now() - latest.updatedAt.getTime() < REFRESH_TTL_MS) {
      const active = await prisma.aiRecommendation.count({
        where: { userId, status: "active" },
      });
      return { generated: 0, active, notified: 0 };
    }
  }

  const now = new Date();
  const businessId = await loadBusinessId(userId);
  // Contact scope may include assignedTo; deal/task/meeting must NOT (no such field)
  const contactScope = await buildCrmScope(userId);
  const ownedScope = await buildOwnedEntityScope(userId);

  const [contacts, deals, tasks, meetings, aiGens] = await Promise.all([
    prisma.contact.findMany({
      where: andTenant(contactScope.where, {
        status: { notIn: ["won", "lost", "churned"] },
      }) as never,
      take: 300,
      orderBy: { updatedAt: "desc" },
    }),
    prisma.deal.findMany({
      where: andTenant(ownedScope.where, {
        stage: { notIn: ["closed_won", "closed_lost", "won", "lost"] },
      }) as never,
      include: { contact: { select: { id: true, name: true, company: true } } },
      take: 200,
      orderBy: { updatedAt: "desc" },
    }),
    prisma.task.findMany({
      where: andTenant(ownedScope.where, { status: { not: "done" } }) as never,
      take: 400,
    }),
    prisma.meeting.findMany({
      where: andTenant(ownedScope.where, {}) as never,
      take: 400,
      orderBy: { scheduledAt: "desc" },
    }),
    prisma.aiGeneration.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 200,
      select: { contactId: true, feature: true, createdAt: true },
    }),
  ]);

  // Completed/dismissed fingerprints still in cooldown
  const cooldownSince = new Date(now.getTime() - COMPLETE_COOLDOWN_DAYS * DAY_MS);
  const dismissSince = new Date(now.getTime() - DISMISS_COOLDOWN_DAYS * DAY_MS);
  const blocked = await prisma.aiRecommendation.findMany({
    where: {
      userId,
      OR: [
        { status: "completed", completedAt: { gte: cooldownSince } },
        { status: "dismissed", dismissedAt: { gte: dismissSince } },
      ],
    },
    select: { fingerprint: true },
  });
  const blockedSet = new Set(blocked.map((b) => b.fingerprint));

  const candidates: CandidateRec[] = [];

  for (const c of contacts) {
    const cTasks = tasks.filter((t) => t.contactId === c.id);
    const cMeetings = meetings.filter((m) => m.contactId === c.id);
    const cDeals = deals.filter((d) => d.contactId === c.id);
    const gens = aiGens.filter((g) => g.contactId === c.id);
    const lastAi = gens[0]?.createdAt ?? null;
    const lastWa =
      gens.find((g) => g.feature === "whatsapp" || g.feature === "whatsapp_message")?.createdAt ??
      null;
    const lastEm = gens.find((g) => g.feature === "email")?.createdAt ?? null;

    candidates.push(
      ...analyzeContact({
        contact: c,
        openTasks: cTasks,
        meetings: cMeetings,
        deals: cDeals,
        lastAiGenAt: lastAi,
        lastWhatsappAt: lastWa,
        lastEmailAt: lastEm,
        now,
      })
    );
  }

  // Deals without contact already covered still get deal-only rules once
  for (const d of deals) {
    if (d.contactId && contacts.some((c) => c.id === d.contactId)) {
      // still run deal-only for close/proposal signals (may duplicate fingerprints — OK, upsert)
    }
    candidates.push(...analyzeDealOnly({ deal: d, now }));
  }

  // Dedupe by fingerprint keep highest rank
  const byFp = new Map<string, CandidateRec>();
  for (const cand of candidates) {
    const fp = fingerprintOf(cand.entityType, cand.entityId, cand.actionType, cand.reasonCode);
    if (blockedSet.has(fp)) continue;
    const prev = byFp.get(fp);
    if (!prev || cand.rankScore > prev.rankScore) byFp.set(fp, cand);
  }

  const final = Array.from(byFp.entries()).map(([fp, c]) => ({ fp, c }));
  let notified = 0;

  // Supersede actives that no longer apply
  const activeExisting = await prisma.aiRecommendation.findMany({
    where: { userId, status: "active" },
    select: { id: true, fingerprint: true },
  });
  const nextFps = new Set(final.map((f) => f.fp));
  const toExpire = activeExisting.filter((a) => !nextFps.has(a.fingerprint));
  if (toExpire.length) {
    await prisma.aiRecommendation.updateMany({
      where: { id: { in: toExpire.map((t) => t.id) } },
      data: { status: "superseded", updatedAt: now },
    });
  }

  for (const { fp, c } of final) {
    const existing = await prisma.aiRecommendation.findUnique({
      where: { userId_fingerprint: { userId, fingerprint: fp } },
    });

    if (existing && (existing.status === "completed" || existing.status === "dismissed")) {
      // Cooldown already filtered; if still here, re-open only if outside cooldown handled
      continue;
    }

    if (existing && existing.status === "active") {
      await prisma.aiRecommendation.update({
        where: { id: existing.id },
        data: {
          title: c.title,
          reason: c.reason,
          priority: c.priority,
          urgency: c.urgency,
          confidence: c.confidence,
          rankScore: c.rankScore,
          metadata: c.metadata as object,
          lastSignalAt: now,
          contactId: c.contactId ?? existing.contactId,
          dealId: c.dealId ?? existing.dealId,
          businessId,
        },
      });
    } else if (existing) {
      await prisma.aiRecommendation.update({
        where: { id: existing.id },
        data: {
          status: "active",
          title: c.title,
          reason: c.reason,
          priority: c.priority,
          urgency: c.urgency,
          confidence: c.confidence,
          rankScore: c.rankScore,
          metadata: c.metadata as object,
          lastSignalAt: now,
          completedAt: null,
          dismissedAt: null,
          contactId: c.contactId ?? null,
          dealId: c.dealId ?? null,
          businessId,
        },
      });
    } else {
      // Upsert avoids P2002 races when concurrent refreshes share a fingerprint
      const created = await prisma.aiRecommendation.upsert({
        where: { userId_fingerprint: { userId, fingerprint: fp } },
        create: {
          userId,
          businessId,
          entityType: c.entityType,
          entityId: c.entityId,
          contactId: c.contactId ?? null,
          dealId: c.dealId ?? null,
          actionType: c.actionType,
          reasonCode: c.reasonCode,
          fingerprint: fp,
          title: c.title,
          reason: c.reason,
          priority: c.priority,
          urgency: c.urgency,
          confidence: c.confidence,
          rankScore: c.rankScore,
          status: "active",
          metadata: c.metadata as object,
          lastSignalAt: now,
          expiresAt: new Date(now.getTime() + 14 * DAY_MS),
        },
        update: {
          title: c.title,
          reason: c.reason,
          priority: c.priority,
          urgency: c.urgency,
          confidence: c.confidence,
          rankScore: c.rankScore,
          metadata: c.metadata as object,
          lastSignalAt: now,
          status: "active",
          contactId: c.contactId ?? null,
          dealId: c.dealId ?? null,
          businessId,
        },
      });

      // Important-only notifications
      if (c.notify && c.priority === "high") {
        try {
          // Avoid duplicate AI notifs for same fingerprint in last 24h
          const recent = await prisma.notification.findFirst({
            where: {
              userId,
              type: "ai_recommendation",
              entityId: created.id,
              createdAt: { gte: new Date(now.getTime() - DAY_MS) },
            },
          });
          if (!recent) {
            await createNotification({
              userId,
              type: "ai_recommendation",
              title: `AI: ${c.title.replace(/^[^\w]*\s*/, "").slice(0, 80)}`,
              message: c.reason.slice(0, 240),
              entityType: c.entityType,
              entityId: c.contactId || c.entityId,
            });
            await prisma.aiRecommendation.update({
              where: { id: created.id },
              data: { notifiedAt: now },
            });
            notified++;
          }
        } catch (e) {
          console.error("[followup-engine] notify failed", e);
        }
      }
    }
  }

  const active = await prisma.aiRecommendation.count({
    where: { userId, status: "active" },
  });

  return { generated: final.length, active, notified };
}

export async function listFollowupRecommendations(
  userId: string,
  opts?: {
    limit?: number;
    contactId?: string;
    forceRefresh?: boolean;
    priority?: string;
  }
) {
  await refreshFollowupEngine(userId, { force: opts?.forceRefresh });

  const where: {
    userId: string;
    status: string;
    contactId?: string;
    priority?: string;
  } = { userId, status: "active" };
  if (opts?.contactId) where.contactId = opts.contactId;
  if (opts?.priority) where.priority = opts.priority;

  const items = await prisma.aiRecommendation.findMany({
    where,
    orderBy: [{ rankScore: "desc" }, { updatedAt: "desc" }],
    take: opts?.limit ?? 80,
  });

  // Priority: High → Medium → Low, then rankScore
  const priorityRank: Record<string, number> = { high: 0, medium: 1, low: 2 };
  items.sort((a, b) => {
    const pa = priorityRank[a.priority] ?? 9;
    const pb = priorityRank[b.priority] ?? 9;
    if (pa !== pb) return pa - pb;
    return (b.rankScore || 0) - (a.rankScore || 0);
  });
  const limited = items.slice(0, opts?.limit ?? 50);

  // Enrich with contact names / company / city
  const contactIds = [...new Set(limited.map((i) => i.contactId).filter(Boolean))] as string[];
  const contacts = contactIds.length
    ? await prisma.contact.findMany({
        where: { id: { in: contactIds } },
        select: {
          id: true,
          name: true,
          company: true,
          phone: true,
          email: true,
          status: true,
          aiScore: true,
          type: true,
          value: true,
          description: true,
          customFields: true,
        },
      })
    : [];
  const contactMap = new Map(
    contacts.map((c) => [
      c.id,
      {
        ...c,
        city: extractCity(c.customFields, c.description),
      },
    ])
  );

  return limited.map((i) => ({
    ...i,
    contact: i.contactId ? contactMap.get(i.contactId) || null : null,
    buttons: ((i.metadata as { buttons?: string[] } | null)?.buttons ||
      defaultButtons(i.actionType)) as string[],
  }));
}

/** City from customFields.city / district or "District: X" in description — not full address */
function extractCity(
  customFields: unknown,
  description: string | null | undefined
): string | null {
  if (customFields && typeof customFields === "object" && !Array.isArray(customFields)) {
    const cf = customFields as Record<string, unknown>;
    for (const key of ["city", "district", "location", "town"]) {
      const v = cf[key];
      if (v != null && String(v).trim()) {
        // First segment only if looks like multi-part address
        const s = String(v).trim().split(/[|,]/)[0]?.trim() || "";
        if (s && s.length <= 48) return s;
        if (s) return s.slice(0, 48);
      }
    }
  }
  if (description) {
    const d = description.match(/District:\s*([^|]+)/i);
    if (d?.[1]?.trim()) return d[1].trim().slice(0, 48);
    const city = description.match(/City:\s*([^|,\n]+)/i);
    if (city?.[1]?.trim()) return city[1].trim().slice(0, 48);
  }
  return null;
}

function defaultButtons(actionType: string): string[] {
  switch (actionType) {
    case "proposal":
      return ["proposal", "call", "email", "whatsapp"];
    case "meeting":
      return ["meeting", "call", "whatsapp"];
    case "email":
      return ["email", "call", "whatsapp"];
    case "whatsapp":
      return ["whatsapp", "call", "email"];
    case "close_opportunity":
      return ["call", "meeting", "proposal", "email"];
    case "wait":
      return ["meeting"];
    default:
      return ["call", "whatsapp", "email", "proposal", "meeting"];
  }
}

export async function getContactFollowupRecommendation(
  userId: string,
  contactId: string,
  opts?: { forceRefresh?: boolean }
) {
  const list = await listFollowupRecommendations(userId, {
    contactId,
    limit: 5,
    forceRefresh: opts?.forceRefresh,
  });
  return {
    primary: list[0] || null,
    alternatives: list.slice(1),
  };
}

export async function getTodayAiActionsSummary(userId: string) {
  await refreshFollowupEngine(userId);

  const active = await prisma.aiRecommendation.findMany({
    where: { userId, status: "active" },
    select: {
      id: true,
      actionType: true,
      title: true,
      contactId: true,
      dealId: true,
      entityType: true,
      entityId: true,
      urgency: true,
      priority: true,
      rankScore: true,
    },
    orderBy: { rankScore: "desc" },
    take: 100,
  });
  const priorityRank: Record<string, number> = { high: 0, medium: 1, low: 2 };
  active.sort((a, b) => {
    const pa = priorityRank[a.priority] ?? 9;
    const pb = priorityRank[b.priority] ?? 9;
    if (pa !== pb) return pa - pb;
    return (b.rankScore || 0) - (a.rankScore || 0);
  });

  const buckets: Record<string, typeof active> = {
    call: [],
    whatsapp: [],
    email: [],
    proposal: [],
    meeting: [],
    other: [],
  };

  for (const r of active) {
    const key = ["call", "whatsapp", "email", "proposal", "meeting"].includes(r.actionType)
      ? r.actionType
      : r.actionType === "close_opportunity" || r.actionType === "high_priority" || r.actionType === "overdue"
        ? "call"
        : "other";
    buckets[key].push(r);
  }

  return {
    counts: {
      call: buckets.call.length,
      whatsapp: buckets.whatsapp.length,
      email: buckets.email.length,
      proposal: buckets.proposal.length,
      meeting: buckets.meeting.length,
      total: active.length,
    },
    buckets: {
      call: buckets.call.slice(0, 10),
      whatsapp: buckets.whatsapp.slice(0, 10),
      email: buckets.email.slice(0, 10),
      proposal: buckets.proposal.slice(0, 10),
      meeting: buckets.meeting.slice(0, 10),
    },
  };
}

export async function completeRecommendation(
  userId: string,
  recommendationId: string,
  actionTaken: string,
  notes?: string
) {
  const rec = await prisma.aiRecommendation.findFirst({
    where: { id: recommendationId, userId },
  });
  if (!rec) throw new Error("Recommendation not found");

  const now = new Date();
  await prisma.aiRecommendationAction.create({
    data: {
      recommendationId: rec.id,
      userId,
      actionTaken,
      notes: notes || null,
    },
  });

  const dismiss = actionTaken === "dismiss" || actionTaken === "snooze";
  await prisma.aiRecommendation.update({
    where: { id: rec.id },
    data: dismiss
      ? { status: "dismissed", dismissedAt: now }
      : { status: "completed", completedAt: now },
  });

  // Touch contact lastContactedAt when real outreach happened
  if (
    rec.contactId &&
    ["call", "whatsapp", "email", "proposal", "meeting", "complete"].includes(actionTaken)
  ) {
    try {
      await prisma.contact.update({
        where: { id: rec.contactId },
        data: { lastContactedAt: now },
      });
    } catch {
      /* ignore */
    }
  }

  return { success: true, status: dismiss ? "dismissed" : "completed" };
}

/** Batch map: contactId → primary active recommendation (for leads list) */
export async function mapRecommendationsForContacts(
  userId: string,
  contactIds: string[]
): Promise<Record<string, Awaited<ReturnType<typeof listFollowupRecommendations>>[0]>> {
  if (!contactIds.length) return {};
  await refreshFollowupEngine(userId);

  const items = await prisma.aiRecommendation.findMany({
    where: {
      userId,
      status: "active",
      contactId: { in: contactIds },
    },
    orderBy: { rankScore: "desc" },
  });

  const map: Record<string, (typeof items)[0] & { buttons: string[] }> = {};
  for (const i of items) {
    if (!i.contactId || map[i.contactId]) continue;
    map[i.contactId] = {
      ...i,
      buttons: ((i.metadata as { buttons?: string[] } | null)?.buttons ||
        defaultButtons(i.actionType)) as string[],
    };
  }
  return map as never;
}

/** Fire-and-forget refresh after CRM mutations */
export function scheduleFollowupRefresh(userId: string) {
  setImmediate(() => {
    refreshFollowupEngine(userId, { force: true }).catch((e) =>
      console.error("[followup-engine] background refresh failed", e)
    );
  });
}
