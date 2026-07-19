# Massive Mentor

**AI-Powered Business Growth Platform**

Massive Mentor is an intelligent SaaS platform that helps entrepreneurs and business owners accelerate growth through data-driven insights, AI mentorship, and actionable roadmaps.

## Phase 1: MVP Scope

- User Authentication (Register / Login)
- Business Profile Setup
- Business Health Score Dashboard
- AI-Powered SWOT Analysis Generator
- AI Mentor Chat
- 30-Day Growth Roadmap

## Current Status

**MVP Implementation Complete + Build Stabilized** — All core features are fully implemented and manually tested:
- User Authentication (Register / Login)
- Business Profile Setup
- AI-enhanced Business Health Score Dashboard (with trend)
- AI-Powered SWOT Analysis Generator
- AI Mentor Chat (persistent history)
- 30-Day Growth Roadmap

Full monorepo `pnpm build` passes with zero TypeScript or ESLint errors. The project is now in the final hardening and launch preparation phase (Milestone 10).

## Key Documents

- [Project Architecture](./ARCHITECTURE.md) — Tech stack, system design, data models, API contracts, and constraints
- [MVP Implementation Plan](./MVP_IMPLEMENTATION_PLAN.md) — Step-by-step build plan optimized for fast, launchable MVP

## Tech Stack (Production-Ready & Lean)

| Layer       | Technology                          | Rationale |
|-------------|-------------------------------------|---------|
| Frontend    | Next.js 15 + React 19 + TypeScript + Tailwind + shadcn/ui | Industry standard for modern SaaS dashboards |
| Backend     | Node.js + Express 4 + Prisma 6      | Fast, mature, excellent TypeScript support |
| Database    | PostgreSQL 16                       | Reliable, great with Prisma, future-proof |
| Auth        | JWT (access tokens)                 | Simple, stateless, fast for MVP |
| AI          | OpenAI (gpt-4o / gpt-4o-mini)       | High quality + reliable. Easy to swap |
| Styling     | Tailwind 4 + shadcn/ui + Radix      | Beautiful, accessible, highly productive |
| State       | TanStack Query + minimal Zustand    | Excellent caching + server state |

## Principles for This Project

- **Launchable MVP first** — No over-engineering
- **Professional SaaS quality** — Clean UI, responsive, trustworthy
- **Clear separation** — Frontend (Next.js) and Backend (Express) as separate apps
- **Pragmatic decisions** — Choose speed-to-launch over perfection where it doesn't matter
- **Extensible foundation** — Easy to add billing, teams, advanced AI features later

## Getting Started

See [QUICKSTART.md](./docs/QUICKSTART.md) for the fastest way to get running locally, and [DEVELOPMENT.md](./DEVELOPMENT.md) for the complete local development guide (including database setup, environment variables, and common commands).

**Note:** As of the start of Milestone 10, the project is fully built and stabilized. Demo/seed data and additional production hardening steps are being added in this phase.

---

**Massive Mentor** — Helping businesses grow massively, one insight at a time.
