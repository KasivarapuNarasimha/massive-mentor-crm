# Massive Mentor — MVP Implementation Plan

**Goal:** Ship a professional, launch-ready MVP in the shortest realistic time with high quality.

**Philosophy:** Build the thinnest possible vertical slice that delivers real value, then expand.

---

## Milestone Overview

| #  | Milestone                              | Focus Area                  | Estimated Effort | Exit Criteria |
|----|----------------------------------------|-----------------------------|------------------|---------------|
| 0  | Project Scaffolding                    | Tooling & DX                | 0.5 day          | Both apps run cleanly |
| 1  | Authentication (Register + Login)      | Backend + Frontend          | 1–1.5 days       | Working JWT flow end-to-end |
| 2  | Business Profile Setup                 | CRUD + Forms                | 1 day            | Profile can be created/edited |
| 3  | Health Score Dashboard (Static + Basic)| UI + Simple Calculation     | 1 day            | Beautiful dashboard visible |
| 4  | AI Integration Foundation              | Backend AI service          | 0.5 day          | AI service works + tested |
| 5  | SWOT Analysis Generator                | Full feature                | 1 day            | Generate + display + persist |
| 6  | AI Mentor Chat                         | Full feature                | 1.5 days         | Real conversation that feels good |
| 7  | 30-Day Growth Roadmap                  | Full feature                | 1 day            | 30-day plan generated & rendered |
| 8  | Health Score — Real Calculation        | Polish + AI enhancement     | 0.5–1 day        | Score feels intelligent |
| 9  | Responsive Polish + Navigation         | UX & Mobile                 | 0.5–1 day        | Feels production-grade on mobile |
| 10 | Final QA, Seeding, Deployment Prep     | Hardening                   | 1 day            | Ready for real users |

**Total Estimated Time:** ~9–12 focused days (solo) or 5–7 days (paired).

---

## Detailed Steps

### Milestone 0: Project Scaffolding (Foundation)

**Tasks:**
1. Initialize pnpm workspaces at root
2. Create Next.js 15 project inside `apps/web` (with TypeScript, Tailwind, ESLint, App Router)
3. Create Express + TypeScript project inside `apps/api` (manual or create-express-app style)
4. Set up Prisma inside `apps/api` with PostgreSQL connection
5. Create `docker-compose.yml` with PostgreSQL + volume
6. Create `.env.example` files for both apps
7. Add root `package.json` scripts:
   - `dev` (concurrently run web + api)
   - `build`
   - `db:up`, `db:down`, `db:seed`
8. Install shared dev dependencies (tsx, dotenv, etc.)
9. Set up basic folder structure per ARCHITECTURE.md
10. Create a simple health check endpoint (`GET /api/health`)

**Deliverables:**
- Both apps start without errors
- Can connect to local Postgres via Prisma
- Root dev command works

**Do NOT:**
- Add shadcn/ui yet
- Add any business logic

---

### Milestone 1: Authentication (The Gate)

**Backend:**
- User model in Prisma
- `POST /auth/register` (hash password with bcrypt, create user + empty BusinessProfile)
- `POST /auth/login` (verify, sign JWT with 7-day expiry)
- `GET /auth/me` (protected)
- `auth.middleware.ts` (extract + verify token, attach to req)
- Basic input validation with zod

**Frontend:**
- `/login` and `/register` pages (clean, professional forms)
- `useAuth` hook or context (store token + user)
- API client wrapper (`lib/api.ts`) that injects Authorization header
- Protected route wrapper (redirect unauthenticated users to /login)
- Form validation + error states
- Logout functionality

**Nice-to-haves (only if time):**
- Password strength indicator
- "Forgot password" (fake for MVP)

**Exit Criteria:**
- New user can register → auto-login → see dashboard shell
- Returning user can login
- Protected pages redirect when logged out

---

### Milestone 2: Business Profile Setup

**Backend:**
- `GET /profile` and `PUT /profile` endpoints
- Full BusinessProfile Prisma model
- Validation (zod schemas)

**Frontend:**
- `/dashboard/profile` page
- Professional form using react-hook-form + zod
- Fields (prioritized):
  - Business name (required)
  - Industry (select or text)
  - Short description (textarea)
  - Stage (select: Idea / MVP / Early Revenue / Growth / Scaling)
  - Employee count (select)
  - Target market / customers
  - Main product/service
- Save with loading + success toast
- Auto-load existing data

**UX Goal:** Feels like filling out a serious business document, not a toy form.

---

### Milestone 3: Health Score Dashboard (Foundation)

**This is the "home" of the app.**

**Backend (basic version):**
- `GET /health/score` — returns latest or generates a placeholder
- Simple scoring service (can be rule-based initially)

**Frontend:**
- `/dashboard` (main overview)
- Large prominent Health Score (0–100) with color (red/yellow/green)
- Breakdown section (4–6 categories): Revenue, Marketing, Operations, Product, Customer, Team
- Use progress bars or nice radial charts (recharts or simple CSS + shadcn)
- "Last calculated" timestamp
- "Recalculate" button (even if it just runs basic logic for now)

**Design Target:**
- Clean, executive dashboard feel
- Big numbers, subtle colors, lots of whitespace
- Mobile: stacks nicely

**Important:** Do not block on perfect AI scoring here. We improve it in Milestone 8.

---

### Milestone 4: AI Integration Foundation

**Backend only:**
- Install `openai` package
- Create `src/services/ai.service.ts`
- Add environment variable: `OPENAI_API_KEY`
- Create a small test route or script that calls the model and returns structured data
- Implement basic structured output helper (JSON mode + safe parsing)
- Add simple retry + timeout logic

**Test prompts:**
- "Given this business profile, generate 3 strengths..."
- Make sure parsing works reliably

**Decision:** Use `gpt-4o-mini` for most things during development to control cost.

---

### Milestone 5: SWOT Analysis Generator

**Full vertical slice.**

**Backend:**
- `POST /swot/generate` — calls AI with business profile context
- Prompt template that asks for structured output: `{ strengths, weaknesses, opportunities, threats, summary }`
- Save to `SWOTAnalysis` table
- `GET /swot` — return latest

**Frontend:**
- `/dashboard/swot`
- Beautiful 2x2 matrix (Strengths, Weaknesses, Opportunities, Threats)
- Card design with colored headers
- "Generate / Regenerate" button with loading state
- Shows "Generated with AI • [model]" + date
- History view (list of previous analyses — click to view)

**Prompt Quality is Critical:**
Write and iterate on a strong system prompt. This feature must feel magical.

---

### Milestone 6: AI Mentor Chat (Highest UX Bar)

**This is the "wow" feature.**

**Backend:**
- `POST /mentor/message`
- `GET /mentor/history?limit=30`
- Store every message (user + assistant)
- Send last 10–12 messages + business context to the model
- System prompt: "You are Massive Mentor, a world-class business growth advisor..."

**Frontend (`/dashboard/mentor`):**
- Clean chat interface (WhatsApp / Claude style)
- User messages on right, assistant on left
- Typing indicator while waiting
- Auto-scroll
- Ability to continue conversation naturally
- "New conversation" button (optional for MVP)

**Critical UX Details:**
- Fast perceived response (show typing quickly)
- Handle errors gracefully ("The mentor is thinking... try again")
- Message history persists across refreshes

**Prompt Engineering Note:** Spend real time here. The quality of the mentor determines product perception.

---

### Milestone 7: 30-Day Growth Roadmap

**Backend:**
- `POST /roadmap/generate`
- Strong prompt that creates 30 daily actionable items
- Structure: array of days with `day`, `title`, `tasks[]`, `focusArea`
- Store as JSON in `Roadmap` model (replace existing)
- `GET /roadmap`

**Frontend:**
- `/dashboard/roadmap`
- Visual timeline (vertical recommended for 30 items)
- Each day card: Day number, focus title, 2–4 tasks (checkboxes are nice but not functional for MVP)
- "Regenerate Roadmap" button
- Progress indicator (e.g., "Day 7 of 30")

**Make it feel premium:**
- Group by week (Week 1, Week 2...)
- Color code by category (Marketing, Product, Sales, Operations)

---

### Milestone 8: Real Business Health Score

Now that we have profile + AI capabilities:

**Backend:**
- Create proper `scoring.service.ts`
- Combine rule-based signals (from profile completeness + stage) + AI-generated insights
- AI prompt: "Analyze this business profile and give a health score 0-100 with breakdown across 6 categories + 4 specific recommendations"
- Store full `HealthScore` record

**Frontend:**
- Update dashboard to use real data
- Show trend (last 3 scores) — simple line or just previous values
- "AI Insights" section pulled from the score

This is when the dashboard starts feeling intelligent.

---

### Milestone 9: Responsive Polish & Navigation

**Tasks:**
- Full responsive testing (375px → 1440px+)
- Mobile sidebar (sheet/drawer using shadcn Sheet or custom)
- Top navigation with user avatar + dropdown (Profile, Logout)
- Consistent loading states (skeletons preferred over spinners)
- Empty states for every major section
- Subtle but delightful micro-interactions (only where they add value)
- Fix any layout shift issues
- Accessibility pass (labels, contrast, keyboard)

**Visual QA:**
- Use real business profile data when testing
- Take screenshots on mobile + desktop

---

### Milestone 10: Hardening & Launch Prep

**Tasks:**
1. Seed script (`npm run db:seed`) — creates 2–3 realistic demo accounts
2. Error boundaries in Next.js
3. Global error handling + toast system (sonner is excellent with shadcn)
4. Basic rate limiting on AI routes (simple in-memory or express-rate-limit)
5. Environment validation on startup (zod on process.env)
6. Production build test (`pnpm build` both apps)
7. Update README with real setup instructions
8. Create `DEPLOYMENT.md` (even if short)
9. Manual end-to-end test with fresh database

**Optional but recommended:**
- Add a "Demo Account" button on login for quick testing

---

## Development Guidelines (Strict)

### Do
- Use TypeScript strictly (no `any` without justification)
- Validate all inputs on backend with zod
- Always show loading + error states
- Write clear commit messages
- Keep components under ~150 lines when possible
- Use server components in Next.js where data fetching is simple

### Do NOT (MVP Anti-Patterns)
- Add billing, pricing pages, or Stripe
- Implement refresh token rotation
- Build a design system beyond shadcn/ui
- Add advanced charts or data visualization libraries
- Write comprehensive unit tests (integration via manual + a few Playwright tests later)
- Create team/organization features
- Over-abstract services "just in case"
- Use complex state management (Zustand only for cross-cutting UI state)

---

## Recommended Order of UI Component Creation

1. Auth pages (login/register)
2. Dashboard shell (Sidebar + TopNav + Layout)
3. Profile form
4. Health Score cards + breakdown
5. SWOT 2x2 matrix
6. Chat interface
7. Roadmap timeline
8. Polish & mobile

---

## Success Metrics for MVP

- A user can go from registration → complete profile → see health score → generate SWOT → have a meaningful chat with the mentor → generate a 30-day roadmap in under 8 minutes.
- The product feels **premium and serious**, not like a demo.
- All AI features produce output a real business owner would find useful.

---

## After MVP Ships

**Phase 2 Candidates (in rough priority):**
- Email magic links + better auth
- PDF export of SWOT + Roadmap
- Historical trend charts
- Multiple saved roadmaps
- Team seats / collaboration
- Billing & subscriptions
- Grok / xAI model support
- Public shareable links for SWOT/roadmap

---

**This plan is deliberately sequential and vertical.** Each milestone delivers visible, testable value.

**Next action:** Review this plan + ARCHITECTURE.md. Once approved, we begin Milestone 0.

---

*Built with focus. Shipped with pride.*
