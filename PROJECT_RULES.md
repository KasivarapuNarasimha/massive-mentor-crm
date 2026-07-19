# Massive Mentor — PROJECT_RULES.md

**Version:** 1.0  
**Status:** Mandatory single source of truth for all development  
**Last updated:** 2026-07-10  

> **Every future implementation must follow this document.**  
> No feature may ship unless it complies with these rules.  
> When this document conflicts with informal habits, **this document wins**.

---

## 0. Non-negotiable product rules

1. **Metadata / configuration driven**  
   Never hardcode industry names, field names, statuses, dashboards, AI prompts, automations, or permissions in application logic.  
   Those values must come from **database configuration** (Industry Template → BusinessConfig).

2. **No industry-specific code**  
   Forbidden: `if (industry === "hospital")`, per-industry React pages, per-industry services.  
   Allowed: generic engines that branch only on **generic types** (`field.type`, `widget.type`, `trigger.type`, `channel`).

3. **Backward compatibility**  
   Existing CRM, auth, Business AI (Profile/Health/SWOT/Mentor/Roadmap), Marketing AI, and import must keep working during migrations (dual-scope allowed temporarily, then harden).

4. **Additive development**  
   Do not rewrite or “clean up” completed modules unless required for integration. Prefer new services, columns, and engines.

5. **Phase gates**  
   After each phase, stop and wait for approval. Do not start the next phase without explicit approval.

6. **Phase exit criteria (mandatory)**  
   Before requesting approval:
   1. TypeScript **PASS**
   2. Production build **PASS** (`pnpm build` / package builds)
   3. Browser QA **PASS**
   4. API QA **PASS**
   5. Existing features **regression tested**

---

## 1. Project architecture

### 1.1 System shape

```
apps/web  (Next.js 15 App Router)  ←→  apps/api (Express + Prisma)  ←→  PostgreSQL
                                              ↓
                                    Groq / OpenAI (AI providers)
```

- Frontend and backend are **separate apps**.  
- **No Next.js API routes** for core business logic.  
- All sensitive logic lives in `apps/api`.

### 1.2 Business OS hierarchy

```
Super Admin (platform)
  → IndustryTemplate (versioned manifest package)
    → Business (tenant)
      → BusinessConfig (cloned + customized template)
      → BusinessMember + permissions
      → WhiteLabelSettings
      → Tenant data (Contact, Deal, Task, … + customFields)
      → Feedback, Automations, Notifications, AuditLog
```

### 1.3 Configuration flow

1. Super Admin / seed publishes **IndustryTemplate.manifest** (JSON).  
2. On business create / marketplace install, **TemplateProvisioner** clones manifest → **BusinessConfig**.  
3. Runtime engines read **BusinessConfig** (never industry slug switches).  
4. Business Admin customizes **BusinessConfig** only (not the global template).

### 1.4 Core engines (industry-agnostic)

| Engine | Responsibility |
|--------|----------------|
| TemplateProvisioner | Install/clone template → BusinessConfig |
| ConfigResolver | Load/cache business config |
| FieldEngine / FormBuilder | Fields + dynamic forms |
| PipelineEngine | Statuses / pipelines |
| DashboardEngine | Widgets |
| ImportEngine | Import mappings |
| AutomationEngine | Trigger → condition → action |
| AIPackEngine | AI features from prompt pack |
| NotificationCenter | Email / WhatsApp / SMS / Push / In-App |
| FeedbackEngine | Ratings, NPS, sentiment |
| PermissionEngine | Role → permissions |
| TenantGuard | Resolve & enforce businessId |
| AuditLogger | Append-only audit |
| PluginLoader | Installable modules |
| WhiteLabelResolver | Branding + channel/AI provider settings |

---

## 2. Folder structure

```
massive-mentor/
├── PROJECT_RULES.md              # THIS FILE — mandatory
├── ARCHITECTURE.md
├── package.json                  # pnpm workspaces root
├── pnpm-workspace.yaml
├── docker-compose.yml
├── apps/
│   ├── api/
│   │   ├── prisma/
│   │   │   └── schema.prisma
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── config/           # env validation
│   │   │   ├── controllers/      # HTTP layer only
│   │   │   ├── routes/           # Express routers
│   │   │   ├── services/         # Business logic
│   │   │   │   ├── ai/           # Providers, templates, pack engine
│   │   │   │   └── ...
│   │   │   ├── middleware/       # auth, tenant, rate limit
│   │   │   ├── lib/              # prisma client
│   │   │   ├── templates/        # seed JSON manifests (data only)
│   │   │   ├── plugins/          # plugin definitions (data/handlers)
│   │   │   └── utils/
│   │   └── package.json
│   └── web/
│       ├── app/                  # App Router pages
│       │   ├── (auth)/
│       │   └── dashboard/
│       ├── components/
│       │   ├── ui/
│       │   ├── dynamic/          # DynamicForm, DynamicTable, widgets
│       │   ├── dashboard/
│       │   └── ai/
│       ├── lib/                  # api client, auth context, config provider
│       ├── types/
│       └── package.json
└── packages/                     # shared types later (optional)
```

**Rules:**
- One domain concern per service file (`crm.service.ts`, `business.service.ts`).  
- Controllers do not contain business logic.  
- Industry content lives under `templates/seeds/*.json`, not in TSX/TS conditionals.  
- Do not create `app/dashboard/industries/<industry>/` trees.

---

## 3. Naming conventions

| Kind | Convention | Examples |
|------|------------|----------|
| Files (TS/TSX) | `kebab-case` or existing domain pattern `name.service.ts` | `business.service.ts`, `lead-score.ts` |
| React components | `PascalCase` | `DynamicForm.tsx` |
| Functions / variables | `camelCase` | `ensureDefaultBusiness` |
| Types / Interfaces | `PascalCase` | `TenantContext`, `FieldDef` |
| Constants | `UPPER_SNAKE` or `camelCase` for config keys | `PAGE_SIZE`, `schemaVersion` |
| DB models | `PascalCase` singular | `Business`, `Contact` |
| DB columns | `camelCase` (Prisma default) | `businessId`, `customFields` |
| Config field keys | `snake_case` strings | `parent_name`, `loan_status` |
| API routes | plural nouns, kebab if needed | `/api/businesses/current` |
| Permission strings | `resource.action` | `contacts.read`, `config.edit` |
| Template slugs | `snake_case` | `coaching_institute` |
| Git branches | `type/short-description` | `feat/tenancy-phase-1` |

---

## 4. File organization

- **Routes** → wire middleware + controller only.  
- **Controllers** → parse input (Zod), call service, map HTTP status.  
- **Services** → pure business rules + Prisma; accept `TenantContext` for tenant data.  
- **Middleware** → auth, tenant resolution, rate limits.  
- **No circular imports** between services; extract shared helpers to `utils/` or `lib/`.  
- Prefer **extend** existing CRM service over duplicating Contact CRUD.

---

## 5. Database standards

1. PostgreSQL via Prisma only (no raw SQL unless justified + reviewed).  
2. Every tenant-owned table has **`businessId`** (nullable only during migration).  
3. Prefer `cuid()` string IDs.  
4. Use `createdAt` / `updatedAt` on mutable entities.  
5. JSON columns for configuration and `customFields` (document schemaVersion).  
6. Indexes on: `businessId`, foreign keys, frequent filters (`type`, `status`, `userId`).  
7. Never store plaintext secrets in JSON without encryption strategy.  
8. Soft deletes only when product requires; default is hard delete with audit.  
9. Migrations / `db push` must be reversible in intent (document breaking changes).

---

## 6. Prisma standards

1. Schema path: `apps/api/prisma/schema.prisma`.  
2. Single client: `apps/api/src/lib/prisma.ts`.  
3. Additive models preferred; avoid renaming columns used by production data.  
4. Relations: explicit `@relation` + `onDelete` behavior documented.  
5. After schema change: `prisma generate` then run app; fix types before commit.  
6. Do not put business logic in Prisma middleware unless shared cross-cutting (tenant, audit).  
7. `customFields Json @default("{}")` for extensible entity attributes.  
8. Template manifests stored as `Json` with application-level Zod validation.

---

## 7. API standards

1. Base path: `/api/...`.  
2. Response shape:
   ```json
   { "success": true, "data": { } }
   { "success": false, "error": "message", "data": optional }
   ```
3. Auth: `Authorization: Bearer <jwt>`.  
4. Validate body/query with **Zod** in controller or shared schema.  
5. HTTP codes: 200/201 success, 400 validation, 401 auth, 403 forbidden, 404 not found, 409 conflict, 429 rate limit, 500 unexpected.  
6. No stack traces in production responses.  
7. Tenant routes must resolve **active business** and enforce membership.  
8. Platform routes under `/api/platform/*` — super admin only.  
9. File uploads: multipart; JSON body size limits documented.  
10. Idempotent GETs; mutating methods are POST/PUT/PATCH/DELETE as appropriate.

---

## 8. UI/UX standards

1. **Dark zinc theme** consistent with existing dashboard (zinc-900 cards, zinc-800 borders, white primary buttons).  
2. Mobile-responsive layouts; tables get card fallback or horizontal scroll.  
3. Loading skeletons / empty states for every list.  
4. Toasts via `sonner` for success/error.  
5. Do not show success for operations that wrote **zero** durable records when user expects inserts.  
6. Forms: labels, required markers, inline validation errors.  
7. Accessibility: button labels, input labels, keyboard-focusable controls.  
8. White-label: prefer CSS variables (`--brand-primary`) when branding exists.

---

## 9. Component standards

1. Prefer small, reusable components under `components/`.  
2. **Dynamic*** components (`DynamicForm`, `DynamicTable`, `DashboardWidgetHost`) are the only place that switch on field/widget **type**.  
3. Pages orchestrate data + layout; avoid 1000-line pages when extractable.  
4. No industry-named components (`HospitalPatientForm`).  
5. Client components: `"use client"` only when needed.  
6. Props typed explicitly; avoid `any`.

---

## 10. TypeScript standards

1. `strict` mode retained.  
2. No `any` unless isolated and commented; prefer `unknown` + narrow.  
3. Shared DTO types may live in `types/` or inferred from Zod (`z.infer<>`).  
4. Prefer `async/await` over raw Promise chains.  
5. Exhaustive handling for unions where practical.  
6. Do not silence errors with empty `catch` without logging.

---

## 11. Validation standards (Zod)

1. All external input (HTTP body, query, template import) validated with Zod.  
2. Schemas colocated with service or `schemas/` module.  
3. Dynamic forms: generate Zod object from **FieldDef** metadata when possible.  
4. Coerce numbers/dates explicitly.  
5. Return first human-readable error message to clients.

---

## 12. Authentication & authorization

1. JWT signed with server secret; expiry configured via env.  
2. Passwords hashed with bcrypt (cost ≥ 12).  
3. `requireAuth` on protected routes.  
4. **Platform role** (`platformRole`: `user` | `super_admin`) ≠ **business role**.  
5. Business permissions from config roles (`contacts.read`, `config.edit`, …).  
6. `requireRole` / permission checks for mutating admin operations.  
7. Never trust client-sent `userId` / `businessId` without membership verification.

---

## 13. Multi-tenant rules

1. **TenantContext** is required for tenant data access:
   ```ts
   type TenantContext = {
     userId: string;
     businessId: string;
     businessRole: string;
     permissions: string[];
     platformRole: "user" | "super_admin";
   };
   ```
2. Every query on tenant tables includes `businessId` (after migration complete).  
3. During dual-scope migration: document fallback (`userId` OR `businessId`) and remove after gate.  
4. Cross-tenant access must fail with 403/404.  
5. Public links (feedback, etc.) use signed tokens embedding `businessId`.  
6. Super Admin cross-tenant tools only on `/api/platform/*`.

---

## 14. Security standards

1. Helmet, CORS allowlist, rate limits on auth/AI.  
2. Sanitize user content before AI prompts (`sanitizePromptInput`).  
3. Secrets only in env / encrypted config — never commit `.env`.  
4. Principle of least privilege for roles.  
5. Audit sensitive actions (see §17).  
6. Validate file upload types/sizes.  
7. Do not log passwords, tokens, or raw provider secrets.

---

## 15. AI development standards

1. All product AI features resolve prompts from **AI Prompt Pack** (BusinessConfig) when available.  
2. Legacy hardcoded prompts allowed **only** as temporary fallback during migration; track and remove.  
3. Placeholders: `{{businessName}}`, `{{industryLabel}}`, `{{customFields}}`, etc. — filled by engine.  
4. Use central `ai.service` + providers; no ad-hoc SDK calls in controllers.  
5. Prefer structured JSON when the feature requires it; use text when scripts/languages need reliability.  
6. Log token usage; handle provider errors without leaking internals.  
7. Respect business white-label AI provider when set.  
8. Record AI actions in AuditLog.

---

## 16. Automation standards

1. Automations are **config only**: trigger → conditions → actions.  
2. Supported trigger/action **types** are generic; instances come from BusinessConfig.  
3. Persist `AutomationRun` for observability.  
4. Actions that notify must go through **Notification Center**.  
5. No infinite loops: guard status changes caused by automations.  
6. Failures must not crash the API process; log + mark run failed.

---

## 17. Notification standards

1. Single **Notification Center** service for: `email`, `whatsapp`, `sms`, `push`, `in_app`.  
2. Feature code must not call channel SDKs directly.  
3. Use outbox pattern for retryable channels.  
4. Templates from BusinessConfig.notifications where applicable.  
5. Channel credentials from WhiteLabel / Integration settings per business.

---

## 18. Logging & audit standards

### 18.1 Application logs

- Structured console logs with prefixes: `[API Error]`, `[import]`, `[AI]`, `[tenant]`.  
- Never log secrets.

### 18.2 AuditLog (mandatory events)

Record at least:
- login / logout / register  
- create / update / delete on CRM entities  
- import / export  
- AI feature execution  
- config change / template install  
- feedback submit  

Fields: `businessId`, `actorUserId`, `action`, `entityType`, `entityId`, `metadata`, `ip`, `userAgent`, `createdAt`.  
Audit logs are **append-only** (no update/delete APIs for normal users).

---

## 19. Performance standards

1. List endpoints paginate (default page size documented; avoid unbounded 50k payloads in UI).  
2. Use `select` to limit heavy includes when not needed.  
3. Batch inserts for bulk import (`createMany` in chunks).  
4. Cache BusinessConfig by `businessId + version` in-process (invalidate on PATCH).  
5. Do not N+1 query in loops without batching.  
6. Large exports stream when possible.

---

## 20. Coding conventions

1. Prefer clarity over cleverness.  
2. Early returns over deep nesting.  
3. Shared constants for magic strings used as **system keys** (not industry content).  
4. Comments explain **why**, not what.  
5. Delete dead code you introduce; do not leave large commented blocks.  
6. Match existing formatting in the file you edit.

---

## 21. Git branch & commit rules

### Branches

- `main` — stable  
- `feat/<desc>` — features  
- `fix/<desc>` — bugfixes  
- `chore/<desc>` — tooling/docs  

### Commits

- Imperative mood, concise: `feat(api): add Business tenant models`  
- Prefer focused commits per concern.  
- Do not commit `node_modules`, `.env`, build artifacts, or large personal data files.

---

## 22. Testing rules

1. Prefer automated smoke scripts for API critical paths when UI e2e is unavailable.  
2. Multi-tenant tests: User A must not read User B’s business data.  
3. Import tests: assert DB row counts and no false success.  
4. Template tests: install manifest → config sections present (not empty).  
5. Do not require production AI keys for pure unit tests of mappers/engines.

---

## 23. QA checklist (every phase)

- [ ] TypeScript compile / `tsc` PASS (api + web as applicable)  
- [ ] Production build PASS  
- [ ] Login / register works  
- [ ] Existing CRM: list / create / edit lead  
- [ ] Existing import still works (sample file)  
- [ ] Profile / one Business AI page smoke  
- [ ] New feature matches metadata-driven rule (no hardcoded industry)  
- [ ] No console errors on primary happy path  
- [ ] Mobile layout smoke for changed pages  

---

## 24. Production build checklist

- [ ] `pnpm --filter @massivementor/api build`  
- [ ] `pnpm --filter @massivementor/web build`  
- [ ] Prisma client generated  
- [ ] Env vars documented in `.env.example` if new vars added  
- [ ] No temporary debug endpoints left enabled  

---

## 25. Release checklist

- [ ] Phase approval recorded  
- [ ] QA checklist complete  
- [ ] Migration/backfill plan for existing tenants  
- [ ] Rollback strategy noted  
- [ ] Changelog / milestone note updated under `docs/` when appropriate  
- [ ] Secrets rotated if exposed during dev  

---

## 26. Documentation standards

1. User-facing behavior changes → short note in PR/summary.  
2. Architecture changes → update `ARCHITECTURE.md` and this file if rules change.  
3. Template manifest schema changes → bump `schemaVersion` and document.  
4. Do not invent `PROJECT_RULES` exceptions without updating this file.

---

## 27. Code review checklist

- [ ] Follows metadata/configuration-driven rule  
- [ ] No industry-specific hardcoding  
- [ ] Tenant isolation on new queries  
- [ ] Zod validation on inputs  
- [ ] Audit for sensitive mutations  
- [ ] Backward compatible with existing CRM  
- [ ] Types clean; no careless `any`  
- [ ] UI matches dark theme patterns  
- [ ] Errors handled; no silent failures  
- [ ] Phase scope not exceeded  

---

## 28. Implementation phase discipline

| Rule | Detail |
|------|--------|
| One phase at a time | Per approved OS roadmap |
| Stop after phase | Wait for human approval |
| Verify five gates | TS, Build, Browser QA, API QA, Regression |
| Prefer small PRs | Reviewable diffs |

---

## 29. Related documents

- `ARCHITECTURE.md` — system overview and roadmap  
- Session / program plan — Industry Template OS phases  
- `docs/MILESTONE_*.md` — historical milestones  

---

## 30. Rule change process

1. Propose change in PR/summary.  
2. Update **this file** in the same change set.  
3. Bump version header date.  
4. Do not silently diverge from written rules.

---

**End of PROJECT_RULES.md**  
All contributors and agents must treat this as binding.
