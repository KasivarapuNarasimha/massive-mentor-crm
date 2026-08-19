/**
 * Single pipeline sync service — keeps Lead (Contact), Client, Deal, and
 * Pipeline stages consistent after status/stage changes.
 *
 * Used by: updateContact, bulkEditLeads, updateDeal.
 * Lead → Deal path runs inside a Prisma interactive transaction:
 *   check existing deal by contactId → create OR update (never duplicate).
 */
import { prisma } from "../lib/prisma.js";
import type { Prisma } from "@prisma/client";
import { notifyUser } from "./notification.service.js";
import { logActivity } from "./activity.service.js";
import { recordAudit } from "./audit.service.js";
import { scheduleFollowupRefresh } from "./followup-engine.service.js";
import { getUserBusinessId } from "./field-engine.service.js";
import { tenantWhereClause } from "./tenant-scope.service.js";
import {
  isCallResultStatus,
  isClosedStatusKey,
  isLostStatusKey,
  isWonStatusKey,
  leadStatusLabel,
  leadStatusToDealStageKey,
  normalizeStatusKey,
  UNIFIED_PIPELINE_STATUSES,
} from "../lib/lead-statuses.js";

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
  /** Auto-create a deal when lead reaches qualified/proposal (won/lost always create) */
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

/** Unified 15-status order for rank/protect logic */
const STAGE_ORDER = UNIFIED_PIPELINE_STATUSES.map((s) => s.key);

function norm(s: string | null | undefined): string {
  return normalizeStatusKey(s);
}

/**
 * Lead status → Deal stage: 1:1 same vocabulary (after legacy normalize).
 * Lead=RNR → Deal=RNR, Lead=Contacted → Deal=Contacted, etc.
 */
export function mapLeadStatusToDealStage(status: string): string | null {
  return leadStatusToDealStageKey(status);
}

/** Deal stage → Lead status: 1:1 after legacy normalize */
export function mapDealStageToLeadStatus(stage: string): {
  status: string;
  type?: "lead" | "client";
  probability?: number;
} | null {
  const s = normalizeStatusKey(stage);
  if (!s) return null;
  if (isWonStatusKey(s)) {
    return { status: "won", type: "client", probability: 100 };
  }
  if (isLostStatusKey(s)) {
    return { status: "lost", type: "lead", probability: 0 };
  }
  return {
    status: s,
    type: "lead",
    probability: probabilityForStage(s),
  };
}

export function isWonStatus(status: string): boolean {
  return isWonStatusKey(status) || /converted|customer|enrolled/i.test(String(status || ""));
}

export function isLostStatus(status: string): boolean {
  return isLostStatusKey(status);
}

export function isClosedDealStage(stage: string): boolean {
  return isClosedStatusKey(stage);
}

function stageRank(stage: string): number {
  const s = normalizeStatusKey(stage);
  const i = STAGE_ORDER.indexOf(s);
  return i >= 0 ? i : 0;
}

function probabilityForStage(targetStage: string): number {
  const s = normalizeStatusKey(targetStage);
  if (s === "won") return 100;
  if (s === "lost" || s === "not_interested" || s === "invalid_number") return 0;
  if (s === "negotiation" || s === "interested") return 70;
  if (s === "proposal") return 50;
  if (s === "qualified" || s === "call_back") return 30;
  if (s === "contacted" || s === "busy") return 15;
  return 10;
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
 * Resolve a non-null businessId for deal writes whenever the workspace exists.
 * Prefer lead.businessId → actor membership → contact owner membership.
 */
async function resolveBusinessIdForContact(
  contact: { businessId?: string | null; userId?: string | null },
  actorUserId: string
): Promise<string | null> {
  if (contact.businessId) return contact.businessId;
  const fromActor = await getUserBusinessId(actorUserId);
  if (fromActor) return fromActor;
  if (contact.userId && contact.userId !== actorUserId) {
    return getUserBusinessId(contact.userId);
  }
  return null;
}

/** Deal list filter for a contact — never uses assignedTo (Deal has no such field). */
function dealsForContactWhere(
  contactId: string,
  businessId: string | null,
  ownerUserId: string
): Prisma.DealWhereInput {
  const tenant = tenantWhereClause(ownerUserId, businessId);
  return {
    AND: [{ contactId }, tenant],
  };
}

/**
 * After a Lead/Contact status change: update linked deals, optionally auto-create,
 * convert to client on won — all inside one Prisma transaction.
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

  const businessId = await resolveBusinessIdForContact(contact, userId);
  const settings = await loadSettings(businessId);
  const ownerUserId = contact.userId || userId;
  const probability = probabilityForStage(targetStage);
  const terminal = isWonStatus(contact.status) || isLostStatus(contact.status);

  // Won/lost ALWAYS create-or-update a deal (production requirement).
  // Call-result statuses also create/update so My Deals reflects telecalling outcomes.
  // Earlier pipeline stages respect autoCreateDeal setting.
  const stageCreatesDeal =
    terminal ||
    isCallResultStatus(contact.status) ||
    targetStage === "proposal" ||
    targetStage === "negotiation" ||
    targetStage === "qualified" ||
    ["proposal", "proposal_sent", "negotiation", "qualified", "won", "lost"].includes(next);

  const shouldCreateIfMissing =
    terminal ||
    isCallResultStatus(contact.status) ||
    (settings.autoCreateDeal && stageCreatesDeal);

  await prisma.$transaction(
    async (tx) => {
      // Backfill contact.businessId when missing so future queries stay tenant-safe
      if (businessId && !contact.businessId) {
        await tx.contact.update({
          where: { id: contact.id },
          data: { businessId },
        });
        contact = { ...contact, businessId };
      }

      // Convert lead → client on won (same transaction)
      if (
        settings.convertLeadToClientOnWon &&
        isWonStatus(contact.status) &&
        contact.type === "lead"
      ) {
        await tx.contact.update({
          where: { id: contact.id },
          data: { type: "client", status: "active" },
        });
        result.contactConvertedToClient = true;
        result.messages.push(`Lead "${contact.name}" converted to Client (active)`);
      }

      // Find existing deals for this contact (tenant-scoped; NO assignedTo)
      let deals = await tx.deal.findMany({
        where: dealsForContactWhere(contact.id, businessId, ownerUserId),
        orderBy: { updatedAt: "desc" },
      });

      // If none by contactId, try same-tenant orphan match only when won/lost (title contains name)
      if (deals.length === 0 && terminal) {
        const namePart = (contact.name || "").trim().toLowerCase();
        if (namePart.length >= 3) {
          const tenant = tenantWhereClause(ownerUserId, businessId);
          const orphans = await tx.deal.findMany({
            where: {
              AND: [{ contactId: null }, tenant],
            },
            orderBy: { updatedAt: "desc" },
            take: 15,
          });
          const matched = orphans.filter((d) =>
            (d.title || "").toLowerCase().includes(namePart)
          );
          for (const o of matched) {
            await tx.deal.update({
              where: { id: o.id },
              data: {
                contactId: contact.id,
                ...(businessId ? { businessId } : {}),
              },
            });
          }
          if (matched.length) {
            deals = await tx.deal.findMany({
              where: dealsForContactWhere(contact.id, businessId, ownerUserId),
              orderBy: { updatedAt: "desc" },
            });
            result.messages.push(`Linked ${matched.length} orphan deal(s) to contact`);
          }
        }
      }

      if (deals.length === 0) {
        if (!shouldCreateIfMissing) {
          if (
            isWonStatus(contact.status) ||
            ["qualified", "proposal", "negotiation"].includes(next)
          ) {
            result.promptCreateDeal = true;
            result.messages.push(
              "No linked deal — enable auto-create or create a deal manually"
            );
          }
          return;
        }

        // Never create deals with null businessId — breaks tenant isolation
        if (!businessId) {
          console.error(
            `[pipeline-sync] refusing deal create: no businessId for contact=${contact.id} actor=${userId}`
          );
          result.promptCreateDeal = true;
          result.messages.push(
            "Cannot auto-create deal: workspace (businessId) could not be resolved"
          );
          return;
        }

        const title = contact.company?.trim()
          ? `${contact.company} — ${contact.name}`
          : `Deal: ${contact.name}`;

        const created = await tx.deal.create({
          data: {
            userId: ownerUserId,
            businessId,
            contactId: contact.id,
            title,
            value: contact.value ?? null,
            stage: targetStage,
            probability,
            notes: `Auto-created from lead status → ${leadStatusLabel(contact.status)}`,
            customFields: {
              autoCreatedFromLead: true,
              leadStatus: norm(contact.status),
              leadStatusLabel: leadStatusLabel(contact.status),
            },
          },
        });
        result.dealCreated = true;
        result.dealIds.push(created.id);
        result.messages.push(
          `Deal created at stage ${targetStage} (lead status: ${leadStatusLabel(contact.status)})`
        );
        return;
      }

      // Update existing deal(s) — prefer primary (most recently updated)
      for (const deal of deals) {
        if (!terminal && !isCallResultStatus(contact.status)) {
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

        const prevCf = (deal.customFields || {}) as Record<string, unknown>;
        const nextLeadStatus = norm(contact.status);
        const needsStage = norm(deal.stage) !== norm(targetStage) || deal.stage !== targetStage;
        const needsLink = deal.contactId !== contact.id;
        const needsBiz = !!(businessId && deal.businessId !== businessId);
        const needsValue =
          contact.value != null && (deal.value == null || deal.value === undefined);
        const needsLeadStatus =
          String(prevCf.leadStatus || "") !== nextLeadStatus ||
          String(prevCf.leadStatusLabel || "") !== leadStatusLabel(contact.status);

        if (!needsStage && !needsLink && !needsBiz && !needsValue && !needsLeadStatus) {
          // Still record as "synced" for primary deal so UI can refresh
          if (result.dealIds.length === 0) result.dealIds.push(deal.id);
          continue;
        }

        const updated = await tx.deal.update({
          where: { id: deal.id },
          data: {
            contactId: contact.id,
            stage: targetStage,
            probability,
            ...(businessId ? { businessId } : {}),
            ...(needsValue ? { value: contact.value } : {}),
            customFields: {
              ...prevCf,
              leadStatus: nextLeadStatus,
              leadStatusLabel: leadStatusLabel(contact.status),
            },
          },
        });
        result.dealsUpdated++;
        result.dealIds.push(updated.id);
        result.messages.push(
          `Deal "${updated.title}" → ${targetStage} (${leadStatusLabel(contact.status)})`
        );
      }

      // If protect-closed skipped all and we still need a deal for won/lost, create one
      if (terminal && result.dealsUpdated === 0 && result.dealIds.length === 0) {
        if (!businessId) {
          console.error(
            `[pipeline-sync] refusing terminal deal create: no businessId contact=${contact.id}`
          );
          result.promptCreateDeal = true;
          result.messages.push(
            "Cannot auto-create deal: workspace (businessId) could not be resolved"
          );
          return;
        }
        const title = contact.company?.trim()
          ? `${contact.company} — ${contact.name}`
          : `Deal: ${contact.name}`;
        const created = await tx.deal.create({
          data: {
            userId: ownerUserId,
            businessId,
            contactId: contact.id,
            title,
            value: contact.value ?? null,
            stage: targetStage,
            probability,
            notes: `Auto-created from lead status → ${leadStatusLabel(contact.status)}`,
            customFields: {
              autoCreatedFromLead: true,
              leadStatus: norm(contact.status),
              leadStatusLabel: leadStatusLabel(contact.status),
            },
          },
        });
        result.dealCreated = true;
        result.dealIds.push(created.id);
        result.messages.push(
          `Deal created at stage ${targetStage} (${leadStatusLabel(contact.status)})`
        );
      }
    },
    {
      maxWait: 10_000,
      timeout: 30_000,
    }
  );

  // Side-effects after commit (notifications / audit — non-fatal)
  if (result.contactConvertedToClient) {
    await notifyUser(userId, {
      type: "activity",
      title: "Lead converted to Client",
      message: `"${contact.name}" marked won and converted to client`,
      entityType: "contact",
      entityId: contact.id,
    }).catch(() => {});
  }

  if (result.dealCreated && result.dealIds[0]) {
    const dealId = result.dealIds[0];
    await notifyUser(userId, {
      type: isWonStatus(contact.status) ? "deal_won" : "activity",
      title: isWonStatus(contact.status) ? "Deal won (auto)" : "Deal created",
      message: `Deal ${
        isWonStatus(contact.status) ? "closed won" : `opened at ${targetStage}`
      } from lead status`,
      entityType: "deal",
      entityId: dealId,
    }).catch(() => {});
    await logActivity({
      userId,
      entityType: "deal",
      entityId: dealId,
      action: "auto_created_from_lead",
      details: { contactId: contact.id, stage: targetStage, leadStatus: contact.status },
    }).catch(() => {});
  } else if (result.dealsUpdated > 0) {
    for (const dealId of result.dealIds.slice(0, 3)) {
      if (isWonStatus(contact.status) || /closed_won|won/i.test(targetStage)) {
        await notifyUser(userId, {
          type: "deal_won",
          title: "Deal won",
          message: `Deal moved to ${targetStage} (lead won)`,
          entityType: "deal",
          entityId: dealId,
        }).catch(() => {});
      } else if (isLostStatus(contact.status) || /closed_lost|lost/i.test(targetStage)) {
        await notifyUser(userId, {
          type: "deal_lost",
          title: "Deal lost",
          message: `Deal moved to ${targetStage} (lead lost)`,
          entityType: "deal",
          entityId: dealId,
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
        previousStatus,
        nextStatus: contact.status,
        targetStage,
        businessId,
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

  const businessId =
    deal.businessId || (await getUserBusinessId(userId)) || null;
  const settings = await loadSettings(businessId);

  await prisma.$transaction(async (tx) => {
    const contact = await tx.contact.findFirst({
      where: { id: deal.contactId!, deletedAt: null },
    });
    if (!contact) return;

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
      return;
    }

    if (norm(contact.status) === norm(nextStatus) && contact.type === nextType) {
      return;
    }

    await tx.contact.update({
      where: { id: contact.id },
      data: {
        status: nextStatus,
        type: nextType,
        lastContactedAt: new Date(),
        ...(businessId && !contact.businessId ? { businessId } : {}),
      },
    });

    // Backfill deal.businessId if missing
    if (businessId && !deal.businessId) {
      await tx.deal.update({
        where: { id: deal.id },
        data: { businessId },
      });
    }

    result.contactStatusSynced = true;
    result.contactConvertedToClient =
      contact.type === "lead" && nextType === "client";
    result.messages.push(
      `Contact "${contact.name}" → ${nextType}/${nextStatus} (from deal ${deal.stage})`
    );
  });

  if (result.contactConvertedToClient) {
    await notifyUser(userId, {
      type: "activity",
      title: "Lead converted to Client",
      message: `"${deal.title}" closed — contact converted to client`,
      entityType: "contact",
      entityId: deal.contactId!,
    }).catch(() => {});
  }

  if (result.contactStatusSynced) {
    await recordAudit({
      businessId,
      actorUserId: userId,
      action: "pipeline_sync_from_deal",
      entityType: "deal",
      entityId: deal.id,
      metadata: {
        previousStage,
        nextStage: deal.stage,
        contactId: deal.contactId,
        ...result,
      },
    }).catch(() => {});
    scheduleFollowupRefresh(userId);
  }

  return result;
}
