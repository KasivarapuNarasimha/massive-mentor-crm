# Phase 7 — Code Quality & Maintainability Report

**Date:** 2026-08-07  
**Scope:** Maintainability only — no features, UI redesign, business logic, schema, or API contract changes.

## Summary

| Category | Result |
|----------|--------|
| Dead code / noise removed | Stale comments; duplicate local `errStatus` helpers |
| Duplication reduced | Shared HTTP status + AI error helpers |
| TypeScript quality | Removed most `any` from API services/providers |
| Behavior / contracts | Unchanged (typecheck clean) |

## Files changed

| File | Reason |
|------|--------|
| `apps/api/src/utils/http-status.ts` | **New** shared `messageToHttpStatus` / `errorMessage` |
| `apps/api/src/utils/ai-error.ts` | **New** shared `rethrowProviderError` (no `any`) |
| `apps/api/src/controllers/media.controller.ts` | Use shared HTTP status helper |
| `apps/api/src/controllers/whatsapp-inbox.controller.ts` | Use shared HTTP status helper |
| `apps/api/src/controllers/crm.controller.ts` | Consistent status mapping for create contact/deal |
| `apps/api/src/services/activity.service.ts` | Typed activity `where` + `details` |
| `apps/api/src/services/automation.service.ts` | Typed `logCrmActivity` details |
| `apps/api/src/services/crm.service.ts` | Typed AI JSON responses + entity row for next-best-action |
| `apps/api/src/services/ai.service.ts` | Stub without `as any`; `generateJSON<T=unknown>` |
| `apps/api/src/services/ai/types.ts` | `raw?: unknown`; provider interface default `unknown` |
| `apps/api/src/services/ai/logger.ts` | Accept `unknown` errors |
| `apps/api/src/services/ai/providers/groq.provider.ts` | Shared error rethrow; no `catch (error: any)` |
| `apps/api/src/services/ai/providers/openai.provider.ts` | Same |
| `apps/api/src/lib/rate-limit-store.ts` | Typed optional Redis client (no `any`) |
| `apps/web/components/whatsapp/WhatsAppConversationCenter.tsx` | Removed obsolete trailing comments |

## Complexity reduction

- Controllers no longer each redefine HTTP status mapping (2 copies → 1 utility).
- AI providers no longer duplicate 429 / AIError / message extraction blocks (4 catch sites → 1 helper).
- `generateNextBestAction` no longer uses untyped `any` blob for CRM entities.

## Dead code / noise removed

- Obsolete comments at end of `WhatsAppConversationCenter.tsx`.
- Duplicate private `errStatus` in media + WhatsApp controllers.

## Type improvements

- Activity timeline `where: any` → explicit shape.
- AI generation `metadata?: any` → `Record<string, unknown>`.
- AI `generateJSON` default type parameter `any` → `unknown`.
- Provider catch clauses `error: any` → `unknown` + type guards.
- Unconfigured AI service stub: `as any` → `as unknown as AIService`.
- Redis optional store: local Redis client types instead of `any`.

## Intentionally not changed

- Folder structure (no mass moves).
- WhatsApp / Media business flows and API routes.
- Database schema.
- Large CRM service file split (would risk behavioral drift; deferred).
- Scripts HTTP helpers duplication (test-only; low production risk).
- Empty `packages/` directory (no shared package to consolidate yet).

## Verification

- `apps/api` `tsc --noEmit` → pass
- `apps/web` `tsc --noEmit` → pass

## Recommendations (not implemented)

1. Eventually extract a `packages/shared` package for cross-app types when web+api share DTOs.
2. Split `crm.service.ts` by domain (contacts / deals / AI) in a dedicated refactor sprint with golden tests.
3. Formal Prisma migrations folder instead of db-push-only workflow.
4. Add ESLint `no-explicit-any` as a CI warning.
