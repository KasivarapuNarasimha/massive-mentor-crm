/**
 * Single pipeline sync service — keeps Lead (Contact), Client, Deal, and
 * Pipeline stages consistent after status/stage changes.
 *
 * Used by: updateContact, bulkEditLeads, updateDeal.
 * Avoids circular updates via `source` flag.
 */
import { prisma } from "@/lib/prisma";
import { notifyUser } from "@/services/notification.service";
import { logActivity } from "@/services/activity.service";
import { recordAudit } from "@/services/audit.service";
import { scheduleFollowupRefresh } from "@/services/followup-engine.service";
import { getUserBusinessId } from "@/services/field-engine.service";

export type PipelineSyncResult = {
  dealsUpdated: number;
  dealCreated: boolean;
  dealIds: string[];
  contactConvertedToClient: boolean;
  contactStatusSynced: boolean;
  promptCreateDeal: boolean;
  messages: string[];
};

export type PipelineSyncSettings = {
  /** Auto-create a deal when lead reaches qualified/proposal/won and none exists */
  autoCreateDeal: boolean;
  /** Convert lead → client when status becomes won (or deal closed_won) */
  convertLeadToClientOnWon: boolean;
  /** Do not regress closed deals when lead moves earlier in pipeline */
  protectClosedDeals: boolean;
};

const DEFAULT_SETTINGS: PipelineSyncSettings = {
  autoCreateDeal: true,
  convertLeadToClientOnWon: true,
  protectClosedDeals: true,
};

/** Lead status → Deal stage (business rules) */
const LEAD_STATUS_TO_DEAL_STAGE: Record<string, string> = {
  new: "lead",
  contacted: "lead",
  qualified: "qualified",
  proposal: "proposal",
  negotiation: "negotiation",
  won: "closed_won",
  lost: "closed_lost",
  // client lifecycle
  active: "closed_won",
  churned: "closed_lost",
};

/** Deal stage → Lead/Client status */
const DEAL_STAGE_TO_LEAD: Record<
  string,
  { status: string; type?: "lead" | "client"; probability?: number }
> = {
  lead: { status: "contacted", type: "lead", probability: 10 },
  qualified: { status: "qualified", type: "lead", probability: 30 },
  proposal: { status: "proposal", type: "lead", probability: 50 },
  negotiation: { status: "proposal", type: "lead", probability: 70 },
  closed_won: { status: "won", type: "client", probability: 100 },
  closed_lost: { status: "lost", type: "lead", probability: 0 },
  won: { status: "won", type: "client", probability: 100 },
  lost: { status: "lost", type: "lead", probability: 0 },
};

const STAGE_ORDER = [
  "lead",
  "qualified",
  "proposal",
  "negotiation",
  "closed_won",
  "closed_lost",
];

const STATUS_ORDER = [
  "new",
  "contacted",
  "qualified",
  "proposal",
  "negotiation",
  "won",
  "lost",
];

function norm(s: string | null | undefined): string {
  return (s || "").trim().toLowerCase().replace(/\s+/g, "_");
}

export function mapLeadStatusToDealStage(status: string): string | null {
  const s = norm(status);
  if (!s) return null;
  if (LEAD_STATUS_TO_DEAL_STAGE[s]) return LEAD_STATUS_TO_DEAL_STAGE[s];
  // Template isWon keys
  if (/^won$|closed_won|converted|customer|enrolled/.test(s)) return "closed_won";
  if (/^lost$|closed_lost|dead|rejected|churned/.test(s)) return "closed_lost";
  if (/qualified|hot|warm/.test(s)) return "qualified";
  if (/proposal|quote|pitched/.test(s)) return "proposal";
  if (/negotiat/.test(s)) return "negotiation";
  if (/contact|outreach|called/.test(s)) return "lead";
  return null;
}

export function mapDealStageToLeadStatus(stage: string): {
  status: string;
  type?: "lead" | "client";
  probability?: number;
} | null {
  const s = norm(stage);
  if (!s) return null;
  if (DEAL_STAGE_TO_LEAD[s]) return DEAL_STAGE_TO_LEAD[s];
  if (/won|closed_won/.test(s)) return { status: "won", type: "client", probability: 100 };
  if (/lost|closed_lost/.test(s)) return { status: "lost", type: "lead", probability: 0 };
  return null;
}

export function isWonStatus(status: string): boolean {
  const s = norm(status);
  return s === "won" || s === "closed_won" || s === "active" || /converted|customer/.test(s);
}

export function isLostStatus(status: string): boolean {
  const s = norm(status);
  return s === "lost" || s === "closed_lost" || s === "churned" || s === "dead";
}

export function isClosedDealStage(stage: string): boolean {
  const s = norm(stage);
  return /closed_won|closed_lost|^won$|^lost$/.test(s);
}

function stageRank(stage: string): number {
  const s = norm(stage);
  const i = STAGE_ORDER.indexOf(s);
  return i >= 0 ? i : 0;
}

async function loadSettings(businessId: string | null | undefined): Promise<PipelineSyncSettings> {
  if (!businessId) return { ...DEFAULT_SETTINGS };
  const biz = await prisma.business.findUnique({
    where: { id: businessId },
    select: { settings: true },
  });
  const raw = (biz?.settings || {}) as Record<string, unknown>;
  const ps = (raw.pipelineSync || raw.pipeline_sync || {}) as Record<string, unknown>;
  return {
    autoCreateDeal:
      ps.autoCreateDeal !== undefined
        ? !!ps.autoCreateDeal
        : raw.autoCreateDealOnLead !== undefined
          ? !!raw.autoCreateDealOnLead
          : DEFAULT_SETTINGS.autoCreateDeal,
    convertLeadToClientOnWon:
      ps.convertLeadToClientOnWon !== undefined
        ? !!ps.convertLeadToClientOnWon
        : DEFAULT_SETTINGS.convertLeadToClientOnWon,
    protectClosedDeals:
      ps.protectClosedDeals !== undefined
        ? !!ps.protectClosedDeals
        : DEFAULT_SETTINGS.protectClosedDeals,
  };
}

function emptyResult(): PipelineSyncResult {
  return {
    dealsUpdated: 0,
    dealCreated: false,
    dealIds: [],
    contactConvertedToClient: false,
    contactStatusSynced: false,
    promptCreateDeal: false,
    messages: [],
  };
}

/**
 * After a Lead/Contact status change: update linked deals, optionally auto-create,
 * convert to client on won.
 */
export async function syncFromLeadStatusChange(
  userId: string,
  contact: {
    id: string;
    name: string;
    type: string;
    status: string;
    value?: number | null;
    company?: string | null;
    businessId?: string | null;
    userId: string;
  },
  previousStatus: string,
  options?: { force?: boolean }
): Promise<PipelineSyncResult> {
  const result = emptyResult();
  const prev = norm(previousStatus);
  const next = norm(contact.status);
  if (!options?.force && prev === next) return result;

  const targetStage = mapLeadStatusToDealStage(contact.status);
  if (!targetStage) return result;

  const businessId =
    contact.businessId || (await getUserBusinessId(userId)) || null;
  const settings = await loadSettings(businessId);

  // Convert lead → client on won
  if (
    settings.convertLeadToClientOnWon &&
    isWonStatus(contact.status) &&
    contact.type === "lead"
  ) {
    // Client lifecycle uses "active"; deal carries closed_won
    await prisma.contact.update({
      where: { id: contact.id },
      data: { type: "client", status: "active" },
    });
    result.contactConvertedToClient = true;
    result.messages.push(`Lead "${contact.name}" converted to Client (active)`);
    await notifyUser(userId, {
      type: "activity",
      title: "Lead converted to Client",
      message: `"${contact.name}" marked won and converted to client`,
      entityType: "contact",
      entityId: contact.id,
    }).catch(() => {});
  }

  const probability =
    targetStage === "closed_won"
      ? 100
      : targetStage === "closed_lost"
        ? 0
        : targetStage === "negotiation"
          ? 70
          : targetStage === "proposal"
            ? 50
            : targetStage === "qualified"
              ? 30
              : 10;

  // All deals already linked to this contact (tenant-scoped)
  let deals = await prisma.deal.findMany({
    where: {
      contactId: contact.id,
      ...(businessId
        ? { OR: [{ businessId }, { userId }] }
        : { userId }),
    },
    orderBy: { updatedAt: "desc" },
  });

  // Adopt orphan open deals by title match — only in non-production (risky fuzzy match).
  // Production requires explicit contactId linkage to avoid wrong re-links.
  const allowOrphanMatch = process.env.NODE_ENV !== "production";
  if (
    allowOrphanMatch &&
    (deals.length === 0 || isWonStatus(contact.status) || isLostStatus(contact.status))
  ) {
    const namePart = (contact.name || "").trim();
    const companyPart = (contact.company || "").trim();
    const orphanWhere: Record<string, unknown> = {
      contactId: null,
      ...(businessId
        ? { OR: [{ businessId }, { userId }] }
        : { userId }),
    };
    if (!isWonStatus(contact.status) && !isLostStatus(contact.status)) {
      orphanWhere.stage = {
        notIn: ["closed_won", "closed_lost", "won", "lost"],
      };
    }
    const orphans = await prisma.deal.findMany({
      where: orphanWhere as never,
      orderBy: { updatedAt: "desc" },
      take: 25,
    });
    const matched = orphans.filter((d) => {
      const t = (d.title || "").toLowerCase();
      if (companyPart && t.includes(companyPart.toLowerCase())) return true;
      if (namePart && t.includes(namePart.toLowerCase())) return true;
      return false;
    });
    for (const o of matched) {
      await prisma.deal.update({
        where: { id: o.id },
        data: { contactId: contact.id },
      });
    }
    if (matched.length) {
      deals = await prisma.deal.findMany({
        where: {
          contactId: contact.id,
          ...(businessId
            ? { OR: [{ businessId }, { userId }] }
            : { userId }),
        },
        orderBy: { updatedAt: "desc" },
      });
      result.messages.push(`Linked ${matched.length} orphan deal(s) to contact`);
    }
  }

  if (deals.length === 0) {
    const shouldCreate =
      settings.autoCreateDeal &&
      (isWonStatus(contact.status) ||
        ["qualified", "proposal", "negotiation"].includes(next));

    if (shouldCreate) {
      const title =
        contact.company?.trim()
          ? `${contact.company} — ${contact.name}`
          : `Deal: ${contact.name}`;
      const created = await prisma.deal.create({
        data: {
          userId: contact.userId || userId,
          businessId,
          contactId: contact.id,
          title,
          value: contact.value ?? null,
          stage: targetStage,
          probability,
          notes: `Auto-created from lead status → ${contact.status}`,
          customFields: { autoCreatedFromLead: true, leadStatus: contact.status },
        },
      });
      result.dealCreated = true;
      result.dealIds.push(created.id);
      result.messages.push(`Deal created at stage ${targetStage}`);
      await notifyUser(userId, {
        type: isWonStatus(contact.status) ? "deal_won" : "activity",
        title: isWonStatus(contact.status) ? "Deal won (auto)" : "Deal created",
        message: `Deal "${created.title}" ${
          isWonStatus(contact.status) ? "closed won" : `opened at ${targetStage}`
        } from lead status`,
        entityType: "deal",
        entityId: created.id,
      }).catch(() => {});
      await logActivity({
        userId,
        entityType: "deal",
        entityId: created.id,
        action: "auto_created_from_lead",
        details: { contactId: contact.id, stage: targetStage, leadStatus: contact.status },
      }).catch(() => {});
    } else if (
      isWonStatus(contact.status) ||
      ["qualified", "proposal", "negotiation"].includes(next)
    ) {
      result.promptCreateDeal = true;
      result.messages.push("No linked deal — enable auto-create or create a deal manually");
    }
  } else {
    const terminal = isWonStatus(contact.status) || isLostStatus(contact.status);

    for (const deal of deals) {
      // Terminal lead outcomes always force every linked deal into one stage
      // (prevents "Lead" + "Closed Won" dual-column ghosts for the same contact).
      if (!terminal) {
        if (settings.protectClosedDeals && isClosedDealStage(deal.stage)) {
          const allow =
            (isWonStatus(contact.status) && /lost|closed_lost/i.test(deal.stage)) ||
            (isLostStatus(contact.status) && /won|closed_won/i.test(deal.stage));
          if (!allow && norm(deal.stage) === norm(targetStage)) continue;
          if (!allow) continue;
        }

        if (
          settings.protectClosedDeals &&
          stageRank(deal.stage) > stageRank(targetStage) &&
          isClosedDealStage(deal.stage)
        ) {
          continue;
        }
      }

      if (norm(deal.stage) === norm(targetStage) && deal.contactId === contact.id) {
        // Already correct stage — still normalize aliases (won → closed_won)
        if (deal.stage !== targetStage) {
          await prisma.deal.update({
            where: { id: deal.id },
            data: { stage: targetStage, probability },
          });
          result.dealsUpdated++;
          result.dealIds.push(deal.id);
        }
        continue;
      }

      const updated = await prisma.deal.update({
        where: { id: deal.id },
        data: {
          contactId: contact.id,
          stage: targetStage,
          probability,
          ...(contact.value != null && deal.value == null ? { value: contact.value } : {}),
        },
      });
      result.dealsUpdated++;
      result.dealIds.push(updated.id);
      result.messages.push(`Deal "${updated.title}" → ${targetStage}`);

      if (isWonStatus(contact.status) || /closed_won|won/i.test(targetStage)) {
        await notifyUser(userId, {
          type: "deal_won",
          title: "Deal won",
          message: `Deal "${updated.title}" moved to ${targetStage} (lead won)`,
          entityType: "deal",
          entityId: updated.id,
        }).catch(() => {});
      } else if (isLostStatus(contact.status) || /closed_lost|lost/i.test(targetStage)) {
        await notifyUser(userId, {
          type: "deal_lost",
          title: "Deal lost",
          message: `Deal "${updated.title}" moved to ${targetStage} (lead lost)`,
          entityType: "deal",
          entityId: updated.id,
        }).catch(() => {});
      }
    }
  }

  if (result.dealsUpdated || result.dealCreated || result.contactConvertedToClient) {
    await recordAudit({
      businessId,
      actorUserId: userId,
      action: "pipeline_sync_from_lead",
      entityType: "contact",
      entityId: contact.id,
      metadata: {
        previousStatus: previousStatus,
        nextStatus: contact.status,
        targetStage,
        ...result,
      },
    }).catch(() => {});
    scheduleFollowupRefresh(userId);
  }

  return result;
}

/**
 * After a Deal stage change: keep linked Contact status/type in sync.
 */
export async function syncFromDealStageChange(
  userId: string,
  deal: {
    id: string;
    title: string;
    stage: string;
    contactId: string | null;
    businessId?: string | null;
  },
  previousStage: string
): Promise<PipelineSyncResult> {
  const result = emptyResult();
  if (!deal.contactId) return result;
  if (norm(previousStage) === norm(deal.stage)) return result;

  const mapped = mapDealStageToLeadStatus(deal.stage);
  if (!mapped) return result;

  const settings = await loadSettings(deal.businessId);
  const contact = await prisma.contact.findFirst({
    where: { id: deal.contactId, deletedAt: null },
  });
  if (!contact) return result;

  const nextType =
    settings.convertLeadToClientOnWon && mapped.type === "client"
      ? "client"
      : contact.type === "client" && !isLostStatus(mapped.status)
        ? "client"
        : mapped.type || contact.type;

  const nextStatus =
    contact.type === "client" && nextType === "client" && isWonStatus(mapped.status)
      ? "active"
      : mapped.status;

  // Don't regress client active → early lead status unless lost
  if (
    contact.type === "client" &&
    contact.status === "active" &&
    !isLostStatus(mapped.status) &&
    !isWonStatus(mapped.status)
  ) {
    return result;
  }

  if (norm(contact.status) === norm(nextStatus) && contact.type === nextType) {
    return result;
  }

  await prisma.contact.update({
    where: { id: contact.id },
    data: {
      status: nextStatus,
      type: nextType,
      lastContactedAt: new Date(),
    },
  });

  result.contactStatusSynced = true;
  result.contactConvertedToClient =
    contact.type === "lead" && nextType === "client";
  result.messages.push(
    `Contact "${contact.name}" → ${nextType}/${nextStatus} (from deal ${deal.stage})`
  );

  if (result.contactConvertedToClient) {
    await notifyUser(userId, {
      type: "activity",
      title: "Lead converted to Client",
      message: `"${contact.name}" converted because deal "${deal.title}" is ${deal.stage}`,
      entityType: "contact",
      entityId: contact.id,
    }).catch(() => {});
  }

  await recordAudit({
    businessId: deal.businessId || contact.businessId,
    actorUserId: userId,
    action: "pipeline_sync_from_deal",
    entityType: "deal",
    entityId: deal.id,
    metadata: {
      previousStage,
      nextStage: deal.stage,
      contactId: contact.id,
      nextStatus,
      nextType,
    },
  }).catch(() => {});

  scheduleFollowupRefresh(userId);
  return result;
}

/** Export defaults for docs / admin UI */
export const PIPELINE_SYNC_DEFAULTS = DEFAULT_SETTINGS;
export { STATUS_ORDER, STAGE_ORDER };
